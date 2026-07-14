// Dev-only email-preview routes. Mounted in index.js when NODE_ENV !== 'production'.
const express = require('express');
const router  = express.Router();

const buildNotificationEmail = require('../templates/notificationEmail');
const buildConfirmationEmail = require('../templates/confirmationEmail');
const tx = require('../templates/transactionalEmails');
const authEmails = require('../templates/authEmails');
// A real tenant (Argyle & Sons) logo + site for the tenant-email previews.
const ARGYLE_LOGO = 'https://res.cloudinary.com/dvdbec2fe/image/upload/v1783521064/argyle-and-sons/logo-mark.webp';
const ARGYLE_URL = 'https://argyle-and-sons.stemfra.com';

const SUBJECTS = ['AI Automation', 'Software Development', 'Consultancy', 'Support', 'General'];

const sample = {
  firstName: 'Ada',
  lastName:  'Lovelace',
  email:     'ada@analyticalengine.io',
  company:   'Analytical Engine Co.',
  message:   "Hi STEMfra,\n\nWe'd like to automate our weekly client reporting. We currently spend ~6 hours every Friday assembling spreadsheets from 3 different tools. Could you walk us through what a discovery call would cover, and a rough timeline?\n\nThanks,\nAda",
  createdAt: new Date().toISOString(),
};

function indexPage() {
  const txLinks = [
    ['booking-confirmation', 'Booking confirmation (tenant brand)'],
    ['class-confirmation', 'Class confirmation (tenant brand)'],
    ['visit-confirmation', 'Salon visit — multi-service (tenant brand)'],
    ['booking-reminder', 'Booking reminder — 24h (tenant brand)'],
    ['booking-cancelled', 'Booking cancelled (tenant brand)'],
    ['booking-rescheduled', 'Booking rescheduled (tenant brand)'],
    ['owner-new-booking', 'Owner: new booking'],
    ['first-visit-followup', 'Lifecycle: first-visit follow-up (tenant brand)'],
    ['review-request', 'Lifecycle: review ask — with review link (tenant brand)'],
    ['review-request-noreview', 'Lifecycle: review ask — reply-only fallback (tenant brand)'],
    ['birthday', 'Lifecycle: birthday — with offer (tenant brand)'],
    ['birthday-nooffer', 'Lifecycle: birthday — no offer (tenant brand)'],
    ['anniversary', 'Lifecycle: first-visit anniversary (tenant brand)'],
    ['no-show-followup', 'Lifecycle: no-show follow-up (tenant brand)'],
    ['win-back', 'Lifecycle: win-back (tenant brand)'],
    ['auth-confirm-signup', 'Supabase auth: confirm signup (Stemfra)'],
    ['auth-magic-link', 'Supabase auth: magic sign-in link (Stemfra)'],
    ['auth-reset-password', 'Supabase auth: reset password (Stemfra)'],
    ['auth-change-email', 'Supabase auth: confirm new email (Stemfra)'],
    ['platform-invoice', 'Billing: Stemfra invoice (System A)'],
    ['platform-dunning', 'Billing: payment reminder / overdue (System A)'],
    ['platform-receipt', 'Billing: payment receipt (System A)'],
    ['owner-lead', 'Owner: new website lead'],
    ['owner-chat-lead', 'Owner: chat-assistant lead'],
    ['staff-handoff', 'Staff: Stacy handoff'],
    ['staff-orphan', 'Staff: orphan payment alert'],
  ].map(([k, label]) => `<li><a href="/dev/preview/${k}">${label}</a></li>`).join('');
  const links = txLinks + SUBJECTS.flatMap((s) => [
    `<li><a href="/dev/preview/notification?subject=${encodeURIComponent(s)}">Notification — ${s}</a></li>`,
    `<li><a href="/dev/preview/confirmation?subject=${encodeURIComponent(s)}">Confirmation — ${s}</a></li>`,
  ]).join('');
  return `<!doctype html>
<html><head><title>STEMfra email previews</title>
<style>body{font-family:Inter,system-ui,sans-serif;max-width:640px;margin:60px auto;padding:0 24px;color:#111}
h1{font-weight:700;letter-spacing:-.5px}ul{list-style:none;padding:0}
li{padding:10px 0;border-bottom:1px solid #eee}a{color:#0f0f0f;text-decoration:none}
a:hover{text-decoration:underline}small{color:#6b7280}</style></head>
<body><h1>Email previews</h1>
<small>Sample: ${sample.firstName} ${sample.lastName} · ${sample.email}</small>
<ul>${links}</ul></body></html>`;
}

