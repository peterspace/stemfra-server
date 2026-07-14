// Internal notification email — sent to support@stemfra.com on new submission.
// Compact triage layout, rendered through the unified base (templates/baseEmail.js).

const { renderEmail, quoteBlock } = require('./baseEmail');

function buildNotificationEmail(data) {
  const { firstName, lastName, email, company, subject, message, createdAt } = data;
  const date = new Date(createdAt).toLocaleString('en-GB', { dateStyle: 'full', timeStyle: 'short' });

  const html = renderEmail({
    preheader: `${firstName} ${lastName} — ${subject}`,
    heading: `New message from ${firstName} ${lastName}`,
    paragraphs: [`Received ${date} via the contact form on stemfra.com.`],
    rows: [
      { label: 'Name', value: `${firstName} ${lastName}` },
      { label: 'Email', value: email },
      { label: 'Company', value: company || '—' },
      { label: 'Subject', value: subject },
    ],
    bodyHtml: quoteBlock(message, 'Message'),
    cta: { label: `Reply to ${firstName}`, url: `mailto:${email}?subject=${encodeURIComponent(`Re: ${subject} — STEMfra`)}` },
    reason: 'Submitted via the contact form on stemfra.com · STEMfra · 8 The Green STE 12434, Dover, DE 19901',
  });

  return {
    subject: `[${subject}] New message from ${firstName} ${lastName}`,
    html,
    text: `New website lead\n\nName: ${firstName} ${lastName}\nEmail: ${email}\nCompany: ${company || '—'}\nSubject: ${subject}\n\nMessage:\n${message}`,
  };
}

module.exports = buildNotificationEmail;
