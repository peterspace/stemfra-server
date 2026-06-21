// Site readiness for publishing (Phase 2c). Produces a checklist the CMS shows
// the owner ("what's left before you go live") and which the publish endpoint
// uses as a hard gate. REQUIRED items block publish; RECOMMENDED items are
// nudges (incl. best-effort "still showing demo content" detection by comparing
// key fields against the vertical's seed source).
const supabase = require('../config/supabase');
const { SEED_SOURCE_BY_VERTICAL } = require('./provisionSite');

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
    .select('id, status, business_hours, company:companies(name), vertical:verticals(slug)')
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
    .select('logo_url, instagram_handle, facebook_handle, tiktok_handle, twitter_handle, youtube_handle')
    .eq('site_id', siteId)
    .maybeSingle();

  const hours = site.business_hours || {};
  const hoursOk = Object.values(hours).some((d) => d && !d.closed && d.open && d.close);
  const companyName = site.company?.name || '';
  const nameOk = nonEmpty(companyName) && !/^TEST\b/i.test(companyName);

  const required = [
    { key: 'business_name', label: 'Business name', ok: nameOk, hint: 'Set your business name in Settings.', route: '/settings' },
    { key: 'address', label: 'Address', ok: nonEmpty(loc.address), hint: 'Add your street address to the Location section.', route: '/content' },
    { key: 'phone', label: 'Phone number', ok: nonEmpty(loc.phone), hint: 'Add a contact phone to the Location section.', route: '/content' },
    { key: 'hours', label: 'Business hours', ok: hoursOk, hint: 'Set your opening hours in Settings.', route: '/settings' },
    { key: 'services', label: 'At least one service', ok: services > 0, hint: 'Add a service.', route: '/services' },
    { key: 'team', label: 'At least one team member', ok: team > 0, hint: 'Add a team member.', route: '/team' },
    { key: 'hero_headline', label: 'Homepage headline', ok: nonEmpty(i18nEn(hero.headline_i18n)), hint: 'Set your homepage hero headline.', route: '/content' },
  ];

  const socialOk = !!theme && [theme.instagram_handle, theme.facebook_handle, theme.tiktok_handle, theme.twitter_handle, theme.youtube_handle].some(nonEmpty);
  const recommended = [
    { key: 'logo', label: 'Logo', ok: nonEmpty(theme?.logo_url), hint: 'Upload your logo in Settings.', route: '/settings' },
    { key: 'testimonials', label: 'A customer review', ok: testimonials > 0, hint: 'Add a testimonial.', route: '/testimonials' },
    { key: 'social', label: 'Social links', ok: socialOk, hint: 'Add your social handles in Settings.', route: '/settings' },
  ];

  // Best-effort: flag content still identical to the vertical's seed demo.
  try {
    const seedId = SEED_SOURCE_BY_VERTICAL[site.vertical?.slug];
    if (seedId && seedId !== siteId) {
      const { data: seedSecs } = await supabase
        .from('site_sections').select('section_type, content').eq('site_id', seedId)
        .in('section_type', ['hero', 'location_map']);
      const seedHero = seedSecs?.find((s) => s.section_type === 'hero')?.content || {};
      const seedLoc = seedSecs?.find((s) => s.section_type === 'location_map')?.content || {};
      const heroHeadline = i18nEn(hero.headline_i18n);
      if (heroHeadline && heroHeadline === i18nEn(seedHero.headline_i18n)) {
        recommended.push({ key: 'personalize_hero', label: 'Personalize the homepage headline', ok: false, hint: 'Still showing the demo headline — make it yours.', route: '/content' });
      }
      if (nonEmpty(loc.address) && loc.address === seedLoc.address) {
        recommended.push({ key: 'personalize_address', label: 'Update the address', ok: false, hint: 'Still showing the demo address.', route: '/content' });
      }
    }
  } catch { /* best-effort — never block readiness on the seed comparison */ }

  return {
    siteId,
    status: site.status,
    ready: required.every((r) => r.ok),
    required,
    recommended,
  };
}

module.exports = { evaluateCompleteness };
