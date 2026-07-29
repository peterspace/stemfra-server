// CMS payments — Stripe Connect (Express) onboarding + status (LEGACY, dormant)
// AND the P12 direct-keys capture: a business stores its OWN Stripe key so
// charges route straight to its bank (getStripeForSite). Single-var supabase
// require per the server convention.
const supabase = require('../../config/supabase');
const Stripe = require('stripe');
const { stripe } = require('../../config/stripe');
const { verifySiteOwnership } = require('../../middleware/cmsAuth');
const {
  isConfigured: credsConfigured, saveSiteCredentials, setSiteWebhookSecret,
} = require('../../lib/paymentCredentials');

// Mask a publishable key for display (never shows a secret — publishable is
// non-secret, but we still only show head/tail).
function maskKey(k) {
  if (!k) return null;
  const s = String(k);
  return s.length <= 12 ? s : `${s.slice(0, 8)}…${s.slice(-4)}`;
}

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

    // `livemode` isn't a DB column — surface it from the live Stripe object so
    // the CMS can show a "Test mode" badge when the platform runs test keys.
    res.json({ connected: true, ...patch, livemode: account.livemode });
  } catch (err) {
    console.error('[payments.status]', err.message);
    res.status(500).json({ error: 'Could not fetch payment status.' });
  }
}

/**
 * POST /api/cms/payments/dashboard-link  { siteId }
 * Express login link → the owner's Stripe Express dashboard (payouts, receipts,
 * account details). Only valid once onboarding is complete.
 */
async function dashboardLink(req, res) {
  if (!stripe) return noStripe(res);
  try {
    const { siteId } = req.body || {};
    if (!siteId) return res.status(400).json({ error: 'siteId required' });

    const site = await verifySiteOwnership(req.cmsUser.id, siteId);
    if (!site) return res.status(403).json({ error: 'Not authorized for this site' });

    const { data: acct } = await supabase
      .from('site_payment_accounts').select('stripe_account_id').eq('site_id', siteId).single();
    if (!acct?.stripe_account_id) return res.status(409).json({ error: 'No connected Stripe account yet.' });

    const link = await stripe.accounts.createLoginLink(acct.stripe_account_id);
    res.json({ url: link.url });
  } catch (err) {
    console.error('[payments.dashboardLink]', err.message);
    res.status(500).json({ error: 'Could not open the Stripe dashboard.' });
  }
}

// ─── P12 direct-keys capture ─────────────────────────────────────────────────

/**
 * POST /api/cms/payments/keys  { siteId, publishableKey, secretKey, webhookSecret? }
 * Store the business's OWN Stripe keys (secret encrypted at rest). Best-effort
 * live check distinguishes an INVALID key (reject) from a valid restricted key
 * with limited read scope (accept — its real proof is the first Checkout).
 * Enables payments on the site. Never returns the secret.
 */
async function saveKeys(req, res) {
  if (!credsConfigured()) return res.status(503).json({ error: 'Payment key storage is not configured on the server.' });
  try {
    const { siteId, publishableKey, secretKey, webhookSecret } = req.body || {};
    if (!siteId || !secretKey) return res.status(400).json({ error: 'siteId and secretKey required' });

    const site = await verifySiteOwnership(req.cmsUser.id, siteId);
    if (!site) return res.status(403).json({ error: 'Not authorized for this site' });

    const sk = String(secretKey).trim();
    // Shape check — Stripe secret keys: rk_ (restricted, preferred) or sk_ (standard).
    if (!/^(rk|sk)_(live|test)_/.test(sk)) {
      return res.status(400).json({ error: 'That does not look like a Stripe secret key (expected rk_live_… or sk_live_…).' });
    }
    if (publishableKey && !/^pk_(live|test)_/.test(String(publishableKey).trim())) {
      return res.status(400).json({ error: 'That does not look like a Stripe publishable key (expected pk_live_…).' });
    }
    const keyType = sk.startsWith('rk_') ? 'restricted' : 'standard';
    const livemode = /_(live)_/.test(sk);

    // Best-effort live check.
    let verified = false;
    try {
      const probe = new Stripe(sk);
      await probe.checkout.sessions.list({ limit: 1 });
      verified = true;
    } catch (e) {
      if (e && e.type === 'StripeAuthenticationError') {
        return res.status(400).json({ error: 'Stripe rejected this key. Please double-check you copied the full secret key.' });
      }
      // StripePermissionError etc. → valid key, limited scope. Accept.
    }

    const saved = await saveSiteCredentials({
      siteId, provider: 'stripe',
      publishableKey: publishableKey ? String(publishableKey).trim() : null,
      credentials: { secret_key: sk },
      keyType, status: 'active',
    });
    if (!saved.ok) return res.status(saved.code || 500).json({ error: saved.message || 'Could not save keys.' });

    if (webhookSecret) await setSiteWebhookSecret({ siteId, provider: 'stripe', webhookSecret: String(webhookSecret).trim() });
    if (verified) await supabase.from('site_payment_credentials').update({ last_verified_at: new Date().toISOString() }).eq('site_id', siteId).eq('provider', 'stripe');

    // Turn payments on for the site (booking pages/chat can now take deposits).
    await supabase.from('sites').update({ payments_enabled: true }).eq('id', siteId);

    res.json({ ok: true, keyType, livemode, verified });
  } catch (err) {
    console.error('[payments.saveKeys]', err.message);
    res.status(500).json({ error: 'Could not save payment keys.' });
  }
}

