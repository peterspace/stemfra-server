// System B — native memberships: the BUSINESS's customers subscribe to a plan
// and pay the BUSINESS via Stripe Connect (destination subscription on the
// platform account + application_fee_percent = Stemfra's cut). Mirrors the
// System A checkout pattern, plus transfer_data.destination + the app fee.
// Single-var supabase require per convention.
const supabase = require('../config/supabase');
const { stripe, SUBSCRIPTION_APP_FEE_PCT } = require('../config/stripe');

/**
 * POST /api/site-memberships/checkout
 * { siteId, productId, returnUrl }
 * Creates a Stripe Checkout session (subscription mode) for a native membership
 * plan. The member is the customer (Checkout collects their email); money goes
 * to the gym's connected account, less our application fee. The webhook
 * (kind='site_membership') links the customer + writes the site_subscriptions row.
 */
async function createCheckout(req, res) {
  if (!stripe) return res.status(503).json({ success: false, message: 'Payments are not configured.' });
  try {
    const { siteId, productId, returnUrl } = req.body || {};
    if (!siteId || !productId) return res.status(400).json({ success: false, message: 'Missing siteId or productId.' });

    const { data: site } = await supabase
      .from('sites').select('id, status, subdomain').eq('id', siteId).single();
    if (!site || site.status !== 'live') return res.status(404).json({ success: false, message: 'Site not available.' });

    const { data: plan } = await supabase
      .from('site_products')
      .select('id, name, price_cents, currency, product_type, fulfillment_mode, stripe_price_id, is_active, external_url')
      .eq('id', productId).eq('site_id', siteId).single();
    if (!plan || !plan.is_active || plan.product_type !== 'membership') {
      return res.status(404).json({ success: false, message: 'Membership plan not found.' });
    }
    if (plan.fulfillment_mode !== 'native') {
      // External (bring-your-own) tiers link out (e.g. Wodify) — not our checkout.
      return res.status(400).json({ success: false, message: 'This plan is managed off-site.', externalUrl: plan.external_url });
    }
    if (!plan.stripe_price_id) {
      return res.status(400).json({ success: false, message: 'This plan is not ready for checkout.' });
    }

    const { data: acct } = await supabase
      .from('site_payment_accounts').select('stripe_account_id, charges_enabled').eq('site_id', siteId).single();
    if (!acct?.stripe_account_id || !acct.charges_enabled) {
      return res.status(400).json({ success: false, message: 'This business is not ready to take payments yet.' });
    }

    const base = (returnUrl || `https://${site.subdomain}.stemfra.com/memberships`).split('?')[0];

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      line_items: [{ price: plan.stripe_price_id, quantity: 1 }],
      success_url: `${base}?membership=success`,
      cancel_url: `${base}?membership=cancelled`,
      metadata: { kind: 'site_membership', site_id: siteId, product_id: productId },
      subscription_data: {
        application_fee_percent: SUBSCRIPTION_APP_FEE_PCT,
        transfer_data: { destination: acct.stripe_account_id },
        metadata: { kind: 'site_membership', site_id: siteId, product_id: productId },
      },
    });

    res.json({ success: true, url: session.url, sessionId: session.id });
  } catch (err) {
    console.error('[siteMemberships.createCheckout]', err.message);
    res.status(500).json({ success: false, message: 'Could not start checkout.' });
  }
}

module.exports = { createCheckout };
