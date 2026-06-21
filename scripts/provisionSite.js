#!/usr/bin/env node
// Staff-run provisioning CLI (Phase 2a). Clones a vertical's seed site into a
// fresh tenant site. The onboarding HTTP endpoint (Phase 2f) will call the same
// lib/provisionSite service after creating the auth user + company + contact;
// this script is for staff onboarding + testing the clone in isolation.
//
// Usage:
//   node scripts/provisionSite.js --vertical=barbers --company="Test Fades NYC" --city="New York"
//   node scripts/provisionSite.js --vertical=yoga --company="Test Flow" --dry-run
//   node scripts/provisionSite.js --vertical=salons --company="X" --template=salons-beauty-house
//   node scripts/provisionSite.js --company-id=<uuid> --owner-contact-id=<uuid> --vertical=crossfit --company="X"
//   node scripts/provisionSite.js --cleanup=<siteId>
//
// Without --company-id/--owner-contact-id the script creates a THROWAWAY test
// company + contact (company name prefixed "TEST · "); --cleanup removes the
// site, its cloned children, and the test owner (only if it's a TEST · company).
require('dotenv').config();
const supabase = require('../config/supabase');
const { provisionSite, deleteSiteCascade } = require('../lib/provisionSite');

const TEST_COMPANY_PREFIX = 'TEST · ';

function parseArgs() {
  const out = { flags: {} };
  for (const a of process.argv.slice(2)) {
    const m = a.match(/^--([^=]+)(?:=(.*))?$/);
    if (m) out.flags[m[1]] = m[2] === undefined ? true : m[2];
  }
  return out.flags;
}

async function createTestOwner(displayName) {
  const { data: co, error: ce } = await supabase
    .from('companies').insert({ name: `${TEST_COMPANY_PREFIX}${displayName}` }).select('id').single();
  if (ce) throw new Error(`create test company: ${ce.message}`);
  const { data: ct, error: te } = await supabase
    .from('contacts')
    .insert({ full_name: `${displayName} Owner`, email: `test+${Date.now()}@stemfra.test`, company_id: co.id })
    .select('id').single();
  if (te) throw new Error(`create test contact: ${te.message}`);
  return { companyId: co.id, contactId: ct.id };
}

// Verify the clone landed: child counts on the new site match the reported
// source counts.
async function verifyCounts(siteId, expected) {
  const tables = {
    pages: 'site_pages', sections: 'site_sections', categories: 'site_service_categories',
    services: 'site_services', team: 'site_team_members', links: 'site_team_service_links',
    availability: 'site_availability_rules', testimonials: 'site_testimonials',
  };
  const rows = [];
  let ok = true;
  for (const [key, table] of Object.entries(tables)) {
    const { count, error } = await supabase.from(table).select('id', { count: 'exact', head: true }).eq('site_id', siteId);
    if (error) throw new Error(`verify ${table}: ${error.message}`);
    const exp = expected[key];
    const match = count === exp;
    if (!match) ok = false;
    rows.push(`  ${match ? '✓' : '✗'} ${key.padEnd(13)} ${String(count).padStart(3)} (seed ${exp})`);
  }
  console.log(rows.join('\n'));
  return ok;
}

async function runCleanup(siteId) {
  const { data: s, error } = await supabase
    .from('sites').select('company_id, owner_contact_id, subdomain').eq('id', siteId).single();
  if (error || !s) { console.error(`site ${siteId} not found`); process.exit(1); }
  await deleteSiteCascade(siteId);
  console.log(`✓ deleted site ${siteId} (${s.subdomain}) + cloned children`);
  // Remove the throwaway owner only if it's clearly a test company.
  const { data: co } = await supabase.from('companies').select('name').eq('id', s.company_id).single();
  if (co && co.name.startsWith(TEST_COMPANY_PREFIX)) {
    await supabase.from('contacts').delete().eq('id', s.owner_contact_id);
    await supabase.from('companies').delete().eq('id', s.company_id);
    console.log(`✓ deleted test owner (${co.name})`);
  }
}

(async () => {
  const f = parseArgs();

  if (f.cleanup) {
    await runCleanup(f.cleanup);
    return;
  }

  const vertical = f.vertical;
  const displayName = f.company;
  if (!vertical || !displayName) {
    console.error('Required: --vertical=<barbers|salons|crossfit|yoga> --company="Business Name"');
    console.error('Optional: --city="…" --template=<slug> --company-id=<uuid> --owner-contact-id=<uuid> --dry-run --keep');
    console.error('Cleanup:  --cleanup=<siteId>');
    process.exit(1);
  }

  if (f['dry-run']) {
    const res = await provisionSite({ vertical, displayName, city: f.city || null, templateSlug: f.template || null, dryRun: true });
    console.log('DRY RUN — would provision:');
    console.log(`  vertical:   ${res.vertical}`);
    console.log(`  seed source:${res.seedSourceId}`);
    console.log(`  subdomain:  ${res.subdomain}.stemfra.com`);
    console.log(`  template:   ${res.template.name} (${res.template.slug})`);
    return;
  }

  // Owner: use provided ids, else create a throwaway test owner.
  let companyId = f['company-id'];
  let ownerContactId = f['owner-contact-id'];
  let createdTestOwner = false;
  if (!companyId || !ownerContactId) {
    const owner = await createTestOwner(displayName);
    companyId = owner.companyId;
    ownerContactId = owner.contactId;
    createdTestOwner = true;
    console.log(`Created throwaway owner — company ${companyId}, contact ${ownerContactId}`);
  }

  const res = await provisionSite({
    vertical, displayName, companyId, ownerContactId,
    city: f.city || null, templateSlug: f.template || null,
  });

  console.log('\n✅ Provisioned');
  console.log(`  site id:   ${res.siteId}`);
  console.log(`  subdomain: ${res.subdomain}.stemfra.com`);
  console.log(`  status:    ${res.status}`);
  console.log(`  template:  ${res.template.name} (${res.template.slug})`);
  console.log('  cloned:');
  const ok = await verifyCounts(res.siteId, res.counts);
  console.log(ok ? '\n✓ all child counts match the seed' : '\n✗ COUNT MISMATCH — inspect before relying on this site');

  if (createdTestOwner && !f.keep) {
    console.log(`\nTest site left in place for inspection. Remove with:\n  node scripts/provisionSite.js --cleanup=${res.siteId}`);
  }
})().catch((err) => {
  console.error(`\n✗ ${err.message}`);
  process.exit(1);
});
