// Staff admin for System A — clients' SUBSCRIPTIONS TO STEMFRA (build fee +
// monthly hosting), across all sites. This is the "A2" staff UI for the System
// A1 engine (lib/platformBilling + the `subscriptions` table). NOT System B
// (Connect, the businesses' own end-customer payments). Staff-gated.
const supabase = require('../../config/supabase');
const { stripe } = require('../../config/stripe');
const { createPlatformCheckout } = require('../../lib/platformBilling');

const CMS_URL = process.env.CMS_URL || 'http://localhost:5180';
const CRM_URL = process.env.CRM_URL || 'https://crm.stemfra.com';

// GET /api/admin/subscriptions — every site with its Stemfra-billing status.
async function listSubscriptions(req, res) {
  try {
    const { data, error } = await supabase
      .from('sites')
      .select('id, subdomain, status, company:companies(name), vertical:verticals(display_name, build_price_cents, monthly_price_cents, currency), subscription:subscriptions(status, monthly_amount_cents, build_amount_cents, currency, current_period_end, build_paid_at, cancel_at_period_end, stripe_customer_id)')
      .order('created_at', { ascending: false });
    if (error) throw new Error(error.message);

    const rows = (data || []).map((s) => {
      const sub = s.subscription?.[0] || null;
      return {
        siteId: s.id,
        business: s.company?.name || s.subdomain,
        subdomain: s.subdomain,
        siteStatus: s.status,
        vertical: s.vertical?.display_name || '—',
        // what the client WOULD be billed (from the vertical) — for un-billed sites
        priceBuildCents: s.vertical?.build_price_cents ?? null,
        priceMonthlyCents: s.vertical?.monthly_price_cents ?? null,
        currency: (sub?.currency || s.vertical?.currency || 'usd').toUpperCase(),
        billingStatus: sub?.status || 'none',
        monthlyAmountCents: sub?.monthly_amount_cents ?? null,
        buildPaid: !!sub?.build_paid_at,
        currentPeriodEnd: sub?.current_period_end || null,
        cancelAtPeriodEnd: !!sub?.cancel_at_period_end,
        hasCustomer: !!sub?.stripe_customer_id,
      };
    });
    res.json({ subscriptions: rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// POST /api/admin/subscriptions/:siteId/checkout — staff start (or restart)
// the client's Stemfra subscription; returns a Checkout URL to send the client.
async function startCheckout(req, res) {
  try {
    const { siteId } = req.params;
    const { data: s } = await supabase.from('sites').select('vertical_id').eq('id', siteId).single();
    const { data: v } = await supabase.from('verticals').select('build_price_cents, monthly_price_cents, currency').eq('id', s?.vertical_id).single();
    if (!v) return res.status(400).json({ error: 'Pricing not found for this vertical.' });
    const result = await createPlatformCheckout({
      siteId,
      monthlyAmountCents: v.monthly_price_cents,
      buildAmountCents: v.build_price_cents,
      currency: v.currency || 'usd',
      successUrl: `${CMS_URL}/settings?billing=success`,
      cancelUrl: `${CMS_URL}/settings?billing=cancelled`,
    });
    res.json({ ok: true, url: result.url });
  } catch (err) {
    if (err.code === 'no_email') return res.status(400).json({ error: 'The owner contact has no billing email.' });
    if (err.code === 'no_stripe') return res.status(503).json({ error: 'Stripe is not configured.' });
    res.status(500).json({ error: err.message });
  }
}

// POST /api/admin/subscriptions/:siteId/portal — Stripe Customer Portal link.
async function portalLink(req, res) {
  try {
    if (!stripe) return res.status(503).json({ error: 'Stripe is not configured.' });
    const { data: sub } = await supabase.from('subscriptions').select('stripe_customer_id').eq('site_id', req.params.siteId).maybeSingle();
    if (!sub?.stripe_customer_id) return res.status(404).json({ error: 'No billing customer for this site yet — start billing first.' });
    const session = await stripe.billingPortal.sessions.create({ customer: sub.stripe_customer_id, return_url: CRM_URL });
    res.json({ ok: true, url: session.url });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

module.exports = { listSubscriptions, startCheckout, portalLink };
