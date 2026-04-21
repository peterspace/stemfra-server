// Internal notification email — sent to support@stemfra.com on new submission

const subjectColors = {
  'AI Automation':        '#6366f1',
  'Software Development': '#3b82f6',
  'Consultancy':          '#8b5cf6',
  'Support':              '#10b981',
  'General':              '#6b7280',
};

function buildNotificationEmail(data) {
  const { firstName, lastName, email, company, subject, message, createdAt } = data;
  const color = subjectColors[subject] || '#6366f1';
  const date  = new Date(createdAt).toLocaleString('en-GB', { dateStyle: 'full', timeStyle: 'short' });

  const html = `
<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1.0"/></head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:40px 0;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.08);">

        <tr><td style="background:#0f0f0f;padding:28px 40px;">
          <span style="color:#fff;font-size:20px;font-weight:700;letter-spacing:-.5px;">STEMfra</span>
          <span style="color:#6b7280;font-size:13px;margin-left:12px;">Internal Notification</span>
        </td></tr>

        <tr><td style="padding:32px 40px 0;">
          <span style="display:inline-block;background:${color}18;color:${color};border:1px solid ${color}40;padding:4px 14px;border-radius:20px;font-size:12px;font-weight:600;letter-spacing:.5px;text-transform:uppercase;">${subject}</span>
          <h1 style="margin:16px 0 4px;font-size:22px;font-weight:700;color:#0f0f0f;letter-spacing:-.5px;">New message from ${firstName} ${lastName}</h1>
          <p style="margin:0;color:#6b7280;font-size:13px;">${date}</p>
        </td></tr>

        <tr><td style="padding:28px 40px;">
          <table width="100%" cellpadding="0" cellspacing="0" style="background:#f9fafb;border-radius:12px;overflow:hidden;">
            <tr>
              <td style="padding:12px 20px;border-bottom:1px solid #e5e7eb;width:35%;"><span style="font-size:12px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:.4px;">Name</span></td>
              <td style="padding:12px 20px;border-bottom:1px solid #e5e7eb;"><span style="font-size:14px;color:#1f2937;">${firstName} ${lastName}</span></td>
            </tr>
            <tr>
              <td style="padding:12px 20px;border-bottom:1px solid #e5e7eb;"><span style="font-size:12px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:.4px;">Email</span></td>
              <td style="padding:12px 20px;border-bottom:1px solid #e5e7eb;"><a href="mailto:${email}" style="font-size:14px;color:${color};text-decoration:none;">${email}</a></td>
            </tr>
            <tr>
              <td style="padding:12px 20px;border-bottom:1px solid #e5e7eb;"><span style="font-size:12px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:.4px;">Company</span></td>
              <td style="padding:12px 20px;border-bottom:1px solid #e5e7eb;"><span style="font-size:14px;color:#1f2937;">${company || '—'}</span></td>
            </tr>
            <tr>
              <td style="padding:12px 20px;"><span style="font-size:12px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:.4px;">Subject</span></td>
              <td style="padding:12px 20px;"><span style="font-size:14px;color:#1f2937;">${subject}</span></td>
            </tr>
          </table>
        </td></tr>

        <tr><td style="padding:0 40px 32px;">
          <p style="margin:0 0 10px;font-size:13px;font-weight:600;color:#374151;text-transform:uppercase;letter-spacing:.5px;">Message</p>
          <div style="background:#f9fafb;border-left:3px solid ${color};border-radius:0 8px 8px 0;padding:16px 20px;">
            <p style="margin:0;font-size:15px;color:#1f2937;line-height:1.7;white-space:pre-wrap;">${message}</p>
          </div>
        </td></tr>

        <tr><td style="padding:0 40px 40px;">
          <a href="mailto:${email}?subject=Re: ${subject} — STEMfra" style="display:inline-block;background:#0f0f0f;color:#fff;text-decoration:none;padding:12px 24px;border-radius:100px;font-size:14px;font-weight:600;">Reply to ${firstName}</a>
        </td></tr>

        <tr><td style="background:#f4f4f5;padding:20px 40px;text-align:center;">
          <p style="margin:0;font-size:12px;color:#9ca3af;">STEMfra · 8 The Green STE 12434, Dover, DE 19901 · support@stemfra.com</p>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;

  return {
    subject: `[${subject}] New message from ${firstName} ${lastName}`,
    html,
    text: `New contact submission\n\nName: ${firstName} ${lastName}\nEmail: ${email}\nCompany: ${company || '—'}\nSubject: ${subject}\n\nMessage:\n${message}`,
  };
}

module.exports = buildNotificationEmail;
