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
  // metadata.invoice_ref overrides the derived number — the escape hatch for
  // re-issued invoices (the Airwallex mirror rejects a reused number, so a
  // replacement gets a suffixed ref and BOTH systems show the same one).
  if (charge?.metadata?.invoice_ref) return String(charge.metadata.invoice_ref);
  return `INV-${String(charge.id).replace(/-/g, '').slice(0, 8).toUpperCase()}`;
}

const methodLabel = (provider) =>
  provider === 'stripe' ? 'Card on file'
    // payoneer rows exist only in demo seeds; the provider is dormant and its
    // label on an invoice misleads, so it prints as the live method.
    : provider === 'pending' || provider === 'airwallex' || provider === 'payoneer' ? 'Bank transfer' : (provider || '—');

// Commission charges carry a metered breakdown ({period,rate,gmv_cents,...}), NOT
// {label,cents} rows — render a readable summary line instead. Returns null for other kinds.
function commissionItems(charge, cur) {
  if (charge.kind !== 'commission') return null;
  const li = (Array.isArray(charge.line_items) && charge.line_items[0]) || {};
  const rate = li.rate != null ? li.rate : 0;
  const pct = `${+(rate * 100).toFixed(2)}%`;
  const period = li.period ? ` (${li.period})` : '';
  // Itemize by income stream so the tenant sees exactly what the commission is on.
  const streams = [
    ['online bookings', li.bookings_online_cents],
    ['in-person (collected) sales', li.at_visit_collected_cents],
    // Cash basis since P14 (§1d). `?? runrate` keeps HISTORICAL commission rows
    // (stored line_items carry the pre-P14 `membership_runrate_cents` key) rendering.
    ['memberships', li.membership_collected_cents ?? li.membership_runrate_cents],
    ['product / package orders', li.orders_cents],
  ].filter(([, gmv]) => (gmv || 0) > 0);
  if (!streams.length) {
    return [{ label: `Stemfra commission${period} - no billable income this period`, cents: charge.amount_cents }];
  }
  const lines = streams.map(([name, gmv]) => ({
    label: `${pct} commission on ${name} (${money(gmv, cur)})`,
    cents: Math.round(rate * gmv),
  }));
  // Absorb any rounding drift into the last line so the parts sum to the billed total.
  lines[lines.length - 1].cents += charge.amount_cents - lines.reduce((s, l) => s + l.cents, 0);
  return lines;
}

