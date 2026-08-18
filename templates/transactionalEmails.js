// Transactional email builders (Case 9) — every system email the server sends,
// rendered through the unified base (templates/baseEmail.js). Each builder
// returns { subject?, html } — callers keep their existing plain-text
// alternative and pass both to nodemailer.
//
// Brand rule: bookings go OUT AS THE BUSINESS (tenant brand — the visitor
// booked with the barbershop, not with Stemfra); owner/staff notifications are
// Stemfra-branded.

const { renderEmail, quoteBlock, discountBlock, escapeHtml } = require('./baseEmail');

// A lifecycle discount line, phrased per email. `discountPercent` is a positive
// number when the owner enabled a discount for that email (CMS Emails page).
const discountLine = (percent, lead) =>
  (percent > 0 ? discountBlock(`${lead}: enjoy ${percent}% off your next visit. Just mention this email when you book.`) : '');

// Task #24 — resolve a site's review platforms into an ORDERED list (Google first
// — it's worth ~10× the others for a local business). Accepts the new
// `reviewLinks` map and falls back to the legacy single `reviewUrl` (= Google).
function orderedReviewPlatforms(reviewLinks, reviewUrl) {
  const links = reviewLinks || (reviewUrl ? { google: reviewUrl } : {});
  // Google only (2026-08-04): Yelp/Trustpilot rows removed. The array shape
  // stays so the primary-button + secondary-line template logic is untouched
  // (secondary is now always empty and its block never renders).
  return [['Google', links.google]]
    .filter(([, url]) => typeof url === 'string' && url.trim())
    .map(([label, url]) => ({ label, url: url.trim() }));
}

// Secondary "you can also review us on …" line (the non-primary platforms).
function reviewLinksBlock(secondary, accent) {
  if (!secondary.length) return '';
  const color = /^#[0-9a-f]{6}$/i.test(accent || '') ? accent : '#1a73e8';
  const links = secondary
    .map((s) => `<a href="${escapeHtml(s.url)}" style="color:${color};text-decoration:underline;">${escapeHtml(s.label)}</a>`)
    .join(' &nbsp;·&nbsp; ');
  return `<p style="margin:16px 0 0;font-size:14px;line-height:1.6;color:#555555;">You can also review us on ${links}.</p>`;
}

const CMS_URL = process.env.CMS_PUBLIC_URL || 'https://cms.stemfra.com';
const SITE_URL = process.env.SITE_PUBLIC_URL || 'https://stemfra.com';

// Trust/clarity footer links for System-A billing emails (Figma pattern): help +
// the legal pages that already exist on the marketing site.
const BILLING_LINKS = [
  { label: 'Help', url: `${SITE_URL}/faq` },
  { label: 'Terms', url: `${SITE_URL}/terms` },
  { label: 'Privacy', url: `${SITE_URL}/privacy` },
  { label: 'Cancellation & refunds', url: `${SITE_URL}/refund` },
];

// Standard anti-phishing footer line (Peter, 2026-07-10). Tenant variant names
// the business's own inbox when known + always offers Stemfra support.
function tenantSecurityLine(businessName, businessEmail) {
  const biz = businessEmail
    ? `contact ${escapeHtml(businessName)} at <a href="mailto:${escapeHtml(businessEmail)}" style="color:#1a73e8;">${escapeHtml(businessEmail)}</a> or `
    : `contact ${escapeHtml(businessName)} or `;
  return `If you didn't make this booking, ${biz}email <a href="mailto:support@stemfra.com" style="color:#1a73e8;">support@stemfra.com</a>.`;
}
const STEMFRA_SECURITY = `If you didn't initiate this, contact our support team via the app or <a href="mailto:support@stemfra.com" style="color:#1a73e8;">support@stemfra.com</a>.`;


// ─── Tenant → visitor ─────────────────────────────────────────────────────────

// Single-service appointment confirmation.
function bookingConfirmation({ businessName, businessLogoUrl, businessEmail, businessUrl, businessAccent, businessFont, businessPhotoUrl, overrideHeading, overrideSubheading, firstName, serviceName, dateLabel, timeLabel, durationLabel, meetLink }) {
  return renderEmail({
    brand: { name: businessName, logoUrl: businessLogoUrl, url: businessUrl, accent: businessAccent, font: businessFont, photoUrl: businessPhotoUrl },
    preheader: `${dateLabel} at ${timeLabel}. See you then.`,
    heading: overrideHeading || (firstName ? `You're booked, ${firstName}.` : "You're booked."),
    paragraphs: [overrideSubheading || 'Your appointment is confirmed. Here are the details:'],
    rows: [
      { label: 'Service', value: serviceName },
      { label: 'Date', value: dateLabel },
      { label: 'Time', value: timeLabel },
      durationLabel ? { label: 'Duration', value: durationLabel } : null,
      meetLink ? { label: 'Where', value: 'Google Meet (video call)' } : null,
    ],
    // Video calls carry their Join button right in the confirmation — the
    // attached calendar file holds the same link, so no separate Google invite
    // is ever sent (Gmail flags those as "from an unknown sender").
    cta: meetLink ? { label: 'Join with Google Meet', url: meetLink } : undefined,
    note: `Need to change or cancel? Just reply to this email and ${businessName} will sort it out.`,
    security: tenantSecurityLine(businessName, businessEmail),
    reason: `You're receiving this because you booked an appointment with ${businessName}.`,
  });
}

// Class / group-session booking confirmation.
function classConfirmation({ businessName, businessLogoUrl, businessEmail, businessUrl, businessAccent, businessFont, businessPhotoUrl, serviceName, dateLabel, timeLabel }) {
  return renderEmail({
    brand: { name: businessName, logoUrl: businessLogoUrl, url: businessUrl, accent: businessAccent, font: businessFont, photoUrl: businessPhotoUrl },
    preheader: `${dateLabel} at ${timeLabel}. See you in class.`,
    heading: "You're booked in.",
    paragraphs: ['Your spot is confirmed. Here are the details:'],
    rows: [
      { label: 'Class', value: serviceName },
      { label: 'Date', value: dateLabel },
      { label: 'Time', value: timeLabel },
    ],
    note: `Can't make it? Reply to this email and ${businessName} will help.`,
    security: tenantSecurityLine(businessName, businessEmail),
    reason: `You're receiving this because you booked a class with ${businessName}.`,
  });
}

