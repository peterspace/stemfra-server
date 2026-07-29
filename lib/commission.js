// Commission-model config (P13). Stemfra's business model is a FLAT commission on
// ALL tenant income (no tiers, no setup fee, no minimum). Stored as a single
// key/value row in crm_settings (same pattern as billing_active_provider /
// billing_plans in lib/billing/index.js) so it's editable without a deploy.
//
// Full plan: stemfra_server/docs/COMMISSION_MODEL.md.
const supabase = require('../config/supabase'); // single-var import (repo convention)

const COMMISSION_DEFAULTS = {
  rate: 0.05, // 5% of tenant income
  basis: 'all', // online bookings + at-visit collected + memberships + orders
  currency: 'USD',
};

async function getCommissionConfig() {
  const { data } = await supabase
    .from('crm_settings')
    .select('value')
    .eq('key', 'commission')
    .maybeSingle();
  return { ...COMMISSION_DEFAULTS, ...(data?.value || {}) };
}

async function setCommissionConfig(patch) {
  const next = { ...(await getCommissionConfig()), ...(patch || {}) };
  const { error } = await supabase
    .from('crm_settings')
    .upsert({ key: 'commission', value: next }, { onConflict: 'key' });
  if (error) throw error;
  return next;
}

// Stemfra's receiving bank account for commission invoices (Airwallex Global Account).
// Stored in crm_settings (not committed to a repo) so the invoice layer can print it.
// This is our OWN receiving account (meant to appear on invoices we send), not a secret key.
async function getCommissionBank() {
  const { data } = await supabase
    .from('crm_settings')
    .select('value')
    .eq('key', 'commission_bank')
    .maybeSingle();
  return data?.value || null;
}

async function setCommissionBank(details) {
  const { error } = await supabase
    .from('crm_settings')
    .upsert({ key: 'commission_bank', value: details }, { onConflict: 'key' });
  if (error) throw error;
  return details;
}

module.exports = {
  getCommissionConfig, setCommissionConfig, COMMISSION_DEFAULTS,
  getCommissionBank, setCommissionBank,
};
