// Staff "buy a domain" for a customer site (P6.27). Registrar = Porkbun (env-gated).
// v1 is STAFF-MEDIATED (matches the high-touch onboarding): staff search → register
// → we point DNS + attach to the Pages project + bill the customer our retail price.
// A real purchase requires `confirm:true`; otherwise the register call is a dryRun.
// NOTE: config/supabase.js exports the client directly (service-role).
const supabase = require('../../config/supabase');
const registrar = require('../../lib/registrar');
const cf = require('../../lib/cloudflarePages');
const { projectFor } = require('../../lib/verticalConfig');
const { provisionDomainZone } = require('../../lib/domainZone');
const { logSiteActivity } = require('../../lib/activity');

const dueInDays = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

// GET /api/admin/domains/healthcheck — is the registrar wired?
function healthcheck(_req, res) {
  res.json({ ok: true, provider: process.env.DOMAIN_REGISTRAR || 'porkbun', configured: registrar.active().isConfigured() });
}

// GET /api/admin/domains/search?domain= — availability + cost + our retail price.
async function search(req, res) {
  try {
    const domain = req.query.domain;
    if (!domain) return res.status(400).json({ error: 'domain is required' });
    res.json(await registrar.active().checkDomain(domain));
  } catch (e) {
    if (e.code === 'registrar_unconfigured') return res.status(503).json({ error: e.message, code: e.code });
    res.status(502).json({ error: e.message });
  }
}

// GET /api/admin/domains/requirements?tld= — registry eligibility for a TLD.
async function requirements(req, res) {
  try {
    const tld = req.query.tld;
    if (!tld) return res.status(400).json({ error: 'tld is required' });
    res.json(await registrar.active().getRequirements(tld));
  } catch (e) {
    if (e.code === 'registrar_unconfigured') return res.status(503).json({ error: e.message, code: e.code });
    res.status(502).json({ error: e.message });
  }
}

// POST /api/admin/domains/:siteId/register { domain, confirm? }
// confirm!==true → dryRun (validates, spends nothing). confirm===true → real buy:
// register at the registrar, point DNS at the Pages target, attach the custom
// domain to the project, write sites.custom_domain, and bill the customer.
async function registerDomain(req, res) {
  try {
    const { siteId } = req.params;
    const { domain, confirm } = req.body || {};
    const reg = registrar.active();
    if (!reg.isConfigured()) return res.status(503).json({ error: 'Registrar not configured', code: 'registrar_unconfigured' });
    if (!domain) return res.status(400).json({ error: 'domain is required' });

    const { data: site } = await supabase.from('sites')
      .select('id, subdomain, custom_domain, vertical:verticals(slug)').eq('id', siteId).single();
    if (!site) return res.status(404).json({ error: 'Site not found' });

    // Fresh availability + exact cost (the registrar rejects a mismatched cost).
    const avail = await reg.checkDomain(domain);
    if (!avail.available) return res.status(409).json({ error: `${avail.domain} is not available`, availability: avail });

    const dryRun = confirm !== true;
    const result = await reg.register(avail.domain, { costCents: avail.costCents, whoisPrivacy: true, dryRun });
    if (dryRun) {
      return res.json({
        ok: true, dryRun: true, domain: avail.domain,
        costCents: avail.costCents, retailCents: avail.retailCents,
        message: 'Dry run OK — resend with confirm:true to register & bill.',
      });
    }

    // Real registration succeeded. Wire DNS + attach + bill (each best-effort so a
    // post-purchase hiccup never loses the fact that we already paid for the domain).
    const project = projectFor(site.vertical?.slug);
    const target = `${project}.pages.dev`;
    const steps = {};
    try { await reg.createDnsRecord(avail.domain, { type: 'ALIAS', name: '', content: target }); steps.apex = 'ok'; }
    catch (e) { steps.apex = e.message; }
    try { await reg.createDnsRecord(avail.domain, { type: 'CNAME', name: 'www', content: target }); steps.www = 'ok'; }
    catch (e) { steps.www = e.message; }
    try { await cf.attachCustomDomain(project, avail.domain); steps.attach = 'ok'; }
    catch (e) { steps.attach = e.message; }
    // Case 7: Cloudflare zone + NS delegation + Email Routing (shared orchestrator —
    // keep in step with cms/domainController.registerOwn).
    try { const z = await provisionDomainZone(avail.domain, target); Object.assign(steps, z.steps); }
    catch (e) { steps.zone = e.message; }
    await supabase.from('sites').update({ custom_domain: avail.domain }).eq('id', siteId);

    // Bill the customer our retail price (one-off). Needs a subscription to hang
    // the charge on; otherwise we return the cost for a manual billing line.
    let chargeId = null;
    try {
      const { data: sub } = await supabase.from('subscriptions').select('id, currency, provider').eq('site_id', siteId).maybeSingle();
      if (sub) {
        const { data: ch } = await supabase.from('billing_charges').insert({
          subscription_id: sub.id, site_id: siteId, kind: 'adjustment',
          line_items: [{ label: `Domain registration — ${avail.domain} (1 yr)`, cents: avail.retailCents }],
          amount_cents: avail.retailCents, currency: sub.currency || 'USD',
          due_date: dueInDays(7), status: 'due', provider: sub.provider || 'payoneer',
          metadata: { type: 'domain_registration', domain: avail.domain, order_id: result.orderId, cost_cents: avail.costCents, registrar: process.env.DOMAIN_REGISTRAR || 'porkbun' },
        }).select('id').single();
        chargeId = ch?.id || null;
      }
    } catch (e) { steps.billing = e.message; }

    logSiteActivity({
      siteId, action: 'domain_registered', actorName: req.staffUser?.email || 'staff',
      entityType: 'site', entityId: siteId,
      details: { domain: avail.domain, order_id: result.orderId, cost_cents: avail.costCents, retail_cents: avail.retailCents, steps, charge_id: chargeId },
    });

    res.json({
      ok: true, domain: avail.domain, orderId: result.orderId,
      costCents: avail.costCents, retailCents: avail.retailCents,
      cnameTarget: target, steps, chargeId,
      billed: !!chargeId,
    });
  } catch (e) {
    if (e.code === 'registrar_unconfigured') return res.status(503).json({ error: e.message, code: e.code });
    res.status(502).json({ error: e.message, porkbun: e.porkbun || undefined });
  }
}

module.exports = { healthcheck, search, requirements, registerDomain };
