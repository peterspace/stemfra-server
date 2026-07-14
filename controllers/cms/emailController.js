// Owner email forwarding (Case 11 v1) — free Cloudflare Email Routing on
// Stemfra-registered domains. hello@their-domain.com → the owner's existing
// inbox. Receive-only by design (replies come from the owner's own inbox);
// mailboxes (Titan/Workspace) are a later ladder rung — see docs/P10_CASES.md.
//
// Only domains whose ZONE lives in our Cloudflare account qualify (i.e. domains
// we registered via Case 7). BYO connect-only domains get a clear
// "not managed by Stemfra" response instead — we don't control their DNS.
//
// PRIVACY: Cloudflare destination addresses are ACCOUNT-level (shared across
// every customer). We only ever return the destinations referenced by THIS
// site's own routing rules — never the raw account list.
//
// NOTE: config/supabase.js exports the client directly (single-var require).
const supabase = require('../../config/supabase');
const { verifySiteOwnership } = require('../../middleware/cmsAuth');
const zones = require('../../lib/cloudflareZones');
const { logSiteActivity } = require('../../lib/activity');

const ALIAS_RE = /^[a-z0-9](?:[a-z0-9._%+-]{0,62}[a-z0-9])?$/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Our rule-shape → the flat alias row the CMS renders.
function ruleToAlias(rule) {
  const to = rule.matchers?.find((m) => m.field === 'to')?.value || '';
  const dest = rule.actions?.find((a) => a.type === 'forward')?.value?.[0] || '';
  return { ruleId: rule.id, address: to, destination: dest, enabled: rule.enabled !== false };
}

// Load site + require a Stemfra-managed zone. Returns { site, domain, zone }
// or replies with the right error itself (and returns null).
async function requireManagedZone(req, res, siteId) {
  const site = await verifySiteOwnership(req.cmsUser.id, siteId);
  if (!site) { res.status(403).json({ error: 'You do not have access to this site.' }); return null; }

  const { data } = await supabase.from('sites').select('custom_domain').eq('id', siteId).single();
  const domain = data?.custom_domain || null;
  if (!domain) { res.status(409).json({ error: 'Connect or register a domain first — email addresses live on your domain.', code: 'no_domain' }); return null; }

  const zone = await zones.getZoneByName(domain);
  if (!zone) { res.status(409).json({ error: `${domain} is connected but its DNS is not managed by Stemfra, so we can't add email forwarding. Domains registered through Stemfra include it.`, code: 'unmanaged_domain' }); return null; }

  return { site, domain, zone };
}

// GET /api/cms/site-email?siteId= — forwarding status + this site's aliases.
async function status(req, res) {
  try {
    const ctx = await requireManagedZone(req, res, req.query.siteId);
    if (!ctx) return;
    const { domain, zone } = ctx;

    // Routing SETTINGS read sits under the Zone Settings token permission (a
    // different group from Email Routing Rules) — treat it as best-effort so a
    // missing grant degrades to "unknown" instead of failing the whole status.
    const [routing, rules, destinations] = await Promise.all([
      zones.getEmailRouting(zone.id).catch(() => null),
      zones.listRoutingRules(zone.id).catch(() => []),
      zones.listDestinations().catch(() => []),
    ]);

    const verifiedByEmail = new Map(destinations.map((d) => [d.email?.toLowerCase(), !!d.verified]));
    const aliases = rules
      .filter((r) => r.matchers?.some((m) => m.field === 'to'))
      .map(ruleToAlias)
      .map((a) => ({ ...a, verified: verifiedByEmail.get(a.destination.toLowerCase()) ?? false }));

    res.json({
      domain,
      zoneStatus: zone.status || 'pending',              // 'active' once nameservers propagate
      routingEnabled: routing?.enabled === true,
      routingStatus: routing?.status || null,
      aliases,
    });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
}

// POST /api/cms/site-email { siteId, alias, destination }
// Creates hello@domain → destination. Registers the destination inbox if new
// (Cloudflare emails it a verification link; forwarding starts once clicked).
async function createAlias(req, res) {
  try {
    const { siteId } = req.body || {};
    const ctx = await requireManagedZone(req, res, siteId);
    if (!ctx) return;
    const { domain, zone } = ctx;

    const alias = String(req.body?.alias || '').trim().toLowerCase();
    const destination = String(req.body?.destination || '').trim().toLowerCase();
    if (!ALIAS_RE.test(alias)) return res.status(400).json({ error: 'Enter a valid address name, e.g. hello or bookings.' });
    if (!EMAIL_RE.test(destination)) return res.status(400).json({ error: 'Enter a valid inbox to forward to, e.g. yourname@gmail.com.' });

    const aliasEmail = `${alias}@${domain}`;
    const existing = (await zones.listRoutingRules(zone.id)).map(ruleToAlias);
    if (existing.some((a) => a.address.toLowerCase() === aliasEmail)) {
      return res.status(409).json({ error: `${aliasEmail} already exists.` });
    }
    if (existing.length >= 20) {
      return res.status(409).json({ error: 'Address limit reached (20). Remove one to add another.' });
    }

    // Routing must be on (idempotent; normally enabled at purchase).
    await zones.enableEmailRouting(zone.id).catch(() => {});

    const dest = await zones.createDestination(destination);
    const rule = await zones.createRoutingRule(zone.id, { aliasEmail, destination });

    logSiteActivity({
      siteId, action: 'email_alias_created', actorName: req.cmsUser.email || 'owner',
      entityType: 'site', entityId: siteId,
      details: { alias: aliasEmail, destination },
    });

    res.json({
      ok: true,
      alias: { ...ruleToAlias(rule), verified: !!dest?.verified },
      needsVerification: !dest?.verified,
    });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
}

// DELETE /api/cms/site-email { siteId, ruleId } — remove an alias. The
// destination inbox registration stays (other aliases/sites may use it).
async function deleteAlias(req, res) {
  try {
    const { siteId, ruleId } = req.body || {};
    const ctx = await requireManagedZone(req, res, siteId);
    if (!ctx) return;
    if (!ruleId) return res.status(400).json({ error: 'ruleId is required' });

    // Only allow deleting a rule that belongs to THIS site's zone.
    const rules = await zones.listRoutingRules(ctx.zone.id);
    const rule = rules.find((r) => r.id === ruleId);
    if (!rule) return res.status(404).json({ error: 'Address not found.' });

    await zones.deleteRoutingRule(ctx.zone.id, ruleId);
    logSiteActivity({
      siteId, action: 'email_alias_deleted', actorName: req.cmsUser.email || 'owner',
      entityType: 'site', entityId: siteId,
      details: { alias: ruleToAlias(rule).address },
    });
    res.json({ ok: true });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
}

module.exports = { status, createAlias, deleteAlias };