// Multi-service visit (salon basket): one email, one itemized summary.
function visitConfirmation({ businessName, businessLogoUrl, businessEmail, businessUrl, businessAccent, businessFont, businessPhotoUrl, dateLabel, items, totalLabel, failureNote }) {
  return renderEmail({
    brand: { name: businessName, logoUrl: businessLogoUrl, url: businessUrl, accent: businessAccent, font: businessFont, photoUrl: businessPhotoUrl },
    preheader: `Your visit on ${dateLabel} is confirmed.`,
    heading: 'Your visit is confirmed.',
    paragraphs: [`Here's your visit on ${dateLabel}:`],
    rows: [
      ...items.map(it => ({ label: it.time, value: it.service })),
      totalLabel ? { label: 'Total', value: totalLabel, bold: true } : null,
    ],
    note: [failureNote, `Need to change anything? Reply to this email and ${businessName} will sort it out.`]
      .filter(Boolean).join('\n'),
    security: tenantSecurityLine(businessName, businessEmail),
    reason: `You're receiving this because you booked a visit with ${businessName}.`,
  });
}


// Appointment reminder (the N1 sweeper) — tenant → visitor.
function bookingReminder({ businessName, businessLogoUrl, businessEmail, businessUrl, businessAccent, businessFont, businessPhotoUrl, firstName, serviceName, dateLabel, timeLabel, isClass, unsubscribeUrl }) {
  return renderEmail({
    brand: { name: businessName, logoUrl: businessLogoUrl, url: businessUrl, accent: businessAccent, font: businessFont, photoUrl: businessPhotoUrl },
    preheader: `Reminder: ${dateLabel} at ${timeLabel}.`,
    heading: firstName ? `See you soon, ${firstName}.` : 'See you soon.',
    paragraphs: [`A friendly reminder about your upcoming ${isClass ? 'class' : 'appointment'}:`],
    rows: [
      { label: isClass ? 'Class' : 'Service', value: serviceName },
      { label: 'Date', value: dateLabel },
      { label: 'Time', value: timeLabel },
    ],
    note: `Can't make it? Reply to this email and ${businessName} will help you reschedule.`,
    security: tenantSecurityLine(businessName, businessEmail),
    reason: `You're receiving this because you have a booking with ${businessName}.`,
    unsubscribeUrl,
  });
}

// Cancellation confirmation — tenant → visitor.
function bookingCanceled({ businessName, businessLogoUrl, businessEmail, businessUrl, businessAccent, businessFont, businessPhotoUrl, firstName, serviceName, dateLabel, timeLabel, canceledByBusiness }) {
  return renderEmail({
    brand: { name: businessName, logoUrl: businessLogoUrl, url: businessUrl, accent: businessAccent, font: businessFont, photoUrl: businessPhotoUrl },
    preheader: `Your ${dateLabel} booking has been canceled.`,
    heading: 'Your booking has been canceled.',
    paragraphs: [
      ...(firstName && !canceledByBusiness ? [`Hi ${firstName},`] : []),
      canceledByBusiness
        ? `${businessName} had to cancel the following booking. Sorry about the change of plans:`
        : 'This confirms your cancellation:',
    ],
    rows: [
      { label: 'Service', value: serviceName },
      { label: 'Date', value: dateLabel },
      { label: 'Time', value: timeLabel },
    ],
    note: `Want to rebook? Just reply to this email or book again on ${businessName}'s website.`,
    security: tenantSecurityLine(businessName, businessEmail),
    reason: `You're receiving this because you had a booking with ${businessName}.`,
  });
}

// Reschedule/change notification — tenant → visitor.
function bookingRescheduled({ businessName, businessLogoUrl, businessEmail, businessUrl, businessAccent, businessFont, businessPhotoUrl, firstName, serviceName, dateLabel, timeLabel, oldDateLabel, oldTimeLabel }) {
  return renderEmail({
    brand: { name: businessName, logoUrl: businessLogoUrl, url: businessUrl, accent: businessAccent, font: businessFont, photoUrl: businessPhotoUrl },
    preheader: `New time: ${dateLabel} at ${timeLabel}.`,
    heading: 'Your booking has a new time.',
    paragraphs: [
      ...(firstName ? [`Hi ${firstName},`] : []),
      'Your booking has been rescheduled. The new details:',
    ],
    rows: [
      { label: 'Service', value: serviceName },
      { label: 'New date', value: dateLabel, bold: true },
      { label: 'New time', value: timeLabel, bold: true },
      oldDateLabel ? { label: 'Previously', value: `${oldDateLabel}${oldTimeLabel ? ` at ${oldTimeLabel}` : ''}` } : null,
    ],
    note: `Doesn't work for you? Reply to this email and ${businessName} will find a better time.`,
    security: tenantSecurityLine(businessName, businessEmail),
    reason: `You're receiving this because you have a booking with ${businessName}.`,
  });
}

// New booking / cancellation — Stemfra → site owner.
function ownerBookingNotification({ event, customerName, customerEmail, customerPhone, serviceName, dateLabel, timeLabel, oldDateLabel, oldTimeLabel, dashboardUrl }) {
  const canceled = event === 'canceled';
  const rescheduled = event === 'rescheduled';
  const who = customerName || 'A customer';
  return renderEmail({
    preheader: canceled ? `${who} canceled their booking.` : rescheduled ? `${who} rescheduled their booking.` : `${who} just booked.`,
    eyebrow: canceled ? 'Booking canceled' : rescheduled ? 'Booking rescheduled' : 'New booking',
    heading: canceled ? 'A booking was canceled' : rescheduled ? 'A booking was rescheduled' : 'You have a new booking',
    paragraphs: [canceled ? 'A booking on your calendar was canceled:' : rescheduled ? 'A booking on your calendar moved to a new time:' : 'A new booking just landed on your calendar:'],
    rows: [
      { label: 'Customer', value: customerName || '(no name)' },
      customerEmail ? { label: 'Email', value: customerEmail } : null,
      customerPhone ? { label: 'Phone', value: customerPhone } : null,
      { label: 'Service', value: serviceName },
      rescheduled && oldDateLabel ? { label: 'Was', value: `${oldDateLabel} at ${oldTimeLabel}` } : null,
      { label: rescheduled ? 'Now' : 'Date', value: rescheduled ? `${dateLabel} at ${timeLabel}` : dateLabel },
      rescheduled ? null : { label: 'Time', value: timeLabel },
    ],
    cta: { label: 'Open your Bookings calendar', url: dashboardUrl || `${CMS_URL}/bookings` },
    reason: "You're receiving this because your Stemfra website manages your bookings. You can turn these emails off in your CMS settings.",
  });
}

