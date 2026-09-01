// Theme-aware pre-publish quality suggestions (Peter, 2026-09-01). The hard
// publish gate (siteCompleteness) answers "can this go live?"; this layer
// answers "will it look as good as the theme the owner picked?" — e.g. a team
// carousel that wants 3+ people, a photo-driven menu with photo-less services,
// a gallery with two images, or sections still showing the demo's content.
//
// Design rules (agreed 2026-09-01):
// - DETERMINISTIC checks decide; the optional AI pass only PHRASES the
//   findings in Stacy's voice — it can never invent a problem, and when the
//   model is unconfigured or fails, the plain findings render on their own.
// - Theme-awareness derives from the template row itself (home_arrangement +
//   archetype_variants), so new themes get sensible checks for free;
//   `templates.metadata.quality_targets` can override the numeric targets
//   per theme when we want hand tuning.
// - NEVER blocking: these are suggestions beside the checklist, not gates.
const supabase = require('../config/supabase');
const { SEED_SOURCE_BY_VERTICAL } = require('./provisionSite');
const { evaluateSampleSections } = require('./sampleContent');
const { CMS_ROUTES, contentRoute } = require('./cmsRoutes');

const OpenAI = require('openai');
const MODEL = process.env.QUALITY_ASSIST_MODEL || process.env.LEADGEN_MODEL || 'gpt-4o';
const openai = process.env.OPENAI_API_KEY ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null;

// Service-menu variants that render per-service photos — with these active, a
// photo-less service leaves a visible hole in the design.
const PHOTO_MENU_VARIANTS = new Set([
  'photo-menu', 'tile-grid', 'category-tabs', 'detail-rows', 'detail-cards',
  'reveal-cards', 'quiet-cards', 'hover-overlay', 'top-rated-tabs',
]);

// Defaults; templates.metadata.quality_targets overrides any key.
const DEFAULT_TARGETS = {
  team_min: 3,          // a rendered team section thinner than this looks sparse
  gallery_min: 4,       // a gallery grid below this reads unfinished
  testimonials_min: 3,  // review layouts are built around 3+
};

// Sections the CMS lets owners hide (mirror of the CMS TOGGLEABLE set) — for
// these, "still the demo's content" has a second remedy: hide it for now.
const HIDEABLE = new Set([
  'awards', 'stats_band', 'testimonials', 'partners', 'gallery', 'cta_banner',
  'marquee', 'facility_highlights', 'free_intro_offer',
]);

const SECTION_LABELS = {
  hero: 'Welcome banner', intro: 'Short introduction', rich_text: 'Your story',
  gallery: 'Gallery', testimonials: 'Reviews', service_grid: 'Services',
  team_grid: 'Team', location_map: 'Location & contact details',
  cta_banner: 'Promo banner', awards: 'Awards', partners: 'Partner brands',
  stats_band: 'Company stats', marquee: 'Scrolling slogan',
  schedule_widget: 'Class schedule', facility_highlights: 'Amenities',
  pricing_table: 'Pricing', membership_tiers: 'Membership tiers',
  free_intro_offer: 'Free intro offer', occasion_grid: 'Browse by occasion',
  program_feature: 'Signature program', faq: 'FAQ',
};

/**
 * @returns {{ findings: Finding[], summary: string | null }}
 *   Finding = { key, label, detail, route, severity: 'suggest' | 'note' }
 */
