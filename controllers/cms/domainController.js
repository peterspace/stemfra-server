// Owner self-serve custom-domain connect (CMS). Lets a site owner connect a
// brand domain they own straight from the CMS Settings → Domain card, instead
// of it being staff-only. Mirrors the Cloudflare logic in
// controllers/admin/sitesController.js {setCustomDomain,removeCustomDomain} but
// gated by CMS owner auth (requireCmsAuth + verifySiteOwnership) rather than
// staff auth. The admin (CRM) path stays as-is — staff can still do it too.
//
// NOTE: config/supabase.js exports the client directly (single-var require).
const supabase = require('../../config/supabase');
const { verifySiteOwnership } = require('../../middleware/cmsAuth');
const { projectFor } = require('../../lib/attachSiteDomain');
const cf = require('../../lib/cloudflarePages');

const DOMAIN_RE = /^([a-z0-9-]+\.)+[a-z]{2,}$/;

function cleanDomain(input) {
  return String(input || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
}

// verifySiteOwnership returns { id, owner_contact_id, status, subdomain } — no
// vertical — so we fetch the vertical slug (for projectFor) + current domain here.
async function loadVerticalAndDomain(siteId) {
  const { data } = await supabase
    .from('sites')
    .select('custom_domain, vertical:verticals(slug)')
    .eq('id', siteId)
    .single();
  return { slug: data?.vertical?.slug || null, customDomain: data?.custom_domain || null };
}

// POST /api/cms/site-domain { siteId, domain }
async function connect(req, res) {
  try {
    const { siteId } = req.body || {};
    const site = await verifySiteOwnership(req.cmsUser.id, siteId);
    if (!site) return res.status(403).json({ error: 'You do not have access to this site.' });

    const clean = cleanDomain(req.body?.domain);
    if (!DOMAIN_RE.test(clean)) {
      return res.status(400).json({ error: 'Enter a valid domain, e.g. salon.com or www.salon.com' });
    }

    const { slug } = await loadVerticalAndDomain(siteId);
    const project = projectFor(slug); // throws if the vertical isn't mapped
    const target = `${project}.pages.dev`;

    await cf.attachCustomDomain(project, clean);
    // If it's a *.stemfra.com host we wire DNS ourselves; otherwise the owner
    // adds the CNAME at their registrar (returned below).
    if (clean.endsWith('.stemfra.com')) {
      const existing = await cf.findDnsRecord(clean);
      if (!existing) await cf.addCnameRecord(clean.replace('.stemfra.com', ''), target);
    }
    await supabase.from('sites').update({ custom_domain: clean }).eq('id', siteId);
    const status = await cf.getCustomDomain(project, clean);
    res.json({ ok: true, domain: clean, cnameTarget: target, status: status?.status || 'pending' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// GET /api/cms/site-domain?siteId= — current connection + live Cloudflare status.
async function status(req, res) {
  try {
    const siteId = req.query.siteId;
    const site = await verifySiteOwnership(req.cmsUser.id, siteId);
    if (!site) return res.status(403).json({ error: 'You do not have access to this site.' });

    const { slug, customDomain } = await loadVerticalAndDomain(siteId);
    if (!customDomain) return res.json({ domain: null });
    const project = projectFor(slug);
    const cfStatus = await cf.getCustomDomain(project, customDomain);
    res.json({ domain: customDomain, cnameTarget: `${project}.pages.dev`, status: cfStatus?.status || 'pending' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// DELETE /api/cms/site-domain { siteId } — disconnect the brand domain.
async function disconnect(req, res) {
  try {
    const siteId = req.body?.siteId || req.query.siteId;
    const site = await verifySiteOwnership(req.cmsUser.id, siteId);
    if (!site) return res.status(403).json({ error: 'You do not have access to this site.' });

    const { slug, customDomain } = await loadVerticalAndDomain(siteId);
    if (customDomain) {
      const project = projectFor(slug);
      await cf.removeCustomDomain(project, customDomain);
      await cf.deleteCnameRecord(customDomain); // no-op if not in our zone
    }
    await supabase.from('sites').update({ custom_domain: null }).eq('id', siteId);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

module.exports = { connect, status, disconnect };
