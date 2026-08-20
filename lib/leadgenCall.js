// Lead-gen Phase 3 — the outbound AI voice call. Wraps the PROVEN Stemfra Voice
// engine (twilio.calls.create + ConversationRelay → our /voice/relay brain) as a
// reusable function, used by the manual "Call with AI" button AND the auto
// speed-to-lead trigger in the reply sweeper. The call is WARM follow-up only —
// the lead replied to our outreach, so they've shown interest.
//
// Compliance: outbound AI calls disclose the AI up front (FCC 2024), the persona
// handles opt-out, and auto-calls are gated to US business hours (see the sweeper).
const { twilioClient } = require('../config/twilio');
// Single-var supabase require per server convention.
const supabase = require('../config/supabase');

const RELAY_PATH = '/voice/relay';

function isConfigured() {
  return !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN
    && (process.env.VOICE_PHONE_NUMBER || process.env.TWILIO_PHONE_NUMBER));
}

function relayWss() {
  const base = process.env.PUBLIC_BASE_URL || 'https://api.stemfra.com';
  return base.replace(/^http/i, 'ws').replace(/\/+$/, '') + RELAY_PATH;
}

// Best-effort E.164 normalization (leads are US/CA-centric).
function toE164(phone, country) {
  if (!phone) return null;
  const p = String(phone).trim();
  if (p.startsWith('+')) return p.replace(/[^\d+]/g, '');
  const d = p.replace(/\D/g, '');
  if (d.length === 10) return '+1' + d;                 // US/CA local
  if (d.length === 11 && d.startsWith('1')) return '+' + d;
  return d ? '+' + d : null;
}

function escapeXml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

// Phase 1.5 — the lead's recent history so Mark genuinely REMEMBERS prior
// interactions (Phase 0 persists call transcripts + dispositions on activity_feed).
// Compacted to ~1.5K chars so it fits the TwiML parameter without bloat. Returns
// '' on any error (best-effort — history never blocks a call).
async function fetchLeadHistory(lead) {
  if (!lead?.id) return '';
  try {
    const { data } = await supabase
      .from('activity_feed')
      .select('action, details, created_at')
      .eq('entity_type', 'lead').eq('entity_id', lead.id)
      .order('created_at', { ascending: false })
      .limit(10);
    if (!data?.length) return '';
    const lines = [];
    for (const a of data) {
      const d = a.details || {};
      const when = a.created_at ? String(a.created_at).slice(0, 10) : '';
      if (a.action === 'voice_call' || a.action === 'voice_call_support') {
        lines.push(`${when} — prior ${d.direction || ''} call${d.disposition ? ` (${d.disposition}${d.sentiment ? ', ' + d.sentiment : ''})` : ''}`.replace(/\s+/g, ' ').trim());
        if (d.transcript) lines.push(`  what was said: ${String(d.transcript).replace(/\s+/g, ' ').slice(0, 400)}`);
      } else if (String(a.action).startsWith('lead_reply')) {
        lines.push(`${when} — they replied to our outreach`);
      } else if (a.action === 'note' || a.action === 'lead_note') {
        const t = d.text || d.note || d.body || '';
        if (t) lines.push(`${when} — staff note: ${String(t).replace(/\s+/g, ' ').slice(0, 200)}`);
      }
      if (lines.join('\n').length > 1500) break; // compact cap (~1.5K chars)
    }
    const out = lines.join('\n');
    return out.length > 1600 ? out.slice(0, 1600) + '…' : out;
  } catch {
    return '';
  }
}

