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

// Payment instructions per provider. Keep each self-contained + swappable.
// 2026-08-04: the Payoneer entries are GONE — Payoneer is dormant under the
// commission model (COMMISSION_MODEL.md §2) and its copy reached a real
// reminder email. The live collection story, everywhere: bank transfer to the
// Airwallex account details ON THE ATTACHED INVOICE, then a receipt upload in
// the dashboard. Keep this copy in lock-step with the invoice PDF's panel.
const PAY_INSTRUCTIONS = {
  default: 'Pay by bank transfer using the account details on the attached invoice, with the invoice number as your payment reference. Once sent, upload your transfer receipt in your dashboard under Billing, Invoices, so we can match your payment quickly. Prefer another method or need a hand? Just reply to this email.',
};
// Copy when we DO have a hosted pay link (Option B — "Pay now" button in the email).
const PAY_NOW_INSTRUCTIONS = {
  default: 'Use Settle invoice above to pay securely. Should you prefer another method, simply reply to this email.',
};
const payCopy = (provider, hasLink) =>
  hasLink ? (PAY_NOW_INSTRUCTIONS[provider] || PAY_NOW_INSTRUCTIONS.default)
          : (PAY_INSTRUCTIONS[provider] || PAY_INSTRUCTIONS.default);

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
  const content = await renderInvoicePdfBuffer({
    charge: c.charge,
    contact: c.ownerContact,
    billingProfile: c.ownerContact?.billing_profile || {},
    provider: c.provider,
    bank,
  });
  return { filename: `${invoiceNumber(c.charge)}.pdf`, content };
}

async function sendInvoiceEmail(chargeId) {
  try {
    const c = await loadChargeContext(chargeId);
    if (!c || !c.ownerEmail) return false;
    const dashboardUrl = await cmsMagicLink(c.ownerAuthUserId, '/billing');
    const attachments = [await invoiceAttachment(c)].filter(a => a.content);
    return await sendMail({
      fromName: 'Stemfra Billing',
      to: c.ownerEmail,
      subject: `Your Stemfra invoice — ${c.amountLabel}`,
      text: `Your Stemfra invoice for ${c.amountLabel}${c.dueLabel ? ` is due by ${c.dueLabel}` : ''} is attached as a PDF. You can also view it in your CMS under Billing.`,
      html: emails.platformInvoice({
        businessName: c.businessName, greetingName: c.greetingName,
        amountLabel: c.amountLabel, dueLabel: c.dueLabel,
        paymentInstructions: payCopy(c.provider, !!c.payUrl),
        dashboardUrl, payUrl: c.payUrl, invoiceRef: c.invoiceRef,
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
    const attachments = [await invoiceAttachment(c)].filter(a => a.content);
    return await sendMail({
      fromName: 'Stemfra Billing',
      to: c.ownerEmail,
      subject: `Payment reminder — ${c.amountLabel} past due`,
      text: `A reminder that your Stemfra invoice for ${c.amountLabel} is past due${c.dueLabel ? ` (was due ${c.dueLabel})` : ''} — it's attached as a PDF. Please settle it to keep your website online. Reply if you need help.`,
      html: emails.platformDunning({
        businessName: c.businessName, greetingName: c.greetingName,
        amountLabel: c.amountLabel, dueLabel: c.dueLabel, daysOverdue,
        paymentInstructions: payCopy(c.provider, !!c.payUrl),
        dashboardUrl, payUrl: c.payUrl, invoiceRef: c.invoiceRef,
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
      subject: `Payment received — ${c.amountLabel}`,
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
