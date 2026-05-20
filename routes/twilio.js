// ─── Twilio routes — SMS + Voice (Phase 1 + Phase 2) ─────────────────────────
//
// Endpoints:
//   POST /api/twilio/token             — short-lived Voice SDK token (auth required)
//   POST /api/twilio/sms/send          — send SMS (auth required)
//   POST /api/twilio/sms-status        — Twilio webhook: SMS delivery status
//   POST /api/twilio/sms-inbound       — Twilio webhook: inbound SMS
//   POST /api/twilio/voice                — Twilio webhook: voice TwiML (browser → PSTN)
//   POST /api/twilio/voice-status         — Twilio webhook: call status updates
//   POST /api/twilio/recording-status     — Twilio webhook: recording ready
//   POST /api/twilio/recording-disclosure — Twilio whisper: played to callee on pickup
//   POST /api/twilio/inbound-voice        — Twilio webhook: inbound calls → ring user(s)
//   POST /api/twilio/inbound-dial-result  — Twilio webhook: post-Dial branch (answered vs voicemail)
//   POST /api/twilio/voicemail-complete   — Twilio webhook: voicemail recording finished
//   GET  /api/twilio/recording/:callId    — proxied audio stream (auth required)
//
// Webhooks validate Twilio's X-Twilio-Signature header before processing.
// /token and /sms/send validate the caller's Supabase JWT.
//
// Activity feed inserts match the existing schema used by the ops `logActivity`
// helper: { action, entity_type, entity_id, actor_id, details } — NOT
// action_type/contact_id/lead_id which don't exist on the table.

const express = require('express');
const { parsePhoneNumber } = require('libphonenumber-js');
const supabase = require('../config/supabase');
const {
  twilio,
  twilioClient,
  accountSid,
  authToken,
  apiKeySid,
  apiKeySecret,
  twilioFrom,
  twimlAppSid,
  publicBaseUrl,
  isVoiceConfigured,
} = require('../config/twilio');

const router = express.Router();

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Validate Twilio's X-Twilio-Signature header against the request body.
 * Uses the configured PUBLIC_BASE_URL so the signature compares against the
 * exact URL Twilio used (req.originalUrl includes the /api/twilio prefix).
 */
function validateTwilioSignature(req) {
  if (!authToken) return false;
  const signature = req.headers['x-twilio-signature'];
  if (!signature) return false;
  const url = `${publicBaseUrl}${req.originalUrl}`;
  return twilio.validateRequest(authToken, signature, url, req.body || {});
}

/**
 * Resolve a Bearer JWT from the Authorization header against Supabase.
 * Returns the user object on success, null otherwise.
 */
async function validateUserSession(req) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  const token = authHeader.slice(7);
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data?.user) return null;
  return data.user;
}

/**
 * Find a contact or lead whose phone matches `phone` (already E.164).
 * Used to auto-link inbound SMS / calls to the right CRM record.
 */
async function findEntityByPhone(phone) {
  if (!phone) return { entity_type: null, entity_id: null, name: null };

  const { data: contact } = await supabase
    .from('contacts')
    .select('id, first_name, last_name')
    .eq('phone', phone)
    .maybeSingle();
  if (contact) {
    const name = [contact.first_name, contact.last_name].filter(Boolean).join(' ').trim() || phone;
    return { entity_type: 'contact', entity_id: contact.id, name, contact_id: contact.id, lead_id: null };
  }

  const { data: lead } = await supabase
    .from('leads')
    .select('id, contact_name')
    .eq('phone', phone)
    .maybeSingle();
  if (lead) {
    return { entity_type: 'lead', entity_id: lead.id, name: lead.contact_name || phone, contact_id: null, lead_id: lead.id };
  }

  return { entity_type: null, entity_id: null, name: phone, contact_id: null, lead_id: null };
}

/**
 * Best-effort activity log. Never throws — matches the fire-and-forget
 * pattern used by the ops `logActivity` helper.
 */
async function logActivity({ action, entityType, entityId, actorId, actorName, entityName, details }) {
  try {
    await supabase.from('activity_feed').insert([{
      action,
      entity_type: entityType,
      entity_id:   entityId,
      entity_name: entityName || null,
      actor_id:    actorId   || null,
      actor_name:  actorName || null,
      details:     details   || {},
    }]);
  } catch (err) {
    console.warn('[twilio] activity log failed:', err.message);
  }
}

