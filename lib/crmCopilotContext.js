// crmCopilotContext.js — the compact live snapshot the stemfra CRM
// copilot answers from (the leadgen copilotContext / stacyContext
// pattern: live reads every turn, nothing cached, nothing invented).
// Covers the two worlds the CRM manages: the SALES pipeline (leads /
// contacts) and the PLATFORM (tenant sites, billing, bookings) plus the
// expense books.
const supabase = require('../config/supabase');
const { siteKind } = require('./testData');

function tally(rows, key) {
  const out = {};
  for (const r of rows || []) {
    const k = r[key] || 'unknown';
    out[k] = (out[k] || 0) + 1;
  }
  return out;
}

async function buildCrmCopilotContext() {
  const monthStart = new Date();
  monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);

  const [
    { data: leads }, { count: contactCount }, { data: sites },
    { data: charges }, { data: expenses }, { data: bookings }, { data: setupCalls },
  ] = await Promise.all([
    supabase.from('leads')
      .select('contact_name, company_name, stage, deal_value, service, tags, phone, email, next_followup_date, outreach_status, is_test, last_activity_at')
      .limit(2000),
    supabase.from('contacts').select('id', { count: 'exact', head: true }),
    supabase.from('sites').select('id, subdomain, status, custom_domain, vertical_id, metadata, company:companies(name)').limit(500),
    supabase.from('billing_charges').select('status, amount_cents, due_at, kind, created_at').limit(2000),
    supabase.from('expense_receipts').select('vendor, amount_cents, excluded, received_at, renews_on').limit(600),
    supabase.from('site_bookings').select('id, starts_at, status').gte('starts_at', new Date(Date.now() - 30 * 86400000).toISOString()).limit(2000),
    supabase.from('setup_calls').select('prospect_name, business_name, starts_at, status, meet_link').gte('starts_at', new Date(Date.now() - 86400000).toISOString()).order('starts_at', { ascending: true }).limit(10),
  ]);

  const realLeads = (leads || []).filter((l) => !l.is_test);
  const pipelineValue = realLeads.filter((l) => l.stage !== 'lost').reduce((s, l) => s + (Number(l.deal_value) || 0), 0);
  const followupsDue = realLeads
    .filter((l) => l.next_followup_date && new Date(l.next_followup_date) <= new Date(Date.now() + 7 * 86400000))
    .slice(0, 8)
    .map((l) => ({ contact: l.contact_name, company: l.company_name, due: l.next_followup_date }));

  const realSites = (sites || []).filter((s) => siteKind(s) === 'real');
  const demoSites = (sites || []).filter((s) => siteKind(s) !== 'real');

  const outstanding = (charges || []).filter((c) => ['due', 'requested'].includes(c.status));
  const paidThisMonth = (charges || []).filter((c) => c.status === 'paid' && new Date(c.created_at) >= monthStart);

  const included = (expenses || []).filter((e) => !e.excluded && e.amount_cents);
  const expMonth = included.filter((e) => new Date(e.received_at) >= monthStart)
    .reduce((s, e) => s + e.amount_cents, 0);
  const renewingSoon = included
    .filter((e) => e.renews_on && new Date(e.renews_on) >= new Date() && new Date(e.renews_on) <= new Date(Date.now() + 7 * 86400000))
    .map((e) => ({ vendor: e.vendor, on: e.renews_on, usd: (e.amount_cents / 100).toFixed(2) }));

  return {
    sales: {
      leads_total: realLeads.length,
      by_stage: tally(realLeads, 'stage'),
      pipeline_value_usd: pipelineValue,
      contacted: realLeads.filter((l) => l.outreach_status === 'sent').length,
      followups_due_7d: followupsDue,
      contacts_total: contactCount || 0,
      recent_leads: realLeads
        .sort((a, b) => new Date(b.last_activity_at || 0) - new Date(a.last_activity_at || 0))
        .slice(0, 8)
        .map((l) => ({ contact: l.contact_name, company: l.company_name, stage: l.stage, phone: l.phone || null })),
    },
    setup_calls_upcoming: (setupCalls || []).map((c) => ({ prospect: c.prospect_name, business: c.business_name, at: c.starts_at, status: c.status })),
    platform: {
      client_sites: realSites.map((s) => ({ name: s.company?.name || s.subdomain, host: s.custom_domain || `${s.subdomain}.stemfra.com`, status: s.status })),
      demo_or_test_sites: demoSites.length,
      bookings_last_30d: (bookings || []).length,
    },
    billing: {
      outstanding_invoices: outstanding.length,
      outstanding_usd: (outstanding.reduce((s, c) => s + (c.amount_cents || 0), 0) / 100).toFixed(2),
      paid_this_month_usd: (paidThisMonth.reduce((s, c) => s + (c.amount_cents || 0), 0) / 100).toFixed(2),
    },
    expenses: {
      included_this_month_usd: (expMonth / 100).toFixed(2),
      renewing_within_7d: renewingSoon,
    },
    today: new Date().toISOString().slice(0, 10),
  };
}

module.exports = { buildCrmCopilotContext };
