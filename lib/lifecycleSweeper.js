// Lifecycle email sweeper (N4). Runs a few times a day; each pass finds
// customers who hit a milestone and sends the matching "B-family" email
// (see lib/lifecycleEmails.js). Milestones are per-customer-once (stamped), so
// the sweep is idempotent. Slice 1 = first-visit follow-up; win-back / birthday
// / anniversary / no-show are added in later slices.
const supabase = require('../config/supabase');
const { sendFirstVisitFollowup, sendWinBack, sendReviewRequest, sendBirthday, sendAnniversary } = require('./lifecycleEmails');
const { activeProvider } = require('./mailer');

const DAY = 86400000;
const WIN_BACK_DAYS = 60;     // "lapsed" threshold
const REVIEW_ASK_DAYS = 2;    // days after a visit to ask for a review
const ANNIVERSARY_DAYS = 365; // ~1 year after the first visit

// First-visit follow-up: a customer whose FIRST visit happened ~1 day ago.
async function sweepFirstVisit() {
  const now = Date.now();
  const from = new Date(now - 2 * DAY).toISOString();
  const to = new Date(now - 1 * DAY).toISOString();
  const { data: cands, error } = await supabase
    .from('site_bookings')
    .select('id, customer_id, starts_at, site:sites!inner(status)')
    .in('status', ['confirmed', 'completed'])
    .gte('starts_at', from)
    .lt('starts_at', to)
    .eq('site.status', 'live')
    .limit(300);
  if (error) { console.error('[lifecycle] first-visit query:', error.message); return 0; }

  let sent = 0;
  for (const b of cands || []) {
    if (!b.customer_id) continue;
    // First visit = no earlier non-cancelled booking for this customer.
    const { count } = await supabase
      .from('site_bookings')
      .select('id', { count: 'exact', head: true })
      .eq('customer_id', b.customer_id)
      .neq('status', 'cancelled')
      .lt('starts_at', b.starts_at);
    if (count && count > 0) continue;
    if (await sendFirstVisitFollowup(b.id)) sent += 1;
  }
  if (sent) console.log(`[lifecycle] first-visit follow-up → ${sent}`);
  return sent;
}

// Win-back: a customer whose MOST RECENT visit was ~60 days ago (no return since,
// incl. no upcoming booking). The sender applies a re-send cooldown.
async function sweepWinBack() {
  const now = Date.now();
  const from = new Date(now - (WIN_BACK_DAYS + 3) * DAY).toISOString();
  const to = new Date(now - WIN_BACK_DAYS * DAY).toISOString();
  const { data: cands, error } = await supabase
    .from('site_bookings')
    .select('id, customer_id, starts_at, site:sites!inner(status)')
    .in('status', ['confirmed', 'completed'])
    .gte('starts_at', from)
    .lt('starts_at', to)
    .eq('site.status', 'live')
    .limit(300);
  if (error) { console.error('[lifecycle] win-back query:', error.message); return 0; }

  let sent = 0;
  for (const b of cands || []) {
    if (!b.customer_id) continue;
    // Lapsed = this is their most recent non-cancelled booking (nothing later,
    // including future).
    const { count } = await supabase
      .from('site_bookings')
      .select('id', { count: 'exact', head: true })
      .eq('customer_id', b.customer_id)
      .neq('status', 'cancelled')
      .gt('starts_at', b.starts_at);
    if (count && count > 0) continue;
    if (await sendWinBack(b.id)) sent += 1;
  }
  if (sent) console.log(`[lifecycle] win-back → ${sent}`);
  return sent;
}

