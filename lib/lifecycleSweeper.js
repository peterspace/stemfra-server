// Lifecycle email sweeper (N4). Runs a few times a day; each pass finds
// customers who hit a milestone and sends the matching "B-family" email
// (see lib/lifecycleEmails.js). Milestones are per-customer-once (stamped), so
// the sweep is idempotent. Slice 1 = first-visit follow-up; win-back / birthday
// / anniversary / no-show are added in later slices.
const supabase = require('../config/supabase');
const { sendFirstVisitFollowup, sendWinBack, sendReviewRequest, sendBirthday, sendAnniversary } = require('./lifecycleEmails');
const { activeProvider } = require('./mailer');

const DAY = 86400000;
const WIN_BACK_DAYS = 30;     // default "lapsed" threshold (per-site override below)
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
    // First visit = no earlier non-canceled booking for this customer.
    const { count } = await supabase
      .from('site_bookings')
      .select('id', { count: 'exact', head: true })
      .eq('customer_id', b.customer_id)
      .neq('status', 'canceled')
      .lt('starts_at', b.starts_at);
    if (count && count > 0) continue;
    if (await sendFirstVisitFollowup(b.id)) sent += 1;
  }
  if (sent) console.log(`[lifecycle] first-visit follow-up → ${sent}`);
  return sent;
}

// Win-back: a customer whose MOST RECENT visit was N days ago (no return since,
// incl. no upcoming booking). The sender applies a re-send cooldown.
// N is PER-SITE (site_theme_settings.metadata.lifecycle_windows.win_back_days,
// clamped 14–180) with a 30-day default — barbershop cadence is 3–5 weeks, so
// the old global 60 asked too late (Peter, 2026-08-27).
function winBackDaysOf(meta) {
  const n = Math.round(Number(meta?.lifecycle_windows?.win_back_days));
  return Number.isFinite(n) ? Math.min(180, Math.max(14, n)) : WIN_BACK_DAYS;
}

async function sweepWinBack() {
  const now = Date.now();
  // Group live-site ids by their configured win-back window, then run the
  // usual [N, N+3) candidate query once per distinct value (1–2 in practice).
  const { data: themes, error: tErr } = await supabase
    .from('site_theme_settings')
    .select('site_id, metadata, site:sites!inner(status)')
    .eq('site.status', 'live')
    .limit(2000);
  if (tErr) { console.error('[lifecycle] win-back sites query:', tErr.message); return 0; }
  // Sites with a NON-default window, grouped by their days value. Everything
  // else (default-configured sites AND sites with no theme row) rides the
  // default query, which EXCLUDES the overridden sites so nobody gets both
  // windows.
  const overridden = new Map();
  for (const t of themes || []) {
    const d = winBackDaysOf(t.metadata);
    if (d === WIN_BACK_DAYS) continue;
    if (!overridden.has(d)) overridden.set(d, []);
    overridden.get(d).push(t.site_id);
  }
  const overriddenIds = [...overridden.values()].flat();
  const groups = [[WIN_BACK_DAYS, null], ...overridden.entries()];

  let sent = 0;
  for (const [days, siteIds] of groups) {
    const from = new Date(now - (days + 3) * DAY).toISOString();
    const to = new Date(now - days * DAY).toISOString();
    let q = supabase
      .from('site_bookings')
      .select('id, customer_id, starts_at, site:sites!inner(status)')
      .in('status', ['confirmed', 'completed'])
      .gte('starts_at', from)
      .lt('starts_at', to)
      .eq('site.status', 'live')
      .limit(300);
    if (siteIds) q = q.in('site_id', siteIds);
    else if (overriddenIds.length) q = q.not('site_id', 'in', `(${overriddenIds.join(',')})`);
    const { data: cands, error } = await q;
    if (error) { console.error('[lifecycle] win-back query:', error.message); continue; }

    for (const b of cands || []) {
      if (!b.customer_id) continue;
      // Lapsed = this is their most recent non-canceled booking (nothing later,
      // including future).
      const { count } = await supabase
        .from('site_bookings')
        .select('id', { count: 'exact', head: true })
        .eq('customer_id', b.customer_id)
        .neq('status', 'canceled')
        .gt('starts_at', b.starts_at);
      if (count && count > 0) continue;
      if (await sendWinBack(b.id)) sent += 1;
    }
  }
  if (sent) console.log(`[lifecycle] win-back → ${sent}`);
  return sent;
}

