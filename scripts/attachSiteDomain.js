#!/usr/bin/env node
// Staff CLI to attach/detach a site's host(s) to its vertical's Pages project
// (Phase 2b). The onboarding flow (2f) and the CMS publish path (2d) call the
// lib/attachSiteDomain service; this is for staff + verification.
//
// Usage:
//   node scripts/attachSiteDomain.js --site=<siteId>            # attach
//   node scripts/attachSiteDomain.js --site=<siteId> --dry-run
//   node scripts/attachSiteDomain.js --site=<siteId> --detach
require('dotenv').config();
const { isCloudflareConfigured } = require('../config/cloudflare');
const { attachSiteDomain, detachSiteDomain } = require('../lib/attachSiteDomain');

function parseArgs() {
  const f = {};
  for (const a of process.argv.slice(2)) {
    const m = a.match(/^--([^=]+)(?:=(.*))?$/);
    if (m) f[m[1]] = m[2] === undefined ? true : m[2];
  }
  return f;
}

(async () => {
  if (!isCloudflareConfigured()) {
    console.error('✗ Cloudflare not configured — check CLOUDFLARE_* / GITHUB_*_CLOUDFLARE in .env');
    process.exit(1);
  }
  const f = parseArgs();
  if (!f.site) {
    console.error('Required: --site=<siteId>   (optional: --detach, --dry-run)');
    process.exit(1);
  }

  if (f.detach) {
    const r = await detachSiteDomain(f.site);
    console.log(`✓ detached ${r.fqdn} from ${r.project}`);
    return;
  }

  if (f['dry-run']) {
    const r = await attachSiteDomain(f.site, { dryRun: true });
    console.log('DRY RUN — would attach:');
    console.log(`  project:       ${r.project}`);
    console.log(`  host:          ${r.fqdn}  →  ${r.target}`);
    if (r.customDomain) console.log(`  custom domain: ${r.customDomain}`);
    return;
  }

  console.log(`Attaching site ${f.site} …`);
  const r = await attachSiteDomain(f.site);
  console.log('\n✅ Attached');
  console.log(`  project:       ${r.project}`);
  console.log(`  host:          ${r.fqdn}  →  ${r.target}`);
  console.log(`  attach:        ${r.attach}`);
  console.log(`  cname:         ${r.cname}`);
  console.log(`  domain status: ${r.domainStatus || '(still provisioning)'}`);
  if (r.customDomain) console.log(`  custom domain: ${r.customDomain} → ${r.customDomainStatus}`);
})().catch((err) => {
  console.error(`\n✗ ${err.message}`);
  process.exit(1);
});
