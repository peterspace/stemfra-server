// Branded invoice PDF for a System-A billing_charge (Stemfra → business owner).
// Generated server-side with pdfkit (built-in Helvetica — no font files). Used by
// the CMS Billing "Invoices" View/Download. Stripe's native invoice_pdf is used
// instead once Stripe is the active provider.
const path = require('path');
const PDFDocument = require('pdfkit');

const LOGO_PATH = path.join(__dirname, '..', 'assets', 'stemfra_logo.png');

// Seller = Stemfra (us). Mirror the address used on the marketing site footer.
const SELLER = {
  name: 'Stemfra LLC',
  lines: ['8 The Green STE B', 'Dover, DE 19901', 'United States'],
  email: 'billing@stemfra.com',
};

const money = (cents, cur = 'USD') =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: cur }).format((cents || 0) / 100);
const fmtDate = (d) => (d ? new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—');

function invoiceNumber(charge) {
  return `INV-${String(charge.id).replace(/-/g, '').slice(0, 8).toUpperCase()}`;
}

const methodLabel = (provider) =>
  provider === 'payoneer' ? 'Payoneer' : provider === 'stripe' ? 'Card on file' : (provider || '—');

// Draw the one-page invoice into a pdfkit doc. Caller creates + ends the doc
// (so it can pipe to an HTTP response OR collect a Buffer for an attachment).
function drawInvoice(doc, { charge, contact, billingProfile = {}, provider }) {
  const cur = charge.currency || 'USD';
  const invNo = invoiceNumber(charge);
  const paid = charge.status === 'paid';

  const ink = '#1c1917', muted = '#78716c', hair = '#e7e5e4';

  // ── Header: logo + seller (left) · INVOICE meta (right) ───────────────────
  try { doc.image(LOGO_PATH, 50, 46, { width: 30, height: 30 }); } catch { /* logo optional */ }
  doc.fillColor(ink).font('Helvetica-Bold').fontSize(18).text(SELLER.name, 88, 52);
  doc.font('Helvetica').fontSize(9).fillColor(muted);
  SELLER.lines.forEach((l, i) => doc.text(l, 50, 88 + i * 12));
  doc.text(SELLER.email, 50, 88 + SELLER.lines.length * 12);

  doc.font('Helvetica-Bold').fontSize(26).fillColor(ink).text('INVOICE', 350, 46, { width: 195, align: 'right' });
  doc.font('Helvetica').fontSize(9).fillColor(muted)
    .text(`Invoice ${invNo}`, 350, 80, { width: 195, align: 'right' })
    .text(`Issued ${fmtDate(charge.created_at)}`, 350, 92, { width: 195, align: 'right' })
    .text(`Due ${fmtDate(charge.due_date)}`, 350, 104, { width: 195, align: 'right' })
    .text(`Payment method: ${methodLabel(provider)}`, 350, 116, { width: 195, align: 'right' });
  doc.font('Helvetica-Bold').fontSize(11).fillColor(paid ? '#16a34a' : '#b45309')
    .text(paid ? 'PAID' : 'DUE', 350, 132, { width: 195, align: 'right' });

  // ── Bill to ──────────────────────────────────────────────────────────────
  let y = 172;
  doc.fillColor(muted).font('Helvetica-Bold').fontSize(9).text('BILL TO', 50, y); y += 14;
  const billName = contact?.full_name || [contact?.first_name, contact?.last_name].filter(Boolean).join(' ') || '—';
  doc.fillColor(ink).font('Helvetica-Bold').fontSize(11).text(billName, 50, y); y += 15;
  doc.font('Helvetica').fontSize(9).fillColor(muted);
  const cityLine = [billingProfile.city, contact?.state, billingProfile.postal_code].filter(Boolean).join(', ');
  [billingProfile.line1, billingProfile.line2, cityLine, contact?.country, contact?.email,
    billingProfile.tax_id ? `${billingProfile.tax_type || 'Tax'} ID: ${billingProfile.tax_id}` : null]
    .filter(Boolean)
    .forEach((l) => { doc.text(l, 50, y); y += 12; });

  // ── Service period ─────────────────────────────────────────────────────────
  let ty = Math.max(y + 26, 290);
  if (charge.period_start || charge.period_end) {
    doc.fillColor(muted).font('Helvetica').fontSize(9)
      .text(`Service period: ${fmtDate(charge.period_start)} – ${fmtDate(charge.period_end)}`, 50, ty);
    ty += 20;
  }

  // ── Line items ───────────────────────────────────────────────────────────
  doc.fillColor(muted).font('Helvetica-Bold').fontSize(9)
    .text('DESCRIPTION', 50, ty).text('AMOUNT', 350, ty, { width: 195, align: 'right' });
  doc.moveTo(50, ty + 14).lineTo(545, ty + 14).strokeColor(hair).stroke(); ty += 24;

  const items = Array.isArray(charge.line_items) && charge.line_items.length
    ? charge.line_items
    : [{ label: charge.kind === 'initial' ? 'Stemfra setup + first month' : 'Stemfra subscription', cents: charge.amount_cents }];
  doc.font('Helvetica').fontSize(10);
  items.forEach((it) => {
    doc.fillColor(ink).text(it.label || 'Item', 50, ty, { width: 290 });
    doc.text(money(it.cents, cur), 350, ty, { width: 195, align: 'right' });
    ty += 20;
  });

  // ── Totals (Subtotal · Tax · Total) ────────────────────────────────────────
  const subtotal = items.reduce((s, it) => s + (it.cents || 0), 0) || charge.amount_cents;
  const tax = (charge.metadata && charge.metadata.tax_cents) || 0;
  const total = charge.amount_cents;
  const row = (label, val, bold) => {
    doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(bold ? 12 : 10).fillColor(bold ? ink : muted)
      .text(label, 350, ty, { width: 100, align: 'left' })
      .text(money(val, cur), 450, ty, { width: 95, align: 'right' });
    ty += bold ? 22 : 16;
  };
  doc.moveTo(350, ty + 2).lineTo(545, ty + 2).strokeColor(hair).stroke(); ty += 12;
  row('Subtotal', subtotal, false);
  row('Tax', tax, false);
  doc.moveTo(350, ty).lineTo(545, ty).strokeColor(hair).stroke(); ty += 8;
  row('Total', total, true);
  ty += 14;

  // ── Payment note ─────────────────────────────────────────────────────────
  doc.font('Helvetica').fontSize(9).fillColor(muted);
  if (paid) {
    doc.text(`Paid ${fmtDate(charge.paid_at)}. Thank you.`, 50, ty, { width: 495 });
  } else if (provider === 'payoneer') {
    doc.text('Payment is collected via the Payoneer payment request sent to your account email.', 50, ty, { width: 495 });
  } else {
    doc.text('Payment will be collected via your saved payment method on the due date.', 50, ty, { width: 495 });
  }

  doc.fontSize(8).fillColor(muted)
    .text('Stemfra — websites + booking for local businesses · stemfra.com', 50, 790, { width: 495, align: 'center' });
}

// Stream to an HTTP response (CMS View/Download). Caller has auth'd + verified.
function streamInvoicePdf(res, opts) {
  const invNo = invoiceNumber(opts.charge);
  const doc = new PDFDocument({ size: 'A4', margin: 50 });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${invNo}.pdf"`);
  doc.pipe(res);
  drawInvoice(doc, opts);
  doc.end();
}

// Render the same PDF to a Buffer (for email attachments). Returns Promise<Buffer>.
function renderInvoicePdfBuffer(opts) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    drawInvoice(doc, opts);
    doc.end();
  });
}

module.exports = { streamInvoicePdf, renderInvoicePdfBuffer, invoiceNumber };
