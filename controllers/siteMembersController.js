// Public member-account endpoints (System B / Phase 2d). After a member signs in
// via magic link, the template calls /claim with their Supabase JWT; we verify
// it, then link (or create) their site_customers row by VERIFIED email and stamp
// auth_user_id — so the member's RLS policies can then read their own data.
// Service-role client (bypasses RLS) is required to set auth_user_id.
// Single-var supabase require per convention.
const supabase = require('../config/supabase');
const { stripe } = require('../config/stripe');
const { logSiteActivity } = require('../lib/activity');
const { DateTime } = require('luxon');

async function getMemberFromToken(req) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) return null;
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data?.user?.email) return null;
  return data.user;
}

/**
 * POST /api/site-members/claim  { siteId }
 * Links the signed-in member to their site_customers record by verified email
 * (creating one if they have no prior booking). Returns the member's profile.
 */
async function claim(req, res) {
  try {
    const user = await getMemberFromToken(req);
    if (!user) return res.status(401).json({ success: false, message: 'Not signed in.' });
    const { siteId } = req.body || {};
    if (!siteId) return res.status(400).json({ success: false, message: 'Missing siteId.' });

    const { data: site } = await supabase.from('sites').select('id, status').eq('id', siteId).single();
    if (!site || site.status !== 'live') return res.status(404).json({ success: false, message: 'Site not available.' });

    const { data: rows } = await supabase
      .from('site_customers')
      .select('id, email, first_name, last_name, phone, auth_user_id, metadata')
      .eq('site_id', siteId).ilike('email', user.email).limit(1);
    let cust = rows?.[0] || null;

    if (cust) {
      if (!cust.auth_user_id) {
        await supabase.from('site_customers').update({ auth_user_id: user.id }).eq('id', cust.id);
      } else if (cust.auth_user_id !== user.id) {
        return res.status(409).json({ success: false, message: 'This email is linked to another account.' });
      }
    } else {
      const { data: created } = await supabase
        .from('site_customers')
        .insert({ site_id: siteId, email: user.email, auth_user_id: user.id })
        .select('id, email, first_name, last_name, phone').single();
      cust = created;
    }

    res.json({
      success: true,
      customer: { id: cust.id, email: cust.email, firstName: cust.first_name, lastName: cust.last_name, phone: cust.phone },
      suspended: !!cust.metadata?.suspended,
    });
  } catch (err) {
    console.error('[siteMembers.claim]', err.message);
    res.status(500).json({ success: false, message: 'Could not load your account.' });
  }
}

/**
 * POST /api/site-members/billing-portal  { siteId, returnUrl }
 * Opens the Stripe Customer Portal for the member (update card, view invoices).
 * The member's Stripe customer lives on the PLATFORM account (destination subs).
 */
async function billingPortal(req, res) {
  try {
    if (!stripe) return res.status(503).json({ success: false, message: 'Billing is not configured.' });
    const user = await getMemberFromToken(req);
    if (!user) return res.status(401).json({ success: false, message: 'Not signed in.' });
    const { siteId, returnUrl } = req.body || {};
    if (!siteId) return res.status(400).json({ success: false, message: 'Missing siteId.' });

    const { data: custRows } = await supabase
      .from('site_customers').select('id').eq('site_id', siteId).ilike('email', user.email).limit(1);
    const customerId = custRows?.[0]?.id;
    if (!customerId) return res.status(404).json({ success: false, message: 'No account found.' });

    const { data: subRows } = await supabase
      .from('site_subscriptions').select('stripe_customer_id')
      .eq('site_id', siteId).eq('customer_id', customerId)
      .not('stripe_customer_id', 'is', null).limit(1);
    const stripeCustomer = subRows?.[0]?.stripe_customer_id;
    if (!stripeCustomer) return res.status(400).json({ success: false, message: 'No billing to manage yet.' });

    const session = await stripe.billingPortal.sessions.create({
      customer: stripeCustomer,
      return_url: (returnUrl || `https://stemfra.com/account`).split('?')[0],
    });
    res.json({ success: true, url: session.url });
  } catch (err) {
    console.error('[siteMembers.billingPortal]', err.message);
    res.status(500).json({ success: false, message: err.message || 'Could not open billing.' });
  }
}

/**
 * POST /api/site-members/cancel-booking  { bookingId }
 * A member cancels their OWN upcoming appointment. No refund (refunds stay
 * owner-decided); membership cancellation is owner-managed elsewhere.
 */
