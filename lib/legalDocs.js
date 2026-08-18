// Legal documents registry + acceptance ledger (launch task #5, 2026-08-18).
//
// ONE source of truth for which legal documents exist, their CURRENT version
// (= the "Last updated" date printed on the marketing page), and where they
// live. Consumed by:
//   - onboarding (public signup): the client only sends the tick; the SERVER
//     stamps accepted_at + these versions into `legal_acceptances`
//     (never trust the client for the time or version of a legal record);
//   - GET /api/public-config → `legal` (the CMS/marketing signup forms render
//     the links + versions from here, so copy and record can't drift);
//   - the CRM (staff read policy) to answer "did this owner accept, when, what".
//
// ⚠ When a marketing legal page changes materially, bump its version here AND
// its "Last updated" line in stemfra_client/src/app/pages/<Doc>.jsx together.
const supabase = require('../config/supabase');

const MARKETING_URL = process.env.MARKETING_URL || 'https://stemfra.com';

const LEGAL_DOCS = {
  terms:   { label: 'Terms of Service',        version: '2026-08-18', url: `${MARKETING_URL}/terms/` },
  privacy: { label: 'Privacy Policy',          version: '2026-08-18', url: `${MARKETING_URL}/privacy/` },
  fees:    { label: 'Fees & Payments Policy',  version: '2026-08-18', url: `${MARKETING_URL}/fees/` },
  refund:  { label: 'Refund Policy',           version: '2026-08-18', url: `${MARKETING_URL}/refund/` },
  sms:     { label: 'SMS consent',             version: '2026-07-29', url: `${MARKETING_URL}/sms-consent/` },
};

/** The documents a new owner must accept at signup (one tick covers all three). */
const SIGNUP_DOCS = ['terms', 'privacy', 'fees'];

/**
 * Record acceptance rows for `docs` (default: the signup set). Best-effort:
 * a ledger failure must never fail the signup that already created the
 * account, but it is logged loudly (this is a legal record).
 */
async function recordLegalAcceptance({
  contactId = null, authUserId = null, email = null, siteId = null,
  docs = SIGNUP_DOCS, source = 'signup', ip = null, userAgent = null, metadata = {},
}) {
  const now = new Date().toISOString();
  const rows = docs.filter((d) => LEGAL_DOCS[d]).map((d) => ({
    contact_id: contactId, auth_user_id: authUserId, email: email ? String(email).toLowerCase() : null,
    site_id: siteId, document: d, version: LEGAL_DOCS[d].version, accepted_at: now,
    source, ip: ip || null, user_agent: userAgent ? String(userAgent).slice(0, 500) : null, metadata,
  }));
  if (!rows.length) return { ok: true, count: 0 };
  const { error } = await supabase.from('legal_acceptances').insert(rows);
  if (error) {
    console.error('[legalDocs] acceptance insert FAILED', { email, source, error: error.message });
    return { ok: false, error: error.message };
  }
  return { ok: true, count: rows.length, versions: Object.fromEntries(docs.map((d) => [d, LEGAL_DOCS[d].version])) };
}

module.exports = { LEGAL_DOCS, SIGNUP_DOCS, recordLegalAcceptance };
