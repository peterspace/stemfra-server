// Provider-agnostic System-A billing service. The `subscriptions` row holds the
// plan (amounts + provider); `billing_charges` is the collection ledger (one row
// = one collectible = one Payoneer request / one Stripe invoice). Providers are
// thin: they render/issue requests; the service owns charge creation + status.
// See docs/ROADMAP.md (A2) + docs/DEMOS.md conventions.
const supabase = require('../../config/supabase');
const payoneer = require('./payoneer');

// Provider registry — stripe/lemonsqueezy/paddle plug in here later.
const PROVIDERS = { payoneer };

async function getActiveProvider() {
  try {
    const { data } = await supabase.from('crm_settings').select('value').eq('key', 'billing_active_provider').maybeSingle();
    return data?.value?.provider || 'payoneer';
  } catch { return 'payoneer'; }
}

async function setActiveProvider(provider) {
  if (!PROVIDERS[provider]) throw new Error(`unknown billing provider: ${provider}`);
  const { error } = await supabase.from('crm_settings')
    .upsert({ key: 'billing_active_provider', value: { provider } }, { onConflict: 'key' });
  if (error) throw new Error(error.message);
  return provider;
}

function providerFor(key) { return PROVIDERS[key] || payoneer; }

// DB-driven plan catalog (flat setup + tiers) — single source for amounts.
async function getPlans() {
  const { data } = await supabase.from('crm_settings').select('value').eq('key', 'billing_plans').maybeSingle();
  return data?.value || { currency: 'USD', setup_cents: 100000, tiers: {} };
}

const sumCents = (items) => (items || []).reduce((s, i) => s + (Number(i.cents) || 0), 0);
const dueInDays = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
const monthLabel = (d) => d.toLocaleString('en-US', { month: 'short', year: 'numeric' });

async function insertCharge(row) {
  const { data, error } = await supabase.from('billing_charges').insert(row).select('*').single();
  if (error) throw new Error(`charge insert: ${error.message}`);
  return data;
}

// First collectible: one-time setup + the first month (the standard combined
// first invoice → $1,199, then $199).
async function openInitialCharge(sub, { planLabel = 'Stemfra subscription', dueDays = 7 } = {}) {
  const items = [];
  if (sub.build_amount_cents > 0) items.push({ label: 'Website setup (one-time)', cents: sub.build_amount_cents });
  items.push({ label: `${planLabel} — first month`, cents: sub.monthly_amount_cents });
  return insertCharge({
    subscription_id: sub.id, site_id: sub.site_id, kind: 'initial',
    line_items: items, amount_cents: sumCents(items), currency: sub.currency || 'USD',
    due_date: dueInDays(dueDays), status: 'due', provider: sub.provider,
  });
}

// A monthly collectible.
async function openRecurringCharge(sub, { planLabel = 'Stemfra subscription', when = new Date(), dueDays = 7 } = {}) {
  const items = [{ label: `${planLabel} — ${monthLabel(when)}`, cents: sub.monthly_amount_cents }];
  return insertCharge({
    subscription_id: sub.id, site_id: sub.site_id, kind: 'recurring',
    line_items: items, amount_cents: sumCents(items), currency: sub.currency || 'USD',
    due_date: dueInDays(dueDays), status: 'due', provider: sub.provider,
    metadata: { period: monthLabel(when) },
  });
}

async function markRequested(chargeId, { externalRef = null, by = null } = {}) {
  const { data, error } = await supabase.from('billing_charges')
    .update({ status: 'requested', external_ref: externalRef, requested_at: new Date().toISOString(), requested_by: by })
    .eq('id', chargeId).select('*').single();
  if (error) throw new Error(error.message);
  return data;
}

async function markPaid(chargeId, { by = null } = {}) {
  const { data, error } = await supabase.from('billing_charges')
    .update({ status: 'paid', paid_at: new Date().toISOString(), paid_by: by })
    .eq('id', chargeId).select('*').single();
  if (error) throw new Error(error.message);
  return data;
}

module.exports = {
  PROVIDERS, getActiveProvider, setActiveProvider, providerFor, getPlans,
  openInitialCharge, openRecurringCharge, markRequested, markPaid, monthLabel,
};