// ─── POST /api/twilio/token — Voice SDK access token ─────────────────────────
//
// Phase 1 ships this so the browser Phase 2 calling client can grab a token
// at start-up. Returns 503 until API key + TwiML app SID are configured.
router.post('/token', async (req, res) => {
  const user = await validateUserSession(req);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });

  if (!isVoiceConfigured()) {
    return res.status(503).json({ error: 'Voice SDK not configured yet — Phase 2 setup pending' });
  }

  const AccessToken = twilio.jwt.AccessToken;
  const VoiceGrant  = AccessToken.VoiceGrant;

  const identity = `user_${user.id}`;
  const token    = new AccessToken(accountSid, apiKeySid, apiKeySecret, {
    identity,
    ttl: 3600,
  });

  const voiceGrant = new VoiceGrant({
    outgoingApplicationSid: twimlAppSid,
    incomingAllow: true,
  });
  token.addGrant(voiceGrant);

  res.json({ token: token.toJwt(), identity });
});

// ─── POST /api/twilio/sms/send — send SMS from the ops UI ────────────────────
router.post('/sms/send', async (req, res) => {
  const user = await validateUserSession(req);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });
  if (!twilioClient || !twilioFrom) {
    return res.status(503).json({ error: 'Twilio not configured' });
  }

  const { to, body, contact_id, lead_id } = req.body || {};
  if (!to || !body) {
    return res.status(400).json({ error: 'to and body are required' });
  }

  // Validate destination is E.164 + actually a valid number.
  let parsed;
  try {
    parsed = parsePhoneNumber(to);
    if (!parsed || !parsed.isValid()) throw new Error('invalid');
  } catch {
    return res.status(400).json({ error: 'Invalid phone number. Use E.164, e.g. +13025551234' });
  }
  const toE164 = parsed.format('E.164');

  try {
    const message = await twilioClient.messages.create({
      to:    toE164,
      from:  twilioFrom,
      body,
      statusCallback: `${publicBaseUrl}/api/twilio/sms-status`,
    });

    // Persist outbound message.
    const { data: smsRecord, error: smsErr } = await supabase
      .from('sms_messages')
      .insert([{
        twilio_sid:   message.sid,
        direction:    'outbound',
        from_number:  twilioFrom,
        to_number:    toE164,
        body,
        status:       message.status || 'queued',
        num_segments: parseInt(message.numSegments || '1', 10),
        contact_id:   contact_id || null,
        lead_id:      lead_id    || null,
        sent_by:      user.id,
        sent_at:      new Date().toISOString(),
      }])
      .select()
      .single();
    if (smsErr) console.error('[twilio] sms insert error:', smsErr);

    // Activity feed: attach to whichever entity was provided.
    if (contact_id || lead_id) {
      await logActivity({
        action:     'sms_sent',
        entityType: contact_id ? 'contact' : 'lead',
        entityId:   contact_id || lead_id,
        actorId:    user.id,
        actorName:  user.email || null,
        details:    { to: toE164, body: body.slice(0, 200), twilio_sid: message.sid },
      });
    }

    res.json({ success: true, sid: message.sid, sms: smsRecord });
  } catch (err) {
    console.error('[twilio] SMS send error:', err);
    res.status(500).json({ error: err.message || 'Failed to send SMS' });
  }
});

// ─── POST /api/twilio/sms-status — Twilio webhook: delivery status updates ──
router.post('/sms-status', async (req, res) => {
  if (!validateTwilioSignature(req)) {
    return res.status(403).send('Invalid signature');
  }

  const { MessageSid, MessageStatus, ErrorCode, ErrorMessage } = req.body || {};
  if (!MessageSid) return res.status(400).send('Missing MessageSid');

  const updates = { status: MessageStatus };
  if (ErrorCode)    updates.error_code    = String(ErrorCode);
  if (ErrorMessage) updates.error_message = ErrorMessage;
  if (MessageStatus === 'delivered') updates.delivered_at = new Date().toISOString();

  try {
    await supabase.from('sms_messages').update(updates).eq('twilio_sid', MessageSid);
  } catch (err) {
    console.error('[twilio] sms-status update error:', err);
  }

  res.status(200).send('OK');
});

