// Unified transactional mailer (N5 cutover, 2026-07-13).
//
// One send function for ALL transactional/tenant email — booking confirmations,
// reminders, cancel/reschedule, owner notifications, lead + contact emails,
// Stacy handoff, orphan-payment alerts. Routes to either:
//   - Resend  (HTTP API, verified sending domain mail.stemfra.com) — production
//   - Gmail   (nodemailer SMTP) — dev fallback / if Resend isn't configured
// chosen by EMAIL_PROVIDER ('resend' | 'gmail'). Falls back to whichever
// provider IS configured if the requested one isn't, so a missing key never
// silently drops mail without a reason.
//
// NOT for Mark's 1:1 outreach — that stays deliberately personal plain-text
// Gmail via n8n (see docs/OUTREACH.md). This module is only the branded,
// templated transactional layer (templates/baseEmail.js).
const nodemailer = require('nodemailer');

const PROVIDER = (process.env.EMAIL_PROVIDER || 'gmail').toLowerCase();
const RESEND_FROM_DOMAIN = process.env.RESEND_FROM_DOMAIN || 'mail.stemfra.com';
// The address every transactional email is sent FROM (display name = the
// business or "STEMfra …"). Must live on the Resend-verified domain.
const RESEND_FROM_ADDRESS = process.env.RESEND_FROM_ADDRESS || `notifications@${RESEND_FROM_DOMAIN}`;

const gmailReady = () => !!(process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD);
const resendReady = () => !!process.env.RESEND_API_KEY;

// Which provider actually sends: honor EMAIL_PROVIDER, else fall back to the
// one that's configured. Returns null when neither is set (→ send() returns
// false, preserving the existing best-effort "no creds = no-op" behavior).
function activeProvider() {
  if (PROVIDER === 'resend' && resendReady()) return 'resend';
  if (PROVIDER === 'gmail' && gmailReady()) return 'gmail';
  if (resendReady()) return 'resend';
  if (gmailReady()) return 'gmail';
  return null;
}

function fromHeader(fromName, provider) {
  const addr = provider === 'resend' ? RESEND_FROM_ADDRESS : process.env.GMAIL_USER;
  return fromName ? `"${String(fromName).replace(/"/g, '')}" <${addr}>` : addr;
}

async function sendViaResend({ from, to, replyTo, subject, text, html, attachments }) {
  // Resend wants base64 string content; nodemailer wants Buffers. Normalize here.
  const resendAttachments = (attachments || []).map((a) => ({
    filename: a.filename,
    content: Buffer.isBuffer(a.content) ? a.content.toString('base64') : a.content,
  }));
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to: Array.isArray(to) ? to : [to],
      reply_to: replyTo || undefined,
      subject,
      text,
      html,
      attachments: resendAttachments.length ? resendAttachments : undefined,
    }),
  });
  if (!res.ok) throw new Error(`Resend ${res.status}: ${await res.text()}`);
  const data = await res.json().catch(() => ({}));
  return { id: data.id };
}

let _gmailTx;
function gmailTransporter() {
  if (!_gmailTx) {
    _gmailTx = nodemailer.createTransport({
      service: 'gmail',
      auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD },
    });
  }
  return _gmailTx;
}

// The one send function. Returns true on success, false when unsendable (no
// recipient / no provider configured). THROWS on a real provider error so
// callers keep their existing best-effort try/catch semantics unchanged.
//
// Callers pass a display name (fromName) — NEVER the raw from address; the
// mailer picks the correct sending address for the active provider.
async function sendMail({ fromName, to, replyTo, subject, text, html, attachments }) {
  if (!to) return false;
  const provider = activeProvider();
  if (!provider) return false;
  const from = fromHeader(fromName, provider);
  if (provider === 'resend') { await sendViaResend({ from, to, replyTo, subject, text, html, attachments }); return true; }
  await gmailTransporter().sendMail({ from, replyTo: replyTo || undefined, to, subject, text, html, attachments });
  return true;
}

module.exports = { sendMail, activeProvider, RESEND_FROM_ADDRESS };
