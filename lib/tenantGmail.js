// tenantGmail.js — the P24 Gmail connector: a tenant may connect their own
// Gmail (app password, Gmail only for now) so lead replies send AS their
// address instead of the platform default (Resend from
// notifications@mail.stemfra.com with reply-to). The Lead-Gen CRM's
// connect model ported to the CMS: TEST the login BEFORE storing, store
// the app password encrypted (AES-256-GCM, key derived from the server
// secret), decrypt only at send time.
const crypto = require('crypto');
const nodemailer = require('nodemailer');
const supabase = require('../config/supabase');

// Stable server-side key; no new env var to keep in deploy.yml.
function key() {
  return crypto.createHash('sha256')
    .update(`${process.env.SUPABASE_SECRET_KEY}:site-email-connector`)
    .digest();
}

function encrypt(plain) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const enc = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  return [iv.toString('base64'), cipher.getAuthTag().toString('base64'), enc.toString('base64')].join('.');
}

function decrypt(stored) {
  const [iv, tag, data] = String(stored).split('.').map((p) => Buffer.from(p, 'base64'));
  const decipher = crypto.createDecipheriv('aes-256-gcm', key(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}

function gmailTransport(email, appPassword) {
  return nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,
    auth: { user: email, pass: appPassword },
  });
}

// Test-before-store: a real SMTP login against Gmail. Accepts Google
// Workspace addresses too (they authenticate against the same host).
async function verifyGmailLogin(email, appPassword) {
  try {
    await gmailTransport(email, appPassword).verify();
    return { ok: true };
  } catch (e) {
    const msg = /535|invalid|username and password/i.test(e.message || '')
      ? 'Gmail rejected that address or app password. App passwords need 2-Step Verification turned on, then Google Account, Security, App passwords.'
      : `Could not reach Gmail: ${e.message}`;
    return { ok: false, error: msg };
  }
}

async function getConnector(siteId) {
  const { data } = await supabase.from('site_email_connectors')
    .select('site_id, email, pass_encrypted, verified_at').eq('site_id', siteId).maybeSingle();
  return data || null;
}

async function saveConnector(siteId, email, appPassword) {
  const row = {
    site_id: siteId,
    email: String(email).trim().toLowerCase(),
    pass_encrypted: encrypt(appPassword),
    verified_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  const { error } = await supabase.from('site_email_connectors').upsert(row, { onConflict: 'site_id' });
  if (error) throw error;
}

async function deleteConnector(siteId) {
  await supabase.from('site_email_connectors').delete().eq('site_id', siteId);
}

// Send through the tenant's own Gmail. Same contract shape as
// lib/mailer sendMail; a failure here must surface to the caller.
async function sendViaConnector(connector, { fromName, to, subject, text, html, attachments, headers, messageId }) {
  const pass = decrypt(connector.pass_encrypted);
  const info = await gmailTransport(connector.email, pass).sendMail({
    from: fromName ? `"${String(fromName).replace(/"/g, '')}" <${connector.email}>` : connector.email,
    to,
    subject,
    text,
    html,
    // nodemailer format: [{filename, content(Buffer), contentType}]
    attachments: attachments && attachments.length ? attachments : undefined,
    headers: headers || undefined,
    messageId: messageId || undefined,
  });
  return { id: info?.messageId || messageId || null };
}

module.exports = { getConnector, saveConnector, deleteConnector, verifyGmailLogin, sendViaConnector };
