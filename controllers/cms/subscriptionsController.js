// CMS — owner management of member subscriptions.
//
// P14 (pay-at-venue): most subscriptions are collection_mode='venue' — there is
// NO Stripe subscription behind them. Those are managed with DB-only writes:
//   - activate  : pending → active (owner confirms the first payment at the venue)
//   - decline   : pending → canceled
//   - cancel    : active → canceled (now) / cancel_at_period_end (period end)
//   - pause/resume : metadata.paused flag (no billing to pause)
// Legacy collection_mode='stripe' rows (the dormant Connect path) still drive
// Stripe. Refunds for venue subs are out of band (no CMS refund button — money
// moved at the venue).
//
// Status value is 'canceled' (American) everywhere — standardized 2026-08-05 to
// match Stripe + Twilio, so all subscription + booking rows and the CMS share
// ONE spelling (no more British/American split).
// Single-var supabase require per convention.
const supabase = require('../../config/supabase');
const { stripe } = require('../../config/stripe');
const { verifySiteOwnership } = require('../../middleware/cmsAuth');
const { logSiteActivity } = require('../../lib/activity');
const { addInterval } = require('../../lib/membershipPeriod');
const { sendMail } = require('../../lib/mailer');
const emails = require('../../templates/transactionalEmails');
const { resolveTenantEmailBrand } = require('../../lib/tenantEmailBrand');

const en = (v) => (typeof v === 'string' ? v : v?.en || '');
const isVenue = (sub) => sub.collection_mode === 'venue' || !sub.stripe_subscription_id;

function logSub(req, sub, action, details) {
  return logSiteActivity({
    siteId: sub.site_id, actorName: req.cmsUser?.email,
    action, entityType: 'site_subscription', entityId: sub.id, details,
  });
}

function moneyLabel(cents, currency) {
  if (cents == null) return null;
  try { return new Intl.NumberFormat('en-US', { style: 'currency', currency: (currency || 'USD').toUpperCase() }).format(cents / 100); }
  catch { return `$${(cents / 100).toFixed(2)}`; }
}

// Load a subscription + verify ownership. Does NOT require Stripe (venue subs
// have none) — handlers branch on isVenue.
async function loadOwned(req, res) {
  const { data: sub } = await supabase
    .from('site_subscriptions').select('*').eq('id', req.params.id).single();
  if (!sub) { res.status(404).json({ success: false, message: 'Subscription not found.' }); return null; }
  const site = await verifySiteOwnership(req.cmsUser.id, sub.site_id);
  if (!site) { res.status(403).json({ success: false, message: 'Not your site.' }); return null; }
  return sub;
}

function requireStripeSub(sub, res) {
  if (!stripe) { res.status(503).json({ success: false, message: 'Stripe not configured.' }); return false; }
  if (!sub.stripe_subscription_id) { res.status(400).json({ success: false, message: 'No Stripe subscription.' }); return false; }
  return true;
}

// Best-effort member email through a site's tenant brand.
async function memberEmail(sub, builder, subject) {
  try {
    const { data: cust } = await supabase
      .from('site_customers').select('email, first_name').eq('id', sub.customer_id).maybeSingle();
    if (!cust?.email) return;
    const brand = await resolveTenantEmailBrand(sub.site_id);
    await sendMail({
      fromName: brand.name || 'Your membership',
      replyTo: brand.businessEmail || undefined,
      to: cust.email,
      subject,
      ...builder({
        businessName: brand.name, businessLogoUrl: brand.logoUrl, businessEmail: brand.businessEmail,
        businessUrl: brand.businessUrl, businessAccent: brand.accent, businessFont: brand.font,
        businessPhotoUrl: brand.photoUrl, firstName: cust.first_name,
      }),
    });
  } catch (e) { console.error('[subscriptions] member email failed:', e.message); }
}

