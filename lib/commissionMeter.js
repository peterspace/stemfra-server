// Commission metering (P13, Batch 1 — LEDGER ONLY, no charging).
//
// Meters a tenant's UNIFIED income for a month into ONE billing_charges row
// (kind 'commission', status 'due', provider 'pending'). Income streams:
//   - booking revenue collected  = onlineCents + atVisitCollectedCents   (buildModel)
//   - membership cash confirmed   = SUM(site_subscription_payments) in the window
//   - orders (packs/products/drop-ins) = site_orders paid in the period
//
// Booking figures come straight from reportsController.buildModel so this stays a
// faithful extension of the owner Reports, not a parallel definition.
//
// P14 (pay-at-venue) CHANGED the membership stream to a CASH basis (§1d): commission
// follows money CONFIRMED collected (a site_subscription_payments row per activation
// / renewal confirm), per the month it was confirmed. This replaced the old MRR
// run-rate, which billed on every active sub whether or not cash moved that month and
// swept in legacy Stripe-collected subs whose commission is already the Connect app
// fee (double-charge). Reports still SHOW MRR as an info metric; the meter no longer
// uses it. site_subscription_payments has no refund column yet — venue refunds are
// out of band, so a confirmed row stands (revisit if venue refunds get tracked).
//
// v1 caveats:
//   - site_orders.amount_cents is treated as the charged total for the order (NOT x quantity);
//     confirm when the products/orders feature goes live (0 rows pre-launch).
//   - No charging here: collection (offline statement) is a later batch.
const supabase = require('../config/supabase'); // single-var import (repo convention)
const { getCommissionConfig } = require('./commission');
const { buildModel } = require('../controllers/cms/reportsController');

// UTC month bounds for a 'YYYY-MM' period string.
function monthBounds(period) {
  const [y, m] = String(period).split('-').map(Number);
  const start = new Date(Date.UTC(y, m - 1, 1, 0, 0, 0, 0));
  const endInclusive = new Date(Date.UTC(y, m, 0, 23, 59, 59, 999)); // last day of month
  const lastDay = new Date(Date.UTC(y, m, 0));
  return {
    periodStart: start.toISOString().slice(0, 10),
    periodEnd: lastDay.toISOString().slice(0, 10),
    fromIso: start.toISOString(),
    toIso: endInclusive.toISOString(),
  };
}

// Membership cash CONFIRMED in the window (§1d cash basis). The pay-at-venue
// source of truth is site_subscription_payments — a row is written only when the
// owner confirms a collection in the CMS (activation or a renewal confirm), so
// this sums real money, per the month it was confirmed (late payments land in the
// month they were taken). This REPLACES the old MRR run-rate estimate, which
// over-counted: it billed on every active subscription whether or not cash moved
// that month, and it included legacy Stripe-collected subs whose commission is
// already taken as the Connect application fee (billing them here too would
// double-charge). Stripe subs write no payment rows, so they are correctly out.
async function membershipCashCollected(siteId, fromIso, toIso) {
  const { data, error } = await supabase
    .from('site_subscription_payments')
    .select('amount_cents, confirmed_at')
    .eq('site_id', siteId)
    .gte('confirmed_at', fromIso)
    .lte('confirmed_at', toIso)
    .limit(100000);
  if (error) throw error;
  let cents = 0;
  for (const p of data || []) cents += p.amount_cents || 0;
  return cents;
}

// Orders (packs / products / drop-ins) actually paid in the window, minus refunds.
async function ordersPaidCents(siteId, fromIso, toIso) {
  const { data, error } = await supabase
    .from('site_orders')
    .select('amount_cents, paid_at, refunded_at')
    .eq('site_id', siteId)
    .gte('paid_at', fromIso)
    .lte('paid_at', toIso)
    .is('refunded_at', null)
    .limit(100000);
  if (error) throw error;
  let cents = 0;
  for (const o of data || []) {
    if (o.paid_at) cents += o.amount_cents || 0; // amount_cents = charged total (see header caveat)
  }
  return cents;
}

