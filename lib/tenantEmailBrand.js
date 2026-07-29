// Resolve a site's brand for its OUTBOUND tenant emails (Case 2). One place, so
// every sender (booking confirmations, reminders, lifecycle) brands identically:
//   · logo         — site_theme_settings.logo_url
//   · accent/font  — site override (site_theme_settings) → template design_tokens
//   · photo        — CMS email override → the home HERO image → null (logo-only)
//   · businessEmail/Url — the reply-to + footer identity
//   · overrides    — the CMS "Email templates" per-variant heading/subheading map
// Best-effort: emails still send (unbranded-neutral) if any lookup fails.
const supabase = require('../config/supabase');

// Crop a Cloudinary photo to a tall email column (fills the left panel cleanly).
function emailPhotoUrl(url) {
  if (!url || typeof url !== 'string') return url;
  return url.replace(/(res\.cloudinary\.com\/[^/]+\/image\/upload)\//, '$1/c_fill,g_auto,w_500,h_1200,q_auto/');
}

async function resolveTenantEmailBrand(siteId) {
  const out = { name: null, logoUrl: null, businessEmail: null, businessUrl: null, accent: null, font: null, photoUrl: null, overrides: {} };
  try {
    const [{ data: theme }, { data: site }] = await Promise.all([
      supabase.from('site_theme_settings').select('logo_url, accent_color, display_font, metadata').eq('site_id', siteId).maybeSingle(),
      supabase.from('sites').select('subdomain, custom_domain, template_id, company:companies(name)').eq('id', siteId).maybeSingle(),
    ]);
    out.name = site?.company?.name || site?.subdomain || null;
    let tmpl = null;
    if (site?.template_id) {
      const { data } = await supabase.from('templates').select('design_tokens').eq('id', site.template_id).maybeSingle();
      tmpl = data;
    }
    out.logoUrl = theme?.logo_url || null;
    out.accent = theme?.accent_color || tmpl?.design_tokens?.accent_color || null;
    out.font = theme?.display_font || tmpl?.design_tokens?.display_font || null;
    if (site) out.businessUrl = `https://${site.custom_domain || `${site.subdomain}.stemfra.com`}`;

    const emailMeta = (theme?.metadata && theme.metadata.email) || {};
    out.overrides = emailMeta;

    let photo = emailMeta.photo_url || null; // CMS override wins
    const { data: page } = await supabase.from('site_pages').select('id').eq('site_id', siteId).eq('slug', 'home').maybeSingle();
    if (page) {
      const { data: loc } = await supabase.from('site_sections').select('content').eq('page_id', page.id).eq('section_type', 'location_map').limit(1);
      out.businessEmail = loc?.[0]?.content?.email || null;
      if (!photo) {
        const { data: hero } = await supabase.from('site_sections').select('content').eq('page_id', page.id).eq('section_type', 'hero').limit(1);
        const c = (hero?.[0]?.content) || {};
        photo = c.image_url || c.background_image_url || c.bg_image_url || null;
      }
    }
    out.photoUrl = photo ? emailPhotoUrl(photo) : null;
  } catch { /* best-effort */ }
  return out;
}

module.exports = { resolveTenantEmailBrand, emailPhotoUrl };