// Draw the one-page invoice into a pdfkit doc. Caller creates + ends the doc
// (so it can pipe to an HTTP response OR collect a Buffer for an attachment).
function drawInvoice(doc, { charge, contact, billingProfile = {}, provider, bank }) {
  const cur = charge.currency || 'USD';
  const invNo = invoiceNumber(charge);
  const paid = charge.status === 'paid';

  const ink = '#1c1917', muted = '#78716c', hair = '#e7e5e4', accent = '#6366F1'; // accent = CMS indigo

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
  doc.font('Helvetica-Bold').fontSize(11).fillColor(paid ? '#16a34a' : accent)
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

  const items = commissionItems(charge, cur)
    || (Array.isArray(charge.line_items) && charge.line_items.length
      ? charge.line_items
      : [{ label: charge.kind === 'initial' ? 'Stemfra setup + first month' : 'Stemfra subscription', cents: charge.amount_cents }]);
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

  // ── Payment instructions ───────────────────────────────────────────────────
  // ALL unpaid invoices are paid by bank transfer to our Airwallex Global
  // Account (bank), referencing the invoice number; the tenant then uploads the
  // receipt in the CMS. Rendered as its own shaded panel for contrast.
  // (2026-08-04: was gated to commission/adjustment kinds while legacy
  // subscription charges kept per-provider one-liners — one of which still told
  // owners to expect a Payoneer payment request. Payoneer is dormant and the
  // collection story is uniform now, so the gate is bank-details-only.)
  const bankTransfer = !paid && bank;
  if (paid) {
    doc.font('Helvetica').fontSize(9).fillColor(muted).text(`Paid ${fmtDate(charge.paid_at)}. Thank you.`, 50, ty, { width: 495 });
    ty += 16;
  } else if (bankTransfer) {
    const bankLocation = [bank.bank_city, bank.bank_zip].filter(Boolean).join(' ');
    const rows = [
      bank.account_name && ['Account name', bank.account_name],
      bank.account_number && ['Account number', bank.account_number],
      bank.account_type && ['Account type', bank.account_type],
      bank.ach_routing && ['ACH routing', bank.ach_routing],
      bank.fedwire_routing && ['Fedwire routing', bank.fedwire_routing],
      bank.swift && ['SWIFT (international)', bank.swift],
      bank.bank_name && ['Bank name', bank.bank_name],
      bank.bank_address && ['Bank address', bank.bank_address],
      bankLocation && ['Bank city / ZIP', bankLocation],
      bank.country && ['Bank country', bank.country],
    ].filter(Boolean);
    const padX = 16, rowH = 14, innerW = 495 - padX * 2;
    // The payment terms now live INSIDE the box (under Reference) — wrap them at the inner
    // width and measure so the panel grows to contain them.
    const payText = `Payment due by ${fmtDate(charge.due_date)}. Please include the reference when you pay, then upload your payment receipt under Billing in your Stemfra dashboard so we can mark it paid.`;
    doc.font('Helvetica').fontSize(8.5);
    const payH = doc.heightOfString(payText, { width: innerW });
    // Height budget — keep in sync with the draw order below.
    const panelH = 14 + 16 + 10 + rows.length * rowH + 8 + 14 + 12 + payH + 14;
    // Shaded panel with a hairline border (own background = clear contrast). No accent bar.
    doc.save();
    doc.roundedRect(50, ty, 495, panelH, 7).fill('#f6f5f3');
    doc.roundedRect(50.5, ty + 0.5, 494, panelH - 1, 7).lineWidth(1).stroke('#e3e0da');
    doc.restore();
    let py = ty + 14;
    doc.font('Helvetica-Bold').fontSize(9.5).fillColor(ink).text('PAY BY BANK TRANSFER', 50 + padX, py); py += 16;
    // Divider under the heading (like the DESCRIPTION / AMOUNT rule), so it reads as a titled section.
    doc.moveTo(50 + padX, py).lineTo(545 - padX, py).strokeColor('#e3e0da').lineWidth(1).stroke(); py += 10;
    doc.fontSize(9);
    rows.forEach(([k, v]) => {
      doc.font('Helvetica').fillColor(muted).text(`${k}`, 50 + padX, py, { width: 118 });
      doc.font('Helvetica-Bold').fillColor(ink).text(String(v), 50 + padX + 122, py, { width: innerW - 122 });
      py += rowH;
    });
    py += 8;
    doc.font('Helvetica-Bold').fontSize(9.5).fillColor(accent).text(`Reference: ${invNo}`, 50 + padX, py); py += 14;
    // Divider under Reference → the payment terms read as a distinct block inside the box.
    py += 4;
    doc.moveTo(50 + padX, py).lineTo(545 - padX, py).strokeColor('#e3e0da').lineWidth(1).stroke(); py += 8;
    doc.font('Helvetica').fontSize(8.5).fillColor(muted).text(payText, 50 + padX, py, { width: innerW });
    ty += panelH + 14;

    // Commission explanation + contact, below the panel (the due-date/receipt terms moved inside).
    doc.font('Helvetica').fontSize(8.5).fillColor(muted);
    if (charge.kind === 'commission') {
      doc.text('This invoice is your Stemfra platform commission on the bookings and sales made through your Stemfra site during the service period above. See your Reports for the underlying transactions.', 50, ty, { width: 495 }); ty += 24;
    }
    doc.text('Questions about this invoice? billing@stemfra.com', 50, ty, { width: 495 });
  } else {
    // No bank details available (config gap) — stay truthful without naming a
    // dead provider. The Payoneer sentence that used to live here reached a real
    // reminder email on 2026-08-04.
    doc.font('Helvetica').fontSize(9).fillColor(muted).text('Payment is due by bank transfer. Your payment request email includes the account details, or write to billing@stemfra.com and we will send them.', 50, ty, { width: 495 });
  }

  // Footer pinned near the page bottom — must stay ABOVE A4's ~792pt bottom margin,
  // else pdfkit spills it onto a second page (that was the 800pt bug).
  doc.fontSize(8).fillColor(muted)
    .text('Stemfra - websites + booking for local businesses · stemfra.com', 50, 770, { width: 495, align: 'center' });
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
