// Public payment endpoints called by the template sites. Single-var supabase
// require per server convention.
//
// P12 (direct-key payments): the CURRENT path is hosted Stripe Checkout on the
// business's OWN Stripe account (getStripeForSite) — booking-FIRST: we write a
// held booking, send the customer to Checkout, then verify server-side on return
// (+ a reconciler sweeper for closed tabs). The legacy Connect destination-charge
// path (config/createIntent + createBookingIntent) is kept dormant, not deleted.
const supabase = require('../config/supabase');
const { stripe, ONLINE_PAYMENTS_ENABLED, APPLICATION_FEE_BPS, PROCESSING_PCT_BPS, PROCESSING_FIXED_CENTS } = require('../config/stripe');
const { getStripeForSite, getSiteCredentials } = require('../lib/paymentCredentials');

const CHECKOUT_TTL_SECONDS = 30 * 60; // Stripe minimum for expires_at

// The business's public origin (for redirects back after Checkout). Derived
// SERVER-SIDE from the site record — never from client input — so a forged
// origin can't turn success_url into an open-redirect / phishing hop.
function siteOrigin(site) {
  return `https://${site.custom_domain || `${site.subdomain}.stemfra.com`}`;
}

/** GET /api/site-payments/config — public publishable key for Stripe.js on the client.
 *  `enabled` reflects the P14 platform-wide online-payments kill-switch. */
function config(_req, res) {
  res.json({ publishableKey: process.env.STRIPE_PUBLISHABLE_KEY || null, enabled: ONLINE_PAYMENTS_ENABLED });
}

/**
 * Core: create a destination-charge PaymentIntent for a service price (no HTTP).
 * Returns { ok:true, free:true } for $0 services, { ok:true, clientSecret,
 * paymentIntentId, amount, currency, applicationFee } for paid ones, or
 * { ok:false, code, message, notReady } when the site can't take payments yet.
 * Shared by the public POST handler and the Front Desk in-chat payment flow.
 */
async function createBookingIntent({ siteId, serviceId, customerEmail, productId }) {
  // P14: online card payments suspended platform-wide → no in-chat / inline charge.
  if (!ONLINE_PAYMENTS_ENABLED) return { ok: false, code: 400, message: 'Online payments are currently unavailable.', notReady: true };
  if (!stripe) return { ok: false, code: 503, message: 'Payments are not configured.', notReady: true };
  if (!siteId || !serviceId) return { ok: false, code: 400, message: 'Missing siteId or serviceId.' };

  const { data: site } = await supabase
    .from('sites').select('id, status, payments_enabled').eq('id', siteId).single();
  if (!site || !['live', 'previewing'].includes(site.status)) return { ok: false, code: 404, message: 'Site not available.' };
  if (!site.payments_enabled) return { ok: false, code: 400, message: 'Payments are not enabled for this site.', notReady: true };

  const { data: acct } = await supabase
    .from('site_payment_accounts').select('stripe_account_id, charges_enabled').eq('site_id', siteId).single();
  if (!acct?.stripe_account_id || !acct.charges_enabled) {
    return { ok: false, code: 400, message: 'This business is not ready to take payments yet.', notReady: true };
  }

  const { data: svc } = await supabase
    .from('site_services').select('id, name, price_cents, currency').eq('id', serviceId).eq('site_id', siteId).single();
  if (!svc) return { ok: false, code: 404, message: 'Service not found.' };

  // Optional: charge a PRODUCT (e.g. a class pass) instead of the service's own
  // price. The price is always re-read from the DB for the caller's own site, so
  // no caller can inject an arbitrary amount. Server-side callers only —
  // createIntent (the public wrapper) must never forward this.
  let product = null;
  if (productId) {
    const { data } = await supabase
      .from('site_products').select('id, name, price_cents, currency, is_active')
      .eq('id', productId).eq('site_id', siteId).single();
    if (!data || !data.is_active) return { ok: false, code: 404, message: 'Product not found.' };
    product = data;
  }

  const amount = (product ? product.price_cents : svc.price_cents) || 0;
  if (amount <= 0) return { ok: true, free: true };

  const currency = ((product ? product.currency : svc.currency) || 'usd').toLowerCase();
  const margin = Math.round((amount * APPLICATION_FEE_BPS) / 10000);
  const processingEstimate = Math.round((amount * PROCESSING_PCT_BPS) / 10000) + PROCESSING_FIXED_CENTS;
  const fee = margin + processingEstimate;

  const intent = await stripe.paymentIntents.create({
    amount,
    currency,
    automatic_payment_methods: { enabled: true },
    // N1: Stripe emails the customer a receipt on success (LIVE mode only —
    // test mode never sends, so this stays dormant until Stripe verification
    // completes; no extra gate needed).
    ...(customerEmail ? { receipt_email: customerEmail } : {}),
    ...(fee > 0 ? { application_fee_amount: fee } : {}),
    transfer_data: { destination: acct.stripe_account_id },
    on_behalf_of: acct.stripe_account_id,
    metadata: { site_id: siteId, service_id: serviceId, ...(product ? { product_id: product.id } : {}) },
  });

  return { ok: true, clientSecret: intent.client_secret, paymentIntentId: intent.id, amount, currency, applicationFee: fee, platformMargin: margin };
}

