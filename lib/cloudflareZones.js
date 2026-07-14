// Cloudflare per-customer-domain ZONES + Email Routing (Cases 7+11).
//
// Case 7: when we register a customer's domain at Porkbun, we immediately
// create a Cloudflare zone for it and delegate the domain's nameservers to
// Cloudflare — so DNS lives in OUR account (proxy/SSL/WAF + programmatic
// records) while registration/renewal stays at Porkbun (no ICANN 60-day
// transfer issue). BYO-domain customers stay connect-only — we never take
// custody of a domain we didn't register.
//
// Case 11: with the zone in our account, Cloudflare Email Routing gives every
// Stemfra-registered domain FREE email forwarding (hello@their-domain.com →
// their existing inbox). Enable = one API call (Cloudflare inserts the MX/SPF
// records itself); aliases = routing rules; destination inboxes are
// ACCOUNT-level and must be verified by the recipient (Cloudflare emails them
// a confirmation link) before rules deliver.
//
// No zone id is persisted — zones are looked up by domain name (one indexed
// API call), which keeps `sites` schema untouched and survives manual moves.
const axios = require('axios');
const { ACCOUNT_ID, API_TOKEN, cfHeaders, isCloudflareConfigured } = require('../config/cloudflare');

const API = 'https://api.cloudflare.com/client/v4';
const TIMEOUT = 30000;

function ensureConfigured() {
  if (!isCloudflareConfigured() || !API_TOKEN || !ACCOUNT_ID) {
    throw new Error('Cloudflare not configured (CLOUDFLARE_* env vars).');
  }
}

const errText = (err) => (err.response ? JSON.stringify(err.response.data) : err.message);

// ─── Zones ────────────────────────────────────────────────────────────────────

// Create a zone for {domain} in our account. Idempotent: 1061 "already exists"
// → return the existing zone. Result carries `name_servers` (the pair Porkbun
// must be pointed at) and `status` ('pending' until NS delegation propagates,
// then 'active').
async function createZone(domain) {
  ensureConfigured();
  try {
    const { data } = await axios.post(
      `${API}/zones`,
      { name: domain, account: { id: ACCOUNT_ID }, type: 'full' },
      { headers: cfHeaders, timeout: TIMEOUT },
    );
    if (!data.success) throw new Error(JSON.stringify(data.errors));
    return { zone: data.result, created: true };
  } catch (err) {
    const errs = err.response?.data?.errors || [];
    if (errs.some((e) => e.code === 1061) || /already exists/i.test(JSON.stringify(errs))) {
      const existing = await getZoneByName(domain);
      if (existing) return { zone: existing, created: false };
    }
    throw new Error(errText(err));
  }
}

// Find our account's zone for {domain}; null if we don't manage it (BYO).
async function getZoneByName(domain) {
  ensureConfigured();
  const { data } = await axios.get(
    `${API}/zones?name=${encodeURIComponent(domain)}&account.id=${ACCOUNT_ID}`,
    { headers: cfHeaders, timeout: TIMEOUT },
  );
  return data.result?.[0] || null;
}

// Add a DNS record in {zoneId}. Idempotent (81053/81057 "already exists" → no-op).
async function createZoneRecord(zoneId, { type, name, content, proxied = true, ttl = 1, priority }) {
  ensureConfigured();
  try {
    const body = { type, name, content, proxied, ttl };
    if (priority != null) body.priority = priority;
    const { data } = await axios.post(`${API}/zones/${zoneId}/dns_records`, body, { headers: cfHeaders, timeout: TIMEOUT });
    return data;
  } catch (err) {
    if (/already exists|identical record/i.test(JSON.stringify(err.response?.data?.errors || ''))) {
      return { success: true, already: true };
    }
    throw new Error(errText(err));
  }
}

// ─── Email Routing (zone-level rules + account-level destinations) ───────────

