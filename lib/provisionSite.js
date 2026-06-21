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

// The polished fixtures double as the canonical seed source per vertical (v1).
// Keyed by verticals.slug. boutique_gyms has no template app (deferred).
const SEED_SOURCE_BY_VERTICAL = {
  barbershops:  '00000000-0000-4000-a000-000000000003', // argyle-and-sons
  salons:       '00000000-0000-4000-b000-000000000003', // maison-lune
  crossfit:     '00000000-0000-4000-c000-000000000003', // forge-and-bell
  yoga_pilates: '00000000-0000-4000-d000-000000000003', // lila-studio
};

// Friendly aliases → canonical vertical slug.
const VERTICAL_ALIASES = {
  barbers: 'barbershops', barbershop: 'barbershops',
  salon: 'salons',
  yoga: 'yoga_pilates', pilates: 'yoga_pilates', yoga_pilates: 'yoga_pilates',
  gyms: 'boutique_gyms', boutique_gyms: 'boutique_gyms',
};

const resolveVerticalSlug = (v) => VERTICAL_ALIASES[String(v || '').toLowerCase()] || String(v || '').toLowerCase();

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

// Reverse-FK-order delete. Doubles as rollback on a failed clone and as the
// script's --cleanup. Children first, site last.
async function deleteSiteCascade(siteId) {
  for (const table of [
    'subscriptions',
    'site_team_service_links',
    'site_availability_rules',
    'site_services',
    'site_service_categories',
    'site_team_members',
    'site_testimonials',
    'site_sections',
    'site_pages',
    'site_theme_settings',
  ]) {
    const { error } = await supabase.from(table).delete().eq('site_id', siteId);
    if (error) throw new Error(`cleanup ${table}: ${error.message}`);
  }
  const { error } = await supabase.from('sites').delete().eq('id', siteId);
  if (error) throw new Error(`cleanup sites: ${error.message}`);
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
    // 2) pages (build id map for sections)
    const srcPages = await fetchRows('site_pages', seedSourceId);
    const pageIdMap = {};
    await insertRows('site_pages', srcPages.map((p) => {
      const id = randomUUID();
      pageIdMap[p.id] = id;
      return { ...omit(p, TIMESTAMPS), id, site_id: newSiteId };
    }));

    // 3) sections (remap page_id; content/settings carried verbatim)
    const srcSections = await fetchRows('site_sections', seedSourceId);
    await insertRows('site_sections', srcSections.map((s) => ({
      ...omit(s, TIMESTAMPS),
      id: randomUUID(),
      site_id: newSiteId,
      page_id: pageIdMap[s.page_id],
    })).filter((s) => s.page_id));

    // 4) categories (id map for services)
    const srcCats = await fetchRows('site_service_categories', seedSourceId);
    const catIdMap = {};
    await insertRows('site_service_categories', srcCats.map((c) => {
      const id = randomUUID();
      catIdMap[c.id] = id;
      return { ...omit(c, TIMESTAMPS), id, site_id: newSiteId };
    }));

    // 5) services (remap category_id; null media FK, keep photo_url; id map)
    const srcServices = await fetchRows('site_services', seedSourceId);
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

    // 6) team members (null media FK, keep photo_url; id map)
    const srcTeam = await fetchRows('site_team_members', seedSourceId);
    const teamIdMap = {};
    await insertRows('site_team_members', srcTeam.map((tm) => {
      const id = randomUUID();
      teamIdMap[tm.id] = id;
      return { ...omit(tm, TIMESTAMPS), id, site_id: newSiteId, photo_media_id: null };
    }));

    // 7) team↔service links (remap both ids)
    const srcLinks = await fetchRows('site_team_service_links', seedSourceId);
    await insertRows('site_team_service_links', srcLinks.map((l) => ({
      id: randomUUID(),
      site_id: newSiteId,
      team_member_id: teamIdMap[l.team_member_id],
      service_id: serviceIdMap[l.service_id],
    })).filter((l) => l.team_member_id && l.service_id));

    // 8) availability rules (remap team_member_id)
    const srcAvail = await fetchRows('site_availability_rules', seedSourceId);
    await insertRows('site_availability_rules', srcAvail.map((a) => ({
      ...omit(a, TIMESTAMPS),
      id: randomUUID(),
      site_id: newSiteId,
      team_member_id: teamIdMap[a.team_member_id],
    })).filter((a) => a.team_member_id));

    // 9) testimonials (null media FK, keep author_photo_url)
    const srcTest = await fetchRows('site_testimonials', seedSourceId);
    await insertRows('site_testimonials', srcTest.map((t) => ({
      ...omit(t, TIMESTAMPS),
      id: randomUUID(),
      site_id: newSiteId,
      author_photo_media_id: null,
    })));

    // Content is in place → site is previewable.
    const { error: upErr } = await supabase
      .from('sites')
      .update({ status: 'previewing' })
      .eq('id', newSiteId);
    if (upErr) throw new Error(`status→previewing: ${upErr.message}`);

    const counts = {
      pages: srcPages.length,
      sections: srcSections.length,
      categories: srcCats.length,
      services: srcServices.length,
      team: srcTeam.length,
      links: srcLinks.length,
      availability: srcAvail.length,
      testimonials: srcTest.length,
    };

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

module.exports = {
  provisionSite,
  deleteSiteCascade,
  generateUniqueSubdomain,
  resolveTemplate,
  slugify,
  resolveVerticalSlug,
  SEED_SOURCE_BY_VERTICAL,
};
