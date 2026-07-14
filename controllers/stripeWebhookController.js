// Stripe webhook — the robustness backstop for the payments flow.
//
// Signature verification needs the UNPARSED request body, so this route is
// mounted in index.js with express.raw() and registered BEFORE the global
// express.json() parser. Single-var supabase require per server convention.
const supabase = require('../config/supabase');
const emails = require('../templates/transactionalEmails');
const { sendMail } = require('../lib/mailer');
const { stripe } = require('../config/stripe');

const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;

// payment_intent.succeeded can arrive a beat BEFORE the client's createBooking
// finishes writing the row, so a "missing booking" right now may just be a
// race. Re-check after this grace window before crying orphan.
const ORPHAN_GRACE_MS = 20_000;

// Map a Stripe subscription status → our `subscription_status` enum
// (pending | active | past_due | cancelled | expired).
function mapSubStatus(s) {
  switch (s) {
    case 'active':
    case 'trialing': return 'active';
    case 'past_due':
    case 'unpaid': return 'past_due';
    case 'canceled': return 'cancelled';
    case 'incomplete_expired': return 'expired';
    default: return 'pending'; // incomplete, paused, etc.
  }
}

// Newer Stripe API versions moved current_period_* from the subscription onto
// its items; read either location.
const tsToIso = (sec) => (sec ? new Date(sec * 1000).toISOString() : null);
const subPeriodStart = (sub) => tsToIso(sub.current_period_start ?? sub.items?.data?.[0]?.current_period_start);
const subPeriodEnd = (sub) => tsToIso(sub.current_period_end ?? sub.items?.data?.[0]?.current_period_end);

// ── System B (native memberships) helpers ──
// Link the member to a site_customers row by verified email (created during
// checkout), creating it if new.
async function upsertMemberCustomer(siteId, email, name) {
  if (!email) return null;
  const { data: existing } = await supabase
    .from('site_customers').select('id').eq('site_id', siteId).eq('email', email).maybeSingle();
  if (existing) return existing.id;
  const first = (name || '').trim().split(/\s+/)[0] || null;
  const { data: created } = await supabase
    .from('site_customers').insert({ site_id: siteId, email, first_name: first }).select('id').single();
  return created?.id ?? null;
}

async function handleMembershipCheckout(s) {
  const siteId = s.metadata?.site_id;
  const productId = s.metadata?.product_id;
  const subId = typeof s.subscription === 'string' ? s.subscription : s.subscription?.id;
  const stripeCustomerId = typeof s.customer === 'string' ? s.customer : s.customer?.id;
  const customerId = await upsertMemberCustomer(siteId, s.customer_details?.email, s.customer_details?.name);

  // Retrieve the subscription so the row carries period/amount/fee even when the
  // customer.subscription.* event raced ahead of this insert (it matches by
  // stripe_subscription_id, which doesn't exist in our table until now).
  let sub = null;
  try { sub = await stripe.subscriptions.retrieve(subId); } catch { /* best effort */ }

  const row = {
    site_id: siteId,
    product_id: productId,
    customer_id: customerId,
    stripe_subscription_id: subId,
    stripe_customer_id: stripeCustomerId,
    status: sub ? sub.status : 'active',
    current_period_end: sub ? subPeriodEnd(sub) : null,
    cancel_at_period_end: sub ? !!sub.cancel_at_period_end : false,
    amount_cents: sub?.items?.data?.[0]?.price?.unit_amount ?? null,
    application_fee_percent: sub?.application_fee_percent ?? null,
  };
  const { data: existing } = await supabase
    .from('site_subscriptions').select('id').eq('stripe_subscription_id', subId).maybeSingle();
  if (existing?.id) await supabase.from('site_subscriptions').update(row).eq('id', existing.id);
  else await supabase.from('site_subscriptions').insert(row);
}

