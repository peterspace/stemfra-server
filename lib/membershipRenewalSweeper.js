// P14 Phase E2 — venue-membership renewal lifecycle sweeper.
//
// Pay-at-venue memberships have NO Stripe subscription behind them, so nothing
// external advances or expires them. This periodic pass does it in the DB and
// nudges the member to renew in person:
//
//   (a) status stamps — an active venue sub whose current_period_end has passed
//       becomes 'renewal_due'; 14+ days past becomes 'expired'.
//   (b) reminders — a member gets a tenant-branded email at ~T-7d (heads-up) and
//       at T-0 (due). Stamped once per period on metadata.renewal_reminders so
//       they never repeat within the same period (a confirmed payment advances
//       current_period_end, which changes the stamp key and re-arms them).
//   (c) cancel-at-period-end — a sub the member asked to end finalizes to
//       'canceled' once its period runs out.
//
// site_subscriptions.status is a TEXT column (not the subscription_status enum,
// which backs the System-A `subscriptions` table), so 'renewal_due'/'expired'
// are plain string writes. Owners confirm the renewal from the CMS Renewals view
// (B1), which now also picks up 'renewal_due' subs and advances the period back
// to 'active'.
//
// Single-var supabase require per convention.
const supabase = require('../config/supabase');
const { activeProvider, sendMail } = require('./mailer');
const emails = require('../templates/transactionalEmails');
const { resolveTenantEmailBrand } = require('./tenantEmailBrand');
const { logSiteActivity } = require('./activity');

const DAY = 86400000;
const REMINDER_LEAD_DAYS = 7;    // heads-up window before current_period_end
const EXPIRE_GRACE_DAYS = 14;    // renewal_due → expired after this many days past

const en = (v) => (typeof v === 'string' ? v : v?.en || '');

function moneyLabel(cents, currency) {
  if (cents == null) return null;
  try { return new Intl.NumberFormat('en-US', { style: 'currency', currency: (currency || 'USD').toUpperCase() }).format(cents / 100); }
  catch { return `$${(cents / 100).toFixed(2)}`; }
}

