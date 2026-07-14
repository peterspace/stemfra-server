// Site provisioning — clone a vertical's canonical seed site into a fresh
// tenant site (Phase 2a). This is the server-side equivalent of DMT's
// per-customer create step, but adapted to our MULTI-TENANT-BY-HOST model:
// there is NO per-customer Cloudflare project or build. Provisioning is purely
// a DB clone — the deployed per-vertical Pages project renders the new site by
// host once its subdomain is attached (that DNS/cert step is Phase 2b).
//
// What this does, in FK order:
//   sites (new) → pages → sections → categories → services → team →
//   team_service_links → availability_rules → testimonials
// Media FKs (*_media_id) are nulled (they point at the seed site's site_media
// rows); the denormalized photo_url / author_photo_url strings are KEPT so the
// preview renders the demo imagery. site_theme_settings is intentionally NOT
// cloned — a fresh site inherits its template's design_tokens cleanly, avoiding
// the stale-per-site-override trap from day one.
const { randomUUID } = require('crypto');
const supabase = require('../config/supabase'); // service-role; see config/supabase.js
const { scheduleLocalizeSiteMedia } = require('./localizeSiteMedia');

// Vertical config (slug aliases + seed sites) is centralized in verticalConfig.js
// (single source of truth). SEED_SOURCE_BY_VERTICAL is derived here for the error
// message + a backward-compatible export.
const { resolveVerticalSlug, VERTICALS } = require('./verticalConfig');
const SEED_SOURCE_BY_VERTICAL = Object.fromEntries(
  Object.entries(VERTICALS).filter(([, v]) => v.seedSite).map(([k, v]) => [k, v.seedSite]),
);

const slugify = (s) =>
  String(s || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '');

const omit = (obj, keys) => {
  const o = { ...obj };
  for (const k of keys) delete o[k];
  return o;
};
const TIMESTAMPS = ['created_at', 'updated_at'];

async function fetchRows(table, sourceSiteId) {
  const { data, error } = await supabase.from(table).select('*').eq('site_id', sourceSiteId);
  if (error) throw new Error(`fetch ${table}: ${error.message}`);
  return data || [];
}

async function insertRows(table, rows) {
  if (!rows.length) return;
  const { error } = await supabase.from(table).insert(rows);
  if (error) throw new Error(`insert ${table}: ${error.message}`);
}

async function isSubdomainTaken(sub) {
  const { data, error } = await supabase.from('sites').select('id').eq('subdomain', sub).limit(1);
  if (error) throw new Error(`subdomain check: ${error.message}`);
  return data.length > 0;
}

// base → base-city → base-city-2/3… The sites_subdomain_key UNIQUE constraint
// is the final guard against a race; this just avoids obvious collisions.
async function generateUniqueSubdomain(displayName, city) {
  const base = slugify(displayName) || 'site';
  const candidates = [base];
  if (city) candidates.push(`${base}-${slugify(city)}`);
  for (const c of candidates) {
    if (c && !(await isSubdomainTaken(c))) return c;
  }
  const seed = city ? `${base}-${slugify(city)}` : base;
  for (let i = 2; i < 1000; i++) {
    const c = `${seed}-${i}`;
    if (!(await isSubdomainTaken(c))) return c;
  }
  throw new Error(`could not generate a unique subdomain from "${displayName}"`);
}

// Pick the template: explicit slug → vertical default (is_default+active) →
// lowest display_order active. (Barbers/salons currently have no is_default,
// so the display_order fallback matters.)
async function resolveTemplate(verticalId, templateSlug) {
  const { data, error } = await supabase
    .from('templates')
    .select('id, slug, display_name, display_order, is_default, is_active')
    .eq('vertical_id', verticalId)
    .eq('is_active', true);
  if (error) throw new Error(`templates: ${error.message}`);
  if (!data.length) throw new Error(`no active templates for vertical ${verticalId}`);
  if (templateSlug) {
    const t = data.find((x) => x.slug === templateSlug);
    if (!t) throw new Error(`template "${templateSlug}" not found or inactive for this vertical`);
    return t;
  }
  return data.find((x) => x.is_default) || [...data].sort((a, b) => a.display_order - b.display_order)[0];
}

