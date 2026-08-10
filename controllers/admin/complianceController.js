// Compliance Engine — server side (2026-08-10). Read-only rollups over
// billing_charges + expenses (for the Tax registry + Books tabs) and CRUD over
// the three additive compliance tables (registrations / filings / settings).
// Staff-gated (PLATFORM_ADMIN) in the route file; service-role client here.
// Spec: stemfra_server/docs/COMPLIANCE_ENGINE.md. Tax LAW lives in the client
// constants catalog + taxGuidance; this file only aggregates money + dates.
const supabase = require('../../config/supabase');
const { jurisdictionFor } = require('../../lib/geo');

// Product tax category of a charge (see spec §3):
//  - platform commission + subscription service fees = SaaS
//  - domain registration/renewal = digital service (domains)
//  - anything else = other
function categoryOf(c) {
  const label = (c.line_items || []).map((li) => (li && li.label) || '').join(' ').toLowerCase();
  if (c.kind === 'domain_registration' || /\bdomain\b/.test(label)) return 'domains';
  if (['commission', 'recurring', 'initial'].includes(c.kind)) return 'saas';
  return 'other';
}

const monthOf = (iso) => (iso ? String(iso).slice(0, 7) : null); // 'YYYY-MM'

// Load real billable charges, EXCLUDING demo data two ways (spec §4b):
//  1. charge.metadata.demo_seed = true  (the 26 seeded demo invoices)
//  2. the charge's site has metadata.is_starter = true (the whole demo fleet)
// Each returned row carries its resolved billing jurisdiction + tax category.
async function loadBillableCharges({ sinceIso = null, statuses = ['requested', 'paid'] } = {}) {
  let q = supabase
    .from('billing_charges')
    .select('id, site_id, kind, line_items, amount_cents, currency, status, created_at, paid_at, metadata')
    .in('status', statuses)
    .limit(5000);
  if (sinceIso) q = q.gte('created_at', sinceIso);
  const { data: charges, error } = await q;
  if (error) throw new Error(error.message);

  const rows = (charges || []).filter((c) => c.metadata?.demo_seed !== true);
  const siteIds = [...new Set(rows.map((r) => r.site_id).filter(Boolean))];
  const { data: sites } = siteIds.length
    ? await supabase.from('sites').select('id, subdomain, owner_contact_id, metadata').in('id', siteIds)
    : { data: [] };
  const siteById = Object.fromEntries((sites || []).map((s) => [s.id, s]));
  const contactIds = [...new Set((sites || []).map((s) => s.owner_contact_id).filter(Boolean))];
  const { data: contacts } = contactIds.length
    ? await supabase.from('contacts').select('id, country, state').in('id', contactIds)
    : { data: [] };
  const contactById = Object.fromEntries((contacts || []).map((c) => [c.id, c]));

  const out = [];
  for (const c of rows) {
    const site = siteById[c.site_id];
    if (!site || site.metadata?.is_starter === true) continue; // exclude the demo fleet
    const contact = contactById[site.owner_contact_id] || null;
    out.push({
      ...c,
      category: categoryOf(c),
      juris: jurisdictionFor(contact?.country, contact?.state),
    });
  }
  return out;
}

