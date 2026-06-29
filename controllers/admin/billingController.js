// Admin System-A billing — provider-agnostic collection (Payoneer first).
// Staff-gated (PLATFORM_ADMIN). The server uses the service-role client.
const supabase = require('../../config/supabase');
const billing = require('../../lib/billing');

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

module.exports = { getProvider, setProvider, listCharges, requestDetails, startBilling, openCycle, markRequested, markPaid };
