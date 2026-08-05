// Booking auto-collect sweeper (2026-08-05, Peter — anti-under-reporting).
//
// THE RULE: a PRICED, confirmed/completed booking that the tenant has neither
// taken online payment for nor marked collected within 24h of its scheduled
// time is AUTO-MARKED collected (metadata.collected=true, auto_collected=true,
// collected_at=now). This is the pay-at-venue equivalent of "paid": it enters
// the booking into the commission basis (atVisitCollectedCents) exactly as a
// manual "Mark as collected" would. It exists because, under pay-at-venue, a
// tenant could otherwise avoid the 5% by simply never marking bookings
// collected. Stated in the public Fees & Payments Policy + Terms §5.
//
// WHY IT'S SAFE (never over-bills):
//   - Only priced (amount_cents > 0) bookings — free intros contribute nothing.
//   - Only status confirmed/completed. The commission meter (buildModel)
//     classifies an at-visit booking ONLY when status is confirmed/completed, so
//     a booking that did not happen is excluded regardless. The tenant's escape
//     hatch is therefore intact: mark a no-show/cancellation and it drops out of
//     commission even if it was auto-collected.
//   - Skips online-paid (payment_status != 'none') and already-handled
//     (metadata.collected === true) bookings.
//   - Skips demo/starter sites (like the commission meter) — so it is INERT
//     pre-launch (all current live sites are starters) and never mutates demo
//     booking data. It activates automatically for the first real tenant.
//
// Enabled by default; set BOOKING_AUTOCOLLECT_ENABLED=false to disable.
const supabase = require('../config/supabase');
const { logSiteActivity } = require('./activity');

const BATCH = 500;
const GRACE_HOURS = 24;

// Live, non-demo site ids that this rule bills for (mirrors the meter's filter).
async function billableSiteIds({ includeDemo = false } = {}) {
  const { data, error } = await supabase
    .from('sites').select('id, metadata').eq('status', 'live').limit(100000);
  if (error) throw error;
  return (data || [])
    .filter((s) => includeDemo || s.metadata?.is_starter !== true)
    .map((s) => s.id);
}

// One pass. Returns the number of bookings auto-collected (or, with dryRun, the
// list of candidate booking ids it WOULD collect — no writes).
async function sweepOnce({ now = new Date(), includeDemo = false, dryRun = false } = {}) {
  const siteIds = await billableSiteIds({ includeDemo });
  if (!siteIds.length) return dryRun ? [] : 0; // inert until a real tenant exists

  const cutoff = new Date(now.getTime() - GRACE_HOURS * 3600 * 1000).toISOString();

  // Candidates: priced, confirmed/completed, unpaid online, past the grace
  // window, in a billable site, and NOT already collected (absent or false —
  // an explicit collected=true is left alone). The status gate is the escape
  // hatch, applied again by the meter.
  const { data: rows, error } = await supabase
    .from('site_bookings')
    .select('id, site_id, starts_at, amount_cents, metadata')
    .in('site_id', siteIds)
    .in('status', ['confirmed', 'completed'])
    .eq('payment_status', 'none')
    .gt('amount_cents', 0)
    .lt('starts_at', cutoff)
    .or('metadata->collected.is.null,metadata->collected.eq.false')
    .order('starts_at', { ascending: true })
    .limit(BATCH);
  if (error) { console.error('[auto-collect] query failed:', error.message); return dryRun ? [] : 0; }

  if (dryRun) return (rows || []).map((b) => b.id);

  let done = 0;
  const stamp = now.toISOString();
  for (const b of rows || []) {
    const nextMeta = { ...(b.metadata || {}), collected: true, auto_collected: true, collected_at: stamp };
    // Claim: only flip a row that is still not collected (guards concurrent runs
    // + an owner collecting it between the read and the write). The or-filter
    // matches the SELECT — a plain .not(collected,eq,true) would exclude the
    // common ABSENT-key case (PostgREST: NOT(null=true) is null, not true).
    const { data: claimed } = await supabase
      .from('site_bookings')
      .update({ metadata: nextMeta })
      .eq('id', b.id)
      .eq('payment_status', 'none')
      .or('metadata->collected.is.null,metadata->collected.eq.false')
      .select('id')
      .maybeSingle();
    if (!claimed) continue;
    done += 1;
    // Audit only (no owner bell — a backfill could flip many at once; Reports
    // shows them as collected revenue, and the policy explains the rule).
    await logSiteActivity({
      siteId: b.site_id, action: 'booking_auto_collected',
      entityType: 'site_booking', entityId: b.id,
      details: { amount_cents: b.amount_cents, starts_at: b.starts_at, reason: 'not marked collected within 24h of the scheduled time' },
    });
  }
  if (done) console.log(`[auto-collect] auto-marked ${done} booking(s) collected`);
  return done;
}

function startBookingAutoCollectSweeper({ intervalMs = 6 * 3600 * 1000 } = {}) {
  if (process.env.BOOKING_AUTOCOLLECT_ENABLED === 'false') {
    console.log('• Booking auto-collect sweeper DISABLED (BOOKING_AUTOCOLLECT_ENABLED=false)');
    return null;
  }
  setTimeout(() => sweepOnce().catch((e) => console.error('[auto-collect]', e.message)), 60_000);
  const t = setInterval(() => sweepOnce().catch((e) => console.error('[auto-collect]', e.message)), intervalMs);
  t.unref?.();
  console.log(`✓ Booking auto-collect sweeper running every ${Math.round(intervalMs / 3600000)}h (24h grace; skips demo sites)`);
  return t;
}

module.exports = { startBookingAutoCollectSweeper, sweepOnce };