// GET /api/admin/compliance/registry — per-jurisdiction rolling-12-month rollup.
// The client applies taxability flags + thresholds + status chips (constants).
async function getRegistry(_req, res) {
  try {
    const since = new Date(Date.now() - 365 * 86400000).toISOString();
    const charges = await loadBillableCharges({ sinceIso: since, statuses: ['requested', 'paid'] });
    const byJur = new Map();
    for (const c of charges) {
      const key = c.juris.jurisdiction;
      if (!byJur.has(key)) {
        byJur.set(key, {
          jurisdiction: key, label: c.juris.label, country: c.juris.country,
          billedCents: 0, invoiceCount: 0,
          saasCents: 0, domainsCents: 0, otherCents: 0,
          saasCount: 0, domainsCount: 0,
        });
      }
      const j = byJur.get(key);
      const cents = Number(c.amount_cents) || 0;
      j.billedCents += cents;
      j.invoiceCount += 1;
      if (c.category === 'saas') { j.saasCents += cents; j.saasCount += 1; }
      else if (c.category === 'domains') { j.domainsCents += cents; j.domainsCount += 1; }
      else j.otherCents += cents;
    }
    const rows = [...byJur.values()].sort((a, b) => b.billedCents - a.billedCents);
    return res.json({ windowDays: 365, rows });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}

// GET /api/admin/compliance/books — monthly revenue (paid, demo-excluded) by
// category + monthly expenses by category. The client renders the P&L + any
// quarterly grouping. amount on expenses is numeric DOLLARS → convert to cents.
async function getBooks(req, res) {
  try {
    const year = String(req.query.year || new Date().getUTCFullYear());
    const paid = await loadBillableCharges({ statuses: ['paid'] });
    const revByMonth = new Map();
    for (const c of paid) {
      const m = monthOf(c.paid_at || c.created_at);
      if (!m || !m.startsWith(year)) continue;
      if (!revByMonth.has(m)) revByMonth.set(m, { month: m, saasCents: 0, domainsCents: 0, otherCents: 0, totalCents: 0 });
      const r = revByMonth.get(m);
      const cents = Number(c.amount_cents) || 0;
      if (c.category === 'saas') r.saasCents += cents;
      else if (c.category === 'domains') r.domainsCents += cents;
      else r.otherCents += cents;
      r.totalCents += cents;
    }

    const { data: expenses } = await supabase
      .from('expenses')
      .select('amount, category, expense_date, vendor')
      .gte('expense_date', `${year}-01-01`)
      .lte('expense_date', `${year}-12-31`)
      .limit(5000);
    const expByMonth = new Map();
    for (const e of expenses || []) {
      const m = monthOf(e.expense_date);
      if (!m) continue;
      if (!expByMonth.has(m)) expByMonth.set(m, { month: m, byCategory: {}, totalCents: 0 });
      const bucket = expByMonth.get(m);
      const cents = Math.round((Number(e.amount) || 0) * 100);
      const cat = e.category || 'uncategorized';
      bucket.byCategory[cat] = (bucket.byCategory[cat] || 0) + cents;
      bucket.totalCents += cents;
    }

    const revenueByMonth = [...revByMonth.values()].sort((a, b) => a.month.localeCompare(b.month));
    const expensesByMonth = [...expByMonth.values()].sort((a, b) => a.month.localeCompare(b.month));
    return res.json({
      year,
      revenueByMonth,
      expensesByMonth,
      revenueTotalCents: revenueByMonth.reduce((s, r) => s + r.totalCents, 0),
      expensesTotalCents: expensesByMonth.reduce((s, r) => s + r.totalCents, 0),
    });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}

// GET /api/admin/compliance/tenants — every tenant with its billing location
// (country + state), so the registry can show the SaaS + digital-goods tax that
// applies where each tenant sits + the nexus threshold. This is a LOCATION
// reference (client-side maps to rates), so it includes ALL sites; the `isDemo`
// flag marks the demo fleet (which never counts toward the nexus rollup).
async function getTenants(_req, res) {
  try {
    const { data: sites } = await supabase
      .from('sites')
      .select('id, subdomain, status, company_id, owner_contact_id, metadata')
      .in('status', ['live', 'previewing']);
    const companyIds = [...new Set((sites || []).map((s) => s.company_id).filter(Boolean))];
    const contactIds = [...new Set((sites || []).map((s) => s.owner_contact_id).filter(Boolean))];
    const [{ data: companies }, { data: contacts }] = await Promise.all([
      companyIds.length ? supabase.from('companies').select('id, name').in('id', companyIds) : Promise.resolve({ data: [] }),
      contactIds.length ? supabase.from('contacts').select('id, country, state').in('id', contactIds) : Promise.resolve({ data: [] }),
    ]);
    const coById = Object.fromEntries((companies || []).map((c) => [c.id, c]));
    const ctById = Object.fromEntries((contacts || []).map((c) => [c.id, c]));
    const tenants = (sites || []).map((s) => {
      const ct = ctById[s.owner_contact_id];
      return {
        siteId: s.id,
        business: coById[s.company_id]?.name || s.subdomain,
        subdomain: s.subdomain,
        country: ct?.country || null,
        state: ct?.state || null,
        isDemo: s.metadata?.is_starter === true,
      };
    }).sort((a, b) => a.business.localeCompare(b.business));
    return res.json({ tenants });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}

// ─── Registrations CRUD ──────────────────────────────────────────────────────
async function listRegistrations(_req, res) {
  const { data, error } = await supabase.from('compliance_registrations').select('*').order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ registrations: data || [] });
}
async function createRegistration(req, res) {
  const b = req.body || {};
  if (!b.jurisdiction || !b.jurisdiction_label) return res.status(400).json({ error: 'jurisdiction and jurisdiction_label are required' });
  const { data, error } = await supabase.from('compliance_registrations').insert({
    jurisdiction: b.jurisdiction, jurisdiction_label: b.jurisdiction_label,
    category: b.category || 'all', registration_number: b.registration_number || null,
    effective_date: b.effective_date || null, status: b.status || 'active', notes: b.notes || null,
    created_by: req.staffUser?.id || null,
  }).select('*').single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ registration: data });
}
async function updateRegistration(req, res) {
  const patch = {};
  for (const k of ['jurisdiction', 'jurisdiction_label', 'category', 'registration_number', 'effective_date', 'status', 'notes']) {
    if (k in (req.body || {})) patch[k] = req.body[k];
  }
  const { data, error } = await supabase.from('compliance_registrations').update(patch).eq('id', req.params.id).select('*').single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ registration: data });
}
async function deleteRegistration(req, res) {
  const { error } = await supabase.from('compliance_registrations').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ ok: true });
}

