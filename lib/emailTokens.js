// Signed, stateless unsubscribe tokens (N2). No DB column — the token is the
// customer id + an HMAC over it, so it can't be forged or enumerated but needs
// no storage. Used in the footer of customer-facing emails (reminders + future
// lifecycle/marketing) to let a customer opt out with one click.
const crypto = require('crypto');

const SECRET = process.env.EMAIL_TOKEN_SECRET || process.env.SUPABASE_SECRET_KEY || 'stemfra-dev-email-secret';

function sign(id) {
  return crypto.createHmac('sha256', SECRET).update(String(id)).digest('base64url').slice(0, 24);
}

// token = "<customerId>.<sig>"
function unsubscribeToken(customerId) {
  return `${customerId}.${sign(customerId)}`;
}

// Returns the customer id if the token is valid, else null.
function verifyUnsubscribeToken(token) {
  const s = String(token || '');
  const dot = s.lastIndexOf('.');
  if (dot < 1) return null;
  const id = s.slice(0, dot);
  const sig = s.slice(dot + 1);
  const expected = sign(id);
  if (sig.length !== expected.length) return null;
  try {
    return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected)) ? id : null;
  } catch {
    return null;
  }
}

// Full public unsubscribe URL for a customer (or null if base URL unknown).
function unsubscribeUrl(customerId) {
  if (!customerId) return null;
  const base = process.env.PUBLIC_BASE_URL || 'https://api.stemfra.com';
  return `${base}/api/site-emails/unsubscribe?token=${encodeURIComponent(unsubscribeToken(customerId))}`;
}

module.exports = { unsubscribeToken, verifyUnsubscribeToken, unsubscribeUrl };
