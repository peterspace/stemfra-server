// SINGLE SOURCE OF TRUTH for vertical config (server-side). Previously duplicated
// across attachSiteDomain.js (VERTICAL_PROJECT), provisionSite.js
// (SEED_SOURCE_BY_VERTICAL + VERTICAL_ALIASES), demoLinks.js (ALIASES), and
// routes/leadgen.js (KNOWN_VERTICALS) — which had to be hand-kept in sync.
// Everything now derives from VERTICALS below.
//
// Keys are the canonical DB `verticals.slug`. `deferred` verticals have no Pages
// project / seed site and are excluded from lead-gen + provisioning.
// (The CMS DomainSection.tsx keeps its own small copy — different repo/runtime.)
const VERTICALS = {
  barbershops:  { project: 'stemfra-barbers',  seedSite: '00000000-0000-4000-a000-000000000003', leadgen: 'barbershop',   aliases: ['barber', 'barbers', 'barbershop'] },
  salons:       { project: 'stemfra-salons',   seedSite: '00000000-0000-4000-b000-000000000003', leadgen: 'beauty_salon', aliases: ['salon', 'beauty_salon', 'beauty_salons', 'beauty'] },
  crossfit:     { project: 'stemfra-crossfit', seedSite: '00000000-0000-4000-c000-000000000003', leadgen: 'crossfit',     aliases: ['crossfit_box'] },
  yoga_pilates: { project: 'stemfra-yoga',     seedSite: '00000000-0000-4000-d000-000000000003', leadgen: 'yoga_pilates', aliases: ['yoga', 'pilates'] },
  // Wellness pillar (2026-07-04) — massage replaces the retired boutique_gyms plan.
  // Seed = calm-roots-massage, cloned from the yoga seed (generated UUID, not a
  // sentinel — created via onboardCustomer, not hand-seeded SQL). Pages project
  // 'stemfra-massage' must exist in Cloudflare before prod domains attach.
  massage:      { project: 'stemfra-massage',  seedSite: '9a505f8e-6c2a-4618-bca8-fd944bbe1cc6', leadgen: 'massage',      aliases: ['massage_studio', 'massage_therapy', 'bodywork'] },
  // Deferred — spa is built AFTER massage completes (cloned from it), see the
  // parked `spa` verticals/templates rows in the DB. boutique_gyms retired
  // 2026-07-04 (replaced by the wellness pillar); its inactive DB row remains.
  spa:          { project: null, seedSite: null, leadgen: 'spa', aliases: ['spas', 'day_spa', 'spa_wellness'], deferred: true },
};

// Any slug form (DB plural, lead-gen, marketing, alias) → canonical DB slug.
const ALIAS_TO_CANONICAL = (() => {
  const m = {};
  for (const [canonical, v] of Object.entries(VERTICALS)) {
    m[canonical] = canonical;
    for (const a of v.aliases) m[a] = canonical;
  }
  return m;
})();

function resolveVerticalSlug(input) {
  const s = String(input || '').toLowerCase().trim();
  return ALIAS_TO_CANONICAL[s] || s; // fall back to the input (preserves prior behavior)
}

function configFor(input) {
  return VERTICALS[resolveVerticalSlug(input)] || null;
}

// The Cloudflare Pages project that serves a vertical (throws if none — mirrors
// the prior projectFor in attachSiteDomain.js).
function projectFor(input) {
  const v = configFor(input);
  if (!v || !v.project) throw new Error(`no Pages project mapped for vertical "${input}"`);
  return v.project;
}

// The seed site to clone for a vertical (null if none → provisionSite errors clearly).
function seedSourceFor(input) {
  const v = configFor(input);
  return v ? v.seedSite : null;
}

// Lead-gen allow-list: the leadgen slugs of all NON-deferred verticals.
const KNOWN_VERTICALS = new Set(
  Object.values(VERTICALS).filter((v) => !v.deferred).map((v) => v.leadgen),
);

// project map (canonical slug → project) for any consumer that wants the raw map.
const VERTICAL_PROJECT = Object.fromEntries(
  Object.entries(VERTICALS).filter(([, v]) => v.project).map(([k, v]) => [k, v.project]),
);

module.exports = { VERTICALS, resolveVerticalSlug, configFor, projectFor, seedSourceFor, KNOWN_VERTICALS, VERTICAL_PROJECT };
