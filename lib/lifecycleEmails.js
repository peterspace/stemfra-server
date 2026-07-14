// Lifecycle / marketing emails (N4 — the "B-family"). Sent by the lifecycle
// sweeper. All are tenant-branded (the business → its customer), respect the
// customer's email_opt_out, and carry the unsubscribe link. Each is sent at most
// once per customer per milestone (stamped on site_customers.metadata.lifecycle).
//
// Per-site enable flags live at site_theme_settings.metadata.lifecycle_emails
// (absent/true = on) — the CMS "Emails" page (a later slice) writes them.
const supabase = require('../config/supabase');
const emails = require('../templates/transactionalEmails');
const { sendMail } = require('./mailer');
const { loadBookingContext, loadSiteBrand } = require('./bookingEmails');
const { unsubscribeUrl } = require('./emailTokens');

// Resolve a site's lifecycle-email prefs (default all on).
async function getLifecyclePrefs(siteId) {
  const defaults = { first_visit: true, win_back: true, review_ask: true, birthday: true, anniversary: true, no_show: true };
  try {
    const { data } = await supabase.from('site_theme_settings').select('metadata').eq('site_id', siteId).maybeSingle();
    const l = (data?.metadata?.lifecycle_emails) || {};
    return {
      first_visit: l.first_visit !== false,
      win_back: l.win_back !== false,
      review_ask: l.review_ask !== false,
      birthday: l.birthday !== false,
      anniversary: l.anniversary !== false,
      no_show: l.no_show !== false,
    };
  } catch { return defaults; }
}

const WIN_BACK_COOLDOWN_DAYS = 90;
const REVIEW_ASK_FIRST_VISIT_GAP_DAYS = 3;  // don't stack on a fresh first-visit email

// Resolve a per-email discount from metadata.lifecycle_offers[key] = {enabled,
// percent}. Returns a positive integer percent when enabled, else 0 (no coupon).
function offerPercent(offers, key) {
  const o = offers && offers[key];
  if (!o || !o.enabled) return 0;
  const p = Math.round(Number(o.percent));
  return Number.isFinite(p) && p > 0 && p <= 100 ? p : 0;
}

// Stamp a per-customer lifecycle milestone so it never repeats.
async function stampLifecycle(customerId, prevMeta, key) {
  const lc = (prevMeta?.lifecycle) || {};
  await supabase.from('site_customers')
    .update({ metadata: { ...(prevMeta || {}), lifecycle: { ...lc, [key]: new Date().toISOString() } } })
    .eq('id', customerId);
}

// First-visit follow-up (~1 day after a customer's first appointment).
async function sendFirstVisitFollowup(bookingId) {
  try {
    const c = await loadBookingContext(bookingId);
    if (!c || !c.customerEmail || c.customerOptedOut) return false;
    const prefs = await getLifecyclePrefs(c.booking.site_id);
    if (!prefs.first_visit) return false;

    const { data: cust } = await supabase.from('site_customers').select('metadata').eq('id', c.customerId).maybeSingle();
    if (cust?.metadata?.lifecycle?.first_visit_sent_at) return false; // once ever

    const ok = await sendMail({
      fromName: c.businessName, to: c.customerEmail, replyTo: c.businessEmail,
      subject: `Thanks for visiting ${c.businessName}`,
      text: `Thanks for visiting ${c.businessName}! We'd love to welcome you back — book anytime at ${c.bookingUrl}.`,
      html: emails.firstVisitFollowup({ ...c, discountPercent: offerPercent(c.lifecycleOffers, 'first_visit'), unsubscribeUrl: unsubscribeUrl(c.customerId) }),
    });
    if (ok) await stampLifecycle(c.customerId, cust?.metadata, 'first_visit_sent_at');
    return ok;
  } catch (e) { console.error('[lifecycleEmails.firstVisit]', e.message); return false; }
}