// Membership activated (pay-at-venue) — tenant → member. Sent when the owner
// confirms the first payment in the CMS. A warm welcome + the renewal date.
function membershipActivated({ businessName, businessLogoUrl, businessEmail, businessUrl, businessAccent, businessFont, businessPhotoUrl, firstName, planName, priceLabel, nextRenewalLabel }) {
  return renderEmail({
    brand: { name: businessName, logoUrl: businessLogoUrl, url: businessUrl, accent: businessAccent, font: businessFont, photoUrl: businessPhotoUrl },
    preheader: `Your ${planName || 'membership'} is active.`,
    heading: 'Your membership is active.',
    paragraphs: [
      ...(firstName ? [`Hi ${firstName},`] : []),
      `Thanks for joining. Your membership with ${businessName} is now active:`,
    ],
    rows: [
      { label: 'Plan', value: planName || 'Membership' },
      priceLabel ? { label: 'Amount', value: priceLabel } : null,
      nextRenewalLabel ? { label: 'Next renewal', value: nextRenewalLabel, bold: true } : null,
    ],
    note: `You renew in person at ${businessName}. We'll remind you before your renewal date.`,
    security: tenantSecurityLine(businessName, businessEmail),
    reason: `You're receiving this because you started a membership with ${businessName}.`,
  });
}

// Renewal payment confirmed at the venue (owner marked it collected in the CMS
// Renewals view). A receipt, not a charge: honest "payment received" copy.
function membershipRenewed({ businessName, businessLogoUrl, businessEmail, businessUrl, businessAccent, businessFont, businessPhotoUrl, firstName, planName, priceLabel, nextRenewalLabel }) {
  return renderEmail({
    brand: { name: businessName, logoUrl: businessLogoUrl, url: businessUrl, accent: businessAccent, font: businessFont, photoUrl: businessPhotoUrl },
    preheader: `Payment received for your ${planName || 'membership'}.`,
    heading: 'Payment received.',
    paragraphs: [
      ...(firstName ? [`Hi ${firstName},`] : []),
      `Thanks. We've recorded your membership payment at ${businessName}:`,
    ],
    rows: [
      { label: 'Plan', value: planName || 'Membership' },
      priceLabel ? { label: 'Amount', value: priceLabel } : null,
      nextRenewalLabel ? { label: 'Next renewal', value: nextRenewalLabel, bold: true } : null,
    ],
    note: `You renew in person at ${businessName}. We'll remind you before your next renewal date.`,
    security: tenantSecurityLine(businessName, businessEmail),
    reason: `You're receiving this because you have a membership with ${businessName}.`,
  });
}

// Renewal reminder for a pay-at-venue membership (from the lifecycle sweeper).
// `due=false` = a heads-up ~7 days before the renewal date; `due=true` = the
// renewal date has arrived/passed. Transactional (about their active membership),
// so it is not gated by the marketing opt-out.
function membershipRenewalReminder({ businessName, businessLogoUrl, businessEmail, businessUrl, businessAccent, businessFont, businessPhotoUrl, firstName, planName, priceLabel, renewalDateLabel, due }) {
  return renderEmail({
    brand: { name: businessName, logoUrl: businessLogoUrl, url: businessUrl, accent: businessAccent, font: businessFont, photoUrl: businessPhotoUrl },
    preheader: due ? `Your ${planName || 'membership'} is due to renew.` : `Your ${planName || 'membership'} renews soon.`,
    heading: due ? 'Your membership is due to renew.' : 'Your membership renews soon.',
    paragraphs: [
      ...(firstName ? [`Hi ${firstName},`] : []),
      due
        ? `Your membership at ${businessName} was due to renew on ${renewalDateLabel}. Pop in to renew and keep your spot.`
        : `A quick heads-up: your membership at ${businessName} renews on ${renewalDateLabel}.`,
    ],
    rows: [
      { label: 'Plan', value: planName || 'Membership' },
      priceLabel ? { label: 'Amount', value: priceLabel } : null,
      { label: due ? 'Was due' : 'Renews', value: renewalDateLabel, bold: true },
    ],
    note: `You renew in person at ${businessName}. Bring your usual payment and we'll take care of the rest.`,
    security: tenantSecurityLine(businessName, businessEmail),
    reason: `You're receiving this because you have a membership with ${businessName}.`,
  });
}

// ─── Stemfra → site owner ─────────────────────────────────────────────────────

// Contact-form lead landed on their site.
function ownerLeadNotification({ name, email, phone, subject, message, dashboardUrl }) {
  return renderEmail({
    preheader: `${name || 'A visitor'} sent a message through your website.`,
    eyebrow: 'New lead',
    heading: 'New enquiry from your website',
    paragraphs: ['Someone just reached out through your website contact form:'],
    rows: [
      { label: 'Name', value: name || '(not given)' },
      { label: 'Email', value: email || '(not given)' },
      { label: 'Phone', value: phone || '(not given)' },
      subject ? { label: 'Subject', value: subject } : null,
    ],
    bodyHtml: message ? quoteBlock(message, 'Message') : '',
    cta: { label: 'Open your Leads inbox', url: dashboardUrl || `${CMS_URL}/leads` },
    note: 'Fast replies win customers. Most enquiries go to whoever answers first.',
    reason: "You're receiving this because your Stemfra website collected a new lead.",
  });
}