// Every site-scoped table, in reverse-FK delete order (verified 2026-06-29).
// Children before parents; the `sites` row is dropped separately last.
//   step 1: logs/ops · step 2: billing/commerce (billing_charges before its
//   subscriptions FK; site_subscriptions/orders before customers/products) ·
//   step 3: bookings before customers/groups · step 4: leads · step 5: catalog
//   (links/avail before services/team; services before categories) · step 6:
//   content + media (media last — photo FKs are ON DELETE SET NULL).
const SITE_CHILD_TABLES = [
  'agent_conversations', 'site_activity', 'site_preview_tokens', 'site_deployments', 'site_integrations',
  'billing_charges', 'subscriptions', 'site_subscriptions', 'site_orders', 'site_payment_accounts',
  'site_bookings', 'site_booking_groups', 'site_class_sessions', 'site_customers',
  'site_leads',
  'site_team_service_links', 'site_availability_rules', 'site_services', 'site_service_categories',
  'site_team_members', 'site_products', 'site_testimonials',
  'site_sections', 'site_pages', 'site_theme_settings', 'site_media',
];

// Reverse-FK-order delete of all site-scoped rows + the site itself. Doubles as
// rollback on a failed clone, the script's --cleanup, AND the hard-purge step of
// site deletion (see lib/siteDeletion.js). `bestEffort` collects errors and keeps
// going (for purge — one wedged table shouldn't strand the rest); default throws
// on the first error (for rollback, where a clean failure is wanted).
async function deleteSiteCascade(siteId, { bestEffort = false, dropSiteRow = true } = {}) {
  const errors = [];
  for (const table of SITE_CHILD_TABLES) {
    const { error } = await supabase.from(table).delete().eq('site_id', siteId);
    if (error) {
      if (!bestEffort) throw new Error(`cleanup ${table}: ${error.message}`);
      errors.push(`${table}: ${error.message}`);
    }
  }
  if (dropSiteRow) {
    const { error } = await supabase.from('sites').delete().eq('id', siteId);
    if (error) {
      if (!bestEffort) throw new Error(`cleanup sites: ${error.message}`);
      errors.push(`sites: ${error.message}`);
    }
  }
  return { errors };
}

