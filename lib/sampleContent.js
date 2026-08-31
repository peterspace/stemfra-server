// Sample-content detection (friction fix #2, 2026-09-01). A fresh site is a
// clone of a demo, so its sections look finished while still carrying the
// demo's words — the realistic failure is publishing with sample copy live.
// This compares each of the tenant's sections against the same section on the
// clone source (metadata.cloned_from, else the vertical seed) and reports the
// ones whose TEXT is still the demo's, so the CMS can badge them "Sample".
// A section clears the badge on its first real edit (the text diverges).
//
// clonePersonalize rewrites the demo's brand name into the tenant's at signup,
// so raw content equality would under-report; we compare the concatenated
// string values with each site's own brand name masked out.
const supabase = require('../config/supabase');
const { SEED_SOURCE_BY_VERTICAL } = require('./provisionSite');

// Recursively collect every string value inside a section's content JSONB.
function collectText(v, out) {
  if (typeof v === 'string') { out.push(v); return; }
  if (Array.isArray(v)) { for (const x of v) collectText(x, out); return; }
  if (v && typeof v === 'object') {
    for (const k of Object.keys(v).sort()) collectText(v[k], out);
  }
}

function textOf(content, brand) {
  const parts = [];
  collectText(content, parts);
  let t = parts.join('\n').toLowerCase().replace(/\s+/g, ' ').trim();
  if (brand) t = t.split(String(brand).toLowerCase()).join('@brand@');
  return t;
}

async function loadSections(siteId) {
  const { data, error } = await supabase
    .from('site_sections')
    .select('id, section_type, content, display_order, page:site_pages(slug)')
    .eq('site_id', siteId)
    .order('display_order');
  if (error) throw new Error(`sections ${siteId}: ${error.message}`);
  return data || [];
}

async function brandOf(siteId) {
  const { data } = await supabase
    .from('sites').select('company:companies(name)').eq('id', siteId).single();
  return data?.company?.name || '';
}

/**
 * @returns {{ sampleSectionIds: string[] }} ids of the tenant's sections whose
 *   text still equals the clone source's (empty when no source resolves).
 */
async function evaluateSampleSections(siteId) {
  const { data: site, error } = await supabase
    .from('sites')
    .select('id, metadata, vertical:verticals(slug), company:companies(name)')
    .eq('id', siteId)
    .single();
  if (error || !site) throw new Error(`site ${siteId} not found: ${error?.message}`);

  const sourceId = site.metadata?.cloned_from || SEED_SOURCE_BY_VERTICAL[site.vertical?.slug];
  if (!sourceId || sourceId === siteId) return { sampleSectionIds: [] };

  const [tenantSecs, seedSecs, seedBrand] = await Promise.all([
    loadSections(siteId), loadSections(sourceId), brandOf(sourceId),
  ]);
  const tenantBrand = site.company?.name || '';

  // Match by (page slug, section_type, occurrence index among that type on the
  // page) — clones preserve section order, so positional matching holds.
  const index = new Map();
  const keyFor = (s, counters) => {
    const base = `${s.page?.slug || ''}:${s.section_type}`;
    const n = (counters.get(base) || 0);
    counters.set(base, n + 1);
    return `${base}:${n}`;
  };
  const seedCounters = new Map();
  for (const s of seedSecs) index.set(keyFor(s, seedCounters), s);

  const sampleSectionIds = [];
  const tenantCounters = new Map();
  for (const s of tenantSecs) {
    const seed = index.get(keyFor(s, tenantCounters));
    if (!seed) continue;
    const t = textOf(s.content, tenantBrand);
    if (!t) continue; // nothing textual to personalize
    if (t === textOf(seed.content, seedBrand)) sampleSectionIds.push(s.id);
  }
  return { sampleSectionIds };
}

module.exports = { evaluateSampleSections };
