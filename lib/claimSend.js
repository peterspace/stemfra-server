// Send the branded "Claim your website" touches (launch funnel, 2026-08-19).
// ONE path for touch 1 (send-outreach in claim mode) and touch 2 (sequencer):
// resolve the lead's offer → render prospectClaimEmail → send as Mark via Gmail
// (HTML + text, open pixel, List-Unsubscribe) → stamp the lead → log events.
const crypto = require('crypto');
const supabase = require('../config/supabase');
const gmail = require('./gmailOutreach');
const { resolveClaimOffer } = require('./claimOffer');
const { claimUrl, unsubscribeUrl } = require('./claimTokens');
const { prospectClaimEmail } = require('../templates/transactionalEmails');
const { logActivity } = require('./activity');

const MARK_EMAIL = process.env.MARK_EMAIL || 'mark@stemfra.com';

async function buildClaimEmailForLead(lead, touch = 1) {
  const offer = await resolveClaimOffer(lead);
  const mail = prospectClaimEmail({
    touch,
    firstName: offer.firstName,
    businessName: offer.businessName,
    verticalLabel: offer.verticalLabel,
    heroImageUrl: offer.heroImageUrl,
    claimUrl: claimUrl(lead.claim_token),
    demoUrl: offer.demoUrl,
    unsubscribeUrl: unsubscribeUrl(lead.claim_token),
  });
  return { ...mail, offer };
}

/**
 * Send touch 1 or 2 to a lead. Returns { messageId, threadId, subject }.
 * `step` = the sequence step number to stamp (1 for touch 1; the sequencer
 * passes its own step for touch 2).
 */
async function sendClaimEmail(lead, { touch = 1, step = 1, byUserId = null } = {}) {
  if (!lead?.email) throw new Error('lead has no email');
  if (!lead.claim_token) throw new Error('lead has no claim_token');
  let { subject, html, text } = await buildClaimEmailForLead(lead, touch);
  const base = (process.env.PUBLIC_BASE_URL || '').replace(/\/$/, '');
  const trackToken = base ? crypto.randomBytes(16).toString('hex') : null;
  const pixelUrl = trackToken ? `${base}/api/leadgen/o/${trackToken}.gif` : null;

  // Promotions-tab strategy (2026-09-03, from the A/B rounds: plain touches
  // land Primary, the branded template starts fresh threads in Promotions):
  // a follow-up claim touch rides the EXISTING touch-1 thread as a "Re:" reply
  // — the thread already has Primary standing. Best-effort: if the original
  // message's headers can't be fetched, it falls back to a fresh thread.
  let threading = {};
  if (touch > 1 && lead.outreach_thread_id && lead.outreach_message_id) {
    const refs = await gmail.getReplyRefs({ repEmail: MARK_EMAIL, messageId: lead.outreach_message_id });
    if (refs?.rfcMessageId) {
      const origSubject = refs.subject || subject;
      subject = /^re:/i.test(origSubject) ? origSubject : `Re: ${origSubject}`;
      threading = { threadId: lead.outreach_thread_id, inReplyTo: refs.rfcMessageId };
    }
  }

  const { messageId, threadId } = await gmail.sendAsRep({
    repEmail: MARK_EMAIL, repName: 'Mark', to: lead.email, subject, text, html, pixelUrl,
    unsubscribeUrl: unsubscribeUrl(lead.claim_token),
    ...threading,
  });
  const nowIso = new Date().toISOString();
  const patch = {
    outreach_status: 'sent', outreach_step: step, outreach_last_step_at: nowIso,
    outreach_message_id: messageId, outreach_track_token: trackToken,
    outreach_opened_at: null, outreach_last_opened_at: null, outreach_open_count: 0,
    last_activity_at: nowIso, review_status: 'approved',
  };
  if (touch === 1) { patch.outreach_sent_at = nowIso; patch.outreach_thread_id = threadId; if (byUserId) patch.outreach_sent_by = byUserId; patch.ai_draft_subject = subject; patch.ai_draft_message = text; }
  await supabase.from('leads').update(patch).eq('id', lead.id);
  await supabase.from('marketing_events').insert({ lead_id: lead.id, event: touch === 1 ? 'email_sent_touch1' : 'email_sent_touch2', metadata: { subject, message_id: messageId } }).then(() => {}, () => {});
  try { await logActivity({ action: touch === 1 ? 'lead_outreach_sent' : 'lead_followup_email', entityType: 'lead', entityId: lead.id, entityName: lead.company_name || lead.email, actorId: byUserId, actorName: 'Mark (claim email)', details: { touch, step, subject } }); } catch { /* best-effort */ }
  return { messageId, threadId, subject };
}

module.exports = { buildClaimEmailForLead, sendClaimEmail };
