// resendInbound.js — POST /api/resend/inbound: Resend Receiving webhook for
// the CMS enquiries inbox (inbox-parity arc, 2026-09-02). Closes the loop the
// outbound-only setup left open: platform lead replies now carry
// reply-to = reply+<leadId>@INBOUND_REPLY_DOMAIN, the visitor's answer lands
// at Resend, and this route files it back into the lead's thread.
//
// Flow (per Resend docs, read 2026-09-02):
//   1. `email.received` webhook = METADATA ONLY (no body/headers) — verify the
//      svix signature against the RAW body, then
//   2. fetch the full parsed content: GET https://api.resend.com/emails/receiving/{id}
//      (Bearer RESEND_API_KEY) → { from, to, subject, html, text, headers, … },
//   3. match the lead via the plus-address in `to`/`received_for`
//      (reply+<leadId>@…), sanitize the HTML with the SAME ingest allowlist as
//      outbound (lib/emailHtml — one trust level), append to
//      site_leads.metadata.replies as kind:'inbound', surface the lead as NEW
//      (unarchive + unread), ring the owner's bell, and forward a copy to the
//      owner's own mailbox so nothing they had before is lost.
//
// Mounted with express.raw BEFORE the global json parser (Stripe/AWX
// precedent) — svix signatures are computed over the exact raw bytes.
const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const supabase = require('../config/supabase');
const { sanitizeEmailHtml } = require('../lib/emailHtml');
const { sendMail } = require('../lib/mailer');

const SECRET = process.env.RESEND_INBOUND_SECRET || '';

// Svix scheme: base64-decode the secret after the `whsec_` prefix, HMAC-SHA256
// over `${svix-id}.${svix-timestamp}.${rawBody}`, compare (timing-safe) against
// each space-separated `v1,<base64>` entry in svix-signature.
function verifySvix(req) {
  if (!SECRET) return false;
  const id = req.headers['svix-id'];
  const ts = req.headers['svix-timestamp'];
  const sigHeader = req.headers['svix-signature'];
  if (!id || !ts || !sigHeader) return false;
  // Reject stale timestamps (5 min tolerance, svix convention).
  if (Math.abs(Date.now() / 1000 - Number(ts)) > 300) return false;
  const secretBytes = Buffer.from(SECRET.replace(/^whsec_/, ''), 'base64');
  const signed = `${id}.${ts}.${req.body.toString('utf8')}`;
  const expected = crypto.createHmac('sha256', secretBytes).update(signed).digest('base64');
  return String(sigHeader).split(' ').some((part) => {
    const sig = part.split(',')[1];
    if (!sig) return false;
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  });
}

/** reply+<uuid>@… anywhere in the recipient list → the lead id. */
function leadIdFromRecipients(addresses) {
  const re = /reply\+([0-9a-f-]{36})@/i;
  for (const addr of addresses || []) {
    const m = re.exec(String(addr));
    if (m) return m[1];
  }
  return null;
}

async function fetchReceivedEmail(emailId) {
  const res = await fetch(`https://api.resend.com/emails/receiving/${encodeURIComponent(emailId)}`, {
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}` },
  });
  if (!res.ok) throw new Error(`Resend receiving fetch ${res.status}: ${await res.text()}`);
  return res.json();
}

const esc = (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

router.post('/', async (req, res) => {
  try {
    if (!verifySvix(req)) return res.status(401).json({ error: 'bad signature' });
    const event = JSON.parse(req.body.toString('utf8'));
    if (event.type !== 'email.received') return res.json({ ok: true, ignored: event.type });

    const meta = event.data || {};
    const leadId = leadIdFromRecipients([...(meta.received_for || []), ...(meta.to || [])]);
    if (!leadId) {
      console.warn('[resend-inbound] no lead plus-address in', meta.received_for, meta.to);
      return res.json({ ok: true, unmatched: true });
    }

    const { data: lead } = await supabase.from('site_leads').select('*').eq('id', leadId).maybeSingle();
    if (!lead) {
      console.warn('[resend-inbound] lead not found:', leadId);
      return res.json({ ok: true, unmatched: true });
    }

    // Dedupe: Resend retries webhooks; the email_id is the idempotency key.
    const replies = Array.isArray(lead.metadata?.replies) ? lead.metadata.replies : [];
    if (replies.some((r) => r.resend_email_id === meta.email_id)) {
      return res.json({ ok: true, duplicate: true });
    }

    // Full parsed content (the webhook itself is metadata-only).
    const full = await fetchReceivedEmail(meta.email_id);
    // One trust level: inbound HTML goes through the same ingest allowlist as
    // our own outbound; fall back to escaped plain text.
    const html = sanitizeEmailHtml(full.html)
      || (full.text ? `<p>${esc(full.text).replace(/\n{2,}/g, '</p><p>').replace(/\n/g, '<br>')}</p>` : null);
    if (!html) return res.json({ ok: true, empty: true });

    const entry = {
      kind: 'inbound',
      from: String(full.from || meta.from || '').slice(0, 300),
      subject: String(full.subject || meta.subject || '').slice(0, 300),
      html,
      sent_at: full.created_at || meta.created_at || new Date().toISOString(),
      message_id: full.message_id || meta.message_id || null,
      resend_email_id: meta.email_id,
    };

    // Surface as a fresh conversation turn: unread, and un-archived (Gmail
    // semantics — new mail restores the thread).
    await supabase.from('site_leads').update({
      status: 'new',
      read_at: null,
      metadata: { ...(lead.metadata && typeof lead.metadata === 'object' ? lead.metadata : {}), replies: [...replies, entry] },
    }).eq('id', leadId);

    // Owner's bell.
    await supabase.from('cms_notifications').insert({
      site_id: lead.site_id,
      type: 'lead_reply_received',
      category: 'operations',
      title: `${lead.name || 'A lead'} replied`,
      body: String(full.text || '').slice(0, 140) || entry.subject,
      href: '/leads',
      metadata: { lead_id: leadId },
    }).then(({ error }) => { if (error) console.warn('[resend-inbound] bell failed:', error.message); });

    // Copy-forward to the owner's own mailbox (best-effort; replying to the
    // forward goes straight to the visitor, same as before this pipeline).
    try {
      const { data: siteRow } = await supabase
        .from('sites')
        .select('subdomain, owner:contacts!sites_owner_contact_id_fkey(email), company:companies(name)')
        .eq('id', lead.site_id).single();
      const ownerEmail = siteRow?.owner?.email;
      if (ownerEmail) {
        await sendMail({
          fromName: siteRow?.company?.name || siteRow?.subdomain || 'Stemfra',
          to: ownerEmail,
          replyTo: lead.email || undefined,
          subject: entry.subject || `${lead.name || 'A lead'} replied`,
          text: String(full.text || '').slice(0, 5000) || 'New reply in your CMS inbox.',
          html: `${html}<hr><p style="color:#888;font-size:12px">Reply from ${esc(entry.from)} — also filed in your CMS inbox.</p>`,
        });
      }
    } catch (e) {
      console.warn('[resend-inbound] owner forward failed:', e.message);
    }

    res.json({ ok: true });
  } catch (err) {
    console.error('[resend-inbound] failed:', err.message);
    res.status(500).json({ error: 'inbound processing failed' });
  }
});

module.exports = router;
