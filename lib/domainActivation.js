// Custom-domain activation (Peter, 2026-08-19). A freshly purchased/connected
// domain is NOT used as the public host until it really resolves and serves the
// site: DNS propagation can take up to ~30 minutes, and sending the owner to a
// dead host in that window looks like a broken product.
//
//   purchase/connect  → sites.metadata.custom_domain_status = 'propagating'
//                       (+ custom_domain_connected_at); CMS shows "up to 30 min"
//   sweeper (2 min)   → after MIN_WAIT, fetch https://{domain}/ (+ www): 200 and
//                       our x-stemfra-prerender header (served by the Pages
//                       Function) → status 'active' + bell notification
//   consumers         → use the custom domain only when active
//                       (publicHostFor(site) here; CMS siteBase/TopBar mirror it)
const supabase = require('../config/supabase');

const MIN_WAIT_MS = Number(process.env.DOMAIN_ACTIVATION_MIN_WAIT_MS || 30 * 60_000);
const GIVE_UP_MS = 48 * 3600_000; // keep checking for 2 days, then leave it propagating (staff will see it)

function domainStatus(site) {
  const m = site?.metadata || {};
  if (!site?.custom_domain) return null;
  return m.custom_domain_status || 'active'; // legacy rows (no status) = active
}
/** The host the public should be sent to: custom domain only once active. */
function publicHostFor(site, zone = 'stemfra.com') {
  return site?.custom_domain && domainStatus(site) === 'active' ? site.custom_domain : `${site.subdomain}.${zone}`;
}

async function markPropagating(siteId, domain) {
  const { data: cur } = await supabase.from('sites').select('metadata').eq('id', siteId).single();
  const metadata = { ...(cur?.metadata || {}), custom_domain_status: 'propagating', custom_domain_connected_at: new Date().toISOString(), custom_domain_pending: domain };
  delete metadata.custom_domain_activated_at;
  await supabase.from('sites').update({ metadata }).eq('id', siteId);
}

async function probe(host) {
  try {
    const r = await fetch(`https://${host}/`, { redirect: 'manual', headers: { accept: 'text/html', 'user-agent': 'Stemfra-DomainCheck/1.0' }, signal: AbortSignal.timeout(12_000) });
    const ours = !!r.headers.get('x-stemfra-prerender');
    return { ok: r.status === 200 && ours, status: r.status, ours };
  } catch (e) { return { ok: false, status: 0, error: e.message }; }
}

async function sweepOnce() {
  const { data: sites } = await supabase.from('sites')
    .select('id, subdomain, custom_domain, metadata, status')
    .not('custom_domain', 'is', null).is('deleted_at', null)
    .filter('metadata->>custom_domain_status', 'eq', 'propagating').limit(50);
  let activated = 0;
  for (const s of sites || []) {
    const since = new Date(s.metadata?.custom_domain_connected_at || 0).getTime();
    const age = Date.now() - since;
    if (age < MIN_WAIT_MS) continue;                  // let DNS settle first (Peter: 30 min)
    if (age > GIVE_UP_MS) continue;                   // stop hammering; stays propagating for staff to see
    const apex = await probe(s.custom_domain);
    const www = await probe(`www.${s.custom_domain}`);
    if (!apex.ok) continue;
    const metadata = { ...(s.metadata || {}), custom_domain_status: 'active', custom_domain_activated_at: new Date().toISOString(), custom_domain_www_ok: !!www.ok };
    delete metadata.custom_domain_pending;
    await supabase.from('sites').update({ metadata }).eq('id', s.id);
    await supabase.from('cms_notifications').insert([{
      site_id: s.id, type: 'domain_active', category: 'account',
      title: `${s.custom_domain} is live`,
      body: `Your domain is now active. Your site opens at https://${s.custom_domain}${www.ok ? ' (and www.)' : ''}; the stemfra.com address keeps working too.`,
      href: '/settings/domain', metadata: { domain: s.custom_domain },
    }]).then(() => {}, () => {});
    try { const { logSiteActivity } = require('./activity'); await logSiteActivity({ siteId: s.id, action: 'domain_activated', actorName: 'system', entityType: 'site', entityId: s.id, entityName: s.subdomain, details: { domain: s.custom_domain, www_ok: !!www.ok, minutes: Math.round(age / 60000) } }); } catch { /* best-effort */ }
    activated++;
  }
  if (activated) console.log(`[domain-activation] activated ${activated} domain(s)`);
}

function startDomainActivationSweeper({ intervalMs = 2 * 60_000 } = {}) {
  setTimeout(() => sweepOnce().catch(() => {}), 20_000);
  setInterval(() => sweepOnce().catch((e) => console.error('[domain-activation]', e.message)), intervalMs);
  console.log(`✓ Domain activation sweeper running every ${Math.round(intervalMs / 60000)}min (min wait ${Math.round(MIN_WAIT_MS / 60000)}min)`);
}

module.exports = { domainStatus, publicHostFor, markPropagating, sweepOnce, startDomainActivationSweeper, MIN_WAIT_MS };
