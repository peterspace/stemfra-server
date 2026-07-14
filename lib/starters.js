// Starters — curated, previewable "sample sites" a prospect can pick during
// onboarding. Picking one provisions their site by CLONING it (cloneSite), so
// their default data is EXACTLY what they previewed. See
// stemfra_platform/docs/CLONING_AND_STARTERS.md.
//
// A Starter is any site flagged `metadata.is_starter === true`. Using the
// existing JSONB flag (no schema change) doubles as the SECURITY whitelist: the
// public signup endpoint may only clone flagged sample sites, never an arbitrary
// (real customer) site id. Curate the catalog by flagging/unflagging sites
// (metadata.starter_label optionally sets the display name; metadata.starter_order
// sorts).
const supabase = require('../config/supabase');
const { resolveVerticalSlug } = require('./verticalConfig');

const ZONE = 'stemfra.com';
// A Starter source must be in a state whose rows are complete + safe to clone.
const CLONEABLE_STATUSES = new Set(['template', 'previewing', 'live']);

function previewUrlFor(site) {
  return `https://${site.custom_domain || `${site.subdomain}.${ZONE}`}`;
}

// List the published Starter catalog (optionally filtered to one vertical).
async function listStarters({ vertical = null } = {}) {
  const { data, error } = await supabase
    .from('sites')
    .select('id, subdomain, custom_domain, status, vertical_id, template_id, metadata, vertical:verticals(slug), template:templates(display_name), company:companies(name)')
    .filter('metadata->>is_starter', 'eq', 'true')
    // Soft-delete keeps status='live' (deleted_at is the marker) — without this
    // a deleted demo would stay in the catalog. Service-role bypasses RLS, so
    // the anon deleted_at policy does NOT cover this path.
    .is('deleted_at', null);
  if (error) throw new Error(`list starters: ${error.message}`);

  const wantVertical = vertical ? resolveVerticalSlug(vertical) : null;
  return (data || [])
    .filter((s) => CLONEABLE_STATUSES.has(s.status))
    .filter((s) => !wantVertical || s.vertical?.slug === wantVertical)
    .map((s) => ({
      id: s.id,
      vertical: s.vertical?.slug || null,
      theme: s.template?.display_name || null,
      // LIVE company name by default — a brand rename flows here automatically
      // (Mockups demo list, marketing theme cards, onboarding catalog).
      // metadata.starter_label stays as an OPTIONAL curation override; frozen
      // snapshots of it went stale after the demo rename pass (9 of 16 wrong),
      // so only set it when the display name must differ from the brand.
      label: (s.metadata && s.metadata.starter_label) || s.company?.name || s.subdomain,
      order: (s.metadata && Number(s.metadata.starter_order)) || 0,
      // ONE demo per vertical may be flagged Featured (CRM Demo catalog) — it
      // drives the marketing site's showcase surfaces (e.g. the Products
      // drawer tablet). Set via POST /api/admin/mockups/featured (exclusive).
      featured: !!(s.metadata && s.metadata.is_featured_demo),
      previewUrl: previewUrlFor(s),
    }))
    .sort((a, b) => a.order - b.order || a.label.localeCompare(b.label));
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Whitelist guard: return the Starter site row iff `ref` is an approved, cloneable
// Starter; else null. `ref` may be a site id (uuid) OR a subdomain (the marketing
// theme cards carry the human-readable subdomain). The public onboarding path
// MUST call this before cloning so a signup can't clone an arbitrary site.
async function getApprovedStarter(ref) {
  if (!ref) return null;
  const column = UUID_RE.test(String(ref)) ? 'id' : 'subdomain';
  const { data, error } = await supabase
    .from('sites')
    .select('id, status, deleted_at, vertical_id, metadata, vertical:verticals(slug)')
    .eq(column, ref)
    .maybeSingle();
  if (error) throw new Error(`starter lookup: ${error.message}`);
  if (!data) return null;
  const isStarter = data.metadata && data.metadata.is_starter === true;
  // A soft-deleted site must never be listed OR cloned (status stays 'live').
  if (!isStarter || data.deleted_at || !CLONEABLE_STATUSES.has(data.status)) return null;
  return data;
}

module.exports = { listStarters, getApprovedStarter, previewUrlFor };
