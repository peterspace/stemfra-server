// System-A billing emails (N2, 2026-07-13). Stemfra billing its BUSINESS
// customers (build fee + monthly hosting). Two emails:
//   - invoice / payment request  → fired when a charge is marked "requested"
//   - receipt                    → fired when a charge is marked "paid"
// All best-effort (never fail the billing action). Provider-agnostic: the
// "how to pay" copy comes from PAY_INSTRUCTIONS keyed by the charge's provider,
// so switching Payoneer → Airwallex/Stripe is a copy edit here, nothing else.
const supabase = require('../config/supabase');
const emails = require('../templates/transactionalEmails');
const { sendMail } = require('./mailer');
const { cmsMagicLink } = require('./cmsMagicLink');
const { renderInvoicePdfBuffer, invoiceNumber } = require('./invoicePdf');
const { getCommissionBank } = require('./commission');

// How-to-pay copy: one bank-transfer instruction, recon-accurate (2026-08-12).
// The payment reference is the bare 8-char code (= the invoice number without
// the "INV-" prefix) — it fits USD bank memo fields (~10 char cap) so the recon
// engine can auto-match the incoming Airwallex deposit; payments confirm
// automatically, no receipt upload. Keep in lock-step with the invoice PDF's
// bank panel + the Airwallex invoice memo.
const bankTransferInstructions = (payRef) =>
  `Pay by bank transfer using the account details on the attached invoice. Include the payment reference ${payRef} and send the exact invoice amount; your payment is confirmed automatically once it arrives.`;

const money = (cents, cur = 'USD') =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: cur }).format((cents || 0) / 100);
const dateLabel = (d) =>
  d ? new Date(d).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : '';

async function loadChargeContext(chargeId) {
  const { data: c } = await supabase
    .from('billing_charges')
    .select(`
      id, site_id, kind, line_items, amount_cents, currency, status, due_date, paid_at,
      created_at, period_start, period_end, external_ref, provider, metadata,
      site:sites(subdomain,
        company:companies(name),
        owner:contacts!sites_owner_contact_id_fkey(email, auth_user_id, first_name, last_name, full_name, country, state, billing_profile))
    `)
    .eq('id', chargeId)
    .maybeSingle();
  if (!c || !c.site) return null;
  const cur = c.currency || 'USD';
  return {
    charge: c,
    businessName: c.site.company?.name || c.site.subdomain || null,
    greetingName: c.site.owner?.first_name || null,
    ownerEmail: c.site.owner?.email || null,
    ownerAuthUserId: c.site.owner?.auth_user_id || null,
    amountLabel: money(c.amount_cents, cur),
    dueLabel: dateLabel(c.due_date),
    paidLabel: dateLabel(c.paid_at),
    rows: (c.line_items || []).map((li) => ({ label: li.label, value: money(li.cents, cur) })),
    invoiceRef: invoiceNumber(c),
    payRef: String(c.id).slice(0, 8).toUpperCase(), // recon payment reference (fits bank memos)
    provider: c.provider || 'airwallex',
    // Option B: if staff pasted the provider's hosted pay link into external_ref
    // when issuing the request, the email shows a "Pay now" button pointing at it.
    payUrl: /^https?:\/\//i.test(c.external_ref || '') ? c.external_ref : null,
    ownerContact: c.site.owner || null,   // for the attached PDF's bill-to block
  };
}

// The branded invoice PDF as an email attachment ({filename, content:Buffer}).
async function invoiceAttachment(c) {
  // Bank details on EVERY unpaid attached invoice (2026-08-04). The CMS
  // download already included them for commission invoices; this path never
  // passed `bank` at all, so the EMAILED copy of the same invoice was missing
  // the block that tells the owner where to actually send the money.
  const bank = c.charge.status !== 'paid' ? await getCommissionBank().catch(() => null) : null;
  // P19: bill-to = the SITE's company identity (contact fallback inside).
  const { resolveBillingIdentity } = require('./billingProfile');
  const identity = await resolveBillingIdentity(c.charge.site_id).catch(() => null);
  const bp = identity?.profile || c.ownerContact?.billing_profile || {};
  const billTo = c.ownerContact
    ? { ...c.ownerContact, full_name: null, first_name: bp.first_name ?? c.ownerContact.first_name, last_name: bp.last_name ?? c.ownerContact.last_name, country: bp.country ?? c.ownerContact.country, state: bp.state ?? c.ownerContact.state }
    : c.ownerContact;
  const content = await renderInvoicePdfBuffer({
    charge: c.charge,
    contact: billTo,
    billingProfile: bp,
    provider: c.provider,
    bank,
  });
  return { filename: `${invoiceNumber(c.charge)}.pdf`, content };
}

// The canonical Airwallex invoice's FRESH hosted link + PDF bytes, when this
// charge has been mirrored (metadata.awx_invoice_id set by mirrorInvoice()).
// The hosted_url + pdf_url are short-lived signed URLs, so we re-mint them on
// every send via GET (the invoice itself is permanent). Returns null — caller
// then falls back to our own rendered PDF + CMS-billing link — if the charge is
// not mirrored or on any error, so Airwallex being down never blocks the email.
async function airwallexInvoiceAssets(ctx) {
  const awxId = ctx.charge?.metadata?.awx_invoice_id;
  if (!awxId) return null;
  try {
    const { awx } = require('./airwallexBilling');
    const inv = await awx(`/api/v1/billing/invoices/${awxId}`, { method: 'GET' });
    if (!inv?.hosted_url || !inv?.pdf_url) return null;
    const res = await fetch(inv.pdf_url);
    if (!res.ok) return null;
    const content = Buffer.from(await res.arrayBuffer());
    return { hostedUrl: inv.hosted_url, pdf: { filename: `${ctx.invoiceRef}.pdf`, content } };
  } catch (e) {
    console.error('[billingEmails.awxAssets]', e.message);
    return null;
  }
}