// Chat-assistant lead.
function ownerChatLeadNotification({ name, email, phone, intent, summary, dashboardUrl }) {
  return renderEmail({
    preheader: `${name || 'A visitor'} left their details with your chat assistant.`,
    eyebrow: 'New lead',
    heading: 'Your chat assistant captured a lead',
    paragraphs: ['A visitor chatted with your website assistant and left their details:'],
    rows: [
      { label: 'Name', value: name || '(not given)' },
      { label: 'Email', value: email || '(not given)' },
      { label: 'Phone', value: phone || '(not given)' },
      intent ? { label: 'Looking for', value: intent } : null,
    ],
    bodyHtml: summary ? quoteBlock(summary, 'What they wanted') : '',
    cta: { label: 'Open your Leads inbox', url: dashboardUrl || `${CMS_URL}/leads` },
    reason: "You're receiving this because your Stemfra website collected a new lead.",
  });
}

// Monthly membership-renewal digest (pay-at-venue). Stemfra → site owner (E3).
// "N renewals to confirm this month", with an overdue count when some periods
// have already lapsed. Deep-links to the CMS Renewals view.
function ownerRenewalDigest({ dueCount, overdueCount, amountLabel, monthLabel, dashboardUrl }) {
  const n = dueCount || 0;
  const overdue = overdueCount || 0;
  return renderEmail({
    preheader: `${n} membership renewal${n === 1 ? '' : 's'} to confirm${monthLabel ? ` in ${monthLabel}` : ''}.`,
    eyebrow: 'Memberships',
    heading: n === 1 ? '1 renewal to confirm' : `${n} renewals to confirm`,
    paragraphs: [
      `You have ${n} membership renewal${n === 1 ? '' : 's'} to confirm${monthLabel ? ` for ${monthLabel}` : ' this month'}. Once you've collected payment at the venue, mark each one collected in your CMS so your reports and commission stay accurate.`,
      ...(overdue > 0 ? [`${overdue} of these ${overdue === 1 ? 'is' : 'are'} already past the renewal date.`] : []),
    ],
    rows: [
      { label: 'To confirm', value: String(n), bold: true },
      overdue > 0 ? { label: 'Overdue', value: String(overdue) } : null,
      amountLabel ? { label: 'Expected to collect', value: amountLabel } : null,
    ],
    cta: { label: 'Open your Renewals', url: dashboardUrl || `${CMS_URL}/memberships` },
    note: 'Nothing is charged online. Confirming a renewal records the payment you took in person and advances the membership to its next period.',
    reason: "You're receiving this because you have pay-at-venue memberships on your Stemfra website. You can turn these emails off in your CMS settings.",
  });
}

// Membership signup (pay-at-venue). Stemfra → site owner. The customer signed up
// online; the owner signs the agreement + collects payment in person, then
// confirms it in the CMS. Not a Stripe charge, so the copy says "confirm at the
// venue", never "paid".
function ownerMembershipSignup({ customerName, customerEmail, customerPhone, planName, priceLabel, dashboardUrl }) {
  const who = customerName || 'A customer';
  return renderEmail({
    preheader: `${who} signed up for ${planName || 'a membership'}.`,
    eyebrow: 'New membership signup',
    heading: 'A new membership signup',
    paragraphs: [`${who} signed up for a membership on your website. Sign the agreement and take payment at your next visit, then mark it collected in your CMS:`],
    rows: [
      { label: 'Customer', value: customerName || '(no name)' },
      customerEmail ? { label: 'Email', value: customerEmail } : null,
      customerPhone ? { label: 'Phone', value: customerPhone } : null,
      { label: 'Plan', value: planName || '(membership)' },
      priceLabel ? { label: 'Price', value: priceLabel } : null,
    ],
    cta: { label: 'Open your Memberships', url: dashboardUrl || `${CMS_URL}/memberships` },
    note: 'Nothing was charged online. Confirm the payment in your CMS once you collect it at the venue.',
    reason: "You're receiving this because a customer signed up for a membership on your Stemfra website. You can turn these emails off in your CMS settings.",
  });
}

// ─── Lifecycle (N4): tenant → visitor ─────────────────────────────────────────

// First-visit follow-up — ~a day after a customer's first appointment. Warm
// thanks + a nudge to rebook. Opt-out honored (carries the unsubscribe link).
function firstVisitFollowup({ businessName, businessLogoUrl, businessEmail, businessUrl, businessAccent, businessFont, businessPhotoUrl, firstName, serviceName, bookingUrl, unsubscribeUrl, discountPercent }) {
  return renderEmail({
    brand: { name: businessName, logoUrl: businessLogoUrl, url: businessUrl, accent: businessAccent, font: businessFont, photoUrl: businessPhotoUrl },
    preheader: `Thanks for visiting ${businessName}. We'd love to see you again.`,
    heading: firstName ? `Thanks for coming in, ${firstName}.` : 'Thanks for coming in.',
    paragraphs: [
      `We hope you enjoyed your ${serviceName ? serviceName.toLowerCase() : 'visit'} at ${businessName}.`,
      "It was great having you. Whenever you're ready for your next visit, we'd love to welcome you back.",
    ],
    bodyHtml: discountLine(discountPercent, 'A little thank-you for your first visit'),
    cta: bookingUrl ? { label: 'Book your next visit', url: bookingUrl } : undefined,
    note: `Questions or feedback? Just reply to this email. ${businessName} reads every one.`,
    reason: `You're receiving this because you recently visited ${businessName}.`,
    unsubscribeUrl,
  });
}

// Win-back — a customer who hasn't returned in a while. Warm nudge to rebook.
function winBack({ businessName, businessLogoUrl, businessEmail, businessUrl, businessAccent, businessFont, businessPhotoUrl, firstName, bookingUrl, unsubscribeUrl, discountPercent }) {
  return renderEmail({
    brand: { name: businessName, logoUrl: businessLogoUrl, url: businessUrl, accent: businessAccent, font: businessFont, photoUrl: businessPhotoUrl },
    preheader: `We'd love to see you back at ${businessName}.`,
    heading: firstName ? `We miss you, ${firstName}.` : 'We miss you.',
    paragraphs: [
      `It's been a little while since your last visit to ${businessName}, and we'd love to welcome you back.`,
      'Whenever you\'re ready, booking your next appointment takes just a moment.',
    ],
    bodyHtml: discountLine(discountPercent, 'To welcome you back'),
    cta: bookingUrl ? { label: 'Book your next visit', url: bookingUrl } : undefined,
    note: `Hope to see you soon! Questions? Just reply to this email.`,
    reason: `You're receiving this because you've visited ${businessName} before.`,
    unsubscribeUrl,
  });
}

