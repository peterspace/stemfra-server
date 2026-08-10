// Airwallex provider — manual bank-transfer collection (the commission-model
// standard, COMMISSION_MODEL.md §2). Like Payoneer this is a manual provider:
// it never calls an API. The tenant pays by bank transfer to Stemfra's
// Airwallex Global Account (details from crm_settings.commission_bank, rendered
// on the invoice PDF + the CMS Billing bank panel), using the invoice number as
// the payment reference, then uploads a receipt. Status transitions are
// staff-driven (Mark Requested / Mark Paid) via the generic billing service.
const KEY = 'airwallex';

function money(cents, currency) {
  return `${(Number(cents || 0) / 100).toFixed(2)} ${currency || 'USD'}`;
}

// Paste-ready summary for staff (the CRM "describe request" panel): what the
// tenant owes and the reference their transfer must carry. The actual bank
// details live on the invoice PDF (lib/invoicePdf.js reads commission_bank).
function describeRequest(charge, payer = {}) {
  const items = charge.line_items || [];
  const description = items.length
    ? items.map(li => `${li.label} — ${money(li.cents, charge.currency)}`).join('  •  ')
    : (charge.note || 'Stemfra invoice');
  return {
    provider: KEY,
    payer: {
      name:    payer.name    || '',
      email:   payer.email   || '',
      country: payer.country || '',
      state:   payer.state   || '',
    },
    amount:   (Number(charge.amount_cents || 0) / 100).toFixed(2),
    currency: charge.currency || 'USD',
    dueDate:  charge.due_date || null,
    description,
    note: 'Tenant pays by bank transfer to the Airwallex account on the invoice PDF, reference = the invoice number, then uploads the receipt under Billing.',
  };
}

module.exports = { key: KEY, manual: true, describeRequest };
