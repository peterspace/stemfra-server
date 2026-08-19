// Publish / unpublish a tenant site (Phase 2d server core). Publishing flips
// `previewing → live`, gated on BOTH:
//   1. completeness (required checklist items all pass), and
//   2. billing cleared — an active System A subscription for this site
//      (subscriptions.site_id, status 'active'). The pay-to-publish Checkout
//      that CREATES that subscription is Phase 2f; until then staff can publish
//      with { skipBilling } (the CMS owner path always enforces it).
// Publishing also ensures the site's host is attached to its vertical project.
const supabase = require('../config/supabase');
const { evaluateCompleteness } = require('./siteCompleteness');
const { attachSiteDomain } = require('./attachSiteDomain');

// Has the site cleared platform billing (System A)?
async function getBillingStatus(siteId) {
  const { data, error } = await supabase
    .from('subscriptions')
    .select('status')
    .eq('site_id', siteId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`billing lookup: ${error.message}`);
  return { status: data?.status || null, active: data?.status === 'active' };
}

/**
 * Publish a site: previewing → live. Throws a tagged Error if a gate fails
 * (err.code: 'not_ready' | 'needs_payment' | 'bad_state').
 * @param {string} siteId
 * @param {object} [opts]
 * @param {boolean} [opts.skipBilling] staff/testing bypass of the payment gate
 */
async function publishSite(siteId, { skipBilling = false } = {}) {
  const { data: site, error } = await supabase
    .from('sites').select('id, status, subdomain').eq('id', siteId).single();
  if (error || !site) throw new Error(`site ${siteId} not found: ${error?.message}`);
  if (site.status === 'live') return { siteId, status: 'live', alreadyLive: true };
  if (!['previewing', 'pending_domain', 'onboarding'].includes(site.status)) {
    const e = new Error(`cannot publish from status "${site.status}"`); e.code = 'bad_state'; throw e;
  }

  const completeness = await evaluateCompleteness(siteId);
  if (!completeness.ready) {
    const e = new Error('Site is not ready to publish — required items are incomplete.');
    e.code = 'not_ready'; e.completeness = completeness; throw e;
  }

  // NO payment gate (2026-08-04). Under the commission model the website is
  // free: no setup fee, no subscription — Stemfra earns 5% on sales AFTER the
  // site is live, billed monthly by invoice (COMMISSION_MODEL.md §0/§2). The
  // subscription gate below dated from pay-to-publish and was stranding every
  // commission-era signup at "Publishing requires an active subscription",
  // then emailing them the retired Payoneer pay-to-publish invoice. Publishing
  // is completeness-gated only; fees acceptance is captured at signup.
  // (getBillingStatus + the skipBilling param survive for the readiness
  // payload and staff tooling — they just no longer block.)

  // Ensure the host is attached to its vertical project (idempotent). Best-effort
  // so a transient Cloudflare hiccup doesn't strand a paid, complete site — the
  // attach can be retried; the status flip is what "live" means.
  let domain = null;
  try {
    domain = await attachSiteDomain(siteId);
  } catch (err) {
    domain = { error: err.message };
  }

  const { error: upErr } = await supabase
    .from('sites')
    .update({ status: 'live', went_live_at: new Date().toISOString() })
    .eq('id', siteId);
  if (upErr) throw new Error(`status→live: ${upErr.message}`);
  // Audit (found missing in the #8 rehearsal, 2026-08-19): best-effort site_activity row.
  try {
    const { logSiteActivity } = require('./activity');
    await logSiteActivity({ siteId, action: 'site_published', actorName: 'owner', entityType: 'site', entityId: siteId, entityName: site.subdomain, details: { subdomain: site.subdomain, domain: domain && !domain.error ? domain.domainStatus || 'attached' : null } });
  } catch { /* never block publish on audit */ }

  return { siteId, status: 'live', subdomain: site.subdomain, billing, domain };
}

/** Unpublish: live → previewing (keeps the host attached). */
async function unpublishSite(siteId, opts = {}) {
  const { data: site, error } = await supabase.from('sites').select('id, status').eq('id', siteId).single();
  if (error || !site) throw new Error(`site ${siteId} not found: ${error?.message}`);
  if (site.status === 'previewing') return { siteId, status: 'previewing', already: true };
  const { error: upErr } = await supabase.from('sites').update({ status: 'previewing' }).eq('id', siteId);
  // Audit (2026-08-19): the support site went previewing with no trail; never again.
  try { const { logSiteActivity } = require('./activity'); await logSiteActivity({ siteId, action: 'site_unpublished', actorName: opts?.actorName || 'unknown', entityType: 'site', entityId: siteId, entityName: site.subdomain, details: {} }); } catch { /* best-effort */ }
  if (upErr) throw new Error(`status→previewing: ${upErr.message}`);
  return { siteId, status: 'previewing' };
}

module.exports = { publishSite, unpublishSite, getBillingStatus };
