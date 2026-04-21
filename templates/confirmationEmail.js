// Client confirmation email — sent to the person who submitted the form

const subjectColors = {
  'AI Automation':        '#6366f1',
  'Software Development': '#3b82f6',
  'Consultancy':          '#8b5cf6',
  'Support':              '#10b981',
  'General':              '#6b7280',
};

const subjectDescriptions = {
  'AI Automation':        "We'll review your automation requirements and come prepared with ideas for your discovery call.",
  'Software Development': "We'll review your project scope and come prepared with an approach for your discovery call.",
  'Consultancy':          "We'll review your situation and come prepared with strategic thinking for your discovery call.",
  'Support':              "We'll review your support needs and reach out with the right plan for your systems.",
  'General':              "We'll review your message and get back to you with the right person to help.",
};

function buildConfirmationEmail(data) {
  const { firstName, subject, message } = data;
  const color = subjectColors[subject] || '#6366f1';
  const desc  = subjectDescriptions[subject] || subjectDescriptions['General'];

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
        </td></tr>

        <tr><td style="padding:40px 40px 24px;">
          <h1 style="margin:0 0 12px;font-size:26px;font-weight:700;color:#0f0f0f;letter-spacing:-.5px;line-height:1.2;">We've received your message, ${firstName}.</h1>
          <p style="margin:0;font-size:16px;color:#4b5563;line-height:1.6;">${desc}</p>
        </td></tr>

        <tr><td style="padding:0 40px 32px;">
          <div style="background:#f9fafb;border-radius:12px;padding:24px;">
            <p style="margin:0 0 16px;font-size:13px;font-weight:600;color:#374151;text-transform:uppercase;letter-spacing:.5px;">What happens next</p>

            <div style="display:flex;align-items:flex-start;margin-bottom:16px;">
              <div style="min-width:28px;height:28px;border-radius:50%;background:${color};color:white;font-size:13px;font-weight:700;text-align:center;line-height:28px;margin-right:14px;">1</div>
              <div><p style="margin:0 0 2px;font-size:14px;font-weight:600;color:#1f2937;">Review</p><p style="margin:0;font-size:13px;color:#6b7280;line-height:1.5;">We read every message personally — usually within a few hours.</p></div>
            </div>

            <div style="display:flex;align-items:flex-start;margin-bottom:16px;">
              <div style="min-width:28px;height:28px;border-radius:50%;background:${color};color:white;font-size:13px;font-weight:700;text-align:center;line-height:28px;margin-right:14px;">2</div>
              <div><p style="margin:0 0 2px;font-size:14px;font-weight:600;color:#1f2937;">Reach out</p><p style="margin:0;font-size:13px;color:#6b7280;line-height:1.5;">We'll email you within one business day to schedule a free 30-minute discovery call.</p></div>
            </div>

            <div style="display:flex;align-items:flex-start;">
              <div style="min-width:28px;height:28px;border-radius:50%;background:${color};color:white;font-size:13px;font-weight:700;text-align:center;line-height:28px;margin-right:14px;">3</div>
              <div><p style="margin:0 0 2px;font-size:14px;font-weight:600;color:#1f2937;">Discovery call</p><p style="margin:0;font-size:13px;color:#6b7280;line-height:1.5;">A focused conversation to understand your needs and share how we can help.</p></div>
            </div>
          </div>
        </td></tr>

        <tr><td style="padding:0 40px 32px;">
          <p style="margin:0 0 10px;font-size:13px;font-weight:600;color:#374151;text-transform:uppercase;letter-spacing:.5px;">Your message</p>
          <div style="background:#f9fafb;border-left:3px solid ${color};border-radius:0 8px 8px 0;padding:16px 20px;">
            <p style="margin:0;font-size:14px;color:#4b5563;line-height:1.7;white-space:pre-wrap;">${message}</p>
          </div>
        </td></tr>

        <tr><td style="padding:0 40px 40px;">
          <p style="margin:0;font-size:14px;color:#6b7280;">Questions in the meantime? Reply to this email or write to <a href="mailto:support@stemfra.com" style="color:${color};text-decoration:none;font-weight:600;">support@stemfra.com</a></p>
        </td></tr>

        <tr><td style="background:#f4f4f5;padding:20px 40px;text-align:center;">
          <p style="margin:0;font-size:12px;color:#9ca3af;">STEMfra · 8 The Green STE 12434, Dover, DE 19901</p>
          <p style="margin:6px 0 0;font-size:12px;color:#9ca3af;">You're receiving this because you submitted a contact form at stemfra.com</p>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;

  return {
    subject: `We received your message — STEMfra`,
    html,
    text: `Hi ${firstName},\n\nThank you for reaching out to STEMfra.\n\n${desc}\n\nWhat happens next:\n1. We'll review your message personally.\n2. We'll email you within one business day to schedule a free 30-minute discovery call.\n3. A focused conversation to understand your needs.\n\nYour message:\n${message}\n\nQuestions? Reply to this email or write to support@stemfra.com\n\n— STEMfra`,
  };
}

module.exports = buildConfirmationEmail;