// Context the voice brain receives (customParameters.leadContext) so Mark knows
// who he's calling and why. `reason` (optional, from staff) is prepended; `history`
// (optional, pre-fetched) is appended so Mark remembers prior calls.
function buildLeadContext(lead, { reason, history } = {}) {
  const q = lead.qualification || {};
  const reply = (lead.outreach_reply_text || '').trim();
  return [
    reason ? `REASON FOR THIS CALL (from staff): ${String(reason).trim()}` : '',
    `This is an OUTBOUND ${lead.outreach_sent_at ? 'follow-up' : 'FIRST-CONTACT'} call to ${lead.contact_name || 'the business owner'}${lead.company_name ? ' at ' + lead.company_name : ''}.`,
    // Cold split-funnel cohort (2026-08-20): Google-Maps leads with a phone but
    // NO EMAIL never got an email — the CALL is touch 1. Mark introduces the
    // built-for-them website and closes on ONE of: text the link, capture an
    // email (which sends the Claim email instantly), or a polite exit.
    !lead.outreach_sent_at
      ? 'They have NOT received any email or prior contact from us — this call is the introduction. Never imply we emailed them. Open warmly, get to the point fast: we already built a website for their business with online booking, it is free to claim and free to publish, and Stemfra only earns a flat five percent on the bookings it brings.'
      : (reply
          ? 'They REPLIED to the outreach email below — pick up exactly where the email left off and respond to what they actually said. Do NOT restart from scratch.'
          : 'This is a follow-up about the outreach email below.'),
    q.reasoning ? `Why they are a fit: ${q.reasoning}.` : '',
    lead.pain_point_bucket ? `Their likely pain point: ${String(lead.pain_point_bucket).replace(/_/g, ' ')}.` : '',
    lead.claim_token && lead.outreach_sent_at
      ? `THE EMAIL WE SENT THEM (${new Date(lead.outreach_sent_at).toLocaleDateString('en-US', { month: 'long', day: 'numeric' })}): the "Claim your website" email, subject "${lead.company_name || 'their business'}, this website is for you": we built a website for their business (online booking, AI front desk, text and email alerts, free hosting), free to claim and free to publish, and Stemfra only earns five percent on the bookings it brings. It has one button, "Claim my website", to their personal page where they can try the live sample site and claim it in about a minute. ${lead.outreach_opened_at ? 'They OPENED it.' : 'It has not been opened as far as we can tell.'}${lead.ai_draft_message && !lead.claim_token ? '' : ''}`
      : (lead.ai_draft_message ? `THE EMAIL WE SENT THEM:\n"${String(lead.ai_draft_message).slice(0, 700)}"` : ''),
    // Lead-gen research context (reviews, rating, city, no-website signal) lives
    // in the AI draft + qualification; Mark may use those FACTS naturally, but
    // any PRICE in old drafts (e.g. "starting at $750") is retired: the offer is
    // a free website + flat 5% commission, nothing else.
    lead.ai_draft_message ? `BACKGROUND FROM OUR RESEARCH ON THIS BUSINESS (use the facts naturally, e.g. their reviews, rating, area, that they have no website; IGNORE any prices mentioned here, the current offer is a free website and a flat five percent on bookings): "${String(lead.ai_draft_message).slice(0, 600)}"` : '',
    lead.raw_signal ? `RAW SIGNAL: ${String(typeof lead.raw_signal === 'string' ? lead.raw_signal : JSON.stringify(lead.raw_signal)).slice(0, 400)}` : '',
    lead.claim_token && lead.email ? 'RESEND THE LINK: if they cannot find the email or want the link again, say you will resend it right now, and START your NEXT reply with exactly [ACTION:resend_claim] followed by one short sentence like "One moment while I resend that." Never claim it is sent until a system note confirms it.' : '',
    lead.claim_token && lead.phone ? 'TEXT THEM THE LINK: if they are interested, offer to text the link to their website to this number right now. ONLY once they clearly say yes to a text, START your NEXT reply with exactly [ACTION:text_claim_link] followed by one short sentence like "Sending that text now." Never claim it is sent until a system note confirms it.' : '',
    'CAPTURE THEIR EMAIL: if they prefer email or give you an email address, repeat it back letter-perfect to confirm you heard it right. Once confirmed, START your NEXT reply with exactly [ACTION:capture_email their.address@example.com] (their REAL address inside the brackets, nothing else) followed by one short sentence like "Sending that over now." The system will email them their website link immediately. Never claim it is sent until a system note confirms it.',
    reply ? `THEIR REPLY:\n"${reply.slice(0, 700)}"` : '',
    history ? `PRIOR HISTORY WITH THIS LEAD (most recent first — you genuinely remember these, so reference them naturally):\n${history}` : '',
    lead.outreach_sent_at
      ? 'GOAL OF THIS CALL: address their reply, answer questions (you know the Stemfra offer: free website, five percent on bookings, no plans), and move them to ONE clear next step — get them to open the email and claim their website (or resend the link), or book a quick follow-up with a human teammate. If they object on price or say they already have a website, acknowledge it and briefly show the value (done-for-you site + 24/7 online booking + reminders that recover missed bookings). If they are busy or want to opt out, apologize warmly and end the call.'
      : 'GOAL OF THIS CALL: a short, warm introduction (under three minutes). One clear next step, in order of preference: (1) they agree to a TEXT with the link to their website → [ACTION:text_claim_link]; (2) they give an EMAIL → confirm it, then [ACTION:capture_email ...] and the link is emailed instantly; (3) neither → thank them and leave it friendly ("the site stays reserved for you"). Mention it takes about a minute to claim, there is nothing to pay, and Stemfra only earns five percent on bookings the site brings. If they say stop calling, apologize, promise no further calls, and end warmly. NEVER pressure; one ask per option, then move on.',
  ].filter(Boolean).join('\n');
}

