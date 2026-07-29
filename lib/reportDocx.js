// Owner revenue report → a real, editable .docx (native Word table, not an
// image) using the `docx` package. Complements the PDF (Playwright) + CSV.
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  WidthType, AlignmentType, HeadingLevel, BorderStyle,
} = require('docx');

const money = (c) => '$' + ((c || 0) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const GREY = 'F5F5F5';
const HAIR = { style: BorderStyle.SINGLE, size: 2, color: 'E0E0E0' };
const cellBorders = { top: HAIR, bottom: HAIR, left: HAIR, right: HAIR };

function cell(text, { bold = false, align = AlignmentType.LEFT, shade } = {}) {
  return new TableCell({
    borders: cellBorders,
    ...(shade ? { shading: { fill: shade } } : {}),
    children: [new Paragraph({ alignment: align, children: [new TextRun({ text: String(text ?? ''), bold, size: 18 })] })],
  });
}

async function renderReportDocx(m) {
  const header = new TableRow({
    tableHeader: true,
    children: [
      cell('Date', { bold: true, shade: GREY }),
      cell('Service', { bold: true, shade: GREY }),
      cell('How paid', { bold: true, shade: GREY }),
      cell('Status', { bold: true, shade: GREY }),
      cell('Amount', { bold: true, align: AlignmentType.RIGHT, shade: GREY }),
    ],
  });
  const rows = m.transactions.map((t) => new TableRow({
    children: [
      cell(t.date), cell(t.service), cell(t.howPaid), cell(t.status),
      cell((t.kind === 'refunded' ? '-' : '') + money(t.cents), { align: AlignmentType.RIGHT }),
    ],
  }));
  const totalRow = new TableRow({
    children: [
      cell('Total collected + due', { bold: true, shade: GREY }),
      cell('', { shade: GREY }), cell('', { shade: GREY }), cell('', { shade: GREY }),
      cell(money(m.totalCents), { bold: true, align: AlignmentType.RIGHT, shade: GREY }),
    ],
  });
  const table = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: m.transactions.length ? [header, ...rows, totalRow] : [header, new TableRow({ children: [cell('No revenue in this period.'), cell(''), cell(''), cell(''), cell('')] })],
  });

  const setAside = money(Math.round((m.totalCents || 0) * 0.27));
  const line = (text, opts = {}) => new Paragraph({ spacing: { after: 120 }, children: [new TextRun({ text, size: 20, ...opts })] });

  const doc = new Document({
    sections: [{
      children: [
        new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun({ text: m.businessName, bold: true })] }),
        new Paragraph({ spacing: { after: 240 }, children: [new TextRun({ text: `Revenue report · ${m.fromLabel} – ${m.toLabel}`, color: '777777', size: 20 })] }),
        line(`Total revenue: ${money(m.totalCents)}`, { bold: true }),
        line(`Paid online: ${money(m.onlineCents)}    ·    Collected at visit: ${money(m.atVisitCents)}`),
        line(`Customers: ${m.customers.total} (${m.customers.new} new, ${m.customers.returning} returning)`),
        ...(m.membershipMrrCents > 0 ? [line(`Recurring memberships: ${money(m.membershipMrrCents)}/mo from ${m.membershipCount} active member${m.membershipCount === 1 ? '' : 's'} (monthly run-rate, separate from the one-time revenue above).`)] : []),
        ...(m.atVisitDueCents > 0 ? [line(`Of the at-visit total, ${money(m.atVisitDueCents)} is still marked as due (not yet collected).`)] : []),
        ...(m.refundedCents > 0 ? [line(`Refunded in this period: -${money(m.refundedCents)} (not included in totals).`, { color: 'B91C1C' })] : []),
        new Paragraph({ spacing: { before: 120, after: 120 }, children: [] }),
        table,
        new Paragraph({ spacing: { before: 280, after: 60 }, children: [new TextRun({ text: 'Putting money aside for taxes', bold: true, size: 20 })] }),
        line(`Many self-employed owners set aside roughly 25–30% of their income for taxes — on ${money(m.totalCents)} that's about ${setAside} to keep on hand.`),
        new Paragraph({ children: [new TextRun({ text: 'This is a general guide, not tax advice — your actual taxes depend on your situation and location. Check with a tax professional.', italics: true, color: '999999', size: 16 })] }),
      ],
    }],
  });
  return Packer.toBuffer(doc);
}

module.exports = { renderReportDocx };