// ─── Filings (calendar status rows) ──────────────────────────────────────────
async function listFilings(_req, res) {
  const { data, error } = await supabase.from('compliance_filings').select('*');
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ filings: data || [] });
}
// Upsert one filing's status by (obligation_key, period).
async function upsertFiling(req, res) {
  const b = req.body || {};
  if (!b.obligation_key || !b.period || !b.due_date) return res.status(400).json({ error: 'obligation_key, period and due_date are required' });
  const row = {
    obligation_key: b.obligation_key, period: b.period, due_date: b.due_date,
    status: b.status || 'open', filed_at: b.filed_at || null, notes: b.notes ?? null,
    updated_by: req.staffUser?.id || null,
  };
  const { data, error } = await supabase.from('compliance_filings').upsert(row, { onConflict: 'obligation_key,period' }).select('*').single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ filing: data });
}

// ─── Settings (ETBUS determination + action checklist) ───────────────────────
async function getSettings(_req, res) {
  const { data, error } = await supabase.from('compliance_settings').select('key, value, updated_at');
  if (error) return res.status(500).json({ error: error.message });
  const settings = {};
  for (const r of data || []) settings[r.key] = r.value;
  return res.json({ settings });
}
async function putSetting(req, res) {
  const b = req.body || {};
  if (!b.key) return res.status(400).json({ error: 'key is required' });
  const { data, error } = await supabase.from('compliance_settings')
    .upsert({ key: b.key, value: b.value ?? {}, updated_by: req.staffUser?.id || null }, { onConflict: 'key' })
    .select('*').single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ setting: data });
}

module.exports = {
  getRegistry, getBooks, getTenants,
  listRegistrations, createRegistration, updateRegistration, deleteRegistration,
  listFilings, upsertFiling,
  getSettings, putSetting,
};
