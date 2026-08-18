// Signed, stateless "claim" tokens (launch funnel, 2026-08-19).
//
// A prospect's personalized page (stemfra.com/claim/<token>) and unsubscribe
// link identify the LEAD without any PII in the URL: token = base64url(leadId)
// + "." + HMAC-SHA256(leadId) truncated. Stateless: any lead can be addressed
// at any time; tampering fails verification. Secret: CLAIM_TOKEN_SECRET, else
// N8N_WEBHOOK_SECRET (already in deploy.yml), else the Supabase secret (last
// resort so production never silently produces unverifiable links).
const crypto = require('crypto');

const SECRET = process.env.CLAIM_TOKEN_SECRET || process.env.N8N_WEBHOOK_SECRET || process.env.SUPABASE_SECRET_KEY || 'dev-claim-secret';
const MARKETING_URL = process.env.MARKETING_URL || 'https://stemfra.com';
const API_URL = process.env.PUBLIC_BASE_URL || 'https://api.stemfra.com';

const b64u = (s) => Buffer.from(s).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
const unb64u = (s) => Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
const sig = (leadId) => crypto.createHmac('sha256', SECRET).update(String(leadId)).digest('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_').slice(0, 22);

function signClaimToken(leadId) { return `${b64u(String(leadId))}.${sig(leadId)}`; }

/** → leadId (uuid string) or null when the token is malformed / tampered. */
function verifyClaimToken(token) {
  if (!token || typeof token !== 'string' || !token.includes('.')) return null;
  const [idPart, s] = token.split('.');
  let leadId;
  try { leadId = unb64u(idPart); } catch { return null; }
  if (!/^[0-9a-f-]{36}$/i.test(leadId)) return null;
  const expected = sig(leadId);
  if (expected.length !== s.length) return null;
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(s)) ? leadId : null;
}

const claimUrlFor = (leadId) => `${MARKETING_URL}/claim/${signClaimToken(leadId)}`;
const unsubscribeUrlFor = (leadId) => `${API_URL}/api/claim/unsubscribe/${signClaimToken(leadId)}`;

module.exports = { signClaimToken, verifyClaimToken, claimUrlFor, unsubscribeUrlFor };
