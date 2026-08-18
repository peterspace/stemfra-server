// "Clean up test data" (launch task #9). ONE implementation behind both the
// CLI (scripts/cleanup-test-data.js) and the staff endpoint
// (POST /api/admin/test-data/cleanup). DRY RUN by default: returns exactly what
// WOULD be removed; `apply:true` performs it.
//
// Scope (deliberately narrow, never touches demo/Starter sites or real data):
//   - sites with metadata.is_test === true (+ their child rows, media, host,
//     and the owner contact / company / auth user when nothing else uses them)
//   - CRM leads with is_test = true
//   - legal_acceptances rows for test email domains (test signups)
//   - leadgen_runs whose notes start with "smoke test"
const supabase = require('../config/supabase');
const { hardPurgeSite } = require('./siteDeletion');
const { detachSiteDomain } = require('./attachSiteDomain');
const { TEST_EMAIL_DOMAINS, isTestSite } = require('./testData');

async function plan() {
  const { data: sites } = await supabase
    .from('sites')
    .select('id, subdomain, status, metadata, owner_contact_id, company_id, custom_domain, vertical:verticals(slug), company:companies(name), owner:contacts!owner_contact_id(id, email, auth_user_id)')
    .is('deleted_at', null);
  const testSites = (sites || []).filter(isTestSite);
  const { data: leads } = await supabase.from('leads').select('id, company_name, email, source, created_at').eq('is_test', true);
  const emailFilter = TEST_EMAIL_DOMAINS.map((d) => `email.ilike.%@${d}`).join(',');
  const { data: acceptances } = await supabase.from('legal_acceptances').select('id, email, document, accepted_at').or(emailFilter);
  const { data: runs } = await supabase.from('leadgen_runs').select('id, city, state_code, notes').ilike('notes', 'smoke test%');
  return {
    sites: testSites.map((s) => ({ id: s.id, subdomain: s.subdomain, status: s.status, business: s.company?.name || s.subdomain, vertical: s.vertical?.slug || null, ownerEmail: s.owner?.email || null, customDomain: s.custom_domain })),
    leads: leads || [],
    acceptances: acceptances || [],
    leadgenRuns: runs || [],
    _sites: testSites,
  };
}

async function cleanupTestData({ apply = false, actorName = 'system' } = {}) {
  const p = await plan();
  const summary = { dryRun: !apply, sites: p.sites, leads: p.leads.length, acceptances: p.acceptances.length, leadgenRuns: p.leadgenRuns.length, results: [] };
  if (!apply) return summary;

  for (const s of p._sites) {
    const r = { siteId: s.id, subdomain: s.subdomain, steps: {} };
    try { await detachSiteDomain(s.id); r.steps.detach = 'ok'; } catch (e) { r.steps.detach = e.message; }
    try { const out = await hardPurgeSite(s.id); r.steps.purge = 'ok'; r.steps.companyDeleted = !!out?.companyDeleted; } catch (e) { r.steps.purge = e.message; }
    // Owner contact + auth user: only when they own no other site.
    if (s.owner?.id) {
      const { count } = await supabase.from('sites').select('id', { count: 'exact', head: true }).eq('owner_contact_id', s.owner.id);
      if (!count) {
        try { await supabase.from('contacts').delete().eq('id', s.owner.id); r.steps.contact = 'deleted'; } catch (e) { r.steps.contact = e.message; }
        if (s.owner.auth_user_id) { try { await supabase.auth.admin.deleteUser(s.owner.auth_user_id); r.steps.authUser = 'deleted'; } catch (e) { r.steps.authUser = e.message; } }
      } else r.steps.contact = `kept (owns ${count} other site(s))`;
    }
    summary.results.push(r);
  }
  if (p.leads.length) { const { error } = await supabase.from('leads').delete().in('id', p.leads.map((l) => l.id)); summary.results.push({ leads: error ? error.message : `deleted ${p.leads.length}` }); }
  if (p.acceptances.length) { const { error } = await supabase.from('legal_acceptances').delete().in('id', p.acceptances.map((a) => a.id)); summary.results.push({ acceptances: error ? error.message : `deleted ${p.acceptances.length}` }); }
  if (p.leadgenRuns.length) { const { error } = await supabase.from('leadgen_runs').delete().in('id', p.leadgenRuns.map((r) => r.id)); summary.results.push({ leadgenRuns: error ? error.message : `deleted ${p.leadgenRuns.length}` }); }
  console.log(`[test-data] cleanup applied by ${actorName}:`, JSON.stringify({ sites: p.sites.length, leads: p.leads.length, acceptances: p.acceptances.length, runs: p.leadgenRuns.length }));
  return summary;
}

module.exports = { cleanupTestData };