// Review / feedback ask — ~2 days after a visit. If the business configured a
// public review link (Google/Yelp), the CTA sends them there; otherwise it's a
// warm "reply and tell us how it went" feedback prompt. Once ever per customer.
function reviewRequest({ businessName, businessLogoUrl, businessEmail, businessUrl, businessAccent, businessFont, businessPhotoUrl, firstName, serviceName, reviewUrl, reviewLinks, bookingUrl, unsubscribeUrl, discountPercent }) {
  const platforms = orderedReviewPlatforms(reviewLinks, reviewUrl);
  const primary = platforms[0] || null;
  const secondary = platforms.slice(1);
  return renderEmail({
    brand: { name: businessName, logoUrl: businessLogoUrl, url: businessUrl, accent: businessAccent, font: businessFont, photoUrl: businessPhotoUrl },
    preheader: `How was your visit to ${businessName}? We'd love your feedback.`,
    heading: firstName ? `How was your visit, ${firstName}?` : 'How was your visit?',
    paragraphs: [
      `Thanks again for choosing ${businessName}${serviceName ? ` for your ${serviceName.toLowerCase()}` : ''}. We hope it was everything you wanted.`,
      primary
        ? "If you have a moment, a quick review means the world to a small business like ours, and it helps others find us."
        : "We'd love to hear how it went. Just reply to this email and let us know. Good or bad, we read every note.",
    ],
    bodyHtml: discountLine(discountPercent, 'A thank-you for your feedback') + reviewLinksBlock(secondary, businessAccent),
    cta: primary
      ? { label: primary.label === 'Google' ? 'Leave a Google review' : `Review us on ${primary.label}`, url: primary.url }
      : (bookingUrl ? { label: 'Book your next visit', url: bookingUrl } : undefined),
    note: primary ? 'Prefer to tell us directly? Just reply to this email.' : undefined,
    reason: `You're receiving this because you recently visited ${businessName}.`,
    unsubscribeUrl,
  });
}

// Birthday greeting — sent on the customer's birthday. Warm wishes + a book
// nudge. Optional per-site birthday discount (`discountPercent`, set on the CMS
// Emails page) renders a highlighted "N% off" coupon band.
function birthdayGreeting({ businessName, businessLogoUrl, businessUrl, businessAccent, businessFont, businessPhotoUrl, firstName, discountPercent, bookingUrl, unsubscribeUrl }) {
  return renderEmail({
    brand: { name: businessName, logoUrl: businessLogoUrl, url: businessUrl, accent: businessAccent, font: businessFont, photoUrl: businessPhotoUrl },
    preheader: `Happy birthday from ${businessName}!`,
    heading: firstName ? `Happy birthday, ${firstName}!` : 'Happy birthday!',
    paragraphs: [
      `Everyone at ${businessName} is wishing you a wonderful birthday.`,
      "We'd love to help you treat yourself. Book a visit whenever you're ready.",
    ],
    bodyHtml: discountLine(discountPercent, 'Your birthday gift'),
    cta: bookingUrl ? { label: 'Book a visit', url: bookingUrl } : undefined,
    note: 'Warm wishes from all of us. Hope to see you soon.',
    reason: `You're receiving this because you're a customer of ${businessName}.`,
    unsubscribeUrl,
  });
}

// First-visit anniversary — ~1 year after a customer's first visit. A warm
// "thanks for a year" note + a rebook nudge. Once ever per customer.
function anniversaryGreeting({ businessName, businessLogoUrl, businessUrl, businessAccent, businessFont, businessPhotoUrl, firstName, bookingUrl, unsubscribeUrl, discountPercent }) {
  return renderEmail({
    brand: { name: businessName, logoUrl: businessLogoUrl, url: businessUrl, accent: businessAccent, font: businessFont, photoUrl: businessPhotoUrl },
    preheader: `It's been a year since your first visit to ${businessName}.`,
    heading: firstName ? `Happy anniversary, ${firstName}!` : 'Happy anniversary!',
    paragraphs: [
      `It's been a year since your first visit to ${businessName}. Thank you for being part of our community.`,
      "We've loved having you, and we're looking forward to many more visits ahead.",
    ],
    bodyHtml: discountLine(discountPercent, 'To celebrate a year together'),
    cta: bookingUrl ? { label: 'Book your next visit', url: bookingUrl } : undefined,
    note: `Thanks for a wonderful year, from all of us at ${businessName}.`,
    reason: `You're receiving this because you first visited ${businessName} a year ago.`,
    unsubscribeUrl,
  });
}

// No-show follow-up — sent when the owner marks a booking as a no-show. A warm,
// no-guilt "we missed you, let's rebook". Opt-out honored.
function noShowFollowup({ businessName, businessLogoUrl, businessUrl, businessAccent, businessFont, businessPhotoUrl, firstName, serviceName, dateLabel, bookingUrl, unsubscribeUrl }) {
  return renderEmail({
    brand: { name: businessName, logoUrl: businessLogoUrl, url: businessUrl, accent: businessAccent, font: businessFont, photoUrl: businessPhotoUrl },
    preheader: `We missed you at ${businessName}. Let's find a new time.`,
    heading: firstName ? `Sorry we missed you, ${firstName}.` : 'Sorry we missed you.',
    paragraphs: [
      `We had you down for ${serviceName ? serviceName.toLowerCase() : 'a visit'}${dateLabel ? ` on ${dateLabel}` : ''}, but didn't get to see you.`,
      "No worries at all. Life happens. If that time didn't work out, you can pick a new one that suits you better. We'd love to get you back in.",
    ],
    cta: bookingUrl ? { label: 'Reschedule your visit', url: bookingUrl } : undefined,
    note: `Wrong about the missed visit? Just reply to this email and ${businessName} will sort it out.`,
    reason: `You're receiving this because you had a booking with ${businessName}.`,
    unsubscribeUrl,
  });
}

