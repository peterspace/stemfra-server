// SINGLE SOURCE OF TRUTH for CMS destination paths that the server hands to the
// browser CMS (publish checklist, Stacy onboarding, any future agent). The CMS
// is a React app at :5180 / cms.stemfra.com; these are its in-app routes.
//
// WHY THIS FILE EXISTS: the publish checklist (siteCompleteness.js) and Stacy's
// onboarding (stacyOnboarding.js) both need to tell an owner "go here to fix X".
// They used to hardcode paths independently, so when Settings was split into
// per-group pages (bare `/settings` now REDIRECTS to /settings/publish, dropping
// query + hash), the checklist kept working but Stacy silently pointed owners in
// a loop. One map here → both stay in sync; a route change is a one-line edit.
//
// ⚠ KEEP ALIGNED with stemfra_cms `src/App.tsx` routes + `settingsSections.ts`
// anchors. If you rename a CMS route/anchor, update the matching value below and
// every consumer updates for free.

// CURRENT CMS IA (re-verified against Sidebar.tsx 2026-08-18, launch task #3):
//   Panel 1: Home · Sites · Bookings · Inbox (leads) · Clients · Team · Services
//            + Payments (= Billing → Payments) · Notifications · Hours & timezone
//   Website ›   Pages · Testimonials · Legal · Media · Settings: Style / SEO / Front desk
//   Marketing › Promotions · Blog · Subscribers
//   Operations› Schedule · Memberships · Reports
//   Account ›   Billing (Subscription/Invoices/Payments/History/Details) · Settings:
//               Publish / Domain / Social (+ the rest)
//   Profile (avatar) › Account information · Security · Notification settings
const CMS_ROUTES = {
  // Top-level surfaces
  dashboard: '/',
  analytics: '/analytics',
  sites: '/sites',
  services: '/services',
  team: '/team',
  testimonials: '/testimonials',
  blog: '/blog',
  media: '/media',
  promotions: '/promotions',
  subscribers: '/subscribers',
  leads: '/leads',
  customers: '/customers',
  reports: '/reports',
  bookings: '/bookings',
  schedule: '/schedule',
  memberships: '/memberships',
  billing: '/billing',
  billingInvoices: '/billing/invoices',
  billingDetails: '/billing/details',
  billingPayments: '/billing/payments',
  notifications: '/notifications',
  notificationSettings: '/profile/notifications',
  profile: '/profile',
  support: '/support',
  whatsNew: '/whats-new',
  googleProfile: '/google-profile',

  // Content editor (per-page). `content(slug)` targets a specific page; the home
  // page carries hero + location (address/phone) + most personalize steps.
  // `?section=<section_type>` (or `seo`) makes ContentPageEditPage open + scroll
  // to that editor on arrival — use the deep-linked variants whenever the
  // guidance means ONE specific section, so owners never land on a bare list.
  contentIndex: '/content',
  homeContent: '/content/home',
  aboutContent: '/content/about',
  faqContent: '/content/faq',
  termsContent: '/content/terms',
  privacyContent: '/content/privacy',
  giftContent: '/content/gift-certificates', // wellness verticals (massage/spa)
  homeHero: '/content/home?section=hero',
  homeContact: '/content/home?section=location_map',
  homeSeo: '/content/home?section=seo',
  aboutStory: '/content/about?section=rich_text',

  // Settings — each GROUP is its own page at /settings/<slug>; sections deep-link
  // via #<anchor> (anchors defined in stemfra_cms settingsSections.ts).
  publish: '/settings/publish',
  businessName: '/settings/style#business',
  themes: '/settings/style#themes',
  labels: '/settings/style#labels', // "Buttons & labels" (header CTA, footer, chat chips)
  logo: '/settings/style#branding',
  brandColors: '/settings/style#colors',
  domain: '/settings/domain',
  seoDefaults: '/settings/seo#seo',
  timezone: '/settings/hours#timezone',
  hours: '/settings/hours#hours',
  social: '/settings/social#social',
  frontdesk: '/settings/frontdesk#frontdesk',
  // Payments (how the tenant gets paid: Stripe keys / pay-at-venue) moved UNDER
  // BILLING in the sidebar on 2026-08-10 (Billing → Payments tab). The old
  // /settings/payments#payments still resolves as a deep link but is NOT in the
  // nav, so owners sent there could not find it again — point at the in-nav
  // surface. Booking + Service-pricing settings live inside that same section.
  booking: '/billing/payments',
  pricingDisplay: '/billing/payments',
  payments: '/billing/payments',
  lifecycleEmails: '/settings/notifications#lifecycle-emails',
  emailNotifications: '/settings/notifications#notifications',
};

/** Per-page content editor route (falls back to the content index). */
function contentRoute(slug) {
  return slug ? `/content/${slug}` : CMS_ROUTES.contentIndex;
}

/**
 * CMS_GUIDE — the owner-task → "where in the CMS" map Stacy uses to answer
 * "where do I change X?" (fed into her context as `cms_map` by stacyContext.js,
 * Stacy-only — the public Front Desk chat never sees it). `where` is the exact
 * sidebar path an owner sees (kept in step with stemfra_cms Sidebar.tsx +
 * StacyPanel.tsx ROUTE_LABEL); `route` is the deep link. Derived from CMS_ROUTES
 * so a route change here updates the guidance for free.
 */
