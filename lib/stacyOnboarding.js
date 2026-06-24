// Stacy onboarding checklist (Agent 5). Turns a site's real data into a curated,
// ordered "let's set up your site" checklist the panel walks a new owner through.
// Two kinds of step:
//   - 'fill': auto-detected done when the data is present (logo, photos, service
//     descriptions, SEO descriptions, social) — reliably empty until the owner adds it.
//   - 'personalize': seeded with template defaults, so "done" can't be inferred from
//     emptiness — the owner marks it done (Stacy offers to draft it first).
// Progress persists in site_theme_settings.metadata.onboarding (no schema change),
// matching how nav_mode / hero_variant per-site overrides are stored.
//
// Single-var supabase require per the server convention.
const supabase = require('../config/supabase');

const en = (v) => (v && typeof v === 'object' ? (v.en ?? '') : (v || ''));

async function buildOnboardingChecklist(siteId) {
  const [site, theme, services, team, pages] = await Promise.all([
    supabase.from('sites').select('id, subdomain, company:companies(name)').eq('id', siteId).single(),
    supabase.from('site_theme_settings')
      .select('instagram_handle, facebook_handle, tiktok_handle, youtube_handle, twitter_handle, logo_url, metadata')
      .eq('site_id', siteId).maybeSingle(),
    supabase.from('site_services').select('description, is_active, photo_url').eq('site_id', siteId),
    supabase.from('site_team_members').select('is_active, photo_url').eq('site_id', siteId),
    supabase.from('site_pages').select('is_published, meta_description').eq('site_id', siteId),
  ]);

  const s = site.data || {};
  const t = theme.data || {};
  const meta = (t.metadata && typeof t.metadata === 'object') ? t.metadata : {};
  const marked = (meta.onboarding && meta.onboarding.steps) || {};
  const dismissed = !!(meta.onboarding && meta.onboarding.dismissed);

  const activeServices = (services.data || []).filter((x) => x.is_active !== false);
  const activeTeam = (team.data || []).filter((x) => x.is_active !== false);
  const pubPages = (pages.data || []).filter((p) => p.is_published);

  const allHave = (arr, pred) => arr.length === 0 || arr.every(pred);
  const hasSocial = !!(t.instagram_handle || t.facebook_handle || t.tiktok_handle || t.youtube_handle || t.twitter_handle);

  // `auto` is the fill-step completion signal; personalize steps omit it (owner-marked only).
  const steps = [
    { key: 'logo', kind: 'fill', label: 'Add your logo', hint: 'Upload your business logo so it shows in your site header.', route: '/settings', auto: !!t.logo_url },
    { key: 'hero', kind: 'personalize', label: 'Personalize your homepage headline', hint: 'Make the first thing visitors see your own — I can draft it for you.', route: '/content/home', draftable: true },
    { key: 'services_desc', kind: 'fill', label: 'Write your service descriptions', hint: 'A clear sentence or two per service — I can draft these.', route: '/services', draftable: true, auto: allHave(activeServices, (x) => en(x.description).trim().length > 0) },
    { key: 'services_photos', kind: 'fill', label: 'Add photos to your services', hint: 'Photos help visitors choose. Add one per service.', route: '/services', auto: allHave(activeServices, (x) => !!x.photo_url) },
    { key: 'team_photos', kind: 'fill', label: 'Add photos of your team', hint: 'Put a face to each team member.', route: '/team', auto: allHave(activeTeam, (x) => !!x.photo_url) },
    { key: 'about', kind: 'personalize', label: 'Tell your story on the About page', hint: 'Your story builds trust — I can draft it from your details.', route: '/content/about', draftable: true },
    { key: 'contact', kind: 'personalize', label: 'Add your contact details', hint: 'Address, phone and email so customers can reach you.', route: '/content/home' },
    { key: 'hours', kind: 'personalize', label: 'Set your opening hours', hint: 'Double-check your opening hours are right.', route: '/settings' },
    { key: 'seo', kind: 'fill', label: 'Add search descriptions to your pages', hint: 'A short description per page for Google — I can draft these.', route: '/content/home', draftable: true, auto: allHave(pubPages, (p) => !!p.meta_description) },
    { key: 'social', kind: 'fill', label: 'Link your social profiles', hint: 'Instagram, Facebook, TikTok, and more.', route: '/settings', auto: hasSocial },
  ];

  const items = steps.map((st) => ({
    key: st.key,
    kind: st.kind,
    label: st.label,
    hint: st.hint,
    route: st.route,
    draftable: !!st.draftable,
    done: st.kind === 'fill' ? (!!st.auto || marked[st.key] === true) : (marked[st.key] === true),
  }));

  return {
    brand: s.company?.name || s.subdomain,
    items,
    done: items.filter((i) => i.done).length,
    total: items.length,
    dismissed,
  };
}

// Persist a step toggle or a dismiss into site_theme_settings.metadata.onboarding.
// Upsert by site_id so it works even if the theme-settings row doesn't exist yet.
async function setOnboardingState(siteId, { key, done, dismissed }) {
  // Select-then-update/insert (not upsert) so we don't depend on a unique
  // constraint on site_id existing for ON CONFLICT.
  const { data: row } = await supabase.from('site_theme_settings').select('site_id, metadata').eq('site_id', siteId).maybeSingle();
  const meta = (row && row.metadata && typeof row.metadata === 'object') ? { ...row.metadata } : {};
  const prev = (meta.onboarding && typeof meta.onboarding === 'object') ? meta.onboarding : {};
  const onboarding = {
    steps: { ...(prev.steps || {}) },
    dismissed: typeof prev.dismissed === 'boolean' ? prev.dismissed : false,
  };
  if (key) onboarding.steps[key] = !!done;
  if (typeof dismissed === 'boolean') onboarding.dismissed = dismissed;
  meta.onboarding = onboarding;

  const { error } = row
    ? await supabase.from('site_theme_settings').update({ metadata: meta }).eq('site_id', siteId)
    : await supabase.from('site_theme_settings').insert({ site_id: siteId, metadata: meta });
  if (error) throw new Error(error.message);
}

module.exports = { buildOnboardingChecklist, setOnboardingState };
