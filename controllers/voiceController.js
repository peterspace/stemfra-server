// Stemfra Voice (Agent 3) — Twilio ConversationRelay glue.
//  • conciergeIncoming  → TwiML that connects the call to our WebSocket brain.
//  • attachVoiceRelay   → the WebSocket server (real-time audio loop) on /voice/relay.
// Inbound for now; the same loop serves outbound (Twilio dials out with the same TwiML
// + customParameters carrying leadContext/direction) in the fast-follow.
const { WebSocketServer } = require('ws');
const supabase = require('../config/supabase');
const voiceBrain = require('../lib/voiceBrain');
const { logActivity } = require('../lib/activity');
const { sendMail } = require('../lib/mailer');
const emails = require('../templates/transactionalEmails');
const { twilioClient } = require('../config/twilio');
const leadgenCall = require('../lib/leadgenCall');
const voiceAccount = require('../lib/voiceAccount');

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

// Live transfer (Phase 1): available only when a staff number is configured and
// we are inside the transfer window (default 9-18 in TRANSFER_TZ). The brain
// only OFFERS a transfer when this is true; outside the window it promises a
// same-day follow-up instead.
let oooActive = null; // refreshed per call (see below)
function transferAvailable() {
  if (oooActive) return false;                 // team out of office: never transfer live
  if (!process.env.STAFF_TRANSFER_PHONE) return false;
  const tz = process.env.TRANSFER_TZ || 'America/New_York';
  const [start, end] = (process.env.TRANSFER_HOURS || '9-18').split('-').map(Number);
  try {
    const hour = Number(new Intl.DateTimeFormat('en-US', { hour: 'numeric', hour12: false, timeZone: tz }).format(new Date()));
    return hour >= start && hour < end;
  } catch { return false; }
}

// Live sessions by CallSid — lets the /handoff webhook (a separate HTTP request)
// reach the conversation that asked for the transfer.
const sessionsBySid = new Map();

