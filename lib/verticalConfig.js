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
  // Deferred — most gyms already have sites at launch. No project/seed; not
  // offered for provisioning or lead-gen until built.
  boutique_gyms:{ project: null, seedSite: null, leadgen: 'boutique_gym', aliases: ['gyms', 'boutique_gym'], deferred: true },
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
