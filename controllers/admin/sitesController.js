// Staff back-office for customer sites (Phase 2e). Reuses the Phase-2 libs —
// staff act across ALL customers (no ownership scope; requireStaffAuth gates
// the routes). Provisioning here creates the full account (auth user + company
// + contact + seed site) and returns a one-time temp password for the high-touch
// onboarding handoff.
const crypto = require('crypto');
const supabase = require('../../config/supabase');
const { onboardCustomer } = require('../../lib/onboardSite');
const { attachSiteDomain, detachSiteDomain } = require('../../lib/attachSiteDomain');
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

module.exports = { listSites, provision, attach, detach, publish, unpublish, readiness };