// POST /api/voice/concierge/incoming — Twilio voice webhook for inbound calls.
function conciergeIncoming(req, res) {
  console.log('[voice] inbound call → TwiML served (From:', req.body?.From || '?', ')');
  // interruptible=any + interruptSensitivity=high → most responsive barge-in.
  const base = (process.env.PUBLIC_BASE_URL || `https://${req.headers.host}`).replace(/\/+$/, '');
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Response><Connect action="${escapeXml(base + '/api/voice/handoff')}"><ConversationRelay url="${escapeXml(relayUrl(req))}" welcomeGreeting="${escapeXml(GREETING)}" interruptible="any" interruptSensitivity="high" /></Connect></Response>`;
  res.type('text/xml').send(xml);
}

function safeSend(ws, obj) {
  try { if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(obj)); } catch { /* socket gone */ }
}

// Marker protocol ([TRANSFER] / [ACTION:*], Phases 1+2): a marker may sit at
// the very START of a reply. This filter buffers the first tokens so a marker
// is stripped BEFORE anything reaches the TTS, no matter how the token stream
// splits it. Pure — exported for tests.
// Prospecting (launch #7): on an OUTBOUND lead call, "[ACTION:resend_claim]"
// resends the branded Claim email (touch 1) to the source lead. Guarded to the
// call's own lead; never on inbound/unknown callers.
async function resendClaimForLead(session) {
  if (!session.leadId) return 'Action refused: this call is not linked to a prospect lead, so there is no email to resend. Offer to take their email for a teammate instead.';
  try {
    const { data: lead } = await supabase.from('leads').select('*').eq('id', session.leadId).maybeSingle();
    if (!lead?.email) return 'Action failed: this lead has no email address on file. Ask for their email so a teammate can send the link.';
    if (lead.do_not_email) return 'Action refused: this person unsubscribed from our emails. Do not resend; offer a teammate follow-up instead.';
    const { sendClaimEmail } = require('../lib/claimSend');
    await sendClaimEmail(lead, { touch: 1, step: lead.outreach_step || 1 });
    session.actionsTaken.push('resend_claim');
    const masked = String(lead.email).replace(/^(.).*(@.*)$/, '$1***$2');
    return `Done: the "Claim your website" email was resent to ${masked}. Tell them to look for it now (also in spam/promotions).`;
  } catch (e) { return `Action failed: could not resend the email (${e.message}). Apologize and promise a teammate will send the link today.`; }
}

const MARKERS = ['[TRANSFER]', '[ACTION:reset_password]', '[ACTION:ticket]', '[ACTION:callback]', '[ACTION:resend_claim]'];
function createMarkerFilter(markers, emit) {
  let pending = '';
  let checked = false;
  let marker = null;
  let full = '';
  return {
    onToken(t) {
      full += t;
      if (checked) return emit(t);
      pending += t;
      if (markers.some((m) => pending.length < m.length && pending === m.slice(0, pending.length))) return; // could still become a marker
      checked = true;
      const hit = markers.find((m) => pending.startsWith(m));
      if (hit) { marker = hit; pending = pending.slice(hit.length); }
      if (pending) emit(pending);
      pending = '';
    },
    flush() { if (!checked && pending) { checked = true; emit(pending); pending = ''; } },
    marker: () => marker,
    spoken: () => (marker ? full.slice(marker.length) : full),
  };
}

// One live phone conversation over the ConversationRelay WebSocket.
function handleRelay(ws) {
  const session = { history: [], from: null, callSid: null, abort: null, direction: 'inbound', leadContext: null, leadId: null, finalized: false, identity: null, actionsTaken: [] };
  // Out-of-office (crm_settings.out_of_office): refreshed per call, drives
  // transferAvailable() + the prompt's OOO line.
  require('../lib/outOfOffice').currentOrNext().then((p) => {
    const { DateTime } = require('luxon');
    const today = DateTime.now().setZone('America/New_York').toFormat('yyyy-MM-dd');
    oooActive = p && p.from <= today && today <= p.to ? { ...p, label: require('../lib/outOfOffice').describe(p), back: DateTime.fromISO(p.to, { zone: 'America/New_York' }).plus({ days: 1 }).toFormat('MMMM d') } : null;
  }).catch(() => { oooActive = null; });

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
        if (p.leadId) session.leadId = String(p.leadId);   // outbound: the SOURCE lead to update
        if (session.callSid) sessionsBySid.set(session.callSid, session);
        console.log('[voice] ▶ call connected — from', session.from, '| callSid', session.callSid);
        // Phase 2: identify the caller from caller ID (existing customer?) —
        // async and non-blocking; usually resolved before their first sentence.
        if (session.from) {
          voiceAccount.identifyAndBuildContext(session.from).then((id) => {
            session.identity = id;
            if (id) console.log('[voice] 👤 identified caller:', id.contact.full_name || id.contact.email, '·', id.sites.length, 'site(s)');
          });
        }
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
        // Voice turns are single short sentences, so a deep window is cheap —
        // 60 messages ≈ 30 exchanges. The old slice(-12) (≈6 exchanges) made
        // the agent FORGET details given minutes earlier and re-ask for the
        // caller's email/number — the caller experienced it as being called a
        // liar (Peter, 2026-07-21).
        // Marker protocol ([TRANSFER] / [ACTION:*], Phases 1+2): a marker sits at
        // the very START of a reply; we buffer the first tokens so markers are
        // stripped BEFORE anything reaches the TTS.
        const speakTurn = async () => {
          const emit = (t) => safeSend(ws, { type: 'text', token: t, last: false });
          const filter = createMarkerFilter(MARKERS, emit);
          const onToken = filter.onToken;
          await voiceBrain.streamReply({
            history: session.history.slice(-60),
            leadContext: session.leadContext,
            from: session.from,
            transferAvailable: transferAvailable(),
            oooNote: oooActive ? `OUT OF OFFICE: the Stemfra team is away ${oooActive.label}${oooActive.note ? ` (${oooActive.note})` : ''}. Do NOT offer a live transfer or a same-day callback. Take their details as usual and say a teammate will follow up right after ${oooActive.back}. Everything self-serve still works: they can start free at stemfra dot com any time.` : '',
            accountContext: session.identity ? session.identity.contextString : null,
            signal: session.abort.signal,
            onToken,
          });
          filter.flush();  // short reply that never exceeded marker length
          safeSend(ws, { type: 'text', token: '', last: true });  // end of this spoken turn
          const spoken = filter.spoken().trim();
          if (spoken) { console.log('[voice] 🤖 bot:', spoken.slice(0, 140)); session.history.push({ role: 'assistant', content: spoken }); }
          return filter.marker();
        };

        const marker = await speakTurn();
        if (marker === '[TRANSFER]' && !session.transferring) {
          session.transferring = true;
          console.log('[voice] ↪ live transfer requested — ending relay after the line is spoken');
          // Give the TTS a moment to finish the "connecting you" sentence, then
          // end the relay: Twilio then POSTs our <Connect action> (/handoff).
          setTimeout(() => safeSend(ws, { type: 'end', handoffData: JSON.stringify({ reason: 'live_transfer' }) }), 2500);
        } else if (marker && marker.startsWith('[ACTION:')) {
          // Phase 2 account action: execute server-side (guards inside — no
          // identity, no action), feed the factual result back as a system
          // note, then ONE grounded follow-up turn so Mark relays the real
          // outcome. Markers on the chained turn are ignored (no action loops).
          const action = marker.slice(8, -1);
          console.log('[voice] ⚙ account action:', action, session.identity ? '(identified)' : '(NOT identified)');
          const result = action === 'resend_claim'
            ? await resendClaimForLead(session)   // outbound prospecting: resend the Claim email to the source lead
            : await voiceAccount.executeVoiceAction(action, session.identity, session);
          console.log('[voice] ⚙ result:', String(result).slice(0, 140));
          session.history.push({ role: 'system', content: `[system note] ${result}` });
          await speakTurn();
        }
        break;
      }
      case 'interrupt':                              // caller spoke over the TTS — stop talking
        session.abort?.abort();
        break;
      default:
        break;                                       // dtmf / error / info — ignored for v1
    }
  });

  ws.on('close', () => {
    if (session.callSid) sessionsBySid.delete(session.callSid);
    console.log('[voice] ■ call ended —', session.history.length, 'turns');
    finalizeCall(session).catch((e) => console.error('[voice] finalize error:', e.message));
  });
  ws.on('error', () => {});
}

// At hang-up, distill the call into structured outcomes (VOICE_AGENT.md Phase 0):
//  · SUPPORT calls → email to the support inbox + note on the source lead if any
//    — NEVER a new sales lead (they used to land in the leads pipeline mislabeled).
//  · SALES outbound (session.leadId) → UPDATE the source lead, no duplicate insert.
//  · SALES inbound → insert a lead as before, now with disposition/sentiment/plan.
//  · Every finalized call logs an activity_feed entry carrying the TRANSCRIPT.
// The call itself was the first touch, so we do NOT fire speed-to-lead here.
const SUPPORT_INBOX = process.env.SUPPORT_EMAIL || 'support@stemfra.com';

function buildTranscript(history, maxChars = 8000) {
  const t = history.map((m) => `${m.role === 'user' ? 'Caller' : 'Mark'}: ${m.content}`).join('\n');
  return t.length > maxChars ? t.slice(0, maxChars) + '\n… (truncated)' : t;
}

// Phase 1: warm recap email to a captured sales lead ("same-agent follow-up").
// Sent when we captured an email and the call went well; replies go to Mark's
// outreach inbox, which the reply sweeper already watches.
function sendRecapEmail(lead, session) {
  const email = lead.email && /^\S+@\S+\.\S+$/.test(String(lead.email).trim()) ? String(lead.email).trim().toLowerCase() : null;
  if (!email) return;
  if (!['qualified', 'callback_requested'].includes(lead.disposition)) return;
  if (lead.wants_followup === false) return;
  const first = lead.name ? String(lead.name).trim().split(/\s+/)[0] : null;
  sendMail({
    fromName: 'Mark from Stemfra',
    to: email,
    replyTo: process.env.MARK_EMAIL || 'mark@stemfra.com',
    subject: 'Great speaking with you',
    text: [
      `Hi${first ? ` ${first}` : ''},`,
      '',
      'Thank you for taking my call today. As promised, here is where everything lives:',
      'stemfra.com — you can preview your website free before paying anything.',
      lead.plan_discussed ? `We spoke about the ${lead.plan_discussed} plan — happy to answer anything else about it.` : '',
      '',
      'Just reply to this email and it comes straight to the team.',
      '',
      'Mark',
      'Stemfra',
    ].filter(Boolean).join('\n'),
    html: emails.voiceRecapEmail({ firstName: first, planDiscussed: lead.plan_discussed, summary: lead.summary }),
  }).catch((e) => console.error('[voice] recap email failed:', e.message));
}

async function finalizeCall(session) {
  if (session.finalized) return;
  session.finalized = true;
  if (!session.history.length) return;
  const lead = await voiceBrain.extractLead({ history: session.history });
  if (!lead) return;

  const name = lead.name && String(lead.name).trim() ? String(lead.name).trim() : null;
  const email = lead.email && /^\S+@\S+\.\S+$/.test(String(lead.email).trim()) ? String(lead.email).trim().toLowerCase() : null;
  // Prefer a callback number the caller explicitly gave; else their caller ID.
  const phone = (lead.phone && String(lead.phone).trim()) || session.from || null;
  const transcript = buildTranscript(session.history);
  const disposition = lead.disposition || (lead.intent === 'support' ? 'support_request' : 'not_qualified');
  const outcomeLine = [
    `Disposition: ${disposition}`,
    lead.sentiment ? `sentiment: ${lead.sentiment}` : '',
    lead.plan_discussed ? `plan discussed: ${lead.plan_discussed}` : '',
  ].filter(Boolean).join(' · ');

  // ── Support calls: route to the support inbox, NOT the sales pipeline ──────
  if (lead.intent === 'support' || disposition === 'support_request') {
    console.log('[voice] ☎ support call —', lead.support_issue || lead.summary || '(no issue text)');
    // If a ticket was already opened LIVE on the call ([ACTION:ticket]), the
    // support inbox already has it — don't email a duplicate; still log below.
    if (!(session.actionsTaken || []).includes('ticket')) sendMail({
      fromName: 'Stemfra Voice',
      to: SUPPORT_INBOX,
      replyTo: email || undefined,
      subject: `Support call${name ? ` from ${name}` : ''}${lead.support_issue ? ` — ${String(lead.support_issue).slice(0, 60)}` : ''}`,
      text: [
        'The voice agent took a support call. Follow up by email today (the agent promised a same-day reply).',
        `Caller: ${name || '(no name)'} · ${phone || '(no phone)'} · ${email || '(no email captured)'}`,
        lead.support_issue ? `Issue: ${lead.support_issue}` : '',
        lead.summary ? `Summary: ${lead.summary}` : '',
        '', 'Transcript:', transcript,
      ].filter(Boolean).join('\n'),
      html: emails.staffVoiceSupportNotification({
        callerName: name, callerEmail: email, callerPhone: phone,
        issue: lead.support_issue, summary: lead.summary, transcript,
      }),
    }).catch((e) => console.error('[voice] support email failed:', e.message));
    // If this call was about an existing CRM lead (outbound), note it there too.
    if (session.leadId) {
      await appendLeadNote(session.leadId, `Support request on a voice call: ${lead.support_issue || lead.summary || '(see support inbox)'}`);
    }
    await logActivity({
      action: 'voice_call_support', entityType: 'lead', entityId: session.leadId || null,
      actorName: 'Stemfra Voice', entityName: name || phone || 'Phone caller',
      details: { direction: session.direction, disposition, sentiment: lead.sentiment || null, issue: lead.support_issue || null, identified: !!session.identity, actions_taken: session.actionsTaken || [], transcript },
    });
    return;
  }

  // ── Sales, outbound: update the SOURCE lead (no duplicate insert) ──────────
  if (session.leadId) {
    const note = [
      lead.summary && String(lead.summary).trim(),
      outcomeLine,
      `— Stemfra Voice outbound call, ${new Date().toISOString().slice(0, 10)}.`,
    ].filter(Boolean).join('\n');
    await appendLeadNote(session.leadId, note);
    sendRecapEmail(lead, session);
    await logActivity({
      action: 'voice_call', entityType: 'lead', entityId: session.leadId,
      actorName: 'Stemfra Voice', entityName: name || phone || 'Phone caller',
      details: { direction: 'outbound', disposition, sentiment: lead.sentiment || null, plan_discussed: lead.plan_discussed || null, transcript },
    });
    return;
  }

  // ── Sales, inbound: create the lead (as before, now with outcomes) ─────────
  // Only when the caller actually engaged — a name or an email. (A pure info
  // call shouldn't flood the CRM just because we have caller ID.)
  if (!name && !email) return;

  const notes = [
    lead.summary && String(lead.summary).trim(),
    lead.vertical ? `Business type: ${lead.vertical}` : '',
    lead.wants_followup ? 'Asked for a follow-up.' : '',
    outcomeLine,
    `— Captured by Stemfra Voice (phone call).`,
  ].filter(Boolean).join('\n');

  const { data: inserted, error } = await supabase.from('leads').insert([{
    contact_name: name || phone || 'Phone caller',
    email,
    phone,
    service: 'website',
    stage: 'new_lead',
    source: 'voice_call',
    lead_source: 'voice_call',
    notes,
    last_activity_at: new Date().toISOString(),
  }]).select('id').single();
  if (error) { console.error('[voice] lead insert failed:', error.message); return; }
  sendRecapEmail(lead, session);
  await logActivity({
    action: 'voice_call', entityType: 'lead', entityId: inserted?.id || null,
    actorName: 'Stemfra Voice', entityName: name || phone || 'Phone caller',
    details: { direction: 'inbound', disposition, sentiment: lead.sentiment || null, plan_discussed: lead.plan_discussed || null, transcript },
  });
}

// Append a timestamped note to an existing lead + bump last_activity_at.
async function appendLeadNote(leadId, note) {
  try {
    const { data: row } = await supabase.from('leads').select('notes').eq('id', leadId).maybeSingle();
    const existing = row && row.notes ? String(row.notes).trimEnd() + '\n\n' : '';
    const { error } = await supabase.from('leads')
      .update({ notes: existing + note, last_activity_at: new Date().toISOString() })
      .eq('id', leadId);
    if (error) console.error('[voice] lead note update failed:', error.message);
  } catch (e) {
    console.error('[voice] lead note update failed:', e.message);
  }
}

// ─── Phase 1 webhooks (Twilio → us) ──────────────────────────────────────────

// POST /api/voice/handoff — the <Connect action>. Twilio calls this when the
// ConversationRelay session ends. If the brain requested a live transfer, dial
// the staff number (with a summary SMS to staff first); otherwise just hang up
// politely (normal call end also lands here).
function handleHandoff(req, res) {
  const { CallSid, From, HandoffData } = req.body || {};
  let reason = null;
  try { reason = HandoffData ? JSON.parse(HandoffData).reason : null; } catch { /* opaque */ }
  const staff = process.env.STAFF_TRANSFER_PHONE;
  if (reason === 'live_transfer' && staff && transferAvailable()) {
    const session = CallSid ? sessionsBySid.get(CallSid) : null;
    const lastSaid = session ? [...session.history].reverse().find((m) => m.role === 'user')?.content : null;
    // Summary SMS to staff, fire-and-forget, before the phone rings.
    const smsFrom = process.env.VOICE_PHONE_NUMBER || process.env.TWILIO_PHONE_NUMBER;
    if (twilioClient && smsFrom) {
      twilioClient.messages.create({
        to: staff, from: smsFrom,
        body: `Stemfra Voice live transfer from ${From || 'unknown'}${lastSaid ? ` — caller last said: "${String(lastSaid).slice(0, 120)}"` : ''}`,
      }).catch((e) => console.error('[voice] transfer SMS failed:', e.message));
    }
    console.log('[voice] ↪ dialing staff for live transfer —', From);
    const from = process.env.VOICE_PHONE_NUMBER || process.env.TWILIO_PHONE_NUMBER;
    return res.type('text/xml').send(`<?xml version="1.0" encoding="UTF-8"?>
<Response><Dial callerId="${escapeXml(from || '')}" timeout="25"><Number>${escapeXml(staff)}</Number></Dial><Say>Sorry, I could not reach a teammate — we will follow up with you today. Goodbye.</Say></Response>`);
  }
  // Normal end of conversation (or transfer unavailable): finish cleanly.
  return res.type('text/xml').send('<?xml version="1.0" encoding="UTF-8"?><Response><Hangup/></Response>');
}

// POST /api/voice/amd — async Answering Machine Detection result for outbound
// AI calls. On a machine: redirect the live call to a short voicemail drop.
function handleAmd(req, res) {
  const { CallSid, AnsweredBy } = req.body || {};
  res.sendStatus(204);
  if (!CallSid || !AnsweredBy || !String(AnsweredBy).startsWith('machine')) return;
  const meta = leadgenCall.getCallMeta(CallSid);
  const first = meta?.name && !/^owner/i.test(meta.name) ? String(meta.name).trim().split(/\s+/)[0] : null;
  const msg = `Hi${first ? ` ${first}` : ''}, this is Mark with Stemfra following up on the note we emailed you — sorry to have missed you. I will send you an email as well, and you can reply there any time. Have a great day.`;
  console.log('[voice] 🤖 voicemail detected on', CallSid, '→ dropping message');
  twilioClient.calls(CallSid).update({
    twiml: `<Response><Pause length="1"/><Say>${escapeXml(msg)}</Say><Hangup/></Response>`,
  }).catch((e) => console.error('[voice] voicemail drop failed:', e.message));
  if (meta?.leadId) {
    appendLeadNote(meta.leadId, `Outbound AI call reached voicemail — left a message. (${new Date().toISOString().slice(0, 10)})`)
      .catch(() => {});
  }
}

// POST /api/voice/outbound-status — final status of outbound AI calls. When the
// call never connected, follow up by SMS so the lead still hears from us
// (Thoughtly: 60–70% of outbound calls are not picked up).
function handleOutboundStatus(req, res) {
  const { CallSid, CallStatus } = req.body || {};
  res.sendStatus(204);
  if (!CallSid || !['no-answer', 'busy', 'failed', 'canceled'].includes(String(CallStatus))) return;
  const meta = leadgenCall.getCallMeta(CallSid);
  if (!meta) return; // not one of our outbound AI calls
  const smsFrom = process.env.VOICE_PHONE_NUMBER || process.env.TWILIO_PHONE_NUMBER;
  const first = meta.name && !/^owner/i.test(meta.name) ? String(meta.name).trim().split(/\s+/)[0] : null;
  if (twilioClient && smsFrom && meta.phone) {
    twilioClient.messages.create({
      to: meta.phone, from: smsFrom,
      body: `Hi${first ? ` ${first}` : ''}, Mark from Stemfra — I just tried to call about the note we emailed you. Reply to the email any time, or call this number back when it suits you.`,
    }).then(() => console.log('[voice] 📱 missed-call SMS sent for', CallSid))
      .catch((e) => console.error('[voice] missed-call SMS failed:', e.message));
  }
  if (meta.leadId) {
    appendLeadNote(meta.leadId, `Outbound AI call not answered (${CallStatus}) — sent a follow-up SMS. (${new Date().toISOString().slice(0, 10)})`)
      .catch(() => {});
  }
}

// Attach the WebSocket server to the shared HTTP server (called from index.js).
function attachVoiceRelay(server) {
  const wss = new WebSocketServer({ server, path: RELAY_PATH });
  wss.on('connection', (ws) => handleRelay(ws));
  console.log(`✓ Voice ConversationRelay WebSocket listening on ${RELAY_PATH}`);
  return wss;
}

module.exports = { conciergeIncoming, attachVoiceRelay, handleHandoff, handleAmd, handleOutboundStatus, createMarkerFilter };
