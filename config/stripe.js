// Stripe platform client (Connect). Single-var export to match the supabase
// convention here. Payments are optional infra, so unlike config/supabase.js we
// DON'T exit the process when unconfigured — handlers guard on a null client and
// return 503, so the rest of the server runs fine without Stripe keys.
const Stripe = require('stripe');

const secretKey = process.env.STRIPE_SECRET_KEY;

if (!secretKey) {
  console.warn('⚠ STRIPE_SECRET_KEY not set — /api/cms/payments and /api/site-payments will return 503 until configured.');
}

// Read a numeric env var with an explicit default. NOTE: a bare `Number(x) || d`
// makes 0 unrepresentable (0 is falsy → falls back to d); use Number.isFinite so a
// deliberate `=0` sticks — load-bearing now that the fee defaults are 0.
const numEnv = (v, dflt) => { const n = Number(v); return Number.isFinite(n) ? n : dflt; };

// P14 pay-at-venue kill-switch: online card payments for TENANT SITES (booking +
// membership checkout) are suspended platform-wide unless this is exactly 'true'.
// Default OFF. The gate lives at every public charge core (sitePaymentsController,
// siteMembershipsController, Front Desk resolveCardRail) so booking falls through
// to pay-at-venue regardless of a site's own payments_enabled. Scope = TENANT
// payments only; Stemfra's OWN platform billing (lib/platformBilling.js) is EXEMPT
// and must never consult this flag.
const ONLINE_PAYMENTS_ENABLED = process.env.ONLINE_PAYMENTS_ENABLED === 'true';

// In-band fee DEFAULTS are 0 (COMMISSION_MODEL §2b: Stemfra takes commission via a
// monthly invoice, never a per-charge fee). Zeroed so that if the dormant Connect
// destination-charge paths ever re-awaken they cannot silently add a fee on top of
// the invoice commission (double-charge). Overridable by env for a deliberate future
// model, but off by default. Basis points (150 = 1.5%).
const APPLICATION_FEE_BPS = numEnv(process.env.STRIPE_APPLICATION_FEE_BPS, 0);

// On a DESTINATION charge the PLATFORM pays Stripe's processing fee, so the app fee
// must cover it for the platform to net non-negative. These estimate Stripe's US
// card fee (2.9% + 30¢). Cost-recovery, not commission — only used by the dormant
// destination-charge path (the live pivot uses the tenant's OWN key, no app fee).
const PROCESSING_PCT_BPS = numEnv(process.env.STRIPE_PROCESSING_PCT_BPS, 290);
const PROCESSING_FIXED_CENTS = numEnv(process.env.STRIPE_PROCESSING_FIXED_CENTS, 30);

// System B native memberships (Connect destination subscriptions): application-fee
// PERCENT of each invoice. Default 0 per §2b (commission via invoice, not a fee) —
// the dormant membership Connect checkout can't skim on re-awakening.
const SUBSCRIPTION_APP_FEE_PCT = numEnv(process.env.STRIPE_SUBSCRIPTION_APP_FEE_PCT, 0);

const stripe = secretKey ? new Stripe(secretKey) : null;

module.exports = { stripe, ONLINE_PAYMENTS_ENABLED, APPLICATION_FEE_BPS, PROCESSING_PCT_BPS, PROCESSING_FIXED_CENTS, SUBSCRIPTION_APP_FEE_PCT };
