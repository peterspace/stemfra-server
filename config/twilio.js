// ─── Twilio configuration + startup validation ──────────────────────────────
//
// Validates Twilio environment variables at module-load time and exports a
// pre-configured Twilio REST client plus phase-awareness helpers.
//
// Two tiers:
//
//   Phase 1 (REQUIRED — server fails fast if missing):
//     TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER
//     These are needed for outbound SMS, status webhooks, and webhook
//     signature validation. Without them the SMS module can't function.
//
//   Phase 2 (OPTIONAL — warns and continues if missing):
//     TWILIO_API_KEY_SID, TWILIO_API_KEY_SECRET, TWILIO_TWIML_APP_SID
//     These gate the Voice SDK token endpoint only. The /api/twilio/token
//     route checks isVoiceConfigured() and returns 503 instead of crashing.

const twilio = require('twilio');

const REQUIRED_VARS = [
  'TWILIO_ACCOUNT_SID',
  'TWILIO_AUTH_TOKEN',
  'TWILIO_PHONE_NUMBER',
];

const PHASE_2_VARS = [
  'TWILIO_API_KEY_SID',
  'TWILIO_API_KEY_SECRET',
  'TWILIO_TWIML_APP_SID',
];

// ─── Required (Phase 1) — fail fast ──────────────────────────────────────────
const missingRequired = REQUIRED_VARS.filter(v => !process.env[v]);
if (missingRequired.length > 0) {
  console.error(
    `✗ Twilio is not configured. Missing required environment variable(s): ${missingRequired.join(', ')}.\n` +
    `   These are required for SMS to function. Set them in .env (local) or in\n` +
    `   .github/workflows/deploy.yml → environment-variables (production) and redeploy.`
  );
  process.exit(1);
}

// ─── Phase 2 — warn and continue ─────────────────────────────────────────────
const missingPhase2 = PHASE_2_VARS.filter(v => !process.env[v]);
if (missingPhase2.length > 0) {
  console.warn(
    `⚠ Twilio Voice SDK not configured (Phase 2). Missing: ${missingPhase2.join(', ')}.\n` +
    `   /api/twilio/token will return 503 until these are set. SMS still works.`
  );
}

const accountSid    = process.env.TWILIO_ACCOUNT_SID;
const authToken     = process.env.TWILIO_AUTH_TOKEN;
const apiKeySid     = process.env.TWILIO_API_KEY_SID    || null;
const apiKeySecret  = process.env.TWILIO_API_KEY_SECRET || null;
const twilioFrom    = process.env.TWILIO_PHONE_NUMBER;
const twimlAppSid   = process.env.TWILIO_TWIML_APP_SID  || null;
const publicBaseUrl = process.env.PUBLIC_BASE_URL || 'https://api.stemfra.com';

const twilioClient = twilio(accountSid, authToken);

/** True only when all Phase 2 vars are set — i.e. /token can mint Voice tokens. */
function isVoiceConfigured() {
  return Boolean(apiKeySid && apiKeySecret && twimlAppSid);
}

module.exports = {
  twilioClient,
  twilio,        // re-exported so routes can use twilio.jwt, twilio.twiml, etc.
  accountSid,
  authToken,
  apiKeySid,
  apiKeySecret,
  twilioFrom,
  twimlAppSid,
  publicBaseUrl,
  isVoiceConfigured,
};
