// Porkbun registrar client (P6.27). Buy-a-domain from the CMS/CRM.
// Inert until PORKBUN_API_KEY + PORKBUN_SECRET_API_KEY are set (isConfigured()).
//
// Funding: domain/create draws from our prepaid Porkbun account BALANCE — keep it
// funded. We register at our cost and bill the customer our RETAIL price (markup
// below); margin = retail − cost. WHOIS privacy + SSL are free at Porkbun.
//
// Endpoints (v3): POST /domain/checkDomain/{d} (avail + price; auth'd, ~1/10s per
// account by default), POST /domain/create/{d} (register; cost in pennies must
// match, supports dryRun), GET /domain/getRegistrationRequirements/{tld},
// POST /dns/create/{d}. Docs: https://porkbun.com/api/json/v3/documentation
const PORKBUN_BASE = process.env.PORKBUN_API_BASE || 'https://api.porkbun.com/api/json/v3';
const KEY = process.env.PORKBUN_API_KEY;
const SECRET = process.env.PORKBUN_SECRET_API_KEY;

// Retail markup over Porkbun cost: cost + pct + a small flat handling fee
// (2026-08-10, Peter's call). Domains are an enabler, not a profit line — the
// 5% commission is the revenue — so retail stays within a couple of dollars of
// at-cost registrars (Cloudflare sells at cost; Namecheap ~cost+$2-4). The SAME
// formula applies to the first-year (promo) cost AND the renewal cost, so the
// renewal price we quote is honest from day one.
const MARKUP_PCT = Number(process.env.DOMAIN_MARKUP_PCT || 10);
const MARKUP_FLAT_CENTS = Number(process.env.DOMAIN_MARKUP_FLAT_CENTS || 200);

function isConfigured() { return !!(KEY && SECRET); }

const cleanDomain = (d) =>
  String(d || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/^www\./, '');

function retailCents(costCents) {
  if (costCents == null) return null;
  return Math.round(costCents * (1 + MARKUP_PCT / 100)) + MARKUP_FLAT_CENTS;
}