async function evaluateSiteQuality(siteId) {
  const { data: site, error } = await supabase
    .from('sites')
    .select('id, metadata, template_id, vertical:verticals(slug), company:companies(name)')
    .eq('id', siteId)
    .single();
  if (error || !site) throw new Error(`site ${siteId} not found: ${error?.message}`);

  const { data: template } = site.template_id
    ? await supabase.from('templates')
        .select('display_name, home_arrangement, archetype_variants, metadata')
        .eq('id', site.template_id).maybeSingle()
    : { data: null };

  const arrangement = Array.isArray(template?.home_arrangement) ? template.home_arrangement : [];
  const variants = (template?.archetype_variants && typeof template.archetype_variants === 'object')
    ? template.archetype_variants : {};
  const targets = {
    ...DEFAULT_TARGETS,
    ...((template?.metadata && typeof template.metadata === 'object' && template.metadata.quality_targets) || {}),
  };
  const themeName = template?.display_name || 'your theme';

  const [{ data: services }, { data: team }, { data: testimonials }] = await Promise.all([
    supabase.from('site_services').select('id, name, photo_url').eq('site_id', siteId).eq('is_active', true),
    supabase.from('site_team_members').select('id, name, photo_url').eq('site_id', siteId).eq('is_active', true),
    supabase.from('site_testimonials').select('id').eq('site_id', siteId).eq('is_visible', true),
  ]);

  // Gallery images + sample-state come from the home sections.
  const { data: homePage } = await supabase
    .from('site_pages').select('id').eq('site_id', siteId).eq('slug', 'home').maybeSingle();
  const { data: homeSections } = homePage
    ? await supabase.from('site_sections')
        .select('id, section_type, content, is_visible')
        .eq('page_id', homePage.id)
    : { data: [] };
  const gallerySection = (homeSections ?? []).find((s) => s.section_type === 'gallery');
  const galleryImages = Array.isArray(gallerySection?.content?.images) ? gallerySection.content.images.length : 0;

  // Demo-photo detection: a team/service photo equal to one on the clone
  // source is still the demo's stock shot, not the owner's.
  const sourceId = site.metadata?.cloned_from || SEED_SOURCE_BY_VERTICAL[site.vertical?.slug];
  let seedPhotoUrls = new Set();
  if (sourceId && sourceId !== siteId) {
    const [{ data: seedSvcs }, { data: seedTeam }] = await Promise.all([
      supabase.from('site_services').select('photo_url').eq('site_id', sourceId),
      supabase.from('site_team_members').select('photo_url').eq('site_id', sourceId),
    ]);
    seedPhotoUrls = new Set(
      [...(seedSvcs ?? []), ...(seedTeam ?? [])].map((r) => r.photo_url).filter(Boolean),
    );
  }
  const isSeedSite = !sourceId || sourceId === siteId;

  // Owner-ignored suggestions ("use the demo data on purpose") — stored by the
  // CMS Ignore button on site_theme_settings.metadata.quality_ignored.
  const { data: theme } = await supabase
    .from('site_theme_settings').select('metadata').eq('site_id', siteId).maybeSingle();
  const themeMeta = (theme?.metadata && typeof theme.metadata === 'object') ? theme.metadata : {};
  const ignored = new Set(Array.isArray(themeMeta.quality_ignored) ? themeMeta.quality_ignored : []);

  const findings = [];
  const add = (key, label, detail, route, severity = 'suggest') => {
    if (ignored.has(key)) return;
    findings.push({ key, label, detail, route, severity });
  };

  // ── Team ──
  if (arrangement.includes('team_grid')) {
    const count = (team ?? []).length;
    if (count > 0 && count < targets.team_min) {
      add('team_thin', 'Your team section looks sparse',
        `${themeName} shows a team section that looks best with at least ${targets.team_min} people. You have ${count}. Add the rest of your team, or anyone customers can book with.`,
        CMS_ROUTES.team ?? '/team');
    }
    const demoTeamPhotos = (team ?? []).filter((m) => m.photo_url && seedPhotoUrls.has(m.photo_url));
    if (!isSeedSite && demoTeamPhotos.length > 0) {
      add('team_demo_photos', "Some team photos are still the demo's",
        `${demoTeamPhotos.length} of your team ${demoTeamPhotos.length === 1 ? 'photo is' : 'photos are'} still the demo's stock ${demoTeamPhotos.length === 1 ? 'portrait' : 'portraits'} (${demoTeamPhotos.map((m) => m.name).slice(0, 3).join(', ')}${demoTeamPhotos.length > 3 ? '…' : ''}). Customers book people, and real faces convert better than stock ones.`,
        CMS_ROUTES.team ?? '/team');
    }
    const noPhoto = (team ?? []).filter((m) => !m.photo_url);
    if (noPhoto.length > 0) {
      add('team_missing_photos', 'Team members without a photo',
        `${noPhoto.length} team ${noPhoto.length === 1 ? 'member has' : 'members have'} no photo yet. ${themeName}'s team layout leans on portraits.`,
        CMS_ROUTES.team ?? '/team');
    }
  }

  // ── Services ──
  const serviceMenuVariant = variants.service_menu ?? 'default';
  if (PHOTO_MENU_VARIANTS.has(serviceMenuVariant)) {
    const noPhoto = (services ?? []).filter((s) => !s.photo_url);
    if (noPhoto.length > 0) {
      add('service_missing_photos', 'Services without a photo',
        `${themeName} shows a photo for each service, and ${noPhoto.length} of yours ${noPhoto.length === 1 ? "doesn't have one" : "don't have one"} yet, so those tiles will look empty.`,
        CMS_ROUTES.services ?? '/services');
    }
  }
  if (!isSeedSite) {
    const demoServicePhotos = (services ?? []).filter((s) => s.photo_url && seedPhotoUrls.has(s.photo_url));
    if (demoServicePhotos.length >= 3) {
      add('service_demo_photos', "Service photos are still the demo's",
        `${demoServicePhotos.length} service photos are still the demo's stock shots. Fine to launch with, but photos of your own work sell your actual craft.`,
        CMS_ROUTES.services ?? '/services', 'note');
    }
  }

  // ── Gallery ──
  if (arrangement.includes('gallery') && gallerySection?.is_visible !== false) {
    if (galleryImages > 0 && galleryImages < targets.gallery_min) {
      add('gallery_thin', 'Your gallery is thin',
        `${themeName}'s gallery layout fills out at ${targets.gallery_min}+ photos. You have ${galleryImages}. Add a few of your best shots, or hide the section with the eye icon until you have them.`,
        contentRoute ? contentRoute('home') : '/content/home');
    }
  }

  // ── Reviews ──
  if (arrangement.includes('testimonials')) {
    const visible = (testimonials ?? []).length;
    if (visible > 0 && visible < targets.testimonials_min) {
      add('testimonials_thin', 'Only a couple of reviews showing',
        `Review layouts read best with ${targets.testimonials_min} or more. You're showing ${visible}. Add more, or hide the Reviews section until they come in.`,
        CMS_ROUTES.testimonials ?? '/testimonials');
    }
  }

  // ── Sections still showing the demo's words ──
  if (!isSeedSite) {
    try {
      const { sampleSectionIds } = await evaluateSampleSections(siteId);
      const sampleSet = new Set(sampleSectionIds);
      const sampleHome = (homeSections ?? []).filter(
        (s) => sampleSet.has(s.id) && s.is_visible !== false && arrangement.includes(s.section_type),
      );
      // The wizard/checklist already own hero + contact identity; here we call
      // out the OPTIONAL bands owners forget (awards, stats, partners…).
      const forgettable = sampleHome.filter((s) => HIDEABLE.has(s.section_type));
      for (const s of forgettable.slice(0, 3)) {
        const label = SECTION_LABELS[s.section_type] || s.section_type;
        add(`sample_${s.section_type}`, `"${label}" still shows the demo's content`,
          `The ${label} section on your home page is still word-for-word the demo's. Make it yours, or hide it with the eye icon until you're ready.`,
          contentRoute ? `${contentRoute('home')}?section=${s.section_type}` : '/content/home');
      }
    } catch { /* best-effort */ }
  }

  const summary = findings.length > 0 ? await phraseSummary(findings, themeName, site.company?.name) : null;
  return { findings, summary, theme: themeName, ignoredCount: ignored.size };
}