// Compute + (unless dryRun) upsert the commission ledger row for one site + month.
async function meterSiteCommission(siteId, period, { dryRun = false } = {}) {
  const cfg = await getCommissionConfig();
  const { periodStart, periodEnd, fromIso, toIso } = monthBounds(period);

  const model = await buildModel(siteId, fromIso, toIso);
  const bookingsOnlineCents = model.onlineCents || 0;
  const atVisitCollectedCents = model.atVisitCollectedCents || 0;
  // §1d cash basis — confirmed venue collections in the window, NOT the MRR
  // run-rate (Reports still surface MRR as an INFO metric).
  const membershipCollectedCents = await membershipCashCollected(siteId, fromIso, toIso);
  const ordersCents = await ordersPaidCents(siteId, fromIso, toIso);

  const gmvCents = bookingsOnlineCents + atVisitCollectedCents + membershipCollectedCents + ordersCents;
  const amountCents = Math.round(gmvCents * (cfg.rate || 0));

  // Due 15 days after the period closes (net-15).
  const due = new Date(periodEnd + 'T00:00:00.000Z');
  due.setUTCDate(due.getUTCDate() + 15);
  const dueDate = due.toISOString().slice(0, 10);

  const lineItems = [{
    period,
    rate: cfg.rate,
    basis: cfg.basis,
    gmv_cents: gmvCents,
    bookings_online_cents: bookingsOnlineCents,
    at_visit_collected_cents: atVisitCollectedCents,
    membership_collected_cents: membershipCollectedCents,
    orders_cents: ordersCents,
  }];

  const result = {
    siteId, period, periodStart, periodEnd,
    rate: cfg.rate, gmvCents, amountCents, lineItems,
  };
  if (dryRun) return { ...result, dryRun: true };

  // Idempotent per (site, period, kind). Update an existing DUE row; never overwrite
  // one already requested/paid (collection has started on it).
  const { data: existing, error: selErr } = await supabase
    .from('billing_charges')
    .select('id, status')
    .eq('site_id', siteId)
    .eq('kind', 'commission')
    .eq('period_start', periodStart)
    .maybeSingle();
  if (selErr) throw selErr;

  const row = {
    site_id: siteId,
    subscription_id: null, // commission is not tied to a subscription
    kind: 'commission',
    line_items: lineItems,
    amount_cents: amountCents,
    currency: cfg.currency || 'USD',
    period_start: periodStart,
    period_end: periodEnd,
    due_date: dueDate,
    status: 'due',
    provider: 'pending', // ledger only; a collection provider is assigned in Batch 2
    metadata: { source: 'commission_meter', basis: cfg.basis || 'all' },
  };

  if (existing) {
    if (existing.status !== 'due') {
      return { ...result, chargeId: existing.id, skipped: `status=${existing.status}` };
    }
    const { error } = await supabase
      .from('billing_charges')
      .update({ ...row, updated_at: new Date().toISOString() })
      .eq('id', existing.id);
    if (error) throw error;
    return { ...result, chargeId: existing.id, updated: true };
  }

  const { data: ins, error } = await supabase
    .from('billing_charges')
    .insert(row)
    .select('id')
    .single();
  if (error) throw error;
  return { ...result, chargeId: ins.id, inserted: true };
}

// Meter every LIVE site for a period (monthly run / manual admin trigger).
//
// Demo/fixture sites (metadata.is_starter) are SKIPPED by default — Peter's call
// 2026-08-04, made so the scheduler can be armed pre-launch: it proves the cron +
// env wiring every month without piling junk invoices onto the demo fleet (all 16
// current live sites are starters), and their data still displays everywhere; it
// just doesn't bill. A real tenant is never flagged, so launch needs no change.
// Rehearse the full loop on demand with { includeDemo: true } via the admin
// trigger (POST /api/admin/billing/commission/run { includeDemo: true }).
async function meterAllSitesForPeriod(period, { dryRun = false, includeDemo = false } = {}) {
  const { data: sites, error } = await supabase
    .from('sites')
    .select('id, metadata')
    .eq('status', 'live')
    .limit(100000);
  if (error) throw error;
  const billable = includeDemo
    ? (sites || [])
    : (sites || []).filter((s) => s.metadata?.is_starter !== true);
  const skipped = (sites || []).length - billable.length;
  // Log the skip so a "0 invoices generated" month reads as demo-exclusion, not a bug.
  if (skipped) console.log(`[commission] ${period}: skipping ${skipped} demo/starter site(s); metering ${billable.length}`);
  const out = [];
  for (const s of billable) {
    try {
      out.push(await meterSiteCommission(s.id, period, { dryRun }));
    } catch (e) {
      out.push({ siteId: s.id, period, error: e.message });
    }
  }
  return out;
}

module.exports = { meterSiteCommission, meterAllSitesForPeriod, monthBounds, ordersPaidCents };