// ── Shared content clone ─────────────────────────────────────────────────────
// Clones every CONFIG + CONTENT table from a source site into an already-created
// target site, in FK order, remapping ids. Deliberately does NOT clone
// operational/customer data (bookings, leads, customers, billing, subscriptions,
// payment accounts, orders) — a clone reproduces the DESIGN + CATALOG, not the
// source's real business activity. Media FKs are nulled; the denormalized
// photo_url / author_photo_url strings are kept so imagery renders (the clone
// references the same Cloudinary assets — no re-upload).
//
// `cloneThemeSettings`:
//   - false (provisionSite): a fresh customer inherits the template's design
//     tokens cleanly — avoids the stale-per-site-override trap from day one.
//   - true (cloneSite / Starters / owner "duplicate shop"): the source's
//     site_theme_settings ARE the intended look (palette + variant + arrangement
//     overrides + logo/social), so they must come along or the clone won't match.
async function cloneContent(sourceSiteId, newSiteId, { cloneThemeSettings = false } = {}) {
  // pages (build id map for sections)
  const srcPages = await fetchRows('site_pages', sourceSiteId);
  const pageIdMap = {};
  await insertRows('site_pages', srcPages.map((p) => {
    const id = randomUUID();
    pageIdMap[p.id] = id;
    return { ...omit(p, TIMESTAMPS), id, site_id: newSiteId };
  }));

  // sections (remap page_id; content/settings carried verbatim)
  const srcSections = await fetchRows('site_sections', sourceSiteId);
  await insertRows('site_sections', srcSections.map((s) => ({
    ...omit(s, TIMESTAMPS),
    id: randomUUID(),
    site_id: newSiteId,
    page_id: pageIdMap[s.page_id],
  })).filter((s) => s.page_id));

  // categories (id map for services)
  const srcCats = await fetchRows('site_service_categories', sourceSiteId);
  const catIdMap = {};
  await insertRows('site_service_categories', srcCats.map((c) => {
    const id = randomUUID();
    catIdMap[c.id] = id;
    return { ...omit(c, TIMESTAMPS), id, site_id: newSiteId };
  }));

  // services (remap category_id; null media FK, keep photo_url; id map)
  const srcServices = await fetchRows('site_services', sourceSiteId);
  const serviceIdMap = {};
  await insertRows('site_services', srcServices.map((sv) => {
    const id = randomUUID();
    serviceIdMap[sv.id] = id;
    return {
      ...omit(sv, TIMESTAMPS),
      id, site_id: newSiteId,
      category_id: sv.category_id ? catIdMap[sv.category_id] || null : null,
      photo_media_id: null,
    };
  }));

  // team members (null media FK, keep photo_url; id map)
  const srcTeam = await fetchRows('site_team_members', sourceSiteId);
  const teamIdMap = {};
  await insertRows('site_team_members', srcTeam.map((tm) => {
    const id = randomUUID();
    teamIdMap[tm.id] = id;
    return { ...omit(tm, TIMESTAMPS), id, site_id: newSiteId, photo_media_id: null };
  }));

  // team↔service links (remap both ids)
  const srcLinks = await fetchRows('site_team_service_links', sourceSiteId);
  await insertRows('site_team_service_links', srcLinks.map((l) => ({
    id: randomUUID(),
    site_id: newSiteId,
    team_member_id: teamIdMap[l.team_member_id],
    service_id: serviceIdMap[l.service_id],
  })).filter((l) => l.team_member_id && l.service_id));

  // availability rules (remap team_member_id)
  const srcAvail = await fetchRows('site_availability_rules', sourceSiteId);
  await insertRows('site_availability_rules', srcAvail.map((a) => ({
    ...omit(a, TIMESTAMPS),
    id: randomUUID(),
    site_id: newSiteId,
    team_member_id: teamIdMap[a.team_member_id],
  })).filter((a) => a.team_member_id));

  // testimonials (null media FK, keep author_photo_url)
  const srcTest = await fetchRows('site_testimonials', sourceSiteId);
  await insertRows('site_testimonials', srcTest.map((t) => ({
    ...omit(t, TIMESTAMPS),
    id: randomUUID(),
    site_id: newSiteId,
    author_photo_media_id: null,
  })));

  // theme settings — only for a design-preserving clone (see note above).
  let themeSettings = 0;
  if (cloneThemeSettings) {
    const srcTheme = await fetchRows('site_theme_settings', sourceSiteId);
    await insertRows('site_theme_settings', srcTheme.map((ts) => ({
      ...omit(ts, TIMESTAMPS),
      id: randomUUID(),
      site_id: newSiteId,
    })));
    themeSettings = srcTheme.length;
  }

  return {
    pages: srcPages.length,
    sections: srcSections.length,
    categories: srcCats.length,
    services: srcServices.length,
    team: srcTeam.length,
    links: srcLinks.length,
    availability: srcAvail.length,
    testimonials: srcTest.length,
    themeSettings,
  };
}

/**
 * Provision a new tenant site by cloning the vertical's seed site.
 *
 * @param {object} args
 * @param {string} args.vertical        vertical slug or alias (e.g. "barbers")
 * @param {string} args.companyId       companies.id (owner's business)
 * @param {string} args.ownerContactId  contacts.id (owner)
 * @param {string} args.displayName     business display name (→ subdomain base)
 * @param {string} [args.city]          for subdomain disambiguation
 * @param {string} [args.templateSlug]  pick a specific template; else default
 * @param {string} [args.createdBy]     auth user id of the actor (staff/owner)
 * @param {boolean} [args.dryRun]       resolve + report without writing
 * @returns {Promise<object>} provisioning result
 */
