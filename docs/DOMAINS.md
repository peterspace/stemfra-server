# Domains — buy-a-domain (P6.27)

_Status: ✅ v1 BUILT 2026-06-29 (staff-mediated, in the CRM), INERT until Peter
provisions Porkbun keys + funds the account. Registrar = **Porkbun** (decided).
Decisions resolved: Stemfra holds the registration (reseller, we renew + bill);
domain billed as a one-off System-A line (`billing_charges.kind='adjustment'`)._

## ✅ What was built (v1 — staff, in the CRM)
- **`lib/registrar/porkbun.js`** — client: `checkDomain` (availability + cost +
  our retail price), `register` (supports `dryRun`), `getRequirements`,
  `createDnsRecord`, `retailCents` markup. `isConfigured()` false until keys set.
- **`lib/registrar/index.js`** — provider selector (mirrors `lib/billing`), so a
  second registrar can slot in later (`DOMAIN_REGISTRAR`).
- **`/api/admin/domains/*`** (PLATFORM_OPS): `GET /healthcheck`, `GET /search?domain=`,
  `GET /requirements?tld=`, `POST /:siteId/register {domain, confirm?}`. A real
  purchase needs `confirm:true`; otherwise `register` runs a **dryRun** (spends
  nothing). On a real buy: register → Porkbun DNS (apex ALIAS + www CNAME →
  `{project}.pages.dev`) → `attachCustomDomain` to the Pages project → write
  `sites.custom_domain` → insert a `billing_charges` 'adjustment' line at our
  **retail** price → audit `site_activity` (`domain_registered`). Each post-buy
  step is best-effort so a hiccup never loses the paid registration.
- **CRM UI** — Sites → Domain modal now has **Connect existing** | **Buy a domain**
  tabs: search → availability + price → "Register & connect". Shows a friendly
  "not set up yet" message when keys are missing.

## ⚠ Peter's setup checklist (before it works)
1. Create a **Porkbun account**; **fund the balance** (or card on file) —
   `domain/create` draws from the prepaid balance.
2. Account → **API Access** → create an **API key + secret**.
3. (For DNS on domains we register) enable **API Access per-domain** after purchase —
   needed for the `dns/create` step. _(New-domain registration only needs the
   account key; DNS record creation needs the per-domain toggle — verify on first buy.)_
4. Set server env: `PORKBUN_API_KEY`, `PORKBUN_SECRET_API_KEY` (+ optional
   `DOMAIN_MARKUP_MULT` / `DOMAIN_MARKUP_MIN_CENTS`). Secrets → GitHub Actions
   `deploy.yml` env block, never `.env.example`.
5. Confirm `/api/admin/domains/healthcheck` → `configured:true`.

## Pricing & limits (Porkbun, verified 2026-06-29)
- **API access is free** (no per-request fee); resource limits apply.
- **Domain cost** = registration price, flat renewal (no first-year bait): **.com
  ≈ $11.08/yr**, **.net ≈ $12.52/yr**; **WHOIS privacy + SSL included free**.
- Our **retail** = `max(cost×1.5, cost+$7)` → e.g. .com bills the client **$18.08/yr**
  (tune via env). Margin = retail − cost.
- **Rate limits:** `checkDomain` default **1 / 10 s per account** (configurable — ask
  Porkbun to raise it). So search is an explicit **"Check" button**, never per-keystroke.
  `domain/create`: 1 attempt / 10 s, 50 successes / day.
- **`cost` must match** the current price on `create` → we always `checkDomain`
  immediately before registering and pass that exact `costCents`.

## ⚠ Needs live verification (couldn't test — no keys yet)
- **Apex DNS**: we create a Porkbun **ALIAS** at the apex → `{project}.pages.dev` +
  a `www` CNAME. Cloudflare Pages custom-domain validation against Porkbun-hosted
  DNS (ALIAS at apex) must be confirmed on the first real purchase. Fallback if it
  misbehaves: point the domain's **nameservers to Cloudflare** + add it as a CF zone.
- Exact `checkDomain` response field names (`avail`/`price`) — coded to the documented
  shape; verify against a live response.

## Deferred to v2
- **Customer self-serve buy** in the CMS (today: staff-mediated in the CRM, matching
  high-touch onboarding). When ready, add `/api/cms/domains/*` (requireCmsAuth +
  verifySiteOwnership) mirroring the admin controller.
- **`site_domain_purchases` table + renewal/expiry sweeper** (auto-renew, expiry
  invoice line, transfer-out auth code). v1 records the purchase in
  `billing_charges` metadata + `site_activity`; a dedicated table comes with renewals.
- The `check_domain_availability_and_price` MCP capability as an alternate/preview
  search backend.

---
_Original spec (decisions + flow) retained below for reference._

## What exists today (CONNECT only)

