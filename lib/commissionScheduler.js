// Commission monthly scheduler (P13 / COMMISSION_MODEL.md Batch 1 remaining).
//
// Auto-runs the commission meter for the JUST-CLOSED calendar month so the
// monthly invoice (billing_charges kind='commission') generates without a manual
// click. Mirrors the billing cycle opener's background-task shape.
//
// Idempotency: `meterAllSitesForPeriod` is idempotent per (site, period_start) —
// it updates an existing DUE row and never overwrites one already requested/paid.
// We only meter the previous month during the FIRST few days of the new month so
// the numbers freeze shortly after the period closes (membership figures are a
// current-active run-rate in Batch 1, so we don't want to keep re-metering a long-
// closed month as subscriptions change — see the meter's header caveat).
//
// GATED OFF by default: set COMMISSION_SCHEDULER_ENABLED=true to arm it. Pre-launch
// we don't want to auto-invoice the demo/fixture live sites; the manual admin
// trigger POST /api/admin/billing/commission/run stays available meanwhile.
const { meterAllSitesForPeriod } = require('./commissionMeter');

// 'YYYY-MM' of the month before `now` (UTC).
function prevMonthPeriod(now) {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

const GENERATION_WINDOW_DAYS = 5; // meter the just-closed month only in the new month's first 5 days

async function sweepOnce({ now = new Date() } = {}) {
  if (now.getUTCDate() > GENERATION_WINDOW_DAYS) return; // outside the freeze window — nothing to do
  const period = prevMonthPeriod(now);
  try {
    const results = await meterAllSitesForPeriod(period, { dryRun: false });
    const written = (results || []).filter((r) => r && (r.inserted || r.updated)).length;
    const errored = (results || []).filter((r) => r && r.error).length;
    if (written || errored) {
      console.log(`[commission] monthly meter ${period}: ${written} invoice(s) generated/updated` + (errored ? `, ${errored} error(s)` : ''));
    }
  } catch (e) {
    console.error('[commission] monthly meter failed for', period, '—', e.message);
  }
}

// Runs a few times a day; the first-of-month window + meter idempotency make it safe.
function startCommissionScheduler({ intervalMs = 12 * 3600 * 1000 } = {}) {
  if (process.env.COMMISSION_SCHEDULER_ENABLED !== 'true') {
    console.log('• Commission monthly scheduler DISABLED (set COMMISSION_SCHEDULER_ENABLED=true to arm)');
    return null;
  }
  setTimeout(() => sweepOnce().catch(() => {}), 45000); // shortly after boot
  const t = setInterval(() => sweepOnce().catch(() => {}), intervalMs);
  console.log(`✓ Commission monthly scheduler running every ${Math.round(intervalMs / 3600000)}h (meters the just-closed month in its first ${GENERATION_WINDOW_DAYS} days)`);
  return t;
}

module.exports = { sweepOnce, startCommissionScheduler, prevMonthPeriod };
