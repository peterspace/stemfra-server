// Claim tokens (launch funnel, 2026-08-19).
//
// Every lead carries `leads.claim_token` (a random UUID, DB default, unique):
// stemfra.com/claim/<uuid> and the unsubscribe link identify the LEAD without
// PII in the URL. Unguessable (122 random bits), one indexed lookup, and short
// enough to read. (An earlier HMAC-signed base64 token was replaced the same
// day: correct but too long in a URL.)
const supabase = require('../config/supabase');

const MARKETING_URL = process.env.MARKETING_URL || 'https://stemfra.com';
const API_URL = process.env.PUBLIC_BASE_URL || 'https://api.stemfra.com';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The lead's claim token (uuid string) or null. */
async function claimTokenFor(leadId) {
  const { data } = await supabase.from('leads').select('claim_token').eq('id', leadId).maybeSingle();
  return data?.claim_token || null;
}

/** Full lead row for a claim token, or null when malformed / unknown. */
async function leadForClaimToken(token) {
  if (!token || !UUID_RE.test(String(token))) return null;
  const { data } = await supabase.from('leads').select('*').eq('claim_token', token).maybeSingle();
  return data || null;
}

const claimUrl = (token) => `${MARKETING_URL}/claim/${token}`;
const unsubscribeUrl = (token) => `${API_URL}/api/claim/unsubscribe/${token}`;
async function claimUrlFor(leadId) { const t = await claimTokenFor(leadId); return t ? claimUrl(t) : null; }
async function unsubscribeUrlFor(leadId) { const t = await claimTokenFor(leadId); return t ? unsubscribeUrl(t) : null; }

module.exports = { claimTokenFor, leadForClaimToken, claimUrl, unsubscribeUrl, claimUrlFor, unsubscribeUrlFor, UUID_RE };