// AI pass: turn the deterministic findings into 2-3 warm sentences in Stacy's
// voice. Phrases ONLY — the findings list renders regardless, and any failure
// here degrades to summary: null.
async function phraseSummary(findings, themeName, businessName) {
  if (!openai) return null;
  try {
    const res = await openai.chat.completions.create({
      model: MODEL,
      max_tokens: 160,
      temperature: 0.7,
      messages: [
        {
          role: 'system',
          content: 'You are Stacy, the friendly website assistant inside the Stemfra CMS. Given a list of pre-publish quality findings, write a SHORT, warm, encouraging 2-3 sentence note to the site owner. Plain text only, no markdown, no lists, no greetings like "Hi". Do not repeat every finding; capture the spirit and make it feel like advice from a helpful human, never a scolding. Do not mention anything not present in the findings. No em-dashes.',
        },
        {
          role: 'user',
          content: `Business: ${businessName || 'the owner'}\nTheme: ${themeName}\nFindings:\n${findings.map((f) => `- ${f.label}: ${f.detail}`).join('\n')}`,
        },
      ],
    });
    const text = res.choices?.[0]?.message?.content?.trim();
    return text || null;
  } catch (err) {
    console.warn('[siteQuality] summary phrasing failed:', err.message);
    return null;
  }
}

module.exports = { evaluateSiteQuality };
