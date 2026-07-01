// Owner self-serve "+ New site" (CMS). An existing owner provisions an
// ADDITIONAL site for themselves — a new business/brand under the same login.
// Mirrors onboardCustomer's company → provisionSite flow but WITHOUT creating a
// new auth user/contact (the owner already exists): resolve the owner's contact
// from their JWT, make a new company, clone the vertical seed onto a new site
// owned by that contact, then best-effort attach the subdomain host.
//
// NOTE: config/supabase.js exports the client directly (single-var require).
const supabase = require('../../config/supabase');
const { resolveContactId, verifySiteOwnership } = require('../../middleware/cmsAuth');
const { provisionSite, cloneSite, resolveVerticalSlug, SEED_SOURCE_BY_VERTICAL } = require('../../lib/provisionSite');
const { attachSiteDomain } = require('../../lib/attachSiteDomain');
const { softDeleteSite, restoreSite } = require('../../lib/siteDeletion');
const { logSiteActivity } = require('../../lib/activity');

// POST /api/cms/sites { businessName, vertical, city? }
async function createSite(req, res) {
  try {
    const contactId = await resolveContactId(req.cmsUser.id);
    if (!contactId) return res.status(403).json({ error: 'No owner profile found for this account.' });

    const businessName = String(req.body?.businessName || '').trim();
    const city = req.body?.city ? String(req.body.city).trim() : null;
    const vSlug = resolveVerticalSlug(req.body?.vertical);
    if (!businessName) return res.status(400).json({ error: 'Enter a business name.' });
    if (!SEED_SOURCE_BY_VERTICAL[vSlug]) {
      return res.status(400).json({ error: `Choose a vertical: ${Object.keys(SEED_SOURCE_BY_VERTICAL).join(', ')}` });
    }

    // A new company for the new site (an owner can run multiple businesses;
    // sites.company_id is independent of the owner's primary contacts.company_id).
    const { data: co, error: coErr } = await supabase.from('companies').insert({ name: businessName }).select('id').single();
    if (coErr) throw new Error(`company: ${coErr.message}`);
    const companyId = co.id;

    let site;
    try {
      site = await provisionSite({
        vertical: vSlug,
        companyId,
        ownerContactId: contactId,
        displayName: businessName,
        city,
        createdBy: req.cmsUser.id,
      });
    } catch (err) {
      // provisionSite rolls back the partial site itself; clean up the orphan company.
      try { await supabase.from('companies').delete().eq('id', companyId); } catch { /* best-effort */ }
      throw err;
    }

    // Best-effort host attach so the preview is reachable. If Cloudflare is
    // unavailable the site still exists (previewing) and the host can be
    // attached later (staff CRM / retry) — we don't fail the whole request.
    let domain = { attached: false };
    try {
      const r = await attachSiteDomain(site.siteId);
      domain = { attached: true, status: r.domainStatus || 'pending' };
    } catch (e) {
      domain = { attached: false, error: e.message };
    }

    res.json({
      ok: true,
      siteId: site.siteId,
      subdomain: site.subdomain,
      previewUrl: `https://${site.subdomain}.stemfra.com`,
      status: site.status,
      domain,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// POST /api/cms/sites/clone { sourceSiteId, businessName, city? } — owner
// DUPLICATES one of their OWN configured shops into a new site (same design +
// catalog + content, exactly as previewed). Also the path Stacy calls to clone
// for an owner. Ownership of the source is enforced.
async function cloneOwnSite(req, res) {
  try {
    const contactId = await resolveContactId(req.cmsUser.id);
    if (!contactId) return res.status(403).json({ error: 'No owner profile found for this account.' });

    const sourceSiteId = String(req.body?.sourceSiteId || '').trim();
    const businessName = String(req.body?.businessName || '').trim();
    const city = req.body?.city ? String(req.body.city).trim() : null;
    if (!sourceSiteId) return res.status(400).json({ error: 'Choose a site to clone.' });
    if (!businessName) return res.status(400).json({ error: 'Enter a name for the new site.' });

    // The owner may only clone a site they own.
    const source = await verifySiteOwnership(req.cmsUser.id, sourceSiteId);
    if (!source) return res.status(403).json({ error: 'Not your site' });

    // A fresh company for the duplicated business.
    const { data: co, error: coErr } = await supabase.from('companies').insert({ name: businessName }).select('id').single();
    if (coErr) throw new Error(`company: ${coErr.message}`);
    const companyId = co.id;

    let site;
    try {
      site = await cloneSite({
        sourceSiteId, companyId, ownerContactId: contactId,
        displayName: businessName, city, createdBy: req.cmsUser.id,
      });
    } catch (err) {
      try { await supabase.from('companies').delete().eq('id', companyId); } catch { /* best-effort */ }
      throw err;
    }

    let domain = { attached: false };
    try {
      const r = await attachSiteDomain(site.siteId);
      domain = { attached: true, status: r.domainStatus || 'pending' };
    } catch (e) {
      domain = { attached: false, error: e.message };
    }

    // Audit — a clone is a significant action (covers the Sites-page clone AND
    // Stacy's confirm-then-clone). Logged against the SOURCE site. Best-effort.
    await logSiteActivity({
      siteId: sourceSiteId,
      actorName: req.cmsUser.email || 'Site owner',
      action: 'site_cloned',
      entityType: 'site',
      entityId: site.siteId,
      details: { new_site_id: site.siteId, new_subdomain: site.subdomain, business_name: businessName, via: req.body?.via || 'sites_page' },
    });

    res.json({
      ok: true,
      siteId: site.siteId,
      subdomain: site.subdomain,
      previewUrl: `https://${site.subdomain}.stemfra.com`,
      status: site.status,
      counts: site.counts,
      domain,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// POST /api/cms/sites/:siteId/delete { reason? } — owner deletes their OWN site.
// Soft-delete with a 90-day grace; never forces past the unpaid-charge guardrail.
async function deleteOwnSite(req, res) {
  try {
    const site = await verifySiteOwnership(req.cmsUser.id, req.params.siteId);
    if (!site) return res.status(403).json({ error: 'Not your site' });
    const result = await softDeleteSite(req.params.siteId, {
      reason: req.body?.reason || null, by: req.cmsUser.id, actorName: req.cmsUser.email, force: false,
    });
    res.json({ ok: true, ...result });
  } catch (err) {
    if (err.code === 'unpaid_charges') return res.status(409).json({ error: err.message, code: err.code });
    res.status(500).json({ error: err.message });
  }
}

// POST /api/cms/sites/:siteId/restore — owner restores within the grace window.
async function restoreOwnSite(req, res) {
  try {
    // Ownership check must look past the soft-delete flag (verifySiteOwnership
    // reads the row regardless of deleted_at).
    const site = await verifySiteOwnership(req.cmsUser.id, req.params.siteId);
    if (!site) return res.status(403).json({ error: 'Not your site' });
    res.json({ ok: true, ...(await restoreSite(req.params.siteId, { actorName: req.cmsUser.email })) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

module.exports = { createSite, cloneOwnSite, deleteOwnSite, restoreOwnSite };
