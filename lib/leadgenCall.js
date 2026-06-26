// Lead-gen Phase 3 — the outbound AI voice call. Wraps the PROVEN Stemfra Voice
// engine (twilio.calls.create + ConversationRelay → our /voice/relay brain) as a
// reusable function, used by the manual "Call with AI" button AND the auto
// speed-to-lead trigger in the reply sweeper. The call is WARM follow-up only —
// the lead replied to our outreach, so they've shown interest.
//
// Compliance: outbound AI calls disclose the AI up front (FCC 2024), the persona
// handles opt-out, and auto-calls are gated to US business hours (see the sweeper).
const { twilioClient } = require('../config/twilio');

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

// Context the voice brain receives (customParameters.leadContext) so Mark knows
// who he's calling and why.
function buildLeadContext(lead) {
  const q = lead.qualification || {};
  return [
    `This is an OUTBOUND follow-up call to ${lead.contact_name || 'the business owner'}${lead.company_name ? ' at ' + lead.company_name : ''}.`,
    'They REPLIED to our outreach email about a Stemfra website, so they have shown interest — be warm and reference that you are following up on their reply.',
    q.reasoning ? `Why they are a fit: ${q.reasoning}.` : '',
    lead.pain_point_bucket ? `Their likely pain point: ${String(lead.pain_point_bucket).replace(/_/g, ' ')}.` : '',
    'Keep it brief: confirm their interest, answer questions about Stemfra, and offer to get them started or have a teammate follow up. If they are busy or want to opt out, apologize warmly and end the call.',
  ].filter(Boolean).join(' ');
}

function buildGreeting(lead) {
  const first = lead.contact_name && !/^owner/i.test(lead.contact_name)
    ? `, is this ${String(lead.contact_name).trim().split(/\s+/)[0]}?` : '';
  return `Hi${first} This is Mark, a virtual assistant calling from Stemfra — I'm following up on the note we emailed you. Is now an okay time for a quick minute?`;
}

// Place the call. Returns { callSid, to }. Throws if not configured / no phone.
async function placeAiCall(lead) {
  if (!isConfigured()) throw new Error('Twilio is not configured for outbound voice');
  const to = toE164(lead.phone, lead.phone_country);
  if (!to) throw new Error('Lead has no usable phone number');
  const from = process.env.VOICE_PHONE_NUMBER || process.env.TWILIO_PHONE_NUMBER;

  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response><Connect><ConversationRelay url="${escapeXml(relayWss())}" welcomeGreeting="${escapeXml(buildGreeting(lead))}" interruptible="any" interruptSensitivity="high"><Parameter name="direction" value="outbound"/><Parameter name="leadContext" value="${escapeXml(buildLeadContext(lead))}"/></ConversationRelay></Connect></Response>`;

  const call = await twilioClient.calls.create({ to, from, twiml });
  return { callSid: call.sid, to };
}

module.exports = { isConfigured, placeAiCall, buildLeadContext, toE164 };
