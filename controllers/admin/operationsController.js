// Staff cross-site OVERSIGHT (Waves 4 + 5): read-only views of bookings and
// memberships/payments across ALL customer sites, PLUS staff-initiated
// refund/cancel actions. Owners manage their own in the CMS; staff can act
// across all sites for support. The refund/cancel Stripe params here MIRROR the
// owner flows in controllers/cms/{refundsController,subscriptionsController}.js
// (model B: refund reverses the transfer but KEEPS the platform fee) — keep them
// in sync. The CMS controllers are intentionally left untouched (verified money
// path). Staff-gated; no ownership scope (requireStaffAuth).
const supabase = require('../../config/supabase');
const { stripe } = require('../../config/stripe');
const { logSiteActivity } = require('../../lib/activity');

const i18n = (v) => (v && typeof v === 'object' ? v.en || '' : v || '');
const fullName = (c) => [c?.first_name, c?.last_name].filter(Boolean).join(' ') || c?.email || '—';

// GET /api/admin/bookings?siteId= — recent bookings across all sites.
async function listBookings(req, res) {
  try {
    let q = supabase
      .from('site_bookings')
      .select('id, starts_at, status, payment_status, amount_cents, service_name_snapshot, site:sites(subdomain, company:companies(name)), customer:site_customers(first_name, last_name, email)')
      .order('starts_at', { ascending: false })
      .limit(200);
    if (req.query.siteId) q = q.eq('site_id', req.query.siteId);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    const bookings = (data || []).map((b) => ({
      id: b.id,
      startsAt: b.starts_at,
      status: b.status,
      paymentStatus: b.payment_status,
      amountCents: b.amount_cents,
      service: i18n(b.service_name_snapshot),
      business: b.site?.company?.name || b.site?.subdomain || '—',
      subdomain: b.site?.subdomain,
      customer: fullName(b.customer),
    }));
    res.json({ bookings });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// GET /api/admin/memberships — native memberships (System B subscriptions)
// across all sites, with a quick MRR summary.
async function listMemberships(req, res) {
  try {
    const { data, error } = await supabase
      .from('site_subscriptions')
      .select('id, status, amount_cents, current_period_end, cancel_at_period_end, site:sites(subdomain, company:companies(name)), customer:site_customers(first_name, last_name, email), product:site_products(name)')
      .order('created_at', { ascending: false })
      .limit(300);
    if (error) throw new Error(error.message);
    const memberships = (data || []).map((s) => ({
      id: s.id,
      status: s.status,
      amountCents: s.amount_cents,
      periodEnd: s.current_period_end,
      cancelAtPeriodEnd: s.cancel_at_period_end,
      business: s.site?.company?.name || s.site?.subdomain || '—',
      customer: fullName(s.customer),
      plan: i18n(s.product?.name) || 'Membership',
    }));
    const active = memberships.filter((m) => m.status === 'active');
    res.json({
      memberships,
      summary: { activeCount: active.length, activeMrrCents: active.reduce((a, m) => a + (m.amountCents || 0), 0) },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// POST /api/admin/bookings/:id/refund { amountCents? } — staff refund a booking
// payment (mirrors CMS refundsController economics).
async function refundBooking(req, res) {
  try {
    if (!stripe) return res.status(503).json({ error: 'Stripe not configured.' });
    const { amountCents } = req.body || {};
    const { data: b } = await supabase
      .from('site_bookings').select('id, site_id, stripe_payment_intent_id, payment_status').eq('id', req.params.id).single();
    if (!b) return res.status(404).json({ error: 'Booking not found.' });
    if (b.payment_status !== 'paid') return res.status(400).json({ error: 'Booking is not paid.' });
    if (!b.stripe_payment_intent_id) return res.status(400).json({ error: 'No payment to refund.' });

    const refundObj = await stripe.refunds.create({
      payment_intent: b.stripe_payment_intent_id,
      ...(amountCents ? { amount: amountCents } : {}),
      reverse_transfer: true,
      refund_application_fee: false,
    });
    if (!amountCents) await supabase.from('site_bookings').update({ payment_status: 'refunded' }).eq('id', b.id);
    await logSiteActivity({ siteId: b.site_id, actorName: req.staffUser?.email, action: 'payment_refunded', entityType: 'site_booking', entityId: b.id, details: { amount_cents: refundObj.amount, by: 'staff' } });
    res.json({ ok: true, amount: refundObj.amount, status: refundObj.status });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// POST /api/admin/memberships/:id/cancel { mode: 'now' | 'period_end' }
async function cancelMembership(req, res) {
  try {
    if (!stripe) return res.status(503).json({ error: 'Stripe not configured.' });
    const { data: sub } = await supabase.from('site_subscriptions').select('*').eq('id', req.params.id).single();
    if (!sub) return res.status(404).json({ error: 'Subscription not found.' });
    if (!sub.stripe_subscription_id) return res.status(400).json({ error: 'No Stripe subscription.' });
    const mode = req.body?.mode === 'now' ? 'now' : 'period_end';
    if (mode === 'now') {
      await stripe.subscriptions.cancel(sub.stripe_subscription_id);
      await supabase.from('site_subscriptions').update({ status: 'canceled', canceled_at: new Date().toISOString(), cancel_at_period_end: false }).eq('id', sub.id);
    } else {
      await stripe.subscriptions.update(sub.stripe_subscription_id, { cancel_at_period_end: true });
      await supabase.from('site_subscriptions').update({ cancel_at_period_end: true }).eq('id', sub.id);
    }
    await logSiteActivity({ siteId: sub.site_id, actorName: req.staffUser?.email, action: 'subscription_cancelled', entityType: 'site_subscription', entityId: sub.id, details: { mode, by: 'staff' } });
    res.json({ ok: true, mode });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// POST /api/admin/memberships/:id/refund { amountCents? } — refund latest charge.
async function refundMembership(req, res) {
  try {
    if (!stripe) return res.status(503).json({ error: 'Stripe not configured.' });
    const { amountCents } = req.body || {};
    const { data: sub } = await supabase.from('site_subscriptions').select('id, site_id, stripe_customer_id, metadata').eq('id', req.params.id).single();
    if (!sub) return res.status(404).json({ error: 'Subscription not found.' });
    const pis = await stripe.paymentIntents.list({ customer: sub.stripe_customer_id, limit: 1 });
    const piId = pis.data[0]?.id;
    if (!piId) return res.status(400).json({ error: 'No payment found to refund.' });

    const refundObj = await stripe.refunds.create({
      payment_intent: piId,
      ...(amountCents ? { amount: amountCents } : {}),
      reverse_transfer: true,
      refund_application_fee: false,
    });
    const md = sub.metadata || {};
    await supabase.from('site_subscriptions').update({
      metadata: { ...md, refunded_total_cents: (md.refunded_total_cents || 0) + refundObj.amount, last_refund_cents: refundObj.amount, last_refund_at: new Date().toISOString() },
    }).eq('id', sub.id);
    await logSiteActivity({ siteId: sub.site_id, actorName: req.staffUser?.email, action: 'payment_refunded', entityType: 'site_subscription', entityId: sub.id, details: { amount_cents: refundObj.amount, by: 'staff' } });
    res.json({ ok: true, amount: refundObj.amount, status: refundObj.status });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

module.exports = { listBookings, listMemberships, refundBooking, cancelMembership, refundMembership };
