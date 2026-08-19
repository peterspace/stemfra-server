// Site readiness for publishing (Phase 2c). Produces a checklist the CMS shows
// the owner ("what's left before you go live") and which the publish endpoint
// uses as a hard gate. REQUIRED items block publish; RECOMMENDED items are
// nudges (incl. best-effort "still showing demo content" detection by comparing
// key fields against the vertical's seed source).
const supabase = require('../config/supabase');
const { SEED_SOURCE_BY_VERTICAL } = require('./provisionSite');
const { CMS_ROUTES } = require('./cmsRoutes');

const i18nEn = (v) => (v && typeof v === 'object' ? v.en : v) || '';
const nonEmpty = (s) => !!String(s ?? '').trim();

async function countRows(table, siteId, filters = {}) {
  let q = supabase.from(table).select('id', { count: 'exact', head: true }).eq('site_id', siteId);
  for (const [k, v] of Object.entries(filters)) q = q.eq(k, v);
  const { count, error } = await q;
  if (error) throw new Error(`count ${table}: ${error.message}`);
  return count || 0;
}

/**
 * Evaluate a site's publish-readiness.
 * @returns {{ siteId, status, ready, required: Item[], recommended: Item[] }}
 *   Item = { key, label, ok, hint, route }
 */
async function evaluateCompleteness(siteId) {
  const { data: site, error } = await supabase
    .from('sites')
    .select('id, status, business_hours, metadata, company:companies(name), vertical:verticals(slug), owner:contacts!sites_owner_contact_id_fkey(first_name, last_name, country, state, billing_profile)')
    .eq('id', siteId)
    .single();
  if (error || !site) throw new Error(`site ${siteId} not found: ${error?.message}`);

  const { data: sections } = await supabase
    .from('site_sections')
    .select('section_type, content')
    .eq('site_id', siteId)
    .in('section_type', ['hero', 'location_map']);
  const hero = sections?.find((s) => s.section_type === 'hero')?.content || {};
  const loc = sections?.find((s) => s.section_type === 'location_map')?.content || {};

  const [services, team, testimonials] = await Promise.all([
    countRows('site_services', siteId, { is_active: true }),
    countRows('site_team_members', siteId, { is_active: true }),
    countRows('site_testimonials', siteId, { is_visible: true }),
  ]);

  const { data: theme } = await supabase
    .from('site_theme_settings')
    .select('logo_url, instagram_handle, facebook_handle, tiktok_handle, twitter_handle, youtube_handle, metadata')
    .eq('site_id', siteId)
    .maybeSingle();

  // The demo this site was cloned from (recorded at signup by lib/clonePersonalize.js;
  // older sites fall back to the vertical seed). Identity fields still equal to
  // the source's are the DEMO's, not the tenant's → they block publishing
  // (Peter, 2026-08-20: business name, addresses, phone, email must be theirs).
  let seedLoc = {};
  let seedHero = {};
  try {
    const sourceId = site.metadata?.cloned_from || SEED_SOURCE_BY_VERTICAL[site.vertical?.slug];
    if (sourceId && sourceId !== siteId) {
      const { data: seedSecs } = await supabase
        .from('site_sections').select('section_type, content').eq('site_id', sourceId)
        .in('section_type', ['hero', 'location_map']);
      seedHero = seedSecs?.find((x) => x.section_type === 'hero')?.content || {};
      seedLoc = seedSecs?.find((x) => x.section_type === 'location_map')?.content || {};
    }
  } catch { /* best-effort */ }
  const sameAsDemo = (a, b) => nonEmpty(a) && nonEmpty(b) && String(a).trim().toLowerCase() === String(b).trim().toLowerCase();
  const own = (v, seedV) => nonEmpty(v) && !sameAsDemo(v, seedV);

  // Billing details (Account → Billing → Billing details): the invoice identity.
  // Required before publishing (Peter, 2026-08-20).
  const owner = site.owner || {};
  const bp = owner.billing_profile || {};
  const billingOk = [owner.first_name, owner.last_name, owner.country, owner.state, bp.line1, bp.city, bp.postal_code].every(nonEmpty);

  const hours = site.business_hours || {};
  const hoursOk = Object.values(hours).some((d) => d && !d.closed && d.open && d.close);
  const companyName = site.company?.name || '';
  const nameOk = nonEmpty(companyName) && !/^TEST\b/i.test(companyName);

  const required = [
    { key: 'business_name', label: 'Business name', ok: nameOk, hint: 'Set your business name in Settings.', route: CMS_ROUTES.businessName },
    { key: 'location_name', label: 'Your location name', ok: own(loc.name, seedLoc.name), hint: 'The Location card still shows the demo name. Use your own.', route: CMS_ROUTES.homeContact },
    { key: 'address', label: 'Your business address', ok: own(loc.address, seedLoc.address), hint: sameAsDemo(loc.address, seedLoc.address) ? 'Still showing the demo address. Replace it with yours in the Location section.' : 'Add your street address to the Location section.', route: CMS_ROUTES.homeContact },
    { key: 'phone', label: 'Your phone number', ok: own(loc.phone, seedLoc.phone), hint: sameAsDemo(loc.phone, seedLoc.phone) ? 'Still showing the demo phone number. Use yours.' : 'Add a contact phone to the Location section.', route: CMS_ROUTES.homeContact },
    { key: 'email', label: 'Your contact email', ok: own(loc.email, seedLoc.email), hint: sameAsDemo(loc.email, seedLoc.email) ? 'Still showing the demo email. Use yours.' : 'Add a contact email to the Location section.', route: CMS_ROUTES.homeContact },
    { key: 'billing_details', label: 'Billing details', ok: billingOk, hint: 'Add your billing name and address so Stemfra can invoice you (Account → Billing → Billing details).', route: CMS_ROUTES.billingDetails },
    { key: 'hours', label: 'Business hours', ok: hoursOk, hint: 'Set your opening hours in Settings.', route: CMS_ROUTES.hours },
    { key: 'services', label: 'At least one service', ok: services > 0, hint: 'Add a service.', route: CMS_ROUTES.services },
    { key: 'team', label: 'At least one team member', ok: team > 0, hint: 'Add a team member.', route: CMS_ROUTES.team },
    { key: 'hero_headline', label: 'Homepage headline', ok: nonEmpty(i18nEn(hero.headline_i18n)), hint: 'Set your homepage hero headline.', route: CMS_ROUTES.homeHero },
  ];

  const socialOk = !!theme && [theme.instagram_handle, theme.facebook_handle, theme.tiktok_handle, theme.twitter_handle, theme.youtube_handle].some(nonEmpty);
  const gbpLinked = theme?.metadata?.gbp?.linked === true;
  const recommended = [
    { key: 'logo', label: 'Logo', ok: nonEmpty(theme?.logo_url), hint: 'Upload your logo in Settings.', route: CMS_ROUTES.logo },
    { key: 'testimonials', label: 'A customer review', ok: testimonials > 0, hint: 'Add a testimonial.', route: CMS_ROUTES.testimonials },
    { key: 'social', label: 'Social links', ok: socialOk, hint: 'Add your social handles in Settings.', route: CMS_ROUTES.social },
    { key: 'google_profile', label: 'Google Business Profile', ok: gbpLinked, hint: 'Point your Google listing at your site so customers find + book you from Google.', route: CMS_ROUTES.googleProfile },
  ];

  // Nudge (not a gate): homepage headline still identical to the demo's.
  const heroHeadline = i18nEn(hero.headline_i18n);
  if (heroHeadline && sameAsDemo(heroHeadline, i18nEn(seedHero.headline_i18n))) {
    recommended.push({ key: 'personalize_hero', label: 'Personalize the homepage headline', ok: false, hint: 'Still showing the demo headline. Make it yours.', route: CMS_ROUTES.homeHero });
  }

  return {
    siteId,
    status: site.status,
    ready: required.every((r) => r.ok),
    required,
    recommended,
  };
}

module.exports = { evaluateCompleteness };
