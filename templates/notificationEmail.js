// Internal notification email — sent to support@stemfra.com on new submission.
// Compact, dashboard-style layout optimised for fast triage.

function buildNotificationEmail(data) {
  const { firstName, lastName, email, company, subject, message, createdAt } = data;
  const date    = new Date(createdAt).toLocaleString('en-GB', { dateStyle: 'full', timeStyle: 'short' });
  const logoUrl = process.env.LOGO_URL || 'https://stemfra.com/stemfra_logo.png';

  const html = `
<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1.0"/></head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#0f0f0f;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:40px 0;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.06);border:1px solid #ececec;">

        <tr><td style="padding:24px 32px;border-bottom:1px solid #f1f1f1;">
          <table width="100%" cellpadding="0" cellspacing="0">
            <tr>
              <td align="left" style="vertical-align:middle;">
                <img src="${logoUrl}" alt="STEMfra" height="48" style="display:inline-block;vertical-align:middle;height:48px;width:auto;border:0;margin-right:-6px;"/><span style="display:inline-block;vertical-align:middle;font-size:20px;font-weight:500;color:#000;">STEMfra</span>
              </td>
              <td align="right" style="vertical-align:middle;">
                <span style="display:inline-block;background:#f3f4f6;color:#374151;padding:4px 12px;border-radius:100px;font-size:11px;font-weight:600;letter-spacing:.5px;text-transform:uppercase;">Website Lead</span>
              </td>
            </tr>
          </table>
        </td></tr>

        <tr><td style="padding:28px 32px 8px;">
          <h1 style="margin:0 0 4px;font-size:20px;font-weight:700;color:#0f0f0f;letter-spacing:-.3px;">New message from ${firstName} ${lastName}</h1>
          <p style="margin:0;color:#6b7280;font-size:13px;">${date}</p>
        </td></tr>

        <tr><td style="padding:20px 32px 24px;">
          <table width="100%" cellpadding="0" cellspacing="0" style="background:#f9fafb;border:1px solid #f1f1f1;border-radius:12px;overflow:hidden;">
            <tr>
              <td style="padding:12px 18px;border-bottom:1px solid #ececec;width:32%;"><span style="font-size:11px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:.5px;">Name</span></td>
              <td style="padding:12px 18px;border-bottom:1px solid #ececec;"><span style="font-size:14px;color:#1f2937;">${firstName} ${lastName}</span></td>
            </tr>
            <tr>
              <td style="padding:12px 18px;border-bottom:1px solid #ececec;"><span style="font-size:11px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:.5px;">Email</span></td>
              <td style="padding:12px 18px;border-bottom:1px solid #ececec;"><a href="mailto:${email}" style="font-size:14px;color:#0f0f0f;text-decoration:underline;">${email}</a></td>
            </tr>
            <tr>
              <td style="padding:12px 18px;border-bottom:1px solid #ececec;"><span style="font-size:11px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:.5px;">Company</span></td>
              <td style="padding:12px 18px;border-bottom:1px solid #ececec;"><span style="font-size:14px;color:#1f2937;">${company || '—'}</span></td>
            </tr>
            <tr>
              <td style="padding:12px 18px;"><span style="font-size:11px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:.5px;">Subject</span></td>
              <td style="padding:12px 18px;"><span style="font-size:14px;color:#1f2937;">${subject}</span></td>
            </tr>
          </table>
        </td></tr>

        <tr><td style="padding:0 32px 28px;">
          <p style="margin:0 0 10px;font-size:11px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:.5px;">Message</p>
          <div style="background:#fafafa;border:1px solid #f1f1f1;border-radius:12px;padding:16px 20px;">
            <p style="margin:0;font-size:14px;color:#1f2937;line-height:1.7;white-space:pre-wrap;">${message}</p>
          </div>
        </td></tr>

        <tr><td style="padding:0 32px 32px;">
          <a href="mailto:${email}?subject=Re: ${subject} — STEMfra" style="display:inline-block;background:#0f0f0f;color:#fff;text-decoration:none;padding:11px 22px;border-radius:100px;font-size:13px;font-weight:600;">Reply to ${firstName}</a>
        </td></tr>

        <tr><td style="background:#fafafa;padding:16px 32px;border-top:1px solid #f1f1f1;">
          <p style="margin:0;font-size:11px;color:#9ca3af;line-height:1.6;">Submitted via the contact form on stemfra.com · STEMfra · 8 The Green STE 12434, Dover, DE 19901</p>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;

  return {
    subject: `[${subject}] New message from ${firstName} ${lastName}`,
    html,
    text: `New website lead\n\nName: ${firstName} ${lastName}\nEmail: ${email}\nCompany: ${company || '—'}\nSubject: ${subject}\n\nMessage:\n${message}`,
  };
}

module.exports = buildNotificationEmail;