async function provisionSite(args) {
  const {
    vertical, companyId, ownerContactId, displayName,
    city = null, templateSlug = null, createdBy = null, dryRun = false,
  } = args;

  const vSlug = resolveVerticalSlug(vertical);
  const seedSourceId = SEED_SOURCE_BY_VERTICAL[vSlug];
  if (!seedSourceId) {
    throw new Error(`no seed source for vertical "${vertical}" (supported: ${Object.keys(SEED_SOURCE_BY_VERTICAL).join(', ')})`);
  }
  if (!dryRun && (!companyId || !ownerContactId)) {
    throw new Error('companyId and ownerContactId are required to provision a site');
  }

  // Source site (for vertical_id + the operational fields we copy forward).
  const { data: src, error: srcErr } = await supabase
    .from('sites')
    .select('id, vertical_id, booking_mode, booking_config, payment_methods, payment_message, locale, time_zone, currency, business_hours')
    .eq('id', seedSourceId)
    .single();
  if (srcErr || !src) throw new Error(`seed source ${seedSourceId} not found: ${srcErr?.message}`);

  const template = await resolveTemplate(src.vertical_id, templateSlug);
  const subdomain = await generateUniqueSubdomain(displayName, city);

  if (dryRun) {
    return {
      dryRun: true, vertical: vSlug, seedSourceId, subdomain,
      template: { id: template.id, slug: template.slug, name: template.display_name },
    };
  }

  const newSiteId = randomUUID();

  // 1) The site row (status starts at onboarding; flips to previewing once the
  //    content clone lands).
  const { error: siteErr } = await supabase.from('sites').insert({
    id: newSiteId,
    company_id: companyId,
    owner_contact_id: ownerContactId,
    vertical_id: src.vertical_id,
    template_id: template.id,
    subdomain,
    custom_domain: null,
    status: 'onboarding',
    booking_mode: src.booking_mode,
    booking_config: src.booking_config,
    payment_methods: src.payment_methods,
    payment_message: src.payment_message,
    locale: src.locale,
    time_zone: src.time_zone,
    currency: src.currency,
    business_hours: src.business_hours,
    payments_enabled: false,
    created_by: createdBy,
    metadata: {},
  });
  if (siteErr) throw new Error(`insert sites: ${siteErr.message}`);

  // From here on, any failure must roll the site back so we never leave a
  // half-cloned tenant.
  try {
    // Clone the seed's config + content (a fresh customer gets clean template
    // tokens, so theme_settings are NOT cloned — see cloneContent's note).
    const counts = await cloneContent(seedSourceId, newSiteId, { cloneThemeSettings: false });

    // Content is in place → site is previewable.
    const { error: upErr } = await supabase
      .from('sites')
      .update({ status: 'previewing' })
      .eq('id', newSiteId);
    if (upErr) throw new Error(`status→previewing: ${upErr.message}`);

    // The cloned content still references the SEED site's Cloudinary assets —
    // copy them into this site's own folder in the background (keeps
    // provisioning fast; the shared refs render fine for the seconds it takes).
    scheduleLocalizeSiteMedia(newSiteId, subdomain);

    return {
      siteId: newSiteId,
      subdomain,
      status: 'previewing',
      vertical: vSlug,
      seedSourceId,
      template: { id: template.id, slug: template.slug, name: template.display_name },
      counts,
    };
  } catch (err) {
    // Roll back the partial site so a failed provision leaves nothing behind.
    try { await deleteSiteCascade(newSiteId); } catch (cleanupErr) {
      err.message += ` | rollback also failed: ${cleanupErr.message}`;
    }
    throw err;
  }
}

