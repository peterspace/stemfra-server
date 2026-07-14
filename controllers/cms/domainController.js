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
const { provisionDomainZone } = require('../../lib/domainZone');
const { logSiteActivity } = require('../../lib/activity');
const billing = require('../../lib/billing');

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

    const { customDomain } = await loadVerticalAndDomain(siteId);
    if (customDomain) {
      return res.status(409).json({ error: `This site is already connected to ${customDomain}. Disconnect it first to register a new domain.` });
    }

    // A subscription to invoice the domain against (created by the publish flow).
    const { data: sub } = await supabase
      .from('subscriptions')
      .select('id, currency, provider, status')
      .eq('site_id', siteId)
      .maybeSingle();
    if (!sub) {
      return res.status(402).json({ error: 'Set up your Stemfra plan first — then we can add a domain to your invoice.', code: 'subscription_required' });
    }

    // Fresh availability + exact retail cost for the invoice.
    const avail = await reg.checkDomain(domain);
    if (!avail.available) return res.status(409).json({ error: `${avail.domain} is not available`, availability: avail });

    // GATED (2026-07-14): we do NOT purchase the domain at the registrar here.
    // Instead we invoice the owner our retail price via Payoneer and email a
    // payment request; Stemfra staff register + wire the domain once payment
    // clears (admin registerDomain). This avoids spending at the registrar
    // before the customer has paid.
    let chargeId = null;
    try {
      const { data: ch } = await supabase.from('billing_charges').insert({
        subscription_id: sub.id, site_id: siteId, kind: 'adjustment',
        line_items: [{ label: `Domain registration — ${avail.domain} (1 yr)`, cents: avail.retailCents }],
        amount_cents: avail.retailCents, currency: sub.currency || 'USD',
        due_date: dueInDays(7), status: 'due', provider: sub.provider || 'payoneer',
        metadata: { type: 'domain_registration', domain: avail.domain, cost_cents: avail.costCents, registrar: process.env.DOMAIN_REGISTRAR || 'porkbun', purchased_by: 'owner', pending_registration: true },
      }).select('id').single();
      chargeId = ch?.id || null;
    } catch (e) {
      return res.status(500).json({ error: `Could not create the invoice: ${e.message}` });
    }

    // Email the payment request (best-effort; the insert already rang the bell).
    if (chargeId) { try { await billing.markRequested(chargeId, { by: null }); } catch { /* email best-effort */ } }

    logSiteActivity({
      siteId, action: 'domain_invoice_requested', actorName: req.cmsUser.email || 'owner',
      entityType: 'site', entityId: siteId,
      details: { domain: avail.domain, retail_cents: avail.retailCents, cost_cents: avail.costCents, charge_id: chargeId, purchased_by: 'owner' },
    });

    res.json({ ok: true, invoiced: true, domain: avail.domain, retailCents: avail.retailCents });
  } catch (e) {
    res.status(502).json({ error: e.message, porkbun: e.porkbun || undefined });
  }
}

module.exports = { connect, status, disconnect, searchDomains, checkOne, registerOwn };
