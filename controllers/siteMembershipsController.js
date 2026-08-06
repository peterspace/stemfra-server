// Memberships. P14 (2026-08-05) pivoted the LIVE flow to PAY-AT-VENUE: a visitor
// signs up online (no charge), the business signs the agreement + collects
// payment in person, the owner confirms it in the CMS. That confirmation is the
// commissionable event (see docs/MEMBERSHIPS_PAY_AT_VENUE_PLAN.md).
//   - signup / createMembershipSignup — the LIVE path (pending subscription).
//   - createCheckout — the LEGACY Stripe Connect path, dormant, not called by
//     any new surface. Left intact per the plan (do not repair/extend).
// Single-var supabase require per convention.
const supabase = require('../config/supabase');
const { stripe, ONLINE_PAYMENTS_ENABLED, SUBSCRIPTION_APP_FEE_PCT } = require('../config/stripe');
const { upsertBookingCustomer } = require('./bookingController');
const { logSiteActivity } = require('../lib/activity');
const { getSiteNotifyPrefs } = require('../lib/notifyPrefs');
const { cmsMagicLink } = require('../lib/cmsMagicLink');
const { sendMail } = require('../lib/mailer');
const { sendOwnerSms } = require('../lib/ownerSmsAlerts');
const emails = require('../templates/transactionalEmails');

// Light per-IP+site rate limit (in-memory, per-instance) — same convention as
// the newsletter + site-chat public endpoints.
const signupHits = new Map(); // `${ip}:${siteId}` → timestamps
function signupRateLimited(ip, siteId) {
  const key = `${ip}:${siteId}`;
  const now = Date.now();
  const hits = (signupHits.get(key) || []).filter((ts) => now - ts < 60_000);
  hits.push(now);
  signupHits.set(key, hits);
  if (signupHits.size > 5000) signupHits.clear();
  return hits.length > 10;
}

// site_products.name is i18n jsonb ({en: ...}); coerce to a display string
// (same convention as frontdeskLists/frontdeskManage).
const en = (v) => (typeof v === 'string' ? v : v?.en || '');

function moneyLabel(cents, currency) {
  if (cents == null) return null;
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: (currency || 'USD').toUpperCase() }).format(cents / 100);
  } catch {
    return `$${(cents / 100).toFixed(2)}`;
  }
}

/**
 * Shared core for pay-at-venue membership signup. Reused by the HTTP handler
 * (public site) and the Front Desk chat tool (C1) — NOT via an HTTP self-call.
 * Idempotent: an existing pending/active venue sub for the same (site, product,
 * customer) is returned, no duplicate. Returns { ok, code?, message?,
 * subscription?, plan?, existing? }.
 *
 * @param {string[]} allowedStatuses site.status values allowed (public passes
 *   ['live']; the chat tool passes ['live','previewing'] so it's testable).
 */
async function createMembershipSignup({ siteId, productId, customer, allowedStatuses = ['live'] }) {
  if (!siteId || !productId) return { ok: false, code: 400, message: 'Missing siteId or productId.' };
  if (!customer || !customer.email) return { ok: false, code: 400, message: 'An email is required to sign up.' };

  const { data: site } = await supabase
    .from('sites').select('id, status, owner_contact_id, subdomain').eq('id', siteId).single();
  if (!site || !allowedStatuses.includes(site.status)) {
    return { ok: false, code: 404, message: 'Site not available.' };
  }

  const { data: plan } = await supabase
    .from('site_products')
    .select('id, name, price_cents, currency, product_type, is_active')
    .eq('id', productId).eq('site_id', siteId).single();
  if (!plan || !plan.is_active || plan.product_type !== 'membership') {
    return { ok: false, code: 404, message: 'Membership plan not found.' };
  }

  const cust = await upsertBookingCustomer(siteId, customer);
  if (!cust.ok) return { ok: false, code: cust.code, message: cust.message };

  // Idempotent: reuse an open venue sub for this customer + plan.
  const { data: existing } = await supabase
    .from('site_subscriptions')
    .select('*')
    .eq('site_id', siteId).eq('product_id', productId).eq('customer_id', cust.customerId)
    .eq('collection_mode', 'venue')
    .in('status', ['pending', 'active', 'renewal_due'])
    .maybeSingle();
  if (existing) return { ok: true, subscription: existing, plan, existing: true };

  const { data: sub, error: subErr } = await supabase
    .from('site_subscriptions')
    .insert([{
      site_id: siteId,
      product_id: productId,
      customer_id: cust.customerId,
      status: 'pending',
      collection_mode: 'venue',
      amount_cents: plan.price_cents ?? null,
      application_fee_percent: null,
    }])
    .select().single();
  if (subErr) return { ok: false, code: 500, message: subErr.message };

  // Audit (the cms_notifications bell fires automatically via the INSERT trigger).
  await logSiteActivity({
    siteId, action: 'membership_signup', entityType: 'site_subscription', entityId: sub.id,
    entityName: en(plan.name) || 'Membership',
    details: { customer_id: cust.customerId, product_id: productId },
  });

  // Owner email (best-effort; gated on the owner_membership pref; only for LIVE).
  if (site.status === 'live') {
    try {
      const prefs = await getSiteNotifyPrefs(siteId);
      if (prefs.owner_membership) {
        const { data: owner } = await supabase
          .from('contacts').select('email, auth_user_id').eq('id', site.owner_contact_id).single();
        if (owner?.email) {
          const dashboardUrl = await cmsMagicLink(owner.auth_user_id, '/memberships');
          const priceLabel = moneyLabel(plan.price_cents, plan.currency);
          const planName = en(plan.name) || '(membership)';
          const name = [customer.firstName, customer.lastName].filter(Boolean).join(' ').trim() || customer.name || null;
          // Task 9: SMS alongside the email, same pref gate, consent-gated inside.
          sendOwnerSms(owner.auth_user_id, `New membership signup: ${name || 'a customer'}, ${planName}. Collect payment at the venue, then confirm it in your CMS.`);
          await sendMail({
            fromName: 'STEMfra Sites',
            to: owner.email,
            subject: `New membership signup${planName ? ` — ${planName}` : ''}`,
            text: [
              `${name || 'A customer'} signed up for a membership on your website.`,
              ``,
              `Plan: ${planName}`,
              priceLabel ? `Price: ${priceLabel}` : '',
              `Customer: ${name || '(no name)'}`,
              `Email: ${customer.email || '(not given)'}`,
              customer.phone ? `Phone: ${customer.phone}` : '',
              ``,
              `Nothing was charged online. Sign the agreement and collect payment at the venue, then mark it collected in your CMS Memberships page.`,
            ].filter(Boolean).join('\n'),
            html: emails.ownerMembershipSignup({
              customerName: name, customerEmail: customer.email, customerPhone: customer.phone,
              planName, priceLabel, dashboardUrl,
            }),
          });
        }
      }
    } catch (emailErr) {
      console.error('[membership signup] owner email failed:', emailErr.message);
    }
  }

  return { ok: true, subscription: sub, plan, existing: false };
}

