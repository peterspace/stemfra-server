// Context-builder for the AI agents. Turns an owner's live site data into a
// compact, structured block the model can answer from. Service-role reads
// (server-trusted). Built for Stacy (Agent 5, S1); the same builder is the
// shared F1 piece Front Desk (Agent 2) will reuse/extend.
//
// Single-var supabase require per the server convention.
const supabase = require('../config/supabase');

const en = (v) => (v && typeof v === 'object' ? (v.en ?? '') : (v || ''));

async function buildSiteContext(siteId) {
  const [site, theme, services, team, pages, posts, newLeads, upcoming, plans, subs] = await Promise.all([
    supabase.from('sites')
      .select('id, subdomain, custom_domain, status, time_zone, currency, business_hours, booking_mode, payments_enabled, company:companies(name), vertical:verticals(slug, display_name), template:templates(display_name)')
      .eq('id', siteId).single(),
    supabase.from('site_theme_settings')
      .select('instagram_handle, facebook_handle, tiktok_handle, youtube_handle, twitter_handle, logo_url, favicon_url')
      .eq('site_id', siteId).maybeSingle(),
    supabase.from('site_services')
      .select('name, price_cents, price_display_mode, currency, duration_minutes, bookable, is_active, photo_url, category_id, kind, capacity')
      .eq('site_id', siteId).order('display_order'),
    supabase.from('site_team_members')
      .select('name, role, is_active, photo_url, accepts_new_clients')
      .eq('site_id', siteId).order('display_order'),
    supabase.from('site_pages')
      .select('slug, title, is_published, meta_title, meta_description, og_image_url')
      .eq('site_id', siteId).order('display_order'),
    supabase.from('site_posts').select('status').eq('site_id', siteId),
    supabase.from('site_leads').select('id', { count: 'exact', head: true }).eq('site_id', siteId).eq('status', 'new'),
    supabase.from('site_bookings').select('id', { count: 'exact', head: true })
      .eq('site_id', siteId).eq('status', 'confirmed').gte('starts_at', new Date().toISOString()),
    supabase.from('site_products')
      .select('name, price_cents, currency, billing_interval, description')
      .eq('site_id', siteId).eq('product_type', 'membership').eq('is_active', true).order('display_order'),
    supabase.from('site_subscriptions').select('status').eq('site_id', siteId),
  ]);

  const s = site.data || {};
  const t = theme.data || null;
  const allPosts = posts.data || [];
  const allSubs = subs.data || [];

  return {
    business: {
      name: s.company?.name || s.subdomain,
      vertical: s.vertical?.display_name || s.vertical?.slug || null,
      theme: s.template?.display_name || null,
      subdomain: s.subdomain,
      custom_domain: s.custom_domain || null,
      status: s.status,
      time_zone: s.time_zone,
      currency: s.currency,
      booking_mode: s.booking_mode,
      payments_enabled: s.payments_enabled,
    },
    hours: s.business_hours || null,
    social: t ? {
      instagram: t.instagram_handle || null, facebook: t.facebook_handle || null,
      tiktok: t.tiktok_handle || null, youtube: t.youtube_handle || null, twitter: t.twitter_handle || null,
      has_logo: !!t.logo_url, has_favicon: !!t.favicon_url,
    } : null,
    services: (services.data || []).map((x) => ({
      name: en(x.name), price_cents: x.price_cents, price_mode: x.price_display_mode,
      duration_minutes: x.duration_minutes, bookable: x.bookable, active: x.is_active, has_photo: !!x.photo_url,
      kind: x.kind || 'appointment', ...(x.kind === 'class' ? { class_capacity: x.capacity } : {}),
    })),
    team: (team.data || []).map((x) => ({
      name: x.name, role: en(x.role), active: x.is_active, has_photo: !!x.photo_url, accepts_new_clients: x.accepts_new_clients,
    })),
    pages: (pages.data || []).map((x) => ({
      slug: x.slug, title: en(x.title), published: x.is_published,
      has_seo_title: !!x.meta_title, has_seo_description: !!x.meta_description, has_social_image: !!x.og_image_url,
    })),
    blog: {
      total: allPosts.length,
      published: allPosts.filter((p) => p.status === 'published').length,
      drafts: allPosts.filter((p) => p.status === 'draft').length,
    },
    // Memberships are pay-at-venue: a visitor signs up online, then pays in
    // person. Front Desk can list the plans; Stacy can report member counts.
    memberships: {
      plans: (plans.data || []).map((p) => ({
        name: en(p.name), price_cents: p.price_cents, currency: p.currency,
        interval: p.billing_interval || 'month', description: en(p.description) || null,
      })),
      active_members: allSubs.filter((x) => x.status === 'active').length,
      pending_signups: allSubs.filter((x) => x.status === 'pending').length,
      renewal_due: allSubs.filter((x) => x.status === 'renewal_due').length,
    },
    stats: { new_leads: newLeads.count ?? 0, upcoming_bookings: upcoming.count ?? 0 },
  };
}

module.exports = { buildSiteContext };
