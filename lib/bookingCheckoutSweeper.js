// P12 Wave 1 — booking Checkout reconciler. The direct-key payment flow is
// booking-FIRST + verify-on-return; this sweeper is the belt-and-braces that
// closes the gap when a customer pays but never lands back on the success_url
// (mobile app-switch, closed tab). Every ~5 min it looks at held bookings
// (status='pending_payment') and, using the BUSINESS's own Stripe key, asks
// Stripe the authoritative outcome:
//   · session paid            → finalize the booking (confirm + emails, once)
//   · session expired/unpaid  → cancel the booking (releases the held slot)
//   · session still open      → leave it
// For one-time payments this fully replaces per-tenant webhooks.
// Single-var supabase require per server convention.
const supabase = require('../config/supabase');
const { getStripeForSite } = require('./paymentCredentials');
const { finalizeBookingPayment, finalizeGroupPayment } = require('../controllers/bookingController');

const BATCH = 100;              // cap work per sweep
const STALE_GRACE_MS = 60_000;  // past checkout_expires_at by this → safe to cancel even if Stripe is unreachable

// Cancel a held booking; for basket children (Task #21), cancel ALL siblings on
// the same session in one shot and flip the group. Single bookings pass no group.
async function cancelHold(b) {
  if (b.stripe_checkout_session_id) {
    await supabase.from('site_bookings').update({ status: 'canceled', payment_status: 'failed' })
      .eq('stripe_checkout_session_id', b.stripe_checkout_session_id).eq('status', 'pending_payment');
  } else {
    await supabase.from('site_bookings').update({ status: 'canceled', payment_status: 'failed' })
      .eq('id', b.id).eq('status', 'pending_payment');
  }
  if (b.group_id) {
    // Flip the group only when no live children remain (a stranded child without
    // a session id shouldn't kill siblings mid-checkout).
    const { count } = await supabase.from('site_bookings')
      .select('id', { count: 'exact', head: true })
      .eq('group_id', b.group_id).neq('status', 'canceled');
    if (!count) await supabase.from('site_booking_groups').update({ status: 'canceled' }).eq('id', b.group_id);
  }
}

async function sweepOnce() {
  const { data: held, error } = await supabase
    .from('site_bookings')
    .select('id, site_id, group_id, stripe_checkout_session_id, checkout_expires_at')
    .eq('status', 'pending_payment')
    .order('checkout_expires_at', { ascending: true })
    .limit(BATCH);
  if (error || !held?.length) return;

  let finalized = 0, canceled = 0;
  const now = Date.now();
  const handledSessions = new Set(); // basket children share a session — do it once

  for (const b of held) {
    try {
      if (b.stripe_checkout_session_id && handledSessions.has(b.stripe_checkout_session_id)) continue;

      // A pending booking with no session id past its (missing) window is a
      // stranded hold — cancel to be safe.
      if (!b.stripe_checkout_session_id) {
        if (!b.checkout_expires_at || now > new Date(b.checkout_expires_at).getTime() + STALE_GRACE_MS) {
          await cancelHold(b);
          canceled++;
        }
        continue;
      }

      const tenantStripe = await getStripeForSite(b.site_id);
      if (!tenantStripe) continue; // creds gone/rotated — leave for a human, don't cancel a possibly-paid booking

      let session;
      try {
        session = await tenantStripe.checkout.sessions.retrieve(b.stripe_checkout_session_id);
      } catch {
        // Stripe unreachable for this one. Only cancel if well past expiry (never
        // strand a slot forever), else leave for the next sweep.
        if (b.checkout_expires_at && now > new Date(b.checkout_expires_at).getTime() + STALE_GRACE_MS) {
          await cancelHold(b);
          handledSessions.add(b.stripe_checkout_session_id);
          canceled++;
        }
        continue;
      }

      if (session?.payment_status === 'paid') {
        const piId = typeof session.payment_intent === 'string' ? session.payment_intent : (session.payment_intent?.id ?? null);
        const r = b.group_id
          ? await finalizeGroupPayment({ sessionId: b.stripe_checkout_session_id, paymentIntentId: piId })
          : await finalizeBookingPayment({ bookingId: b.id, amountCents: session.amount_total ?? null, paymentIntentId: piId });
        if (r.ok && !r.idempotent) finalized++;
        handledSessions.add(b.stripe_checkout_session_id);
      } else if (session?.status === 'expired') {
        await cancelHold(b);
        handledSessions.add(b.stripe_checkout_session_id);
        canceled++;
      }
      // else: session still 'open' and unpaid → leave it
    } catch (e) {
      console.error('[booking-checkout-sweep] error on booking', b.id, '-', e.message);
    }
  }

  if (finalized || canceled) {
    console.log(`[booking-checkout-sweep] finalized ${finalized} paid, canceled ${canceled} abandoned`);
  }
}

function startBookingCheckoutSweeper({ intervalMs = 5 * 60 * 1000 } = {}) {
  sweepOnce().catch(() => {}); // run once at boot
  const t = setInterval(() => sweepOnce().catch(() => {}), intervalMs);
  console.log(`✓ Booking checkout reconciler running every ${Math.round(intervalMs / 60000)}m`);
  return t;
}

module.exports = { sweepOnce, startBookingCheckoutSweeper };