async function cancelBooking(req, res) {
  try {
    const user = await getMemberFromToken(req);
    if (!user) return res.status(401).json({ success: false, message: 'Not signed in.' });
    const { bookingId } = req.body || {};
    if (!bookingId) return res.status(400).json({ success: false, message: 'Missing bookingId.' });

    const { data: b } = await supabase
      .from('site_bookings').select('id, site_id, customer_id, starts_at, status').eq('id', bookingId).single();
    if (!b) return res.status(404).json({ success: false, message: 'Booking not found.' });

    // Ownership: the booking's customer must be this member.
    const { data: cust } = await supabase
      .from('site_customers').select('auth_user_id, email').eq('id', b.customer_id).single();
    const owns = cust && (cust.auth_user_id === user.id || (cust.email || '').toLowerCase() === user.email.toLowerCase());
    if (!owns) return res.status(403).json({ success: false, message: 'Not your booking.' });

    if (b.status !== 'confirmed') return res.status(400).json({ success: false, message: 'This booking can no longer be cancelled.' });
    if (new Date(b.starts_at).getTime() <= Date.now()) return res.status(400).json({ success: false, message: 'Past appointments cannot be cancelled.' });

    await supabase.from('site_bookings').update({ status: 'cancelled' }).eq('id', b.id);
    await logSiteActivity({
      siteId: b.site_id, actorName: user.email,
      action: 'booking_cancelled_by_member', entityType: 'site_booking', entityId: b.id,
    });
    res.json({ success: true });
  } catch (err) {
    console.error('[siteMembers.cancelBooking]', err.message);
    res.status(500).json({ success: false, message: 'Could not cancel.' });
  }
}

/**
 * POST /api/site-members/cancel-subscription  { subscriptionId }
 * A member cancels their OWN membership — always at period end (they keep access
 * through what they've paid for). Immediate cancellation stays an owner action.
 */
async function cancelSubscription(req, res) {
  try {
    if (!stripe) return res.status(503).json({ success: false, message: 'Billing is not configured.' });
    const user = await getMemberFromToken(req);
    if (!user) return res.status(401).json({ success: false, message: 'Not signed in.' });
    const { subscriptionId, reasons, feedback } = req.body || {};
    if (!subscriptionId) return res.status(400).json({ success: false, message: 'Missing subscriptionId.' });

    const { data: sub } = await supabase
      .from('site_subscriptions').select('id, site_id, customer_id, stripe_subscription_id, status, metadata').eq('id', subscriptionId).single();
    if (!sub) return res.status(404).json({ success: false, message: 'Subscription not found.' });

    const { data: cust } = await supabase
      .from('site_customers').select('auth_user_id, email').eq('id', sub.customer_id).single();
    const owns = cust && (cust.auth_user_id === user.id || (cust.email || '').toLowerCase() === user.email.toLowerCase());
    if (!owns) return res.status(403).json({ success: false, message: 'Not your membership.' });
    if (!sub.stripe_subscription_id || sub.status === 'canceled') return res.status(400).json({ success: false, message: 'This membership cannot be cancelled.' });

    const cleanReasons = Array.isArray(reasons) ? reasons.filter(r => typeof r === 'string').slice(0, 10) : [];
    const cleanFeedback = (typeof feedback === 'string' ? feedback : '').trim().slice(0, 1000) || null;

    await stripe.subscriptions.update(sub.stripe_subscription_id, { cancel_at_period_end: true });
    await supabase.from('site_subscriptions').update({
      cancel_at_period_end: true,
      metadata: { ...(sub.metadata || {}), cancel_reasons: cleanReasons, cancel_feedback: cleanFeedback, cancelled_by_member_at: new Date().toISOString() },
    }).eq('id', sub.id);
    await logSiteActivity({
      siteId: sub.site_id, actorName: user.email,
      action: 'subscription_cancelled_by_member', entityType: 'site_subscription', entityId: sub.id,
      details: { reasons: cleanReasons, feedback: cleanFeedback },
    });
    res.json({ success: true });
  } catch (err) {
    console.error('[siteMembers.cancelSubscription]', err.message);
    res.status(500).json({ success: false, message: 'Could not cancel.' });
  }
}

/**
 * POST /api/site-members/reactivate-subscription  { subscriptionId }
 * A member changes their mind during the cancellation window — clears the pending
 * cancellation so the membership keeps renewing. (If it has already fully ended,
 * they re-subscribe via the memberships page instead.)
 */
async function reactivateSubscription(req, res) {
  try {
    if (!stripe) return res.status(503).json({ success: false, message: 'Billing is not configured.' });
    const user = await getMemberFromToken(req);
    if (!user) return res.status(401).json({ success: false, message: 'Not signed in.' });
    const { subscriptionId } = req.body || {};
    if (!subscriptionId) return res.status(400).json({ success: false, message: 'Missing subscriptionId.' });

    const { data: sub } = await supabase
      .from('site_subscriptions').select('id, site_id, customer_id, stripe_subscription_id, status, metadata').eq('id', subscriptionId).single();
    if (!sub) return res.status(404).json({ success: false, message: 'Subscription not found.' });

    const { data: cust } = await supabase
      .from('site_customers').select('auth_user_id, email').eq('id', sub.customer_id).single();
    const owns = cust && (cust.auth_user_id === user.id || (cust.email || '').toLowerCase() === user.email.toLowerCase());
    if (!owns) return res.status(403).json({ success: false, message: 'Not your membership.' });
    if (!sub.stripe_subscription_id || sub.status === 'canceled') {
      return res.status(400).json({ success: false, message: 'This membership has ended — please re-subscribe.' });
    }

    await stripe.subscriptions.update(sub.stripe_subscription_id, { cancel_at_period_end: false });
    const md = { ...(sub.metadata || {}) };
    delete md.cancel_reasons; delete md.cancel_feedback; delete md.cancelled_by_member_at;
    await supabase.from('site_subscriptions').update({ cancel_at_period_end: false, metadata: md }).eq('id', sub.id);
    await logSiteActivity({
      siteId: sub.site_id, actorName: user.email,
      action: 'subscription_reactivated_by_member', entityType: 'site_subscription', entityId: sub.id,
    });
    res.json({ success: true });
  } catch (err) {
    console.error('[siteMembers.reactivateSubscription]', err.message);
    res.status(500).json({ success: false, message: 'Could not reactivate.' });
  }
}