async function pbPost(path, body = {}) {
  if (!isConfigured()) { const e = new Error('Porkbun API keys not configured'); e.code = 'registrar_unconfigured'; throw e; }
  const res = await fetch(`${PORKBUN_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ apikey: KEY, secretapikey: SECRET, ...body }),
  });
  const data = await res.json().catch(() => ({}));
  if (data.status !== 'SUCCESS') {
    const e = new Error(data.message || `Porkbun ${path} failed (${res.status})`);
    e.porkbun = data; throw e;
  }
  return data;
}

// Availability + price for one domain. Returns cost (Porkbun) + retail (what we
// charge). NOTE: rate-limited per account — call on an explicit "Check" action,
// never per keystroke.
async function checkDomain(domain) {
  const d = cleanDomain(domain);
  const data = await pbPost(`/domain/checkDomain/${d}`);
  const r = data.response || {};
  const available = r.avail === 'yes' || r.avail === true;
  const costCents = r.price != null ? Math.round(Number(r.price) * 100) : null;
  // Renewal cost: Porkbun's checkDomain carries the regular/renewal price
  // separately from the (often promo) first-year price. Fall back through the
  // shapes the API has used; last resort = the first-year cost itself.
  const renewalRaw = r.additional?.renewal?.price ?? r.regularPrice ?? r.price;
  const renewalCostCents = renewalRaw != null ? Math.round(Number(renewalRaw) * 100) : null;
  return {
    domain: d,
    available,
    premium: r.premium === 'yes',
    firstYearPromo: r.firstYearPromo === 'yes',
    costCents,
    retailCents: retailCents(costCents),
    renewalCostCents,
    renewalRetailCents: retailCents(renewalCostCents),
    currency: 'USD',
  };
}

// Registry eligibility + the create payload schema for a TLD (e.g. 'com', 'us').
async function getRequirements(tld) {
  if (!isConfigured()) { const e = new Error('Porkbun API keys not configured'); e.code = 'registrar_unconfigured'; throw e; }
  const res = await fetch(`${PORKBUN_BASE}/domain/getRegistrationRequirements/${String(tld).replace(/^\./, '')}`, {
    headers: { 'X-API-Key': KEY, 'X-Secret-API-Key': SECRET },
  });
  return res.json();
}

// Register a domain. `dryRun` validates without spending (use it to test). `cost`
// is pennies and MUST match the current price — pass costCents from a fresh
// checkDomain to avoid a drift rejection.
async function register(domain, { costCents = null, whoisPrivacy = true, dryRun = false } = {}) {
  const d = cleanDomain(domain);
  const body = { agreeToTerms: 'yes', whoisPrivacy: whoisPrivacy ? '1' : '0' };
  if (costCents != null) body.cost = Math.round(costCents);
  if (dryRun) body.dryRun = true;
  return pbPost(`/domain/create/${d}`, body); // { status, domain, orderId, cost, balance, ... }
}

// Point DNS at the Cloudflare Pages target. Apex → ALIAS (Porkbun supports it);
// a subdomain/host → CNAME. `name` is the host label ('' = apex, 'www', etc.).
async function createDnsRecord(domain, { type = 'ALIAS', name = '', content, ttl = '600' }) {
  const d = cleanDomain(domain);
  return pbPost(`/dns/create/${d}`, { type, name, content, ttl });
}

// Delegate the domain's DNS to another provider (Case 7: the Cloudflare zone's
// assigned nameservers). After this, Porkbun-hosted DNS records stop being
// served — manage records at the new provider.
async function updateNameServers(domain, nameServers) {
  const d = cleanDomain(domain);
  if (!Array.isArray(nameServers) || nameServers.length < 2) {
    throw new Error('updateNameServers needs at least 2 nameservers');
  }
  return pbPost(`/domain/updateNs/${d}`, { ns: nameServers });
}

// All-TLD registration pricing (public endpoint, NOT rate-limited like
// checkDomain). Cached 24h in-process — powers the CMS search's "alternatives"
// price list without burning per-domain availability checks.
let _pricingCache = { at: 0, data: null };
async function getPricing() {
  if (_pricingCache.data && Date.now() - _pricingCache.at < 24 * 3600 * 1000) return _pricingCache.data;
  const res = await fetch(`${PORKBUN_BASE}/pricing/get`);
  const data = await res.json().catch(() => ({}));
  if (data.status !== 'SUCCESS') throw new Error(data.message || `Porkbun pricing fetch failed (${res.status})`);
  _pricingCache = { at: Date.now(), data: data.pricing || {} };
  return _pricingCache.data;
}

const mapDomainRow = (d) => ({
  domain: d.domain,
  status: d.status,
  tld: d.tld,
  createDate: d.createDate,
  expireDate: d.expireDate,
  autoRenew: d.autoRenew === '1' || d.autoRenew === 1 || d.autoRenew === 'yes',
  whoisPrivacy: d.whoisPrivacy === '1' || d.whoisPrivacy === 1 || d.whoisPrivacy === 'yes',
});

// All domains on our Porkbun account (the CRM Domains monitor + the renewal
// sweeper). Optional filters ride the API's own listAll params (v3.15):
// { expiringWithinDays, autoRenew: 'yes'|'no' }.
async function listDomains(filters = {}) {
  const body = { includeLabels: 'no' };
  if (filters.expiringWithinDays != null) body.expiringWithinDays = filters.expiringWithinDays;
  if (filters.autoRenew) body.autoRenew = filters.autoRenew;
  const data = await pbPost('/domain/listAll', body);
  return (data.domains || []).map(mapDomainRow);
}

// One domain's registrar record (expiry, auto-renew, status). Null if the
// domain is not in our account.
async function getDomain(domain) {
  const d = cleanDomain(domain);
  const data = await pbPost('/domain/listAll', { domain: d });
  const row = (data.domains || [])[0];
  return row ? mapDomainRow(row) : null;
}

// Flip auto-renew for a domain we hold (v3.15 endpoint). `enabled` boolean.
// Turning it OFF is the "do not renew" action: the domain then simply expires
// at the end of its paid term (registrars have no delete API — expiry with
// auto-renew off IS cancellation).
async function updateAutoRenew(domain, enabled) {
  const d = cleanDomain(domain);
  return pbPost(`/domain/updateAutoRenew/${d}`, { status: enabled ? 'on' : 'off' });
}

// Manually renew a domain from the prepaid balance (v3.15). `costCents` must
// match the current renewal price (checkDomain's renewalCostCents); supports
// dryRun like create.
async function renewDomain(domain, { costCents, dryRun = false } = {}) {
  const d = cleanDomain(domain);
  const body = {};
  if (costCents != null) body.cost = Math.round(costCents);
  if (dryRun) body.dryRun = true;
  return pbPost(`/domain/renew/${d}`, body);
}

// Prepaid account balance in cents. Porkbun has no dedicated balance endpoint;
// a native dryRun create returns { balance } without charging or creating an
// order, so we probe with a throwaway .click name (cheap TLD, random label →
// effectively always available). Cached upstream — this costs 2 API calls.
async function getBalanceCents() {
  const probe = `stemfra-balance-probe-${Math.random().toString(36).slice(2, 10)}.click`;
  const avail = await checkDomain(probe);
  if (!avail.available) throw new Error('Balance probe domain unexpectedly unavailable');
  const r = await register(probe, { costCents: avail.costCents, whoisPrivacy: true, dryRun: true });
  const cents = Math.round(Number(r.balance));
  if (!Number.isFinite(cents)) throw new Error('Porkbun did not return a balance');
  return cents;
}

module.exports = {
  listDomains, getDomain, updateAutoRenew, renewDomain,
  getBalanceCents,
  isConfigured, checkDomain, getRequirements, register, createDnsRecord, updateNameServers,
  getPricing, retailCents, cleanDomain, PORKBUN_BASE,
};
