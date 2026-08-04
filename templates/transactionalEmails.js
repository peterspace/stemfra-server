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
  (percent > 0 ? discountBlock(`${lead} — enjoy ${percent}% off your next visit. Just mention this email when you book.`) : '');

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
function bookingConfirmation({ businessName, businessLogoUrl, businessEmail, businessUrl, businessAccent, businessFont, businessPhotoUrl, overrideHeading, overrideSubheading, firstName, serviceName, dateLabel, timeLabel, durationLabel }) {
  return renderEmail({
    brand: { name: businessName, logoUrl: businessLogoUrl, url: businessUrl, accent: businessAccent, font: businessFont, photoUrl: businessPhotoUrl },
    preheader: `${dateLabel} at ${timeLabel} — see you then.`,
    heading: overrideHeading || (firstName ? `You're booked, ${firstName}.` : "You're booked."),
    paragraphs: [overrideSubheading || 'Your appointment is confirmed — here are the details:'],
    rows: [
      { label: 'Service', value: serviceName },
      { label: 'Date', value: dateLabel },
      { label: 'Time', value: timeLabel },
      durationLabel ? { label: 'Duration', value: durationLabel } : null,
    ],
    note: `Need to change or cancel? Just reply to this email and ${businessName} will sort it out.`,
    security: tenantSecurityLine(businessName, businessEmail),
    reason: `You're receiving this because you booked an appointment with ${businessName}.`,
  });
}

