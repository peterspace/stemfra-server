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
const registrar = require('../../lib/registrar');
const { logSiteActivity } = require('../../lib/activity');

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

// ─── Owner "buy a domain" (Hostinger-style search + instant register) ────────
// Peter's call (2026-07-05): instant buy + invoice, gated on an ACTIVE platform
// subscription. Porkbun checkDomain is rate-limited (~1/10s account-wide), so
// search does ONE live check (the exact query) and lists alternates with CACHED
// retail pricing (getPricing, 24h cache); each alternate has its own on-demand
// /check. Register mirrors the staff flow in admin/domainsController.js.

const SUGGEST_TLDS = ['com', 'net', 'co', 'studio', 'salon', 'spa', 'shop', 'online'];
const dueInDays = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

// GET /api/cms/site-domain/search?siteId=&q=
async function searchDomains(req, res) {
  try {
    const site = await verifySiteOwnership(req.cmsUser.id, req.query.siteId);
    if (!site) return res.status(403).json({ error: 'You do not have access to this site.' });
    const reg = registrar.active();
    if (!reg.isConfigured()) return res.status(503).json({ error: 'Domain registration is not available right now.', code: 'registrar_unconfigured' });

    const raw = String(req.query.q || '').trim().toLowerCase().replace(/\s+/g, '');
    if (!raw) return res.status(400).json({ error: 'Type a domain to search.' });
    const exactDomain = raw.includes('.') ? reg.cleanDomain(raw) : `${raw}.com`;
    if (!DOMAIN_RE.test(exactDomain)) return res.status(400).json({ error: 'Enter a valid domain, e.g. myspa.com' });
    const base = exactDomain.split('.')[0];
    const exactTld = exactDomain.slice(base.length + 1);

    // One live availability check (rate-limited API — never per keystroke).
    const exact = await reg.checkDomain(exactDomain);

    // Alternates: cached registration pricing only; availability checked on demand.
    let alternates = [];
    try {
      const pricing = await reg.getPricing();
      alternates = SUGGEST_TLDS.filter(t => t !== exactTld).map(tld => {
        const p = pricing[tld]?.registration;
        const costCents = p != null ? Math.round(Number(p) * 100) : null;
        return { domain: `${base}.${tld}`, tld, retailCents: reg.retailCents(costCents), available: null };
      }).filter(a => a.retailCents != null);
    } catch { /* pricing is best-effort — search still returns the exact match */ }

    res.json({ exact, alternates });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
}

// GET /api/cms/site-domain/check?siteId=&domain= — one live check for an alternate row.
async function checkOne(req, res) {
  try {
    const site = await verifySiteOwnership(req.cmsUser.id, req.query.siteId);
    if (!site) return res.status(403).json({ error: 'You do not have access to this site.' });
    const reg = registrar.active();
    if (!reg.isConfigured()) return res.status(503).json({ error: 'Domain registration is not available right now.', code: 'registrar_unconfigured' });
    const domain = reg.cleanDomain(req.query.domain);
    if (!DOMAIN_RE.test(domain)) return res.status(400).json({ error: 'Invalid domain.' });
    res.json(await reg.checkDomain(domain));
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
}

// POST /api/cms/site-domain/register { siteId, domain, dryRun? (dev only) }
// Registers on Porkbun at our cost, points DNS (apex ALIAS + www CNAME), attaches
// the Pages custom domain, writes sites.custom_domain, and invoices the owner our
// retail price on their existing billing (Payoneer request / card later). The
// billing_charges insert fires the owner's bell notification via the DB trigger.
async function registerOwn(req, res) {
  try {
    const { siteId, domain } = req.body || {};
    const site = await verifySiteOwnership(req.cmsUser.id, siteId);
    if (!site) return res.status(403).json({ error: 'You do not have access to this site.' });
    const reg = registrar.active();
    if (!reg.isConfigured()) return res.status(503).json({ error: 'Domain registration is not available right now.', code: 'registrar_unconfigured' });
    if (!domain) return res.status(400).json({ error: 'domain is required' });

    const { customDomain, slug } = await loadVerticalAndDomain(siteId);
    if (customDomain) {
      return res.status(409).json({ error: `This site is already connected to ${customDomain}. Disconnect it first to register a new domain.` });
    }

    // Instant-buy gate: an ACTIVE platform subscription to invoice against.
    const { data: sub } = await supabase
      .from('subscriptions')
      .select('id, currency, provider, status')
      .eq('site_id', siteId)
      .maybeSingle();
    if (!sub || sub.status !== 'active') {
      return res.status(402).json({ error: 'Domain purchases need an active Stemfra plan. Contact us and we will set you up.', code: 'subscription_required' });
    }

    // Fresh availability + exact cost (the registrar rejects a mismatched cost).
    const avail = await reg.checkDomain(domain);
    if (!avail.available) return res.status(409).json({ error: `${avail.domain} is not available`, availability: avail });

    // Dev-only dry run for end-to-end testing without spending.
    const dryRun = process.env.NODE_ENV !== 'production' && req.body?.dryRun === true;
    const result = await reg.register(avail.domain, { costCents: avail.costCents, whoisPrivacy: true, dryRun });
    if (dryRun) {
      return res.json({ ok: true, dryRun: true, domain: avail.domain, costCents: avail.costCents, retailCents: avail.retailCents });
    }

    // Real registration succeeded — wire everything best-effort (never lose the purchase).
    const project = projectFor(slug);
    const target = `${project}.pages.dev`;
    const steps = {};
    try { await reg.createDnsRecord(avail.domain, { type: 'ALIAS', name: '', content: target }); steps.apex = 'ok'; }
    catch (e) { steps.apex = e.message; }
    try { await reg.createDnsRecord(avail.domain, { type: 'CNAME', name: 'www', content: target }); steps.www = 'ok'; }
    catch (e) { steps.www = e.message; }
    try { await cf.attachCustomDomain(project, avail.domain); steps.attach = 'ok'; }
    catch (e) { steps.attach = e.message; }
    await supabase.from('sites').update({ custom_domain: avail.domain }).eq('id', siteId);

    let chargeId = null;
    try {
      const { data: ch } = await supabase.from('billing_charges').insert({
        subscription_id: sub.id, site_id: siteId, kind: 'adjustment',
        line_items: [{ label: `Domain registration — ${avail.domain} (1 yr)`, cents: avail.retailCents }],
        amount_cents: avail.retailCents, currency: sub.currency || 'USD',
        due_date: dueInDays(7), status: 'due', provider: sub.provider || 'payoneer',
        metadata: { type: 'domain_registration', domain: avail.domain, order_id: result.orderId, cost_cents: avail.costCents, registrar: process.env.DOMAIN_REGISTRAR || 'porkbun', purchased_by: 'owner' },
      }).select('id').single();
      chargeId = ch?.id || null;
    } catch (e) { steps.billing = e.message; }

    logSiteActivity({
      siteId, action: 'domain_registered', actorName: req.cmsUser.email || 'owner',
      entityType: 'site', entityId: siteId,
      details: { domain: avail.domain, order_id: result.orderId, cost_cents: avail.costCents, retail_cents: avail.retailCents, steps, charge_id: chargeId, purchased_by: 'owner' },
    });

    res.json({
      ok: true, domain: avail.domain, retailCents: avail.retailCents,
      cnameTarget: target, steps, billed: !!chargeId,
    });
  } catch (e) {
    res.status(502).json({ error: e.message, porkbun: e.porkbun || undefined });
  }
}

module.exports = { connect, status, disconnect, searchDomains, checkOne, registerOwn };