// Paid-but-dropped backstop: a succeeded PaymentIntent with no booking means the
// customer's card was charged but the booking never got written (e.g. the
// browser died between confirmPayment and createBooking). We don't auto-create
// the booking — the PI metadata only carries site_id/service_id, not the chosen
// slot/customer — so we alert for manual reconciliation (book them, or refund).
async function alertOrphanPayment(pi) {
  const { data: booking } = await supabase
    .from('site_bookings').select('id').eq('stripe_payment_intent_id', pi.id).maybeSingle();
  if (booking) return; // not an orphan after all — the booking landed in the grace window

  const amount = ((pi.amount || 0) / 100).toFixed(2);
  const siteId = pi.metadata?.site_id || '(unknown)';
  const serviceId = pi.metadata?.service_id || '(unknown)';
  console.error(`[stripe.webhook] ORPHAN PAYMENT ${pi.id} succeeded ($${amount}) with no booking. site=${siteId} service=${serviceId}`);

  const to = process.env.NOTIFY_EMAIL;
  if (!to) return;
  try {
    await sendMail({
      fromName: 'STEMfra Sites',
      to,
      subject: `⚠ Orphan payment: $${amount} charged with no booking (${pi.id})`,
      text: [
        'A Stripe payment succeeded but no booking row was created.',
        '',
        `PaymentIntent: ${pi.id}`,
        `Amount: $${amount}`,
        `Site: ${siteId}`,
        `Service: ${serviceId}`,
        '',
        'Action: reconcile manually — create the booking for the customer, or refund the charge in the Stripe dashboard.',
      ].join('\n'),
      html: emails.staffOrphanPaymentAlert({ amountLabel: `$${amount}`, paymentIntentId: pi.id, siteId }),
    });
  } catch (e) {
    console.error('[stripe.webhook] orphan alert email failed:', e.message);
  }
}