/**
 * POST /api/site-payments/intent  { siteId, serviceId } — public, thin wrapper.
 * Free ($0) services return { free: true } so the client skips payment.
 */
async function createIntent(req, res) {
  try {
    const r = await createBookingIntent({ siteId: req.body?.siteId, serviceId: req.body?.serviceId, customerEmail: req.body?.customerEmail });
    if (!r.ok) return res.status(r.code).json({ success: false, message: r.message });
    if (r.free) return res.json({ success: true, free: true });
    res.json({ success: true, clientSecret: r.clientSecret, paymentIntentId: r.paymentIntentId, amount: r.amount, currency: r.currency, applicationFee: r.applicationFee, platformMargin: r.platformMargin });
  } catch (err) {
    console.error('[sitePayments.createIntent]', err.message);
    res.status(500).json({ success: false, message: 'Could not start payment.' });
  }
}

// ─── P12 direct-key hosted Checkout (booking-FIRST) ──────────────────────────

/**
 * Core: start a hosted-Checkout booking on the business's OWN Stripe account.
 * Booking-first: writes a HELD (pending_payment) booking, then a Checkout Session,
 * then returns the Checkout URL. Free ($0) services skip payment and book directly.
 * Returns { ok:true, free:true, booking } | { ok:true, url, sessionId, bookingId }
 * | { ok:false, code, message, notReady }.
 */
