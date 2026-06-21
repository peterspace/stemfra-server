// CMS payments — Stripe Connect (Express) onboarding + status.
// Phase 0: connect a gym's Stripe account from the CMS and report its status.
// Single-var supabase require per the server convention.
const supabase = require('../../config/supabase');
const { stripe } = require('../../config/stripe');
const { verifySiteOwnership } = require('../../middleware/cmsAuth');

// Where Stripe sends the owner back after hosted onboarding (the CMS Payments tab).
const CMS_URL = process.env.CMS_URL || 'http://localhost:5180';

function noStripe(res) {
  return res.status(503).json({ error: 'Payments are not configured on the server.' });
}

/** GET /api/cms/payments/healthcheck — unauthenticated; reports config presence. */
function healthcheck(_req, res) {
  res.json({ ok: true, stripe_configured: !!stripe, endpoint: 'cms/payments' });
}

/**
 * POST /api/cms/payments/connect-link  { siteId }
 * Creates (or reuses) the site's Express connected account and returns a
 * Stripe-hosted onboarding link.
 */
async function connectLink(req, res) {
  if (!stripe) return noStripe(res);
  try {
    const { siteId } = req.body || {};
    if (!siteId) return res.status(400).json({ error: 'siteId required' });

    const site = await verifySiteOwnership(req.cmsUser.id, siteId);
    if (!site) return res.status(403).json({ error: 'Not authorized for this site' });

    const { data: existing } = await supabase
      .from('site_payment_accounts').select('stripe_account_id').eq('site_id', siteId).single();

    let accountId = existing?.stripe_account_id;
    if (!accountId) {
      const account = await stripe.accounts.create({
        type: 'express',
        capabilities: { card_payments: { requested: true }, transfers: { requested: true } },
        business_profile: { name: site.subdomain || undefined },
        metadata: { site_id: siteId, subdomain: site.subdomain || '' },
      });
      accountId = account.id;
      await supabase.from('site_payment_accounts').upsert({
        site_id: siteId,
        stripe_account_id: accountId,
        charges_enabled: account.charges_enabled,
        details_submitted: account.details_submitted,
        payouts_enabled: account.payouts_enabled,
        updated_at: new Date().toISOString(),
      });
    }

    const link = await stripe.accountLinks.create({
      account: accountId,
      refresh_url: `${CMS_URL}/settings?stripe=refresh#payments`,
      return_url: `${CMS_URL}/settings?stripe=return#payments`,
      type: 'account_onboarding',
    });

    res.json({ url: link.url });
  } catch (err) {
    console.error('[payments.connectLink]', err.message);
    res.status(500).json({ error: 'Could not start Stripe onboarding.' });
  }
}

/**
 * GET /api/cms/payments/status?siteId=…
 * Refreshes the connected account's capabilities from Stripe and returns them.
 */
async function status(req, res) {
  if (!stripe) return noStripe(res);
  try {
    const siteId = req.query.siteId;
    if (!siteId) return res.status(400).json({ error: 'siteId required' });

    const site = await verifySiteOwnership(req.cmsUser.id, siteId);
    if (!site) return res.status(403).json({ error: 'Not authorized for this site' });

    const { data: acct } = await supabase
      .from('site_payment_accounts').select('*').eq('site_id', siteId).single();

    if (!acct?.stripe_account_id) {
      return res.json({ connected: false, charges_enabled: false, details_submitted: false, payouts_enabled: false });
    }

    const account = await stripe.accounts.retrieve(acct.stripe_account_id);
    const patch = {
      charges_enabled: account.charges_enabled,
      details_submitted: account.details_submitted,
      payouts_enabled: account.payouts_enabled,
      onboarded_at: account.details_submitted && !acct.onboarded_at ? new Date().toISOString() : acct.onboarded_at,
      updated_at: new Date().toISOString(),
    };
    await supabase.from('site_payment_accounts').update(patch).eq('site_id', siteId);

    res.json({ connected: true, ...patch });
  } catch (err) {
    console.error('[payments.status]', err.message);
    res.status(500).json({ error: 'Could not fetch payment status.' });
  }
}

module.exports = { healthcheck, connectLink, status };