// ── Activate a pending venue signup (owner confirms first payment at venue) ──
async function activateSubscription(req, res) {
  try {
    const sub = await loadOwned(req, res); if (!sub) return;
    if (!isVenue(sub)) return res.status(400).json({ success: false, message: 'This subscription is billed online.' });
    if (sub.status !== 'pending') return res.status(400).json({ success: false, message: 'Only a pending signup can be activated.' });

    const { data: plan } = await supabase
      .from('site_products').select('name, price_cents, currency, billing_interval, billing_interval_count').eq('id', sub.product_id).maybeSingle();
    const amountCents = Number.isInteger(req.body?.amountCents) ? req.body.amountCents : (sub.amount_cents ?? plan?.price_cents ?? 0);
    if (!amountCents || amountCents <= 0) return res.status(400).json({ success: false, message: 'Enter the amount you collected.' });

    const now = new Date().toISOString();
    const periodEnd = addInterval(now, plan?.billing_interval || 'month', plan?.billing_interval_count || 1);

    const { error: upErr } = await supabase.from('site_subscriptions')
      .update({ status: 'active', current_period_end: periodEnd, amount_cents: amountCents })
      .eq('id', sub.id);
    if (upErr) return res.status(500).json({ success: false, message: upErr.message });

    // First payment row = the commission source of truth (unique per period).
    await supabase.from('site_subscription_payments').insert([{
      site_id: sub.site_id, subscription_id: sub.id,
      period_start: now, period_end: periodEnd,
      amount_cents: amountCents, confirmed_by: req.cmsUser?.email || null,
      method: req.body?.method || null,
      metadata: req.body?.note ? { note: String(req.body.note).slice(0, 500) } : {},
    }]);

    await logSub(req, sub, 'membership_activated', { amount_cents: amountCents, period_end: periodEnd });
    await memberEmail(
      { ...sub, amount_cents: amountCents },
      (bits) => emails.membershipActivated({
        ...bits, planName: en(plan?.name), priceLabel: moneyLabel(amountCents, plan?.currency),
        nextRenewalLabel: new Date(periodEnd).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }),
      }),
      'Your membership is active',
    );
    res.json({ success: true, currentPeriodEnd: periodEnd });
  } catch (err) {
    console.error('[subscriptions.activate]', err.message);
    res.status(500).json({ success: false, message: 'Could not activate.' });
  }
}

// ── Decline a pending signup (member never signed/paid) ──
async function declineSubscription(req, res) {
  try {
    const sub = await loadOwned(req, res); if (!sub) return;
    if (sub.status !== 'pending') return res.status(400).json({ success: false, message: 'Only a pending signup can be declined.' });
    await supabase.from('site_subscriptions')
      .update({ status: 'canceled', canceled_at: new Date().toISOString() }).eq('id', sub.id);
    await logSub(req, sub, 'membership_declined', null);
    res.json({ success: true });
  } catch (err) {
    console.error('[subscriptions.decline]', err.message);
    res.status(500).json({ success: false, message: 'Could not decline.' });
  }
}

async function cancelSubscription(req, res) {
  try {
    const sub = await loadOwned(req, res); if (!sub) return;
    const mode = req.body?.mode === 'now' ? 'now' : 'period_end';
    if (isVenue(sub)) {
      // DB-only: no billing to stop.
      if (mode === 'now') {
        await supabase.from('site_subscriptions')
          .update({ status: 'canceled', canceled_at: new Date().toISOString(), cancel_at_period_end: false }).eq('id', sub.id);
      } else {
        await supabase.from('site_subscriptions').update({ cancel_at_period_end: true }).eq('id', sub.id);
      }
    } else {
      if (!requireStripeSub(sub, res)) return;
      if (mode === 'now') {
        await stripe.subscriptions.cancel(sub.stripe_subscription_id);
        await supabase.from('site_subscriptions')
          .update({ status: 'canceled', canceled_at: new Date().toISOString(), cancel_at_period_end: false }).eq('id', sub.id);
      } else {
        await stripe.subscriptions.update(sub.stripe_subscription_id, { cancel_at_period_end: true });
        await supabase.from('site_subscriptions').update({ cancel_at_period_end: true }).eq('id', sub.id);
      }
    }
    await logSub(req, sub, 'subscription_canceled', { mode });
    res.json({ success: true, mode });
  } catch (err) {
    console.error('[subscriptions.cancel]', err.message);
    res.status(500).json({ success: false, message: 'Could not cancel.' });
  }
}

