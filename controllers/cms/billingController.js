// CMS client-facing billing (System A) — the OWNER sees their own Stemfra
// subscription + charge history and edits their billing contact. Read-only on
// the money; the staff CRM drives collection. Owner-auth + ownership-gated.
// NOTE: config/supabase.js exports the client directly (service-role).
const supabase = require('../../config/supabase');
const { verifySiteOwnership, resolveContactId } = require('../../middleware/cmsAuth');
const billing = require('../../lib/billing');
const { logSiteActivity } = require('../../lib/activity');
const { streamInvoicePdf } = require('../../lib/invoicePdf');
const { getCommissionBank } = require('../../lib/commission');
const { resolveBillingIdentity, saveCompanyBillingProfile, IDENTITY_KEYS } = require('../../lib/billingProfile');

const CONTACT_COLS = 'full_name, first_name, last_name, email, phone, country, state, billing_profile';

// The plans an owner can self-serve switch to: sellable tiers only (drop
// coming-soon), ordered, trimmed to what the UI needs.
function sellablePlans(catalog) {
  return Object.entries(catalog?.tiers || {})
    .filter(([, t]) => !t.coming_soon && t.monthly_cents != null)
    .map(([key, t]) => ({ key, label: t.label || key, monthly_cents: t.monthly_cents, promise: t.promise || '', order: t.order ?? 99 }))
    .sort((a, b) => a.order - b.order);
}

// GET /api/cms/billing?siteId= — subscription + charges + billing contact
async function getBilling(req, res) {
  const siteId = req.query.siteId;
  if (!siteId) return res.status(400).json({ error: 'siteId is required' });
  const site = await verifySiteOwnership(req.cmsUser.id, siteId);
  if (!site) return res.status(403).json({ error: 'Not your site' });

  const { data: sub } = await supabase.from('subscriptions')
    .select('id, status, provider, build_amount_cents, monthly_amount_cents, currency, started_at, current_period_end, cancel_at_period_end, canceled_at, metadata')
    .eq('site_id', siteId).maybeSingle();

  // Every charge for this site: commission + domain adjustments (subscription_id NULL)
  // AND any subscription charges. Query by site_id so commission invoices show even
  // when there is no subscription (the commission model has none).
  const { data: chargeRows } = await supabase.from('billing_charges')
    .select('id, kind, line_items, amount_cents, currency, status, due_date, period_start, period_end, paid_at, created_at, metadata')
    .eq('site_id', siteId).order('created_at', { ascending: false });
  const charges = chargeRows || [];

  const contactId = await resolveContactId(req.cmsUser.id);
  let contact = null;
  if (contactId) {
    const { data } = await supabase.from('contacts').select(CONTACT_COLS).eq('id', contactId).maybeSingle();
    contact = data || null;
  }

  // Self-serve plan switching: the available tiers + which one they're on.
  const catalog = await billing.getPlans();
  const availablePlans = sellablePlans(catalog);
  const currentTier = sub?.metadata?.tier || null;
  const canChangePlan = !!sub && ['active', 'past_due'].includes(sub.status);
  // Active collection method drives the adaptive Payment-method panel.
  const provider = sub?.provider || (await billing.getActiveProvider());

  // Bank details for the Invoices "pay by bank transfer" copy panel (only when the
  // owner has commission/adjustment invoices, which are paid by transfer).
  const hasBankTransfer = charges.some((c) => c.kind === 'commission' || c.kind === 'adjustment');
  const commissionBank = hasBankTransfer ? await getCommissionBank() : null;

  // P19: the invoice identity for THIS business (company profile, contact
  // fallback) — what the Billing details tab edits + invoices print.
  const billingIdentity = await resolveBillingIdentity(siteId);

  return res.json({ subscription: sub || null, charges, contact, billingIdentity, availablePlans, currentTier, canChangePlan, provider, commissionBank });
}