function buildGreeting(lead) {
  const first = lead.contact_name && !/^owner/i.test(lead.contact_name)
    ? `, is this ${String(lead.contact_name).trim().split(/\s+/)[0]}?` : '';
  // Cold cohort (no email ever sent): never claim "we emailed you".
  if (!lead.outreach_sent_at) {
    return `Hi${first} This is Mark, a virtual assistant calling from Stemfra. We build websites for ${verticalNoun(lead)} — and we actually already set one up for ${lead.company_name || 'your business'}, free to claim. Do you have a quick minute?`;
  }
  return `Hi${first} This is Mark, a virtual assistant calling from Stemfra — I'm following up on the note we emailed you. Is now an okay time for a quick minute?`;
}

function verticalNoun(lead) {
  const t = lead.template_slug || (lead.qualification && lead.qualification.vertical) || '';
  if (/beauty|salon/.test(t)) return 'salons';
  if (/fitness|crossfit/.test(t)) return 'gyms';
  if (/studio|yoga/.test(t)) return 'studios';
  if (/wellness|massage|spa/.test(t)) return 'spas and massage studios';
  return 'barbershops';
}

// CallSid → { leadId, name, phone } for the Phase-1 webhooks (AMD voicemail
// drop + missed-call SMS). In-memory, capped — calls are low-volume.
const callMeta = new Map();
function rememberCall(sid, meta) {
  callMeta.set(sid, meta);
  if (callMeta.size > 200) callMeta.delete(callMeta.keys().next().value);
}
function getCallMeta(sid) { return callMeta.get(sid) || null; }

// Place the call. Returns { callSid, to }. Throws if not configured / no phone.
// opts.reason (optional) is the staff-entered "reason for this call".
async function placeAiCall(lead, { reason } = {}) {
  if (!isConfigured()) throw new Error('Twilio is not configured for outbound voice');
  const to = toE164(lead.phone, lead.phone_country);
  if (!to) throw new Error('Lead has no usable phone number');
  const from = process.env.VOICE_PHONE_NUMBER || process.env.TWILIO_PHONE_NUMBER;

  // Assembled BEFORE the call is placed → zero latency cost during the call.
  const history = await fetchLeadHistory(lead);

  const base = (process.env.PUBLIC_BASE_URL || 'https://api.stemfra.com').replace(/\/+$/, '');
  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response><Connect action="${escapeXml(base + '/api/voice/handoff')}"><ConversationRelay url="${escapeXml(relayWss())}" welcomeGreeting="${escapeXml(buildGreeting(lead))}" interruptible="any" interruptSensitivity="high"><Parameter name="direction" value="outbound"/><Parameter name="leadId" value="${escapeXml(String(lead.id || ''))}"/><Parameter name="leadContext" value="${escapeXml(buildLeadContext(lead, { reason, history }))}"/></ConversationRelay></Connect></Response>`;

  const call = await twilioClient.calls.create({
    to, from, twiml,
    // Voicemail detection (Phase 1): async AMD fires /api/voice/amd once the
    // machine's greeting ends → we drop a short spoken message at the beep.
    machineDetection: 'DetectMessageEnd',
    asyncAmd: 'true',
    asyncAmdStatusCallback: `${base}/api/voice/amd`,
    asyncAmdStatusCallbackMethod: 'POST',
    // Final call status → missed-call SMS follow-up when nobody picked up.
    statusCallback: `${base}/api/voice/outbound-status`,
    statusCallbackEvent: ['completed'],
    statusCallbackMethod: 'POST',
  });
  rememberCall(call.sid, { leadId: lead.id || null, name: lead.contact_name || null, phone: to });
  return { callSid: call.sid, to };
}

module.exports = { isConfigured, placeAiCall, buildLeadContext, toE164, getCallMeta };
