// Personalize a freshly cloned tenant site (2026-08-20, Peter: "tenants must
// not go live with the demo's identity; business name, addresses, phone and
// email have to be theirs, and the business name should come from onboarding").
//
// A signup clones a Starter (e.g. Argyle & Sons) EXACTLY so the owner gets the
// site they previewed. That copy still carries the demo's identity in a few
// content strings: the Location card title ("Argyle & Sons, Midtown West"),
// the About story heading ("Argyle & Sons NYC"), footer blurbs, etc. Here we:
//   1. record where the site was cloned from (metadata.cloned_from) so the
//      publish gate can compare against the REAL source, not a guessed seed;
//   2. swap the source company's name for the tenant's in every section text
//      (exact, case-insensitive, whole-phrase; i18n objects included) and set
//      the Location card title to the tenant's name;
//   3. leave address / phone / email as they are: the publish gate (lib/
//      siteCompleteness.js) makes the owner replace them before going live,
//      and Stacy's "Add your contact details" step collects them.
// Best-effort: a failure here never fails signup (the gate still catches it).
const supabase = require('../config/supabase');

function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

/** Replace `from` with `to` inside every string of a JSON value (deep). */
function deepReplace(value, re, to) {
  if (typeof value === 'string') return value.replace(re, to);
  if (Array.isArray(value)) return value.map((v) => deepReplace(v, re, to));
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = deepReplace(v, re, to);
    return out;
  }
  return value;
}

/**
 * @param {string} siteId the NEW site
 * @param {{ sourceSiteId: string, companyName: string }} opts
 * @returns {{ sectionsUpdated: number, sourceName: string|null }}
 */
async function personalizeClone(siteId, { sourceSiteId, companyName }) {
  const out = { sectionsUpdated: 0, sourceName: null };
  if (!siteId || !sourceSiteId || !companyName) return out;

  // 1) Remember the source (publish gate compares against it).
  const { data: cur } = await supabase.from('sites').select('metadata').eq('id', siteId).single();
  await supabase.from('sites').update({ metadata: { ...(cur?.metadata || {}), cloned_from: sourceSiteId } }).eq('id', siteId);

  // 2) Source identity.
  const { data: src } = await supabase.from('sites').select('company:companies(name)').eq('id', sourceSiteId).maybeSingle();
  const sourceName = src?.company?.name?.trim();
  out.sourceName = sourceName || null;
  if (!sourceName || sourceName.toLowerCase() === companyName.trim().toLowerCase()) return out;

  // "Argyle & Sons" also appears HTML-escaped in rich text ("Argyle &amp; Sons").
  const variants = [sourceName, sourceName.replace(/&/g, '&amp;')].filter((v, i, a) => a.indexOf(v) === i);
  const re = new RegExp(variants.map(escapeRe).join('|'), 'gi');

  const { data: sections } = await supabase.from('site_sections').select('id, section_type, content').eq('site_id', siteId);
  for (const s of sections || []) {
    let content = s.content;
    const before = JSON.stringify(content);
    content = deepReplace(content, re, companyName);
    if (s.section_type === 'location_map' && content && typeof content === 'object') {
      // Location card title = the tenant's business name (the demo's "Argyle &
      // Sons, Midtown West" would otherwise survive even if the name differs).
      content = { ...content, name: companyName };
    }
    if (JSON.stringify(content) !== before) {
      const { error } = await supabase.from('site_sections').update({ content }).eq('id', s.id);
      if (!error) out.sectionsUpdated += 1;
    }
  }
  return out;
}

module.exports = { personalizeClone };