const CMS_GUIDE = [
  { task: 'edit page text, headlines, sections, images on any page (home, about, FAQ, legal…)', where: 'Website → Pages → (the page)', route: CMS_ROUTES.contentIndex },
  { task: 'change the homepage hero headline / photo', where: 'Website → Pages → Home → Hero', route: CMS_ROUTES.homeHero },
  { task: 'change the business address, phone, public email (also feeds the contact page + footer)', where: 'Website → Pages → Home → Location', route: CMS_ROUTES.homeContact },
  { task: 'edit the About story', where: 'Website → Pages → About', route: CMS_ROUTES.aboutStory },
  { task: 'edit the FAQ', where: 'Website → Pages → FAQ', route: CMS_ROUTES.faqContent },
  { task: 'review or edit legal pages (Terms & booking policy, Privacy, Cookies)', where: 'Website → Legal', route: CMS_ROUTES.termsContent },
  { task: 'add / edit / reorder services, prices, durations, service photos', where: 'Services', route: CMS_ROUTES.services },
  { task: 'add / edit team members, their photos, working hours, which services they do', where: 'Team', route: CMS_ROUTES.team },
  { task: 'add or edit customer reviews / testimonials', where: 'Website → Testimonials', route: CMS_ROUTES.testimonials },
  { task: 'upload or manage photos and videos', where: 'Website → Media', route: CMS_ROUTES.media },
  { task: 'change the theme / template look', where: 'Website → Style → Themes', route: CMS_ROUTES.themes },
  { task: 'change the header button text, footer headings/copyright, chat quick replies, footer photo', where: 'Website → Style → Buttons & labels', route: CMS_ROUTES.labels },
  { task: 'upload the logo or favicon', where: 'Website → Style → Logo & favicon', route: CMS_ROUTES.logo },
  { task: 'change brand colors', where: 'Website → Style → Brand colors', route: CMS_ROUTES.brandColors },
  { task: 'change the business name shown on the site', where: 'Website → Style → Business name', route: CMS_ROUTES.businessName },
  { task: 'edit search (SEO) title + description defaults', where: 'Website → SEO → Search appearance', route: CMS_ROUTES.seoDefaults },
  { task: 'turn the website chat assistant (front desk) on/off', where: 'Website → Front desk', route: CMS_ROUTES.frontdesk },
  { task: 'set opening hours or the time zone', where: 'Hours & timezone', route: CMS_ROUTES.hours },
  { task: 'add social media links', where: 'Account → Settings → Social media', route: CMS_ROUTES.social },
  { task: 'connect or buy a domain, set up email forwarding', where: 'Account → Settings → Domain', route: CMS_ROUTES.domain },
  { task: 'publish the site / go live', where: 'Account → Settings → Publish', route: CMS_ROUTES.publish },
  { task: 'set how the business gets paid (Stripe keys, pay at venue), show/hide prices', where: 'Account → Billing → Payments', route: CMS_ROUTES.billingPayments },
  { task: 'see Stemfra invoices, subscription', where: 'Account → Billing', route: CMS_ROUTES.billing },
  { task: 'add or update billing details (billing name, billing address, tax id) — required before publishing', where: 'Account → Billing → Billing details', route: CMS_ROUTES.billingDetails },
  { task: 'automated customer emails + the Google review link', where: 'Notifications → Automated emails', route: CMS_ROUTES.lifecycleEmails },
  { task: 'which events email/SMS the owner', where: 'Notifications', route: CMS_ROUTES.emailNotifications },
  { task: 'view bookings calendar, reschedule, reassign staff, mark collected', where: 'Bookings', route: CMS_ROUTES.bookings },
  { task: 'read website / chat leads and reply', where: 'Inbox', route: CMS_ROUTES.leads },
  { task: 'view clients, visit history, revenue per client, notes', where: 'Clients', route: CMS_ROUTES.customers },
  { task: 'view revenue / booking reports, export PDF', where: 'Operations → Reports', route: CMS_ROUTES.reports },
  { task: 'manage class schedule / sessions', where: 'Operations → Schedule', route: CMS_ROUTES.schedule },
  { task: 'manage membership plans + members', where: 'Operations → Memberships', route: CMS_ROUTES.memberships },
  { task: 'create promo banners / offers', where: 'Marketing → Promotions', route: CMS_ROUTES.promotions },
  { task: 'write blog posts', where: 'Marketing → Blog', route: CMS_ROUTES.blog },
  { task: 'see newsletter subscribers', where: 'Marketing → Subscribers', route: CMS_ROUTES.subscribers },
  { task: 'connect the Google Business Profile', where: 'Google Business Profile', route: CMS_ROUTES.googleProfile },
  { task: 'website traffic / analytics', where: 'Analytics', route: CMS_ROUTES.analytics },
  { task: 'contact Stemfra support', where: 'Support', route: CMS_ROUTES.support },
];

module.exports = { CMS_ROUTES, CMS_GUIDE, contentRoute };