/**
 * POST /api/site-memberships/signup
 * { siteId, productId, firstName?, lastName?, email, phone? }
 * Public pay-at-venue signup: records a pending subscription + notifies the owner.
 */
async function signup(req, res) {
  try {
    const { siteId, productId, firstName, lastName, name, email, phone } = req.body || {};
    if (signupRateLimited(req.ip, siteId || '')) {
      return res.status(429).json({ success: false, message: 'Too many attempts. Try again in a minute.' });
    }
    if (email && !/^\S+@\S+\.\S+$/.test(String(email).trim())) {
      return res.status(400).json({ success: false, message: 'Please enter a valid email address.' });
    }
    const result = await createMembershipSignup({
      siteId, productId,
      customer: { firstName, lastName, name, email, phone },
      allowedStatuses: ['live', 'previewing'],
    });
    if (!result.ok) return res.status(result.code || 400).json({ success: false, message: result.message });
    return res.json({
      success: true,
      alreadySignedUp: !!result.existing,
      planName: en(result.plan?.name) || null,
    });
  } catch (err) {
    console.error('[siteMemberships.signup]', err.message);
    return res.status(500).json({ success: false, message: 'Could not complete signup.' });
  }
}

/**
 * POST /api/site-memberships/checkout
 * { siteId, productId, returnUrl }
 * Creates a Stripe Checkout session (subscription mode) for a native membership
 * plan. The member is the customer (Checkout collects their email); money goes
 * to the gym's connected account, less our application fee. The webhook
 * (kind='site_membership') links the customer + writes the site_subscriptions row.
 */
async function createCheckout(req, res) {
  // P14 pay-at-venue: online membership checkout is suspended platform-wide. Steer
  // to the signup (pay-at-venue) path instead of charging a card.
  if (!ONLINE_PAYMENTS_ENABLED) return res.status(400).json({ success: false, message: 'Online membership payments are unavailable. Sign up and pay in person.', notReady: true });
  if (!stripe) return res.status(503).json({ success: false, message: 'Payments are not configured.' });
  try {
    const { siteId, productId, returnUrl } = req.body || {};
    if (!siteId || !productId) return res.status(400).json({ success: false, message: 'Missing siteId or productId.' });

    const { data: site } = await supabase
      .from('sites').select('id, status, subdomain').eq('id', siteId).single();
    if (!site || site.status !== 'live') return res.status(404).json({ success: false, message: 'Site not available.' });

    const { data: plan } = await supabase
      .from('site_products')
      .select('id, name, price_cents, currency, product_type, fulfillment_mode, stripe_price_id, is_active, external_url')
      .eq('id', productId).eq('site_id', siteId).single();
    if (!plan || !plan.is_active || plan.product_type !== 'membership') {
      return res.status(404).json({ success: false, message: 'Membership plan not found.' });
    }
    if (plan.fulfillment_mode !== 'native') {
      // External (bring-your-own) tiers link out (e.g. Wodify) — not our checkout.
      return res.status(400).json({ success: false, message: 'This plan is managed off-site.', externalUrl: plan.external_url });
    }
    if (!plan.stripe_price_id) {
      return res.status(400).json({ success: false, message: 'This plan is not ready for checkout.' });
    }

    const { data: acct } = await supabase
      .from('site_payment_accounts').select('stripe_account_id, charges_enabled').eq('site_id', siteId).single();
    if (!acct?.stripe_account_id || !acct.charges_enabled) {
      return res.status(400).json({ success: false, message: 'This business is not ready to take payments yet.' });
    }

    const base = (returnUrl || `https://${site.subdomain}.stemfra.com/memberships`).split('?')[0];

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      line_items: [{ price: plan.stripe_price_id, quantity: 1 }],
      success_url: `${base}?membership=success`,
      cancel_url: `${base}?membership=canceled`,
      metadata: { kind: 'site_membership', site_id: siteId, product_id: productId },
      subscription_data: {
        application_fee_percent: SUBSCRIPTION_APP_FEE_PCT,
        transfer_data: { destination: acct.stripe_account_id },
        metadata: { kind: 'site_membership', site_id: siteId, product_id: productId },
      },
    });

    res.json({ success: true, url: session.url, sessionId: session.id });
  } catch (err) {
    console.error('[siteMemberships.createCheckout]', err.message);
    res.status(500).json({ success: false, message: 'Could not start checkout.' });
  }
}

module.exports = { createCheckout, signup, createMembershipSignup };
