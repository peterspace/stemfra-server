// Stemfra Voice (Agent 3) — Twilio ConversationRelay glue.
//  • conciergeIncoming  → TwiML that connects the call to our WebSocket brain.
//  • attachVoiceRelay   → the WebSocket server (real-time audio loop) on /voice/relay.
// Inbound for now; the same loop serves outbound (Twilio dials out with the same TwiML
// + customParameters carrying leadContext/direction) in the fast-follow.
const { WebSocketServer } = require('ws');
const supabase = require('../config/supabase');
const voiceBrain = require('../lib/voiceBrain');

const RELAY_PATH = '/voice/relay';
// A named, professional greeting (the assistant is "Mark"). Disclosure is now
// REACTIVE — Mark says he's an AI plainly if a caller asks — rather than upfront,
// which sounds more like a real front desk. NOTE: outbound calls (the fast-follow)
// must still disclose AI up front per the FCC's 2024 rules — give those a
// disclosing welcomeGreeting / leadContext, don't reuse this inbound one verbatim.
const GREETING = "Hi, I'm Mark with Stemfra — how can I help you today?";

function escapeXml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

// The public wss URL Twilio connects back to. Derived from PUBLIC_BASE_URL (the
// HTTPS base Twilio already uses for webhooks); falls back to the request host.
function relayUrl(req) {
  const base = process.env.PUBLIC_BASE_URL || `https://${req.headers.host}`;
  return base.replace(/^http/i, 'ws').replace(/\/+$/, '') + RELAY_PATH;
}

// POST /api/voice/concierge/incoming — Twilio voice webhook for inbound calls.
function conciergeIncoming(req, res) {
  console.log('[voice] inbound call → TwiML served (From:', req.body?.From || '?', ')');
  // interruptible=any + interruptSensitivity=high → most responsive barge-in.
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Response><Connect><ConversationRelay url="${escapeXml(relayUrl(req))}" welcomeGreeting="${escapeXml(GREETING)}" interruptible="any" interruptSensitivity="high" /></Connect></Response>`;
  res.type('text/xml').send(xml);
}

function safeSend(ws, obj) {
  try { if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(obj)); } catch { /* socket gone */ }
}

// One live phone conversation over the ConversationRelay WebSocket.
function handleRelay(ws) {
  const session = { history: [], from: null, callSid: null, abort: null, direction: 'inbound', leadContext: null, finalized: false };

  ws.on('message', async (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }

    switch (msg.type) {
      case 'setup': {
        session.from = msg.from || null;
        session.callSid = msg.callSid || null;
        // Outbound calls pass these via <ConversationRelay> customParameters.
        const p = msg.customParameters || {};
        if (p.leadContext) session.leadContext = String(p.leadContext);
        if (p.direction) session.direction = String(p.direction);
        console.log('[voice] ▶ call connected — from', session.from, '| callSid', session.callSid);
        voiceBrain.warmup();   // prime the LLM connection while the greeting plays → fast first reply
        break;
      }
      case 'prompt': {
        if (msg.last === false) return;              // skip interim partials
        const said = (msg.voicePrompt || '').trim();
        if (!said) return;
        console.log('[voice] 🗣  caller:', said);
        session.history.push({ role: 'user', content: said });
        session.abort?.abort();
        session.abort = new AbortController();
        let full = '';
        await voiceBrain.streamReply({
          history: session.history.slice(-12),
          leadContext: session.leadContext,
          signal: session.abort.signal,
          onToken: (t) => { full += t; safeSend(ws, { type: 'text', token: t, last: false }); },
        });
        safeSend(ws, { type: 'text', token: '', last: true });  // end of this spoken turn
        if (full) { console.log('[voice] 🤖 bot:', full.slice(0, 140)); session.history.push({ role: 'assistant', content: full }); }
        break;
      }
      case 'interrupt':                              // caller spoke over the TTS — stop talking
        session.abort?.abort();
        break;
      default:
        break;                                       // dtmf / error / info — ignored for v1
    }
  });

  ws.on('close', () => { console.log('[voice] ■ call ended —', session.history.length, 'turns'); finalizeCall(session).catch((e) => console.error('[voice] finalize error:', e.message)); });
  ws.on('error', () => {});
}

// At hang-up, distill the call into a CRM lead (best-effort). The call itself was the
// first touch, so we do NOT fire speed-to-lead here.
async function finalizeCall(session) {
  if (session.finalized) return;
  session.finalized = true;
  const lead = await voiceBrain.extractLead({ history: session.history });
  if (!lead) return;

  const name = lead.name && String(lead.name).trim() ? String(lead.name).trim() : null;
  const email = lead.email && /^\S+@\S+\.\S+$/.test(String(lead.email).trim()) ? String(lead.email).trim().toLowerCase() : null;
  // Prefer a callback number the caller explicitly gave; else their caller ID.
  const phone = (lead.phone && String(lead.phone).trim()) || session.from || null;
  // Only create a lead when the caller actually engaged — a name or an email.
  // (A pure info call shouldn't flood the CRM just because we have caller ID.)
  if (!name && !email) return;

  const notes = [
    lead.summary && String(lead.summary).trim(),
    lead.vertical ? `Business type: ${lead.vertical}` : '',
    lead.wants_followup ? 'Asked for a follow-up.' : '',
    `— Captured by Stemfra Voice (phone call${session.direction === 'outbound' ? ', outbound' : ''}).`,
  ].filter(Boolean).join('\n');

  const { error } = await supabase.from('leads').insert([{
    contact_name: name || phone || 'Phone caller',
    email,
    phone,
    service: 'website',
    stage: 'new_lead',
    source: 'voice_call',
    lead_source: 'voice_call',
    notes,
    last_activity_at: new Date().toISOString(),
  }]);
  if (error) console.error('[voice] lead insert failed:', error.message);
}

// Attach the WebSocket server to the shared HTTP server (called from index.js).
function attachVoiceRelay(server) {
  const wss = new WebSocketServer({ server, path: RELAY_PATH });
  wss.on('connection', (ws) => handleRelay(ws));
  console.log(`✓ Voice ConversationRelay WebSocket listening on ${RELAY_PATH}`);
  return wss;
}

module.exports = { conciergeIncoming, attachVoiceRelay };
