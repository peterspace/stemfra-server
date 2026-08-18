// The personalized "Claim your website" offer for a lead (launch funnel).
// Resolves everything the Claim page + the prospecting email need from ONE
// place: greeting name, business, vertical, the vertical's FEATURED demo (from
// the DB flag is_featured_demo; falls back to lib/demoLinks FLAGSHIP), its
// hero-fold mockup image, the honest bonus deadline, and the CMS signup URL
// prefilled with the Starter + the lead's details.
const supabase = require('../config/supabase');
const { resolveVerticalSlug, configFor } = require('./verticalConfig');
const { FLAGSHIP } = require('./demoLinks');


const CMS_URL = process.env.CMS_PUBLIC_URL || 'https://cms.stemfra.com';
const ZONE = 'stemfra.com';
// The bonus the countdown is tied to. Real, not a fake timer: the deadline is
// computed from when the email went out (or the lead was created), so it does
// not reset on reload. Change the copy here when the offer changes.
const BONUS = { label: 'a free custom domain for your first year', days: 7 };
const VERTICAL_LABEL = { barbershops: 'barbershop', salons: 'beauty salon', crossfit: 'CrossFit box', yoga_pilates: 'yoga studio', massage: 'massage studio', spa: 'spa' };

const GENERIC_FIRST = new Set(['owner', 'manager', 'team', 'hi', 'hello', '']);
function greetingName(lead) {
  const f = String(lead.first_name || '').trim();
  if (f && !GENERIC_FIRST.has(f.toLowerCase()) && !f.includes('—')) return f;
  return null;
}

async function featuredDemoFor(verticalSlug) {
  const { data } = await supabase
    .from('sites')
    .select('subdomain, custom_domain, metadata, vertical:verticals(slug)')
    .filter('metadata->>is_starter', 'eq', 'true')
    .is('deleted_at', null);
  const rows = (data || []).filter((s) => s.vertical?.slug === verticalSlug);
  const pick = rows.find((s) => s.metadata?.is_featured_demo === true) || rows[0] || null;
  if (!pick) return null;
  const mock = (pick.metadata?.marketing_mockups || []).find((m) => m.scene === 'hero-fold') || null;
  return {
    subdomain: pick.subdomain,
    url: `https://${pick.custom_domain || `${pick.subdomain}.${ZONE}`}`,
    heroImageUrl: mock?.finalUrl || mock?.url || null,
  };
}

/** Build the offer for a lead row (or null when the vertical is unknown). */
async function resolveClaimOffer(lead) {
  const vertical = resolveVerticalSlug(lead.template_slug || lead.service_type || 'barbershops');
  const cfg = configFor(vertical);
  const demo = await featuredDemoFor(vertical);
  const demoUrl = demo?.url || FLAGSHIP[vertical] || 'https://stemfra.com/templates/';
  const token = lead.claim_token;
  const sentAt = lead.outreach_sent_at || lead.created_at || new Date().toISOString();
  const deadline = new Date(new Date(sentAt).getTime() + BONUS.days * 86400_000).toISOString();
  const first = greetingName(lead);
  const qs = new URLSearchParams({
    ...(demo?.subdomain ? { starter: demo.subdomain } : {}),
    claim: token,
    ...(lead.company_name ? { company: lead.company_name } : {}),
    ...(first ? { first } : {}),
    ...(lead.last_name && !String(lead.last_name).includes('—') ? { last: lead.last_name } : {}),
    ...(lead.email ? { email: lead.email } : {}),
  });
  return {
    token,
    firstName: first,
    businessName: lead.company_name || 'your business',
    vertical,
    verticalLabel: VERTICAL_LABEL[vertical] || (cfg?.displayName || 'business').toLowerCase(),
    demoUrl,
    demoSubdomain: demo?.subdomain || null,
    heroImageUrl: demo?.heroImageUrl || null,
    bonus: BONUS.label,
    deadline,
    expired: Date.now() > new Date(deadline).getTime(),
    claimSignupUrl: `${CMS_URL}/signup?${qs.toString()}`,
    features: ['Free hosting', 'Online booking', 'AI front desk', 'SMS and email alerts', 'No contract', '5% only'],
  };
}

module.exports = { resolveClaimOffer, BONUS };
