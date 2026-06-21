#!/usr/bin/env node
// Staff/test CLI for the onboarding flow (Phase 2f). Mirrors what the public
// POST /api/onboarding/signup does — creates the account + provisions a
// previewing site. Useful for seeding demo logins + testing without the form.
//
// Usage:
//   node scripts/onboardCustomer.js --company="Demo Fades" --vertical=barbers \
//     --email=demo@stemfra.test --password=stemfra-demo-2026 --name="Demo Owner"
//   node scripts/onboardCustomer.js --offboard=demo@stemfra.test
require('dotenv').config();
const { onboardCustomer, offboardByEmail } = require('../lib/onboardSite');

function parseArgs() {
  const f = {};
  for (const a of process.argv.slice(2)) {
    const m = a.match(/^--([^=]+)(?:=(.*))?$/);
    if (m) f[m[1]] = m[2] === undefined ? true : m[2];
  }
  return f;
}

(async () => {
  const f = parseArgs();

  if (f.offboard) {
    const r = await offboardByEmail(f.offboard);
    console.log(r.removed ? `✓ removed ${f.offboard} (${r.sites} site[s] + company + auth user)` : `nothing found for ${f.offboard}`);
    return;
  }

  if (!f.company || !f.vertical || !f.email || !f.password) {
    console.error('Required: --company= --vertical=<barbers|salons|crossfit|yoga> --email= --password=  (optional --name= --city= --template=)');
    console.error('Cleanup:  --offboard=<email>');
    process.exit(1);
  }

  const r = await onboardCustomer({
    name: f.name, email: f.email, password: f.password,
    company: f.company, vertical: f.vertical, city: f.city || null, templateSlug: f.template || null,
  });
  console.log('\n✅ Onboarded');
  console.log(`  site id:     ${r.site.siteId}`);
  console.log(`  CMS login:   ${f.email}  /  (the password you set)`);
  console.log(`  site:        ${r.site.subdomain}  (${r.site.status})`);
  console.log(`  preview URL: https://${r.site.subdomain}.stemfra.com`);
  console.log(`  template:    ${r.site.template.name}`);
  console.log(`\n  offboard:    node scripts/onboardCustomer.js --offboard=${f.email}`);
})().catch((err) => { console.error(`\n✗ [${err.code || 'error'}] ${err.message}`); process.exit(1); });
