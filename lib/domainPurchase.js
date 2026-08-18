// Shared domain purchase orchestration (2026-08-10). ONE place that turns a
// paid-for registrar purchase into a fully wired tenant domain, used by BOTH
// the staff path (controllers/admin/domainsController.registerDomain) and the
// owner instant path (controllers/cms/domainController.registerOwn). Keep the
// two callers on this — never inline the steps again (they drifted once).
//
// Every post-purchase step is best-effort: once the registrar charge has
// happened we must never lose that fact to a DNS/Cloudflare hiccup — we record
// the failing step and carry on.
const supabase = require('../config/supabase');
const registrar = require('./registrar');
const cf = require('./cloudflarePages');
const { projectFor } = require('./verticalConfig');
const { provisionDomainZone } = require('./domainZone');

// Registers `availability.domain` (a fresh checkDomain result) for `site` and
// wires everything: Porkbun apex ALIAS + www CNAME → CF Pages attach → CF zone
// + NS delegation + Email Routing (Case 7) → sites.custom_domain.
// Returns { orderId, target, steps }. Throws ONLY if the registrar purchase
// itself fails (nothing spent yet).
async function purchaseAndWire({ site, availability }) {
  const reg = registrar.active();
  const result = await reg.register(availability.domain, {
    costCents: availability.costCents, whoisPrivacy: true, dryRun: false,
  });

  const project = projectFor(site.vertical?.slug);
  const target = `${project}.pages.dev`;
  const steps = {};
  try { await reg.createDnsRecord(availability.domain, { type: 'ALIAS', name: '', content: target }); steps.apex = 'ok'; }
  catch (e) { steps.apex = e.message; }
  try { await reg.createDnsRecord(availability.domain, { type: 'CNAME', name: 'www', content: target }); steps.www = 'ok'; }
  catch (e) { steps.www = e.message; }
  try { await cf.attachCustomDomain(project, availability.domain); steps.attach = 'ok'; }
  catch (e) { steps.attach = e.message; }
  // Attach www too — the zone (and Porkbun) get a www CNAME → the Pages project,
  // but Pages only serves hosts that are ATTACHED; without this, www 522s behind
  // the proxy. (Found on argyleandsons.click 2026-08-18; the BYO connect path in
  // cms/domainController already did this for apex domains.)
  try { await cf.attachCustomDomain(project, `www.${availability.domain}`); steps.attachWww = 'ok'; }
  catch (e) { steps.attachWww = e.message; }
  try { const z = await provisionDomainZone(availability.domain, target); Object.assign(steps, z.steps); }
  catch (e) { steps.zone = e.message; }
  await supabase.from('sites').update({ custom_domain: availability.domain }).eq('id', site.id);

  return { orderId: result.orderId, target, steps };
}

module.exports = { purchaseAndWire };