router.get('/', (req, res) => {
  res.set('Content-Type', 'text/html').send(indexPage());
});

router.get('/notification', (req, res) => {
  const subject = SUBJECTS.includes(req.query.subject) ? req.query.subject : 'AI Automation';
  const { html } = buildNotificationEmail({ ...sample, subject });
  res.set('Content-Type', 'text/html').send(html);
});

router.get('/confirmation', (req, res) => {
  const subject = SUBJECTS.includes(req.query.subject) ? req.query.subject : 'AI Automation';
  const { html } = buildConfirmationEmail({
    firstName: sample.firstName,
    subject,
    message: sample.message,
  });
  res.set('Content-Type', 'text/html').send(html);
});

// ─── Transactional variants (Case 9 unified base) ────────────────────────────
const send = (res, html) => res.set('Content-Type', 'text/html').send(html);

router.get('/booking-confirmation', (_req, res) => send(res, tx.bookingConfirmation({
  businessName: 'Argyle & Sons', businessLogoUrl: ARGYLE_LOGO, businessUrl: ARGYLE_URL, businessEmail: 'hello@argyle-and-sons.com', firstName: 'James', serviceName: 'Classic Cut & Hot Towel',
  dateLabel: 'Friday, July 17', timeLabel: '2:30 PM', durationLabel: '45 min',
})));

router.get('/class-confirmation', (_req, res) => send(res, tx.classConfirmation({
  businessName: 'Lila Studio', businessLogoUrl: ARGYLE_LOGO, businessEmail: 'hello@lila-studio.com', serviceName: 'Vinyasa Flow',
  dateLabel: 'Saturday, July 18', timeLabel: '9:00 AM',
})));

// ─── N1 booking lifecycle (booking reminder / cancel / reschedule / owner) ───
router.get('/booking-reminder', (_req, res) => send(res, tx.bookingReminder({
  businessName: 'Argyle & Sons', businessEmail: 'hello@argyle-and-sons.com', firstName: 'James',
  serviceName: 'Classic Cut & Hot Towel', dateLabel: 'Friday, July 17', timeLabel: '2:30 PM', isClass: false,
  unsubscribeUrl: 'https://api.stemfra.com/api/site-emails/unsubscribe?token=sample',
})));

router.get('/booking-cancelled', (_req, res) => send(res, tx.bookingCancelled({
  businessName: 'Argyle & Sons', businessEmail: 'hello@argyle-and-sons.com', firstName: 'James',
  serviceName: 'Classic Cut & Hot Towel', dateLabel: 'Friday, July 17', timeLabel: '2:30 PM',
  cancelledByBusiness: true,
})));

router.get('/booking-rescheduled', (_req, res) => send(res, tx.bookingRescheduled({
  businessName: 'Zen Haven', businessEmail: 'hello@zen-haven.com', firstName: 'Maya',
  serviceName: 'Hot Stone Massage', dateLabel: 'Saturday, July 18', timeLabel: '11:00 AM',
  oldDateLabel: 'Friday, July 17', oldTimeLabel: '2:30 PM',
})));

router.get('/owner-new-booking', (_req, res) => send(res, tx.ownerBookingNotification({
  event: 'new', businessName: 'Argyle & Sons', customerName: 'James Whitfield',
  customerEmail: 'james@example.com', customerPhone: '(212) 555-0138',
  serviceName: 'Classic Cut & Hot Towel', dateLabel: 'Friday, July 17', timeLabel: '2:30 PM',
})));