async function createBookingCheckout({ siteId, teamMemberId, serviceId, date, time, customer, notes, paymentChoice }) {
  if (!siteId || !serviceId || !teamMemberId || !date || !time || !customer) {
    return { ok: false, code: 400, message: 'Missing required fields.' };
  }

  const { data: site } = await supabase
    .from('sites').select('id, status, subdomain, custom_domain, payments_enabled, payment_collection').eq('id', siteId).single();
  if (!site || !['live', 'previewing'].includes(site.status)) return { ok: false, code: 404, message: 'Site not available.' };

  const { data: svc } = await supabase
    .from('site_services').select('id, name, price_cents, currency').eq('id', serviceId).eq('site_id', siteId).single();
  if (!svc) return { ok: false, code: 404, message: 'Service not found.' };
  const amount = svc.price_cents || 0;

  // Lazy require avoids any load-order coupling with bookingController.
  const { placeBooking } = require('./bookingController');

  // FREE service → no payment; book straight to confirmed via the normal path.
  if (amount <= 0) {
    const r = await placeBooking({ siteId, teamMemberId, serviceId, date, time, customer, notes, allowedStatuses: ['live', 'previewing'] });
    if (!r.ok) return r;
    return { ok: true, free: true, booking: r.booking };
  }

  // Resolve the effective collection mode (Task #20). The server is authoritative:
  // it never trusts paymentChoice alone. Online is only possible with a connected
  // Stripe key AND the P14 kill-switch on; otherwise every priced booking falls
  // back to pay-at-visit (the switch overrides a site's own payments_enabled).
  const tenantStripe = (ONLINE_PAYMENTS_ENABLED && site.payments_enabled ? await getStripeForSite(siteId) : null);
  const canOnline = !!tenantStripe;
  const mode = ['online', 'onsite', 'both'].includes(site.payment_collection) ? site.payment_collection : 'both';
  // What the customer actually gets to do:
  //   onsite-only, OR both+chose-onsite, OR online impossible → pay in person.
  const payInPerson = !canOnline || mode === 'onsite' || (mode === 'both' && paymentChoice === 'onsite');

  if (payInPerson) {
    // Priced booking settled at the visit — confirmed now, amount recorded as owed.
    const r = await placeBooking({ siteId, teamMemberId, serviceId, date, time, customer, notes, collectInPerson: true, allowedStatuses: ['live', 'previewing'] });
    if (!r.ok) return r;
    return { ok: true, payInPerson: true, booking: r.booking };
  }

  // ONLINE → require the business's own Stripe (direct keys). Fail fast BEFORE
  // holding a slot if they haven't connected payments yet.
  if (!site.payments_enabled || !tenantStripe) return { ok: false, code: 400, message: 'This business is not ready to take payments yet.', notReady: true };

  // Hold the slot (pending_payment) — no emails, no charge yet.
  const held = await placeBooking({ siteId, teamMemberId, serviceId, date, time, customer, notes, pending: true, allowedStatuses: ['live', 'previewing'] });
  if (!held.ok) return held;

  const origin = siteOrigin(site);
  const base = (process.env.PUBLIC_BASE_URL || '').replace(/\/+$/, '');
  try {
    const session = await tenantStripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      line_items: [{
        quantity: 1,
        price_data: { currency: held.currency, unit_amount: amount, product_data: { name: held.serviceName } },
      }],
      ...(customer.email ? { customer_email: customer.email } : {}),
      // Return to a SERVER endpoint that verifies + redirects — verification
      // never depends on the client. {CHECKOUT_SESSION_ID} is filled by Stripe.
      success_url: `${base}/api/site-payments/checkout/return?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/book?checkout=canceled`,
      expires_at: Math.floor(Date.now() / 1000) + CHECKOUT_TTL_SECONDS,
      metadata: { site_id: siteId, booking_id: held.bookingId },
    });

    await supabase.from('site_bookings')
      .update({ stripe_checkout_session_id: session.id, checkout_expires_at: new Date(session.expires_at * 1000).toISOString() })
      .eq('id', held.bookingId);

    return { ok: true, url: session.url, sessionId: session.id, bookingId: held.bookingId };
  } catch (err) {
    // Session creation failed → release the held slot so it isn't stuck.
    await supabase.from('site_bookings').update({ status: 'canceled', payment_status: 'failed' }).eq('id', held.bookingId);
    console.error('[sitePayments.createBookingCheckout] session create failed:', err.message);
    return { ok: false, code: 502, message: 'Could not start checkout. Please try again.' };
  }
}

/**
 * Task #21 — Core: start a hosted-Checkout MULTI-SERVICE basket (salon visit /
 * spa package) on the business's OWN Stripe. Same shape as createBookingCheckout
 * but group-first: hold ALL children (all-or-nothing — never charge a partial
 * basket), one Checkout Session with a line item per service. Free baskets and
 * pay-at-visit baskets book directly via placeBookingGroup.
 * Returns { ok:true, free|payInPerson:true, group, booked, failed }
 * | { ok:true, url, sessionId, groupId } | { ok:false, code, message, failed?, notReady? }.
 */
