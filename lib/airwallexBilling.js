// Airwallex Billing invoice mirror (2026-08-10, Peter's call after studying
// the Billing docs). billing_charges stays the LEDGER + system of record; this
// module mirrors each issued invoice into Airwallex Billing as an official
// OUT_OF_BAND invoice (the manual bank-transfer model — no Airwallex Payments
// approval needed). Why mirror at all: official numbered invoices inside
// Airwallex build the trading history their card-KYB team looks at, and when
// Payments activates we flip collection_method to digital-link/auto-charge
// with zero re-architecture (Batch 2b lands for free).
//
// Wiring: lib/billing markRequested → mirrorInvoice (create + line items +
// finalize; awx ids stored on charge.metadata) · markPaid → markInvoicePaid ·
// void → voidInvoice. Everything is BEST-EFFORT and fire-and-forget — our
// billing never blocks on Airwallex. Gate: AIRWALLEX_MIRROR_ENABLED !== 'false'
// + both creds present. API shapes pinned from the API reference 2026-08-10
// (paths: /api/v1/billing/{billing_customers,products,invoices}/...).
const crypto = require('crypto');
const supabase = require('../config/supabase');
const { getCommissionBank } = require('./commission');

const API_BASE = process.env.AIRWALLEX_API_BASE || 'https://api.airwallex.com';
const CLIENT_ID = process.env.AIRWALLEX_CLIENT_ID;
const API_KEY = process.env.AIRWALLEX_API_KEY;

function isConfigured() {
  return process.env.AIRWALLEX_MIRROR_ENABLED !== 'false' && !!(CLIENT_ID && API_KEY);
}

// ─── Auth (tokens last ~30 min; cache 25) ────────────────────────────────────
let _token = { value: null, at: 0 };
async function accessToken() {
  if (_token.value && Date.now() - _token.at < 25 * 60 * 1000) return _token.value;
  const res = await fetch(`${API_BASE}/api/v1/authentication/login`, {
    method: 'POST',
    headers: { 'x-client-id': CLIENT_ID, 'x-api-key': API_KEY, 'Content-Type': 'application/json' },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.token) throw new Error(`Airwallex login failed (${res.status}): ${JSON.stringify(data).slice(0, 200)}`);
  _token = { value: data.token, at: Date.now() };
  return data.token;
}

async function awx(path, { method = 'POST', body } = {}) {
  const token = await accessToken();
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = new Error(`Airwallex ${method} ${path} (${res.status}): ${data.message || data.code || JSON.stringify(data).slice(0, 200)}`);
    e.awx = data;
    throw e;
  }
  return data;
}

// ─── Shared "Stemfra services" product (ad-hoc invoice line items need one) ──
async function sharedProductId() {
  const { data } = await supabase.from('crm_settings').select('value').eq('key', 'airwallex_billing').maybeSingle();
  if (data?.value?.product_id) return data.value.product_id;
  const product = await awx('/api/v1/billing/products/create', {
    body: {
      request_id: crypto.randomUUID(),
      name: 'Stemfra services',
      description: 'Website service charges: commission, domains, adjustments. One shared product; the detail lives on each invoice line.',
    },
  });
  const value = { ...(data?.value || {}), product_id: product.id };
  await supabase.from('crm_settings').upsert({ key: 'airwallex_billing', value }, { onConflict: 'key' });
  return product.id;
}

// ─── Named products for commission + domain charges (2026-08-12, Peter created
// these by hand in the Airwallex dashboard: "Platform commission" +
// "Domain registration") — looked up by name and cached, same pattern as
// sharedProductId(), so nothing here hardcodes a raw product id. Every other
// charge kind keeps using the generic "Stemfra services" product.
async function findOrCacheProductId(cacheKey, productName) {
  const { data } = await supabase.from('crm_settings').select('value').eq('key', 'airwallex_billing').maybeSingle();
  if (data?.value?.[cacheKey]) return data.value[cacheKey];
  const res = await awx('/api/v1/billing/products', { method: 'GET' });
  const items = res.items || res.data || [];
  const found = items.find(p => p.name === productName);
  if (!found) throw new Error(`Airwallex product "${productName}" not found — create it in the dashboard first.`);
  const value = { ...(data?.value || {}), [cacheKey]: found.id };
  await supabase.from('crm_settings').upsert({ key: 'airwallex_billing', value }, { onConflict: 'key' });
  return found.id;
}
const commissionProductId = () => findOrCacheProductId('commission_product_id', 'Platform commission');
const domainProductId = () => findOrCacheProductId('domain_product_id', 'Domain registration');

