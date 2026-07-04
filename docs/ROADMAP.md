# Stemfra — Roadmap & Pending Tasks (prioritized)

_Updated 2026-06-29. Single cross-repo source of truth. The order below IS the
recommended build sequence. Per-feature detail lives in the linked docs; this is
"what's next and why."_

## ✅ Done this session (2026-06-28/29)
- 9 demo sites (one per active theme, 4 verticals), owner `peechizzy@gmail.com`
  ("Marcus Argyle"); `demo_link` map + send-outreach wiring.
- Email open-tracking (pixel + endpoint); Mark outreach (send as `mark@`, reply sweeper).
- `provisionSite` vertical-alias fix; `boutique_gyms` vertical deactivated.
- **Pricing page honesty pass** — removed "— 2 months free" from the Annual
  toggle; **trimmed all 3 tiers + the core strip to features that ship today**
  (payment/membership/voice features gated → documented in `docs/OFFER_TIERS.md`,
  re-add as they land). ⚠ **Pro is now thin** — see P6.1 (product decision pending).

## ⚙️ Operational / parallel (Peter — not code)
- **Start Stripe application NOW with EIN + passport** (ITIN likely isn't the gate); confirm EIN on file.
- ITIN application (~3–4 mo) — for tax filing, tracked separately.
- Lemon Squeezy / Paddle — evaluate only **if/when approved**; not required (Payoneer interim → Stripe target).
- **Stripe Tax** — enable at first out-of-state US **nexus** (event-driven; not now). Monitor revenue-by-state; CPA at the inflection.
- **When Stripe verifies** → flip System A to Stripe Billing + activate **System B** Connect (Phase 0/1 already in code).

---

## P0 — Revenue: collect from the first clients  ✅ DONE (2026-06-29, deployed)
_Interim = Payoneer Request-a-Payment ($1,199 first, then $199). All 5 verified + shipped:
schema + `billing_charges` ledger · server provider layer + Payoneer + `/api/admin/billing/*` ·
CRM `/billing` (selector + Due-this-cycle + Copy-request + Mark Paid + Start billing) ·
monthly cycle opener (idempotent) · KYC `leads.first_name/last_name` + `contacts.state`.
Plan catalog is DB-driven (`crm_settings.billing_plans`). Full write-up: a memory + this file._

1. **Billing schema** (batch 1, additive): `subscriptions.provider` +
   **`billing_charges`** ledger (`line_items` jsonb, `kind` initial|recurring,
   amount, currency, due_date, status, provider, external_ref, requested/paid
   at+by) + `crm_settings.billing_active_provider`. First charge =
   `[Setup $1,000, Tier month-1]` = **$1,199**; then **$199**.
2. **Server** `lib/billing/` provider interface + **Payoneer** provider +
   `/api/admin/billing/*` (list / mark-requested / mark-paid / open-cycle / provider).
3. **CRM `/billing`**: active-method selector + per-client charges + **"Copy
   request details"** (Name/Email/Country/State/amount/currency/due/desc, paste
   into Payoneer) + Mark Requested/Paid + **"Due this cycle"** list.
