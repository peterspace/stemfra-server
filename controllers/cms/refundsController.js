// CMS — owner-issued refunds (System B), full or partial, on the owner's manual
// decision (cancellation/refund is business-decided, often partial/delayed).
//
// TWO payment models coexist here:
//  · BOOKINGS (P12 direct keys): the charge lives entirely on the business's OWN
//    Stripe account (getStripeForSite). Refund is a PLAIN refund on that account —
//    no destination transfer to reverse, no platform application fee (there is
//    none; Stemfra takes no cut of bookings).
//  · SUBSCRIPTIONS (memberships): still the platform Connect destination-charge
//    model (not yet pivoted — see Task #17). Refund REVERSES THE TRANSFER (the gym
//    bears the amount) but KEEPS our application fee (non-refundable; covers the
//    Stripe processing fee Stripe never returns on refunds).
// Single-var supabase require per convention.
const supabase = require('../../config/supabase');
const { stripe } = require('../../config/stripe');
const { getStripeForSite } = require('../../lib/paymentCredentials');
const { verifySiteOwnership } = require('../../middleware/cmsAuth');
const { logSiteActivity } = require('../../lib/activity');

/**
 * POST /api/cms/refunds  { bookingId?, subscriptionId?, amountCents? }
 * Provide a bookingId (refund that booking's payment) or a subscriptionId
 * (refund its latest charge). Omit amountCents for a full refund.
 */
async function refund(req, res) {
  try {
    const { bookingId, subscriptionId, amountCents } = req.body || {};

    let piId = null;
    let siteId = null;
    let bookingRowId = null;
    let subRow = null;

    if (bookingId) {
      const { data: b } = await supabase
        .from('site_bookings').select('id, site_id, stripe_payment_intent_id, payment_status').eq('id', bookingId).single();
      if (!b) return res.status(404).json({ success: false, message: 'Booking not found.' });
      if (b.payment_status !== 'paid') return res.status(400).json({ success: false, message: 'Booking is not paid.' });
      siteId = b.site_id; piId = b.stripe_payment_intent_id; bookingRowId = b.id;
    } else if (subscriptionId) {
      if (!stripe) return res.status(503).json({ success: false, message: 'Stripe not configured.' });
      const { data: ss } = await supabase
        .from('site_subscriptions').select('id, site_id, stripe_customer_id, metadata').eq('id', subscriptionId).single();
      if (!ss) return res.status(404).json({ success: false, message: 'Subscription not found.' });
      siteId = ss.site_id; subRow = ss;
      const pis = await stripe.paymentIntents.list({ customer: ss.stripe_customer_id, limit: 1 });
      piId = pis.data[0]?.id;
    } else {
      return res.status(400).json({ success: false, message: 'Provide bookingId or subscriptionId.' });
    }

    if (!piId) return res.status(400).json({ success: false, message: 'No payment found to refund.' });
    const site = await verifySiteOwnership(req.cmsUser.id, siteId);
    if (!site) return res.status(403).json({ success: false, message: 'Not your site.' });

    let refundObj;
    if (bookingRowId) {
      // Direct-key booking → refund on the business's OWN account, plain refund.
      const tenantStripe = await getStripeForSite(siteId);
      if (!tenantStripe) return res.status(400).json({ success: false, message: 'This business is not connected to Stripe.' });
      refundObj = await tenantStripe.refunds.create({
        payment_intent: piId,
        ...(amountCents ? { amount: amountCents } : {}),
      });
      // Full refund → mark the row refunded (partial leaves it 'paid').
      if (!amountCents) {
        await supabase.from('site_bookings').update({ payment_status: 'refunded' }).eq('id', bookingRowId);
      }
    } else {
      // Subscription → platform Connect: reverse the transfer, keep the app fee.
      refundObj = await stripe.refunds.create({
        payment_intent: piId,
        ...(amountCents ? { amount: amountCents } : {}),
        reverse_transfer: true,        // the gym (who chose to refund) bears the amount
        refund_application_fee: false, // platform fee is non-refundable (model B)
      });
      // Record the refund on the subscription so the CMS can show "−$X refunded"
      // (a subscription's status doesn't change on a refund). Cumulative, in
      // metadata — no schema change.
      const md = subRow.metadata || {};
      await supabase.from('site_subscriptions').update({
        metadata: {
          ...md,
          refunded_total_cents: (md.refunded_total_cents || 0) + refundObj.amount,
          last_refund_cents: refundObj.amount,
          last_refund_at: new Date().toISOString(),
        },
      }).eq('id', subRow.id);
    }

    await logSiteActivity({
      siteId,
      actorName: req.cmsUser?.email,
      action: 'payment_refunded',
      entityType: bookingRowId ? 'site_booking' : 'site_subscription',
      entityId: bookingRowId || subscriptionId,
      details: { amount_cents: refundObj.amount, kind: bookingRowId ? 'booking' : 'subscription' },
    });

    res.json({ success: true, refundId: refundObj.id, amount: refundObj.amount, status: refundObj.status });
  } catch (err) {
    console.error('[refunds.refund]', err.message);
    res.status(500).json({ success: false, message: err.message || 'Could not refund.' });
  }
}

module.exports = { refund };
