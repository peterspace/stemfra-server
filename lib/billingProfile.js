// Per-business billing identity (P19 item 1, 2026-09-01). One owner login can
// run several businesses (companies) that need DISTINCT invoice identities, so
// the authoritative identity for a site's invoices, statements and publish
// gate is `companies.billing_profile` (jsonb) — prefilled from the owner
// contact at migration/first save, editable per site at Account → Billing →
// Billing details. `contacts.billing_profile` + the contact name/country/state
// columns remain the per-LOGIN fallback (and keep the awx_customer_id cache —
// the Airwallex payer stays contact-level on purpose; do not move it).
//
// Identity shape (all optional strings):
//   first_name, last_name, country, state, line1, line2, city, postal_code,
//   tax_id, tax_type
const supabase = require('../config/supabase');

const IDENTITY_KEYS = [
  'first_name', 'last_name', 'country', 'state',
  'line1', 'line2', 'city', 'postal_code', 'tax_id', 'tax_type',
];

const nonEmpty = (v) => v != null && String(v).trim() !== '';
const pickIdentity = (obj) => {
  const out = {};
  for (const k of IDENTITY_KEYS) if (obj && obj[k] !== undefined) out[k] = obj[k] ?? null;
  return out;
};

/**
 * The billing identity for a SITE: the company profile when it has data,
 * merged over the owner-contact fallback (per-field, so a partial company
 * profile still shows the contact's remaining fields).
 * @returns {{ profile, source: 'company'|'contact', companyId, contactId } | null}
 */
async function resolveBillingIdentity(siteId) {
  const { data: site } = await supabase
    .from('sites')
    .select('id, company_id, owner_contact_id, company:companies(id, billing_profile), owner:contacts!sites_owner_contact_id_fkey(id, first_name, last_name, country, state, billing_profile)')
    .eq('id', siteId)
    .maybeSingle();
  if (!site) return null;

  const c = site.owner || {};
  const contactIdentity = {
    first_name: c.first_name ?? null,
    last_name: c.last_name ?? null,
    country: c.country ?? null,
    state: c.state ?? null,
    ...pickIdentity(c.billing_profile || {}),
  };

  const companyBp = pickIdentity(site.company?.billing_profile || {});
  const hasCompany = Object.values(companyBp).some(nonEmpty);

  return {
    profile: hasCompany ? { ...contactIdentity, ...companyBp } : contactIdentity,
    source: hasCompany ? 'company' : 'contact',
    companyId: site.company_id,
    contactId: site.owner_contact_id,
  };
}

/**
 * Merge a patch into the SITE's company billing profile. Prefill: when the
 * company profile is still empty, the contact fallback is written in first so
 * a partial edit never loses the rest of the identity.
 */
async function saveCompanyBillingProfile(siteId, patch) {
  const identity = await resolveBillingIdentity(siteId);
  if (!identity?.companyId) throw new Error('Site has no company');

  const { data: company } = await supabase
    .from('companies').select('billing_profile').eq('id', identity.companyId).maybeSingle();
  const current = pickIdentity(company?.billing_profile || {});
  const base = Object.values(current).some(nonEmpty) ? current : pickIdentity(identity.profile);
  const merged = { ...base, ...pickIdentity(patch) };

  const { error } = await supabase
    .from('companies')
    .update({ billing_profile: merged })
    .eq('id', identity.companyId);
  if (error) throw new Error(error.message);
  return { profile: merged, companyId: identity.companyId };
}

module.exports = { resolveBillingIdentity, saveCompanyBillingProfile, IDENTITY_KEYS };
