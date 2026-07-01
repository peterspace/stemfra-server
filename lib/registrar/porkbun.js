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

// Retail markup over Porkbun cost: the larger of (cost × mult) and (cost + min).
const MARKUP_MULT = Number(process.env.DOMAIN_MARKUP_MULT || 1.5);
const MARKUP_MIN_CENTS = Number(process.env.DOMAIN_MARKUP_MIN_CENTS || 700);

function isConfigured() { return !!(KEY && SECRET); }

const cleanDomain = (d) =>
  String(d || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/^www\./, '');

function retailCents(costCents) {
  if (costCents == null) return null;
  return Math.max(Math.round(costCents * MARKUP_MULT), costCents + MARKUP_MIN_CENTS);
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
  return {
    domain: d,
    available,
    premium: r.premium === 'yes',
    costCents,
    retailCents: retailCents(costCents),
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

module.exports = {
  isConfigured, checkDomain, getRequirements, register, createDnsRecord,
  retailCents, cleanDomain, PORKBUN_BASE,
};
