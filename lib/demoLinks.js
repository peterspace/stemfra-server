// Canonical vertical → live demo-site URL map (single source of truth).
//
// Mark's lead-gen outreach drops a vertical-matched demo link so a prospect can
// see a real, polished example of their own kind of business before they ever
// reply. The demo sites are owned by the "Stemfra Demos" account (mark@) and
// each is a live {subdomain}.stemfra.com (see docs/DEMOS.md). One FLAGSHIP demo
// per vertical is used for the email link; the other per-theme demos exist for
// variety / manual sharing.
//
// Slugs are a mess across the stack (DB verticals.slug = barbershops/salons/...,
// lead-gen KNOWN_VERTICALS = barbershop/beauty_salon/..., CRM lead.template_slug
// = barber/home/...). resolveDemoLink() normalizes ALL of those forms.

const FLAGSHIP = {
  barbershop:   'https://rourke-sloane.stemfra.com',          // Manhattan theme
  beauty_salon: 'https://linden-lark.stemfra.com',            // Sorrel theme
  crossfit:     'https://ironclad-athletics.stemfra.com',     // Box theme (default)
  yoga_pilates: 'https://wildflower-yoga-pilates.stemfra.com',// Sanctuary theme
};

// Any input slug form → the canonical lead-gen vertical key.
const ALIASES = {
  barber: 'barbershop', barbers: 'barbershop', barbershop: 'barbershop', barbershops: 'barbershop',
  salon: 'beauty_salon', salons: 'beauty_salon', beauty: 'beauty_salon', beauty_salon: 'beauty_salon', beauty_salons: 'beauty_salon',
  crossfit: 'crossfit', crossfit_box: 'crossfit',
  yoga: 'yoga_pilates', pilates: 'yoga_pilates', yoga_pilates: 'yoga_pilates',
};

// Resolve a demo URL from any vertical/template slug. Returns null if unknown
// (e.g. lead.template_slug = 'home') so callers can leave the merge field blank.
function resolveDemoLink(slug) {
  if (!slug) return null;
  const key = ALIASES[String(slug).toLowerCase().trim()];
  return key ? FLAGSHIP[key] || null : null;
}

// Fill the link-style merge fields in an outreach body. Per-lead text fields
// (first_name/business_name/etc.) are filled upstream by the drafter; this only
// resolves the two derived links so {{demo_link}} works on auto-sent templates.
// Unknown demo links collapse to the homepage so no raw {{demo_link}} ever ships.
function fillOutreachLinks(text, { templateSlug } = {}) {
  if (!text) return text;
  const demo = resolveDemoLink(templateSlug) || 'https://stemfra.com';
  return String(text)
    .replace(/\{\{\s*demo_link\s*\}\}/g, demo)
    .replace(/\{\{\s*start_free_link\s*\}\}/g, 'https://stemfra.com/pricing');
}

module.exports = { FLAGSHIP, resolveDemoLink, fillOutreachLinks };
