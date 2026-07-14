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

const CMS_ROUTES = {
  // Top-level surfaces
  dashboard: '/',
  sites: '/sites',
  services: '/services',
  team: '/team',
  testimonials: '/testimonials',
  blog: '/blog',
  media: '/media',
  leads: '/leads',
  bookings: '/bookings',
  memberships: '/memberships',
  notifications: '/notifications',
  profile: '/profile',

  // Content editor (per-page). `content(slug)` targets a specific page; the home
  // page carries hero + location (address/phone) + most personalize steps.
  contentIndex: '/content',
  homeContent: '/content/home',
  aboutContent: '/content/about',

  // Settings — each GROUP is its own page at /settings/<slug>; sections deep-link
  // via #<anchor> (anchors defined in stemfra_cms settingsSections.ts).
  publish: '/settings/publish',
  businessName: '/settings/style#business',
  themes: '/settings/style#themes',
  logo: '/settings/style#branding',
  brandColors: '/settings/style#colors',
  domain: '/settings/domain',
  seoDefaults: '/settings/seo#seo',
  timezone: '/settings/hours#timezone',
  hours: '/settings/hours#hours',
  social: '/settings/social#social',
  frontdesk: '/settings/frontdesk#frontdesk',
  booking: '/settings/payments#booking',
  pricingDisplay: '/settings/payments#pricing-display',
  payments: '/settings/payments#payments',
};

/** Per-page content editor route (falls back to the content index). */
function contentRoute(slug) {
  return slug ? `/content/${slug}` : CMS_ROUTES.contentIndex;
}

module.exports = { CMS_ROUTES, contentRoute };
