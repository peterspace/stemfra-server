// Admin System-A billing — provider-agnostic collection (Payoneer first).
// Staff-gated (PLATFORM_ADMIN). The server uses the service-role client.
const supabase = require('../../config/supabase');
const billing = require('../../lib/billing');
const { meterSiteCommission, meterAllSitesForPeriod } = require('../../lib/commissionMeter');
const { streamInvoicePdf } = require('../../lib/invoicePdf');
const { getCommissionBank } = require('../../lib/commission');

// Resolve payer details (for the Payoneer request) for a set of sites, without
// relying on PostgREST FK-embed names: explicit company + owner-contact lookups.
async function payersForSites(siteIds) {
  const ids = [...new Set((siteIds || []).filter(Boolean))];
  if (!ids.length) return {};
  const { data: sites } = await supabase.from('sites')
    .select('id, subdomain, company_id, owner_contact_id').in('id', ids);
  const companyIds = [...new Set((sites || []).map(s => s.company_id).filter(Boolean))];
  const contactIds = [...new Set((sites || []).map(s => s.owner_contact_id).filter(Boolean))];
  const [{ data: companies }, { data: contacts }] = await Promise.all([
    companyIds.length ? supabase.from('companies').select('id, name').in('id', companyIds) : Promise.resolve({ data: [] }),
    contactIds.length ? supabase.from('contacts').select('id, full_name, email, country, state').in('id', contactIds) : Promise.resolve({ data: [] }),
  ]);
  const coById = Object.fromEntries((companies || []).map(c => [c.id, c]));
  const ctById = Object.fromEntries((contacts || []).map(c => [c.id, c]));
  const out = {};
  for (const s of sites || []) {
    const ct = ctById[s.owner_contact_id];
    const co = coById[s.company_id];
    out[s.id] = {
      subdomain: s.subdomain,
      company: co?.name || null,
      payer: {
        name: ct?.full_name || co?.name || '',
        email: ct?.email || '',
        country: ct?.country || '',
        state: ct?.state || '',
      },
    };
  }
  return out;
}

// GET /api/admin/billing/provider
async function getProvider(_req, res) {
  const provider = await billing.getActiveProvider();
  return res.json({ provider, available: Object.keys(billing.PROVIDERS) });
}

// POST /api/admin/billing/provider { provider }
async function setProvider(req, res) {
  try {
    const provider = await billing.setActiveProvider((req.body || {}).provider);
    return res.json({ success: true, provider });
  } catch (e) {
    return res.status(400).json({ success: false, message: e.message });
  }
}

// GET /api/admin/billing/charges?status=&siteId=
async function listCharges(req, res) {
  let q = supabase.from('billing_charges').select('*').order('created_at', { ascending: false }).limit(500);
  if (req.query.status) q = q.eq('status', req.query.status);
  if (req.query.siteId) q = q.eq('site_id', req.query.siteId);
  const { data: charges, error } = await q;
  if (error) return res.status(500).json({ success: false, message: error.message });
  const payers = await payersForSites((charges || []).map(c => c.site_id));
  const rows = (charges || []).map(c => ({ ...c, site: payers[c.site_id] || null }));
  return res.json({ charges: rows });
}

// GET /api/admin/billing/charges/:id/invoice.pdf — STAFF view of the tenant's
// branded invoice (same PDF the owner sees). Part of the commission compliance packet.
async function invoicePdf(req, res) {
  const { data: charge } = await supabase.from('billing_charges')
    .select('id, site_id, kind, line_items, amount_cents, currency, status, due_date, paid_at, created_at, provider')
    .eq('id', req.params.id).maybeSingle();
  if (!charge) return res.status(404).json({ error: 'Invoice not found' });
  const { data: site } = await supabase.from('sites').select('owner_contact_id').eq('id', charge.site_id).maybeSingle();
  let contact = null;
  if (site?.owner_contact_id) {
    const { data } = await supabase.from('contacts').select('*').eq('id', site.owner_contact_id).maybeSingle();
    contact = data || null;
  }
  const bank = (charge.kind === 'commission' || charge.kind === 'adjustment') ? await getCommissionBank() : null;
  streamInvoicePdf(res, { charge, contact, billingProfile: contact?.billing_profile || {}, provider: charge.provider, bank });
}

