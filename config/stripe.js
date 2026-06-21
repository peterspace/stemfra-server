// Stripe platform client (Connect). Single-var export to match the supabase
// convention here. Payments are optional infra, so unlike config/supabase.js we
// DON'T exit the process when unconfigured — handlers guard on a null client and
// return 503, so the rest of the server runs fine without Stripe keys.
const Stripe = require('stripe');

const secretKey = process.env.STRIPE_SECRET_KEY;

if (!secretKey) {
  console.warn('⚠ STRIPE_SECRET_KEY not set — /api/cms/payments and /api/site-payments will return 503 until configured.');
}

// Platform commission on each charge, in basis points (150 = 1.5%). Configurable.
const APPLICATION_FEE_BPS = parseInt(process.env.STRIPE_APPLICATION_FEE_BPS || '0', 10) || 0;

// On a DESTINATION charge the PLATFORM pays Stripe's processing fee, so the
// application fee must also cover it for our margin to net positive. These
// estimate Stripe's US card fee (2.9% + 30¢); exact for US cards, slightly under
// for international (refine or use direct charges later). Configurable.
const PROCESSING_PCT_BPS = parseInt(process.env.STRIPE_PROCESSING_PCT_BPS || '290', 10) || 290;
const PROCESSING_FIXED_CENTS = parseInt(process.env.STRIPE_PROCESSING_FIXED_CENTS || '30', 10) || 30;

// System B native memberships (Connect destination subscriptions): the platform
// keeps this PERCENT of each invoice as the application fee. It must exceed
// Stripe's effective rate (~2.9% + 30¢ amortized) for our cut to net positive;
// e.g. on a $99/mo plan, 4.5% nets ~1.3% after Stripe's ~3.2%. Configurable.
const SUBSCRIPTION_APP_FEE_PCT = parseFloat(process.env.STRIPE_SUBSCRIPTION_APP_FEE_PCT || '4.5') || 4.5;

const stripe = secretKey ? new Stripe(secretKey) : null;

module.exports = { stripe, APPLICATION_FEE_BPS, PROCESSING_PCT_BPS, PROCESSING_FIXED_CENTS, SUBSCRIPTION_APP_FEE_PCT };
