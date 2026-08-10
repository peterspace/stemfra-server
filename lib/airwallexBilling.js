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

// ─── Billing customer per owner contact (id cached in contacts.billing_profile) ─
async function ensureBillingCustomer(ctx) {
  // The charge context's owner join has no contact id — resolve it via the site.
  const { data: siteRow } = await supabase.from('sites')
    .select('owner_contact_id').eq('id', ctx.charge.site_id).maybeSingle();
  const ownerContactId = siteRow?.owner_contact_id || null;
  let profile = {};
  if (ownerContactId) {
    const { data: c } = await supabase.from('contacts').select('billing_profile').eq('id', ownerContactId).maybeSingle();
    profile = c?.billing_profile || {};
    if (profile.awx_customer_id) return profile.awx_customer_id;
  }
  const customer = await awx('/api/v1/billing/billing_customers/create', {
    body: {
      request_id: crypto.randomUUID(),
      name: ctx.businessName || ctx.ownerEmail || 'Stemfra customer',
      email: ctx.ownerEmail || undefined,
      nickname: ctx.charge.site?.subdomain || undefined,
      default_billing_currency: ctx.charge.currency || 'USD',
      type: 'BUSINESS',
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

    const [customerId, productId] = [await ensureBillingCustomer(ctx), await sharedProductId()];

    const invoice = await awx('/api/v1/billing/invoices/create', {
      body: {
        request_id: crypto.randomUUID(),
        billing_customer_id: customerId,
        currency: ctx.charge.currency || 'USD',
        collection_method: 'OUT_OF_BAND',
        ...(ctx.charge.due_date ? { due_at: `${ctx.charge.due_date}T23:59:59+0000` } : { days_until_due: 7 }),
        number: ctx.invoiceRef, // our INV-XXXXXXXX — same number in both systems
        memo: (ctx.charge.line_items || []).map(li => li.label).join(' · ').slice(0, 500) || 'Stemfra invoice',
        footer: 'Pay by bank transfer using the account details on your Stemfra invoice, with the invoice number as your payment reference.',
        metadata: { charge_id: chargeId, site_id: ctx.charge.site_id, kind: ctx.charge.kind },
      },
    });

    await awx(`/api/v1/billing/invoices/${invoice.id}/add_line_items`, {
      body: {
        request_id: crypto.randomUUID(),
        line_items: (ctx.charge.line_items || []).map(li => ({
          quantity: 1,
          price: {
            description: li.label,
            flat_amount: Math.round(Number(li.cents) || 0) / 100,
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
