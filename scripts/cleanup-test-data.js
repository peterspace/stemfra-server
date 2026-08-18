#!/usr/bin/env node
// Clean up test data (launch task #9). DRY RUN by default; --apply performs it.
//   node -r dotenv/config scripts/cleanup-test-data.js            # preview
//   node -r dotenv/config scripts/cleanup-test-data.js --apply    # delete
// Removes: sites with metadata.is_test (their rows, media, host, orphan owner),
// CRM leads.is_test, legal_acceptances on test email domains, smoke-test
// leadgen_runs. Never touches demo/Starter (is_starter) sites or real data.
const { cleanupTestData } = require('../lib/testDataCleanup');
(async () => {
  const apply = process.argv.includes('--apply');
  const out = await cleanupTestData({ apply, actorName: `cli:${process.env.USER || 'local'}` });
  console.log(apply ? 'APPLIED' : 'DRY RUN (add --apply to delete)');
  console.log(`sites: ${out.sites.length}`); for (const s of out.sites) console.log(`  - ${s.subdomain} (${s.status}) ${s.business} <${s.ownerEmail || '-'}>`);
  console.log(`leads: ${out.leads} · legal acceptances: ${out.acceptances} · smoke leadgen runs: ${out.leadgenRuns}`);
  if (apply) console.log(JSON.stringify(out.results, null, 2));
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
