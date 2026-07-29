// P12 Wave 1 — per-tenant payment credentials (direct-keys pivot).
//
// Stores/reads each business's OWN payment-processor keys so charges route
// straight to their bank (no Stripe Connect, no platform in the money path).
// Secrets are AES-256-GCM encrypted here in the app layer; the ciphertext lives
// in `site_payment_credentials`, the key-encryption-key (KEK) lives ONLY in
// server env (PAYMENT_CREDENTIALS_KEK) — never in the DB, never logged.
//
// SECURITY CONTRACT:
//  · Only restricted keys should be accepted at onboarding (Stripe rk_live_…),
//    but we don't reject standard keys — we record key_type for auditing.
//  · Decrypted secrets never leave the server, never get logged, never ship to
//    any client app. getStripeForSite returns a ready client; callers never see
//    the raw key.
//  · KEK missing → encrypt/decrypt throw; getStripeForSite returns null (payments
//    simply unconfigured for that path), matching config/stripe.js's optional-infra
//    posture. The server still boots.
// Single-var supabase require per server convention.
const crypto = require('crypto');
const Stripe = require('stripe');
const supabase = require('../config/supabase');

const ALGO = 'aes-256-gcm';
const BLOB_VERSION = 'v1';

// Resolve the 32-byte KEK from env once. Accepts 64-char hex or base64 (44 chars
// for 32 bytes). Returns a Buffer, or null if unset/invalid (payments-off).
let _kek; // undefined = not resolved yet; null = unavailable
function kek() {
  if (_kek !== undefined) return _kek;
  const raw = (process.env.PAYMENT_CREDENTIALS_KEK || '').trim();
  if (!raw) {
    console.warn('⚠ PAYMENT_CREDENTIALS_KEK not set — tenant Stripe payments (direct keys) are disabled until configured.');
    _kek = null;
    return _kek;
  }
  let buf = null;
  if (/^[0-9a-fA-F]{64}$/.test(raw)) buf = Buffer.from(raw, 'hex');
  else {
    try { const b = Buffer.from(raw, 'base64'); if (b.length === 32) buf = b; } catch { /* fall through */ }
  }
  if (!buf || buf.length !== 32) {
    console.error('⚠ PAYMENT_CREDENTIALS_KEK is set but is not 32 bytes (need 64 hex chars or base64 of 32 bytes) — payments disabled.');
    _kek = null;
    return _kek;
  }
  _kek = buf;
  return _kek;
}

function isConfigured() {
  return kek() !== null;
}

// plaintext string -> 'v1:<iv_b64>:<tag_b64>:<ct_b64>'
function encrypt(plaintext) {
  const key = kek();
  if (!key) throw new Error('payment credentials encryption unavailable (KEK not configured)');
  const iv = crypto.randomBytes(12); // 96-bit nonce, standard for GCM
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const ct = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [BLOB_VERSION, iv.toString('base64'), tag.toString('base64'), ct.toString('base64')].join(':');
}

// 'v1:iv:tag:ct' -> plaintext string. Throws on tamper (GCM auth) or bad KEK.
function decrypt(blob) {
  const key = kek();
  if (!key) throw new Error('payment credentials decryption unavailable (KEK not configured)');
  const parts = String(blob || '').split(':');
  if (parts.length !== 4 || parts[0] !== BLOB_VERSION) throw new Error('malformed credential blob');
  const [, ivB64, tagB64, ctB64] = parts;
  const decipher = crypto.createDecipheriv(ALGO, key, Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(ctB64, 'base64')), decipher.final()]).toString('utf8');
}

// Upsert a site's provider credentials. `credentials` is the provider-specific
// secret bundle ({ secret_key } for stripe; { access_token, location_id } for
// square). publishableKey is non-secret and stored plaintext. Returns { ok }.
async function saveSiteCredentials({ siteId, provider = 'stripe', publishableKey = null, credentials, keyType = 'restricted', status = 'active' }) {
  if (!isConfigured()) return { ok: false, code: 503, message: 'Payment credential encryption is not configured.' };
  if (!siteId || !credentials) return { ok: false, code: 400, message: 'siteId and credentials are required.' };
  const encrypted_credentials = encrypt(JSON.stringify(credentials));
  const { error } = await supabase.from('site_payment_credentials').upsert({
    site_id: siteId,
    provider,
    publishable_key: publishableKey,
    encrypted_credentials,
    key_type: keyType,
    status,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'site_id,provider' });
  if (error) { console.error('[paymentCredentials] save failed:', error.message); return { ok: false, code: 500, message: 'Could not save credentials.' }; }
  return { ok: true };
}

// Store/replace the per-site webhook signing secret (added during onboarding when
// the site's webhook endpoint is registered in their Stripe dashboard).
async function setSiteWebhookSecret({ siteId, provider = 'stripe', webhookSecret }) {
  if (!isConfigured()) return { ok: false, code: 503 };
  if (!siteId || !webhookSecret) return { ok: false, code: 400 };
  const { error } = await supabase.from('site_payment_credentials')
    .update({ encrypted_webhook_secret: encrypt(String(webhookSecret)), updated_at: new Date().toISOString() })
    .eq('site_id', siteId).eq('provider', provider);
  if (error) { console.error('[paymentCredentials] webhook secret save failed:', error.message); return { ok: false, code: 500 }; }
  return { ok: true };
}

// Fetch + decrypt a site's credentials. Returns the decrypted bundle + metadata,
// or null if none / not decryptable. NEVER logs the secret.
async function getSiteCredentials(siteId, provider = 'stripe') {
  if (!isConfigured() || !siteId) return null;
  const { data, error } = await supabase.from('site_payment_credentials')
    .select('publishable_key, encrypted_credentials, encrypted_webhook_secret, key_type, status')
    .eq('site_id', siteId).eq('provider', provider).maybeSingle();
  if (error || !data) return null;
  let credentials = null;
  let webhookSecret = null;
  try { if (data.encrypted_credentials) credentials = JSON.parse(decrypt(data.encrypted_credentials)); }
  catch (e) { console.error('[paymentCredentials] decrypt failed for site', siteId, '-', e.message); return null; }
  try { if (data.encrypted_webhook_secret) webhookSecret = decrypt(data.encrypted_webhook_secret); }
  catch { /* webhook secret optional */ }
  return {
    provider,
    publishableKey: data.publishable_key || null,
    credentials,            // { secret_key } for stripe
    webhookSecret,
    keyType: data.key_type || null,
    status: data.status || null,
  };
}

// The payoff: a ready Stripe client built with THIS site's own secret key, so
// every charge goes to their account. Returns null when the site has no active
// stripe credentials (caller falls back to "payments not set up"). Instantiated
// per call (creds can change); the Stripe SDK constructor is cheap.
async function getStripeForSite(siteId) {
  const creds = await getSiteCredentials(siteId, 'stripe');
  const secret = creds && creds.status === 'active' && creds.credentials && creds.credentials.secret_key;
  if (!secret) return null;
  return new Stripe(secret);
}

module.exports = {
  isConfigured,
  encrypt,
  decrypt,
  saveSiteCredentials,
  setSiteWebhookSecret,
  getSiteCredentials,
  getStripeForSite,
};