// ─── Stemfra → business owner: System-A billing (Stemfra brand) ───────────────
// System A = Stemfra billing its BUSINESS customers (build fee + monthly
// hosting). Stemfra-branded (NOT tenant). Provider-agnostic — the "how to pay"
// text is passed in, so switching Payoneer→Airwallex/Stripe is a copy change.

// Google/Atlassian style (Peter's call, 2026-07-13): a LEAN email — short body +
// a compact info box + the full invoice/receipt as an ATTACHED PDF. The itemized
// detail lives in the PDF (lib/invoicePdf.js), so the email body stays clean.

function platformInvoice({ businessName, greetingName, amountLabel, dueLabel, paymentInstructions, dashboardUrl, payUrl, hostedUrl, invoiceRef, payRef }) {
  const dash = dashboardUrl || `${CMS_URL}/billing`;
  return renderEmail({
    preheader: `Your Stemfra invoice: ${amountLabel}${dueLabel ? `, due ${dueLabel}` : ''}.`,
    eyebrow: 'Your invoice',
    heading: `Hi ${greetingName || 'there'},`,
    paragraphs: ['Thank you for entrusting us with your care. The full invoice accompanies this email as a PDF; a summary follows below.'],
    rows: [
      businessName ? { label: 'Account', value: businessName } : null,
      { label: 'Invoice', value: invoiceRef },
      // Recon R4: the bare 8-char code tenants include with the transfer so the
      // payment confirms automatically (fits USD bank memo limits).
      payRef ? { label: 'Payment reference', value: payRef } : null,
      dueLabel ? { label: 'Due by', value: dueLabel } : null,
    ],
    amount: { label: 'Amount due', value: amountLabel },
    bodyHtml: paymentInstructions ? quoteBlock(paymentInstructions, 'How to pay') : '',
    // Primary CTA priority: the canonical Airwallex hosted invoice ("View
    // invoice online", which becomes a card checkout once Airwallex Payments is
    // activated) → a provider hosted pay link → the CMS billing page. Ghost
    // secondary always goes to the account.
    cta: hostedUrl ? { label: 'View invoice online', url: hostedUrl }
      : payUrl ? { label: 'Settle invoice', url: payUrl }
      : { label: 'Settle invoice', url: dash },
    cta2: { label: 'View account', url: dash },
    // Card checkout is not live yet (we collect OUT_OF_BAND until Airwallex
    // Payments/KYB is approved); say "bank transfer" until then, flip back after.
    note: 'Payment is accepted securely by bank transfer. Should you prefer another arrangement, simply reply to this email.',
    reason: 'You are receiving this because you hold a Stemfra subscription.',
    footerLinks: BILLING_LINKS,
  });
}

function platformDunning({ businessName, greetingName, amountLabel, dueLabel, daysOverdue, paymentInstructions, dashboardUrl, payUrl, hostedUrl, invoiceRef }) {
  const dash = dashboardUrl || `${CMS_URL}/billing`;
  return renderEmail({
    preheader: `Reminder: your Stemfra invoice for ${amountLabel} is past due.`,
    eyebrow: 'Payment reminder',
    heading: `Hi ${greetingName || 'there'},`,
    paragraphs: [
      `A gentle reminder that your Stemfra invoice${businessName ? ` for ${businessName}` : ''} remains unpaid${dueLabel ? `. It was due ${dueLabel}` : ''}${daysOverdue ? ` (${daysOverdue} day${daysOverdue === 1 ? '' : 's'} ago)` : ''}. It accompanies this email again as a PDF.`,
      'Please settle it to keep your website online and avoid any interruption.',
    ],
    rows: [
      businessName ? { label: 'Account', value: businessName } : null,
      { label: 'Invoice', value: invoiceRef },
      dueLabel ? { label: 'Was due', value: dueLabel } : null,
    ],
    amount: { label: 'Amount due', value: amountLabel },
    bodyHtml: paymentInstructions ? quoteBlock(paymentInstructions, 'How to pay') : '',
    cta: hostedUrl ? { label: 'View invoice online', url: hostedUrl }
      : payUrl ? { label: 'Settle invoice', url: payUrl }
      : { label: 'Settle invoice', url: dash },
    cta2: { label: 'View account', url: dash },
    note: 'Already paid, or need more time? Simply reply to this email and we will sort it out.',
    reason: 'Payment reminder for your Stemfra subscription.',
    footerLinks: BILLING_LINKS,
  });
}

function platformReceipt({ businessName, amountLabel, paidLabel, dashboardUrl, invoiceRef }) {
  return renderEmail({
    preheader: `Payment received: ${amountLabel}. Thank you.`,
    eyebrow: 'Payment received',
    heading: 'Thank you.',
    paragraphs: [`We have received your payment${businessName ? ` for ${businessName}` : ''}. Your receipt accompanies this email as a PDF.`],
    rows: [
      businessName ? { label: 'Account', value: businessName } : null,
      { label: 'Receipt', value: invoiceRef },
      paidLabel ? { label: 'Date', value: paidLabel } : null,
    ],
    amount: { label: 'Amount paid', value: amountLabel },
    cta: { label: 'View account', url: dashboardUrl || `${CMS_URL}/billing/history` },
    note: 'A copy is attached as a PDF for your records.',
    reason: 'Keep this receipt for your records.',
    footerLinks: BILLING_LINKS,
  });
}

