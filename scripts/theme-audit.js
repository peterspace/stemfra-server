// Theme completeness audit — the mechanical half of the THEME_SYSTEM.md §7
// "completeness gate". Run it against a template (or all active templates) BEFORE
// the visual walk to catch the checkable gaps: base tokens, accidentally-authored
// derived tokens, a present home arrangement, the stale-site-override trap, and
// seed completeness on the theme's sites. The subjective half (distinctness, no
// hardcoded content, every-rendered-archetype-has-a-variant) prints as a checklist.
//
// Run from the server dir:
//   node scripts/theme-audit.js                 # summary of every active template
//   node scripts/theme-audit.js salons-sorrel   # full audit of one template + its sites
require('dotenv').config();
const supabase = require('../config/supabase');

// The frozen token contract (mirror of packages/site-data/src/theme.ts).
const BASE_COLOR_KEYS = ['background_color', 'text_color', 'primary_color', 'accent_color'];
const FONT_KEYS = ['display_font', 'body_font'];
const TIER1_EXTRAS = ['paper', 'deep']; // recommended for a complete palette
const DERIVED_KEYS = ['on-accent', 'on-deep', 'on-band', 'on-paper', 'paper-hairline', 'hairline', 'color-scheme'];
// site_theme_settings columns that SHADOW a template token (the stale-override trap).
const OVERRIDE_COLS = [...BASE_COLOR_KEYS, ...FONT_KEYS];
// Inner pages whose header comes from a seeded `intro` section.
const INNER_PAGES = ['about', 'services', 'contact', 'book'];

const ok = (m) => `  \x1b[32m[✓]\x1b[0m ${m}`;
const warn = (m) => `  \x1b[33m[!]\x1b[0m ${m}`;
const bad = (m) => `  \x1b[31m[✗]\x1b[0m ${m}`;
const filled = (v) => typeof v === 'string' && v.trim().length > 0;

async function auditTemplate(t, { deep }) {
  const tokens = t.design_tokens || {};
  const av = t.archetype_variants || {};
  const lines = [];
  let problems = 0;

  // ── Tokens ────────────────────────────────────────────────────────────────
  const missingBase = BASE_COLOR_KEYS.filter((k) => !filled(tokens[k]));
  const missingFonts = FONT_KEYS.filter((k) => !filled(tokens[k]));
  lines.push(missingBase.length ? bad(`base color tokens missing: ${missingBase.join(', ')}`) : ok('base color tokens (4/4)'));
  lines.push(missingFonts.length ? bad(`fonts missing: ${missingFonts.join(', ')}`) : ok('fonts (display + body)'));
  problems += missingBase.length + missingFonts.length;

  const missingExtras = TIER1_EXTRAS.filter((k) => !filled(tokens[k]));
  if (missingExtras.length) lines.push(warn(`recommended extras unset: ${missingExtras.join(', ')} (dark bands / cards may fall back)`));

  const authoredDerived = DERIVED_KEYS.filter((k) => k in tokens);
  if (authoredDerived.length) { lines.push(bad(`authored DERIVED tokens (computed — remove): ${authoredDerived.join(', ')}`)); problems += authoredDerived.length; }
  else lines.push(ok('no authored derived tokens'));

  // ── Arrangement ─────────────────────────────────────────────────────────────
  const arr = t.home_arrangement;
  if (Array.isArray(arr) && arr.length) lines.push(ok(`home_arrangement present (${arr.length} sections)`));
  else lines.push(warn('no home_arrangement — home renders every section row in display_order'));

  // ── Sites on this theme (stale overrides + seed completeness) ───────────────
  if (deep) {
    const { data: sites } = await supabase
      .from('sites')
      .select('id, subdomain, status')
      .eq('template_id', t.id);
    lines.push(`  ── sites on this theme: ${sites?.length ?? 0} ──`);
    for (const s of sites ?? []) {
      const { data: sts } = await supabase.from('site_theme_settings').select('*').eq('site_id', s.id).maybeSingle();
      const meta = sts?.metadata || {};
      const shadow = OVERRIDE_COLS.filter((c) => filled(sts?.[c]));
      const extrasShadow = Object.keys(meta.color_extras || {});
      if (shadow.length || extrasShadow.length) {
        lines.push(warn(`${s.subdomain}: site override shadows template — ${[...shadow, ...extrasShadow.map((e) => `extras.${e}`)].join(', ')} (stale-override trap — verify intentional)`));
      } else {
        lines.push(ok(`${s.subdomain}: no stale override (inherits template tokens)`));
      }
      // Seed: home location_map content + inner-page intros.
      const { data: pages } = await supabase.from('site_pages').select('id, slug').eq('site_id', s.id);
      const bySlug = Object.fromEntries((pages ?? []).map((p) => [p.slug, p.id]));
      const home = bySlug['home'];
      if (home) {
        const { data: loc } = await supabase.from('site_sections').select('content').eq('page_id', home).eq('section_type', 'location_map').maybeSingle();
        const c = loc?.content || {};
        const locSeeded = filled(c.name) && filled(c.address) && filled(c.phone);
        lines.push((locSeeded ? ok : warn)(`${s.subdomain}: home location ${locSeeded ? 'seeded' : 'INCOMPLETE (name/address/phone)'}`));
      }
      const missingIntros = [];
      for (const slug of INNER_PAGES) {
        if (!bySlug[slug]) continue;
        const { data: intro } = await supabase.from('site_sections').select('id').eq('page_id', bySlug[slug]).eq('section_type', 'intro').maybeSingle();
        if (!intro) missingIntros.push(slug);
      }
      if (missingIntros.length) lines.push(warn(`${s.subdomain}: inner pages without a seeded intro header: ${missingIntros.join(', ')}`));
    }
  }

  return { lines, problems };
}

async function main() {
  const slug = process.argv[2];
  const q = supabase.from('templates').select('id, slug, design_tokens, archetype_variants, home_arrangement, is_active').order('slug');
  const { data: templates, error } = slug ? await q.eq('slug', slug) : await q.eq('is_active', true);
  if (error) { console.error('Query failed:', error.message); process.exit(1); }
  if (!templates?.length) { console.error(slug ? `No template "${slug}".` : 'No active templates.'); process.exit(1); }

  for (const t of templates) {
    console.log(`\n\x1b[1mTheme audit: ${t.slug}\x1b[0m${t.is_active ? '' : ' (inactive)'}`);
    const { lines } = await auditTemplate(t, { deep: !!slug });
    lines.forEach((l) => console.log(l));
  }

  if (slug) {
    console.log('\n\x1b[1mManual checklist\x1b[0m (not auto-checkable — verify in the walk):');
    console.log('  [ ] every archetype every page renders has a variant set (see docs/THEME_VARIANTS.md)');
    console.log('  [ ] no hardcoded tenant content in the template code for this theme');
    console.log('  [ ] every page has an intended treatment (no page inheriting a bare default by accident)');
    console.log('  [ ] distinctness: own palette · own fonts · own scale · distinct hero/services/reviews · inner pages in the same voice');
  } else {
    console.log('\nRun `node scripts/theme-audit.js <slug>` for a full per-site audit + checklist.');
  }
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
