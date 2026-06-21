#!/usr/bin/env node
// Staff CLI + test harness for the publish flow (Phase 2c/2d). Calls the libs
// directly (no CMS auth). The owner-facing path is /api/cms/site-publish/*.
//
// Usage:
//   node scripts/publishSite.js --site=<id> --readiness
//   node scripts/publishSite.js --site=<id> --publish [--skip-billing]
//   node scripts/publishSite.js --site=<id> --unpublish
require('dotenv').config();
const { evaluateCompleteness } = require('../lib/siteCompleteness');
const { publishSite, unpublishSite, getBillingStatus } = require('../lib/sitePublish');

function parseArgs() {
  const f = {};
  for (const a of process.argv.slice(2)) {
    const m = a.match(/^--([^=]+)(?:=(.*))?$/);
    if (m) f[m[1]] = m[2] === undefined ? true : m[2];
  }
  return f;
}

const fmt = (items) => items.map((i) => `    ${i.ok ? '✓' : '✗'} ${i.label}${i.ok ? '' : ` — ${i.hint}`}`).join('\n');

(async () => {
  const f = parseArgs();
  if (!f.site) { console.error('Required: --site=<id> with --readiness | --publish | --unpublish'); process.exit(1); }

  if (f.readiness) {
    const c = await evaluateCompleteness(f.site);
    const billing = await getBillingStatus(f.site);
    console.log(`Status: ${c.status}   Ready: ${c.ready ? 'YES' : 'no'}   Billing: ${billing.status || 'none'}${billing.active ? ' (active)' : ''}`);
    console.log('  Required:'); console.log(fmt(c.required));
    console.log('  Recommended:'); console.log(fmt(c.recommended));
    return;
  }

  if (f.publish) {
    try {
      const r = await publishSite(f.site, { skipBilling: !!f['skip-billing'] });
      console.log(`✅ ${r.alreadyLive ? 'already live' : 'published → live'}  (${r.subdomain ? r.subdomain + '.stemfra.com' : f.site})`);
      if (r.domain?.error) console.log(`  ⚠ domain attach: ${r.domain.error}`);
    } catch (err) {
      console.log(`✗ blocked [${err.code || 'error'}]: ${err.message}`);
      if (err.code === 'not_ready') console.log(fmt(err.completeness.required.filter((i) => !i.ok)));
    }
    return;
  }

  if (f.unpublish) {
    const r = await unpublishSite(f.site);
    console.log(`✓ ${r.already ? 'already previewing' : 'unpublished → previewing'}`);
    return;
  }

  console.error('Pick one: --readiness | --publish | --unpublish');
  process.exit(1);
})().catch((err) => { console.error(`\n✗ ${err.message}`); process.exit(1); });
