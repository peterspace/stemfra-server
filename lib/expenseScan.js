// expenseScan.js — the P17 expense-receipt harvester, built IN the CRM
// (Peter, 2026-08-31; supersedes the planned n8n workflow). Read-only
// IMAP over the configured mailboxes; candidate emails found by cheap
// subject heuristics; full parse (vendor/amount/attachment) only on
// candidates. Personal purchases in shared mailboxes are handled by the
// review-side EXCLUDE toggle, never by guessing here.
const { ImapFlow } = require('imapflow');
const { simpleParser } = require('mailparser');
const supabase = require('../config/supabase');
const { cloudinary, isCloudinaryConfigured } = require('../config/cloudinary');

const TERMS = ['receipt', 'invoice', 'payment', 'order', 'subscription', 'billing', 'charged', 'renewal'];
const LOOKBACK_DAYS = 120;

// N mailboxes (Peter, 2026-08-31: e.g. peter.okeme@gmail.com holds the
// Northwest Registered Agent incorporation invoice): MB1 = the existing
// admin Gmail; add more as EXPENSE_MB2..MB9_USER/_PASS env pairs.
function mailboxes() {
  const list = [];
  if (process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD) {
    list.push({ user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD });
  }
  for (let i = 2; i <= 9; i++) {
    const user = process.env[`EXPENSE_MB${i}_USER`];
    const pass = process.env[`EXPENSE_MB${i}_PASS`];
    if (user && pass) list.push({ user, pass });
  }
  return list;
}

// Failure/decline notices are candidates but NOT expenses — skipped
// entirely (Peter, 2026-08-31: never show what could not belong in a tax
// submission; before this they were stored excluded and cluttered the list).
const FAIL_RE = /fail|declin|unsuccessful|paused|past due|could not|unable to|problem with your payment/i;

// Best-effort "$12.34" / "USD 12.34" / "£9.99" from subject+body.
function parseAmount(text) {
  const m = String(text || '').match(/(?:USD|GBP|EUR|\$|£|€)\s?(\d{1,5}(?:[.,]\d{2}))/);
  if (!m) return { cents: null, currency: 'USD' };
  const cents = Math.round(parseFloat(m[1].replace(',', '.')) * 100);
  const cur = /£|GBP/.test(m[0]) ? 'GBP' : /€|EUR/.test(m[0]) ? 'EUR' : 'USD';
  return { cents: Number.isFinite(cents) ? cents : null, currency: cur };
}

function vendorOf(fromName, fromEmail) {
  const name = String(fromName || '').replace(/[<>"]/g, '').trim();
  if (name && !name.includes('@')) return name.replace(/,?\s*(inc|llc|ltd|pbc)\.?$/i, '').trim();
  const dom = String(fromEmail || '').split('@')[1] || '';
  return dom.split('.').slice(-2, -1)[0] || dom;
}

async function uploadAttachment(att, messageId) {
  if (!isCloudinaryConfigured() || !att?.content?.length) return null;
  try {
    const result = await new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        {
          folder: 'stemfra_assets/expense-receipts',
          public_id: String(messageId).replace(/[^a-z0-9]/gi, '').slice(0, 40),
          // Originals kept verbatim — PDFs stay PDFs (full quality, every
          // page; the browser's own viewer renders them). Requires the
          // Cloudinary Security setting "Allow delivery of PDF and ZIP
          // files" to be ON (off = 401; the old workaround here was a
          // lossy page-1 JPG conversion, dropped 2026-08-31 per Peter).
          resource_type: 'image',
          // overwrite: a receipt is immutable source material, so replacing
          // the asset under the same id is idempotent — and it lets the
          // 2026-08-31 re-harvest swap the old JPG conversions for PDFs.
          overwrite: true,
        },
        (err, r) => (err ? reject(err) : resolve(r)),
      );
      stream.end(att.content);
    });
    return result.secure_url;
  } catch (e) {
    console.warn('[expense-scan] attachment upload failed:', e.message);
    return null;
  }
}

