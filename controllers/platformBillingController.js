// System A — Stemfra bills its BUSINESS customers (the template build fee + the
// monthly hosting/maintenance subscription). This runs on Stemfra's OWN Stripe
// account (NOT Connect): Stemfra is the merchant, the business is the customer.
// Wires the existing top-level `subscriptions` table (build_amount_cents +
// monthly_amount_cents + deal_id). Single-var supabase require per convention.
//
// Contrast with System B (controllers/sitePaymentsController.js): there the
// BUSINESS is the merchant via Connect and its end-customers pay. Different
// system entirely — see docs and the two-systems note.
const supabase = require('../config/supabase');
const { stripe } = require('../config/stripe');
const { createPlatformCheckout } = require('../lib/platformBilling');

const RETURN_URL = process.env.PLATFORM_BILLING_RETURN_URL || process.env.CMS_URL || 'http://localhost:5180';

// Staff-only endpoints. Proper staff auth (Supabase JWT + is_stemfra_staff) is
// wired with the A2 trigger UI; until then guard with a shared admin secret.
// Fail-closed in production; open in dev when unset so the engine is testable.
function staffGuard(req, res) {
  const secret = process.env.STEMFRA_ADMIN_SECRET;
  if (!secret) {
    if (process.env.NODE_ENV === 'production') {
      res.status(503).json({ success: false, message: 'Admin billing not configured.' });
      return false;
    }
    return true; // dev convenience
  }
  if (req.headers['x-stemfra-admin-secret'] !== secret) {
    res.status(401).json({ success: false, message: 'Unauthorized.' });
    return false;
  }
  return true;
}

/**
 * POST /api/platform-billing/checkout
 * { siteId, monthlyAmountCents, buildAmountCents?, currency? }
 * Creates a Stripe Checkout session (subscription mode) charging the business:
 * the monthly hosting fee (recurring) + the one-time build fee on the first
 * invoice. Reuses/creates a Stripe Customer for the business and upserts the
 * `subscriptions` row (status 'pending' until the webhook confirms).
 */
async function createCheckout(req, res) {
  if (!stripe) return res.status(503).json({ success: false, message: 'Stripe not configured.' });
  if (!staffGuard(req, res)) return;
  try {
    const { siteId, monthlyAmountCents, buildAmountCents = 0, currency = 'usd' } = req.body || {};
    const result = await createPlatformCheckout({
      siteId, monthlyAmountCents, buildAmountCents, currency,
      successUrl: `${RETURN_URL}?billing=success`,
      cancelUrl: `${RETURN_URL}?billing=cancelled`,
    });
    res.json({ success: true, ...result });
  } catch (err) {
    if (err.code === 'bad_input' || err.code === 'no_email') return res.status(400).json({ success: false, message: err.message });
    if (err.code === 'not_found') return res.status(404).json({ success: false, message: err.message });
    console.error('[platformBilling.createCheckout]', err.message);
    res.status(500).json({ success: false, message: 'Could not start checkout.' });
  }
}

/**
 * POST /api/platform-billing/portal  { siteId }
 * Returns a Stripe Customer Portal link so the business can update its card,
 * view invoices, etc. Cancellation policy is configured on the portal.
 */
async function portalLink(req, res) {
  if (!stripe) return res.status(503).json({ success: false, message: 'Stripe not configured.' });
  if (!staffGuard(req, res)) return;
  try {
    const { siteId } = req.body || {};
    if (!siteId) return res.status(400).json({ success: false, message: 'Missing siteId.' });
    const { data: sub } = await supabase
      .from('subscriptions').select('stripe_customer_id').eq('site_id', siteId).maybeSingle();
    if (!sub?.stripe_customer_id) return res.status(404).json({ success: false, message: 'No billing customer for this site.' });
    const session = await stripe.billingPortal.sessions.create({
      customer: sub.stripe_customer_id,
      return_url: RETURN_URL,
    });
    res.json({ success: true, url: session.url });
  } catch (err) {
    console.error('[platformBilling.portalLink]', err.message);
    res.status(500).json({ success: false, message: 'Could not create portal link.' });
  }
}

module.exports = { createCheckout, portalLink };
