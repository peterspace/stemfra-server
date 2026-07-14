// Billing cycle opener — System A. For manual-collection providers (Payoneer),
// nobody auto-charges the monthly fee, so this background task opens ONE recurring
// charge per active subscription per calendar month. Staff then work the "Due this
// cycle" list in the CRM. Stripe subscriptions self-bill, so they're skipped.
// Dedup rule: never open a charge for a sub that already has one created this
// calendar month (the initial setup+first-month charge counts as month one).
const supabase = require('../config/supabase');
const billing = require('./billing');

const monthKey = (d) => `${d.getUTCFullYear()}-${d.getUTCMonth()}`;

async function sweepOnce() {
  const { data: subs, error } = await supabase
    .from('subscriptions')
    .select('id, site_id, monthly_amount_cents, currency, provider, metadata')
    .eq('status', 'active')
    .eq('cancel_at_period_end', false)          // don't bill a sub set to cancel
    .neq('provider', 'stripe');                 // Stripe Billing self-bills
  if (error || !subs?.length) return;

  const now = new Date();
  let opened = 0;
  for (const sub of subs) {
    const { data: recent } = await supabase
      .from('billing_charges')
      .select('created_at')
      .eq('subscription_id', sub.id)
      .order('created_at', { ascending: false })
      .limit(12);
    const hasAny = (recent || []).length > 0;
    const billedThisMonth = (recent || []).some((c) => monthKey(new Date(c.created_at)) === monthKey(now));
    if (!hasAny || billedThisMonth) continue;   // not started yet, or already billed this month
    try {
      await billing.openRecurringCharge(sub, { planLabel: sub.metadata?.plan_label || 'Stemfra subscription', when: now });
      opened++;
    } catch (e) {
      console.error('[billing] cycle open failed for sub', sub.id, '—', e.message);
    }
  }
  if (opened) console.log(`[billing] cycle sweep — opened ${opened} recurring charge(s)`);
  await dunOverdue();
}

// Dunning: remind the owner about charges that are past their due date and still
// unpaid. Throttled to at most once every 7 days per charge (stamped on
// metadata.last_dunned_at) so it nudges without nagging.
async function dunOverdue() {
  const today = new Date().toISOString().slice(0, 10);
  const { data: overdue } = await supabase
    .from('billing_charges')
    .select('id, due_date, status, metadata')
    .in('status', ['due', 'requested'])
    .lt('due_date', today)
    .limit(100);
  if (!overdue?.length) return;
  const { sendDunningEmail } = require('./billingEmails');
  let dunned = 0;
  for (const c of overdue) {
    const last = c.metadata?.last_dunned_at ? new Date(c.metadata.last_dunned_at) : null;
    const daysSince = last ? (Date.now() - last.getTime()) / 86400000 : Infinity;
    if (daysSince < 7) continue;
    const ok = await sendDunningEmail(c.id);
    if (ok) {
      await supabase.from('billing_charges')
        .update({ metadata: { ...(c.metadata || {}), last_dunned_at: new Date().toISOString() } })
        .eq('id', c.id);
      dunned++;
    }
  }
  if (dunned) console.log(`[billing] dunning — reminded ${dunned} overdue charge(s)`);
}

// Runs a few times a day; the calendar-month dedup makes it idempotent.
function startBillingCycleSweeper({ intervalMs = 6 * 3600 * 1000 } = {}) {
  setTimeout(() => sweepOnce().catch(() => {}), 30000);   // shortly after boot
  const t = setInterval(() => sweepOnce().catch(() => {}), intervalMs);
  console.log(`✓ Billing cycle sweeper running every ${Math.round(intervalMs / 3600000)}h`);
  return t;
}

module.exports = { sweepOnce, startBillingCycleSweeper };
