// P12 Wave-2 Task 9 — owner SMS alerts. The A2P 10DLC campaign was approved
// 2026-08-03, so our number may now send application SMS. ONE program: short
// transactional alerts to the site OWNER for the events that already email them
// (new booking, cancellation, reschedule, website lead, chat lead, membership
// signup, chat escalation).
//
// Gating, two layers:
//   1. CHANNEL — the owner's SMS consent record at
//      cms_notification_prefs.prefs.sms (written by the CMS SmsAlertsCard
//      opt-in, keyed by auth_user_id). No consent, no SMS, ever.
//   2. EVENT — callers invoke this inside the SAME resolveNotifyPrefs branch
//      they already use for the owner email, so one set of per-event prefs
//      governs both channels.
// Kill switch: OWNER_SMS_ALERTS_ENABLED=false disables all sends.
// Best-effort: sendOwnerSms never throws; failures are logged. Callers may
// fire-and-forget. Single-var supabase require per the server convention.
const supabase = require('../config/supabase');
const { twilioClient, twilioFrom, publicBaseUrl } = require('../config/twilio');

const ENABLED = process.env.OWNER_SMS_ALERTS_ENABLED !== 'false';

// The owner's consent record, or null when absent/opted out.
async function getSmsConsent(authUserId) {
  if (!authUserId) return null;
  try {
    const { data } = await supabase
      .from('cms_notification_prefs')
      .select('prefs')
      .eq('auth_user_id', authUserId)
      .maybeSingle();
    const sms = data?.prefs?.sms;
    return sms && sms.opted_in === true && sms.phone ? sms : null;
  } catch (e) {
    console.error('[ownerSms] consent read failed:', e.message);
    return null;
  }
}

/**
 * Send one short transactional alert to the owner. Returns true only when a
 * send was actually queued with Twilio. Keep bodies short and factual; the
 * 320-char cap holds a message to roughly two SMS segments.
 */
async function sendOwnerSms(authUserId, body) {
  if (!ENABLED || !twilioClient || !twilioFrom || !body) return false;
  try {
    const consent = await getSmsConsent(authUserId);
    if (!consent) return false;
    await twilioClient.messages.create({
      to: consent.phone,
      from: twilioFrom,
      body: String(body).slice(0, 320),
      statusCallback: `${publicBaseUrl}/api/twilio/sms-status`,
    });
    return true;
  } catch (e) {
    console.error('[ownerSms] send failed:', e.message);
    return false;
  }
}

// Inbound STOP bookkeeping: flip the consent record for whoever registered
// this phone. Twilio already blocks further sends carrier-side after a STOP;
// this keeps the CMS SmsAlertsCard state honest. Re-opting in requires the
// card again (a START reply alone does not re-enable alerts).
async function recordSmsOptOutByPhone(e164) {
  if (!e164) return 0;
  try {
    const { data: rows } = await supabase
      .from('cms_notification_prefs')
      .select('auth_user_id, prefs')
      .filter('prefs->sms->>phone', 'eq', e164)
      .filter('prefs->sms->>opted_in', 'eq', 'true');
    let flipped = 0;
    for (const row of rows || []) {
      const prefs = { ...(row.prefs || {}) };
      prefs.sms = {
        ...(prefs.sms || {}),
        opted_in: false,
        opted_out_at: new Date().toISOString(),
        opt_out_via: 'sms_stop',
      };
      const { error } = await supabase
        .from('cms_notification_prefs')
        .update({ prefs, updated_at: new Date().toISOString() })
        .eq('auth_user_id', row.auth_user_id);
      if (!error) flipped++;
    }
    if (flipped) console.log(`[ownerSms] STOP from ${e164}: flipped ${flipped} consent record(s)`);
    return flipped;
  } catch (e) {
    console.error('[ownerSms] STOP bookkeeping failed:', e.message);
    return 0;
  }
}

module.exports = { sendOwnerSms, getSmsConsent, recordSmsOptOutByPhone };