## What exists today (CONNECT only)
Owners can **connect a domain they already own**; we cannot **sell** one.
- `controllers/cms/domainController.js` (`/api/cms/site-domain`): connect / status /
  disconnect. Connect → `attachCustomDomain(project, fqdn)` on the vertical's
  Cloudflare Pages project, writes `sites.custom_domain`, returns `cnameTarget`
  (`{project}.pages.dev`) + CF status. For `*.stemfra.com` hosts we add the CNAME
  ourselves; for external domains the owner pastes the CNAME at their registrar.
- `lib/cloudflarePages.js`: `attachCustomDomain` / `removeCustomDomain` /
  `addCnameRecord` / `findDnsRecord` / `deleteCnameRecord` — full CF Pages + DNS API.
- `config/cloudflare.js`: `CLOUDFLARE_ACCOUNT_ID` / `CLOUDFLARE_ZONE_ID` (stemfra.com)
  / `CLOUDFLARE_API_TOKEN`.
- **All the DNS/SSL plumbing is done.** The only gap is **domain registration**
  (search availability → buy → own/renew).

## ⚠ Decisions needed from Peter (before building)
1. **Registrar** (the load-bearing call). Cloudflare Registrar is at-cost and would
   pair perfectly with our existing CF setup **but has NO public registration API**
   (reseller/enterprise only) — so it can't back a self-serve buy flow. For
   programmatic registration pick one with a real API:
   - **Porkbun** — clean REST API, WHOIS privacy free, good pricing. _(Recommended
     for v1: simplest API, no reseller contract.)_
   - **Name.com** — full REST API, established.
   - **Route53 Domains** — solid API but AWS-centric (we're not on AWS).
   Then keep **Cloudflare for DNS + SSL** (point the new domain's nameservers at CF,
   or just add it to our zone) so the existing attach flow is reused unchanged.
2. **Who owns the registration?** Stemfra-as-reseller (we hold the registrar
   account, auto-renew, bill the client) **vs** register into the client's own
   registrar account. _(Recommend: Stemfra holds it — matches done-for-you; renewals
   are ours to manage + bill.)_
3. **Payment model.** A domain is a **billable line** — never take card numbers
   ourselves. Options: (a) add it to the Stemfra invoice (Payoneer/Stripe System A),
   or (b) a one-off charge. _(Recommend: add to the System-A invoice as a line item;
   the free-domain-in-setup promise already exists on the pricing page.)_
4. **Free-domain promise.** The pricing page says "Free custom domain included." Cap
   the wholesale cost (~$10–15/yr standard TLDs); premium names = client pays the
   difference. Confirm the cap + which TLDs are "included".

## Proposed flow (once a registrar is chosen)
1. **Search** — CMS Domain card gets a "Need a domain? Search" tab → `GET
   /api/cms/domains/search?q=` → registrar availability+price API → list available
   names + prices. _(Note: the environment exposes a `check_domain_availability_and_price`
   capability — evaluate it as the search backend vs the registrar's own API.)_
2. **Buy** — `POST /api/cms/domains/purchase { siteId, domain }` → create a billable
   charge (don't register until paid, or register + invoice per decision #3) →
   registrar `register` API → set nameservers to Cloudflare (or add to our zone) →
   reuse `attachCustomDomain` + write `sites.custom_domain`. Audit to `site_activity`.
3. **Lifecycle** — renewals (auto-renew + annual invoice line), WHOIS privacy on by
   default, transfer-out support (give the auth code). Sweeper for upcoming expiries.

## Schema (additive, when built)
```sql
CREATE TABLE site_domain_purchases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id uuid NOT NULL REFERENCES sites(id),
  domain text NOT NULL UNIQUE,
  registrar text NOT NULL,                 -- 'porkbun' | 'name_com' | ...
  registrar_ref text,                      -- external registration id
  status text NOT NULL,                    -- 'pending_payment'|'registered'|'active'|'expiring'|'failed'|'transferred_out'
  amount_cents int, currency text DEFAULT 'USD',
  billing_charge_id uuid REFERENCES billing_charges(id),  -- ties to System A
  auto_renew boolean DEFAULT true,
  registered_at timestamptz, expires_at timestamptz,
  created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now()
);
```

## Env (when built)
```
DOMAIN_REGISTRAR=porkbun
DOMAIN_REGISTRAR_API_KEY=        # secret → GitHub Actions, never .env.example
DOMAIN_REGISTRAR_API_SECRET=
```

## Build order when greenlit
1. Pick registrar (decision #1) + provision account/keys (Peter).
2. `lib/registrar/<provider>.js` (search + register + renew) behind a thin interface
   (mirror `lib/billing/` provider pattern so a second registrar can slot in).
3. `site_domain_purchases` schema; `/api/cms/domains/search` + `/purchase`
   (requireCmsAuth + verifySiteOwnership); tie purchase to a System-A charge.
4. Reuse `attachCustomDomain` for DNS/SSL — no new CF code needed.
5. CMS Domain card "Search & buy" tab + checkout-as-invoice-line.
6. Renewal/expiry sweeper + WHOIS-privacy default + transfer-out.

## Note
This is **separate from System A/B payments** — a domain is the client's asset we
buy on their behalf and bill back; it does not touch Stripe Connect.
