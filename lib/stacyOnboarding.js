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
const { CMS_ROUTES } = require('./cmsRoutes');
const { evaluateCompleteness } = require('./siteCompleteness');

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
  // Goals captured at signup prioritize the matching setup steps so Stacy guides
  // the new owner toward what they said they want first.
  const goals = Array.isArray(meta.goals) ? meta.goals : [];
  const GOAL_STEPS = {
    bookings: ['services_desc', 'services_photos'],
    memberships: ['services_desc', 'services_photos'],
    getfound: ['seo', 'social'],
    showcase: ['team_photos', 'services_photos', 'about'],
    brand: ['logo'],
    payments: [],
  };
  const recommended = new Set(goals.flatMap((g) => GOAL_STEPS[g] || []));
  const dismissed = !!(meta.onboarding && meta.onboarding.dismissed);

  // The publish gate is the single truth for "is this really theirs yet"
  // (address/phone/email/location name differ from the demo's, billing details
  // present). Reuse it so the checklist and the Publish page never disagree.
  let gate = {};
  try { const c = await evaluateCompleteness(siteId); gate = Object.fromEntries([...c.required, ...c.recommended].map((r) => [r.key, r.ok])); } catch { /* best-effort */ }

  const activeServices = (services.data || []).filter((x) => x.is_active !== false);
  const activeTeam = (team.data || []).filter((x) => x.is_active !== false);
  const pubPages = (pages.data || []).filter((p) => p.is_published);

  const allHave = (arr, pred) => arr.length === 0 || arr.every(pred);
  const hasSocial = !!(t.instagram_handle || t.facebook_handle || t.tiktok_handle || t.youtube_handle || t.twitter_handle);

  // `auto` is the fill-step completion signal; personalize steps omit it (owner-marked only).
  // NB: the former 'hero', 'contact' and 'hours' steps moved into the CMS Setup
  // wizard (components/onboarding/SetupWizard.tsx) — it collects business
  // details, contact info, hours and the headline up front, so Stacy's list
  // stays short and doesn't duplicate them (Peter, 2026-09-01).
  const steps = [
    { key: 'logo', kind: 'fill', label: 'Add your logo', hint: 'Upload your business logo so it shows in your site header.', route: CMS_ROUTES.logo, auto: !!t.logo_url },
    { key: 'services_desc', kind: 'fill', label: 'Write your service descriptions', hint: 'A clear sentence or two per service. I can draft these.', route: CMS_ROUTES.services, draftable: true, auto: allHave(activeServices, (x) => en(x.description).trim().length > 0) },
    { key: 'services_photos', kind: 'fill', label: 'Add photos to your services', hint: 'Photos help visitors choose. Add one per service.', route: CMS_ROUTES.services, auto: allHave(activeServices, (x) => !!x.photo_url) },
    { key: 'team_photos', kind: 'fill', label: 'Add photos of your team', hint: 'Put a face to each team member.', route: CMS_ROUTES.team, auto: allHave(activeTeam, (x) => !!x.photo_url) },
    { key: 'about', kind: 'personalize', label: 'Tell your story on the About page', hint: 'Your story builds trust. I can draft it from your details.', route: CMS_ROUTES.aboutStory, draftable: true },
    { key: 'faq', kind: 'personalize', label: 'Personalize your FAQ', hint: 'Answer the questions customers actually ask you. I can draft these.', route: CMS_ROUTES.faqContent, draftable: true },
    // Required before publishing (Peter, 2026-08-20): the invoice identity.
    { key: 'billing_details', kind: 'fill', label: 'Add your billing details', hint: 'Your billing name and address so Stemfra can invoice the 5% commission. Required before you publish.', route: CMS_ROUTES.billingDetails, auto: gate.billing_details === true },
    { key: 'seo', kind: 'fill', label: 'Add search descriptions to your pages', hint: 'A short description per page for Google. I can draft these.', route: CMS_ROUTES.homeSeo, draftable: true, auto: allHave(pubPages, (p) => !!p.meta_description) },
    { key: 'social', kind: 'fill', label: 'Link your social profiles', hint: 'Instagram, Facebook, TikTok, and more.', route: CMS_ROUTES.social, auto: hasSocial },
    // Legal pages ship as template text ("Last updated: 2024...") and nothing
    // prompted owners to review them before publishing (Peter, 2026-08-07).
    { key: 'legal', kind: 'personalize', label: 'Review your legal pages', hint: 'Your Terms, Privacy and Cookies pages ship as template text. Read them and adjust them to how you actually run things.', route: CMS_ROUTES.termsContent },
    // GBP linkage (Task #23) — connect the site to (or create) their Google listing.
    // 'fill' so marking it linked in the Google-profile surface auto-completes it.
    { key: 'google_profile', kind: 'fill', label: 'Connect your Google Business Profile', hint: 'Point your Google listing at your new site so customers can find + book you from Google.', route: CMS_ROUTES.googleProfile, auto: meta.gbp?.linked === true },
    // Review link (2026-08-04) — pairs with google_profile: lead-gen deliberately
    // targets businesses with LOW review counts, so getting the Google review link
    // into the review-request email is a day-one win, and the feature was sitting
    // unconfigured because nothing prompted owners to set it. 'fill' — pasting the
    // link in Settings → Notifications → Automated emails auto-completes it.
    { key: 'review_link', kind: 'fill', label: 'Add your Google review link', hint: 'Paste your Google review link so the automatic review-request email can send it to customers after their visit.', route: CMS_ROUTES.lifecycleEmails, auto: !!(meta.review_links?.google || meta.review_url) },
  ];

  const items = steps.map((st) => ({
    key: st.key,
    kind: st.kind,
    label: st.label,
    hint: st.hint,
    route: st.route,
    draftable: !!st.draftable,
    recommended: recommended.has(st.key),
    // personalize steps: owner-marked, OR auto when the gate can prove it (contact/hero).
    done: st.kind === 'fill' ? (!!st.auto || marked[st.key] === true) : (marked[st.key] === true || st.auto === true),
  }));
  // Recommended (goal-matched) steps float to the top; original order is preserved
  // within each group (Array.sort is stable in V8).
  if (recommended.size) items.sort((a, b) => (a.recommended === b.recommended ? 0 : a.recommended ? -1 : 1));

  return {
    brand: s.company?.name || s.subdomain,
    items,
    goals,
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
