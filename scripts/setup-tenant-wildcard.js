#!/usr/bin/env node
// One-time Cloudflare setup for the *.stemfra.com tenant-router Worker
// (stemfra_platform/workers/tenant-router). Idempotent. DRY-RUN by default —
// pass --apply to make changes.
//
//   node -r dotenv/config scripts/setup-tenant-wildcard.js            # plan only
//   node -r dotenv/config scripts/setup-tenant-wildcard.js --apply    # do it
//
// What it does on the stemfra.com zone (CLOUDFLARE_ZONE_ID):
//   1. Upserts the WILDCARD record `*.stemfra.com` → A 192.0.2.1, PROXIED. The
//      target is a documentation-only IP (TEST-NET-1) that never answers; with
//      the orange cloud on, requests for any not-otherwise-defined subdomain
//      reach Cloudflare's edge, where the Worker route below handles them.
//      Existing specific records (api/cms/crm/www/tenant CNAMEs) keep winning
//      at the DNS layer, untouched.
//   2. Creates NO-WORKER BYPASS routes for every non-tenant host on the zone
//      (api/cms/crm/www/mail/... + anything unrelated like blazeride), so the
//      `*.stemfra.com/*` Worker route never intercepts infra traffic. Infra
//      hosts = every proxied A/CNAME on the zone whose first label is NOT a
//      known site subdomain (live/previewing sites in the DB) — self-deriving,
//      so a new infra host just needs a rerun. The Worker's in-code PASSTHROUGH
//      set is the backstop for the same hosts.
//
// It does NOT deploy the Worker (that is `npm run deploy` in the worker dir with
// a Workers-scoped token) and does NOT create the Worker's own route — wrangler
// does that from wrangler.toml on deploy.
//
// Token scopes needed: Zone:DNS:Edit (existing) + Zone:Workers Routes:Edit
// (new — add on the dashboard token if the routes step 403s).
require('dotenv').config();
const supabase = require('../config/supabase');
const { upsertDnsRecord, listDnsRecords, resolveZoneId } = require('../lib/cloudflareDns');

const CF_API = 'https://api.cloudflare.com/client/v4';
const ZONE = 'stemfra.com';
const APPLY = process.argv.includes('--apply');

async function cf(path, { method = 'GET', body } = {}) {
  const res = await fetch(`${CF_API}${path}`, {
    method,
    headers: { Authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.success === false) {
    const msg = (json.errors || []).map((e) => `${e.code}: ${e.message}`).join('; ') || res.statusText;
    throw new Error(`${method} ${path} → ${res.status} ${msg}`);
  }
  return json.result;
}

(async () => {
  const zoneId = await resolveZoneId({ zoneName: ZONE });
  console.log(`zone ${ZONE} = ${zoneId}   mode: ${APPLY ? 'APPLY' : 'DRY-RUN (pass --apply)'}\n`);

  // ── 1. wildcard record ─────────────────────────────────────────────────────
  const recs = await listDnsRecords({ zoneId });
  const wildcard = recs.find((r) => r.name === `*.${ZONE}`);
  if (wildcard) console.log(`1. wildcard *.${ZONE} exists (${wildcard.type} → ${wildcard.content}, proxied=${wildcard.proxied}) — leaving as is`);
  else if (APPLY) {
    await upsertDnsRecord({ zoneId, type: 'A', name: `*.${ZONE}`, content: '192.0.2.1', proxied: true, comment: 'tenant-router wildcard (Worker route serves it)' });
    console.log(`1. created *.${ZONE} → A 192.0.2.1 proxied`);
  } else console.log(`1. would create *.${ZONE} → A 192.0.2.1 proxied`);

  // ── 2. bypass routes for non-tenant hosts ──────────────────────────────────
  const { data: sites, error } = await supabase.from('sites').select('subdomain');
  if (error) throw error;
  const tenantSubs = new Set((sites || []).map((s) => s.subdomain));
  const infraHosts = [...new Set(
    recs
      .filter((r) => (r.type === 'A' || r.type === 'AAAA' || r.type === 'CNAME') && r.proxied)
      .map((r) => r.name)
      .filter((n) => n !== ZONE && n !== `*.${ZONE}` && n.endsWith(`.${ZONE}`))
      .filter((n) => !tenantSubs.has(n.slice(0, -(ZONE.length + 1))))
  )].sort();
  console.log(`\n2. non-tenant hosts needing a bypass route (${infraHosts.length}): ${infraHosts.join(', ')}`);

  const existingRoutes = await cf(`/zones/${zoneId}/workers/routes`).catch((e) => { console.warn(`   (could not list routes: ${e.message})`); return null; });
  const havePattern = new Set((existingRoutes || []).map((r) => r.pattern));
  for (const host of infraHosts) {
    const pattern = `${host}/*`;
    if (havePattern.has(pattern)) { console.log(`   ✓ ${pattern} route exists`); continue; }
    if (APPLY) {
      // A route with NO script = "do not run any Worker for this pattern"; more
      // specific than *.stemfra.com/* so it wins.
      await cf(`/zones/${zoneId}/workers/routes`, { method: 'POST', body: { pattern, script: null } });
      console.log(`   + created bypass route ${pattern}`);
    } else console.log(`   would create bypass route ${pattern}`);
  }

  console.log(`\nDone. Next: deploy the Worker (workers/tenant-router: npm run deploy) — wrangler adds the *.${ZONE}/* route — then set TENANT_WILDCARD_ROUTING=true on the server.`);
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
