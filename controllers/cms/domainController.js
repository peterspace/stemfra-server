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
const domainBalance = require('../../lib/domainBalance');
const { purchaseAndWire } = require('../../lib/domainPurchase');
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
// `managed: true` = Stemfra registered this domain (a domain_registration charge
// exists for it), so we configured all DNS ourselves — the CMS hides the BYO
// "add this record at your registrar" instructions for managed domains.
async function status(req, res) {
  try {
    const siteId = req.query.siteId;
    const site = await verifySiteOwnership(req.cmsUser.id, siteId);
    if (!site) return res.status(403).json({ error: 'You do not have access to this site.' });

    const { slug, customDomain } = await loadVerticalAndDomain(siteId);
    if (!customDomain) return res.json({ domain: null });
    const project = projectFor(slug);
    const [cfStatus, { data: regCharge }] = await Promise.all([
      cf.getCustomDomain(project, customDomain),
      supabase.from('billing_charges').select('id')
        .eq('site_id', siteId)
        .contains('metadata', { type: 'domain_registration', domain: customDomain })
        .limit(1),
    ]);
    res.json({
      domain: customDomain,
      cnameTarget: `${project}.pages.dev`,
      status: cfStatus?.status || 'pending',
      managed: !!(regCharge && regCharge.length),
    });
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

// ─── Owner "buy a domain" (Hostinger-style search + register) ────────────────
// Purchase model (2026-08-10, Peter's call — the fintech reconcile pattern):
//   INSTANT while the prepaid Porkbun balance is healthy — we buy + wire the
//   domain immediately (no staff wait, no risk of losing the name or a price
//   change) and the invoice follows; the owner pays it by bank transfer to the
//   Airwallex account like every other invoice.
//   INVOICE-FIRST fallback once the balance drops under the threshold
//   (lib/domainBalance, $30 default) — invoice now, staff register after
//   payment clears (admin registerDomain reuses the pending invoice). The mode
//   flips back to instant automatically when the balance is topped up.
// Porkbun checkDomain is rate-limited (~1/10s account-wide), so search does ONE
// live check (the exact query) and lists alternates with CACHED retail pricing
// (getPricing, 24h cache); each alternate has its own on-demand /check.

const SUGGEST_TLDS = [
  'com', 'net', 'org', 'co', 'us', 'biz', 'info', 'online', 'site', 'xyz',
  'store', 'shop', 'club', 'vip', 'studio', 'salon', 'spa', 'care', 'company',
  'services', 'work', 'fit', 'yoga', 'click', 'cc',
];
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

    // Alternates: cached registration + renewal pricing; availability on demand.
    let alternates = [];
    try {
      const pricing = await reg.getPricing();
      alternates = SUGGEST_TLDS.filter(t => t !== exactTld).map(tld => {
        const toCents = (p) => (p != null ? Math.round(Number(p) * 100) : null);
        const costCents = toCents(pricing[tld]?.registration);
        const renewalCostCents = toCents(pricing[tld]?.renewal);
        return {
          domain: `${base}.${tld}`, tld, available: null,
          retailCents: reg.retailCents(costCents),
          renewalRetailCents: reg.retailCents(renewalCostCents),
        };
      }).filter(a => a.retailCents != null);
    } catch { /* pricing is best-effort — search still returns the exact match */ }

    // Which purchase mode the register button will use (drives the CMS copy).
    const purchaseMode = (await domainBalance.purchasesSuspended()) ? 'invoice_first' : 'instant';

    res.json({ exact, alternates, purchaseMode });
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

// Creates the owner's domain invoice (bank transfer to the Airwallex account,
// like every Stemfra invoice) + emails it. `pending` marks an invoice-first
// charge that staff fulfill after payment (admin registerDomain reuses it).
// `sub` is OPTIONAL: commission-era tenants have no subscriptions row
// (subscription_id is nullable since the commission migration) — the charge
// rides site_id alone, exactly like commission invoices.
async function invoiceDomain({ siteId, sub, avail, orderId = null, pending }) {
  const { data: ch } = await supabase.from('billing_charges').insert({
    subscription_id: sub?.id ?? null, site_id: siteId, kind: 'adjustment',
    line_items: [{ label: `Domain registration — ${avail.domain} (1 yr)`, cents: avail.retailCents }],
    amount_cents: avail.retailCents, currency: sub?.currency || 'USD',
    due_date: dueInDays(7), status: 'due', provider: 'airwallex',
    metadata: {
      type: 'domain_registration', domain: avail.domain, cost_cents: avail.costCents,
      renewal_cost_cents: avail.renewalCostCents ?? null,
      registrar: process.env.DOMAIN_REGISTRAR || 'porkbun', purchased_by: 'owner',
      pending_registration: pending, ...(orderId ? { order_id: orderId } : {}),
    },
  }).select('id').single();
  const chargeId = ch?.id || null;
  // Email the invoice (best-effort; the insert already rang the bell).
  if (chargeId) { try { await billing.markRequested(chargeId, { by: null }); } catch { /* email best-effort */ } }
  return chargeId;
}

// POST /api/cms/site-domain/register { siteId, domain }
// Two modes (2026-08-10 — see the section comment above):
//   instant       — balance healthy: buy + wire NOW, invoice follows.
//   invoice_first — balance low: invoice now, staff register once paid.
async function registerOwn(req, res) {
  try {
    const { siteId, domain } = req.body || {};
    const site = await verifySiteOwnership(req.cmsUser.id, siteId);
    if (!site) return res.status(403).json({ error: 'You do not have access to this site.' });
    const reg = registrar.active();
    if (!reg.isConfigured()) return res.status(503).json({ error: 'Domain registration is not available right now.', code: 'registrar_unconfigured' });
    if (!domain) return res.status(400).json({ error: 'domain is required' });

    const { slug, customDomain } = await loadVerticalAndDomain(siteId);
    if (customDomain) {
      return res.status(409).json({ error: `This site is already connected to ${customDomain}. Disconnect it first to register a new domain.` });
    }

    // Legacy subscription row, if one exists (pre-commission tenants). Under
    // the commission model there is NO subscriptions row — the invoice rides
    // site_id alone, so this is informational, never a gate (fixed 2026-08-10;
    // the old status='active' gate dead-ended every commission-era tenant —
    // ROADMAP task 57 gap b).
    const { data: sub } = await supabase
      .from('subscriptions')
      .select('id, currency, provider, status')
      .eq('site_id', siteId)
      .maybeSingle();

    // Fresh availability + exact cost (the registrar rejects a mismatched cost).
    const avail = await reg.checkDomain(domain);
    if (!avail.available) return res.status(409).json({ error: `${avail.domain} is not available`, availability: avail });

    const instant = !(await domainBalance.purchasesSuspended());

    if (!instant) {
      // Balance below threshold — never spend what we can't cover. Invoice now;
      // staff register + wire once payment clears (and the balance is topped up).
      let chargeId = null;
      try {
        chargeId = await invoiceDomain({ siteId, sub, avail, pending: true });
      } catch (e) {
        return res.status(500).json({ error: `Could not create the invoice: ${e.message}` });
      }
      logSiteActivity({
        siteId, action: 'domain_invoice_requested', actorName: req.cmsUser.email || 'owner',
        entityType: 'site', entityId: siteId,
        details: { domain: avail.domain, retail_cents: avail.retailCents, cost_cents: avail.costCents, charge_id: chargeId, purchased_by: 'owner', mode: 'invoice_first' },
      });
      return res.json({ ok: true, mode: 'invoice_first', invoiced: true, domain: avail.domain, retailCents: avail.retailCents, renewalRetailCents: avail.renewalRetailCents ?? null });
    }

    // Instant: buy + wire immediately (shared orchestrator — same steps as the
    // staff path), then invoice. The domain is secured before any payment wait.
    const { orderId, steps } = await purchaseAndWire({
      site: { id: siteId, vertical: { slug } },
      availability: avail,
    });
    let chargeId = null;
    try {
      chargeId = await invoiceDomain({ siteId, sub, avail, orderId, pending: false });
    } catch (e) { steps.billing = e.message; }

    logSiteActivity({
      siteId, action: 'domain_registered', actorName: req.cmsUser.email || 'owner',
      entityType: 'site', entityId: siteId,
      details: { domain: avail.domain, order_id: orderId, cost_cents: avail.costCents, retail_cents: avail.retailCents, steps, charge_id: chargeId, purchased_by: 'owner', mode: 'instant' },
    });

    // Refresh the cached balance so the CRM monitor + the suspension switch see
    // the spend right away (this is what flips the mode at the $30 line).
    domainBalance.getBalanceCents({ force: true }).catch(() => {});

    res.json({
      ok: true, mode: 'instant', domain: avail.domain, orderId,
      retailCents: avail.retailCents, renewalRetailCents: avail.renewalRetailCents ?? null,
      steps, billed: !!chargeId,
    });
  } catch (e) {
    res.status(502).json({ error: e.message, porkbun: e.porkbun || undefined });
  }
}

// ─── Owner domain management (Namecheap-style Manage, 2026-08-10) ────────────

// True when this site's custom_domain was registered through Stemfra (a
// domain_registration charge exists) — the only domains we can manage at the
// registrar. BYO domains live at the owner's own registrar.
async function isManagedDomain(siteId, domain) {
  const { data } = await supabase.from('billing_charges').select('id')
    .eq('site_id', siteId)
    .contains('metadata', { type: 'domain_registration', domain })
    .limit(1);
  return !!(data && data.length);
}

// GET /api/cms/site-domain/manage?siteId= — registrar record for the site's
// managed domain: expiry, auto-renew, and the renewal retail price.
async function manage(req, res) {
  try {
    const site = await verifySiteOwnership(req.cmsUser.id, req.query.siteId);
    if (!site) return res.status(403).json({ error: 'You do not have access to this site.' });
    const { customDomain } = await loadVerticalAndDomain(req.query.siteId);
    if (!customDomain) return res.json({ domain: null });
    const managed = await isManagedDomain(req.query.siteId, customDomain);
    if (!managed) return res.json({ domain: customDomain, managed: false });

    const reg = registrar.active();
    const record = reg.getDomain ? await reg.getDomain(customDomain) : null;
    // Renewal retail from the cached pricing table (no rate-limited call).
    let renewalRetailCents = null;
    try {
      const tld = customDomain.split('.').slice(1).join('.');
      const p = (await reg.getPricing())[tld]?.renewal;
      renewalRetailCents = p != null ? reg.retailCents(Math.round(Number(p) * 100)) : null;
    } catch { /* pricing best-effort */ }

    res.json({
      domain: customDomain, managed: true,
      status: record?.status || null,
      expireDate: record?.expireDate || null,
      autoRenew: record?.autoRenew ?? null,
      whoisPrivacy: record?.whoisPrivacy ?? null,
      renewalRetailCents,
    });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
}

// POST /api/cms/site-domain/auto-renew { siteId, enabled } — the owner's
// renew / do-not-renew choice, applied straight at the registrar. Turning it
// off means the domain expires at the end of the paid term (no more renewal
// invoices); turning it back on resumes yearly renewal.
async function setAutoRenew(req, res) {
  try {
    const { siteId, enabled } = req.body || {};
    const site = await verifySiteOwnership(req.cmsUser.id, siteId);
    if (!site) return res.status(403).json({ error: 'You do not have access to this site.' });
    const { customDomain } = await loadVerticalAndDomain(siteId);
    if (!customDomain) return res.status(409).json({ error: 'No domain is connected to this site.' });
    if (!(await isManagedDomain(siteId, customDomain))) {
      return res.status(409).json({ error: 'This domain is managed at your own registrar, so its renewal is controlled there.' });
    }
    const reg = registrar.active();
    if (!reg.updateAutoRenew) return res.status(503).json({ error: 'Renewal management is not available right now.' });
    await reg.updateAutoRenew(customDomain, enabled === true);

    logSiteActivity({
      siteId, action: enabled === true ? 'domain_auto_renew_on' : 'domain_auto_renew_off',
      actorName: req.cmsUser.email || 'owner', entityType: 'site', entityId: siteId,
      details: { domain: customDomain },
    });
    res.json({ ok: true, domain: customDomain, autoRenew: enabled === true });
  } catch (e) {
    res.status(502).json({ error: e.message, porkbun: e.porkbun || undefined });
  }
}

// GET /api/cms/site-domain/portfolio — every domain across ALL the owner's
// sites (the tenant-facing overview list). One row per site with a domain.
async function portfolio(req, res) {
  try {
    const contactId = await require('../../middleware/cmsAuth').resolveContactId(req.cmsUser.id);
    if (!contactId) return res.json({ domains: [] });
    const { data: sites } = await supabase.from('sites')
      .select('id, subdomain, custom_domain, company:companies(name)')
      .eq('owner_contact_id', contactId)
      .not('custom_domain', 'is', null);
    const rows = sites || [];
    if (!rows.length) return res.json({ domains: [] });

    // One registrar listing covers every managed domain (no per-domain calls).
    const reg = registrar.active();
    let registrarByDomain = {};
    try {
      const all = reg.listDomains ? await reg.listDomains() : [];
      registrarByDomain = Object.fromEntries(all.map(d => [d.domain, d]));
    } catch { /* registrar listing best-effort */ }

    const domains = await Promise.all(rows.map(async (s) => {
      const rec = registrarByDomain[s.custom_domain] || null;
      const managed = rec ? await isManagedDomain(s.id, s.custom_domain) : false;
      return {
        siteId: s.id,
        business: s.company?.name || s.subdomain,
        subdomain: s.subdomain,
        domain: s.custom_domain,
        managed,
        status: rec?.status || null,
        expireDate: rec?.expireDate || null,
        autoRenew: rec?.autoRenew ?? null,
      };
    }));
    res.json({ domains });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
}

module.exports = { connect, status, disconnect, searchDomains, checkOne, registerOwn, manage, setAutoRenew, portfolio };