// Site-row fields carried forward on a clone (design + operational config).
// Excluded on purpose: id/subdomain/custom_domain (fresh), company_id/owner
// (from args), status (managed), payments_enabled (needs a new Connect account),
// created_by/timestamps.
const CLONE_SITE_FIELDS = [
  'template_id', 'vertical_id', 'booking_mode', 'booking_config',
  'payment_methods', 'payment_message', 'locale', 'time_zone', 'currency',
  'business_hours', 'metadata',
];

/**
 * Clone ANY source site (a Starter preset, or an owner's own configured shop)
 * EXACTLY — same template, palette/variant/arrangement overrides, and full
 * catalog + content — into a new tenant site. The design-preserving sibling of
 * provisionSite: it copies the source's template_id verbatim and DOES clone
 * site_theme_settings, so the new site reproduces precisely what was previewed.
 *
 * Powers: Starter-pick onboarding, the CMS "duplicate this shop" action, the CRM
 * admin clone, and Stacy's clone tool — one path, four callers.
 *
 * @param {object} args
 * @param {string} args.sourceSiteId    the site to clone FROM (Starter / own shop)
 * @param {string} args.companyId       companies.id for the NEW site's owner
 * @param {string} args.ownerContactId  contacts.id (owner of the new site)
 * @param {string} args.displayName     business name for the new site (→ subdomain)
 * @param {string} [args.city]          subdomain disambiguation
 * @param {string} [args.status]        starting status (default 'previewing')
 * @param {string} [args.createdBy]     auth user id of the actor
 * @param {boolean} [args.dryRun]       resolve + report without writing
 * @returns {Promise<object>} clone result
 */
async function cloneSite(args) {
  const {
    sourceSiteId, companyId, ownerContactId, displayName,
    city = null, status = 'previewing', createdBy = null, dryRun = false,
  } = args;

  if (!sourceSiteId) throw new Error('sourceSiteId is required to clone a site');
  if (!dryRun && (!companyId || !ownerContactId || !displayName)) {
    throw new Error('companyId, ownerContactId and displayName are required to clone a site');
  }

  const { data: src, error: srcErr } = await supabase
    .from('sites')
    .select(['id', 'subdomain', ...CLONE_SITE_FIELDS].join(', '))
    .eq('id', sourceSiteId)
    .single();
  if (srcErr || !src) throw new Error(`clone source ${sourceSiteId} not found: ${srcErr?.message}`);

  const subdomain = await generateUniqueSubdomain(displayName || src.subdomain, city);

  if (dryRun) {
    return { dryRun: true, sourceSiteId, subdomain, templateId: src.template_id };
  }

  const newSiteId = randomUUID();
  const siteRow = { id: newSiteId, company_id: companyId, owner_contact_id: ownerContactId, subdomain,
    custom_domain: null, status: 'onboarding', payments_enabled: false, created_by: createdBy };
  for (const f of CLONE_SITE_FIELDS) siteRow[f] = src[f];

  const { error: siteErr } = await supabase.from('sites').insert(siteRow);
  if (siteErr) throw new Error(`insert sites: ${siteErr.message}`);

  try {
    const counts = await cloneContent(sourceSiteId, newSiteId, { cloneThemeSettings: true });

    const { error: upErr } = await supabase.from('sites').update({ status }).eq('id', newSiteId);
    if (upErr) throw new Error(`status→${status}: ${upErr.message}`);

    // Give the clone its OWN copies of the source's Cloudinary assets (see
    // localizeSiteMedia — fixes the cross-site shared-reference trap).
    scheduleLocalizeSiteMedia(newSiteId, subdomain);

    return { siteId: newSiteId, subdomain, status, sourceSiteId, templateId: src.template_id, counts };
  } catch (err) {
    try { await deleteSiteCascade(newSiteId); } catch (cleanupErr) {
      err.message += ` | rollback also failed: ${cleanupErr.message}`;
    }
    throw err;
  }
}

module.exports = {
  provisionSite,
  cloneSite,
  cloneContent,
  deleteSiteCascade,
  generateUniqueSubdomain,
  resolveTemplate,
  slugify,
  resolveVerticalSlug,
  SEED_SOURCE_BY_VERTICAL,
};