// Review ask, FAST lane (Peter 2026-08-27): the moment the owner marks a
// booking COMPLETED, the review email should be minutes away, so the barber
// can say "you'll get our review link any moment" while the excitement is
// fresh. A 5-minute sweep picks up recently-completed bookings; the sender
// still enforces once-ever per customer, prefs, and opt-out. An in-memory set
// keeps re-sweeps cheap (the DB stamp is the real guard).
const triedCompleted = new Set();
async function sweepReviewAskCompleted() {
  const from = new Date(Date.now() - 26 * 3600 * 1000).toISOString();
  const { data: cands, error } = await supabase
    .from('site_bookings')
    .select('id, customer_id, updated_at, site:sites!inner(status)')
    .eq('status', 'completed')
    .gte('updated_at', from)
    .eq('site.status', 'live')
    .limit(300);
  if (error) { console.error('[lifecycle] review-ask (completed) query:', error.message); return 0; }

  let sent = 0;
  for (const b of cands || []) {
    if (!b.customer_id || triedCompleted.has(b.id)) continue;
    triedCompleted.add(b.id);
    if (triedCompleted.size > 5000) triedCompleted.clear();
    if (await sendReviewRequest(b.id)) sent += 1;
  }
  if (sent) console.log(`[lifecycle] review-ask (on completion) → ${sent}`);
  return sent;
}

// Review ask, FALLBACK lane: owners who never mark bookings complete still get
// the ask ~2 days after the visit (confirmed-only — completed bookings ride
// the fast lane above; the once-ever stamp makes overlap harmless anyway).
async function sweepReviewAsk() {
  const now = Date.now();
  const from = new Date(now - (REVIEW_ASK_DAYS + 1) * DAY).toISOString();
  const to = new Date(now - REVIEW_ASK_DAYS * DAY).toISOString();
  const { data: cands, error } = await supabase
    .from('site_bookings')
    .select('id, customer_id, starts_at, site:sites!inner(status)')
    .eq('status', 'confirmed')
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
    // First visit = no earlier non-canceled booking for this customer.
    const { count } = await supabase
      .from('site_bookings')
      .select('id', { count: 'exact', head: true })
      .eq('customer_id', b.customer_id)
      .neq('status', 'canceled')
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

function startLifecycleSweeper({ intervalMs = 12 * 3600 * 1000, fastIntervalMs = 5 * 60000 } = {}) {
  if (!activeProvider()) {
    console.warn('[lifecycle] no email provider configured — sweeper NOT started');
    return null;
  }
  setTimeout(() => sweepOnce().catch(() => {}), 45000);   // shortly after boot
  const t = setInterval(() => sweepOnce().catch((e) => console.error('[lifecycle]', e.message)), intervalMs);
  t.unref?.();
  // Fast lane: completed-booking review asks land within minutes, not hours.
  const f = setInterval(() => sweepReviewAskCompleted().catch((e) => console.error('[lifecycle-fast]', e.message)), fastIntervalMs);
  f.unref?.();
  // Seasonal greetings: hourly, so each site catches its 09:00-20:00 local
  // window on the holiday itself (a no-op on the other ~360 days).
  const { sweepSeasonal } = require('./seasonalGreetings');
  const s = setInterval(() => sweepSeasonal().catch((e) => console.error('[seasonal]', e.message)), 3600 * 1000);
  s.unref?.();
  console.log(`✓ Lifecycle sweeper running every ${Math.round(intervalMs / 3600000)}h (+ review fast lane every ${Math.round(fastIntervalMs / 60000)}min + seasonal hourly)`);
  return t;
}

module.exports = { startLifecycleSweeper, sweepOnce, sweepFirstVisit, sweepReviewAsk, sweepReviewAskCompleted, sweepWinBack, sweepBirthday, sweepAnniversary };