router.get('/visit-confirmation', (_req, res) => send(res, tx.visitConfirmation({
  businessName: 'Maison Lune', dateLabel: 'Friday, July 17',
  items: [
    { time: '1:00 PM', service: 'Balayage · $180' },
    { time: '3:00 PM', service: 'Cut & Style · $85' },
    { time: '4:00 PM', service: 'Gel Manicure · $55' },
  ],
  totalLabel: '$320',
  failureNote: null,
})));

router.get('/owner-lead', (_req, res) => send(res, tx.ownerLeadNotification({
  name: 'Dana Whitfield', email: 'dana@example.com', phone: '(917) 555-0184',
  subject: 'Wedding party booking',
  message: "Hi — I'm getting married in September and would love to book your shop for a groom + 5 groomsmen morning. Do you do private group bookings?",
})));

router.get('/owner-chat-lead', (_req, res) => send(res, tx.ownerChatLeadNotification({
  name: 'Marcus Lee', email: 'marcus@example.com', phone: null,
  intent: 'First-visit deep tissue massage',
  summary: 'Asked about deep tissue availability this weekend, pricing for 90 minutes, and whether you take walk-ins. Left his email for a follow-up.',
})));

router.get('/first-visit-followup', (_req, res) => send(res, tx.firstVisitFollowup({
  businessName: 'Argyle & Sons', businessLogoUrl: ARGYLE_LOGO,
  businessEmail: 'hello@argyle-and-sons.com', businessUrl: ARGYLE_URL, firstName: 'James', serviceName: 'Classic Cut & Hot Towel',
  bookingUrl: 'https://argyle-and-sons.stemfra.com/book',
  unsubscribeUrl: 'https://api.stemfra.com/api/site-emails/unsubscribe?token=demo',
})));

router.get('/review-request', (_req, res) => send(res, tx.reviewRequest({
  businessName: 'Argyle & Sons', businessLogoUrl: ARGYLE_LOGO,
  businessEmail: 'hello@argyle-and-sons.com', businessUrl: ARGYLE_URL, firstName: 'James',
  serviceName: 'Classic Cut & Hot Towel',
  reviewUrl: 'https://g.page/r/argyle-and-sons/review',
  bookingUrl: 'https://argyle-and-sons.stemfra.com/book',
  unsubscribeUrl: 'https://api.stemfra.com/api/site-emails/unsubscribe?token=demo',
})));

router.get('/review-request-noreview', (_req, res) => send(res, tx.reviewRequest({
  businessName: 'Argyle & Sons', businessLogoUrl: ARGYLE_LOGO,
  businessEmail: 'hello@argyle-and-sons.com', businessUrl: ARGYLE_URL, firstName: 'James',
  serviceName: 'Classic Cut & Hot Towel',
  reviewUrl: null,
  bookingUrl: 'https://argyle-and-sons.stemfra.com/book',
  unsubscribeUrl: 'https://api.stemfra.com/api/site-emails/unsubscribe?token=demo',
})));

router.get('/birthday', (_req, res) => send(res, tx.birthdayGreeting({
  businessName: 'Argyle & Sons', businessLogoUrl: ARGYLE_LOGO, businessUrl: ARGYLE_URL,
  firstName: 'James', discountPercent: 15,
  bookingUrl: 'https://argyle-and-sons.stemfra.com/book',
  unsubscribeUrl: 'https://api.stemfra.com/api/site-emails/unsubscribe?token=demo',
})));

router.get('/birthday-nooffer', (_req, res) => send(res, tx.birthdayGreeting({
  businessName: 'Argyle & Sons', businessLogoUrl: ARGYLE_LOGO, businessUrl: ARGYLE_URL,
  firstName: 'James', discountPercent: 0,
  bookingUrl: 'https://argyle-and-sons.stemfra.com/book',
  unsubscribeUrl: 'https://api.stemfra.com/api/site-emails/unsubscribe?token=demo',
})));

router.get('/anniversary', (_req, res) => send(res, tx.anniversaryGreeting({
  businessName: 'Argyle & Sons', businessLogoUrl: ARGYLE_LOGO, businessUrl: ARGYLE_URL,
  firstName: 'James',
  bookingUrl: 'https://argyle-and-sons.stemfra.com/book',
  unsubscribeUrl: 'https://api.stemfra.com/api/site-emails/unsubscribe?token=demo',
})));