/**
 * POST /api/site-members/reschedule-booking  { bookingId, date, time }
 * A member moves their own upcoming appointment to a new day/time (same coach +
 * service). Re-checks the coach is free at the new slot before saving.
 */
async function rescheduleBooking(req, res) {
  try {
    const user = await getMemberFromToken(req);
    if (!user) return res.status(401).json({ success: false, message: 'Not signed in.' });
    const { bookingId, date, time } = req.body || {};
    if (!bookingId || !date || !time) return res.status(400).json({ success: false, message: 'Missing bookingId, date or time.' });

    const { data: b } = await supabase
      .from('site_bookings')
      .select('id, site_id, customer_id, team_member_id, service_id, starts_at, status, duration_minutes')
      .eq('id', bookingId).single();
    if (!b) return res.status(404).json({ success: false, message: 'Booking not found.' });

    const { data: cust } = await supabase
      .from('site_customers').select('auth_user_id, email, metadata').eq('id', b.customer_id).single();
    const owns = cust && (cust.auth_user_id === user.id || (cust.email || '').toLowerCase() === user.email.toLowerCase());
    if (!owns) return res.status(403).json({ success: false, message: 'Not your booking.' });
    if (cust.metadata?.suspended) return res.status(403).json({ success: false, message: 'This account is suspended. Please contact us.' });
    if (b.status !== 'confirmed') return res.status(400).json({ success: false, message: 'This booking can no longer be changed.' });
    if (new Date(b.starts_at).getTime() <= Date.now()) return res.status(400).json({ success: false, message: 'Past appointments cannot be rescheduled.' });

    const { data: site } = await supabase.from('sites').select('time_zone').eq('id', b.site_id).single();
    const zone = site?.time_zone || 'America/New_York';
    const duration = b.duration_minutes || 60;
    const start = DateTime.fromISO(`${date}T${time}`, { zone });
    if (!start.isValid) return res.status(400).json({ success: false, message: 'Invalid date or time.' });
    if (start.toMillis() <= Date.now()) return res.status(400).json({ success: false, message: 'Pick a future time.' });
    const newStartISO = start.toUTC().toISO();
    const newEndISO = start.plus({ minutes: duration }).toUTC().toISO();

    // Conflict check: the coach must be free at the new window.
    const { data: clashes } = await supabase
      .from('site_bookings').select('id')
      .eq('site_id', b.site_id).eq('team_member_id', b.team_member_id).eq('status', 'confirmed')
      .neq('id', b.id).lt('starts_at', newEndISO).gt('ends_at', newStartISO);
    if (clashes && clashes.length) return res.status(409).json({ success: false, message: 'That time is no longer available — pick another.' });

    await supabase.from('site_bookings').update({
      starts_at: newStartISO, ends_at: newEndISO,
      reminder_24h_sent_at: null, reminder_2h_sent_at: null,
    }).eq('id', b.id);
    await logSiteActivity({
      siteId: b.site_id, actorName: user.email,
      action: 'booking_rescheduled_by_member', entityType: 'site_booking', entityId: b.id,
      details: { new_starts_at: newStartISO },
    });
    res.json({ success: true });
  } catch (err) {
    console.error('[siteMembers.rescheduleBooking]', err.message);
    res.status(500).json({ success: false, message: 'Could not reschedule.' });
  }
}

/**
 * GET /api/site-members/activity?siteId=  — the member's own account history
 * (membership + booking actions they took), read from site_activity by their
 * verified email.
 */
async function memberActivity(req, res) {
  try {
    const user = await getMemberFromToken(req);
    if (!user) return res.status(401).json({ success: false, message: 'Not signed in.' });
    const siteId = req.query.siteId;
    if (!siteId) return res.status(400).json({ success: false, message: 'Missing siteId.' });
    const { data } = await supabase
      .from('site_activity')
      .select('id, action, details, created_at')
      .eq('site_id', siteId).ilike('actor_name', user.email)
      .order('created_at', { ascending: false }).limit(20);
    res.json({ success: true, events: data || [] });
  } catch (err) {
    console.error('[siteMembers.memberActivity]', err.message);
    res.status(500).json({ success: false, message: 'Could not load activity.' });
  }
}

module.exports = { claim, billingPortal, cancelBooking, cancelSubscription, reactivateSubscription, rescheduleBooking, memberActivity };