function dateLabel(iso) {
  return new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

// Best-effort tenant-branded renewal reminder to the member. Returns true if sent.
async function sendReminder(sub, brand, { due }) {
  try {
    const { data: cust } = await supabase
      .from('site_customers').select('email, first_name').eq('id', sub.customer_id).maybeSingle();
    if (!cust?.email) return false;
    const plan = sub.plan || {};
    const r = await sendMail({
      fromName: brand.name || 'Your membership',
      replyTo: brand.businessEmail || undefined,
      to: cust.email,
      subject: due ? 'Your membership is due to renew' : 'Your membership renews soon',
      // builder returns an HTML string (not {html,text}); assign it to `html`.
      html: emails.membershipRenewalReminder({
        businessName: brand.name, businessLogoUrl: brand.logoUrl, businessEmail: brand.businessEmail,
        businessUrl: brand.businessUrl, businessAccent: brand.accent, businessFont: brand.font, businessPhotoUrl: brand.photoUrl,
        firstName: cust.first_name, planName: en(plan.name),
        priceLabel: moneyLabel(sub.amount_cents ?? plan.price_cents, plan.currency),
        renewalDateLabel: dateLabel(sub.current_period_end), due,
      }),
    });
    return !!r;
  } catch (e) {
    console.error('[membership-renewal] reminder failed:', e.message);
    return false;
  }
}

// One sweep. Options: dryRun (no writes/emails, just counts), includeDemo (also
// process is_starter demo sites — off by default so demo members aren't emailed).
async function sweepMembershipRenewals({ dryRun = false, includeDemo = false } = {}) {
  const now = Date.now();
  const { data: subs, error } = await supabase
    .from('site_subscriptions')
    .select('id, site_id, status, current_period_end, cancel_at_period_end, amount_cents, metadata, customer_id, product_id, collection_mode, site:sites!inner(status, metadata), plan:site_products(name, price_cents, currency)')
    .eq('collection_mode', 'venue')
    .in('status', ['active', 'renewal_due'])
    .eq('site.status', 'live')
    .not('current_period_end', 'is', null)
    .limit(5000);
  if (error) { console.error('[membership-renewal] load failed:', error.message); return { error: error.message }; }

  let reminders = 0, dueStamped = 0, expired = 0, canceled = 0, scanned = 0;
  for (const sub of subs || []) {
    if (!includeDemo && sub.site?.metadata?.is_starter === true) continue;
    scanned++;
    const end = new Date(sub.current_period_end).getTime();
    const daysUntil = (end - now) / DAY;
    const meta = sub.metadata || {};
    const update = {};

    // (c) finalize a member-requested end once the period runs out.
    if (sub.cancel_at_period_end && end <= now) {
      if (!dryRun) {
        await supabase.from('site_subscriptions')
          .update({ status: 'canceled', canceled_at: new Date().toISOString(), cancel_at_period_end: false })
          .eq('id', sub.id);
        await logSiteActivity({
          siteId: sub.site_id, actorName: 'Stemfra', action: 'membership_canceled_at_period_end',
          entityType: 'site_subscription', entityId: sub.id, details: { period_end: sub.current_period_end },
        });
      }
      canceled++;
      continue;
    }

    // (b) reminders — once per period, keyed on current_period_end.
    const rem = meta.renewal_reminders || {};
    const wantT7 = daysUntil > 0 && daysUntil <= REMINDER_LEAD_DAYS && rem.t7_for !== sub.current_period_end;
    const wantT0 = daysUntil <= 0 && daysUntil > -EXPIRE_GRACE_DAYS && rem.t0_for !== sub.current_period_end;
    if (wantT7 || wantT0) {
      if (dryRun) {
        reminders += (wantT7 ? 1 : 0) + (wantT0 ? 1 : 0);
      } else {
        const brand = await resolveTenantEmailBrand(sub.site_id);
        const newRem = { ...rem };
        if (wantT7 && await sendReminder(sub, brand, { due: false })) { newRem.t7_for = sub.current_period_end; reminders++; }
        if (wantT0 && await sendReminder(sub, brand, { due: true })) { newRem.t0_for = sub.current_period_end; reminders++; }
        if (newRem.t7_for !== rem.t7_for || newRem.t0_for !== rem.t0_for) {
          update.metadata = { ...meta, renewal_reminders: newRem };
        }
      }
    }

    // (a) status stamps.
    if (daysUntil < -EXPIRE_GRACE_DAYS) {
      if (sub.status !== 'expired') { update.status = 'expired'; expired++; }
    } else if (daysUntil < 0 && sub.status === 'active') {
      update.status = 'renewal_due'; dueStamped++;
    }

    if (!dryRun && Object.keys(update).length) {
      await supabase.from('site_subscriptions').update(update).eq('id', sub.id);
      if (update.status) {
        await logSiteActivity({
          siteId: sub.site_id, actorName: 'Stemfra',
          action: update.status === 'expired' ? 'membership_expired' : 'membership_renewal_due',
          entityType: 'site_subscription', entityId: sub.id, details: { period_end: sub.current_period_end },
        });
      }
    }
  }
  const summary = { scanned, reminders, dueStamped, expired, canceled };
  if (!dryRun) console.log('[membership-renewal] swept', summary);
  return summary;
}

function startMembershipRenewalSweeper({ intervalMs = 12 * 3600 * 1000 } = {}) {
  if (!activeProvider()) {
    console.warn('[membership-renewal] no email provider configured — sweeper NOT started');
    return null;
  }
  setTimeout(() => sweepMembershipRenewals().catch(() => {}), 60000);   // shortly after boot
  const t = setInterval(() => sweepMembershipRenewals().catch((e) => console.error('[membership-renewal]', e.message)), intervalMs);
  t.unref?.();
  console.log(`✓ Membership renewal sweeper running every ${Math.round(intervalMs / 3600000)}h`);
  return t;
}

module.exports = { startMembershipRenewalSweeper, sweepMembershipRenewals };