// Win-back — a lapsed customer (last visit ~60 days ago, no return since).
// Re-sendable after a cooldown so repeat-lapsers get re-engaged.
async function sendWinBack(bookingId) {
  try {
    const c = await loadBookingContext(bookingId);
    if (!c || !c.customerEmail || c.customerOptedOut) return false;
    const prefs = await getLifecyclePrefs(c.booking.site_id);
    if (!prefs.win_back) return false;

    const { data: cust } = await supabase.from('site_customers').select('metadata').eq('id', c.customerId).maybeSingle();
    const last = cust?.metadata?.lifecycle?.win_back_sent_at;
    if (last && (Date.now() - new Date(last).getTime()) < WIN_BACK_COOLDOWN_DAYS * 86400000) return false;

    const ok = await sendMail({
      fromName: c.businessName, to: c.customerEmail, replyTo: c.businessEmail,
      subject: `We miss you at ${c.businessName}`,
      text: `It's been a while since your last visit to ${c.businessName} — we'd love to see you again. Book anytime at ${c.bookingUrl}.`,
      html: emails.winBack({ ...c, discountPercent: offerPercent(c.lifecycleOffers, 'win_back'), unsubscribeUrl: unsubscribeUrl(c.customerId) }),
    });
    if (ok) await stampLifecycle(c.customerId, cust?.metadata, 'win_back_sent_at');
    return ok;
  } catch (e) { console.error('[lifecycleEmails.winBack]', e.message); return false; }
}

// Review / feedback ask (~2 days after a visit). Once ever per customer, and
// skipped if a first-visit follow-up went out in the last few days (so a brand
// new customer isn't emailed twice in 48h).
async function sendReviewRequest(bookingId) {
  try {
    const c = await loadBookingContext(bookingId);
    if (!c || !c.customerEmail || c.customerOptedOut) return false;
    const prefs = await getLifecyclePrefs(c.booking.site_id);
    if (!prefs.review_ask) return false;

    const { data: cust } = await supabase.from('site_customers').select('metadata').eq('id', c.customerId).maybeSingle();
    const lc = cust?.metadata?.lifecycle || {};
    if (lc.review_ask_sent_at) return false; // once ever
    if (lc.first_visit_sent_at &&
        (Date.now() - new Date(lc.first_visit_sent_at).getTime()) < REVIEW_ASK_FIRST_VISIT_GAP_DAYS * 86400000) {
      return false;
    }

    const ok = await sendMail({
      fromName: c.businessName, to: c.customerEmail, replyTo: c.businessEmail,
      subject: `How was your visit to ${c.businessName}?`,
      text: `Thanks for visiting ${c.businessName}! We'd love your feedback${c.reviewUrl ? ` — leave a review: ${c.reviewUrl}` : ' — just reply to this email and let us know'}.`,
      html: emails.reviewRequest({ ...c, discountPercent: offerPercent(c.lifecycleOffers, 'review_ask'), unsubscribeUrl: unsubscribeUrl(c.customerId) }),
    });
    if (ok) await stampLifecycle(c.customerId, cust?.metadata, 'review_ask_sent_at');
    return ok;
  } catch (e) { console.error('[lifecycleEmails.reviewRequest]', e.message); return false; }
}