// POST /api/cms/billing/change-plan { siteId, tier }
// Owner self-serve upgrade/downgrade. New monthly rate takes effect on the next
// billing cycle; tier entitlement updates immediately. No proration under manual
// Payoneer (Stripe will add it when it's the active provider).
async function changePlan(req, res) {
  const { siteId, tier } = req.body || {};
  if (!siteId || !tier) return res.status(400).json({ error: 'siteId and tier are required' });
  const site = await verifySiteOwnership(req.cmsUser.id, siteId);
  if (!site) return res.status(403).json({ error: 'Not your site' });

  const { data: sub } = await supabase.from('subscriptions')
    .select('id, status, monthly_amount_cents, metadata').eq('site_id', siteId).maybeSingle();
  if (!sub) return res.status(400).json({ error: 'No subscription to change yet.' });
  if (!['active', 'past_due'].includes(sub.status)) {
    return res.status(400).json({ error: 'Plan changes unlock once your first payment is in — reach out and we’ll sort it.' });
  }

  try {
    const result = await billing.changeSubscriptionPlan(sub.id, { tier, by: req.cmsUser.id });
    // Best-effort audit so staff know to request the new amount next cycle.
    logSiteActivity({
      siteId, action: 'plan_changed', actorName: req.cmsUser.email,
      entityType: 'subscription', entityId: sub.id,
      details: { direction: result.direction, from_cents: result.fromCents, to_cents: result.toCents, tier: result.tier },
    });
    return res.json({
      subscription: result.subscription,
      direction: result.direction,
      effective: 'next_cycle',
      message: `You're ${result.direction === 'upgrade' ? 'upgraded' : 'switched'} to ${result.label}. The new rate applies from your next monthly invoice.`,
    });
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }
}

// PATCH /api/cms/billing/contact — name + full billing address + tax id.
// P19 (2026-09-01): WITH a siteId the write goes to that site's COMPANY
// billing profile (per-business invoice identity, prefilled from the contact);
// WITHOUT one it stays the legacy contact write (ProfilePage's account-level
// name edit). country/state stay mirrored on the contacts columns for the
// legacy path (Payoneer payer reads them).
const PROFILE_KEYS = ['line1', 'line2', 'city', 'postal_code', 'tax_id', 'tax_type'];
async function updateBillingContact(req, res) {
  const contactId = await resolveContactId(req.cmsUser.id);
  if (!contactId) return res.status(404).json({ error: 'No contact for this account' });
  const b = req.body || {};

  if (b.siteId) {
    const site = await verifySiteOwnership(req.cmsUser.id, b.siteId);
    if (!site) return res.status(403).json({ error: 'Not your site' });
    const patch = {};
    for (const k of IDENTITY_KEYS) if (b[k] !== undefined) patch[k] = b[k] || null;
    if (!Object.keys(patch).length) return res.status(400).json({ error: 'Nothing to update' });
    try {
      const { profile } = await saveCompanyBillingProfile(b.siteId, patch);
      const billingIdentity = { profile, source: 'company' };
      return res.json({ billingIdentity });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }
  const patch = {};
  if (b.first_name !== undefined) patch.first_name = b.first_name;
  if (b.last_name !== undefined) patch.last_name = b.last_name;
  if (b.country !== undefined) patch.country = b.country;
  if (b.state !== undefined) patch.state = b.state;

  const profilePatch = {};
  for (const k of PROFILE_KEYS) if (b[k] !== undefined) profilePatch[k] = b[k] || null;
  if (Object.keys(profilePatch).length) {
    const { data: cur } = await supabase.from('contacts').select('billing_profile').eq('id', contactId).maybeSingle();
    patch.billing_profile = { ...(cur?.billing_profile || {}), ...profilePatch };
  }

  if (!Object.keys(patch).length) return res.status(400).json({ error: 'Nothing to update' });
  const { data, error } = await supabase.from('contacts').update(patch).eq('id', contactId).select(CONTACT_COLS).single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ contact: data });
}

