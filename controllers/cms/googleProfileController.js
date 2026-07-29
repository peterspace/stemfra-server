// CMS "Google Business Profile" surface (Task #23 — GBP linkage). The lead-gen
// funnel targets local businesses that HAVE a Google listing (rating/presence)
// but NO website; once we publish their site, its value is only realized when
// the GBP points at it. This endpoint gives an owner everything they need to
// either CONNECT their existing listing (website field + appointment link + NAP
// consistency) or CREATE one from scratch — and records their progress.
//
// No Google API in v1 (that needs platform-scale approval); this is the
// high-touch guidance surface + a place to store the owner's status.
const supabase = require('../../config/supabase');
const { verifySiteOwnership } = require('../../middleware/cmsAuth');

function siteWebsite(site) {
  return `https://${site.custom_domain || `${site.subdomain}.stemfra.com`}`;
}

// GET /api/cms/google-profile?siteId= — the info bundle the guidance page needs:
// the exact website + booking link to paste into GBP, the site's NAP for
// consistency, and the owner's saved status.
async function getInfo(req, res) {
  try {
    const siteId = req.query?.siteId;
    if (!siteId) return res.status(400).json({ success: false, message: 'Missing siteId.' });
    const site = await verifySiteOwnership(req.cmsUser.id, siteId);
    if (!site) return res.status(403).json({ success: false, message: 'Not your site.' });

    const [{ data: full }, { data: theme }, { data: sections }] = await Promise.all([
      supabase.from('sites').select('subdomain, custom_domain, status, company:companies(name)').eq('id', siteId).single(),
      supabase.from('site_theme_settings').select('metadata').eq('site_id', siteId).maybeSingle(),
      supabase.from('site_sections').select('section_type, content').eq('site_id', siteId).eq('section_type', 'location_map'),
    ]);

    const loc = sections?.[0]?.content || {};
    const website = siteWebsite(full);
    const meta = (theme?.metadata && typeof theme.metadata === 'object') ? theme.metadata : {};
    const gbp = (meta.gbp && typeof meta.gbp === 'object') ? meta.gbp : {};

    res.json({
      success: true,
      website,
      bookUrl: `${website}/book`,
      published: full.status === 'live',
      nap: {
        name: full.company?.name || full.subdomain || '',
        address: loc.address || '',
        phone: loc.phone || '',
      },
      gbp: {
        has_profile: gbp.has_profile ?? null, // 'yes' | 'no' | null (undeclared)
        profile_url: gbp.profile_url || '',
        created: gbp.created === true,
        linked: gbp.linked === true,
      },
    });
  } catch (e) {
    console.error('[googleProfile.getInfo]', e.message);
    res.status(500).json({ success: false, message: 'Could not load Google Profile info.' });
  }
}

// POST /api/cms/google-profile — save the owner's GBP status into
// site_theme_settings.metadata.gbp (select-then-update/insert; no ON CONFLICT
// dependency, matching the onboarding/nav_mode metadata convention).
async function save(req, res) {
  try {
    const { siteId, has_profile, profile_url, created, linked } = req.body || {};
    if (!siteId) return res.status(400).json({ success: false, message: 'Missing siteId.' });
    const site = await verifySiteOwnership(req.cmsUser.id, siteId);
    if (!site) return res.status(403).json({ success: false, message: 'Not your site.' });

    const { data: row } = await supabase.from('site_theme_settings').select('site_id, metadata').eq('site_id', siteId).maybeSingle();
    const meta = (row?.metadata && typeof row.metadata === 'object') ? { ...row.metadata } : {};
    const prev = (meta.gbp && typeof meta.gbp === 'object') ? meta.gbp : {};
    meta.gbp = {
      ...prev,
      ...(has_profile !== undefined ? { has_profile: has_profile === 'yes' ? 'yes' : has_profile === 'no' ? 'no' : null } : {}),
      ...(profile_url !== undefined ? { profile_url: (profile_url || '').trim() || null } : {}),
      ...(created !== undefined ? { created: !!created } : {}),
      ...(linked !== undefined ? { linked: !!linked } : {}),
      updated_at: new Date().toISOString(),
    };

    const { error } = row
      ? await supabase.from('site_theme_settings').update({ metadata: meta }).eq('site_id', siteId)
      : await supabase.from('site_theme_settings').insert({ site_id: siteId, metadata: meta });
    if (error) throw new Error(error.message);

    res.json({ success: true, gbp: meta.gbp });
  } catch (e) {
    console.error('[googleProfile.save]', e.message);
    res.status(500).json({ success: false, message: 'Could not save. Try again.' });
  }
}

module.exports = { getInfo, save };