// ── Confirm collected renewal payments (monthly "Renewals" confirm-all) ──
// Body: { siteId, items: [{ subscriptionId, amountCents?, method?, note? }] }.
// Per item: write a payment row for the period that is renewing (period_start =
// the sub's CURRENT current_period_end), then advance current_period_end one
// interval. The unique (subscription_id, period_start) guard makes a double-fire
// idempotent — we only advance when the payment INSERT actually landed, so a
// re-confirm hits the guard and skips the advance instead of double-renewing.
async function confirmOnePayment(req, siteId, item) {
  const subId = item?.subscriptionId;
  if (!subId) return { subscriptionId: null, error: 'Missing subscriptionId.' };

  const { data: sub } = await supabase
    .from('site_subscriptions').select('*').eq('id', subId).maybeSingle();
  if (!sub || sub.site_id !== siteId) return { subscriptionId: subId, error: 'Not found.' };
  if (!isVenue(sub)) return { subscriptionId: subId, error: 'Billed online.' };
  // E2 adds 'renewal_due'; until then only 'active' subs are ever due here.
  if (sub.status !== 'active') return { subscriptionId: subId, error: `status=${sub.status}` };
  if (!sub.current_period_end) return { subscriptionId: subId, error: 'No period to renew.' };

  const { data: plan } = await supabase
    .from('site_products')
    .select('name, price_cents, currency, billing_interval, billing_interval_count')
    .eq('id', sub.product_id).maybeSingle();

  const amountCents = Number.isInteger(item?.amountCents)
    ? item.amountCents
    : (sub.amount_cents ?? plan?.price_cents ?? 0);
  if (!amountCents || amountCents <= 0) return { subscriptionId: subId, error: 'No amount.' };

  const periodStart = sub.current_period_end;
  const periodEnd = addInterval(periodStart, plan?.billing_interval || 'month', plan?.billing_interval_count || 1);

  // Claim the period first. A conflict (23505 on the unique guard) = already
  // confirmed for this period → do NOT advance again.
  const { error: insErr } = await supabase.from('site_subscription_payments').insert([{
    site_id: siteId, subscription_id: subId,
    period_start: periodStart, period_end: periodEnd,
    amount_cents: amountCents, confirmed_by: req.cmsUser?.email || null,
    method: item?.method || null,
    metadata: item?.note ? { note: String(item.note).slice(0, 500) } : {},
  }]);
  if (insErr) {
    if (insErr.code === '23505') return { subscriptionId: subId, skipped: 'already confirmed for this period' };
    return { subscriptionId: subId, error: insErr.message };
  }

  // Payment landed → advance the period (and restore 'active' once E2 sets renewal_due).
  await supabase.from('site_subscriptions')
    .update({ status: 'active', current_period_end: periodEnd, amount_cents: amountCents })
    .eq('id', subId);

  await logSub(req, sub, 'membership_payment_confirmed', { amount_cents: amountCents, period_end: periodEnd });
  await memberEmail(
    { ...sub, amount_cents: amountCents },
    (bits) => emails.membershipRenewed({
      ...bits, planName: en(plan?.name), priceLabel: moneyLabel(amountCents, plan?.currency),
      nextRenewalLabel: new Date(periodEnd).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }),
    }),
    'Payment received',
  );
  return { subscriptionId: subId, confirmed: true, periodEnd };
}

async function confirmPayments(req, res) {
  try {
    const siteId = req.body?.siteId;
    const items = Array.isArray(req.body?.items) ? req.body.items : [];
    if (!siteId) return res.status(400).json({ success: false, message: 'Missing siteId.' });
    const site = await verifySiteOwnership(req.cmsUser.id, siteId);
    if (!site) return res.status(403).json({ success: false, message: 'Not your site.' });
    if (!items.length) return res.status(400).json({ success: false, message: 'No memberships selected.' });
    if (items.length > 500) return res.status(400).json({ success: false, message: 'Too many at once.' });

    const results = [];
    for (const it of items) results.push(await confirmOnePayment(req, siteId, it));
    res.json({ success: true, confirmed: results.filter((r) => r.confirmed).length, results });
  } catch (err) {
    console.error('[subscriptions.confirmPayments]', err.message);
    res.status(500).json({ success: false, message: 'Could not confirm payments.' });
  }
}

async function pauseSubscription(req, res) {
  try {
    const sub = await loadOwned(req, res); if (!sub) return;
    if (!isVenue(sub)) {
      if (!requireStripeSub(sub, res)) return;
      await stripe.subscriptions.update(sub.stripe_subscription_id, { pause_collection: { behavior: 'void' } });
    }
    // Venue: nothing to pause at the processor; the flag stops reminders + hides renewals.
    await supabase.from('site_subscriptions')
      .update({ metadata: { ...(sub.metadata || {}), paused: true } }).eq('id', sub.id);
    await logSub(req, sub, 'subscription_paused', null);
    res.json({ success: true });
  } catch (err) {
    console.error('[subscriptions.pause]', err.message);
    res.status(500).json({ success: false, message: 'Could not pause.' });
  }
}

async function resumeSubscription(req, res) {
  try {
    const sub = await loadOwned(req, res); if (!sub) return;
    if (!isVenue(sub)) {
      if (!requireStripeSub(sub, res)) return;
      await stripe.subscriptions.update(sub.stripe_subscription_id, { pause_collection: '' });
    }
    const md = { ...(sub.metadata || {}) }; delete md.paused;
    await supabase.from('site_subscriptions').update({ metadata: md }).eq('id', sub.id);
    await logSub(req, sub, 'subscription_resumed', null);
    res.json({ success: true });
  } catch (err) {
    console.error('[subscriptions.resume]', err.message);
    res.status(500).json({ success: false, message: 'Could not resume.' });
  }
}

module.exports = { activateSubscription, declineSubscription, confirmPayments, cancelSubscription, pauseSubscription, resumeSubscription };