/** Domain charges are technically kind='adjustment' (a shared bucket with
 *  other one-off adjustments), so kind alone can't tell them apart — the
 *  metadata.type marker domainController.js/domainsController.js stamp on
 *  every domain charge is what actually distinguishes them. */
async function productIdFor(charge) {
  if (charge.metadata?.type === 'domain_registration') return domainProductId();
  if (charge.kind === 'commission') return commissionProductId();
  return sharedProductId();
}

/** The full bank-transfer block for the invoice `memo` — built from the same
 *  CommissionBank fields the CMS BankPanel and our own invoicePdf.js bank
 *  panel already render, so it can never drift out of sync with the real
 *  account details. Matches the layout Airwallex's own docs use for the
 *  out-of-band collection method (bank details in memo, terms in footer).
 *  No SWIFT line — Peter's call on the live test invoice (2026-08-11): our
 *  transfers are domestic ACH/Fedwire, so SWIFT is noise here even though
 *  our own invoicePdf.js bank panel still shows it for the rare wire payer. */
function bankMemo(bank) {
  // City / ZIP presented exactly as Airwallex's own Global Account panel does
  // (the source tenants cross-check against): the state stays with the city
  // ("Woodhaven, NY") and the ZIP Code is the bare postcode ("11421"). Direct
  // field mapping — bank_city already holds "City, State", bank_zip the code.
  const lines = [
    ['Account name', bank.account_name],
    ['Account number', bank.account_number],
    ['Account type', bank.account_type],
    ['ACH routing', bank.ach_routing],
    ['Fedwire routing', bank.fedwire_routing],
    ['Bank name', bank.bank_name],
    ['Bank address', bank.bank_address],
    ['Bank city', bank.bank_city],
    ['ZIP Code', bank.bank_zip],
    ['Bank country', bank.country],
  ].filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`);
  return ['Kindly send your payment using the following:', ...lines].join('\n');
}

// ─── Billing customer per owner contact (id cached in contacts.billing_profile) ─

// contacts.country stores the human NAME (the CMS LocationPicker emits names);
// Airwallex wants ISO-2. Map the countries we serve; ISO-2 values pass through.
const COUNTRY_ISO = {
  'united states': 'US', 'united states of america': 'US', usa: 'US',
  canada: 'CA', 'united kingdom': 'GB', australia: 'AU', nigeria: 'NG',
};
function isoCountry(name) {
  const raw = String(name || '').trim();
  if (/^[A-Z]{2}$/.test(raw)) return raw;
  return COUNTRY_ISO[raw.toLowerCase()] || null;
}

// The tenant's billing address (from the CMS Billing → Details form: line1/
// line2/city/postal_code in billing_profile + country/state on the contact).
// Needed so Automatic Tax Calculation can determine jurisdiction when it is
// enabled later. Returns null unless there is a resolvable country + street/city.
function addressFrom(contact) {
  if (!contact) return null;
  const p = contact.billing_profile || {};
  const country_code = isoCountry(contact.country);
  const street = [p.line1, p.line2].filter(Boolean).join(', ');
  if (!country_code || (!street && !p.city)) return null;
  return {
    ...(street ? { street } : {}),
    ...(p.city ? { city: p.city } : {}),
    ...(contact.state ? { state: contact.state } : {}),
    ...(p.postal_code ? { postcode: p.postal_code } : {}),
    country_code,
  };
}

async function ensureBillingCustomer(ctx) {
  // The charge context's owner join has no contact id — resolve it via the site.
  const { data: siteRow } = await supabase.from('sites')
    .select('owner_contact_id').eq('id', ctx.charge.site_id).maybeSingle();
  const ownerContactId = siteRow?.owner_contact_id || null;
  let contact = null;
  if (ownerContactId) {
    const { data: c } = await supabase.from('contacts')
      .select('billing_profile, country, state').eq('id', ownerContactId).maybeSingle();
    contact = c || null;
  }
  const profile = contact?.billing_profile || {};
  const address = addressFrom(contact);

  // Airwallex's hosted invoice uses the customer NICKNAME as the "Bill to"
  // heading (not the name), so nickname = business name — else tenants see the
  // raw subdomain on the invoice they now receive. Fall back to subdomain.
  const nickname = ctx.businessName || ctx.charge.site?.subdomain || undefined;

  if (profile.awx_customer_id) {
    // Existing customer: push the current address + nickname (best-effort) so
    // tax has fresh location data and the Bill-to heading stays correct — their
    // update only touches provided fields.
    const patch = { ...(address ? { address } : {}), ...(nickname ? { nickname } : {}) };
    if (Object.keys(patch).length) {
      try { await awx(`/api/v1/billing/billing_customers/${profile.awx_customer_id}/update`, { body: patch }); }
      catch (e) { console.error('[airwallex] customer update failed:', e.message); }
    }
    return profile.awx_customer_id;
  }

  const customer = await awx('/api/v1/billing/billing_customers/create', {
    body: {
      request_id: crypto.randomUUID(),
      name: ctx.businessName || ctx.ownerEmail || 'Stemfra customer',
      email: ctx.ownerEmail || undefined,
      nickname,
      default_billing_currency: ctx.charge.currency || 'USD',
      type: 'BUSINESS',
      ...(address ? { address } : {}),
      metadata: { site_id: ctx.charge.site_id, ...(ownerContactId ? { contact_id: ownerContactId } : {}) },
    },
  });
  if (ownerContactId) {
    await supabase.from('contacts')
      .update({ billing_profile: { ...profile, awx_customer_id: customer.id } })
      .eq('id', ownerContactId);
  }
  return customer.id;
}

// billing_charges.line_items is only {label, cents} rows for invoice-style
// charges; commission charges store METERING detail (rate/gmv_cents/period)
// there instead. Normalize to displayable lines, and fall back to one line at
// the charge total whenever the labeled lines don't add up to it.
function monthLabelFromPeriod(period) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(period || ''));
  if (!m) return null;
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, 1))
    .toLocaleString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' });
}
function normalizedLineItems(charge) {
  const labeled = (charge.line_items || [])
    .filter(li => li && li.label != null && li.cents != null)
    .map(li => ({ label: String(li.label), cents: Math.round(Number(li.cents) || 0) }));
  const total = Math.round(Number(charge.amount_cents) || 0);
  if (labeled.length && labeled.reduce((s, i) => s + i.cents, 0) === total) return labeled;
  const meter = (charge.line_items || []).find(li => li && (li.period || li.rate != null)) || {};
  const label = charge.kind === 'commission'
    ? ['Platform commission', meter.rate != null ? `${Math.round(meter.rate * 100)}% of sales` : null,
       monthLabelFromPeriod(meter.period)].filter(Boolean).join(', ')
    : `Stemfra ${charge.kind || 'service'} charge`;
  return [{ label, cents: total }];
}

async function patchChargeMetadata(chargeId, patch) {
  const { data } = await supabase.from('billing_charges').select('metadata').eq('id', chargeId).maybeSingle();
  await supabase.from('billing_charges')
    .update({ metadata: { ...(data?.metadata || {}), ...patch } })
    .eq('id', chargeId);
}

/**
 * Mirror one issued billing_charges row into Airwallex as a finalized
 * OUT_OF_BAND invoice (create → add line items → finalize). Idempotent via
 * charge.metadata.awx_invoice_id. Returns { invoiceId, number, pdfUrl } or
 * null when disabled/already mirrored/failed (failures are logged, never thrown).
 */
async function mirrorInvoice(chargeId) {
  if (!isConfigured()) return null;
  try {
    // loadChargeContext lives in billingEmails (lazy require avoids a cycle:
    // billing → billingEmails → billing).
    const { loadChargeContext } = require('./billingEmails');
    const ctx = await loadChargeContext(chargeId);
    if (!ctx) return null;
    if (ctx.charge.metadata?.awx_invoice_id) return { invoiceId: ctx.charge.metadata.awx_invoice_id, already: true };

    const [customerId, productId, bank] = [
      await ensureBillingCustomer(ctx),
      await productIdFor(ctx.charge),
      await getCommissionBank(),
    ];
    const lineItems = normalizedLineItems(ctx.charge);

    // Airwallex rejects a due_at in the past — for an already-overdue charge
    // (e.g. mirrored after dunning started) fall back to due-tomorrow.
    const futureDue = ctx.charge.due_date
      && new Date(`${ctx.charge.due_date}T23:59:59Z`).getTime() > Date.now() + 60000;
    const dueLabel = ctx.charge.due_date
      ? new Date(`${ctx.charge.due_date}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
      : null;

    // Layout verified live against a real Airwallex-hosted invoice + PDF
    // (2026-08-11): memo renders prominently above the line items, footer
    // renders below the total — matches the layout Airwallex's own docs use
    // for the out-of-band collection method.
    const invoice = await awx('/api/v1/billing/invoices/create', {
      body: {
        request_id: crypto.randomUUID(),
        billing_customer_id: customerId,
        currency: ctx.charge.currency || 'USD',
        collection_method: 'OUT_OF_BAND',
        ...(futureDue ? { due_at: `${ctx.charge.due_date}T23:59:59+0000` }
          : { days_until_due: ctx.charge.due_date ? 1 : 7 }),
        number: ctx.invoiceRef, // our INV-XXXXXXXX — same number in both systems
        memo: bankMemo(bank),
        footer: `Payment due by ${dueLabel || 'the due date on this invoice'}. Include the payment reference ${ctx.payRef} with your transfer and send the exact invoice amount; bank or transfer fees are not part of your invoice. Your payment is confirmed automatically once it arrives.`,
        metadata: { charge_id: chargeId, site_id: ctx.charge.site_id, kind: ctx.charge.kind },
      },
    });

    await awx(`/api/v1/billing/invoices/${invoice.id}/add_line_items`, {
      body: {
        request_id: crypto.randomUUID(),
        line_items: lineItems.map(li => ({
          quantity: 1,
          price: {
            description: li.label,
            flat_amount: li.cents / 100,
            pricing_model: 'FLAT',
            product_id: productId,
          },
        })),
      },
    });

    const finalized = await awx(`/api/v1/billing/invoices/${invoice.id}/finalize`, {
      body: { request_id: crypto.randomUUID() },
    });

    await patchChargeMetadata(chargeId, {
      awx_invoice_id: invoice.id,
      awx_invoice_number: finalized.number || invoice.number || ctx.invoiceRef,
      ...(finalized.pdf_url ? { awx_pdf_url: finalized.pdf_url } : {}),
    });
    console.log(`[airwallex] mirrored charge ${chargeId} → invoice ${invoice.id} (${finalized.number || ctx.invoiceRef})`);
    return { invoiceId: invoice.id, number: finalized.number || ctx.invoiceRef, pdfUrl: finalized.pdf_url || null };
  } catch (e) {
    console.error('[airwallex] mirrorInvoice failed:', e.message);
    return null;
  }
}

