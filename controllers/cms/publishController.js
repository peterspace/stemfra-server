// CMS publish controller (Phase 2d). Owner-facing readiness + publish/unpublish.
// Auth via requireCmsAuth (owner JWT) + verifySiteOwnership for every siteId.
// config/supabase.js exports the client directly; we only need the auth helpers
// + the publish/completeness libs here.
const supabase = require('../../config/supabase');
const { verifySiteOwnership } = require('../../middleware/cmsAuth');
const { evaluateCompleteness } = require('../../lib/siteCompleteness');
const { publishSite, unpublishSite, getBillingStatus } = require('../../lib/sitePublish');
const { createPlatformCheckout } = require('../../lib/platformBilling');
const billing = require('../../lib/billing');

const ZONE = 'stemfra.com';
const CMS_URL = process.env.CMS_URL || 'http://localhost:5180';

// GET /api/cms/site-publish/readiness/:siteId — checklist + billing + URLs.
async function getReadiness(req, res) {
  try {
    const { siteId } = req.params;
    const site = await verifySiteOwnership(req.cmsUser.id, siteId);
    if (!site) return res.status(403).json({ error: 'Not your site.' });
    const [completeness, billing] = await Promise.all([
      evaluateCompleteness(siteId),
      getBillingStatus(siteId),
    ]);
    res.json({
      ...completeness,
      billing,
      subdomain: site.subdomain,
      customDomain: site.custom_domain || null,
      liveUrl: `https://${site.subdomain}.${ZONE}`,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// POST /api/cms/site-publish/publish { siteId } — previewing → live.
async function publish(req, res) {
  try {
    const { siteId } = req.body;
    if (!siteId) return res.status(400).json({ error: 'siteId required' });
    const site = await verifySiteOwnership(req.cmsUser.id, siteId);
    if (!site) return res.status(403).json({ error: 'Not your site.' });
    const result = await publishSite(siteId); // owners always go through the billing gate
    res.json(result);
  } catch (err) {
    if (err.code === 'not_ready') return res.status(409).json({ error: err.message, code: err.code, completeness: err.completeness });
    if (err.code === 'needs_payment') return res.status(402).json({ error: err.message, code: err.code, billing: err.billing });
    if (err.code === 'bad_state') return res.status(409).json({ error: err.message, code: err.code });
    res.status(500).json({ error: err.message });
  }
}

// POST /api/cms/site-publish/unpublish { siteId } — live → previewing.
async function unpublish(req, res) {
  try {
    const { siteId } = req.body;
    if (!siteId) return res.status(400).json({ error: 'siteId required' });
    const site = await verifySiteOwnership(req.cmsUser.id, siteId);
    if (!site) return res.status(403).json({ error: 'Not your site.' });
    res.json(await unpublishSite(siteId));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// POST /api/cms/site-publish/billing-checkout { siteId } — pay-to-publish.
// Owner-facing System A checkout; amounts derive from the site's vertical
// (owner can't set prices). On success the webhook flips the subscription to
// active, clearing the publish billing gate.
async function billingCheckout(req, res) {
  try {
    const { siteId } = req.body;
    if (!siteId) return res.status(400).json({ error: 'siteId required' });
    const site = await verifySiteOwnership(req.cmsUser.id, siteId);
    if (!site) return res.status(403).json({ error: 'Not your site.' });

    const { data: s } = await supabase.from('sites').select('vertical_id').eq('id', siteId).single();
    const { data: vertical } = await supabase
      .from('verticals').select('build_price_cents, monthly_price_cents, currency').eq('id', s?.vertical_id).single();
    if (!vertical) return res.status(400).json({ error: 'Pricing not found for this vertical.' });

    const result = await createPlatformCheckout({
      siteId,
      monthlyAmountCents: vertical.monthly_price_cents,
      buildAmountCents: vertical.build_price_cents,
      currency: vertical.currency || 'usd',
      // NB: must target /settings/publish directly — bare /settings redirects
      // via <Navigate>, which drops the ?billing= query the CMS reacts to.
      successUrl: `${CMS_URL}/settings/publish?billing=success`,
      cancelUrl: `${CMS_URL}/settings/publish?billing=cancelled`,
    });
    res.json(result);
  } catch (err) {
    if (err.code === 'no_stripe') return res.status(503).json({ error: 'Billing is not configured yet.' });
    if (err.code === 'no_email') return res.status(400).json({ error: 'Add a billing email to your account first.' });
    res.status(500).json({ error: err.message });
  }
}

// POST /api/cms/site-publish/request-invoice { siteId } — Payoneer-first
// pay-to-publish. Instead of sending the owner to a Stripe checkout, we open a
// PENDING subscription (so the publish gate stays closed until payment clears),
// create the initial charge (setup + first month), and mark it requested — which
// emails the owner a payment request and rings their bell. Staff confirms the
// Payoneer payment in the CRM, which flips the subscription active and opens the
// gate. Idempotent: a second click won't duplicate the subscription/charge or
// re-send the email.
async function requestPublishInvoice(req, res) {
  try {
    const { siteId } = req.body;
    if (!siteId) return res.status(400).json({ error: 'siteId required' });
    const site = await verifySiteOwnership(req.cmsUser.id, siteId);
    if (!site) return res.status(403).json({ error: 'Not your site.' });

    // Already paid/active → nothing to invoice; the CMS can just publish.
    const status = await getBillingStatus(siteId);
    if (status.active) return res.json({ ok: true, alreadyActive: true });

    // Ensure a subscription row for the site (pending — no auto go-live).
    let { data: sub } = await supabase.from('subscriptions').select('*').eq('site_id', siteId).maybeSingle();
    if (!sub) {
      const { data: s } = await supabase.from('sites').select('vertical_id').eq('id', siteId).single();
      const { data: vertical } = await supabase
        .from('verticals').select('build_price_cents, monthly_price_cents, currency, display_name').eq('id', s?.vertical_id).single();
      if (!vertical) return res.status(400).json({ error: 'Pricing not found for this vertical.' });
      const provider = await billing.getActiveProvider();
      const { data: created, error } = await supabase.from('subscriptions').insert({
        site_id: siteId,
        build_amount_cents: vertical.build_price_cents || 0,
        monthly_amount_cents: vertical.monthly_price_cents || 0,
        currency: vertical.currency || 'USD',
        status: 'pending', provider, cancel_at_period_end: false,
        metadata: { plan_label: vertical.display_name || 'Stemfra subscription', source: 'owner_publish' },
      }).select('*').single();
      if (error) return res.status(500).json({ error: error.message });
      sub = created;
    }

    // Ensure the initial charge, then request it (sends the invoice email).
    const planLabel = sub.metadata?.plan_label || 'Stemfra subscription';
    let { data: charge } = await supabase.from('billing_charges')
      .select('id, status').eq('subscription_id', sub.id).eq('kind', 'initial').maybeSingle();
    if (!charge) charge = await billing.openInitialCharge(sub, { planLabel });

    let invoiced = false;
    if (charge.status === 'due' || charge.status == null) {
      await billing.markRequested(charge.id, { by: null }); // emails the payment request + bell
      invoiced = true;
    }
    return res.json({ ok: true, invoiced, alreadyRequested: !invoiced });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

module.exports = { getReadiness, publish, unpublish, billingCheckout, requestPublishInvoice };
