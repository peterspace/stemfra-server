// Porkbun prepaid-balance guard (2026-08-10, Peter's ask): domain purchases
// draw from the prepaid balance, so when it runs low we (a) alert staff and
// (b) pause the owner-facing "Register" in the CMS until it is topped up —
// never take an invoice we cannot fulfill.
//
// Balance comes from lib/registrar/porkbun getBalanceCents() (a native dryRun
// probe — no charge), cached here for 10 minutes. The low alert emails
// NOTIFY_EMAIL at most once per day.
const registrar = require('./registrar');
const { sendMail } = require('./mailer');

const MIN_BALANCE_CENTS = Number(process.env.DOMAIN_MIN_BALANCE_CENTS || 3000); // $30 default
const CACHE_MS = 10 * 60 * 1000;
const ALERT_EVERY_MS = 24 * 60 * 60 * 1000;

let cache = { cents: null, at: 0 };
let lastAlertAt = 0;

async function getBalanceCents({ force = false } = {}) {
  const reg = registrar.active();
  if (!reg.getBalanceCents) return null; // registrar without balance support
  if (!force && cache.cents != null && Date.now() - cache.at < CACHE_MS) return cache.cents;
  const cents = await reg.getBalanceCents();
  cache = { cents, at: Date.now() };
  maybeAlertLow(cents);
  return cents;
}

function maybeAlertLow(cents) {
  if (cents == null || cents >= MIN_BALANCE_CENTS) return;
  if (Date.now() - lastAlertAt < ALERT_EVERY_MS) return;
  lastAlertAt = Date.now();
  const to = process.env.NOTIFY_EMAIL || process.env.GMAIL_USER;
  if (!to) return;
  sendMail({
    fromName: 'Stemfra Ops',
    to,
    subject: `Porkbun balance low: $${(cents / 100).toFixed(2)} (threshold $${(MIN_BALANCE_CENTS / 100).toFixed(2)})`,
    text: [
      `The Porkbun prepaid balance is $${(cents / 100).toFixed(2)}, below the $${(MIN_BALANCE_CENTS / 100).toFixed(2)} threshold.`,
      'Owner-facing domain purchases in the CMS are PAUSED until the balance is topped up.',
      'Top up at https://porkbun.com/account/ then re-check on the CRM Domains page.',
    ].join('\n'),
  }).catch(() => { /* alert is best-effort */ });
}

/** True when owner-facing purchases should be paused. Fail-open on probe
 *  errors (a Porkbun hiccup should not block the whole feature). */
async function purchasesSuspended() {
  try {
    const cents = await getBalanceCents();
    return cents != null && cents < MIN_BALANCE_CENTS;
  } catch {
    return false;
  }
}

module.exports = { getBalanceCents, purchasesSuspended, MIN_BALANCE_CENTS };
