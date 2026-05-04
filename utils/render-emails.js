/**
 * render-emails.js — generates static HTML previews of both email templates.
 * Run with: node utils/render-emails.js
 * Outputs to /tmp/stemfra-emails/{notification,confirmation}.html
 *
 * Use this to iterate on look-and-feel without sending real emails.
 */

const fs   = require('fs');
const path = require('path');
const buildNotificationEmail = require('../templates/notificationEmail');
const buildConfirmationEmail = require('../templates/confirmationEmail');

const sample = {
  firstName: 'Ada',
  lastName:  'Lovelace',
  email:     'ada@analyticalengine.io',
  company:   'Analytical Engine Co.',
  subject:   'AI Automation',
  message:   "Hi STEMfra,\n\nWe'd like to automate our weekly client reporting. We currently spend ~6 hours every Friday assembling spreadsheets from 3 different tools. Could you walk us through what a discovery call would cover, and a rough timeline?\n\nThanks,\nAda",
  createdAt: new Date().toISOString(),
};

const outDir = '/tmp/stemfra-emails';
fs.mkdirSync(outDir, { recursive: true });

const notification = buildNotificationEmail(sample);
const confirmation = buildConfirmationEmail({
  firstName: sample.firstName,
  subject:   sample.subject,
  message:   sample.message,
});

fs.writeFileSync(path.join(outDir, 'notification.html'), notification.html);
fs.writeFileSync(path.join(outDir, 'confirmation.html'), confirmation.html);

const subjectVariants = ['AI Automation', 'Software Development', 'Consultancy', 'Support', 'General'];
subjectVariants.forEach((s) => {
  const n = buildNotificationEmail({ ...sample, subject: s });
  const c = buildConfirmationEmail({ firstName: sample.firstName, subject: s, message: sample.message });
  fs.writeFileSync(path.join(outDir, `notification-${s.toLowerCase().replace(/\s+/g, '-')}.html`), n.html);
  fs.writeFileSync(path.join(outDir, `confirmation-${s.toLowerCase().replace(/\s+/g, '-')}.html`), c.html);
});

console.log('✓ Rendered email previews to', outDir);
fs.readdirSync(outDir).sort().forEach((f) => console.log('  •', `file://${path.join(outDir, f)}`));