/** Mark the mirrored invoice paid (the charge was settled out of band). */
async function markInvoicePaid(chargeId) {
  if (!isConfigured()) return null;
  try {
    const { data } = await supabase.from('billing_charges').select('metadata').eq('id', chargeId).maybeSingle();
    const awxId = data?.metadata?.awx_invoice_id;
    if (!awxId) return null;
    await awx(`/api/v1/billing/invoices/${awxId}/mark_as_paid`, { body: { request_id: crypto.randomUUID() } });
    console.log(`[airwallex] invoice ${awxId} marked paid (charge ${chargeId})`);
    return { invoiceId: awxId };
  } catch (e) {
    // An already-paid invoice erroring is fine — the states agree.
    console.error('[airwallex] markInvoicePaid failed:', e.message);
    return null;
  }
}

/** Void the mirrored invoice (finalized + unpaid only, per their lifecycle). */
async function voidInvoice(chargeId) {
  if (!isConfigured()) return null;
  try {
    const { data } = await supabase.from('billing_charges').select('metadata').eq('id', chargeId).maybeSingle();
    const awxId = data?.metadata?.awx_invoice_id;
    if (!awxId) return null;
    await awx(`/api/v1/billing/invoices/${awxId}/void`, { body: { request_id: crypto.randomUUID() } });
    console.log(`[airwallex] invoice ${awxId} voided (charge ${chargeId})`);
    return { invoiceId: awxId };
  } catch (e) {
    console.error('[airwallex] voidInvoice failed:', e.message);
    return null;
  }
}

module.exports = { isConfigured, mirrorInvoice, markInvoicePaid, voidInvoice, awx, accessToken };
