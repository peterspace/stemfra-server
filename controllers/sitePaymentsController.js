// Public payment endpoints called by the template sites (Phase 1: one-time
// charge at booking). Single-var supabase require per server convention.
const supabase = require('../config/supabase');
const { stripe, APPLICATION_FEE_BPS, PROCESSING_PCT_BPS, PROCESSING_FIXED_CENTS } = require('../config/stripe');

/** GET /api/site-payments/config — public publishable key for Stripe.js on the client. */
function config(_req, res) {
  res.json({ publishableKey: process.env.STRIPE_PUBLISHABLE_KEY || null });
}

/**
 * Core: create a destination-charge PaymentIntent for a service price (no HTTP).
 * Returns { ok:true, free:true } for $0 services, { ok:true, clientSecret,
 * paymentIntentId, amount, currency, applicationFee } for paid ones, or
 * { ok:false, code, message, notReady } when the site can't take payments yet.
 * Shared by the public POST handler and the Front Desk in-chat payment flow.
 */
async function createBookingIntent({ siteId, serviceId, customerEmail }) {
  if (!stripe) return { ok: false, code: 503, message: 'Payments are not configured.', notReady: true };
  if (!siteId || !serviceId) return { ok: false, code: 400, message: 'Missing siteId or serviceId.' };

  const { data: site } = await supabase
    .from('sites').select('id, status, payments_enabled').eq('id', siteId).single();
  if (!site || !['live', 'previewing'].includes(site.status)) return { ok: false, code: 404, message: 'Site not available.' };
  if (!site.payments_enabled) return { ok: false, code: 400, message: 'Payments are not enabled for this site.', notReady: true };

  const { data: acct } = await supabase
    .from('site_payment_accounts').select('stripe_account_id, charges_enabled').eq('site_id', siteId).single();
  if (!acct?.stripe_account_id || !acct.charges_enabled) {
    return { ok: false, code: 400, message: 'This business is not ready to take payments yet.', notReady: true };
  }

  const { data: svc } = await supabase
    .from('site_services').select('id, name, price_cents, currency').eq('id', serviceId).eq('site_id', siteId).single();
  if (!svc) return { ok: false, code: 404, message: 'Service not found.' };

  const amount = svc.price_cents || 0;
  if (amount <= 0) return { ok: true, free: true };

  const currency = (svc.currency || 'usd').toLowerCase();
  const margin = Math.round((amount * APPLICATION_FEE_BPS) / 10000);
  const processingEstimate = Math.round((amount * PROCESSING_PCT_BPS) / 10000) + PROCESSING_FIXED_CENTS;
  const fee = margin + processingEstimate;

  const intent = await stripe.paymentIntents.create({
    amount,
    currency,
    automatic_payment_methods: { enabled: true },
    // N1: Stripe emails the customer a receipt on success (LIVE mode only —
    // test mode never sends, so this stays dormant until Stripe verification
    // completes; no extra gate needed).
    ...(customerEmail ? { receipt_email: customerEmail } : {}),
    ...(fee > 0 ? { application_fee_amount: fee } : {}),
    transfer_data: { destination: acct.stripe_account_id },
    on_behalf_of: acct.stripe_account_id,
    metadata: { site_id: siteId, service_id: serviceId },
  });

  return { ok: true, clientSecret: intent.client_secret, paymentIntentId: intent.id, amount, currency, applicationFee: fee, platformMargin: margin };
}

/**
 * POST /api/site-payments/intent  { siteId, serviceId } — public, thin wrapper.
 * Free ($0) services return { free: true } so the client skips payment.
 */
async function createIntent(req, res) {
  try {
    const r = await createBookingIntent({ siteId: req.body?.siteId, serviceId: req.body?.serviceId, customerEmail: req.body?.customerEmail });
    if (!r.ok) return res.status(r.code).json({ success: false, message: r.message });
    if (r.free) return res.json({ success: true, free: true });
    res.json({ success: true, clientSecret: r.clientSecret, paymentIntentId: r.paymentIntentId, amount: r.amount, currency: r.currency, applicationFee: r.applicationFee, platformMargin: r.platformMargin });
  } catch (err) {
    console.error('[sitePayments.createIntent]', err.message);
    res.status(500).json({ success: false, message: 'Could not start payment.' });
  }
}

module.exports = { config, createIntent, createBookingIntent };
