// Cloudflare Pages config — reads the CF + GitHub env vars and exposes the
// account/zone/repo identifiers used to create Pages projects bound to the
// stemfra-platform monorepo. Like config/stripe.js, this is optional infra:
// handlers/scripts guard on `isCloudflareConfigured()` and no-op when unset.
//
// Defensive parsing: some env values were entered with stray quotes/spaces
// (e.g. GITHUB_REPO_ID_CLOUDFLARE="1275389305 with no closing quote), so we
// strip non-digits from the numeric ids and trim quotes from the strings.
const str = (v) => String(v ?? '').trim().replace(/^["']|["']$/g, '').trim();
// Cloudflare's Pages API requires owner_id / repo_id as STRINGS (numbers are
// rejected with 8000006). Keep them as clean digit-strings.
const digits = (v) => String(v ?? '').replace(/[^0-9]/g, '') || null;

const ACCOUNT_ID = str(process.env.CLOUDFLARE_ACCOUNT_ID);
const ZONE_ID = str(process.env.CLOUDFLARE_ZONE_ID);
const API_TOKEN = str(process.env.CLOUDFLARE_API_TOKEN);

const GH = {
  owner: str(process.env.GITHUB_REPO_OWNER),
  ownerId: digits(process.env.GITHUB_REPO_OWNER_ID_CLOUDFLARE),
  repoName: str(process.env.GITHUB_REPO_NAME_CLOUDFLARE),
  repoId: digits(process.env.GITHUB_REPO_ID_CLOUDFLARE),
  branch: str(process.env.GITHUB_BRANCH) || 'main',
};

const PAGES_BASE = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/pages/projects`;
const DNS_BASE = `https://api.cloudflare.com/client/v4/zones/${ZONE_ID}/dns_records`;
const cfHeaders = { Authorization: `Bearer ${API_TOKEN}`, 'Content-Type': 'application/json' };

const isCloudflareConfigured = () =>
  !!(ACCOUNT_ID && API_TOKEN && GH.repoName && GH.repoId && GH.owner && GH.ownerId);

module.exports = { ACCOUNT_ID, ZONE_ID, API_TOKEN, GH, PAGES_BASE, DNS_BASE, cfHeaders, isCloudflareConfigured };