router.get('/no-show-followup', (_req, res) => send(res, tx.noShowFollowup({
  businessName: 'Argyle & Sons', businessLogoUrl: ARGYLE_LOGO, businessUrl: ARGYLE_URL,
  firstName: 'James', serviceName: 'Classic Cut & Hot Towel', dateLabel: 'Friday, July 17',
  bookingUrl: 'https://argyle-and-sons.stemfra.com/book',
  unsubscribeUrl: 'https://api.stemfra.com/api/site-emails/unsubscribe?token=demo',
})));

router.get('/win-back', (_req, res) => send(res, tx.winBack({
  businessName: 'Argyle & Sons', businessLogoUrl: ARGYLE_LOGO,
  businessEmail: 'hello@argyle-and-sons.com', businessUrl: ARGYLE_URL, firstName: 'James',
  bookingUrl: 'https://argyle-and-sons.stemfra.com/book',
  unsubscribeUrl: 'https://api.stemfra.com/api/site-emails/unsubscribe?token=demo',
})));

// ─── Supabase auth emails (Stemfra brand; {{ .ConfirmationURL }} stays raw) ────
router.get('/auth-confirm-signup', (_req, res) => send(res, authEmails.confirmSignup().html));
router.get('/auth-magic-link', (_req, res) => send(res, authEmails.magicLink().html));
router.get('/auth-reset-password', (_req, res) => send(res, authEmails.resetPassword().html));
router.get('/auth-change-email', (_req, res) => send(res, authEmails.changeEmail().html));

// ─── System-A billing (Stemfra brand) ────────────────────────────────────────
router.get('/platform-invoice', (_req, res) => send(res, tx.platformInvoice({
  businessName: 'Argyle & Sons', greetingName: 'Marcus',
  rows: [{ label: 'Website setup (one-time)', value: '$1,000.00' }, { label: 'Growth plan — first month', value: '$199.00' }],
  amountLabel: '$1,199.00', dueLabel: 'July 20, 2025',
  paymentInstructions: 'Click Pay now above to pay securely via Payoneer — card or bank transfer. Prefer another method? Just reply to this email.',
  dashboardUrl: 'https://cms.stemfra.com/billing',
  payUrl: 'https://pay.payoneer.com/request/demo-a1b2c3d4',
  invoiceRef: 'a1b2c3d4',
})));

router.get('/platform-dunning', (_req, res) => send(res, tx.platformDunning({
  businessName: 'Argyle & Sons', greetingName: 'Marcus',
  rows: [{ label: 'Growth plan — Jul 2025', value: '$199.00' }],
  amountLabel: '$199.00', dueLabel: 'July 6, 2025', daysOverdue: 7,
  paymentInstructions: 'You’ll receive a secure Payoneer payment request at this email — open it to pay by card or bank transfer. Prefer another method? Just reply and we’ll arrange it.',
  dashboardUrl: 'https://cms.stemfra.com/billing', invoiceRef: 'a1b2c3d4',
})));

router.get('/platform-receipt', (_req, res) => send(res, tx.platformReceipt({
  businessName: 'Argyle & Sons', amountLabel: '$199.00', paidLabel: 'July 13, 2025',
  rows: [{ label: 'Growth plan — Jul 2025', value: '$199.00' }],
  dashboardUrl: 'https://cms.stemfra.com/billing/history', invoiceRef: 'a1b2c3d4',
})));

router.get('/staff-handoff', (_req, res) => send(res, tx.staffHandoffNotification({
  siteLabel: 'argyle-and-sons', ownerEmail: 'marcus@argyle-and-sons.com',
  message: 'How do I change the photo at the top of my services page? I tried but could not find it.',
  reply: "I've pointed you at Pages → Services → Services grid — but a teammate will follow up to walk you through it.",
})));

router.get('/staff-orphan', (_req, res) => send(res, tx.staffOrphanPaymentAlert({
  amountLabel: '$95.00', paymentIntentId: 'pi_3Nxy2EXAMPLE01', siteId: 'forge-and-bell',
})));

module.exports = router;