async function scanMailbox({ user, pass }) {
  const client = new ImapFlow({ host: 'imap.gmail.com', port: 993, secure: true, auth: { user, pass }, logger: false });
  await client.connect();
  const summary = { account: user, scanned: 0, candidates: 0, stored: 0 };
  const lock = await client.getMailboxLock('[Gmail]/All Mail');
  try {
    const since = new Date(Date.now() - LOOKBACK_DAYS * 24 * 3600 * 1000);
    const uids = await client.search({ since });
    const candidates = [];
    for await (const msg of client.fetch(uids, { envelope: true, uid: true })) {
      summary.scanned++;
      const subj = (msg.envelope.subject || '').toLowerCase();
      if (TERMS.some((t) => subj.includes(t))) candidates.push(msg.uid);
    }
    summary.candidates = candidates.length;

    // Skip candidates already stored (message-id dedupe needs the source,
    // so pre-check by envelope message-id first via a cheap second fetch).
    for (const uid of candidates) {
      let parsed;
      try {
        const { content } = await client.download(String(uid), undefined, { uid: true });
        const chunks = [];
        for await (const ch of content) chunks.push(ch);
        parsed = await simpleParser(Buffer.concat(chunks));
      } catch { continue; }
      const messageId = parsed.messageId || `uid-${uid}@${user}`;
      const { data: exists } = await supabase.from('expense_receipts').select('id').eq('message_id', messageId).maybeSingle();
      if (exists) continue;

      if (FAIL_RE.test(parsed.subject || '')) continue;

      const fromEmail = parsed.from?.value?.[0]?.address || null;
      const fromName = parsed.from?.value?.[0]?.name || null;
      const { cents, currency } = parseAmount(`${parsed.subject}\n${(parsed.text || '').slice(0, 2000)}`);
      const att = (parsed.attachments || []).find((a) => /pdf|image/.test(a.contentType || ''));
      const attachmentUrl = att ? await uploadAttachment(att, messageId) : null;
      const receivedAt = parsed.date || new Date();
      // Default renewal guess: same day next month (staff can edit).
      const renews = new Date(receivedAt);
      renews.setMonth(renews.getMonth() + 1);

      // The same invoice delivered to two mailboxes (or re-sent) must not
      // double-count: a same-vendor + same-amount + same-day twin of an
      // already-stored receipt lands auto-excluded, chip-flagged in the CRM.
      let isDup = false;
      if (cents != null) {
        const day = receivedAt.toISOString().slice(0, 10);
        const { data: twin } = await supabase.from('expense_receipts').select('id')
          .ilike('vendor', vendorOf(fromName, fromEmail))
          .eq('amount_cents', cents)
          .gte('received_at', `${day}T00:00:00Z`)
          .lt('received_at', `${day}T23:59:59.999Z`)
          .limit(1).maybeSingle();
        isDup = !!twin;
      }

      const { error } = await supabase.from('expense_receipts').insert({
        account: user,
        message_id: messageId,
        vendor: vendorOf(fromName, fromEmail),
        from_email: fromEmail,
        subject: parsed.subject || null,
        amount_cents: cents,
        currency,
        received_at: receivedAt.toISOString(),
        renews_on: renews.toISOString().slice(0, 10),
        attachment_url: attachmentUrl,
        attachment_name: att?.filename || null,
        excluded: isDup,
        excluded_reason: isDup ? 'Duplicate delivery of the same invoice (auto)' : null,
      });
      if (!error) summary.stored++;
      else if (!String(error.message).includes('duplicate')) console.warn('[expense-scan] insert failed:', error.message);
    }
  } finally {
    lock.release();
    await client.logout().catch(() => {});
  }
  return summary;
}

async function scanAll() {
  const results = [];
  for (const mb of mailboxes()) {
    try {
      results.push(await scanMailbox(mb));
    } catch (e) {
      results.push({ account: mb.user, error: e.message });
    }
  }
  return results;
}

module.exports = { scanAll, mailboxes };