// Recon R4 (2026-08-11): a settled payment was recalled by the tenant's bank
// (ACH reversal) or the transfer never went through (rejection). The invoice is
// open again; this is the re-deposit ask. Firm but polite.
function platformPaymentReturned({ businessName, greetingName, amountLabel, invoiceRef, payRef, dashboardUrl, rejected }) {
  const dash = dashboardUrl || `${CMS_URL}/billing/invoices`;
  return renderEmail({
    preheader: rejected
      ? `Your transfer for invoice ${invoiceRef} did not go through.`
      : `Your bank returned the payment for invoice ${invoiceRef}.`,
    eyebrow: rejected ? 'Payment not received' : 'Payment returned',
    heading: `Hi ${greetingName || 'there'},`,
    paragraphs: [
      rejected
        ? `Your bank transfer for invoice ${invoiceRef}${businessName ? ` (${businessName})` : ''} did not go through, so the invoice is still open.`
        : `Your bank returned the transfer for invoice ${invoiceRef}${businessName ? ` (${businessName})` : ''}, so the invoice is open again.`,
      `Please send a fresh transfer for the exact invoice amount with the payment reference ${payRef}. The bank details are on the invoice and in your dashboard under Billing, Invoices. If this is unexpected, simply reply to this email and we will look into it together.`,
    ],
    rows: [
      businessName ? { label: 'Account', value: businessName } : null,
      { label: 'Invoice', value: invoiceRef },
      payRef ? { label: 'Payment reference', value: payRef } : null,
    ],
    amount: amountLabel ? { label: 'Amount due', value: amountLabel } : null,
    cta: { label: 'View invoice', url: dash },
    note: 'Transfer fees are not part of your invoice; choose the option where you as the sender cover them.',
    reason: 'A payment on one of your Stemfra invoices did not complete.',
    footerLinks: BILLING_LINKS,
  });
}

// Recon R3 (2026-08-11): staff ask a tenant for a payment receipt on a specific
// invoice (dispute resolution, or the payment provider requests evidence).
// Receipts are no longer part of the normal flow; this is the polite extra step.
function platformReceiptRequest({ businessName, greetingName, amountLabel, invoiceRef, dashboardUrl }) {
  const dash = dashboardUrl || `${CMS_URL}/billing/invoices`;
  return renderEmail({
    preheader: `A quick favor: your payment receipt for invoice ${invoiceRef}.`,
    eyebrow: 'Receipt requested',
    heading: `Hi ${greetingName || 'there'},`,
    paragraphs: [
      `To help us verify your payment for invoice ${invoiceRef}${businessName ? ` (${businessName})` : ''}, could you share the transfer receipt from your bank? It speeds up confirmation on our side.`,
      'You can upload it in your dashboard under Billing, Invoices. A photo or PDF from your banking app works perfectly.',
    ],
    rows: [
      businessName ? { label: 'Account', value: businessName } : null,
      { label: 'Invoice', value: invoiceRef },
      amountLabel ? { label: 'Amount', value: amountLabel } : null,
    ],
    cta: { label: 'Upload receipt', url: dash },
    note: 'Already sent it, or have a question? Simply reply to this email.',
    reason: 'We asked for a payment receipt on one of your Stemfra invoices.',
    footerLinks: BILLING_LINKS,
  });
}

// ─── Stemfra → staff ──────────────────────────────────────────────────────────

// Stacy handoff request.
function staffHandoffNotification({ siteLabel, ownerEmail, message, reply }) {
  return renderEmail({
    preheader: `${siteLabel} asked to talk to a human.`,
    eyebrow: 'Staff alert',
    heading: 'A CMS owner asked for a human',
    paragraphs: [`Site: ${siteLabel}`, `Owner: ${ownerEmail || 'unknown'}`],
    bodyHtml: quoteBlock(message, 'What they said') + (reply ? quoteBlock(reply, 'Stacy replied') : ''),
    note: 'Reply-to is set to the owner. Just hit reply to follow up.',
    reason: 'Stacy handoff notification for Stemfra staff.',
  });
}

// Warm recap to a sales lead after a good voice call (Phase 1 "same-agent
// follow-up"). Reply-to is Mark's outreach inbox (the reply sweeper watches it).
function voiceRecapEmail({ firstName, planDiscussed, summary }) {
  return renderEmail({
    preheader: 'Thank you for taking my call. Everything we spoke about, in one place.',
    eyebrow: 'Great speaking with you',
    heading: `Hi ${firstName || 'there'},`,
    paragraphs: [
      'Thank you for taking my call today. As promised, everything lives at stemfra.com. You can preview your website free before paying anything.',
      planDiscussed ? `We spoke about the ${planDiscussed} plan. Happy to answer anything else about it.` : '',
      summary ? `My notes from our call: ${summary}` : '',
    ].filter(Boolean),
    cta: { label: 'Visit stemfra.com', url: 'https://stemfra.com' },
    note: 'Just reply to this email. It comes straight to the team.',
    reason: 'You are receiving this because we spoke on the phone today.',
  });
}

// Voice agent took a SUPPORT call from an (apparent) existing customer — routed
// to the support inbox instead of the sales-leads pipeline (VOICE_AGENT.md
// Phase 0). Reply-to should be set to the caller's email when known.
function staffVoiceSupportNotification({ callerName, callerEmail, callerPhone, issue, summary, transcript }) {
  return renderEmail({
    preheader: `${callerName || 'A caller'} needs support${issue ? `: ${issue}` : ''}.`,
    eyebrow: 'Support call',
    heading: 'A customer called for support',
    paragraphs: ['The voice agent took a support call from an existing customer. Please follow up by email today. The agent promised them a same-day reply.'],
    rows: [
      { label: 'Caller', value: callerName || '(no name given)' },
      { label: 'Phone', value: callerPhone || '(unknown)' },
      { label: 'Email', value: callerEmail || '(not captured)' },
      issue ? { label: 'Issue', value: issue } : null,
    ],
    bodyHtml:
      (summary ? quoteBlock(summary, 'Summary') : '') +
      (transcript ? quoteBlock(transcript, 'Transcript') : ''),
    note: callerEmail ? 'Reply-to is set to the caller. Just hit reply.' : 'No email was captured. Call them back on the number above.',
    reason: 'Support-call notification for Stemfra staff, captured by Stemfra Voice.',
  });
}