async function sendInvoiceEmail(chargeId) {
  try {
    const c = await loadChargeContext(chargeId);
    if (!c || !c.ownerEmail) return false;
    // $0 invoices auto-settle in Airwallex and there is nothing to collect — do
    // not send a payment request for them (Peter's call, 2026-08-12).
    if ((c.charge.amount_cents || 0) <= 0) return false;
    const dashboardUrl = await cmsMagicLink(c.ownerAuthUserId, '/billing');
    // Prefer the canonical Airwallex invoice: its hosted "View invoice online"
    // link (becomes card checkout once Payments is live) + its PDF. Fall back to
    // our own rendered PDF + the CMS billing page when the mirror is unavailable.
    const awxAssets = await airwallexInvoiceAssets(c);
    const attachments = (awxAssets?.pdf ? [awxAssets.pdf] : [await invoiceAttachment(c)]).filter(a => a && a.content);
    return await sendMail({
      fromName: 'Stemfra Billing',
      to: c.ownerEmail,
      subject: `Your Stemfra invoice: ${c.amountLabel}`,
      text: `Your Stemfra invoice for ${c.amountLabel}${c.dueLabel ? ` is due by ${c.dueLabel}` : ''} is attached as a PDF and can be viewed online. Pay by bank transfer with the payment reference ${c.payRef}; send the exact invoice amount (transfer fees are not part of your invoice) and your payment is confirmed automatically once it arrives.`,
      html: emails.platformInvoice({
        businessName: c.businessName, greetingName: c.greetingName,
        amountLabel: c.amountLabel, dueLabel: c.dueLabel,
        paymentInstructions: bankTransferInstructions(c.payRef),
        dashboardUrl, payUrl: c.payUrl, hostedUrl: awxAssets?.hostedUrl || null,
        invoiceRef: c.invoiceRef, payRef: c.payRef,
      }),
      attachments,
    });
  } catch (e) { console.error('[billingEmails.invoice]', e.message); return false; }
}

async function sendDunningEmail(chargeId) {
  try {
    const c = await loadChargeContext(chargeId);
    if (!c || !c.ownerEmail) return false;
    const due = c.charge.due_date ? new Date(c.charge.due_date) : null;
    const daysOverdue = due ? Math.max(0, Math.floor((Date.now() - due.getTime()) / 86400000)) : 0;
    const dashboardUrl = await cmsMagicLink(c.ownerAuthUserId, '/billing');
    const awxAssets = await airwallexInvoiceAssets(c);
    const attachments = (awxAssets?.pdf ? [awxAssets.pdf] : [await invoiceAttachment(c)]).filter(a => a && a.content);
    return await sendMail({
      fromName: 'Stemfra Billing',
      to: c.ownerEmail,
      subject: `Payment reminder: ${c.amountLabel} past due`,
      text: `A reminder that your Stemfra invoice for ${c.amountLabel} is past due${c.dueLabel ? ` (was due ${c.dueLabel})` : ''}. It's attached as a PDF and can be viewed online. Pay by bank transfer with the payment reference ${c.payRef}. Please settle it to keep your website online. Reply if you need help.`,
      html: emails.platformDunning({
        businessName: c.businessName, greetingName: c.greetingName,
        amountLabel: c.amountLabel, dueLabel: c.dueLabel, daysOverdue,
        paymentInstructions: bankTransferInstructions(c.payRef),
        dashboardUrl, payUrl: c.payUrl, hostedUrl: awxAssets?.hostedUrl || null,
        invoiceRef: c.invoiceRef,
      }),
      attachments,
    });
  } catch (e) { console.error('[billingEmails.dunning]', e.message); return false; }
}

async function sendReceiptEmail(chargeId) {
  try {
    const c = await loadChargeContext(chargeId);
    if (!c || !c.ownerEmail) return false;
    const dashboardUrl = await cmsMagicLink(c.ownerAuthUserId, '/billing/history');
    const att = await invoiceAttachment(c);
    const attachments = att.content ? [{ filename: att.filename.replace(/^INV-/, 'RECEIPT-'), content: att.content }] : [];
    return await sendMail({
      fromName: 'Stemfra Billing',
      to: c.ownerEmail,
      subject: `Payment received: ${c.amountLabel}`,
      text: `We've received your payment of ${c.amountLabel}. Thank you! Your receipt is attached as a PDF, and also in your CMS under Billing.`,
      html: emails.platformReceipt({
        businessName: c.businessName, amountLabel: c.amountLabel, paidLabel: c.paidLabel,
        dashboardUrl, invoiceRef: c.invoiceRef,
      }),
      attachments,
    });
  } catch (e) { console.error('[billingEmails.receipt]', e.message); return false; }
}

module.exports = { loadChargeContext, sendInvoiceEmail, sendReceiptEmail, sendDunningEmail };