// GET /api/admin/billing/charges/:id/booking-export.csv — proof-of-service for a
// commission invoice: every booking on the site within the charge's period. This is
// the "source of funds" evidence (Airwallex may ask) that pairs with the receipt.
function csvCell(v) {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
async function bookingExport(req, res) {
  const { data: charge } = await supabase.from('billing_charges')
    .select('id, site_id, period_start, period_end').eq('id', req.params.id).maybeSingle();
  if (!charge) return res.status(404).json({ error: 'Charge not found' });
  if (!charge.period_start || !charge.period_end) return res.status(400).json({ error: 'Charge has no period to export' });
  const fromIso = new Date(charge.period_start + 'T00:00:00.000Z').toISOString();
  const toIso = new Date(charge.period_end + 'T23:59:59.999Z').toISOString();
  const { data: bookings } = await supabase.from('site_bookings')
    .select('starts_at, service_name_snapshot, status, payment_status, amount_cents, metadata, team_member:site_team_members(name), customer:site_customers(first_name,last_name)')
    .eq('site_id', charge.site_id)
    .gte('starts_at', fromIso).lte('starts_at', toIso)
    .order('starts_at', { ascending: true }).limit(10000);
  const en = (v) => (typeof v === 'string' ? v : v?.en || '');
  const rows = [['Date', 'Service', 'Customer', 'Staff', 'Status', 'Payment', 'Amount', 'Collected'].join(',')];
  for (const b of bookings || []) {
    const collected = b.payment_status === 'paid' || b.metadata?.collected === true;
    rows.push([
      b.starts_at,
      en(b.service_name_snapshot),
      [b.customer?.first_name, b.customer?.last_name].filter(Boolean).join(' '),
      b.team_member?.name || '',
      b.status || '',
      b.payment_status || '',
      b.amount_cents != null ? (b.amount_cents / 100).toFixed(2) : '',
      collected ? 'yes' : 'no',
    ].map(csvCell).join(','));
  }
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="bookings-${charge.period_start}.csv"`);
  return res.send(rows.join('\n'));
}

// GET /api/admin/billing/charges/:id/request-details — paste-ready Payoneer fields
async function requestDetails(req, res) {
  const { data: charge, error } = await supabase.from('billing_charges').select('*').eq('id', req.params.id).maybeSingle();
  if (error || !charge) return res.status(404).json({ success: false, message: 'Charge not found.' });
  const payers = await payersForSites([charge.site_id]);
  const provider = billing.providerFor(charge.provider);
  return res.json({ details: provider.describeRequest(charge, payers[charge.site_id]?.payer || {}) });
}

// POST /api/admin/billing/:siteId/start { tier, setupOverrideCents?, monthlyOverrideCents?, currency? }
async function startBilling(req, res) {
  const siteId = req.params.siteId;
  const { tier, setupOverrideCents, monthlyOverrideCents, currency } = req.body || {};
  const { data: site } = await supabase.from('sites').select('id').eq('id', siteId).maybeSingle();
  if (!site) return res.status(404).json({ success: false, message: 'Site not found.' });

  let { data: sub } = await supabase.from('subscriptions').select('*').eq('site_id', siteId).maybeSingle();
  if (!sub) {
    const plans = await billing.getPlans();
    const provider = await billing.getActiveProvider();
    const tierDef = plans.tiers?.[tier];
    if (!tierDef && monthlyOverrideCents == null) {
      return res.status(400).json({ success: false, message: `Unknown tier "${tier}". Provide a tier or monthlyOverrideCents.` });
    }
    const monthly = monthlyOverrideCents != null ? monthlyOverrideCents : tierDef.monthly_cents;
    const setup = setupOverrideCents != null ? setupOverrideCents : (plans.setup_cents || 0);
    const { data: created, error } = await supabase.from('subscriptions').insert({
      site_id: siteId, build_amount_cents: setup, monthly_amount_cents: monthly,
      currency: currency || plans.currency || 'USD', status: 'active', provider,
      cancel_at_period_end: false, started_at: new Date().toISOString(),
      metadata: { tier: tier || null, plan_label: tierDef?.label || null },
    }).select('*').single();
    if (error) return res.status(500).json({ success: false, message: error.message });
    sub = created;
  }

  const planLabel = sub.metadata?.plan_label || 'Stemfra subscription';
  const { data: existingInitial } = await supabase.from('billing_charges')
    .select('id').eq('subscription_id', sub.id).eq('kind', 'initial').maybeSingle();
  let charge = null;
  if (!existingInitial) charge = await billing.openInitialCharge(sub, { planLabel });
  return res.json({ success: true, subscription: sub, charge });
}

// POST /api/admin/billing/:siteId/open-cycle — open this month's recurring charge
async function openCycle(req, res) {
  const { data: sub } = await supabase.from('subscriptions').select('*').eq('site_id', req.params.siteId).maybeSingle();
  if (!sub) return res.status(404).json({ success: false, message: 'No subscription for this site.' });
  const charge = await billing.openRecurringCharge(sub, { planLabel: sub.metadata?.plan_label || 'Stemfra subscription' });
  return res.json({ success: true, charge });
}

// POST /api/admin/billing/charges/:id/requested { externalRef? }
async function markRequested(req, res) {
  try {
    const charge = await billing.markRequested(req.params.id, { externalRef: (req.body || {}).externalRef, by: req.staffUser?.id });
    return res.json({ success: true, charge });
  } catch (e) { return res.status(500).json({ success: false, message: e.message }); }
}

// POST /api/admin/billing/charges/:id/paid
async function markPaid(req, res) {
  try {
    const charge = await billing.markPaid(req.params.id, { by: req.staffUser?.id });
    return res.json({ success: true, charge });
  } catch (e) { return res.status(500).json({ success: false, message: e.message }); }
}

// GET /api/admin/billing/plans — the full catalog (prices + offer copy) for the CRM editor.
async function getPlans(_req, res) {
  try {
    const plans = await billing.getPlans();
    return res.json({ plans });
  } catch (e) { return res.status(500).json({ success: false, message: e.message }); }
}

// PUT /api/admin/billing/plans — replace the catalog (prices + offer copy).
async function putPlans(req, res) {
  try {
    const plans = await billing.setPlans((req.body || {}).plans || req.body);
    return res.json({ success: true, plans });
  } catch (e) { return res.status(400).json({ success: false, message: e.message }); }
}

// POST /api/admin/billing/commission/run { period?, siteId?, dryRun? }
// Meters commission (kind='commission', ledger only) for a month across all live sites,
// or one site. period defaults to the current UTC month. Idempotent per (site, period).
async function runCommission(req, res) {
  try {
    const b = req.body || {};
    let period = b.period;
    if (!period) {
      const d = new Date();
      period = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
    }
    if (!/^\d{4}-\d{2}$/.test(period)) {
      return res.status(400).json({ success: false, message: 'period must be YYYY-MM.' });
    }
    const dryRun = b.dryRun === true;
    // includeDemo: rehearse the full invoicing loop on is_starter sites — the
    // scheduled monthly run always excludes them (see meterAllSitesForPeriod).
    const includeDemo = b.includeDemo === true;
    const results = b.siteId
      ? [await meterSiteCommission(b.siteId, period, { dryRun })]
      : await meterAllSitesForPeriod(period, { dryRun, includeDemo });
    const totalCommissionCents = results.reduce((s, r) => s + (r.amountCents || 0), 0);
    return res.json({ success: true, period, dryRun, count: results.length, totalCommissionCents, results });
  } catch (e) {
    return res.status(400).json({ success: false, message: e.message });
  }
}

module.exports = { getProvider, setProvider, listCharges, invoicePdf, bookingExport, requestDetails, startBilling, openCycle, markRequested, markPaid, getPlans, putPlans, runCommission };
