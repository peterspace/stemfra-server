// Staff back-office for customer sites (Phase 2e). Reuses the Phase-2 libs —
// staff act across ALL customers (no ownership scope; requireStaffAuth gates
// the routes). Provisioning here creates the full account (auth user + company
// + contact + seed site) and returns a one-time temp password for the high-touch
// onboarding handoff.
const crypto = require('crypto');
const supabase = require('../../config/supabase');
const { onboardCustomer } = require('../../lib/onboardSite');
const { attachSiteDomain, detachSiteDomain, projectFor } = require('../../lib/attachSiteDomain');
const cf = require('../../lib/cloudflarePages');
const { publishSite, unpublishSite, getBillingStatus } = require('../../lib/sitePublish');
const { evaluateCompleteness } = require('../../lib/siteCompleteness');

const ZONE = 'stemfra.com';
const tempPassword = () => `St${crypto.randomBytes(6).toString('hex')}`; // 14 chars

// GET /api/admin/sites — every customer site, newest first.
async function listSites(req, res) {
  try {
    const { data, error } = await supabase
      .from('sites')
      .select('id, subdomain, custom_domain, status, went_live_at, created_at, company:companies(name), vertical:verticals(slug, display_name), owner:contacts!owner_contact_id(full_name, email), subscriptions(status)')
      .order('created_at', { ascending: false });
    if (error) throw new Error(error.message);
    const sites = (data || []).map((s) => ({
      id: s.id,
      business: s.company?.name || s.subdomain,
      vertical: s.vertical?.display_name || s.vertical?.slug || null,
      subdomain: s.subdomain,
      customDomain: s.custom_domain || null,
      status: s.status,
      billing: s.subscriptions?.[0]?.status || null,
      ownerName: s.owner?.full_name || null,
      ownerEmail: s.owner?.email || null,
      liveUrl: `https://${s.subdomain}.${ZONE}`,
      wentLiveAt: s.went_live_at,
      createdAt: s.created_at,
    }));
    res.json({ sites });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// POST /api/admin/sites/provision { company, vertical, ownerEmail, ownerName?, city?, template? }
async function provision(req, res) {
  try {
    const { company, vertical, ownerEmail, ownerName, city, template } = req.body || {};
    if (!company || !vertical || !ownerEmail) {
      return res.status(400).json({ error: 'company, vertical and ownerEmail are required.' });
    }
    const password = tempPassword();
    const result = await onboardCustomer({
      name: ownerName, email: ownerEmail, password, company, vertical,
      city: city || null, templateSlug: template || null,
    });
    res.json({
      ok: true,
      siteId: result.site.siteId,
      subdomain: result.site.subdomain,
      previewUrl: `https://${result.site.subdomain}.${ZONE}`,
      loginEmail: ownerEmail,
      tempPassword: password, // shown once for the staff→client handoff
    });
  } catch (err) {
    if (err.code === 'email_taken') return res.status(409).json({ error: err.message, code: err.code });
    if (err.code === 'bad_input' || err.code === 'weak_password') return res.status(400).json({ error: err.message, code: err.code });
    res.status(500).json({ error: err.message });
  }
}

async function attach(req, res) {
  try { res.json(await attachSiteDomain(req.params.siteId)); }
  catch (err) { res.status(500).json({ error: err.message }); }
}

async function detach(req, res) {
  try { res.json(await detachSiteDomain(req.params.siteId)); }
  catch (err) { res.status(500).json({ error: err.message }); }
}

// Staff publish — can force past the billing gate (skipBilling) but still
// honors completeness (a broken site shouldn't go live).
async function publish(req, res) {
  try {
    res.json(await publishSite(req.params.siteId, { skipBilling: true }));
  } catch (err) {
    if (err.code === 'not_ready') return res.status(409).json({ error: err.message, code: err.code, completeness: err.completeness });
    if (err.code === 'bad_state') return res.status(409).json({ error: err.message, code: err.code });
    res.status(500).json({ error: err.message });
  }
}

async function unpublish(req, res) {
  try { res.json(await unpublishSite(req.params.siteId)); }
  catch (err) { res.status(500).json({ error: err.message }); }
}

async function readiness(req, res) {
  try {
    const [completeness, billing] = await Promise.all([
      evaluateCompleteness(req.params.siteId),
      getBillingStatus(req.params.siteId),
    ]);
    res.json({ ...completeness, billing });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// POST /api/admin/sites/:siteId/custom-domain { domain } — assign a client's
// own brand domain (e.g. salon.com). Registers it on the vertical project; the
// client points their DNS at the returned target (we can't create DNS in their
// zone). For a domain that lives in OUR stemfra.com zone we also add the CNAME.
async function setCustomDomain(req, res) {
  try {
    const { siteId } = req.params;
    const clean = String(req.body?.domain || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
    if (!/^([a-z0-9-]+\.)+[a-z]{2,}$/.test(clean)) {
      return res.status(400).json({ error: 'Enter a valid domain, e.g. salon.com or www.salon.com' });
    }
    const { data: site } = await supabase.from('sites').select('id, vertical:verticals(slug)').eq('id', siteId).single();
    if (!site) return res.status(404).json({ error: 'Site not found.' });
    const project = projectFor(site.vertical?.slug);
    const target = `${project}.pages.dev`;

    await cf.attachCustomDomain(project, clean);
    // If it's a *.stemfra.com host we can wire DNS ourselves; otherwise the
    // client adds a CNAME at their registrar (returned below).
    if (clean.endsWith('.stemfra.com')) {
      const existing = await cf.findDnsRecord(clean);
      if (!existing) await cf.addCnameRecord(clean.replace('.stemfra.com', ''), target);
    }
    await supabase.from('sites').update({ custom_domain: clean }).eq('id', siteId);
    const status = await cf.getCustomDomain(project, clean);
    res.json({ ok: true, domain: clean, project, cnameTarget: target, status: status?.status || 'pending' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// DELETE /api/admin/sites/:siteId/custom-domain — remove the brand domain.
async function removeCustomDomain(req, res) {
  try {
    const { siteId } = req.params;
    const { data: site } = await supabase.from('sites').select('custom_domain, vertical:verticals(slug)').eq('id', siteId).single();
    if (!site) return res.status(404).json({ error: 'Site not found.' });
    if (site.custom_domain) {
      const project = projectFor(site.vertical?.slug);
      await cf.removeCustomDomain(project, site.custom_domain);
      await cf.deleteCnameRecord(site.custom_domain); // no-op if not in our zone
    }
    await supabase.from('sites').update({ custom_domain: null }).eq('id', siteId);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

module.exports = { listSites, provision, attach, detach, publish, unpublish, readiness, setCustomDomain, removeCustomDomain };