async function handleWebhook(req, res) {
  if (!stripe) return res.status(503).send('Stripe not configured.');
  if (!WEBHOOK_SECRET) {
    console.warn('[stripe.webhook] STRIPE_WEBHOOK_SECRET not set — acknowledging without verification.');
    return res.status(200).json({ received: true, skipped: 'no secret' });
  }

  let event;
  try {
    const sig = req.headers['stripe-signature'];
    event = stripe.webhooks.constructEvent(req.body, sig, WEBHOOK_SECRET);
  } catch (err) {
    console.error('[stripe.webhook] signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    switch (event.type) {
      // Keep the per-site Connect status fresh without the CMS having to poll.
      case 'account.updated': {
        const acct = event.data.object;
        await supabase.from('site_payment_accounts').update({
          charges_enabled: acct.charges_enabled,
          payouts_enabled: acct.payouts_enabled,
          details_submitted: acct.details_submitted,
        }).eq('stripe_account_id', acct.id);
        break;
      }

      // A refund (full or partial) flips the booking's payment status so the CMS
      // badge reflects reality.
      case 'charge.refunded': {
        const charge = event.data.object;
        // Only flip to 'refunded' on a FULL refund; partial refunds keep 'paid'.
        if (!charge.refunded) break;
        const piId = typeof charge.payment_intent === 'string'
          ? charge.payment_intent
          : charge.payment_intent?.id;
        if (piId) {
          await supabase.from('site_bookings')
            .update({ payment_status: 'refunded' })
            .eq('stripe_payment_intent_id', piId);
        }
        break;
      }

      case 'payment_intent.payment_failed': {
        const pi = event.data.object;
        console.warn(`[stripe.webhook] payment_failed ${pi.id}: ${pi.last_payment_error?.message || 'no message'}`);
        break;
      }

      // Backstop for paid-but-dropped BOOKINGS (see alertOrphanPayment). Only
      // booking PaymentIntents carry service_id metadata — subscription/invoice
      // PIs (System A platform billing, System B memberships) are not orphans.
      case 'payment_intent.succeeded': {
        const pi = event.data.object;
        if (pi.metadata?.service_id) {
          const { data: booking } = await supabase
            .from('site_bookings').select('id').eq('stripe_payment_intent_id', pi.id).maybeSingle();
          if (!booking) {
            setTimeout(() => {
              alertOrphanPayment(pi).catch(e => console.error('[stripe.webhook]', e.message));
            }, ORPHAN_GRACE_MS);
          }
        }
        break;
      }

      // ── System A: Stemfra billing its business customers (the `subscriptions`
      // table). Routed by metadata.kind='platform_billing'. ──
      case 'checkout.session.completed': {
        const s = event.data.object;
        if (s.metadata?.kind === 'site_membership' && s.subscription) {
          await handleMembershipCheckout(s);
        } else if (s.metadata?.kind === 'platform_billing' && s.subscription) {
          const subId = typeof s.subscription === 'string' ? s.subscription : s.subscription.id;
          const { data: row } = await supabase
            .from('subscriptions').select('id, build_amount_cents, build_paid_at').eq('site_id', s.metadata.site_id).maybeSingle();
          if (row) {
            const patch = {
              stripe_subscription_id: subId,
              status: 'active',
              started_at: new Date().toISOString(),
            };
            // A completed subscription checkout means the first invoice (which
            // carries the one-time build fee) was paid.
            if (row.build_amount_cents > 0 && !row.build_paid_at) {
              patch.build_paid_at = new Date().toISOString();
            }
            await supabase.from('subscriptions').update(patch).eq('id', row.id);
          }
        }
        break;
      }

      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted': {
        const sub = event.data.object;
        const deleted = event.type === 'customer.subscription.deleted';
        if (sub.metadata?.kind === 'platform_billing') {
          // System A — maps to the subscription_status enum.
          await supabase.from('subscriptions').update({
            status: deleted ? 'cancelled' : mapSubStatus(sub.status),
            current_period_start: subPeriodStart(sub),
            current_period_end: subPeriodEnd(sub),
            cancel_at_period_end: !!sub.cancel_at_period_end,
            cancelled_at: tsToIso(sub.canceled_at),
          }).eq('stripe_subscription_id', sub.id);
        } else if (sub.metadata?.kind === 'site_membership') {
          // System B — site_subscriptions.status stores the raw Stripe status.
          await supabase.from('site_subscriptions').update({
            status: deleted ? 'canceled' : sub.status,
            current_period_end: subPeriodEnd(sub),
            cancel_at_period_end: !!sub.cancel_at_period_end,
            canceled_at: tsToIso(sub.canceled_at),
            amount_cents: sub.items?.data?.[0]?.price?.unit_amount ?? null,
            application_fee_percent: sub.application_fee_percent ?? null,
          }).eq('stripe_subscription_id', sub.id);
        }
        break;
      }

      case 'invoice.paid': {
        const inv = event.data.object;
        // Look up by CUSTOMER (stored at checkout creation) — race-proof, since
        // invoice.paid can arrive before checkout.session.completed has stored
        // the subscription id. Only platform-billing rows live in `subscriptions`.
        const customerId = typeof inv.customer === 'string' ? inv.customer : inv.customer?.id;
        if (customerId) {
          const { data: row } = await supabase
            .from('subscriptions').select('id, build_paid_at').eq('stripe_customer_id', customerId).maybeSingle();
          if (row) {
            const patch = { status: 'active' };
            if (!row.build_paid_at && inv.billing_reason === 'subscription_create') {
              patch.build_paid_at = new Date().toISOString();
            }
            await supabase.from('subscriptions').update(patch).eq('id', row.id);
          }
        }
        break;
      }

      case 'invoice.payment_failed': {
        const inv = event.data.object;
        const customerId = typeof inv.customer === 'string' ? inv.customer : inv.customer?.id;
        if (customerId) {
          await supabase.from('subscriptions').update({ status: 'past_due' }).eq('stripe_customer_id', customerId);
        }
        break;
      }

      default:
        // Unhandled types are fine — acknowledge so Stripe stops retrying.
        break;
    }
  } catch (err) {
    // Log and still 200: account.updated/refunds are reconcilable via status
    // reads, and we don't want Stripe hammering retries for a transient DB blip.
    console.error(`[stripe.webhook] handler error for ${event.type}:`, err.message);
  }

  res.status(200).json({ received: true });
}

module.exports = { handleWebhook };
