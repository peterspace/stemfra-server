// CMS publish controller (Phase 2d). Owner-facing readiness + publish/unpublish.
// Auth via requireCmsAuth (owner JWT) + verifySiteOwnership for every siteId.
// config/supabase.js exports the client directly; we only need the auth helpers
// + the publish/completeness libs here.
const { verifySiteOwnership } = require('../../middleware/cmsAuth');
const { evaluateCompleteness } = require('../../lib/siteCompleteness');
const { publishSite, unpublishSite, getBillingStatus } = require('../../lib/sitePublish');

const ZONE = 'stemfra.com';

// GET /api/cms/site-publish/readiness/:siteId — checklist + billing + URLs.
async function getReadiness(req, res) {
  try {
    const { siteId } = req.params;
    const site = await verifySiteOwnership(req.cmsUser.id, siteId);
    if (!site) return res.status(403).json({ error: 'Not your site.' });
    const [completeness, billing] = await Promise.all([
      evaluateCompleteness(siteId),
      getBillingStatus(siteId),
    ]);
    res.json({
      ...completeness,
      billing,
      subdomain: site.subdomain,
      customDomain: site.custom_domain || null,
      liveUrl: `https://${site.subdomain}.${ZONE}`,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// POST /api/cms/site-publish/publish { siteId } — previewing → live.
async function publish(req, res) {
  try {
    const { siteId } = req.body;
    if (!siteId) return res.status(400).json({ error: 'siteId required' });
    const site = await verifySiteOwnership(req.cmsUser.id, siteId);
    if (!site) return res.status(403).json({ error: 'Not your site.' });
    const result = await publishSite(siteId); // owners always go through the billing gate
    res.json(result);
  } catch (err) {
    if (err.code === 'not_ready') return res.status(409).json({ error: err.message, code: err.code, completeness: err.completeness });
    if (err.code === 'needs_payment') return res.status(402).json({ error: err.message, code: err.code, billing: err.billing });
    if (err.code === 'bad_state') return res.status(409).json({ error: err.message, code: err.code });
    res.status(500).json({ error: err.message });
  }
}

// POST /api/cms/site-publish/unpublish { siteId } — live → previewing.
async function unpublish(req, res) {
  try {
    const { siteId } = req.body;
    if (!siteId) return res.status(400).json({ error: 'siteId required' });
    const site = await verifySiteOwnership(req.cmsUser.id, siteId);
    if (!site) return res.status(403).json({ error: 'Not your site.' });
    res.json(await unpublishSite(siteId));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

module.exports = { getReadiness, publish, unpublish };
