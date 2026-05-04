// Dev-only email-preview routes. Mounted in index.js when NODE_ENV !== 'production'.
const express = require('express');
const router  = express.Router();

const buildNotificationEmail = require('../templates/notificationEmail');
const buildConfirmationEmail = require('../templates/confirmationEmail');

const SUBJECTS = ['AI Automation', 'Software Development', 'Consultancy', 'Support', 'General'];

const sample = {
  firstName: 'Ada',
  lastName:  'Lovelace',
  email:     'ada@analyticalengine.io',
  company:   'Analytical Engine Co.',
  message:   "Hi STEMfra,\n\nWe'd like to automate our weekly client reporting. We currently spend ~6 hours every Friday assembling spreadsheets from 3 different tools. Could you walk us through what a discovery call would cover, and a rough timeline?\n\nThanks,\nAda",
  createdAt: new Date().toISOString(),
};

function indexPage() {
  const links = SUBJECTS.flatMap((s) => [
    `<li><a href="/dev/preview/notification?subject=${encodeURIComponent(s)}">Notification — ${s}</a></li>`,
    `<li><a href="/dev/preview/confirmation?subject=${encodeURIComponent(s)}">Confirmation — ${s}</a></li>`,
  ]).join('');
  return `<!doctype html>
<html><head><title>STEMfra email previews</title>
<style>body{font-family:Inter,system-ui,sans-serif;max-width:640px;margin:60px auto;padding:0 24px;color:#111}
h1{font-weight:700;letter-spacing:-.5px}ul{list-style:none;padding:0}
li{padding:10px 0;border-bottom:1px solid #eee}a{color:#0f0f0f;text-decoration:none}
a:hover{text-decoration:underline}small{color:#6b7280}</style></head>
<body><h1>Email previews</h1>
<small>Sample: ${sample.firstName} ${sample.lastName} · ${sample.email}</small>
<ul>${links}</ul></body></html>`;
}

router.get('/', (req, res) => {
  res.set('Content-Type', 'text/html').send(indexPage());
});

router.get('/notification', (req, res) => {
  const subject = SUBJECTS.includes(req.query.subject) ? req.query.subject : 'AI Automation';
  const { html } = buildNotificationEmail({ ...sample, subject });
  res.set('Content-Type', 'text/html').send(html);
});

router.get('/confirmation', (req, res) => {
  const subject = SUBJECTS.includes(req.query.subject) ? req.query.subject : 'AI Automation';
  const { html } = buildConfirmationEmail({
    firstName: sample.firstName,
    subject,
    message: sample.message,
  });
  res.set('Content-Type', 'text/html').send(html);
});

module.exports = router;
