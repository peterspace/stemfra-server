// Test / demo data isolation (launch task #9, 2026-08-18).
//
// ONE honest predicate for "this site is not a real customer", honored by every
// money- or metrics-bearing consumer (commission meter, auto-collect sweeper,
// membership renewals, compliance/books rollups, CRM billing rehearsal, site
// monitor, admin site lists) instead of each one re-deriving `is_starter`:
//
//   kind = 'test'  when sites.metadata.is_test === true   (dress rehearsals, QA)
//        = 'demo'  when sites.metadata.is_starter === true (the public Starter /
//                  demo fleet: sample sites people preview and clone)
//        = 'real'  otherwise
//
// `is_starter` keeps its OTHER meaning (public catalog + clone whitelist,
// lib/starters.js); this module only reads it. Test sites are flagged by
// staff (CRM → Customer Sites → Mark as test), by signup when the owner email
// is on a test domain (TEST_EMAIL_DOMAINS), or by scripts. Cleanup lives in
// scripts/cleanup-test-data.js (+ POST /api/admin/test-data/cleanup).
const supabase = require('../config/supabase');

// Owner-email domains whose signups are automatically test tenants.
const TEST_EMAIL_DOMAINS = (process.env.TEST_EMAIL_DOMAINS || 'stemfra.com,example.com,example.org,test.invalid')
  .split(',').map((d) => d.trim().toLowerCase()).filter(Boolean);

// Specific addresses that are ALWAYS test tenants (Peter's end-to-end test
// personas on consumer domains), comma-separated in TEST_EMAILS.
const TEST_EMAILS = new Set((process.env.TEST_EMAILS || 'englishwithpeter@gmail.com').split(',').map((e) => e.trim().toLowerCase()).filter(Boolean));
function isTestEmail(email) {
  const e = String(email || '').toLowerCase();
  if (TEST_EMAILS.has(e)) return true;
  const dom = e.split('@')[1] || '';
  return !!dom && TEST_EMAIL_DOMAINS.some((d) => dom === d || dom.endsWith(`.${d}`));
}

/** 'test' | 'demo' | 'real' from a site row that carries `metadata`. */
function siteKind(site) {
  const m = site?.metadata || {};
  if (m.is_test === true) return 'test';
  if (m.is_starter === true) return 'demo';
  return 'real';
}
/** True for demo AND test sites: exclude from revenue, invoices, alerts, KPIs. */
function isNonProductionSite(site) { return siteKind(site) !== 'real'; }
function isTestSite(site) { return siteKind(site) === 'test'; }

/** Ids of every non-deleted site that is demo or test (for `.not.in` filters). */
async function nonProductionSiteIds() {
  const { data } = await supabase.from('sites').select('id, metadata').is('deleted_at', null);
  return (data || []).filter(isNonProductionSite).map((s) => s.id);
}

/** Flip a site's test flag (staff). Never touches is_starter. */
async function setSiteTestFlag(siteId, isTest) {
  const { data: cur, error } = await supabase.from('sites').select('metadata').eq('id', siteId).single();
  if (error) throw new Error(error.message);
  const metadata = { ...(cur?.metadata || {}) };
  if (isTest) metadata.is_test = true; else delete metadata.is_test;
  const { error: e2 } = await supabase.from('sites').update({ metadata }).eq('id', siteId);
  if (e2) throw new Error(e2.message);
  return metadata;
}

module.exports = { TEST_EMAIL_DOMAINS, TEST_EMAILS, isTestEmail, siteKind, isNonProductionSite, isTestSite, nonProductionSiteIds, setSiteTestFlag };
