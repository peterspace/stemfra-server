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
  // Email the business owner the invoice / payment request (best-effort).
  try { require('../billingEmails').sendInvoiceEmail(chargeId).catch(() => {}); } catch { /* email module optional */ }
  return data;
}

async function markPaid(chargeId, { by = null } = {}) {
  const { data, error } = await supabase.from('billing_charges')
    .update({ status: 'paid', paid_at: new Date().toISOString(), paid_by: by })
    .eq('id', chargeId).select('*').single();
  if (error) throw new Error(error.message);
  // Email the business owner a receipt (best-effort).
  try { require('../billingEmails').sendReceiptEmail(chargeId).catch(() => {}); } catch { /* email module optional */ }
  return data;
}

// Write the plan catalog (prices + offer copy). Validates the money fields the
// billing engine depends on; offer-copy fields (promise/features/etc.) are
// free-form and only consumed by the marketing page + CRM editor.
async function setPlans(next) {
  if (!next || typeof next !== 'object') throw new Error('plans must be an object');
  if (next.setup_cents != null && !Number.isInteger(next.setup_cents)) throw new Error('setup_cents must be an integer (cents)');
  const tiers = next.tiers || {};
  for (const [key, t] of Object.entries(tiers)) {
    if (t.monthly_cents != null && !Number.isInteger(t.monthly_cents)) throw new Error(`tier "${key}" monthly_cents must be an integer (cents)`);
  }
  const { data, error } = await supabase.from('crm_settings')
    .upsert({ key: 'billing_plans', value: next }, { onConflict: 'key' })
    .select('value').single();
  if (error) throw new Error(error.message);
  return data.value;
}

// Change a subscription's plan (tier). Updates the monthly rate + tier metadata
// immediately; the NEW rate applies to the next charge the cycle opener creates
// (we don't retroactively edit an already-open charge, and there's no automatic
// mid-cycle proration under manual Payoneer — Stripe will add real proration when
// it's the active provider). Entitlement (metadata.tier) flips now. Keeps a
// plan_history trail. Caller is responsible for any status guard.
async function changeSubscriptionPlan(subId, { tier, by = null } = {}) {
  const { data: sub, error: subErr } = await supabase.from('subscriptions').select('*').eq('id', subId).maybeSingle();
  if (subErr) throw new Error(subErr.message);
  if (!sub) throw new Error('Subscription not found');

  const plans = await getPlans();
  const tierDef = plans.tiers?.[tier];
  if (!tierDef) throw new Error(`Unknown plan "${tier}"`);
  if (tierDef.coming_soon) throw new Error(`The ${tierDef.label || tier} plan isn't available yet.`);
  if (tierDef.monthly_cents == null) throw new Error(`Plan "${tier}" has no price set.`);

  const fromCents = sub.monthly_amount_cents;
  const toCents = tierDef.monthly_cents;
  const fromTier = sub.metadata?.tier || null;
  if (fromTier === tier && fromCents === toCents) throw new Error('You are already on this plan.');

  const direction = toCents > fromCents ? 'upgrade' : 'downgrade';
  const at = new Date().toISOString();
  const metadata = {
    ...(sub.metadata || {}),
    tier,
    plan_label: tierDef.label || tier,
    plan_history: [
      ...((sub.metadata?.plan_history) || []),
      { from: fromTier, to: tier, from_cents: fromCents, to_cents: toCents, direction, by, at },
    ],
  };
  const { data: updated, error } = await supabase.from('subscriptions')
    .update({ monthly_amount_cents: toCents, metadata, updated_at: at })
    .eq('id', subId).select('*').single();
  if (error) throw new Error(error.message);
  return { subscription: updated, direction, fromCents, toCents, tier, label: tierDef.label || tier };
}

module.exports = {
  PROVIDERS, getActiveProvider, setActiveProvider, providerFor, getPlans, setPlans,
  openInitialCharge, openRecurringCharge, markRequested, markPaid, monthLabel,
  changeSubscriptionPlan,
};
