// Client confirmation email — sent to the person who submitted the form.
// Brand-trust touchpoint, rendered through the unified base (templates/baseEmail.js).

const { renderEmail, T, FONT } = require('./baseEmail');

const subjectDescriptions = {
  'AI Automation':        "We'll review your automation requirements and come prepared with ideas for your discovery call.",
  'Software Development': "We'll review your project scope and come prepared with an approach for your discovery call.",
  'Consultancy':          "We'll review your situation and come prepared with strategic thinking for your discovery call.",
  'Support':              "We'll review your support needs and reach out with the right plan for your systems.",
  'General':              "We'll review your message and get back to you with the right person to help.",
};

const STEPS = [
  { title: 'Review', body: 'We read every message personally — usually within a few hours.' },
  { title: 'Reach out', body: "We'll email you within one business day to schedule a free 30-minute discovery call." },
  { title: 'Discovery call', body: 'A focused conversation to understand your needs and share how we can help.' },
];

// Numbered "what happens next" list, styled on the base tokens.
function stepsTable() {
  const rows = STEPS.map((s, i) => `
    <tr>
      <td style="padding:16px 18px;width:44px;vertical-align:top;${i ? `border-top:1px solid ${T.hairline};` : ''}">
        <div style="width:26px;height:26px;border-radius:50%;background:${T.accent};color:#fff;font-family:${FONT};font-size:12px;font-weight:700;text-align:center;line-height:26px;">${i + 1}</div>
      </td>
      <td style="padding:16px 18px 16px 0;${i ? `border-top:1px solid ${T.hairline};` : ''}">
        <p style="margin:0 0 2px;font-family:${FONT};font-size:14px;font-weight:600;color:${T.ink};">${s.title}</p>
        <p style="margin:0;font-family:${FONT};font-size:13px;color:${T.body};line-height:1.55;">${s.body}</p>
      </td>
    </tr>`).join('');
  return `
    <p style="margin:26px 0 10px;font-family:${FONT};font-size:11px;font-weight:600;color:${T.muted};text-transform:uppercase;letter-spacing:.06em;text-align:center;">What happens next</p>
    <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="background:${T.panel};border:1px solid ${T.hairline};border-radius:12px;">${rows}</table>`;
}

function buildConfirmationEmail(data) {
  const { firstName, subject, message } = data;
  const desc = subjectDescriptions[subject] || subjectDescriptions['General'];

  const html = renderEmail({
    preheader: "We've received your message — here's what happens next.",
    heading: `We've received your message, ${firstName}.`,
    paragraphs: [desc],
    bodyHtml: stepsTable(),
    note: 'Questions? Just reply to this email.',
    reason: "You're receiving this because you submitted a contact form at stemfra.com · 8 The Green STE 12434, Dover, DE 19901",
  });

  return {
    subject: `We received your message — STEMfra`,
    html,
    text: `Hi ${firstName},\n\nThank you for reaching out to STEMfra.\n\n${desc}\n\nWhat happens next:\n1. Review — we read every message personally, usually within a few hours.\n2. Reach out — we'll email you within one business day to schedule a free 30-minute discovery call.\n3. Discovery call — a focused conversation to understand your needs.\n\nYour message:\n${message}\n\nQuestions? Reply to this email or write to support@stemfra.com\n\n— STEMfra`,
  };
}

module.exports = buildConfirmationEmail;
