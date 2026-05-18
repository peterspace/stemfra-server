// ─── Twilio routes — SMS send, webhooks, Voice SDK token (Phase 1) ───────────
//
// Endpoints:
//   POST /api/twilio/token         — short-lived Voice SDK token (auth required)
//   POST /api/twilio/sms/send      — send SMS (auth required)
//   POST /api/twilio/sms-status    — Twilio webhook: SMS delivery status
//   POST /api/twilio/sms-inbound   — Twilio webhook: inbound SMS
//   POST /api/twilio/voice         — Twilio webhook: voice TwiML (Phase 2 stub)
//   POST /api/twilio/voice-status  — Twilio webhook: voice status (Phase 2 stub)
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

// ─── POST /api/twilio/voice — TwiML for browser-initiated calls (Phase 2) ───
//
// Twilio hits this when a browser client uses Device.connect({ To: <number> }).
// We bridge to the To number, recording dual-channel. Status callbacks
// post to /voice-status. The Phase 2 work will polish recording handling.
router.post('/voice', (req, res) => {
  const { To } = req.body || {};
  const twiml  = new twilio.twiml.VoiceResponse();

  if (To && twilioFrom) {
    const dial = twiml.dial({
      callerId: twilioFrom,
      record: 'record-from-answer-dual',
      recordingStatusCallback: `${publicBaseUrl}/api/twilio/recording-status`,
    });
    dial.number(To);
  } else {
    twiml.say('No destination provided.');
  }

  res.set('Content-Type', 'text/xml');
  res.send(twiml.toString());
});

// ─── POST /api/twilio/voice-status — call status webhook (Phase 2 stub) ─────
router.post('/voice-status', async (req, res) => {
  if (!validateTwilioSignature(req)) return res.status(403).send('Invalid signature');
  // Phase 2 will persist call state + duration here.
  res.status(200).send('OK');
});

module.exports = router;
