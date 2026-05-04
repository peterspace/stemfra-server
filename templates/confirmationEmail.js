// Client confirmation email — sent to the person who submitted the form.
// Brand-trust touchpoint: clean, generous whitespace, centered logo (Hostinger-inspired).

const subjectDescriptions = {
  'AI Automation':        "We'll review your automation requirements and come prepared with ideas for your discovery call.",
  'Software Development': "We'll review your project scope and come prepared with an approach for your discovery call.",
  'Consultancy':          "We'll review your situation and come prepared with strategic thinking for your discovery call.",
  'Support':              "We'll review your support needs and reach out with the right plan for your systems.",
  'General':              "We'll review your message and get back to you with the right person to help.",
};

function buildConfirmationEmail(data) {
  const { firstName, subject, message } = data;
  const desc    = subjectDescriptions[subject] || subjectDescriptions['General'];
  const logoUrl = process.env.LOGO_URL || 'https://stemfra.com/stemfra_logo.png';

  const html = `
<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1.0"/></head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#0f0f0f;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:48px 0;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.06);border:1px solid #ececec;">

        <tr><td align="center" style="padding:40px 40px 8px;">
          <img src="${logoUrl}" alt="STEMfra" height="48" style="display:inline-block;vertical-align:middle;height:48px;width:auto;border:0;margin-right:-6px;"/><span style="display:inline-block;vertical-align:middle;font-size:20px;font-weight:500;color:#000;">STEMfra</span>
        </td></tr>

        <tr><td align="center" style="padding:24px 48px 12px;">
          <h1 style="margin:0;font-size:26px;font-weight:700;color:#0f0f0f;letter-spacing:-.5px;line-height:1.25;">We've received your message, ${firstName}.</h1>
        </td></tr>

        <tr><td align="center" style="padding:0 48px 36px;">
          <p style="margin:0;font-size:16px;color:#4b5563;line-height:1.65;max-width:440px;">${desc}</p>
        </td></tr>

        <tr><td style="padding:0 40px 8px;">
          <p style="margin:0 0 12px;font-size:11px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:.5px;text-align:center;">What happens next</p>

          <table width="100%" cellpadding="0" cellspacing="0" style="background:#fafafa;border:1px solid #f1f1f1;border-radius:14px;">
            <tr>
              <td style="padding:18px 22px;border-bottom:1px solid #f1f1f1;width:40px;vertical-align:top;">
                <div style="width:28px;height:28px;border-radius:50%;background:#0f0f0f;color:#fff;font-size:12px;font-weight:700;text-align:center;line-height:28px;">1</div>
              </td>
              <td style="padding:18px 22px 18px 0;border-bottom:1px solid #f1f1f1;">
                <p style="margin:0 0 2px;font-size:14px;font-weight:600;color:#0f0f0f;">Review</p>
                <p style="margin:0;font-size:13px;color:#6b7280;line-height:1.55;">We read every message personally — usually within a few hours.</p>
              </td>
            </tr>
            <tr>
              <td style="padding:18px 22px;border-bottom:1px solid #f1f1f1;vertical-align:top;">
                <div style="width:28px;height:28px;border-radius:50%;background:#0f0f0f;color:#fff;font-size:12px;font-weight:700;text-align:center;line-height:28px;">2</div>
              </td>
              <td style="padding:18px 22px 18px 0;border-bottom:1px solid #f1f1f1;">
                <p style="margin:0 0 2px;font-size:14px;font-weight:600;color:#0f0f0f;">Reach out</p>
                <p style="margin:0;font-size:13px;color:#6b7280;line-height:1.55;">We'll email you within one business day to schedule a free 30-minute discovery call.</p>
              </td>
            </tr>
            <tr>
              <td style="padding:18px 22px;vertical-align:top;">
                <div style="width:28px;height:28px;border-radius:50%;background:#0f0f0f;color:#fff;font-size:12px;font-weight:700;text-align:center;line-height:28px;">3</div>
              </td>
              <td style="padding:18px 22px 18px 0;">
                <p style="margin:0 0 2px;font-size:14px;font-weight:600;color:#0f0f0f;">Discovery call</p>
                <p style="margin:0;font-size:13px;color:#6b7280;line-height:1.55;">A focused conversation to understand your needs and share how we can help.</p>
              </td>
            </tr>
          </table>
        </td></tr>

        <tr><td style="padding:28px 40px 0;">
          <p style="margin:0 0 10px;font-size:11px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:.5px;">Your message</p>
          <div style="background:#fafafa;border:1px solid #f1f1f1;border-radius:12px;padding:16px 20px;">
            <p style="margin:0;font-size:14px;color:#4b5563;line-height:1.7;white-space:pre-wrap;">${message}</p>
          </div>
        </td></tr>

        <tr><td style="padding:24px 40px 36px;">
          <p style="margin:0;font-size:14px;color:#6b7280;line-height:1.6;">Questions in the meantime? Reply to this email or write to <a href="mailto:support@stemfra.com" style="color:#0f0f0f;text-decoration:underline;font-weight:600;">support@stemfra.com</a></p>
        </td></tr>

        <tr><td align="center" style="background:#fafafa;padding:28px 40px;border-top:1px solid #f1f1f1;">
          <div style="margin:0 0 12px;">
            <img src="${logoUrl}" alt="STEMfra" height="48" style="display:inline-block;vertical-align:middle;height:48px;width:auto;border:0;"/>
            <span style="display:inline-block;vertical-align:middle;margin-left:4px;font-size:20px;font-weight:500;color:#000;">STEMfra</span>
          </div>
          <p style="margin:0 0 6px;font-size:12px;color:#9ca3af;">8 The Green STE 12434, Dover, DE 19901</p>
          <p style="margin:0;font-size:11px;color:#9ca3af;line-height:1.5;">You're receiving this because you submitted a contact form at <a href="https://stemfra.com" style="color:#9ca3af;text-decoration:underline;">stemfra.com</a></p>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;

  return {
    subject: `We received your message — STEMfra`,
    html,
    text: `Hi ${firstName},\n\nThank you for reaching out to STEMfra.\n\n${desc}\n\nWhat happens next:\n1. Review — we read every message personally, usually within a few hours.\n2. Reach out — we'll email you within one business day to schedule a free 30-minute discovery call.\n3. Discovery call — a focused conversation to understand your needs.\n\nYour message:\n${message}\n\nQuestions? Reply to this email or write to support@stemfra.com\n\n— STEMfra`,
  };
}

module.exports = buildConfirmationEmail;