async function createGroupCheckout({ siteId, items, customer, notes, paymentChoice }) {
  if (!siteId || !customer || !Array.isArray(items) || items.length === 0) {
    return { ok: false, code: 400, message: 'Missing required fields.' };
  }

  const { data: site } = await supabase
    .from('sites').select('id, status, subdomain, custom_domain, payments_enabled, payment_collection').eq('id', siteId).single();
  if (!site || !['live', 'previewing'].includes(site.status)) return { ok: false, code: 404, message: 'Site not available.' };

  // Basket total, priced server-side (never trust client amounts).
  const ids = [...new Set(items.map(i => i.serviceId).filter(Boolean))];
  const { data: svcs } = await supabase
    .from('site_services').select('id, price_cents').eq('site_id', siteId).in('id', ids);
  if (!svcs || svcs.length !== ids.length) return { ok: false, code: 404, message: 'Service not found.' };
  const priceById = Object.fromEntries(svcs.map(s => [s.id, s.price_cents || 0]));
  const total = items.reduce((sum, i) => sum + (priceById[i.serviceId] || 0), 0);

  const { placeBookingGroup } = require('./bookingController');

  // FREE basket → classic confirmed path (previewing allowed, like single-service).
  if (total <= 0) {
    const r = await placeBookingGroup({ siteId, customer, notes, items, allowedStatuses: ['live', 'previewing'] });
    if (!r.ok) return r;
    return { ok: true, free: true, group: r.group, booked: r.booked, failed: r.failed };
  }

  // Resolve the effective collection mode (Task #20 semantics — server-authoritative).
  // P14 kill-switch overrides the site's own payments_enabled (see single-service core).
  const tenantStripe = (ONLINE_PAYMENTS_ENABLED && site.payments_enabled ? await getStripeForSite(siteId) : null);
  const canOnline = !!tenantStripe;
  const mode = ['online', 'onsite', 'both'].includes(site.payment_collection) ? site.payment_collection : 'both';
  const payInPerson = !canOnline || mode === 'onsite' || (mode === 'both' && paymentChoice === 'onsite');

  if (payInPerson) {
    const r = await placeBookingGroup({ siteId, customer, notes, items, collectInPerson: true, allowedStatuses: ['live', 'previewing'] });
    if (!r.ok) return r;
    return { ok: true, payInPerson: true, group: r.group, booked: r.booked, failed: r.failed };
  }

  // ONLINE → hold the whole basket (all-or-nothing), then one Checkout Session.
  const held = await placeBookingGroup({ siteId, customer, notes, items, pending: true, allowedStatuses: ['live', 'previewing'] });
  if (!held.ok) return held;

  const origin = siteOrigin(site);
  const base = (process.env.PUBLIC_BASE_URL || '').replace(/\/+$/, '');
  try {
    const session = await tenantStripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      line_items: held.booked.map(b => ({
        quantity: 1,
        price_data: {
          currency: held.currency,
          unit_amount: b.priceCents,
          product_data: { name: b.serviceName?.en || 'Service' },
        },
      })),
      ...(customer.email ? { customer_email: customer.email } : {}),
      success_url: `${base}/api/site-payments/checkout/return?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/book?checkout=canceled`,
      expires_at: Math.floor(Date.now() / 1000) + CHECKOUT_TTL_SECONDS,
      metadata: { site_id: siteId, group_id: held.groupId },
    });

    // Stamp the session on EVERY child — the sweeper + verify work per booking row.
    await supabase.from('site_bookings')
      .update({ stripe_checkout_session_id: session.id, checkout_expires_at: new Date(session.expires_at * 1000).toISOString() })
      .eq('group_id', held.groupId);

    return { ok: true, url: session.url, sessionId: session.id, groupId: held.groupId };
  } catch (err) {
    // Session creation failed → release the whole held basket.
    await supabase.from('site_bookings').update({ status: 'canceled', payment_status: 'failed' }).eq('group_id', held.groupId);
    await supabase.from('site_booking_groups').update({ status: 'canceled' }).eq('id', held.groupId);
    console.error('[sitePayments.createGroupCheckout] session create failed:', err.message);
    return { ok: false, code: 502, message: 'Could not start checkout. Please try again.' };
  }
}

/**
 * Core: verify a Checkout Session server-side and finalize its booking(s). Idempotent.
 * Looks up bookings BY stored session id (never trusts the query string beyond
 * it), retrieves the session with the business's key, and finalizes only if paid.
 * A basket's children (Task #21) all share one session id → group finalize.
 * Returns { ok, code?, message?, booking, origin, paid }.
 */
async function verifyCheckoutSession(sessionId) {
  if (!sessionId) return { ok: false, code: 400, message: 'Missing session id.' };
  const { data: rows } = await supabase
    .from('site_bookings').select('id, site_id, group_id, status, payment_status').eq('stripe_checkout_session_id', sessionId);
  if (!rows?.length) return { ok: false, code: 404, message: 'Booking not found for this checkout.' };
  const booking = rows[0];
  const isGroup = rows.length > 1 || !!booking.group_id;

  const { data: site } = await supabase.from('sites').select('subdomain, custom_domain').eq('id', booking.site_id).maybeSingle();
  const origin = site ? siteOrigin(site) : null;

  const tenantStripe = await getStripeForSite(booking.site_id);
  if (!tenantStripe) return { ok: false, code: 400, message: 'Payments not configured.', origin };

  let session;
  try { session = await tenantStripe.checkout.sessions.retrieve(sessionId); }
  catch { return { ok: false, code: 400, message: 'Could not verify payment.', origin }; }

  const paid = session && session.payment_status === 'paid';
  if (!paid) return { ok: true, paid: false, origin, booking: { id: booking.id } };

  const { finalizeBookingPayment, finalizeGroupPayment } = require('./bookingController');
  const piId = typeof session.payment_intent === 'string' ? session.payment_intent : (session.payment_intent?.id ?? null);
  const fin = isGroup
    ? await finalizeGroupPayment({ sessionId, paymentIntentId: piId })
    : await finalizeBookingPayment({ bookingId: booking.id, amountCents: session.amount_total ?? null, paymentIntentId: piId });
  return { ...fin, paid: true, origin };
}

