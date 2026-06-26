// Lead-gen outreach sending via Gmail — sends the approved draft AS THE REP from
// their own @stemfra.com inbox, using a Google service account with domain-wide
// delegation (impersonation). This gives real-inbox deliverability and means the
// prospect's REPLY lands naturally in the rep's mailbox (Phase 2 reply detection
// reads it back). Low-volume, personalized 1:1 — not bulk cold-email.
//
// Setup (one-time, Google super-admin): create a service account + JSON key, then
// in admin.google.com → Security → API controls → Domain-wide Delegation, authorize
// the SA's client id for scope gmail.send (+ gmail.readonly for Phase 2). Provide
// GOOGLE_SA_CLIENT_EMAIL + GOOGLE_SA_PRIVATE_KEY to the server.
const { JWT } = require('google-auth-library');

const SEND_SCOPE = 'https://www.googleapis.com/auth/gmail.send';
const READ_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';

function isConfigured() {
  return !!(process.env.GOOGLE_SA_CLIENT_EMAIL && process.env.GOOGLE_SA_PRIVATE_KEY);
}

// A service-account JWT that impersonates a rep's mailbox (domain-wide delegation).
function jwtFor(repEmail, scopes) {
  return new JWT({
    email: process.env.GOOGLE_SA_CLIENT_EMAIL,
    key: (process.env.GOOGLE_SA_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
    scopes,
    subject: repEmail,
  });
}

function b64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// Build a minimal RFC-822 plain-text message. Subject is RFC-2047 encoded so
// non-ASCII subjects survive; the body is sent as UTF-8.
function buildRaw({ from, to, subject, text }) {
  const encSubject = '=?UTF-8?B?' + Buffer.from(subject || '', 'utf8').toString('base64') + '?=';
  const headers = [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${encSubject}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: 8bit',
  ];
  return b64url(headers.join('\r\n') + '\r\n\r\n' + (text || ''));
}

// Send an outreach email AS the rep. Returns { messageId, threadId }.
async function sendAsRep({ repEmail, repName, to, subject, text }) {
  if (!isConfigured()) throw new Error('Google service account not configured (GOOGLE_SA_CLIENT_EMAIL / GOOGLE_SA_PRIVATE_KEY)');
  if (!repEmail) throw new Error('repEmail (the sender) is required');
  if (!to) throw new Error('recipient is required');

  const client = jwtFor(repEmail, [SEND_SCOPE]);
  const from = repName ? `${repName} <${repEmail}>` : repEmail;
  const raw = buildRaw({ from, to, subject, text });

  const res = await client.request({
    url: 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send',
    method: 'POST',
    data: { raw },
  });
  return { messageId: res.data.id, threadId: res.data.threadId };
}

// Check a sent thread (in the rep's mailbox) for an inbound reply. Returns
// { from, bounced } if an incoming message from someone other than the rep is
// present, else null. Used by the reply sweeper to flip a lead warm.
async function checkThreadForReply({ repEmail, threadId }) {
  if (!isConfigured()) throw new Error('Google service account not configured');
  if (!threadId) return null;
  const client = jwtFor(repEmail, [READ_SCOPE]);
  const res = await client.request({
    url: `https://gmail.googleapis.com/gmail/v1/users/me/threads/${encodeURIComponent(threadId)}?format=metadata&metadataHeaders=From`,
    method: 'GET',
  });
  const messages = res.data.messages || [];
  const rep = String(repEmail).toLowerCase();
  for (const m of messages) {
    const labels = m.labelIds || [];
    const from = ((m.payload?.headers || []).find(h => h.name === 'From')?.value || '').toLowerCase();
    // An inbound message NOT sent by the rep = a reply (or a bounce notice).
    const inbound = labels.includes('INBOX') || (!labels.includes('SENT') && from && !from.includes(rep));
    if (inbound && from && !from.includes(rep)) {
      const bounced = /mailer-daemon|postmaster|delivery (status|failure)|undeliverable/i.test(from);
      return { from, bounced };
    }
  }
  return null;
}

module.exports = { isConfigured, sendAsRep, checkThreadForReply };
