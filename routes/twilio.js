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

module.exports = router;