// Class / group-session booking confirmation.
function classConfirmation({ businessName, businessLogoUrl, businessEmail, businessUrl, businessAccent, businessFont, businessPhotoUrl, serviceName, dateLabel, timeLabel }) {
  return renderEmail({
    brand: { name: businessName, logoUrl: businessLogoUrl, url: businessUrl, accent: businessAccent, font: businessFont, photoUrl: businessPhotoUrl },
    preheader: `${dateLabel} at ${timeLabel} — see you in class.`,
    heading: "You're booked in.",
    paragraphs: ['Your spot is confirmed — here are the details:'],
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
function bookingCancelled({ businessName, businessLogoUrl, businessEmail, businessUrl, businessAccent, businessFont, businessPhotoUrl, firstName, serviceName, dateLabel, timeLabel, cancelledByBusiness }) {
  return renderEmail({
    brand: { name: businessName, logoUrl: businessLogoUrl, url: businessUrl, accent: businessAccent, font: businessFont, photoUrl: businessPhotoUrl },
    preheader: `Your ${dateLabel} booking has been cancelled.`,
    heading: 'Your booking has been cancelled.',
    paragraphs: [
      cancelledByBusiness
        ? `${businessName} had to cancel the following booking — sorry about the change of plans:`
        : `${firstName ? `Hi ${firstName} — this` : 'This'} confirms your cancellation:`,
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
    paragraphs: [`${firstName ? `Hi ${firstName} — your` : 'Your'} booking has been rescheduled. The new details:`],
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
  const cancelled = event === 'cancelled';
  const rescheduled = event === 'rescheduled';
  const who = customerName || 'A customer';
  return renderEmail({
    preheader: cancelled ? `${who} cancelled their booking.` : rescheduled ? `${who} rescheduled their booking.` : `${who} just booked.`,
    eyebrow: cancelled ? 'Booking cancelled' : rescheduled ? 'Booking rescheduled' : 'New booking',
    heading: cancelled ? 'A booking was cancelled' : rescheduled ? 'A booking was rescheduled' : 'You have a new booking',
    paragraphs: [cancelled ? 'A booking on your calendar was cancelled:' : rescheduled ? 'A booking on your calendar moved to a new time:' : 'A new booking just landed on your calendar:'],
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
    note: 'Fast replies win customers — most enquiries go to whoever answers first.',
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

// ─── Lifecycle (N4): tenant → visitor ─────────────────────────────────────────

// First-visit follow-up — ~a day after a customer's first appointment. Warm
// thanks + a nudge to rebook. Opt-out honored (carries the unsubscribe link).
function firstVisitFollowup({ businessName, businessLogoUrl, businessEmail, businessUrl, businessAccent, businessFont, businessPhotoUrl, firstName, serviceName, bookingUrl, unsubscribeUrl, discountPercent }) {
  return renderEmail({
    brand: { name: businessName, logoUrl: businessLogoUrl, url: businessUrl, accent: businessAccent, font: businessFont, photoUrl: businessPhotoUrl },
    preheader: `Thanks for visiting ${businessName} — we'd love to see you again.`,
    heading: firstName ? `Thanks for coming in, ${firstName}.` : 'Thanks for coming in.',
    paragraphs: [
      `We hope you enjoyed your ${serviceName ? serviceName.toLowerCase() : 'visit'} at ${businessName}.`,
      "It was great having you — whenever you're ready for your next visit, we'd love to welcome you back.",
    ],
    bodyHtml: discountLine(discountPercent, 'A little thank-you for your first visit'),
    cta: bookingUrl ? { label: 'Book your next visit', url: bookingUrl } : undefined,
    note: `Questions or feedback? Just reply to this email — ${businessName} reads every one.`,
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
      `Thanks again for choosing ${businessName}${serviceName ? ` for your ${serviceName.toLowerCase()}` : ''} — we hope it was everything you wanted.`,
      primary
        ? "If you have a moment, a quick review means the world to a small business like ours — and it helps others find us."
        : "We'd love to hear how it went. Just reply to this email and let us know — good or bad, we read every note.",
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
      "We'd love to help you treat yourself — book a visit whenever you're ready.",
    ],
    bodyHtml: discountLine(discountPercent, 'Your birthday gift'),
    cta: bookingUrl ? { label: 'Book a visit', url: bookingUrl } : undefined,
    note: 'Warm wishes from all of us — hope to see you soon.',
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
      `It's been a year since your first visit to ${businessName} — thank you for being part of our community.`,
      "We've loved having you, and we're looking forward to many more visits ahead.",
    ],
    bodyHtml: discountLine(discountPercent, 'To celebrate a year together'),
    cta: bookingUrl ? { label: 'Book your next visit', url: bookingUrl } : undefined,
    note: `Thanks for a wonderful year — from all of us at ${businessName}.`,
    reason: `You're receiving this because you first visited ${businessName} a year ago.`,
    unsubscribeUrl,
  });
}

// No-show follow-up — sent when the owner marks a booking as a no-show. A warm,
// no-guilt "we missed you, let's rebook". Opt-out honored.
function noShowFollowup({ businessName, businessLogoUrl, businessUrl, businessAccent, businessFont, businessPhotoUrl, firstName, serviceName, dateLabel, bookingUrl, unsubscribeUrl }) {
  return renderEmail({
    brand: { name: businessName, logoUrl: businessLogoUrl, url: businessUrl, accent: businessAccent, font: businessFont, photoUrl: businessPhotoUrl },
    preheader: `We missed you at ${businessName} — let's find a new time.`,
    heading: firstName ? `Sorry we missed you, ${firstName}.` : 'Sorry we missed you.',
    paragraphs: [
      `We had you down for ${serviceName ? serviceName.toLowerCase() : 'a visit'}${dateLabel ? ` on ${dateLabel}` : ''}, but didn't get to see you.`,
      "No worries at all — life happens. Whenever you're ready, we'd love to get you back in.",
    ],
    cta: bookingUrl ? { label: 'Rebook your visit', url: bookingUrl } : undefined,
    note: `Questions? Just reply to this email — ${businessName} is happy to help.`,
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

function platformInvoice({ businessName, greetingName, amountLabel, dueLabel, paymentInstructions, dashboardUrl, payUrl, invoiceRef }) {
  const dash = dashboardUrl || `${CMS_URL}/billing`;
  return renderEmail({
    preheader: `Your Stemfra invoice — ${amountLabel}${dueLabel ? `, due ${dueLabel}` : ''}.`,
    eyebrow: 'Your invoice',
    heading: `Hi ${greetingName || 'there'},`,
    paragraphs: ['Thank you for entrusting us with your care. The full invoice accompanies this email as a PDF; a summary follows below.'],
    rows: [
      businessName ? { label: 'Account', value: businessName } : null,
      { label: 'Invoice', value: invoiceRef },
      dueLabel ? { label: 'Due by', value: dueLabel } : null,
    ],
    amount: { label: 'Amount due', value: amountLabel },
    bodyHtml: paymentInstructions ? quoteBlock(paymentInstructions, 'How to pay') : '',
    // Settle → the provider's hosted pay link when we have it; else the CMS
    // billing page. Ghost secondary always goes to the account.
    cta: payUrl ? { label: 'Settle invoice', url: payUrl } : { label: 'Settle invoice', url: dash },
    cta2: { label: 'View account', url: dash },
    note: 'Payment is accepted securely by card or bank transfer. Should you prefer another arrangement, simply reply to this email.',
    reason: 'You are receiving this because you hold a Stemfra subscription.',
    footerLinks: BILLING_LINKS,
  });
}

function platformDunning({ businessName, greetingName, amountLabel, dueLabel, daysOverdue, paymentInstructions, dashboardUrl, payUrl, invoiceRef }) {
  const dash = dashboardUrl || `${CMS_URL}/billing`;
  return renderEmail({
    preheader: `Reminder: your Stemfra invoice for ${amountLabel} is past due.`,
    eyebrow: 'Payment reminder',
    heading: `Hi ${greetingName || 'there'},`,
    paragraphs: [
      `A gentle reminder that your Stemfra invoice${businessName ? ` for ${businessName}` : ''} remains unpaid${dueLabel ? ` — it was due ${dueLabel}` : ''}${daysOverdue ? ` (${daysOverdue} day${daysOverdue === 1 ? '' : 's'} ago)` : ''}. It accompanies this email again as a PDF.`,
      'Please settle it to keep your website online and avoid any interruption.',
    ],
    rows: [
      businessName ? { label: 'Account', value: businessName } : null,
      { label: 'Invoice', value: invoiceRef },
      dueLabel ? { label: 'Was due', value: dueLabel } : null,
    ],
    amount: { label: 'Amount due', value: amountLabel },
    bodyHtml: paymentInstructions ? quoteBlock(paymentInstructions, 'How to pay') : '',
    cta: payUrl ? { label: 'Settle invoice', url: payUrl } : { label: 'Settle invoice', url: dash },
    cta2: { label: 'View account', url: dash },
    note: 'Already paid, or need more time? Simply reply to this email and we will sort it out.',
    reason: 'Payment reminder for your Stemfra subscription.',
    footerLinks: BILLING_LINKS,
  });
}

function platformReceipt({ businessName, amountLabel, paidLabel, dashboardUrl, invoiceRef }) {
  return renderEmail({
    preheader: `Payment received — ${amountLabel}. Thank you.`,
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

// ─── Stemfra → staff ──────────────────────────────────────────────────────────

// Stacy handoff request.
function staffHandoffNotification({ siteLabel, ownerEmail, message, reply }) {
  return renderEmail({
    preheader: `${siteLabel} asked to talk to a human.`,
    eyebrow: 'Staff alert',
    heading: 'A CMS owner asked for a human',
    paragraphs: [`Site: ${siteLabel}`, `Owner: ${ownerEmail || 'unknown'}`],
    bodyHtml: quoteBlock(message, 'What they said') + (reply ? quoteBlock(reply, 'Stacy replied') : ''),
    note: 'Reply-to is set to the owner — just hit reply to follow up.',
    reason: 'Stacy handoff notification for Stemfra staff.',
  });
}

// Warm recap to a sales lead after a good voice call (Phase 1 "same-agent
// follow-up"). Reply-to is Mark's outreach inbox (the reply sweeper watches it).
function voiceRecapEmail({ firstName, planDiscussed, summary }) {
  return renderEmail({
    preheader: 'Thank you for taking my call — everything we spoke about, in one place.',
    eyebrow: 'Great speaking with you',
    heading: `Hi ${firstName || 'there'},`,
    paragraphs: [
      'Thank you for taking my call today. As promised, everything lives at stemfra.com — you can preview your website free before paying anything.',
      planDiscussed ? `We spoke about the ${planDiscussed} plan — happy to answer anything else about it.` : '',
      summary ? `My notes from our call: ${summary}` : '',
    ].filter(Boolean),
    cta: { label: 'Visit stemfra.com', url: 'https://stemfra.com' },
    note: 'Just reply to this email — it comes straight to the team.',
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
    paragraphs: ['The voice agent took a support call from an existing customer. Please follow up by email today — the agent promised them a same-day reply.'],
    rows: [
      { label: 'Caller', value: callerName || '(no name given)' },
      { label: 'Phone', value: callerPhone || '(unknown)' },
      { label: 'Email', value: callerEmail || '(not captured)' },
      issue ? { label: 'Issue', value: issue } : null,
    ],
    bodyHtml:
      (summary ? quoteBlock(summary, 'Summary') : '') +
      (transcript ? quoteBlock(transcript, 'Transcript') : ''),
    note: callerEmail ? 'Reply-to is set to the caller — just hit reply.' : 'No email was captured — call them back on the number above.',
    reason: 'Support-call notification for Stemfra staff, captured by Stemfra Voice.',
  });
}

// Stripe orphan-payment backstop alert.
function staffOrphanPaymentAlert({ amountLabel, paymentIntentId, siteId }) {
  return renderEmail({
    preheader: 'A payment succeeded with no matching booking.',
    eyebrow: 'Staff alert',
    heading: 'Orphan payment needs reconciling',
    paragraphs: ['A Stripe payment succeeded but no booking carries its PaymentIntent — the customer likely paid and dropped before the booking write. Reconcile manually.'],
    rows: [
      { label: 'Amount', value: amountLabel, bold: true },
      { label: 'PaymentIntent', value: paymentIntentId },
      siteId ? { label: 'Site', value: siteId } : null,
    ],
    reason: 'Stripe webhook backstop alert for Stemfra staff.',
  });
}

module.exports = {
  bookingConfirmation,
  bookingReminder,
  bookingCancelled,
  bookingRescheduled,
  ownerBookingNotification,
  classConfirmation,
  visitConfirmation,
  ownerLeadNotification,
  ownerChatLeadNotification,
  firstVisitFollowup,
  winBack,
  reviewRequest,
  birthdayGreeting,
  anniversaryGreeting,
  noShowFollowup,
  platformInvoice,
  platformDunning,
  platformReceipt,
  staffHandoffNotification,
  staffOrphanPaymentAlert,
  staffVoiceSupportNotification,
  voiceRecapEmail,
};
