// Payoneer provider — manual "Request a Payment". Payoneer has no public
// self-serve API for payment requests, so this provider does NOT call Payoneer;
// its job is to render a paste-ready request for staff (the fields the Payoneer
// dashboard asks for) and define labels. Status transitions are staff-driven
// (Mark Requested / Mark Paid) and handled by the generic billing service.
const KEY = 'payoneer';

function money(cents, currency) {
  return `${(Number(cents || 0) / 100).toFixed(2)} ${currency || 'USD'}`;
}

// Build the exact fields a Payoneer "Request a Payment" needs, from a charge +
// the resolved payer. Returned to the CRM as a paste-ready block.
function describeRequest(charge, payer = {}) {
  const items = charge.line_items || [];
  const description = items.length
    ? items.map(li => `${li.label} — ${money(li.cents, charge.currency)}`).join('  •  ')
    : (charge.note || 'Stemfra subscription');
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
  };
}

module.exports = { key: KEY, manual: true, describeRequest };