// Turn Email Routing on for the zone — Cloudflare inserts the required MX/SPF
// records itself. Safe to call again (an already-enabled zone just re-returns
// its settings).
async function enableEmailRouting(zoneId) {
  ensureConfigured();
  try {
    const { data } = await axios.post(`${API}/zones/${zoneId}/email/routing/enable`, {}, { headers: cfHeaders, timeout: TIMEOUT });
    return data.result;
  } catch (err) {
    if (/already enabled/i.test(JSON.stringify(err.response?.data?.errors || ''))) {
      return getEmailRouting(zoneId);
    }
    throw new Error(errText(err));
  }
}

// Routing settings/status for the zone (enabled, status: ready | unconfigured…).
async function getEmailRouting(zoneId) {
  ensureConfigured();
  try {
    const { data } = await axios.get(`${API}/zones/${zoneId}/email/routing`, { headers: cfHeaders, timeout: TIMEOUT });
    return data.result;
  } catch (err) {
    if (err.response?.status === 404) return null;
    throw new Error(errText(err));
  }
}

async function listRoutingRules(zoneId) {
  ensureConfigured();
  const { data } = await axios.get(`${API}/zones/${zoneId}/email/routing/rules?per_page=50`, { headers: cfHeaders, timeout: TIMEOUT });
  return data.result || [];
}

// alias@domain → forward to {destination}. The rule exists immediately but
// Cloudflare only delivers once the destination address is verified.
async function createRoutingRule(zoneId, { aliasEmail, destination }) {
  ensureConfigured();
  try {
    const { data } = await axios.post(
      `${API}/zones/${zoneId}/email/routing/rules`,
      {
        name: `stemfra:${aliasEmail}`,
        enabled: true,
        matchers: [{ type: 'literal', field: 'to', value: aliasEmail }],
        actions: [{ type: 'forward', value: [destination] }],
      },
      { headers: cfHeaders, timeout: TIMEOUT },
    );
    return data.result;
  } catch (err) {
    throw new Error(errText(err));
  }
}

async function deleteRoutingRule(zoneId, ruleId) {
  ensureConfigured();
  try {
    const { data } = await axios.delete(`${API}/zones/${zoneId}/email/routing/rules/${ruleId}`, { headers: cfHeaders, timeout: TIMEOUT });
    return data;
  } catch (err) {
    if (err.response?.status === 404) return { success: true, already: true };
    throw new Error(errText(err));
  }
}

// Destination inboxes are ACCOUNT-level and shared across every customer zone —
// NEVER return the raw list to an owner (it would leak other customers'
// emails). Controllers must filter to the addresses their site's rules use.
async function listDestinations() {
  ensureConfigured();
  const { data } = await axios.get(`${API}/accounts/${ACCOUNT_ID}/email/routing/addresses?per_page=50&verified=any`, { headers: cfHeaders, timeout: TIMEOUT });
  return data.result || [];
}

// Register {email} as a forwarding destination. Cloudflare emails the address
// a verification link; `verified` stays null until the recipient clicks it.
// Idempotent: an already-registered address is returned as-is.
async function createDestination(email) {
  ensureConfigured();
  try {
    const { data } = await axios.post(
      `${API}/accounts/${ACCOUNT_ID}/email/routing/addresses`,
      { email },
      { headers: cfHeaders, timeout: TIMEOUT },
    );
    return data.result;
  } catch (err) {
    if (/already exists/i.test(JSON.stringify(err.response?.data?.errors || ''))) {
      const all = await listDestinations();
      const found = all.find((a) => a.email?.toLowerCase() === email.toLowerCase());
      if (found) return found;
    }
    throw new Error(errText(err));
  }
}

module.exports = {
  createZone,
  getZoneByName,
  createZoneRecord,
  enableEmailRouting,
  getEmailRouting,
  listRoutingRules,
  createRoutingRule,
  deleteRoutingRule,
  listDestinations,
  createDestination,
};