// POST /api/site-payments/checkout — public. Body { siteId, teamMemberId,
// serviceId, date, time, customer:{firstName,lastName,email,phone}, notes }.
async function startCheckout(req, res) {
  try {
    const r = await createBookingCheckout({
      siteId: req.body?.siteId, teamMemberId: req.body?.teamMemberId, serviceId: req.body?.serviceId,
      date: req.body?.date, time: req.body?.time, customer: req.body?.customer, notes: req.body?.notes,
      paymentChoice: req.body?.paymentChoice,
    });
    if (!r.ok) return res.status(r.code).json({ success: false, message: r.message, ...(r.notReady ? { notReady: true } : {}) });
    if (r.free) return res.json({ success: true, free: true, booking: r.booking });
    if (r.payInPerson) return res.json({ success: true, payInPerson: true, booking: r.booking });
    res.json({ success: true, url: r.url, sessionId: r.sessionId, bookingId: r.bookingId });
  } catch (err) {
    console.error('[sitePayments.startCheckout]', err.message);
    res.status(500).json({ success: false, message: 'Could not start checkout.' });
  }
}

// POST /api/site-payments/group-checkout — public (Task #21). Body { siteId,
// customer, notes, items:[{serviceId,teamMemberId,date,time}], paymentChoice? }.
// Free / pay-at-visit baskets return { booked, failed, group } like the classic
// group endpoint; online returns { url } for the hosted-Checkout redirect.
async function startGroupCheckout(req, res) {
  try {
    const r = await createGroupCheckout({
      siteId: req.body?.siteId, items: req.body?.items,
      customer: req.body?.customer, notes: req.body?.notes,
      paymentChoice: req.body?.paymentChoice,
    });
    if (!r.ok) return res.status(r.code).json({ success: false, message: r.message, ...(r.failed ? { failed: r.failed } : {}), ...(r.notReady ? { notReady: true } : {}) });
    if (r.free) return res.json({ success: true, free: true, group: r.group, booked: r.booked, failed: r.failed });
    if (r.payInPerson) return res.json({ success: true, payInPerson: true, group: r.group, booked: r.booked, failed: r.failed });
    res.json({ success: true, url: r.url, sessionId: r.sessionId, groupId: r.groupId });
  } catch (err) {
    console.error('[sitePayments.startGroupCheckout]', err.message);
    res.status(500).json({ success: false, message: 'Could not start checkout.' });
  }
}

// GET /api/site-payments/checkout/return?session_id= — Stripe success_url target.
// Verifies + finalizes, then redirects the customer back to the business's site.
async function checkoutReturn(req, res) {
  try {
    const r = await verifyCheckoutSession(req.query?.session_id);
    const origin = r.origin || (process.env.PUBLIC_BASE_URL || '').replace(/\/+$/, '');
    if (!r.ok) return res.redirect(`${origin}/book?checkout=error`);
    return res.redirect(`${origin}/book?checkout=${r.paid ? 'success' : 'incomplete'}`);
  } catch (err) {
    console.error('[sitePayments.checkoutReturn]', err.message);
    res.redirect((process.env.PUBLIC_BASE_URL || '').replace(/\/+$/, '') + '/book?checkout=error');
  }
}

// POST /api/site-payments/checkout/verify — belt-and-braces JSON verify for a
// client (SPA) confirmation page. Body { sessionId }.
async function verifyCheckout(req, res) {
  try {
    const r = await verifyCheckoutSession(req.body?.sessionId);
    if (!r.ok) return res.status(r.code).json({ success: false, message: r.message });
    res.json({ success: true, paid: !!r.paid, booking: r.booking || null });
  } catch (err) {
    console.error('[sitePayments.verifyCheckout]', err.message);
    res.status(500).json({ success: false, message: 'Could not verify checkout.' });
  }
}

module.exports = {
  config, createIntent, createBookingIntent,
  // P12 direct-key hosted Checkout:
  createBookingCheckout, verifyCheckoutSession,
  startCheckout, checkoutReturn, verifyCheckout,
  // Task #21 multi-service basket Checkout:
  createGroupCheckout, startGroupCheckout,
};