// POST /api/cms/billing/cancel { siteId, reasons?, feedback? } — owner self-serve
// cancel at period end. We stop opening new monthly charges (the cycle sweeper
// skips cancel_at_period_end); staff complete offboarding + any final invoice.
async function cancelSubscription(req, res) {
  const { siteId, reasons, feedback } = req.body || {};
  if (!siteId) return res.status(400).json({ error: 'siteId is required' });
  const site = await verifySiteOwnership(req.cmsUser.id, siteId);
  if (!site) return res.status(403).json({ error: 'Not your site' });
  const { data: sub } = await supabase.from('subscriptions').select('id, status, metadata').eq('site_id', siteId).maybeSingle();
  if (!sub) return res.status(400).json({ error: 'No subscription to cancel.' });
  if (!['active', 'past_due'].includes(sub.status)) return res.status(400).json({ error: 'This subscription can’t be canceled from here.' });

  const metadata = { ...(sub.metadata || {}), cancel_reasons: reasons || null, cancel_feedback: feedback || null };
  const { data, error } = await supabase.from('subscriptions')
    .update({ cancel_at_period_end: true, canceled_at: new Date().toISOString(), metadata })
    .eq('id', sub.id).select('*').single();
  if (error) return res.status(500).json({ error: error.message });
  logSiteActivity({ siteId, action: 'subscription_cancel_requested', actorName: req.cmsUser.email, entityType: 'subscription', entityId: sub.id, details: { reasons, feedback } });
  return res.json({ subscription: data });
}

// POST /api/cms/billing/reactivate { siteId } — clear a pending cancellation.
async function reactivateSubscription(req, res) {
  const { siteId } = req.body || {};
  if (!siteId) return res.status(400).json({ error: 'siteId is required' });
  const site = await verifySiteOwnership(req.cmsUser.id, siteId);
  if (!site) return res.status(403).json({ error: 'Not your site' });
  const { data: sub } = await supabase.from('subscriptions').select('id').eq('site_id', siteId).maybeSingle();
  if (!sub) return res.status(400).json({ error: 'No subscription.' });
  const { data, error } = await supabase.from('subscriptions')
    .update({ cancel_at_period_end: false, canceled_at: null }).eq('id', sub.id).select('*').single();
  if (error) return res.status(500).json({ error: error.message });
  logSiteActivity({ siteId, action: 'subscription_reactivated', actorName: req.cmsUser.email, entityType: 'subscription', entityId: sub.id });
  return res.json({ subscription: data });
}

// GET /api/cms/billing/charges/:chargeId/invoice — branded PDF for one charge.
// Fetched with the owner's Bearer token (the CMS opens it as a blob).
async function invoicePdf(req, res) {
  const { data: charge } = await supabase.from('billing_charges')
    .select('id, site_id, kind, line_items, amount_cents, currency, status, due_date, paid_at, created_at, provider')
    .eq('id', req.params.chargeId).maybeSingle();
  if (!charge) return res.status(404).json({ error: 'Invoice not found' });
  const site = await verifySiteOwnership(req.cmsUser.id, charge.site_id);
  if (!site) return res.status(403).json({ error: 'Not your invoice' });

  const contactId = await resolveContactId(req.cmsUser.id);
  let contact = null;
  if (contactId) {
    const { data } = await supabase.from('contacts').select(CONTACT_COLS).eq('id', contactId).maybeSingle();
    contact = data || null;
  }
  // EVERY unpaid invoice is paid by bank transfer (2026-08-04, was gated to
  // commission/adjustment) → include our Airwallex bank details so the tenant
  // knows exactly where to pay. Matches the emailed attachment.
  const bank = charge.status !== 'paid' ? await getCommissionBank().catch(() => null) : null;
  // P19: bill-to = the SITE's company identity (contact fallback inside).
  const identity = await resolveBillingIdentity(charge.site_id);
  const bp = identity?.profile || contact?.billing_profile || {};
  const billTo = { ...contact, full_name: null, first_name: bp.first_name ?? contact?.first_name, last_name: bp.last_name ?? contact?.last_name, country: bp.country ?? contact?.country, state: bp.state ?? contact?.state };
  streamInvoicePdf(res, { charge, contact: billTo, billingProfile: bp, provider: charge.provider, bank });
}

// GET /api/cms/billing/charges/:chargeId/hosted-invoice
// Returns a FRESH hosted-invoice URL for the mirrored Airwallex invoice (the
// canonical "View invoice online" page — see docs/AIRWALLEX_INVOICING.md). The
// hosted link is a short-lived signed URL, so we re-mint it on every call. 404
// when the charge was never mirrored → the CMS falls back to the PDF preview.
async function hostedInvoice(req, res) {
  const { data: charge } = await supabase.from('billing_charges')
    .select('id, site_id, metadata').eq('id', req.params.chargeId).maybeSingle();
  if (!charge) return res.status(404).json({ error: 'Invoice not found' });
  const site = await verifySiteOwnership(req.cmsUser.id, charge.site_id);
  if (!site) return res.status(403).json({ error: 'Not your invoice' });
  const awxId = charge.metadata?.awx_invoice_id;
  if (!awxId) return res.status(404).json({ error: 'No hosted invoice' });
  try {
    const { awx } = require('../../lib/airwallexBilling');
    const inv = await awx(`/api/v1/billing/invoices/${awxId}`, { method: 'GET' });
    if (!inv?.hosted_url) return res.status(404).json({ error: 'No hosted invoice' });
    return res.json({ url: inv.hosted_url });
  } catch (e) {
    console.error('[cms.hostedInvoice]', e.message);
    return res.status(502).json({ error: 'Could not load the hosted invoice' });
  }
}