// Birthday greeting — customer-based (not tied to a booking). Once per calendar
// year per customer (`lifecycle.birthday_sent_year`). The sweeper hands us only
// customers whose birthday is today.
async function sendBirthday(customerId) {
  try {
    const { data: cust } = await supabase.from('site_customers')
      .select('id, site_id, first_name, email, email_opt_out, birthdate, metadata')
      .eq('id', customerId).maybeSingle();
    if (!cust || !cust.email || cust.email_opt_out || !cust.birthdate) return false;

    const prefs = await getLifecyclePrefs(cust.site_id);
    if (!prefs.birthday) return false;

    const year = new Date().getFullYear();
    if (cust.metadata?.lifecycle?.birthday_sent_year === year) return false; // once this year

    // Live-status gating is the sweeper's job (consistent with the other
    // lifecycle senders) — the sender just needs the brand bits.
    const brand = await loadSiteBrand(cust.site_id);
    if (!brand) return false;

    const discountPercent = offerPercent(brand.lifecycleOffers, 'birthday');
    const ok = await sendMail({
      fromName: brand.businessName, to: cust.email, replyTo: brand.businessEmail,
      subject: `Happy birthday from ${brand.businessName}!`,
      text: `Happy birthday${cust.first_name ? `, ${cust.first_name}` : ''}! Everyone at ${brand.businessName} is wishing you a wonderful day.${discountPercent ? ` Your birthday gift: ${discountPercent}% off your next visit.` : ''} Book anytime at ${brand.bookingUrl}.`,
      html: emails.birthdayGreeting({
        businessName: brand.businessName, businessLogoUrl: brand.businessLogoUrl, businessUrl: brand.businessUrl,
        firstName: cust.first_name, discountPercent, bookingUrl: brand.bookingUrl,
        unsubscribeUrl: unsubscribeUrl(cust.id),
      }),
    });
    if (ok) {
      const meta = cust.metadata || {};
      const lc = meta.lifecycle || {};
      await supabase.from('site_customers')
        .update({ metadata: { ...meta, lifecycle: { ...lc, birthday_sent_year: year } } })
        .eq('id', cust.id);
    }
    return ok;
  } catch (e) { console.error('[lifecycleEmails.birthday]', e.message); return false; }
}

// First-visit anniversary (~1 year after a customer's first visit). Once ever.
async function sendAnniversary(bookingId) {
  try {
    const c = await loadBookingContext(bookingId);
    if (!c || !c.customerEmail || c.customerOptedOut) return false;
    const prefs = await getLifecyclePrefs(c.booking.site_id);
    if (!prefs.anniversary) return false;

    const { data: cust } = await supabase.from('site_customers').select('metadata').eq('id', c.customerId).maybeSingle();
    if (cust?.metadata?.lifecycle?.anniversary_sent_at) return false; // once ever

    const ok = await sendMail({
      fromName: c.businessName, to: c.customerEmail, replyTo: c.businessEmail,
      subject: `A year with ${c.businessName} — thank you!`,
      text: `It's been a year since your first visit to ${c.businessName} — thank you! Book anytime at ${c.bookingUrl}.`,
      html: emails.anniversaryGreeting({ ...c, discountPercent: offerPercent(c.lifecycleOffers, 'anniversary'), unsubscribeUrl: unsubscribeUrl(c.customerId) }),
    });
    if (ok) await stampLifecycle(c.customerId, cust?.metadata, 'anniversary_sent_at');
    return ok;
  } catch (e) { console.error('[lifecycleEmails.anniversary]', e.message); return false; }
}

// No-show follow-up — EVENT-based (fired from the CMS /notify tail when the owner
// marks a booking no-show), not swept. Opt-out honored + per-site toggle.
async function sendNoShow(bookingId) {
  try {
    const c = await loadBookingContext(bookingId);
    if (!c || !c.customerEmail || c.customerOptedOut) return false;
    const prefs = await getLifecyclePrefs(c.booking.site_id);
    if (!prefs.no_show) return false;
    return await sendMail({
      fromName: c.businessName, to: c.customerEmail, replyTo: c.businessEmail,
      subject: `Sorry we missed you at ${c.businessName}`,
      text: `We missed you for your ${c.serviceName} on ${c.dateLabel} — no worries, life happens. We'd love to get you back in; rebook anytime at ${c.bookingUrl}.`,
      html: emails.noShowFollowup({ ...c, unsubscribeUrl: unsubscribeUrl(c.customerId) }),
    });
  } catch (e) { console.error('[lifecycleEmails.noShow]', e.message); return false; }
}

module.exports = { getLifecyclePrefs, sendFirstVisitFollowup, sendWinBack, sendReviewRequest, sendBirthday, sendAnniversary, sendNoShow };
