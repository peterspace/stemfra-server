// Public payment endpoints called by the template sites (Phase 1: one-time
// charge at booking). Single-var supabase require per server convention.
const supabase = require('../config/supabase');
const { stripe, APPLICATION_FEE_BPS, PROCESSING_PCT_BPS, PROCESSING_FIXED_CENTS } = require('../config/stripe');

/** GET /api/site-payments/config — public publishable key for Stripe.js on the client. */
function config(_req, res) {
  res.json({ publishableKey: process.env.STRIPE_PUBLISHABLE_KEY || null });
}

/**
 * POST /api/site-payments/intent  { siteId, serviceId }
 * Creates a PaymentIntent (destination charge → the gym's connected account,
 * with our application fee) for the service's price. Returns the client secret.
 * Free ($0) services return { free: true } so the client skips payment.
 */
async function createIntent(req, res) {
  if (!stripe) return res.status(503).json({ success: false, message: 'Payments are not configured.' });
  try {
    const { siteId, serviceId } = req.body || {};
    if (!siteId || !serviceId) return res.status(400).json({ success: false, message: 'Missing siteId or serviceId.' });

    const { data: site } = await supabase
      .from('sites').select('id, status, payments_enabled').eq('id', siteId).single();
    if (!site || site.status !== 'live') return res.status(404).json({ success: false, message: 'Site not available.' });
    if (!site.payments_enabled) return res.status(400).json({ success: false, message: 'Payments are not enabled for this site.' });

    const { data: acct } = await supabase
      .from('site_payment_accounts').select('stripe_account_id, charges_enabled').eq('site_id', siteId).single();
    if (!acct?.stripe_account_id || !acct.charges_enabled) {
      return res.status(400).json({ success: false, message: 'This business is not ready to take payments yet.' });
    }

    const { data: svc } = await supabase
      .from('site_services').select('id, name, price_cents, currency').eq('id', serviceId).eq('site_id', siteId).single();
    if (!svc) return res.status(404).json({ success: false, message: 'Service not found.' });

    const amount = svc.price_cents || 0;
    if (amount <= 0) return res.json({ success: true, free: true }); // free service → no payment

    const currency = (svc.currency || 'usd').toLowerCase();

    // DESTINATION charge: the charge is created on the PLATFORM and the net is
    // transferred to the gym's connected account, less our application fee. The
    // platform pays Stripe's processing fee, so the application fee must cover
    // BOTH that fee AND our margin for the platform's cut to net positive:
    //   fee = (estimated Stripe fee) + (our margin)
    // The gym receives amount - fee; the platform keeps fee - (actual Stripe fee)
    // = our margin (exact for US cards where the estimate matches Stripe's rate).
    const margin = Math.round((amount * APPLICATION_FEE_BPS) / 10000);
    const processingEstimate = Math.round((amount * PROCESSING_PCT_BPS) / 10000) + PROCESSING_FIXED_CENTS;
    const fee = margin + processingEstimate;

    const intent = await stripe.paymentIntents.create({
      amount,
      currency,
      automatic_payment_methods: { enabled: true },
      ...(fee > 0 ? { application_fee_amount: fee } : {}),
      transfer_data: { destination: acct.stripe_account_id },
      on_behalf_of: acct.stripe_account_id,
      metadata: { site_id: siteId, service_id: serviceId },
    });

    res.json({ success: true, clientSecret: intent.client_secret, paymentIntentId: intent.id, amount, currency, applicationFee: fee, platformMargin: margin });
  } catch (err) {
    console.error('[sitePayments.createIntent]', err.message);
    res.status(500).json({ success: false, message: 'Could not start payment.' });
  }
}

module.exports = { config, createIntent };
