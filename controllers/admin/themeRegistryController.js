// Theme-component registry endpoint (Case 6 R1) — the CRM "Components" browser.
// Joins the static variant registry (lib/variantRegistry.js) with LIVE usage
// from the `templates` table (which theme uses which variant) + each theme's
// Starter demo site, so every variant card can link to a real page rendering it.
// NOTE: config/supabase.js exports the client directly (single-var require).
const supabase = require('../../config/supabase');
const { VARIANT_REGISTRY } = require('../../lib/variantRegistry');

// GET /api/admin/theme-registry
// → { registry, usage: { [archetypeKey]: { [variant]: ThemeUse[] } }, themes, generatedAt }
async function getThemeRegistry(_req, res) {
  try {
    const [{ data: templates, error: tErr }, { data: sites, error: sErr }] = await Promise.all([
      supabase
        .from('templates')
        .select('id, slug, display_name, is_active, is_default, archetype_variants, vertical:verticals(slug, display_name)'),
      supabase
        .from('sites')
        .select('subdomain, template_id, metadata')
        .is('deleted_at', null),
    ]);
    if (tErr) throw tErr;
    if (sErr) throw sErr;

    // First Starter demo per template → a live page that renders its variants.
    const demoByTemplate = new Map();
    for (const s of sites || []) {
      const isStarter = s.metadata && s.metadata.is_starter === true;
      if (isStarter && s.template_id && !demoByTemplate.has(s.template_id)) {
        demoByTemplate.set(s.template_id, `https://${s.subdomain}.stemfra.com`);
      }
    }

    const themes = (templates || []).map((t) => ({
      slug: t.slug,
      name: t.display_name,
      vertical: t.vertical?.slug || null,
      verticalName: t.vertical?.display_name || null,
      active: t.is_active === true,
      isDefault: t.is_default === true,
      demoUrl: demoByTemplate.get(t.id) || null,
    }));
    const themeBySlug = new Map(themes.map((t) => [t.slug, t]));

    // usage[archetypeKey][variant] = themes whose archetype_variants declare it.
    // (Themes that omit a key fall back to 'default' implicitly — the UI notes
    // this rather than us fabricating implicit rows.)
    const usage = {};
    for (const t of templates || []) {
      const av = t.archetype_variants;
      if (!av || typeof av !== 'object') continue;
      for (const [key, variant] of Object.entries(av)) {
        if (typeof variant !== 'string') continue; // nav_mode-style flags ride in the same JSONB
        (usage[key] ??= {})[variant] ??= [];
        const theme = themeBySlug.get(t.slug);
        if (theme) usage[key][variant].push(theme);
      }
    }

    res.json({ registry: VARIANT_REGISTRY, usage, themes, generatedAt: new Date().toISOString() });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

module.exports = { getThemeRegistry };