// Review / feedback ask: a customer whose visit was ~2 days ago. The sender is
// once-ever per customer and skips if a first-visit email just went out.
async function sweepReviewAsk() {
  const now = Date.now();
  const from = new Date(now - (REVIEW_ASK_DAYS + 1) * DAY).toISOString();
  const to = new Date(now - REVIEW_ASK_DAYS * DAY).toISOString();
  const { data: cands, error } = await supabase
    .from('site_bookings')
    .select('id, customer_id, starts_at, site:sites!inner(status)')
    .in('status', ['confirmed', 'completed'])
    .gte('starts_at', from)
    .lt('starts_at', to)
    .eq('site.status', 'live')
    .limit(300);
  if (error) { console.error('[lifecycle] review-ask query:', error.message); return 0; }

  let sent = 0;
  for (const b of cands || []) {
    if (!b.customer_id) continue;
    if (await sendReviewRequest(b.id)) sent += 1;
  }
  if (sent) console.log(`[lifecycle] review-ask → ${sent}`);
  return sent;
}

// Birthday: customers whose birthday (month + day) is today. Customer-based, not
// booking-based. The sender is once-per-year and re-checks opt-out/prefs.
// NOTE: filters month/day in JS (the birthdate column can't be MM-DD matched in
// PostgREST). Fine at current volume; revisit with a generated column + index if
// the customer base grows large.
async function sweepBirthday() {
  const today = new Date();
  const mmdd = `${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const { data: custs, error } = await supabase
    .from('site_customers')
    .select('id, birthdate, email, site:sites!inner(status)')
    .not('birthdate', 'is', null)
    .not('email', 'is', null)
    .eq('site.status', 'live')
    .limit(2000);
  if (error) { console.error('[lifecycle] birthday query:', error.message); return 0; }

  let sent = 0;
  for (const c of custs || []) {
    if (typeof c.birthdate !== 'string' || c.birthdate.slice(5, 10) !== mmdd) continue; // 'YYYY-MM-DD' → 'MM-DD'
    if (await sendBirthday(c.id)) sent += 1;
  }
  if (sent) console.log(`[lifecycle] birthday → ${sent}`);
  return sent;
}

// First-visit anniversary: a customer whose FIRST visit happened ~1 year ago.
// Same first-visit detection as sweepFirstVisit, at the 365-day mark.
async function sweepAnniversary() {
  const now = Date.now();
  const from = new Date(now - (ANNIVERSARY_DAYS + 1) * DAY).toISOString();
  const to = new Date(now - ANNIVERSARY_DAYS * DAY).toISOString();
  const { data: cands, error } = await supabase
    .from('site_bookings')
    .select('id, customer_id, starts_at, site:sites!inner(status)')
    .in('status', ['confirmed', 'completed'])
    .gte('starts_at', from)
    .lt('starts_at', to)
    .eq('site.status', 'live')
    .limit(300);
  if (error) { console.error('[lifecycle] anniversary query:', error.message); return 0; }

  let sent = 0;
  for (const b of cands || []) {
    if (!b.customer_id) continue;
    // First visit = no earlier non-cancelled booking for this customer.
    const { count } = await supabase
      .from('site_bookings')
      .select('id', { count: 'exact', head: true })
      .eq('customer_id', b.customer_id)
      .neq('status', 'cancelled')
      .lt('starts_at', b.starts_at);
    if (count && count > 0) continue;
    if (await sendAnniversary(b.id)) sent += 1;
  }
  if (sent) console.log(`[lifecycle] anniversary → ${sent}`);
  return sent;
}

async function sweepOnce() {
  await sweepFirstVisit();
  await sweepReviewAsk();
  await sweepWinBack();
  await sweepBirthday();
  await sweepAnniversary();
  // no-show — later slice.
}

function startLifecycleSweeper({ intervalMs = 12 * 3600 * 1000 } = {}) {
  if (!activeProvider()) {
    console.warn('[lifecycle] no email provider configured — sweeper NOT started');
    return null;
  }
  setTimeout(() => sweepOnce().catch(() => {}), 45000);   // shortly after boot
  const t = setInterval(() => sweepOnce().catch((e) => console.error('[lifecycle]', e.message)), intervalMs);
  t.unref?.();
  console.log(`✓ Lifecycle sweeper running every ${Math.round(intervalMs / 3600000)}h`);
  return t;
}

module.exports = { startLifecycleSweeper, sweepOnce, sweepFirstVisit, sweepReviewAsk, sweepWinBack, sweepBirthday, sweepAnniversary };