4. **Monthly cycle opener** (background task or manual button).
5. **#1 KYC**: `leads.first_name/last_name` + billing-contact **`state`** (needed
   for the Payoneer payer + KYB). Store first/last directly through
   contactController + CRM Add-Lead + onboarding.
   - Billing reads tier/setup amounts from DB `verticals` → first consumer of the
     pricing single-source (down-payment on #5).

## P1 — Scale the motion: onboarding + client-facing billing  ✅ DONE (2026-06-29)
_CMS client Billing · self-serve CMS `/signup` (KYC + 2 questions, prefilled from
pricing) · onboarding backend (+ created_by FK fix) · Booking & Payments setting +
agent/template gating + CRM visibility. Remaining sub-item: an optional Q2
payment-LINK URL field (PayPal.me/Square) — onboarding already captures the
payment answer; deferred as low priority._

6. ✅ **Onboarding redesign** (Squarespace-referenced — see SQUARESPACE_REFERENCE.md).
   **Entry point (decided 2026-06-29): onboarding lives in the CMS, not
   stemfra_client.** Marketing pricing "Start for free" on a plan → redirect to the
   CMS carrying plan + vertical → CMS signup → guided onboarding (Squarespace/
   Mindbody pattern). Reuse onboardCustomer/provisionSite + Stacy checklist.
   Capture KYC fields + **"How do you currently receive payments?"** (Stripe/PayPal/
   Square/cash/other/none) → informs Connect type (Standard vs Express) + which
   System-B integrations to add; feeds payer data (incl. `contacts.state`) into P0.
7. ✅ **CMS client Billing section** (DONE 2026-06-29) — Account → Billing: subscription
   + charge history + editable billing contact. `/api/cms/billing`.
8. ✅ **Payment/booking-provider setting (#3)** — DONE: CMS "Booking & payments"
   (provider + URL), Front Desk agent gate, all 4 template Book CTAs, CRM
   visibility. (Optional Q2 payment-link URL field still pending — see note above.)
   _Original spec:_ Where the client picks how THEY take
   payment/bookings + the redirect URL their site links to (e.g. a Mindbody URL).
   Today's `PaymentsSection` only has in-person `payment_methods` + `payment_message`
   (wired) + Stripe Connect; there's NO curated provider + redirect-URL field. Build:
   a **curated dropdown** (Stemfra native · Mindbody · Wodify · Vagaro · Booksy ·
   Fresha · GlossGenius · Acuity · Square Appts · Calendly · Schedulicity · PayPal ·
   Stripe link · **Other**+custom) + a **redirect/booking URL** field, stored on the
   site, used by the template Book/Pay CTA, and **visible to both client (CMS) +
   staff (CRM)**. Onboarding's "how do you receive payments?" seeds the initial value.

**Deferred (post-roadmap, per Peter 2026-06-29):** demo-site preview links on the
Products + Templates pages; display ALL themes per vertical on pricing/templates.

## P2 — Polish what we sell  ✅ mostly DONE (2026-06-29)
8. ✅ **#2 Favicon** — neutral theme-tinted data-URI default in all 4 template
   `index.html` (SiteHead still overrides with a site's own).
9. ✅ **#3 Link-unfurl OG** — stopgap (neutral static `<title>`) DONE + per-host OG
   edge function BUILT (`functions/_middleware.ts` in all 4 templates: host→site→
   HTMLRewriter title+OG). **Deploy step (Peter):** add `SUPABASE_URL` +
   `SUPABASE_ANON_KEY` to each template Pages project's env; verify on deploy
   (edge-only runtime — couldn't be locally verified).
10. ✅ **#8 Marketing contact form email dedup** — re-submit updates the open lead.

## P3 — Maintainability before scaling verticals  ✅ main items DONE (2026-06-29)
_`lib/verticalConfig.js` is the single source (aliases/project/seed/leadgen) — all
consumers refactored, behavior verified. `boutique_gym` out of lead-gen (#6).
Pricing single-source: `/api/plans` (DB catalog) → marketing pricing page.
Remaining (lower, item 14): demo_sites table + SUBJECT_TO_SERVICE/KNOWN_TEMPLATE_SLUGS → DB._

11. ✅ **#4 `verticalConfig` consolidation** — `VERTICAL_PROJECT` (3 copies),
    `SEED_SOURCE_BY_VERTICAL`, `VERTICAL_ALIASES` (2 copies), `KNOWN_VERTICALS`
    vs `LEADGEN_VERTICALS` → one source imported everywhere.
12. **#5 Pricing single-source** — DB `verticals` → client (stop `verticals.js`
    drift); sync Stripe products. (Partly begun in P0.)
13. **#6 boutique_gym** out of `KNOWN_VERTICALS` + `LEADGEN_VERTICALS` (vertical already inactive).
14. Demo links → `demo_sites` table; `SUBJECT_TO_SERVICE` / `KNOWN_TEMPLATE_SLUGS` → DB. _(lower)_

## P4 — Growth levers (lead-gen)  ✅ DONE (2026-06-29)
17. ✅ **Outbound auto-call guardrails** — `lib/callGuardrails.js` (DNC + pan-US safe
    window + daily cap), reply sweeper + manual Call-with-AI gated.
16. ✅ **Follow-up sequencer + reply-classification** — `lib/outreachSequencer.js`:
    A1→A2(+7d)→**read-gated call**(+8d)→A8(+14d)→A20(+21d), DB-driven cadence, stops on
    reply/opt-out/signup; CRM "Auto follow-up" toggle. Reply classifier (unsubscribe→
    DNC+do_not_email / declined / interested). Off by default.
15. ✅ **#7 template-fill merge** — `outreachSequencer.renderMergeFields` fills
    first_name/business_name/demo_link/start_free_link/sender_* (+strips unknowns);
    send-outreach already fills the links. _(n8n-side drafting still inlines values.)_

## P5 — Hardening + platform roadmap
18. Voice hardening — Twilio signature validation + WS auth.
19. Per-role RLS data hardening (stemfra-ops) — role-scoped policies vs blanket `is_stemfra_staff()`.
20. Stacy **S3 (act)** + **S4**.
21. **Ledger** agent (Agent 6).
22. Dynamic CORS (query live custom domains) — deferred.

## P6 — Offer maintainability + site lifecycle (NEW, queued 2026-06-29)
_Raised by Peter while reviewing the pricing page + CMS Sites page. 23 + 24 SHIPPED
this session; 25–27 still pending._

23. ✅ **Pro-tier product decision — DONE: marked "Coming soon" / waitlist.** After
    the honesty trim Pro's deliverable delta over Growth was just SMS reminders +
    priority support (headline AI Voice Receptionist + custom email + promo codes
    are 🟡/🔴). Decision: sell **Essential + Growth** now; Pro renders as a
    **"Coming soon" waitlist card** (pill + "Join the waitlist" → `/contact?interest=pro-waitlist`),
    still listing its aspirational features. Flip `coming_soon` off in the catalog
    when voice-booking ships. (`verticals.js` flag + Pricing.jsx render + DB catalog.)
24. ✅ **Server-driven offer/tier data — DONE.** The DB plan catalog
    (`crm_settings.billing_plans`) now carries the **full offer**: per-tier
    `label/promise/featured/badge/coming_soon/order` + `features[]` (each
    `{text,status}`) + a `core_platform[]` strip, alongside the prices the billing
    engine already read. `status` = **live / gated / soon**; the marketing page
    shows only `live` on a live tier (gated/soon kept for re-add, shown on a
    coming-soon tier). Surface: `GET/PUT /api/admin/billing/plans` (PLATFORM_ADMIN,
    `billing.setPlans` validates money fields) + public `GET /api/plans`. The
    marketing pricing page consumes it (`mergeTiers`/`mergeCore`, `verticals.js`
    = fallback). **CRM editor**: `/billing/plans` (`pages/OfferEditor.jsx`, linked
    from the Billing header) — edit names/prices/promises/badges/coming-soon +
    add/remove/reorder features with a live/gated/soon status, no deploy. Kills the
    `verticals.js`↔DB drift (subsumes P3 item 12). _Annual discount is in the
    catalog (`annual_discount_months`) but the page still reads the local constant —
    minor follow-up to thread it through `annualPrice()`._
25. ✅ **CMS plan upgrade/downgrade — DONE (2026-06-29).** Owner self-serve
    upgrade/downgrade from CMS Account → Billing ("Change plan" card). Server:
    `billing.changeSubscriptionPlan` + `POST /api/cms/billing/change-plan`
    (requireCmsAuth + ownership + status guard active/past_due; rejects coming-soon
    tiers), tier list surfaced via `getBilling` (`availablePlans`/`currentTier`/
    `canChangePlan`). New monthly rate takes effect **next cycle** (the cycle opener
    reads `monthly_amount_cents`); tier entitlement (`metadata.tier`) flips
    immediately; `plan_history` trail + `site_activity` audit so staff request the
    new amount. No mid-cycle proration under manual Payoneer — Stripe will add real
    proration when it's the active provider. CMS: `useChangePlan` + `ChangePlanCard`
    (confirm step). Verified: routes 401-gated, CMS `tsc --noEmit` clean.
26. ✅ **Site deletion + lifecycle cleanup — DONE (2026-06-29).** Policy (Peter):
    **both** staff + owner can delete · **90-day** grace · **block on unpaid +
    cancel sub** · export deferred to v2. Built: schema (`sites.deleted_at`/
    `deletion_reason`/`deletion_initiated_by` + partial index, no enum change);
    `deleteSiteCascade` extended to all **26** site-scoped tables + best-effort mode
    (also fixes the rollback-orphan gap); `lib/siteDeletion.js`
    (`softDeleteSite` → detach CF host + cancel billing + stamp + audit;
    `restoreSite`; `hardPurgeSite` → Cloudinary destroy + full cascade);
    `lib/siteDeletionSweeper.js` (purges past the 90-day grace, started in index.js).
    Endpoints: staff `POST /api/admin/sites/:id/{delete,restore}` (+ `?deleted=true`
    list + `force` past unpaid); owner `POST /api/cms/sites/:id/{delete,restore}`.
    UI: CRM Sites Active/Deleted tabs + delete modal (type-DELETE, force-on-unpaid)
    + Restore; CMS Sites delete modal + owner-context hides deleted. Verified:
    routes 401-gated, all files parse/typecheck clean, schema applied (0 sites
    flagged). Spec: `docs/SITE_DELETION.md`. _(Not E2E-run against a live site —
    detach/purge hit real CF/Cloudinary; logic mirrors the proven detach + rollback
    paths.)_
27. ✅ **Domain registrar — v1 BUILT 2026-06-29 (Porkbun, staff-mediated), inert
    until keys.** `lib/registrar/{porkbun,index}.js` + `/api/admin/domains/*`
    (healthcheck/search/requirements/register; `confirm`-gated, dryRun otherwise) +
    CRM Sites Domain modal "Buy a domain" tab. Real buy → register → Porkbun DNS
    (apex ALIAS + www CNAME → `{project}.pages.dev`) → `attachCustomDomain` to Pages
    → `sites.custom_domain` → bill client retail via `billing_charges` 'adjustment'
    → audit. Verified: module chain loads, `isConfigured()=false`, retail markup
    ($11.08→$18.08); routes added (server was down at test time — unrelated to my
    code, all files `node --check`/esbuild clean). **Blocked on Peter:** Porkbun
    account + **funded balance** + API keys (`docs/DOMAINS.md` checklist). **Needs
    live verification:** apex ALIAS ↔ Cloudflare Pages custom-domain validation.
    **v2 deferred:** customer self-serve CMS buy · `site_domain_purchases` table +
    renewal/expiry sweeper · `check_domain_availability_and_price` as search backend.

## P7 — Marketing funnel: theme galleries (NEW, 2026-06-30)
_Marketing site (`stemfra_client`). Per-vertical theme pages drive the buy path:
Products/Discover → `/themes/:vertical` → pick a theme → pricing → onboarding.
Done this session unless noted._

28. ✅ **Per-vertical theme gallery** — new route `/themes/:vertical` +
    `ThemeGallery.jsx` + `data/themes.js` (9 live demos mapped per vertical, synced
    to `provision-demos.js`). Each theme card: screenshot → "Preview live ↗" (opens
    the real demo) + **"Select this theme"** → `/pricing?vertical=&theme=`. "Discover"
    (BrowseDrawer) + the Templates page tiles now route here (were dead-ending at the
    contact form). Pricing page reads `?vertical=&theme=`, shows a "Selected theme"
    chip, and threads both into every "Start for free" CTA → CMS `/signup?plan=&vertical=&theme=`.
    Yoga is `comingSoon` (renders a muted card) until its mockup lands.
29. **High-res, content-edited theme screenshots (PENDING — Peter).** v1 uses
    WordPress mShots auto-screenshots (grey placeholder on first load → not
    production-grade). Peter will edit each demo's content/images for uniqueness, then
    share hi-res shots. Plan: capture the 9 live demos (full-page or hero), upload to
    Cloudinary, set `screenshot` on each theme in `data/themes.js` (one field per
    theme, no page edits). Flip yoga's `comingSoon` off once its shot is in.
30. ✅ **Onboarding CONSUMES the `theme` param (2026-07-02) — via Starter clone, not
    `templateSlug`.** Both marketing entry points now provision the *exact previewed
    site*: the Themes Gallery already links `/signup?starter=<subdomain>` (→ clone that
    Starter), and the Pricing path carries `/signup?theme=<key>` — `SignupPage` now maps
    the key → the same demo subdomain via a `THEME_STARTERS` map (9 entries: `manhattan`
    →`rourke-sloane`, `sorrel`→`linden-lark`, …) and threads it as `starterId`. **Chose
    clone-the-Starter over the originally-planned `provisionSite({templateSlug})`:** the
    9 theme demos are complete, correctly-templated preview sites (24–37 sections), so
    cloning gives the customer precisely what they previewed (renamed to their brand),
    not the generic vertical fixture on that template. Server side needed no change —
    `onboardCustomer({starterId})` → `getApprovedStarter` (reads `sites.metadata.is_starter`,
    already flagged on the 9 demos + 4 fixtures) → `cloneSite`. Harmless when neither
    param is present (falls back to vertical default). Not blocked on `stemfra_client`.

## P8 — Pricing V3 + feature backlog (NEW, 2026-06-30)
_Full design history + tier maps + research: `stemfra_pricing_system/TIER_VERSIONS.md`
(co-located with the Squarespace/Mindbody/Wodify competitor analysis). V3 = "generous
core + growth tiers." When adopted, mirror into `crm_settings.billing_plans`._

31. ✅ **RESOLVED P6.1 (Pro was thin).** Decision (Peter): **drop the AI Voice
    Receptionist from the CLIENT tiers** — SMBs don't need it, Front Desk (chat)
    covers them. Pro re-anchors on SMS reminders + 2-way texting + marketing + custom
    email + phone support. **Stemfra keeps its own voice agent** for internal use
    (concierge/front desk), per the AI-agents roadmap — just not sold to clients.
32. **Un-gate Table 2 (built-but-gated) the moment Stripe Connect is live** — card
    payments at booking, memberships/packs/drop-ins, member accounts, refund/pause/
    cancel tools, accelerated payouts. All built + verified (System B); un-gate = a
    CRM `billing_plans` status flip, no deploy. **Biggest "tiers feel full" win.**
33. ✅ **"Start for free" CTA is intentional, KEEP it** (decided 2026-06-30). It's the
    point of building **Stacy** — AI-guided self-serve onboarding ("free to experience,
    pay to publish") means fewer support staff. Squarespace's model; Squarespace (a
    website builder) is our real category — Mindbody/Wodify (high-touch booking
    software) aren't, so we don't copy their demo-first funnel. The earlier
    "demo/discovery-call first" stance is retired (offer doc + TIER_VERSIONS.md updated).
    Last-mile ✅ done (P7.30): SignupPage consumes the `theme`/`starter` param so
    onboarding clones the chosen theme's previewed site.
34. **Custom business email** — ship **Cloudflare Email Routing (free forwarding)** as
    the Pro perk ($0, reuses our DNS); Google Workspace (~$8/user retail, ~$3 reseller)
    as a later paid add-on. (Research in TIER_VERSIONS.md §A.)
35. **Unified inbox + 2-way texting (owner↔client)** — Pro-only; reuses CRM Twilio
    rails. Needs per-tenant A2P 10DLC registration templated into onboarding first;
    pair with SMS reminders. Not a launch blocker. (Research §B.)
36. **Table-3 nice-to-haves added to backlog** (priority order): pageview/traffic
    analytics (ad-spend) · at-risk/churn alerts · lead conversion board (pipeline) ·
    advanced/custom report builder. Lower: POS (Stripe Terminal) · Mailchimp/Zapier ·
    MCP/API access · announcement bar/promo pop-up · media library.
    **Parked until client demand:** sell courses / on-demand content (Peter's call).
    **Excluded:** branded app · physical eCommerce · marketplace · deep fitness
    hardware · payroll · family groups · pick-a-spot.

---
_Conventions: additive schema only (regen types after); propose → ship in focused
batches → verify; keep this file current as items land._


## P9 — Wellness verticals + Marketing Mockups follow-ups (NEW, 2026-07-04)

Session log: `docs/WORK_2026-07-04.md`. Everything below is queued from the 2026-07-03/04 session (all work UNCOMMITTED as of writing — commit pass needed first).

**Marketing Mockups → production (the tool is feature-complete locally):**
- [ ] Commit the arc across `stemfra_server` / `stemfra-ops` / `stemfra_client` (+ platform changes)
- [ ] Server Docker image: enable Playwright captures in prod — the current `node:22-alpine` base is NOT a supported Playwright platform (musl); move the runtime stage to a debian-based image (or `mcr.microsoft.com/playwright`) + `npx playwright install --with-deps chromium`, then drop the `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD` guard from the Dockerfile. (`sharp` works on alpine; `MOCKUP_RENDER_URL` defaults to crm.stemfra.com in prod.)
- [ ] Flip `stemfra-ops/.env` `VITE_STEMFRA_SERVER_URL` back to prod; deploy CRM + marketing site

**Massage vertical (Escape theme v1 + structure pass done; seed = calm-roots-massage):**
- [ ] Peter's real-browser walk of :5181 (the completeness-gate visual half)
- [ ] Remaining Escape 🟡 fidelity: `facility_highlights:process-steps` · `service_menu:diamond-split` · `single-rate-panel` pricing · per-section `backgrounds` painting (dark/white bands — benefits every theme)
- [ ] Confirm massage/spa pricing placeholders (massage $1200/79 · spa $1500/99 — set by Claude, unconfirmed)
- [ ] Create the Cloudflare Pages project `stemfra-massage` (prod prerequisite)
- [ ] Teach the n8n lead-gen workflow the 'massage' vertical (3-place sync: CRM + server done)
- [ ] Marketing site wiring for massage (themes.js gallery entry, pricing page, demo site + Starter flag) — after the theme walk
- [ ] **Spa vertical**: clone from the COMPLETED massage (app copy on :5182 + seed via onboardCustomer + reactivate the parked `spa`/`spa-classic` DB rows re-sourced from massage)