// Stripe orphan-payment backstop alert.
function staffOrphanPaymentAlert({ amountLabel, paymentIntentId, siteId }) {
  return renderEmail({
    preheader: 'A payment succeeded with no matching booking.',
    eyebrow: 'Staff alert',
    heading: 'Orphan payment needs reconciling',
    paragraphs: ['A Stripe payment succeeded but no booking carries its PaymentIntent. The customer likely paid and dropped before the booking write. Reconcile manually.'],
    rows: [
      { label: 'Amount', value: amountLabel, bold: true },
      { label: 'PaymentIntent', value: paymentIntentId },
      siteId ? { label: 'Site', value: siteId } : null,
    ],
    reason: 'Stripe webhook backstop alert for Stemfra staff.',
  });
}

// ─── Prospecting: "Claim your website" (launch task #1/#2 design, 2026-08-18) ─
// The FIRST touch of the 3-contact sequence, in the Bentley brochure register:
// logo band → the vertical's hero-fold mockup → centered headline with the
// business name → one CTA (Claim) → two short lines. Touch 2 is the SAME asset
// with a nudge subject + a ghost "See it live" CTA (Bentley's "Enquire to buy").
// Sent as mark@stemfra.com; the sequencer supplies claimUrl (signed lead token)
// and unsubscribeUrl. Plain-text alternative built by the caller from `text`.
function prospectClaimEmail({ touch = 1, firstName, businessName, verticalLabel = 'business', heroImageUrl, claimUrl, demoUrl, unsubscribeUrl, senderName = 'Mark', bonusLine }) {
  const first = touch === 1;
  const who = firstName || businessName;
  const subject = first
    ? `${businessName}, this website is for you`
    : `Did you forget your website, ${who}?`;
  // v3 (Peter, 2026-08-19): logo on white → hero image (clean edge) → headline
  // ("Built for you" / "Still yours, Marcus") → one line → "Take a look!" → CTA.
  const heading = first ? 'Built for you' : `Still yours, ${who}`;
  // Peter's copy (2026-08-19 v4): intro line → checkmark list (the pricing
  // page's "Offer" box register) → closing line → CTA → the 5% line as the
  // small note under the button.
  const SF = "'Helvetica Neue',Helvetica,Arial,sans-serif";
  const checkRow = (t) => `<tr><td style="padding:7px 0;font-family:${SF};font-size:15px;line-height:1.4;color:#211c18;text-align:left;"><span style="display:inline-block;width:24px;color:#8a8f8c;">&#10003;</span>${escapeHtml(t)}</td></tr>`;
  const checklist = (items) => `
    <table cellpadding="0" cellspacing="0" role="presentation" style="margin:22px auto 0;width:360px;max-width:100%;border:1px solid #211c18;"><tr><td style="padding:16px 26px;text-align:left;">
      <table cellpadding="0" cellspacing="0" role="presentation" style="margin:0;text-align:left;">${items.map(checkRow).join('')}</table>
    </td></tr></table>`;
  // Body copy reads LEFT-aligned (a letter, not a poster); `tight` = the second
  // line of the same paragraph (small gap), default = a new paragraph.
  const para = (t, tight = false) => `<p style="margin:${tight ? '6px' : '22px'} 0 0;font-family:${SF};font-weight:300;font-size:15px;line-height:1.75;color:#5a5f5c;text-align:center;">${escapeHtml(t)}</p>`;
  const features = ['Free hosting', 'Online booking', 'AI front desk', 'SMS and email alerts'];
  const bodyHtml = first
    ? para(`Hi ${firstName || 'there'}, we built a website for your business, ${businessName}. It is already set up for you, so you never miss a client.`)
      + checklist(features)
      + para('Click "Claim" if you need this website.')
    : para(`Hi ${firstName || 'there'}, your ${businessName} website is still yours to claim. It is already set up for you, so you never miss a client.`)
      + checklist(features)
      + para('Click "Claim" if you need this website.');
  const paragraphs = [];
  const note = 'We only earn 5% on the bookings it brings you.';
  const html = renderEmail({
    brand: { stemfra: true },
    headerStyle: 'light',
    align: 'center',
    heroImageUrl,
    heroImageAlt: `${businessName} website`,
    heroImageUrlHref: claimUrl,
    heading,
    preheader: first ? 'Free to claim, free to publish. We only earn when you do.' : 'Your website is still waiting to be claimed.',
    paragraphs,
    bodyHtml,
    note,
    cta: { label: 'Claim my website', url: claimUrl },
    cta2: first ? undefined : { label: 'See it live', url: demoUrl || claimUrl },
    reason: `You are receiving this because ${senderName} at Stemfra reached out to ${businessName}. Not for you? Unsubscribe below and we will not email again.`,
    unsubscribeUrl,
    footerLinks: [{ label: 'stemfra.com', url: 'https://stemfra.com' }, { label: 'Privacy', url: 'https://stemfra.com/privacy/' }, { label: 'Terms', url: 'https://stemfra.com/terms/' }],
  });
  const text = [heading, '', `Hi ${firstName || 'there'}, we built a website for your business, ${businessName}. It is already set up for you, so you never miss a client.`, '', ...features.map((f) => `- ${f}`), '', 'Click "Claim" if you need this website.', '', `Claim my website: ${claimUrl}`, note, ...(first ? [] : [`See it live: ${demoUrl || claimUrl}`]), '', `Unsubscribe: ${unsubscribeUrl}`].join('\n');
  return { subject, html, text };
}

module.exports = {
  prospectClaimEmail,
  bookingConfirmation,
  bookingReminder,
  bookingCanceled,
  bookingRescheduled,
  ownerBookingNotification,
  classConfirmation,
  visitConfirmation,
  ownerLeadNotification,
  ownerChatLeadNotification,
  ownerMembershipSignup,
  ownerRenewalDigest,
  membershipActivated,
  membershipRenewed,
  membershipRenewalReminder,
  firstVisitFollowup,
  winBack,
  reviewRequest,
  birthdayGreeting,
  anniversaryGreeting,
  noShowFollowup,
  platformInvoice,
  platformDunning,
  platformReceipt,
  platformReceiptRequest,
  platformPaymentReturned,
  staffHandoffNotification,
  staffOrphanPaymentAlert,
  staffVoiceSupportNotification,
  voiceRecapEmail,
};
