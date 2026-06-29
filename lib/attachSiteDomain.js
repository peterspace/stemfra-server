// Attach a tenant site's host(s) to its vertical's Cloudflare Pages project
// (Phase 2b). MULTI-TENANT BY HOST: every site of a vertical attaches to the
// SAME project (no per-customer project). "Attaching a domain" = add the
// hostname as a custom domain on that project + ensure a proxied CNAME →
// {project}.pages.dev. The deployed bundle then resolves the tenant from the
// host via useSiteByHost (custom_domain OR first label = subdomain).
//
// Status lifecycle: a previewing/onboarding site → pending_domain while the
// host attaches → back to previewing once the {subdomain}.stemfra.com host is
// active (Universal SSL on *.stemfra.com makes this near-instant). Publishing
// (previewing → live) is a separate, gated step (Phase 2d).
const supabase = require('../config/supabase');
const cf = require('./cloudflarePages');

// vertical → Pages project + projectFor are centralized in verticalConfig.js
// (re-exported below so domainController/sitesController keep importing from here).
const { VERTICAL_PROJECT, projectFor } = require('./verticalConfig');
const ZONE_SUFFIX = 'stemfra.com';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function loadSite(siteId) {
  const { data, error } = await supabase
    .from('sites')
    .select('id, subdomain, custom_domain, status, vertical:verticals(slug)')
    .eq('id', siteId)
    .single();
  if (error || !data) throw new Error(`site ${siteId} not found: ${error?.message}`);
  return data;
}

async function setStatus(siteId, status) {
  const { error } = await supabase.from('sites').update({ status }).eq('id', siteId);
  if (error) throw new Error(`status→${status}: ${error.message}`);
}

/**
 * Attach {subdomain}.stemfra.com (and the brand custom_domain, if set) to the
 * site's vertical project. Returns once the stemfra.com host is active.
 */
// NB: a {subdomain}.stemfra.com host serves immediately via Universal SSL on
// *.stemfra.com, while Pages' OWN custom-domain "status" can sit at `pending`
// for minutes. So we do NOT block onboarding waiting for `active` — a short
// confirmation poll, then return whatever status we have (the host is live).
async function attachSiteDomain(siteId, { dryRun = false, pollMs = 3000, timeoutMs = 15000 } = {}) {
  const site = await loadSite(siteId);
  const project = projectFor(site.vertical?.slug);
  const fqdn = `${site.subdomain}.${ZONE_SUFFIX}`;
  const target = `${project}.pages.dev`;

  if (dryRun) {
    return { siteId, project, fqdn, target, customDomain: site.custom_domain, dryRun: true };
  }

  await setStatus(siteId, 'pending_domain');

  // Attach to the project FIRST — for a same-account zone Cloudflare may
  // auto-create the DNS route; only add our proxied CNAME if it didn't.
  const attachRes = await cf.attachCustomDomain(project, fqdn);
  const existing = await cf.findDnsRecord(fqdn);
  let cnameRes = { already: true };
  if (!existing) cnameRes = await cf.addCnameRecord(site.subdomain, target);

  // Poll until the stemfra.com host is active (Universal SSL → usually seconds).
  let domainStatus = null;
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const d = await cf.getCustomDomain(project, fqdn);
    domainStatus = d?.status || null;
    if (domainStatus === 'active') break;
    await sleep(pollMs);
  }

  // Brand custom domain (their own TLD): attach too; its per-domain cert may
  // stay pending until the customer points DNS at us — that's expected.
  let customDomainStatus = null;
  if (site.custom_domain) {
    await cf.attachCustomDomain(project, site.custom_domain);
    const cd = await cf.getCustomDomain(project, site.custom_domain);
    customDomainStatus = cd?.status || 'pending';
  }

  // Content was already in place (previewing) — host now attached.
  await setStatus(siteId, 'previewing');

  return {
    siteId, project, fqdn, target, domainStatus,
    customDomain: site.custom_domain, customDomainStatus,
    cname: cnameRes?.already ? 'existed/auto' : 'created',
    attach: attachRes?.already ? 'existed' : 'attached',
  };
}

/** Detach the site's host(s) from the project + remove the CNAME. Idempotent. */
async function detachSiteDomain(siteId, { alsoCustom = true } = {}) {
  const site = await loadSite(siteId);
  const project = projectFor(site.vertical?.slug);
  const fqdn = `${site.subdomain}.${ZONE_SUFFIX}`;
  await cf.removeCustomDomain(project, fqdn);
  await cf.deleteCnameRecord(fqdn);
  if (alsoCustom && site.custom_domain) {
    await cf.removeCustomDomain(project, site.custom_domain);
    await cf.deleteCnameRecord(site.custom_domain);
  }
  return { siteId, project, fqdn, detached: true };
}

module.exports = { attachSiteDomain, detachSiteDomain, projectFor, VERTICAL_PROJECT };