/**
 * GET /api/cms/payments/keys?siteId=…  — NON-secret status only.
 * Returns { configured, provider, publishableKeyMasked, keyType, status,
 * hasWebhookSecret, lastVerifiedAt, livemode }. NEVER decrypts/returns the secret.
 */
async function getKeysStatus(req, res) {
  try {
    const siteId = req.query.siteId;
    if (!siteId) return res.status(400).json({ error: 'siteId required' });
    const site = await verifySiteOwnership(req.cmsUser.id, siteId);
    if (!site) return res.status(403).json({ error: 'Not authorized for this site' });

    const { data } = await supabase.from('site_payment_credentials')
      .select('provider, publishable_key, encrypted_webhook_secret, key_type, status, last_verified_at')
      .eq('site_id', siteId).eq('provider', 'stripe').maybeSingle();
    if (!data) return res.json({ configured: false, payments_enabled: !!site.payments_enabled });

    res.json({
      configured: true,
      provider: data.provider,
      publishableKeyMasked: maskKey(data.publishable_key),
      keyType: data.key_type,
      status: data.status,
      hasWebhookSecret: !!data.encrypted_webhook_secret,
      lastVerifiedAt: data.last_verified_at,
      livemode: data.publishable_key ? /^pk_live_/.test(data.publishable_key) : null,
      payments_enabled: !!site.payments_enabled,
    });
  } catch (err) {
    console.error('[payments.getKeysStatus]', err.message);
    res.status(500).json({ error: 'Could not read payment status.' });
  }
}

/** DELETE /api/cms/payments/keys  { siteId } — disconnect: remove creds + disable payments. */
async function deleteKeys(req, res) {
  try {
    const { siteId } = req.body || {};
    if (!siteId) return res.status(400).json({ error: 'siteId required' });
    const site = await verifySiteOwnership(req.cmsUser.id, siteId);
    if (!site) return res.status(403).json({ error: 'Not authorized for this site' });

    await supabase.from('site_payment_credentials').delete().eq('site_id', siteId).eq('provider', 'stripe');
    await supabase.from('sites').update({ payments_enabled: false }).eq('id', siteId);
    res.json({ ok: true });
  } catch (err) {
    console.error('[payments.deleteKeys]', err.message);
    res.status(500).json({ error: 'Could not disconnect payments.' });
  }
}

// ─── P12 external-booking-URL (Mindbody/Vagaro escape hatch) ──────────────────
// Front Desk chat already deflects to booking_config.booking_url when
// booking_mode='link_out' (lib/frontdeskBooking.js). This lets the owner SET it.

/** GET /api/cms/payments/booking-mode?siteId=… → { mode, bookingUrl } */
async function getBookingMode(req, res) {
  try {
    const siteId = req.query.siteId;
    if (!siteId) return res.status(400).json({ error: 'siteId required' });
    const site = await verifySiteOwnership(req.cmsUser.id, siteId);
    if (!site) return res.status(403).json({ error: 'Not authorized for this site' });
    const { data } = await supabase.from('sites').select('booking_mode, booking_config').eq('id', siteId).single();
    res.json({ mode: data?.booking_mode || 'native', bookingUrl: data?.booking_config?.booking_url || null });
  } catch (err) {
    console.error('[payments.getBookingMode]', err.message);
    res.status(500).json({ error: 'Could not read booking mode.' });
  }
}

/**
 * POST /api/cms/payments/booking-mode  { siteId, mode, bookingUrl? }
 * mode 'native' → Stemfra takes bookings/payments. mode 'link_out' → Book-Now
 * buttons + the Front Desk chat hand off to bookingUrl (their existing Mindbody/
 * Vagaro page); native booking + payments are bypassed.
 */
async function setBookingMode(req, res) {
  try {
    const { siteId, mode, bookingUrl } = req.body || {};
    if (!siteId) return res.status(400).json({ error: 'siteId required' });
    if (!['native', 'link_out'].includes(mode)) return res.status(400).json({ error: "mode must be 'native' or 'link_out'." });
    const site = await verifySiteOwnership(req.cmsUser.id, siteId);
    if (!site) return res.status(403).json({ error: 'Not authorized for this site' });

    if (mode === 'link_out') {
      const url = String(bookingUrl || '').trim();
      if (!/^https:\/\/.+/.test(url)) return res.status(400).json({ error: 'A valid https booking link is required for link-out mode.' });
      const { data: cur } = await supabase.from('sites').select('booking_config').eq('id', siteId).single();
      const booking_config = { ...(cur?.booking_config || {}), booking_url: url };
      await supabase.from('sites').update({ booking_mode: 'link_out', booking_config }).eq('id', siteId);
      return res.json({ ok: true, mode: 'link_out', bookingUrl: url });
    }
    await supabase.from('sites').update({ booking_mode: 'native' }).eq('id', siteId);
    res.json({ ok: true, mode: 'native' });
  } catch (err) {
    console.error('[payments.setBookingMode]', err.message);
    res.status(500).json({ error: 'Could not update booking mode.' });
  }
}

module.exports = {
  healthcheck, connectLink, status, dashboardLink,
  // P12 direct-keys + external-booking-URL:
  saveKeys, getKeysStatus, deleteKeys, getBookingMode, setBookingMode,
};
