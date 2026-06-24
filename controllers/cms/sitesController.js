// Owner self-serve "+ New site" (CMS). An existing owner provisions an
// ADDITIONAL site for themselves — a new business/brand under the same login.
// Mirrors onboardCustomer's company → provisionSite flow but WITHOUT creating a
// new auth user/contact (the owner already exists): resolve the owner's contact
// from their JWT, make a new company, clone the vertical seed onto a new site
// owned by that contact, then best-effort attach the subdomain host.
//
// NOTE: config/supabase.js exports the client directly (single-var require).
const supabase = require('../../config/supabase');
const { resolveContactId } = require('../../middleware/cmsAuth');
const { provisionSite, resolveVerticalSlug, SEED_SOURCE_BY_VERTICAL } = require('../../lib/provisionSite');
const { attachSiteDomain } = require('../../lib/attachSiteDomain');

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

module.exports = { createSite };