// ─── POST /api/twilio/sms-inbound — Twilio webhook: inbound SMS ─────────────
router.post('/sms-inbound', async (req, res) => {
  if (!validateTwilioSignature(req)) {
    return res.status(403).send('Invalid signature');
  }

  const { MessageSid, From, To, Body, NumSegments } = req.body || {};
  if (!From || !To || Body === undefined) {
    return res.status(400).send('Missing required fields');
  }

  const link = await findEntityByPhone(From);

  try {
    await supabase.from('sms_messages').insert([{
      twilio_sid:   MessageSid,
      direction:    'inbound',
      from_number:  From,
      to_number:    To,
      body:         Body,
      status:       'received',
      num_segments: parseInt(NumSegments || '1', 10),
      contact_id:   link.contact_id,
      lead_id:      link.lead_id,
    }]);
  } catch (err) {
    console.error('[twilio] sms-inbound insert error:', err);
  }

  if (link.entity_type && link.entity_id) {
    await logActivity({
      action:     'sms_received',
      entityType: link.entity_type,
      entityId:   link.entity_id,
      entityName: link.name,
      details:    { from: From, body: Body.slice(0, 200), twilio_sid: MessageSid },
    });
  }

  res.set('Content-Type', 'text/xml');
  res.send('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
});

// ─── POST /api/twilio/voice — TwiML for browser-initiated calls ─────────────
//
// Lifecycle:
//   1. User clicks Call in the ops UI; useVoiceCall calls Device.connect({ params: { To, contactId, leadId, recordOverride } })
//   2. Twilio POSTs here with CallSid, From=client:user_<uuid>, plus our custom params
//   3. We look up the calling user's record_calls preference, decide if this
//      specific call should be recorded (settings ON && !recordOverride),
//      INSERT a row into `calls` so the status callback has something to update,
//      then return TwiML that <Dial>s the To number — optionally with a
//      "This call is being recorded." disclosure spoken by Polly.Joanna.
//
// The action + recordingStatusCallback URLs both embed ?callRowId=<uuid> so
// subsequent webhooks update the right row even if Twilio re-uses or delays
// the CallSid (it shouldn't, but we don't want to rely on that).
router.post('/voice', async (req, res) => {
  if (!validateTwilioSignature(req)) return res.status(403).send('Invalid signature');

  const { To, From, CallSid, contactId, leadId, recordOverride } = req.body || {};

  // Extract the Supabase user id from the Voice SDK identity. Identity comes
  // from /token as "user_<uuid>" but the Voice SDK wraps it as "client:user_<uuid>"
  // when speaking to Twilio. Be liberal about both forms.
  let userId = null;
  if (typeof From === 'string') {
    const m = From.match(/(?:^|:)user_([0-9a-fA-F-]{36})$/);
    if (m) userId = m[1];
  }

  // Decide whether this call is recorded.
  // settings.record_calls is the user's persisted preference (default false);
  // recordOverride === 'true' means "off for this call only".
  let recordCalls = false;
  if (userId) {
    try {
      const { data } = await supabase
        .from('user_settings')
        .select('record_calls')
        .eq('user_id', userId)
        .maybeSingle();
      recordCalls = Boolean(data?.record_calls);
    } catch (err) {
      console.warn('[twilio] could not load user_settings, defaulting record=false:', err.message);
    }
  }
  const shouldRecord = recordCalls && recordOverride !== 'true';

  // Try to attach this call to a CRM record. Explicit IDs (from the UI) win;
  // otherwise fall back to a phone lookup so inbound-style threading works too.
  let link = { entity_type: null, entity_id: null, contact_id: null, lead_id: null, name: To || null };
  if (contactId) {
    link = { entity_type: 'contact', entity_id: contactId, contact_id: contactId, lead_id: null, name: null };
  } else if (leadId) {
    link = { entity_type: 'lead', entity_id: leadId, contact_id: null, lead_id: leadId, name: null };
  } else if (To) {
    link = await findEntityByPhone(To);
  }

  // Insert the calls row up-front so /voice-status has something to update.
  let callRowId = null;
  try {
    const { data: row, error } = await supabase
      .from('calls')
      .insert([{
        twilio_sid:  CallSid || null,
        direction:   'outbound',
        from_number: twilioFrom,
        to_number:   To || '',
        status:      'initiated',
        contact_id:  link.contact_id,
        lead_id:     link.lead_id,
        handled_by:  userId,
        recorded:    shouldRecord,
        disclosed:   shouldRecord,
        started_at:  new Date().toISOString(),
      }])
      .select('id')
      .single();
    if (error) throw error;
    callRowId = row.id;
  } catch (err) {
    console.error('[twilio] /voice failed to create calls row:', err);
    // Fall through — still return TwiML so the user hears something instead of
    // a dead silence + Twilio 11200 error. We just lose the row linkage.
  }

  const twiml = new twilio.twiml.VoiceResponse();

  if (!To || !twilioFrom) {
    twiml.say('No destination provided.');
    res.set('Content-Type', 'text/xml');
    return res.send(twiml.toString());
  }

  // NB: the disclosure is delivered to the CALLED party via the <Number url=…>
  // whisper hook (see /recording-disclosure below), NOT via a top-level <Say>
  // here. A top-level <Say> only plays to the calling leg (the browser) before
  // the dial begins — meaning the recipient never hears it, which defeats the
  // entire point. The whisper plays to the recipient between their pickup and
  // the bridge. The caller's confirmation is the red Recording pill in the
  // CallWidget UI.
  const statusUrl    = `${publicBaseUrl}/api/twilio/voice-status${callRowId ? `?callRowId=${callRowId}` : ''}`;
  const recordingUrl = `${publicBaseUrl}/api/twilio/recording-status${callRowId ? `?callRowId=${callRowId}` : ''}`;
  const whisperUrl   = `${publicBaseUrl}/api/twilio/recording-disclosure`;

  const dialOpts = {
    callerId: twilioFrom,
    action:   statusUrl,
  };
  if (shouldRecord) {
    dialOpts.record = 'record-from-answer-dual';
    dialOpts.recordingStatusCallback = recordingUrl;
  }
  const dial = twiml.dial(dialOpts);

  const numberAttrs = {
    statusCallbackEvent: 'initiated ringing answered completed',
    statusCallback:      statusUrl,
  };
  if (shouldRecord) {
    numberAttrs.url = whisperUrl;
  }
  dial.number(numberAttrs, To);

  res.set('Content-Type', 'text/xml');
  res.send(twiml.toString());
});

// ─── POST /api/twilio/recording-disclosure — whisper played to callee ───────
//
// Hit by Twilio when the called party answers, BEFORE bridging to the caller
// (per <Number url="…">). Plays a single Polly.Joanna line and returns;
// Twilio then bridges the two legs. There is no DB side-effect here; the
// recording start is handled by <Dial record=…> back on /voice.
router.post('/recording-disclosure', (req, res) => {
  if (!validateTwilioSignature(req)) return res.status(403).send('Invalid signature');
  const twiml = new twilio.twiml.VoiceResponse();
  twiml.say({ voice: 'Polly.Joanna' }, 'This call is being recorded.');
  res.set('Content-Type', 'text/xml');
  res.send(twiml.toString());
});

// ─── POST /api/twilio/voice-status — call status webhook ────────────────────
//
// Twilio fires this for every status transition AND when the <Dial> verb
// completes (because we set action=). On completion we also log to the
// activity feed and bump status to 'completed'.
router.post('/voice-status', async (req, res) => {
  if (!validateTwilioSignature(req)) return res.status(403).send('Invalid signature');

  const { CallSid, CallStatus, CallDuration, DialCallStatus, DialCallDuration } = req.body || {};
  const callRowId = req.query.callRowId || null;

  // <Dial> action posts use DialCall* names; status callbacks use Call* names.
  const status     = CallStatus     || DialCallStatus     || null;
  const durationS  = CallDuration   || DialCallDuration   || null;

  const updates = {};
  if (CallSid) updates.twilio_sid = CallSid;
  if (status)  updates.status     = status;

  if (status === 'in-progress' || status === 'answered') {
    updates.answered_at = new Date().toISOString();
  }
  if (['completed', 'failed', 'busy', 'no-answer', 'canceled'].includes(status)) {
    updates.ended_at = new Date().toISOString();
    if (durationS) updates.duration_seconds = parseInt(durationS, 10);
  }

  try {
    if (callRowId) {
      await supabase.from('calls').update(updates).eq('id', callRowId);
    } else if (CallSid) {
      await supabase.from('calls').update(updates).eq('twilio_sid', CallSid);
    }
  } catch (err) {
    console.error('[twilio] /voice-status update error:', err);
  }

  // Activity feed entry once the call has truly ended (not on transient events).
  if (status === 'completed' && callRowId) {
    try {
      const { data: call } = await supabase
        .from('calls')
        .select('id, handled_by, contact_id, lead_id, duration_seconds, recorded')
        .eq('id', callRowId)
        .maybeSingle();
      if (call && (call.contact_id || call.lead_id)) {
        await logActivity({
          action:     'call_completed',
          entityType: call.contact_id ? 'contact' : 'lead',
          entityId:   call.contact_id || call.lead_id,
          actorId:    call.handled_by,
          details:    {
            duration_seconds: call.duration_seconds || 0,
            recorded:         !!call.recorded,
            twilio_sid:       CallSid,
          },
        });
      }
    } catch (err) {
      console.warn('[twilio] activity log on call_completed failed:', err.message);
    }
  }

  res.status(200).send('OK');
});

// ─── POST /api/twilio/recording-status — recording ready webhook ────────────
//
// Fired separately from voice-status when Twilio finishes processing the
// recording. Only act on RecordingStatus='completed'.
router.post('/recording-status', async (req, res) => {
  if (!validateTwilioSignature(req)) return res.status(403).send('Invalid signature');

  const { RecordingSid, RecordingUrl, RecordingDuration, RecordingStatus } = req.body || {};
  const callRowId = req.query.callRowId || null;

  if (RecordingStatus !== 'completed' || !callRowId) {
    return res.status(200).send('OK');
  }

  try {
    await supabase.from('calls').update({
      recording_sid:              RecordingSid,
      recording_url:              RecordingUrl,
      recording_duration_seconds: parseInt(RecordingDuration || '0', 10),
    }).eq('id', callRowId);
  } catch (err) {
    console.error('[twilio] /recording-status update error:', err);
  }

  res.status(200).send('OK');
});

// ─── Inbound calling (Phase 3a) ──────────────────────────────────────────────
//
// Lifecycle:
//   1. External caller dials our Twilio number → Twilio POSTs /inbound-voice
//   2. We look up the caller, decide who to ring, decide whether to record,
//      insert a calls row up-front, and return TwiML that <Dial>s one or
//      more <Client>s (Stemfra users' browsers via Voice SDK).
//   3. <Dial action=/inbound-dial-result> fires after the dial finishes —
//      either bridged-and-completed, or no-answer/busy → fall through to
//      voicemail.
//   4. <Record action=/voicemail-complete> fires once the voicemail audio
//      is captured (action fires even on empty/silent recordings).
//
// Recording disclosure (legal):
//   For inbound, the CALLER (PSTN leg) needs to hear the disclosure. Since
//   /inbound-voice TwiML runs on the caller's leg, a top-level <Say> at the
//   start of the response plays to them, before the <Dial> bridges anyone.
//   This is DIFFERENT from outbound (where we use <Number url=…> whisper
//   because the TwiML there runs on the browser leg). The provided spec
//   suggested a <Client url=…> whisper for inbound, but that whispers to
//   the Stemfra user — wrong direction. Documented for future reference.

function isFreshOnline(p, maxAgeMs = 60_000) {
  if (!p || !p.is_online || !p.last_heartbeat) return false;
  return Date.now() - new Date(p.last_heartbeat).getTime() < maxAgeMs;
}

async function getAssignedUser(contactId, leadId) {
  if (leadId) {
    const { data } = await supabase.from('leads').select('assigned_to').eq('id', leadId).maybeSingle();
    return data?.assigned_to || null;
  }
  if (contactId) {
    // Walk up to the most recent active lead for this contact.
    const { data } = await supabase
      .from('leads')
      .select('assigned_to')
      .eq('contact_id', contactId)
      .not('stage', 'in', '(lost,won)')
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    return data?.assigned_to || null;
  }
  return null;
}

async function isContactOptedOut(contactId, leadId) {
  if (contactId) {
    const { data } = await supabase.from('contacts').select('never_record').eq('id', contactId).maybeSingle();
    if (data?.never_record) return true;
  }
  if (leadId) {
    const { data } = await supabase.from('leads').select('never_record').eq('id', leadId).maybeSingle();
    if (data?.never_record) return true;
  }
  return false;
}

function appendVoicemailTwiml(twiml, callRowId) {
  twiml.say(
    { voice: 'Polly.Joanna' },
    "Hi, you've reached STEMfra. We can't take your call right now. " +
    "Please leave a message after the tone, or text us instead. " +
    "We'll get back to you soon."
  );
  twiml.record({
    action: `${publicBaseUrl}/api/twilio/voicemail-complete${callRowId ? `?callRowId=${callRowId}` : ''}`,
    maxLength: 120, // 2 min
    timeout: 5,     // hang up after 5s of silence
    recordingStatusCallback: `${publicBaseUrl}/api/twilio/recording-status${callRowId ? `?callRowId=${callRowId}` : ''}`,
  });
  // Failsafe — if Record times out without recording or action handler is
  // skipped, this final say + hangup runs.
  twiml.say({ voice: 'Polly.Joanna' }, 'Thank you. Goodbye.');
  twiml.hangup();
}

// ─── POST /api/twilio/inbound-voice ─────────────────────────────────────────
router.post('/inbound-voice', async (req, res) => {
  if (!validateTwilioSignature(req)) return res.status(403).send('Invalid signature');

  const { From, To, CallSid } = req.body || {};
  const link = await findEntityByPhone(From);

  // Decide who to ring: assigned user (if online) → all online users.
  let userIdsToRing = [];
  const assignedUserId = await getAssignedUser(link.contact_id, link.lead_id);
  if (assignedUserId) {
    const { data } = await supabase
      .from('user_presence')
      .select('is_online, last_heartbeat')
      .eq('user_id', assignedUserId)
      .maybeSingle();
    if (isFreshOnline(data)) userIdsToRing = [assignedUserId];
  }
  if (userIdsToRing.length === 0) {
    const { data: allOnline } = await supabase
      .from('user_presence')
      .select('user_id, is_online, last_heartbeat')
      .eq('is_online', true);
    userIdsToRing = (allOnline || []).filter(isFreshOnline).map(p => p.user_id);
  }

  // Decide whether to record this call: any ringing user has the inbound
  // recording toggle on, AND the contact/lead hasn't opted out.
  let shouldRecord = false;
  if (userIdsToRing.length > 0) {
    const optedOut = await isContactOptedOut(link.contact_id, link.lead_id);
    if (!optedOut) {
      const { data: settings } = await supabase
        .from('user_settings')
        .select('record_inbound_calls')
        .in('user_id', userIdsToRing);
      shouldRecord = (settings || []).some(s => s.record_inbound_calls);
    }
  }

  // Persist the calls row up-front so action callbacks have something to update.
  let callRowId = null;
  try {
    const { data: row, error } = await supabase
      .from('calls')
      .insert([{
        twilio_sid:          CallSid || null,
        direction:           'inbound',
        from_number:         From || '',
        to_number:           To   || twilioFrom,
        status:              'ringing',
        recorded:            shouldRecord,
        disclosed:           shouldRecord,
        contact_id:          link.contact_id,
        lead_id:             link.lead_id,
        handled_by:          assignedUserId || null,
        routed_to_user_ids:  userIdsToRing,
        started_at:          new Date().toISOString(),
      }])
      .select('id')
      .single();
    if (error) throw error;
    callRowId = row.id;
  } catch (err) {
    console.error('[twilio] /inbound-voice insert error:', err);
  }

  const twiml = new twilio.twiml.VoiceResponse();

  // No one online → straight to voicemail.
  if (userIdsToRing.length === 0) {
    appendVoicemailTwiml(twiml, callRowId);
    res.set('Content-Type', 'text/xml');
    return res.send(twiml.toString());
  }

  // Caller-side disclosure (inbound: TwiML runs on the caller's leg).
  if (shouldRecord) {
    twiml.say({ voice: 'Polly.Joanna' }, 'This call is being recorded.');
  }

  const actionUrl = `${publicBaseUrl}/api/twilio/inbound-dial-result${callRowId ? `?callRowId=${callRowId}` : ''}`;
  const dialOpts = {
    timeout: 25,
    action:  actionUrl,
    answerOnBridge: true, // keep ringback for caller until a user picks up
  };
  if (shouldRecord) {
    dialOpts.record = 'record-from-answer-dual';
    dialOpts.recordingStatusCallback = `${publicBaseUrl}/api/twilio/recording-status${callRowId ? `?callRowId=${callRowId}` : ''}`;
  }
  const dial = twiml.dial(dialOpts);

  for (const userId of userIdsToRing) {
    dial.client({}, `user_${userId}`);
  }

  res.set('Content-Type', 'text/xml');
  res.send(twiml.toString());
});

// ─── POST /api/twilio/inbound-dial-result ───────────────────────────────────
router.post('/inbound-dial-result', async (req, res) => {
  if (!validateTwilioSignature(req)) return res.status(403).send('Invalid signature');

  const { DialCallStatus, DialCallDuration } = req.body || {};
  const callRowId = req.query.callRowId || null;

  if (DialCallStatus === 'completed' || DialCallStatus === 'answered') {
    // User answered + call ended normally.
    if (callRowId) {
      try {
        await supabase.from('calls').update({
          status:           'completed',
          duration_seconds: parseInt(DialCallDuration || '0', 10),
          ended_at:         new Date().toISOString(),
        }).eq('id', callRowId);

        const { data: call } = await supabase
          .from('calls')
          .select('id, contact_id, lead_id, handled_by, duration_seconds, recorded, from_number')
          .eq('id', callRowId)
          .maybeSingle();
        if (call && (call.contact_id || call.lead_id)) {
          await logActivity({
            action:     'call_received',
            entityType: call.contact_id ? 'contact' : 'lead',
            entityId:   call.contact_id || call.lead_id,
            actorId:    call.handled_by,
            details:    {
              duration_seconds: call.duration_seconds || 0,
              recorded:         !!call.recorded,
              from:             call.from_number,
            },
          });
        }
      } catch (err) {
        console.error('[twilio] /inbound-dial-result complete-update error:', err);
      }
    }
    const twiml = new twilio.twiml.VoiceResponse();
    twiml.hangup();
    res.set('Content-Type', 'text/xml');
    return res.send(twiml.toString());
  }

  // no-answer / busy / failed / canceled → fall through to voicemail.
  if (callRowId) {
    try {
      await supabase.from('calls').update({
        missed: true,
        status: 'no-answer',
      }).eq('id', callRowId);
    } catch (err) {
      console.error('[twilio] /inbound-dial-result no-answer-update error:', err);
    }
  }

  const twiml = new twilio.twiml.VoiceResponse();
  appendVoicemailTwiml(twiml, callRowId);
  res.set('Content-Type', 'text/xml');
  res.send(twiml.toString());
});

// ─── POST /api/twilio/voicemail-complete ────────────────────────────────────
//
// Fires as the <Record> action after the recording attempt finishes. We get
// the action callback even if the caller hung up before saying anything —
// in that case RecordingUrl/RecordingDuration will be missing or zero. We
// distinguish missed-call-without-voicemail from voicemail-left by checking
// for a real recording.
router.post('/voicemail-complete', async (req, res) => {
  if (!validateTwilioSignature(req)) return res.status(403).send('Invalid signature');

  const callRowId = req.query.callRowId || null;
  const { RecordingUrl, RecordingDuration, RecordingSid } = req.body || {};
  const durationSec = parseInt(RecordingDuration || '0', 10);
  const hasVoicemail = !!RecordingUrl && durationSec > 0;

  if (callRowId) {
    try {
      await supabase.from('calls').update({
        is_voicemail:                hasVoicemail,
        missed:                      true,
        status:                      'completed',
        recording_url:               RecordingUrl || null,
        recording_sid:               RecordingSid || null,
        recording_duration_seconds:  durationSec || null,
        ended_at:                    new Date().toISOString(),
      }).eq('id', callRowId);

      const { data: call } = await supabase
        .from('calls')
        .select('id, contact_id, lead_id, handled_by, from_number')
        .eq('id', callRowId)
        .maybeSingle();

      if (call && (call.contact_id || call.lead_id)) {
        await logActivity({
          action:     hasVoicemail ? 'voicemail_received' : 'call_missed',
          entityType: call.contact_id ? 'contact' : 'lead',
          entityId:   call.contact_id || call.lead_id,
          actorId:    call.handled_by,
          details:    hasVoicemail
            ? { duration_seconds: durationSec, from: call.from_number, recording_url: RecordingUrl, call_id: call.id }
            : { from: call.from_number },
        });
      }
    } catch (err) {
      console.error('[twilio] /voicemail-complete update error:', err);
    }
  }

  const twiml = new twilio.twiml.VoiceResponse();
  twiml.hangup();
  res.set('Content-Type', 'text/xml');
  res.send(twiml.toString());
});

// ─── GET /api/twilio/recording/:callId — proxied recording audio ────────────
//
// Twilio recording URLs require HTTP Basic Auth with our Account SID and
// Auth Token. We obviously can't ship those to the browser, so the ops UI
// points <audio src=…> at this proxy instead. The endpoint:
//
//   1. Auths the requester by Supabase JWT (in ?token=… because <audio> can't
//      set Authorization headers reliably).
//   2. Looks up the calls row by id, reads recording_url.
//   3. Fetches the .mp3 from Twilio with our Basic Auth.
//   4. Forwards the response — including Range headers so the audio player
//      can seek — back to the browser.
//
// Note: query-string token is acceptable here because it travels over HTTPS
// only and is short-lived (Supabase access tokens expire in ~1 hour). A
// signed pre-authorized URL would be the next iteration if we expose
// recordings outside the authenticated app.
router.get('/recording/:callId', async (req, res) => {
  // 1. Auth — accept JWT from either ?token=… or Authorization header.
  const queryToken = typeof req.query.token === 'string' ? req.query.token : null;
  const headerAuth = req.headers.authorization;
  const headerToken = headerAuth && headerAuth.startsWith('Bearer ')
    ? headerAuth.slice(7)
    : null;
  const token = queryToken || headerToken;
  if (!token) return res.status(401).json({ error: 'Unauthorized' });

  let user;
  try {
    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data?.user) return res.status(401).json({ error: 'Unauthorized' });
    user = data.user;
  } catch {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  // 2. Look up recording URL on the calls row. Service-role client bypasses RLS,
  //    so we don't need a per-row policy — the JWT check above is the gate.
  const callId = req.params.callId;
  if (!callId) return res.status(400).json({ error: 'Missing callId' });

  const { data: call, error: callErr } = await supabase
    .from('calls')
    .select('id, recording_url, recording_sid, contact_id, lead_id, handled_by')
    .eq('id', callId)
    .maybeSingle();
  if (callErr) return res.status(500).json({ error: callErr.message });
  if (!call) return res.status(404).json({ error: 'Call not found' });
  if (!call.recording_url && !call.recording_sid) {
    return res.status(404).json({ error: 'No recording on file for this call' });
  }

  // 3. Build the Twilio recording URL. The webhook stores recording_url as
  //    the bare resource URL (no extension). Appending .mp3 forces Twilio to
  //    serve a playable, seekable audio file.
  const baseUrl = call.recording_url
    ? call.recording_url
    : `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Recordings/${call.recording_sid}`;
  const audioUrl = baseUrl.endsWith('.mp3') ? baseUrl : `${baseUrl}.mp3`;

  // 4. Fetch from Twilio with Basic Auth. Forward Range so seeking works.
  const basic = Buffer.from(`${accountSid}:${authToken}`).toString('base64');
  const upstreamHeaders = { Authorization: `Basic ${basic}` };
  if (req.headers.range) upstreamHeaders.Range = req.headers.range;

  let upstream;
  try {
    upstream = await fetch(audioUrl, { headers: upstreamHeaders });
  } catch (err) {
    console.error('[twilio] recording proxy fetch error:', err);
    return res.status(502).json({ error: 'Upstream fetch failed' });
  }

  if (!upstream.ok && upstream.status !== 206) {
    return res.status(upstream.status).end();
  }

  // 5. Forward status + headers the audio element cares about.
  res.status(upstream.status);
  const fwd = ['content-type', 'content-length', 'accept-ranges', 'content-range', 'cache-control'];
  for (const h of fwd) {
    const v = upstream.headers.get(h);
    if (v) res.setHeader(h, v);
  }
  if (!res.getHeader('content-type')) res.setHeader('content-type', 'audio/mpeg');
  if (!res.getHeader('accept-ranges')) res.setHeader('accept-ranges', 'bytes');
  // No-store keeps stale recordings from being cached by intermediates with
  // a different JWT in the URL.
  res.setHeader('cache-control', 'private, no-store');

  // 6. Stream the body. Node 22's fetch returns a Web ReadableStream.
  if (!upstream.body) return res.end();

  const reader = upstream.body.getReader();
  const pump = async () => {
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!res.write(Buffer.from(value))) {
          await new Promise(resolve => res.once('drain', resolve));
        }
      }
      res.end();
    } catch (err) {
      console.warn('[twilio] recording proxy stream interrupted:', err.message);
      try { res.end(); } catch {}
    }
  };
  req.on('close', () => { try { reader.cancel(); } catch {} });
  pump();
});

module.exports = router;