// POST /api/cms/billing/charges/:chargeId/receipt { receiptUrl }
// Owner confirms an invoice payment by attaching a payment receipt (image/PDF uploaded
// first via /api/cms/site-uploads/upload). Stored on the charge for staff source-of-funds
// verification (Airwallex may ask); staff then mark it paid from the CRM. Status is NOT
// changed here — staff verify → mark paid. Owner + ownership gated.
async function submitReceipt(req, res) {
  const { receiptUrl } = req.body || {};
  if (!receiptUrl || typeof receiptUrl !== 'string') return res.status(400).json({ error: 'receiptUrl is required' });
  const { data: charge } = await supabase.from('billing_charges')
    .select('id, site_id, metadata, status').eq('id', req.params.chargeId).maybeSingle();
  if (!charge) return res.status(404).json({ error: 'Invoice not found' });
  const site = await verifySiteOwnership(req.cmsUser.id, charge.site_id);
  if (!site) return res.status(403).json({ error: 'Not your invoice' });

  const metadata = { ...(charge.metadata || {}), receipt_url: receiptUrl, receipt_uploaded_at: new Date().toISOString() };
  const { data, error } = await supabase.from('billing_charges')
    .update({ metadata, updated_at: new Date().toISOString() }).eq('id', charge.id)
    .select('id, status, metadata').single();
  if (error) return res.status(500).json({ error: error.message });
  logSiteActivity({
    siteId: charge.site_id, action: 'invoice_receipt_uploaded', actorName: req.cmsUser.email,
    entityType: 'billing_charge', entityId: charge.id, details: { receipt_url: receiptUrl },
  });
  return res.json({ charge: data });
}

// POST /api/cms/billing/charges/:chargeId/claim — "I've paid" (recon R4).
// Stamps payment_claimed_at + runs an on-demand check of Airwallex deposits for
// THIS charge. Returns { status: 'paid' } when a settled deposit unambiguously
// matches, else { status: 'processing' } (bank transfers can take 1 to 2
// business days; the sweep + webhook keep watching). Owner + ownership gated.
async function claimPayment(req, res) {
  const { data: charge } = await supabase.from('billing_charges')
    .select('*').eq('id', req.params.chargeId).maybeSingle();
  if (!charge) return res.status(404).json({ error: 'Invoice not found' });
  const site = await verifySiteOwnership(req.cmsUser.id, charge.site_id);
  if (!site) return res.status(403).json({ error: 'Not your invoice' });
  if (charge.status === 'paid') return res.json({ status: 'paid' });
  if (!['due', 'requested'].includes(charge.status)) return res.status(400).json({ error: 'This invoice is not payable' });

  logSiteActivity({
    siteId: charge.site_id, action: 'invoice_payment_claimed', actorName: req.cmsUser.email,
    entityType: 'billing_charge', entityId: charge.id,
  });
  try {
    const { claimCharge } = require('../../lib/reconEngine');
    const { readReconSettings } = require('../../lib/reconSweeper');
    const s = await readReconSettings().catch(() => ({}));
    const out = await claimCharge(charge, { nearToleranceCents: s.near_tolerance_cents });
    return res.json(out);
  } catch (e) {
    // The check itself failing (e.g. Airwallex down) still leaves the claim
    // stamped — the sweep picks it up. Show the tenant "processing".
    console.error('[cms claim] check failed:', e.message);
    return res.json({ status: 'processing' });
  }
}

module.exports = { getBilling, updateBillingContact, changePlan, cancelSubscription, reactivateSubscription, invoicePdf, hostedInvoice, submitReceipt, claimPayment };
