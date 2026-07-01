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
    .select('id, subdomain, custom_domain, status, vertical_id, template_id, metadata, vertical:verticals(slug), template:templates(display_name)')
    .filter('metadata->>is_starter', 'eq', 'true');
  if (error) throw new Error(`list starters: ${error.message}`);

  const wantVertical = vertical ? resolveVerticalSlug(vertical) : null;
  return (data || [])
    .filter((s) => CLONEABLE_STATUSES.has(s.status))
    .filter((s) => !wantVertical || s.vertical?.slug === wantVertical)
    .map((s) => ({
      id: s.id,
      vertical: s.vertical?.slug || null,
      theme: s.template?.display_name || null,
      label: (s.metadata && s.metadata.starter_label) || s.subdomain,
      order: (s.metadata && Number(s.metadata.starter_order)) || 0,
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
    .select('id, status, vertical_id, metadata, vertical:verticals(slug)')
    .eq(column, ref)
    .maybeSingle();
  if (error) throw new Error(`starter lookup: ${error.message}`);
  if (!data) return null;
  const isStarter = data.metadata && data.metadata.is_starter === true;
  if (!isStarter || !CLONEABLE_STATUSES.has(data.status)) return null;
  return data;
}

module.exports = { listStarters, getApprovedStarter, previewUrlFor };
