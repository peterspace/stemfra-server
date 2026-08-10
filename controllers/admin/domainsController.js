// Staff "buy a domain" for a customer site (P6.27). Registrar = Porkbun (env-gated).
// v1 is STAFF-MEDIATED (matches the high-touch onboarding): staff search → register
// → we point DNS + attach to the Pages project + bill the customer our retail price.
// A real purchase requires `confirm:true`; otherwise the register call is a dryRun.
// NOTE: config/supabase.js exports the client directly (service-role).
const supabase = require('../../config/supabase');
const registrar = require('../../lib/registrar');
const domainBalance = require('../../lib/domainBalance');
const { purchaseAndWire } = require('../../lib/domainPurchase');
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

    if (confirm !== true) {
      await reg.register(avail.domain, { costCents: avail.costCents, whoisPrivacy: true, dryRun: true });
      return res.json({
        ok: true, dryRun: true, domain: avail.domain,
        costCents: avail.costCents, retailCents: avail.retailCents,
        message: 'Dry run OK — resend with confirm:true to register & bill.',
      });
    }

    // Real purchase + full wiring via the shared orchestrator (lib/domainPurchase —
    // the owner instant path uses the same one; never inline these steps again).
    const { orderId, target, steps } = await purchaseAndWire({ site, availability: avail });
    const result = { orderId };

    // Bill the customer our retail price (one-off). If the OWNER already
    // requested this domain from the CMS (the gated flow creates a pending
    // invoice before staff register), REUSE that charge instead of double
    // billing — just stamp the order id and clear the pending flag.
    let chargeId = null;
    try {
      const { data: pending } = await supabase.from('billing_charges')
        .select('id, metadata')
        .eq('site_id', siteId)
        .in('status', ['due', 'requested'])
        .contains('metadata', { type: 'domain_registration', domain: avail.domain })
        .maybeSingle();
      if (pending) {
        await supabase.from('billing_charges').update({
          metadata: { ...(pending.metadata || {}), order_id: result.orderId, pending_registration: false },
        }).eq('id', pending.id);
        chargeId = pending.id;
        steps.billing = 'reused pending owner invoice';
      } else {
        // Commission-era tenants have no subscriptions row — the charge rides
        // site_id alone (nullable subscription_id), like commission invoices.
        const { data: sub } = await supabase.from('subscriptions').select('id, currency, provider').eq('site_id', siteId).maybeSingle();
        const { data: ch } = await supabase.from('billing_charges').insert({
          subscription_id: sub?.id ?? null, site_id: siteId, kind: 'adjustment',
          line_items: [{ label: `Domain registration: ${avail.domain} (1 yr)`, cents: avail.retailCents }],
          amount_cents: avail.retailCents, currency: sub?.currency || 'USD',
          // Domain invoices collect by bank transfer to the Airwallex account
          // (COMMISSION_MODEL.md §2) — never inherit a dormant provider stamp.
          due_date: dueInDays(7), status: 'due', provider: 'airwallex',
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

// GET /api/admin/domains/overview — the CRM Domains monitor: prepaid balance
// (+ low threshold + whether owner purchases are paused) and every domain on
// the Porkbun account, mapped back to the site using it where possible.
async function overview(req, res) {
  try {
    const reg = registrar.active();
    if (!reg.isConfigured()) return res.status(503).json({ error: 'Registrar not configured', code: 'registrar_unconfigured' });

    const [balanceCents, domains] = await Promise.all([
      domainBalance.getBalanceCents({ force: req.query.refresh === '1' }).catch(() => null),
      reg.listDomains ? reg.listDomains().catch(() => []) : [],
    ]);

    // Map registrar domains to the sites using them.
    const names = domains.map(d => d.domain);
    let siteByDomain = {};
    if (names.length) {
      const { data: sites } = await supabase.from('sites')
        .select('id, subdomain, custom_domain, company:companies(name)')
        .in('custom_domain', names);
      for (const s of sites || []) {
        siteByDomain[s.custom_domain] = { id: s.id, subdomain: s.subdomain, business: s.company?.name || s.subdomain };
      }
    }

    res.json({
      ok: true,
      balanceCents,
      minBalanceCents: domainBalance.MIN_BALANCE_CENTS,
      purchasesSuspended: balanceCents != null && balanceCents < domainBalance.MIN_BALANCE_CENTS,
      domains: domains.map(d => ({ ...d, site: siteByDomain[d.domain] || null })),
    });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
}

module.exports = { healthcheck, search, requirements, registerDomain, overview };
