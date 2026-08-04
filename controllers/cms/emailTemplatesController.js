// CMS "Email templates" preview (Case 2, item 3). Renders a tenant email variant
// with the site's REAL resolved brand (logo/accent/font/hero-photo) so an owner
// can preview and tune what their customers receive — plus LIVE overrides passed
// from the editor (a custom photo, a custom heading/subheading) before they save.
//
// Storage of the saved overrides is the CMS's job — it writes them to
// site_theme_settings.metadata.email (photo_url + headings.<variant>) via the
// existing theme-settings mutation. This endpoint only RENDERS; resolveTenantEmailBrand
// already reads those saved values back, so a saved override previews identically.
const { verifySiteOwnership } = require('../../middleware/cmsAuth');
const { resolveTenantEmailBrand, emailPhotoUrl } = require('../../lib/tenantEmailBrand');
const emails = require('../../templates/transactionalEmails');

// Sample data so every variant renders with lifelike content in the preview.
const S = {
  firstName: 'James',
  serviceName: 'Signature Cut & Style',
  className: 'Vinyasa Flow',
  dateLabel: 'Friday, July 24',
  timeLabel: '2:30 PM',
  durationLabel: '45 min',
};

// Map resolved brand → the businessX params every builder expects.
function brandArgs(b) {
  return {
    businessName: b.name || 'Your Business',
    businessLogoUrl: b.logoUrl,
    businessEmail: b.businessEmail,
    businessUrl: b.businessUrl,
    businessAccent: b.accent,
    businessFont: b.font,
    businessPhotoUrl: b.photoUrl,
  };
}

// The variants an owner can preview. `over` carries live editor overrides
// (heading/subheading) — only builders that accept them use them (booking_confirmation).
const VARIANTS = {
  booking_confirmation: (b, over) => emails.bookingConfirmation({
    ...brandArgs(b),
    overrideHeading: over.heading, overrideSubheading: over.subheading,
    firstName: S.firstName, serviceName: S.serviceName,
    dateLabel: S.dateLabel, timeLabel: S.timeLabel, durationLabel: S.durationLabel,
  }),
  class_confirmation: (b) => emails.classConfirmation({
    ...brandArgs(b), serviceName: S.className, dateLabel: S.dateLabel, timeLabel: '9:00 AM',
  }),
  booking_reminder: (b) => emails.bookingReminder({
    ...brandArgs(b), firstName: S.firstName, serviceName: S.serviceName,
    dateLabel: S.dateLabel, timeLabel: S.timeLabel, isClass: false,
  }),
  booking_cancelled: (b) => emails.bookingCancelled({
    ...brandArgs(b), firstName: S.firstName, serviceName: S.serviceName,
    dateLabel: S.dateLabel, timeLabel: S.timeLabel, cancelledByBusiness: true,
  }),
  review_request: (b) => emails.reviewRequest({
    ...brandArgs(b), firstName: S.firstName, serviceName: S.serviceName,
    // Google-only sample link (2026-08-04). Real link comes from Settings.
    reviewLinks: { google: b.businessUrl },
    bookingUrl: b.businessUrl,
  }),
  win_back: (b) => emails.winBack({
    ...brandArgs(b), firstName: S.firstName, bookingUrl: b.businessUrl,
  }),
};

// GET /api/cms/email-templates/variants — the pickable list (for the CMS UI).
function listVariants(req, res) {
  res.json({
    variants: [
      { key: 'booking_confirmation', label: 'Booking confirmation', editableHeading: true },
      { key: 'class_confirmation', label: 'Class confirmation', editableHeading: false },
      { key: 'booking_reminder', label: 'Appointment reminder', editableHeading: false },
      { key: 'booking_cancelled', label: 'Booking cancelled', editableHeading: false },
      { key: 'review_request', label: 'Review request', editableHeading: false },
      { key: 'win_back', label: 'We miss you', editableHeading: false },
    ],
  });
}

// GET /api/cms/email-templates/preview?siteId=&variant=&heading=&subheading=&photoUrl=
// Returns the rendered email HTML (text/html) for an <iframe srcdoc> live preview.
async function preview(req, res) {
  try {
    const { siteId, variant } = req.query;
    if (!siteId) return res.status(400).send('Missing siteId.');
    const site = await verifySiteOwnership(req.cmsUser.id, siteId);
    if (!site) return res.status(403).send('Not your site.');

    const build = VARIANTS[variant] || VARIANTS.booking_confirmation;
    const brand = await resolveTenantEmailBrand(siteId);

    // Live editor overrides win over the resolved/saved values for the preview.
    if (req.query.photoUrl) brand.photoUrl = emailPhotoUrl(req.query.photoUrl);
    const over = {
      heading: req.query.heading ? String(req.query.heading).slice(0, 120) : undefined,
      subheading: req.query.subheading ? String(req.query.subheading).slice(0, 240) : undefined,
    };

    const html = build(brand, over); // builders return the HTML string directly
    res.set('Content-Type', 'text/html; charset=utf-8').send(html);
  } catch (e) {
    console.error('[emailTemplates.preview]', e.message);
    res.status(500).send('Preview failed.');
  }
}

module.exports = { listVariants, preview };
