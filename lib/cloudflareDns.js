// Reusable Cloudflare DNS-record helper for OUR OWN zones (stemfra.com by
// default via CLOUDFLARE_ZONE_ID). Factored out of the one-off scripts used to
// wire the Resend records (MX/SPF/DKIM/DMARC) so any future "add a DNS record"
// need — email-provider setup, TXT domain-verification, a new subdomain — has a
// single, idempotent, tested path instead of an inline node -e script.
//
// NOTE: this is distinct from lib/cloudflareZones.js `createZoneRecord`, which
// operates on TENANT custom-domain zones we take custody of (by zoneId, proxied
// by default). This helper targets our platform zone and defaults proxied:false
// (correct for MX/TXT/verification records).
const CF_API = 'https://api.cloudflare.com/client/v4';

function token() {
  const t = process.env.CLOUDFLARE_API_TOKEN;
  if (!t) throw new Error('CLOUDFLARE_API_TOKEN is not set');
  return t;
}

async function cf(path, { method = 'GET', body } = {}) {
  const res = await fetch(CF_API + path, {
    method,
    headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!json.success) {
    throw new Error(`Cloudflare ${method} ${path} failed: ${JSON.stringify(json.errors || json)}`);
  }
  return json;
}

// Resolve a zone id: explicit arg → CLOUDFLARE_ZONE_ID → lookup by zoneName.
async function resolveZoneId({ zoneId, zoneName } = {}) {
  if (zoneId) return zoneId;
  if (process.env.CLOUDFLARE_ZONE_ID && !zoneName) return process.env.CLOUDFLARE_ZONE_ID;
  if (zoneName) {
    const r = await cf(`/zones?name=${encodeURIComponent(zoneName)}`);
    if (!r.result.length) throw new Error(`No Cloudflare zone named ${zoneName}`);
    return r.result[0].id;
  }
  if (process.env.CLOUDFLARE_ZONE_ID) return process.env.CLOUDFLARE_ZONE_ID;
  throw new Error('Provide zoneId or zoneName, or set CLOUDFLARE_ZONE_ID');
}

// Create-or-update a DNS record (idempotent by type+name). `name` is the FQDN
// (e.g. 'send.mail.stemfra.com'); MX/SRV take `priority`. proxied defaults false
// (DNS-only) — correct for MX/TXT/verification; pass proxied:true for A/CNAME
// you want behind the CF proxy.
async function upsertDnsRecord({ zoneId, zoneName, type, name, content, priority, ttl = 1, proxied = false, comment }) {
  const zid = await resolveZoneId({ zoneId, zoneName });
  const existing = (await cf(`/zones/${zid}/dns_records?type=${type}&name=${encodeURIComponent(name)}&per_page=100`)).result;
  // TXT contents are returned quoted by CF — normalize before comparing.
  const norm = (s) => String(s).replace(/^"|"$/g, '');
  const match = existing.find((e) => norm(e.content) === norm(content) && (priority == null || e.priority === priority));
  const body = { type, name, content, ttl, proxied, ...(priority != null ? { priority } : {}), ...(comment ? { comment } : {}) };
  if (match) {
    const r = await cf(`/zones/${zid}/dns_records/${match.id}`, { method: 'PUT', body });
    return { action: 'updated', id: r.result.id, name: r.result.name };
  }
  const r = await cf(`/zones/${zid}/dns_records`, { method: 'POST', body });
  return { action: 'created', id: r.result.id, name: r.result.name };
}

// Add several records at once (e.g. an ESP's MX+SPF+DKIM+DMARC set).
async function upsertDnsRecords(records, common = {}) {
  const out = [];
  for (const rec of records) out.push(await upsertDnsRecord({ ...common, ...rec }));
  return out;
}

async function deleteDnsRecord({ zoneId, zoneName, type, name }) {
  const zid = await resolveZoneId({ zoneId, zoneName });
  const existing = (await cf(`/zones/${zid}/dns_records?type=${type}&name=${encodeURIComponent(name)}&per_page=100`)).result;
  let deleted = 0;
  for (const e of existing) { await cf(`/zones/${zid}/dns_records/${e.id}`, { method: 'DELETE' }); deleted += 1; }
  return { deleted };
}

async function listDnsRecords({ zoneId, zoneName, type, name } = {}) {
  const zid = await resolveZoneId({ zoneId, zoneName });
  const q = new URLSearchParams({ per_page: '100' });
  if (type) q.set('type', type);
  if (name) q.set('name', name);
  return (await cf(`/zones/${zid}/dns_records?${q}`)).result;
}

module.exports = { upsertDnsRecord, upsertDnsRecords, deleteDnsRecord, listDnsRecords, resolveZoneId };
