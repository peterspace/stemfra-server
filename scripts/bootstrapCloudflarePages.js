#!/usr/bin/env node
// One-time bootstrap: create the 5 Cloudflare Pages projects for the
// stemfra-platform monorepo (4 templates + CMS), bound to the GitHub repo, then
// trigger + poll the first deploy. Re-runnable (existing projects are reused).
//
// Usage:
//   node scripts/bootstrapCloudflarePages.js --all
//   node scripts/bootstrapCloudflarePages.js yoga            # one app
//   node scripts/bootstrapCloudflarePages.js yoga cms        # several
//   node scripts/bootstrapCloudflarePages.js yoga --no-wait  # skip polling
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { createPagesProject, triggerDeployment, getLatestDeployment } = require('../lib/cloudflarePages');
const { isCloudflareConfigured, GH } = require('../config/cloudflare');

// Public anon key + URL live in the sibling platform repo's template .env.local
// (browser-safe; respects RLS). Fall back to process.env if present.
function readPlatformViteEnv() {
  const out = { url: process.env.VITE_SUPABASE_URL, anon: process.env.VITE_SUPABASE_ANON_KEY };
  const p = path.resolve(__dirname, '..', '..', 'stemfra_platform', 'stemfra_templates', 'stemfra_yoga', '.env.local');
  try {
    for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
      const m = line.match(/^\s*(VITE_SUPABASE_URL|VITE_SUPABASE_ANON_KEY)\s*=\s*(.+)\s*$/);
      if (!m) continue;
      const v = m[2].trim().replace(/^["']|["']$/g, '');
      if (m[1] === 'VITE_SUPABASE_URL') out.url = out.url || v;
      else out.anon = out.anon || v;
    }
  } catch { /* fall back to process.env */ }
  return out;
}

const SERVER_URL = 'https://api.stemfra.com';

function buildProjects() {
  const { url, anon } = readPlatformViteEnv();
  if (!url || !anon) throw new Error('Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY (set in the platform .env.local).');
  const viteEnv = { VITE_SUPABASE_URL: url, VITE_SUPABASE_ANON_KEY: anon, VITE_SERVER_URL: SERVER_URL, NODE_VERSION: '22' };
  const tpl = (key, name) => ({
    key, name,
    rootDir: '',
    buildCommand: `npm run build:${key}`,
    destinationDir: `stemfra_templates/stemfra_${key}/dist`,
    envVars: viteEnv,
  });
  return [
    tpl('barbers', 'stemfra-barbers'),
    tpl('salons', 'stemfra-salons'),
    tpl('crossfit', 'stemfra-crossfit'),
    tpl('yoga', 'stemfra-yoga'),
    { key: 'cms', name: 'stemfra-cms', rootDir: '', buildCommand: 'npm run build:cms', destinationDir: 'stemfra_cms/dist', envVars: viteEnv },
  ];
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function pollDeploy(name, deployId, { timeoutMs = 300000, everyMs = 10000 } = {}) {
  const start = Date.now();
  let last = '';
  while (Date.now() - start < timeoutMs) {
    const d = await getLatestDeployment(name);
    const stage = d?.latest_stage;
    const tag = `${stage?.name || '?'}/${stage?.status || '?'}`;
    if (tag !== last) { console.log(`    … ${tag}`); last = tag; }
    if (stage?.name === 'deploy' && stage?.status === 'success') return { ok: true, url: d.url };
    if (stage?.status === 'failure') return { ok: false, url: d?.url, stage: stage?.name };
    await sleep(everyMs);
  }
  return { ok: null, timedOut: true };
}

(async () => {
  if (!isCloudflareConfigured()) {
    console.error('✗ Cloudflare not configured — check CLOUDFLARE_* and GITHUB_*_CLOUDFLARE in .env');
    process.exit(1);
  }
  const args = process.argv.slice(2);
  const noWait = args.includes('--no-wait');
  const all = args.includes('--all');
  const wanted = args.filter((a) => !a.startsWith('--'));
  const projects = buildProjects().filter((p) => all || wanted.includes(p.key));
  if (!projects.length) {
    console.error('Nothing selected. Pass app keys (barbers salons crossfit yoga cms) or --all.');
    process.exit(1);
  }
  console.log(`Repo: ${GH.owner}/${GH.repoName}#${GH.branch} (repo_id ${GH.repoId})`);
  console.log(`Creating ${projects.length} project(s): ${projects.map((p) => p.name).join(', ')}\n`);

  const results = [];
  for (const p of projects) {
    try {
      console.log(`▸ ${p.name}  (build: ${p.buildCommand} → ${p.destinationDir})`);
      const { project, created } = await createPagesProject(p);
      console.log(`  project ${created ? 'created' : 'already existed'} → ${project.subdomain || project.name + '.pages.dev'}`);
      const dep = await triggerDeployment(p.name);
      console.log(`  deployment triggered (${dep.id})`);
      if (noWait) { results.push({ name: p.name, status: 'triggered', url: `https://${project.subdomain}` }); continue; }
      const r = await pollDeploy(p.name, dep.id);
      const status = r.ok ? '✅ success' : r.ok === false ? `❌ failed at ${r.stage}` : '⏳ timed out (still building)';
      console.log(`  ${status}  ${r.url || ''}\n`);
      results.push({ name: p.name, status, url: r.url || `https://${project.subdomain}` });
    } catch (err) {
      console.error(`  ✗ ${p.name} error: ${err.message}\n`);
      results.push({ name: p.name, status: 'error', error: err.message });
    }
  }
  console.log('=== summary ===');
  results.forEach((r) => console.log(`${r.name}: ${r.status}${r.url ? ' · ' + r.url : ''}${r.error ? ' · ' + r.error : ''}`));
})();
