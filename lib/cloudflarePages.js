// Cloudflare Pages API helpers — create a Pages project bound to the
// stemfra-platform monorepo, trigger/poll deployments, and (Phase 2) attach a
// custom subdomain. All projects come from the ONE repo with a per-project
// root_dir + build command; they differ only by injected VITE_* env vars.
const axios = require('axios');
const { GH, PAGES_BASE, DNS_BASE, cfHeaders, isCloudflareConfigured } = require('../config/cloudflare');

const TIMEOUT = 30000;

function ensureConfigured() {
  if (!isCloudflareConfigured()) {
    throw new Error('Cloudflare not configured (CLOUDFLARE_* / GITHUB_*_CLOUDFLARE env vars).');
  }
}

// Create (or return existing) a Pages project for one monorepo sub-app.
async function createPagesProject({ name, rootDir = '', buildCommand, destinationDir, envVars = {} }) {
  ensureConfigured();
  const env_vars = Object.fromEntries(
    Object.entries(envVars).map(([k, v]) => [k, { value: String(v) }]),
  );
  const payload = {
    name,
    production_branch: GH.branch,
    source: {
      type: 'github',
      config: {
        owner: GH.owner,
        owner_id: GH.ownerId,
        repo_name: GH.repoName,
        repo_id: GH.repoId,
        production_branch: GH.branch,
        pr_comments_enabled: true,
        deployments_enabled: true,
        production_deployments_enabled: true,
        preview_deployment_setting: 'all',
        preview_branch_includes: ['*'],
        preview_branch_excludes: [],
        path_includes: ['*'],
        path_excludes: [],
      },
    },
    build_config: {
      build_command: buildCommand,
      destination_dir: destinationDir,
      root_dir: rootDir,
      web_analytics_tag: null,
      web_analytics_token: null,
    },
    deployment_configs: {
      production: { env_vars },
      preview: { env_vars },
    },
  };
  try {
    const { data } = await axios.post(PAGES_BASE, payload, { headers: cfHeaders, timeout: TIMEOUT });
    if (!data.success) throw new Error(JSON.stringify(data.errors));
    return { project: data.result, created: true };
  } catch (err) {
    const errs = err.response?.data?.errors || [];
    // 8000007 = project name already exists → return the existing one.
    if (errs.some((e) => e.code === 8000007) || /already exists/i.test(JSON.stringify(errs))) {
      const existing = await getProject(name);
      if (existing) return { project: existing, created: false };
    }
    throw new Error(err.response ? JSON.stringify(err.response.data) : err.message);
  }
}

async function getProject(name) {
  ensureConfigured();
  try {
    const { data } = await axios.get(`${PAGES_BASE}/${name}`, { headers: cfHeaders, timeout: TIMEOUT });
    return data.result;
  } catch (err) {
    if (err.response?.status === 404) return null;
    throw err;
  }
}

async function triggerDeployment(name) {
  ensureConfigured();
  const { data } = await axios.post(`${PAGES_BASE}/${name}/deployments`, {}, { headers: cfHeaders, timeout: TIMEOUT });
  if (!data.success) throw new Error(JSON.stringify(data.errors));
  return data.result;
}

async function getLatestDeployment(name) {
  ensureConfigured();
  const { data } = await axios.get(`${PAGES_BASE}/${name}/deployments?per_page=1`, { headers: cfHeaders, timeout: TIMEOUT });
  return data.result?.[0] || null;
}

// ─── Phase 2: per-customer custom subdomain ───────────────────────────────────
// Attach {fqdn} (e.g. argyle-and-sons.stemfra.com) to a Pages project.
// Idempotent: an already-attached domain (8000049 / "already exists") is a no-op.
async function attachCustomDomain(projectName, fqdn) {
  ensureConfigured();
  try {
    const { data } = await axios.post(`${PAGES_BASE}/${projectName}/domains`, { name: fqdn }, { headers: cfHeaders, timeout: TIMEOUT });
    return data;
  } catch (err) {
    if (/already (exists|in use)/i.test(JSON.stringify(err.response?.data?.errors || ''))) {
      return { success: true, already: true };
    }
    throw new Error(err.response ? JSON.stringify(err.response.data) : err.message);
  }
}

// Custom-domain status on a project (status: pending | active | … + SSL state).
async function getCustomDomain(projectName, fqdn) {
  ensureConfigured();
  try {
    const { data } = await axios.get(`${PAGES_BASE}/${projectName}/domains/${fqdn}`, { headers: cfHeaders, timeout: TIMEOUT });
    return data.result;
  } catch (err) {
    if (err.response?.status === 404) return null;
    throw err;
  }
}

// Detach {fqdn} from a Pages project. Idempotent (404 → already gone).
async function removeCustomDomain(projectName, fqdn) {
  ensureConfigured();
  try {
    const { data } = await axios.delete(`${PAGES_BASE}/${projectName}/domains/${fqdn}`, { headers: cfHeaders, timeout: TIMEOUT });
    return data;
  } catch (err) {
    if (err.response?.status === 404) return { success: true, already: true };
    throw new Error(err.response ? JSON.stringify(err.response.data) : err.message);
  }
}

// Add a proxied CNAME in the zone: {subdomain} → {project}.pages.dev.
// Idempotent: an existing record (81053/81057 "already exists") is a no-op.
async function addCnameRecord(subdomain, target) {
  ensureConfigured();
  try {
    const { data } = await axios.post(
      DNS_BASE,
      { type: 'CNAME', name: subdomain, content: target, ttl: 1, proxied: true },
      { headers: cfHeaders, timeout: TIMEOUT },
    );
    return data;
  } catch (err) {
    if (/already exists|identical record/i.test(JSON.stringify(err.response?.data?.errors || ''))) {
      return { success: true, already: true };
    }
    throw new Error(err.response ? JSON.stringify(err.response.data) : err.message);
  }
}

// Look up a DNS record by exact name (FQDN) in the zone; null if none.
async function findDnsRecord(fqdn) {
  ensureConfigured();
  const { data } = await axios.get(`${DNS_BASE}?name=${encodeURIComponent(fqdn)}`, { headers: cfHeaders, timeout: TIMEOUT });
  return data.result?.[0] || null;
}

// Delete the DNS record for {fqdn} if present. Idempotent.
async function deleteCnameRecord(fqdn) {
  ensureConfigured();
  const rec = await findDnsRecord(fqdn);
  if (!rec) return { success: true, already: true };
  const { data } = await axios.delete(`${DNS_BASE}/${rec.id}`, { headers: cfHeaders, timeout: TIMEOUT });
  return data;
}

module.exports = {
  createPagesProject,
  getProject,
  triggerDeployment,
  getLatestDeployment,
  attachCustomDomain,
  getCustomDomain,
  removeCustomDomain,
  addCnameRecord,
  findDnsRecord,
  deleteCnameRecord,
};
