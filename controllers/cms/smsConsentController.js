// ─── Owner SMS consent (A2P 10DLC) ──────────────────────────────────────────
//
// Consent is recorded HERE, not by the browser writing to the prefs table, for
// two reasons that are both load-bearing for carrier review:
//
//   1. A consent record a client can author is not evidence. If we are ever
//      asked to prove a given number opted in, the record has to come from a
//      trusted path with a server timestamp.
//   2. The opt-in confirmation SMS can only be sent server-side, and TCR
//      expects that confirmation to actually fire — see
//      docs/A2P_REGISTRATION.md. Recording consent and sending the
//      confirmation belong in one place so they cannot drift apart.
//
// ⚠ SMS_CONSENT_TEXT here must stay character-for-character identical to the
// copy in stemfra_cms/src/lib/notifications.ts and the public proof page at
// stemfra.com/sms-consent. Change one, change all three, bump the version, and
// resubmit the campaign.

const { parsePhoneNumber } = require('libphonenumber-js');
const supabase = require('../../config/supabase');
const { twilioClient, twilioFrom, publicBaseUrl } = require('../../config/twilio');

const SMS_CONSENT_VERSION = 'v2';
const SMS_CONSENT_TEXT =
  'Text me Stemfra account alerts: new leads, new bookings, missed calls, and billing notices. '
  + 'Message frequency varies with your business activity. '
  + 'Message and data rates may apply. Reply STOP to opt out, HELP for help.';

// The confirmation sent immediately after a web opt-in. Carriers look for the
// brand name, what was subscribed to, frequency, rates, and both keywords.
const OPT_IN_MESSAGE =
  'Stemfra: You are now subscribed to Stemfra account alerts (new leads, bookings, '
  + 'missed calls, billing). Msg frequency varies. '
  + 'Msg & data rates may apply. Reply HELP for help, STOP to cancel.';

const readPrefs = async (userId) => {
  const { data } = await supabase
    .from('cms_notification_prefs').select('prefs').eq('auth_user_id', userId).maybeSingle();
  return data?.prefs || {};
};

const writePrefs = async (userId, prefs) => {
  const { error } = await supabase
    .from('cms_notification_prefs')
    .upsert({ auth_user_id: userId, prefs, updated_at: new Date().toISOString() });
  if (error) throw new Error(error.message);
};

/** POST /api/cms/sms-consent  { phone } — record consent + send confirmation. */
async function optIn(req, res) {
  const userId = req.cmsUser?.id;
  const raw = String(req.body?.phone || '').trim();
  if (!raw) return res.status(400).json({ error: 'A mobile number is required.' });

  let e164;
  try {
    const parsed = parsePhoneNumber(raw, 'US');
    if (!parsed || !parsed.isValid()) throw new Error('invalid');
    e164 = parsed.format('E.164');
  } catch {
    return res.status(400).json({ error: 'That does not look like a valid mobile number.' });
  }

  const prefs = await readPrefs(userId);
  const consent = {
    opted_in: true,
    phone: e164,
    // Stored VERBATIM so we can show what THIS account agreed to, rather than
    // whatever the current build happens to say.
    consent_text: SMS_CONSENT_TEXT,
    consent_version: SMS_CONSENT_VERSION,
    consented_at: new Date().toISOString(),
    consented_ip: req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip || null,
    opted_out_at: null,
  };

  try {
    await writePrefs(userId, { ...prefs, sms: consent });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }

  // Best-effort: consent is already recorded, so a Twilio outage must not lose
  // it or make the owner think the opt-in failed. Reported back so the UI can
  // say the confirmation is on its way only when it actually is.
  let confirmationSent = false;
  try {
    await twilioClient.messages.create({
      to: e164,
      from: twilioFrom,
      body: OPT_IN_MESSAGE,
      statusCallback: `${publicBaseUrl}/api/twilio/sms-status`,
    });
    confirmationSent = true;
  } catch (e) {
    console.error('[sms-consent] confirmation send failed:', e.message);
  }

  res.json({ ok: true, phone: e164, confirmationSent, consent });
}

/** DELETE /api/cms/sms-consent — opt out, keeping the original consent record. */
async function optOut(req, res) {
  const userId = req.cmsUser?.id;
  const prefs = await readPrefs(userId);
  if (!prefs.sms) return res.json({ ok: true });

  try {
    // An opt-out is a new fact ABOUT the consent, not a reason to forget it.
    await writePrefs(userId, {
      ...prefs,
      sms: { ...prefs.sms, opted_in: false, opted_out_at: new Date().toISOString() },
    });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
  res.json({ ok: true });
}

module.exports = { optIn, optOut, SMS_CONSENT_TEXT, SMS_CONSENT_VERSION, OPT_IN_MESSAGE };
