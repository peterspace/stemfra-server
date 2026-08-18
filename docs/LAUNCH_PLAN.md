# Stemfra Launch Plan (phased, barbershop first)

_Created 2026-08-18 from Peter's launch plan. This is the ACTIVE launch arc. Phase 1
= barbershops (100-lead test run this week), then vertical by vertical. Status marks
are updated as items ship. Companion docs: ROADMAP.md (backlog), OUTREACH.md
(prospecting), VOICE_AGENT.md (Mark), STACY.md, GUIDED_TOURS.md, DOMAINS.md,
COMMISSION_MODEL.md. NOTHING is pushed to GitHub until Peter approves._

## Standing decisions (Peter, 2026-08-18)
- **Phased launch, barbershop first.** 100 barbershop leads = the test run.
- Airwallex `invoice.paid` webhook + tax-aware ledger: **suspended until approval**;
  NOT part of the launch (stays in ROADMAP). Does not affect the tested bank-transfer
  invoicing loop.
- Owner SMS alerts + the Front Desk live-verification items (member reschedule/cancel
  in a signed-in chat, multi-line slot card, human Shift+Enter/paste): **tested during
  the launch test**, not pre-built.
- Supabase auth-email SMTP + branded templates (Part A/B in SUPABASE_AUTH_EMAILS.md):
  **do AFTER the launch-plan tasks** in case something changes. Regenerated exports are
  current + em-dash-free (2026-08-18); still a Peter dashboard action.
- The **product demo video demos the TENANT'S WEBSITE**, not the CMS (the CMS is the
  tool they manage it with).

## The 10 launch tasks

| # | Task | Status | Notes / where it lives |
|---|---|---|---|
| 1 | **VSL video for email marketing** | ⬜ | Was P12 "deliberately last"; now leads the sequence. Demo = the tenant website (with the on-site guided tour, demo-only). Assets on hand: ElevenLabs voice pipeline (Jessica @0.95, GUIDED_TOURS.md), mockup/screenshot pipeline (MARKETING_MOCKUPS.md), 9 demo sites. Script + storyboard first. |
| 2 | **Prospecting sequence = max 3 contacts until decision** (1 VSL email → 2 Mark call → 3 follow-up email; 1/week) | ⬜ | Re-sequence the sequencer + Template Manager cadence in OUTREACH.md (today: A1→A2→read-gated call→A8→A20). n8n prompt paste via Peter. |
| 3 | **Update Stacy + all CMS routes** | ✅ DONE (code pushed + deployed 2026-08-18; Peter pasted S5) | `lib/cmsRoutes.js` reconciled with the CURRENT IA: Payments routes → in-nav `/billing/payments`; +labels/analytics/customers/reports/subscribers/promotions/schedule/billing*/support/whatsNew/giftContent/privacy; all 53 entries verified to resolve. `siteCompleteness` now deep-links address/phone→Location, headline→Hero. **NEW `CMS_GUIDE`** (37 owner-tasks → sidebar `where` + route) → Stacy's context as `cms_map` (Stacy-only; Front Desk never gets it) so she answers "where do I change X?" from real routes. CMS `StacyPanel` ROUTE_LABEL rewritten to the current IA wording (Website →/Account → Billing …). **Peter action:** paste `n8n-workflows/stacy-build-prompt-S5.js` into the Stacy Build Prompt node (adds the CMS-map guidance clause; replaces the stale "(Content, Services, Settings)" line). |
| 4 | **Re-walk the CMS tour** | ✅ 2026-08-18 (platform `d5e6f94`, deployed) | Main tour step 8 targeted a REMOVED anchor (bookings-calendar → bookings-grid, line kept); step 3 copy + voice updated for the Website group; Style tour top-to-bottom + a Buttons & labels step; SectionFrame `<id>-header` anchors; voice script no longer records the voiceless workflow tours. Walked live (main + Style). GUIDED_TOURS.md §5c. |
| 11 | **Tenant edge prerender (SEO / link previews / AI-KB crawl)** | ✅ LIVE 2026-08-18 (platform pushed `a3c7cac`+`792c0d9`; verified in prod: rourke-sloane 0 → 4,439 chars, hit on 2nd request, argyleandsons.click, umbra blog post, ellaris-spa 9.9k chars; browser hydration clean) | Found by the Stemfra AI session: tenant pages returned a 3 KB SPA shell with 0 visible chars (stemfra.com prerenders, tenants didn't). New shared Pages Function `functions/[[path]].ts`: per-host, per-request edge prerender (full head via the shared `resolveSiteHead` + semantic body: sections, priced menu, team, reviews, address/hours, blog), edge-cached 5 min, falls through to the shell on any failure; `_routes.json` in all 6 templates. Verified locally on the real data (rourke-sloane 0 → 4,612 chars). Verify after deploy: `curl -sA Mozilla -H 'accept: text/html' https://rourke-sloane.stemfra.com/ | grep -c '<p'` + `x-stemfra-prerender` header. Then tell the AI session to re-crawl. Follow-up: purge-on-publish (today = 5-min TTL). |
| 5 | **Legal pages: terms of use + booking policy, privacy, cookies** | ✅ code + data 2026-08-18 (NOT pushed; ⚠ deploy client + platform BEFORE server) · ⏳ Peter/counsel read-through | **Marketing pages** (Terms/Privacy/Fees/Refund → "Last updated: August 18, 2026"): fixed stale facts (Paddle → invoices/bank transfer, 4 → 6 verticals, no external booking/Square, receipt upload → auto-matched bank reference + "I have paid", "confirmed in writing" → self-serve); NEW Terms §4a Your Account, §4b Your Content and Your Customers' Data (owner = controller, Stemfra = processor, leaving/export), §4c AI Assistants; NEW Privacy §5a data we process for hosted businesses + the REAL subprocessor list (Cloudflare/Supabase/Cloudinary/Hostinger/Twilio/Resend/Google/OpenAI/Airwallex/Payoneer/Porkbun/Stripe) + honest cookies. **Tenant pages** (all 18 sites, 90 sections, live-verified): removed the public "This is template text…" line, dated August 2026, privacy now covers SMS reminders + Stemfra-as-processor + honest cookies, cookies page no longer claims analytics; the review reminder moved into the CMS legal editor. **Acceptance capture**: `legal_acceptances` table + `lib/legalDocs.js` registry; signup REQUIRES one tick (Terms+Privacy+Fees) on both forms; server stamps version/time/ip/UA (e2e verified, test account removed). Peter: read the four marketing pages once (they are drafts by me, not counsel; the DE LLC / arbitration / liability sections were left as they were). |
| 5b | **Google sign-up/sign-in for owners** (optional, conversion) | ⬜ | Supabase Google provider is already on (CRM uses it). Needs: "Continue with Google" on CMS /signup + /login → OAuth → wizard → new `POST /api/onboarding/signup-authenticated` (reuse the signed-in auth user, no password) → provision. Peter action: add `https://cms.stemfra.com/**` + `http://localhost:5180/**` to Supabase Auth redirect URLs. ~half a day. |
| 6 | **CRM: record lead-gen city/state coverage** (state by state across the US; start = 100 barbershop leads) | ✅ code 2026-08-18 (server + ops, NOT pushed) · ⏳ Peter: n8n insert-node change | New `leadgen_runs` ledger written by `/api/leadgen/trigger` BEFORE n8n fires (the old activity_feed run log had silently never landed: 0 rows), `leads.leadgen_run_id` link, `GET /api/leadgen/coverage` + `POST/PATCH /runs`; CRM Lead Pipeline → **Coverage** tab (50 states + DC covered/uncovered, per-city table with runs/found/approved/contacted/won, recent runs, Log a run for manual sweeps). Verified live in the CRM preview. **Peter action:** add `leadgen_run_id = body.run_id` to the n8n Supabase insert node (server docs/LEADGEN.md) so per-run counts populate. |
| 7 | **Update Mark voice call** | ⬜ | VOICE_AGENT.md phases 0-2 shipped; refresh knowledge for the commission offer + the new 3-contact sequence; verify the identified-caller path. |
| 8 | **Create a new barbershop END TO END via UI** (email → dedicated page → signup → onboarding → CMS → publish → domain) | ⬜ | The real dress rehearsal. ⚠ Prerequisite below (domain-routing cap). Flag this tenant as TEST (task 9). |
| 9 | **Demo/test data isolated from real-user data** (leads, sites, payments, monitor, reports) | ✅ code 2026-08-18 (server + ops, NOT pushed) | ONE predicate `lib/testData.js` (`siteKind` = real / demo (`is_starter`) / test (`is_test`)) now used by the commission meter, auto-collect + membership-renewal sweepers, compliance/books rollups, admin site list + monitor. Test tenants: staff **Mark as test** (CRM Customer Sites kebab, `POST /api/admin/sites/:id/test-flag`) or automatic at signup for `TEST_EMAIL_DOMAINS` (stemfra.com, example.com). `leads.is_test` (backfilled 2) hidden from the pipeline by default (toggle). Kind badges + filter on Sites/Monitor. **Clean up test data**: `scripts/cleanup-test-data.js` (dry-run default, `--apply`) + `POST /api/admin/test-data/cleanup` + CRM button with preview→confirm; scope = test sites (+orphan owner), test leads, test legal records, smoke runs; never demo/real. Dry run today = hcltech + hcltech-2 (Peter's call to purge). Use a test-domain email for #8. |
| 10 | **Release-checklist advice** | ✅ | See below. |

## Release checklist (my additions to Peter's 10, ordered)

**Must, before the 100-lead test:**
1. **Push + deploy every repo.** ✅ ALL THREE pushed + deployed 2026-08-18 (server + client:
   Argyle prod fix; platform `792c0d9`: make-editable arc, Worker code, Functions
   X-Forwarded-Host, tours, edge prerender; all 7 Pages projects green). "Local-done is not shipped" (the sms-consent lesson). Post-deploy healthchecks:
   `/health`, `/api/cms/site-uploads/healthcheck`, `/api/export/healthcheck`, `/api/public-config`.
   ⚠ **Client build rule (learned 2026-08-18):** every real client route MUST be in
   `routes.js PRERENDER_PATHS` (404.html disables the Pages SPA fallback), and never commit a
   `routes.js` that imports an untracked file (a week of silent build failures).
2. **`COMMISSION_SCHEDULER_ENABLED=true`** in deploy.yml at launch or invoicing never
   runs; decide the flip date. `RECON_ENABLED` is NOT in deploy.yml yet (add at arm time).
3. **Domain routing at scale (the wildcard Worker) — ✅ BUILT 2026-08-18, awaiting
   Peter's deploy.** Pages caps custom domains at **100 per project (Free)** and
   `attachSiteDomain` attached EVERY `{subdomain}.stemfra.com` as a Pages custom domain,
   so every provisioned site burned a slot. Now: `stemfra_platform/workers/tenant-router/`
   (ONE `*.stemfra.com` wildcard Worker: host → vertical → the vertical's Pages bundle;
   new site = DB row only, unlimited subdomains). Verified locally against real origins.
   **Rollout (README in the worker dir):** deploy platform (Functions honor
   X-Forwarded-Host) → `scripts/setup-tenant-wildcard.js --apply` (wildcard DNS + bypass
   routes; dry-run verified) → `wrangler deploy` (Workers-scoped token) → verify → set
   `TENANT_WILDCARD_ROUTING=true` in deploy.yml. Rollback = delete the Worker route.
   **Decision (Peter 2026-08-18): provision ON CLAIM (after commitment), not per lead** —
   so the 100-lead test is safe even before the Worker is live. Cloudflare-for-SaaS
   Custom Hostnames for BYO domains = the (b) follow-on, not launch-blocking.
4. **Provisioning seeds the new sections for NEW sites** — the gift-certificates page +
   the Umbra flagship bands (found 2026-08-17): today a fresh site falls back to
   hardcoded defaults until seeded. Add to `provisionSite`/the seed clone.
5. **Measurement from day 1** — the marketing event tracking (below) must exist before
   the first email goes out, or the test run teaches nothing.
6. **Terms acceptance capture** at signup/claim (timestamp + terms version) — required
   by the "accept our terms of use" step in the claim flow (task 5).
7. **Resend ceiling** — free tier = 100 emails/day shared across ALL transactional +
   auth mail (outreach goes via Gmail/n8n, not Resend). A launch week can exceed it;
   upgrade before, not after a bounce.
8. **GSC "Validate fix"** on the two canonical/redirect reasons — the fixes are LIVE (2026-08-18);
   Peter clicks Validate in Search Console.

**Should, before real tenants:**
9. Uptime + error alerting on api.stemfra.com (`/health`), the CMS and the template
   Pages projects; a written rollback (Supabase PITR/branch + redeploy previous SHA).
10. `support@stemfra.com` routing + the Voice support-intent path checked live.
11. `frontdesk_enabled` default for NEW tenants decided (on for demos; on/off for real).
12. The 2 foreign uncommitted files in stemfra_client (`GlobalAssistant.jsx`, `Youtube.jsx` +
    the two `/youtube` lines in `routes.js`): still LOCAL, Peter's call (commit = a public
    unlinked `/youtube` banner-review page; discard = drop the draft). Main builds fine either way.
13. Supabase auth SMTP + branded templates (Part A/B) — after the tasks, per Peter.

## Marketing funnel — BUILT 2026-08-19 (no traffic yet; Peter's call when to send)

**Shipped (client + server + CMS, committed, deploy = push):**
- **Prospecting email** (`templates/transactionalEmails.js prospectClaimEmail`, touch 1 + 2; previews
  `/dev/preview/claim-1|2`): approved v7 (Bentley brochure anatomy, hero-fold mockup, "Built for you",
  offer box, "Click Claim…", CLAIM MY WEBSITE, 5% note). Caller supplies `claimUrl` + `unsubscribeUrl`
  from `lib/claimTokens.js` (`claimUrlFor(leadId)`, `unsubscribeUrlFor(leadId)`).
- **Signed lead tokens** (`lib/claimTokens.js`, HMAC, no PII in URLs; secret `CLAIM_TOKEN_SECRET` →
  falls back to `N8N_WEBHOOK_SECRET`).
- **Offer resolver** (`lib/claimOffer.js`): greeting (skips generic "Owner"), business, vertical →
  FEATURED demo from the DB flag (fallback demoLinks FLAGSHIP) + its hero-fold mockup, honest bonus
  deadline (send time + 7d, never resets), CMS signup URL prefilled (`starter`, `claim`, `company`,
  `first`, `last`, `email`). Bonus copy = `BONUS` const (today: free custom domain first year).
- **Public endpoints** (`routes/claim.js`): `GET /api/claim/:token` (offer), `POST /api/claim/:token/event`
  (first-party funnel events → new `marketing_events` table; cta/signup_start also flip the lead warm),
  `GET /api/claim/unsubscribe/:token` (do_not_email + page).
- **Claim page** `stemfra.com/claim/:token` (`stemfra_client/src/app/pages/Claim.jsx`, noindex, served via
  `_redirects` `/claim/* → /claim/index.html 200`): sticky claim bar with countdown + bonus (or "still
  free" when expired), hero (Built for you / Congratulations {name}, this website is yours) with the
  mockup, LIVE demo in a browser frame (try a booking), offer checklist + 5% line, how it works, CTAs →
  CMS signup. Events: claim_page_view / claim_cta_click / claim_see_live_click.
- **CMS signup** reads `claim` + prefill params, sends `claimToken`; `onboardCustomer` marks the lead
  `won` / `converted`, links `contact_id`, logs `signup_complete`.
- Verified locally end to end with a real lead token (page → CTA → CMS prefilled).

**Not yet:** the sequence (#2) that SENDS touch 1/2 with these links (next), Mark's knowledge (#7),
per-prospect hero render (brand override + capture; only if opens without clicks), CRM funnel view
over `marketing_events`, the demo's own promo popup inside the frame (consider `?embed=1` to mute).

### Original discussion (kept for the record)

**Peter's proposal:** cold email = 3 bullets on the offer + a hero screenshot + a link
to a personalized dedicated page (name in the URL/page) that lets the prospect **try
the live demo website**, then **"Claim this website"** → onboarding; a Hostinger-style
**countdown** (e.g. 24h bonus); links to more templates + terms/privacy on the marketing
site; **native event tracking** (page view → CTA click → signup start → onboarding
complete) via utm/reference per lead, optionally Microsoft Clarity for behaviour, NO
Facebook SDK; the guided tour on the tenant site visible on demo sites only (usable in
the video); the demo video shows the tenant website, not the CMS.

**Claude's read (opinion, for the discussion):**
- **Strongly agree with the shape.** This is the parked "preview-then-publish"
  conversion engine (platform CLAUDE.md), now concrete. Free-to-experience, claim to
  own, 5% commission = the right frame.
- **Prefer option B (dedicated page ON stemfra.com hosting the preview) over option A
  (popup injected into the demo sites).** B keeps the demo sites clean product, gives
  one place for terms acceptance + analytics + brand, and needs no demo-only mode in
  the tenant templates. The existing marketing preview screen already renders one site
  per page; put the horizontal countdown/claim bar directly under the navbar (the
  Hostinger pattern Peter described).
- **Countdown must be honest.** The core offer is free forever, so the countdown should
  tie to a REAL bonus (e.g. free domain first year / priority setup) with the deadline
  stored per lead from send time, not a fake timer that resets on reload. Otherwise it
  costs trust with exactly the small-business owners we want.
- **Personalization via a signed lead token, not raw name/email in the URL.** Token
  resolves server-side to the lead (name for the greeting, prefill for signup, the
  countdown deadline, attribution). No PII in query strings (house rule) and it makes
  every event attributable to one prospect.
- **Native tracking = a `marketing_events` table** (lead token · event · page · utm ·
  ts): `email_open` (existing pixel) → `page_view` → `cta_click` → `signup_start` →
  `onboarding_complete` → `published`. One CRM funnel view answers "did the email
  work / did the page work / did onboarding work". Clarity optional on top. Reuse the
  DMT-style event pattern; keep it first-party.
- **Screenshot in the email** = the existing prepared-masters/mockup pipeline
  (MARKETING_MOCKUPS.md) rendering the demo's hero; same asset on the dedicated page.
- **Auto-provisioning a claimable site per prospect** is where the Pages 100-domain cap
  bites (checklist #3). Decide: provision on claim (after commitment) vs pre-provision
  per lead. Pre-provision needs the wildcard Worker first.
- **Demo-site guided tour** = a `metadata.demo_tour` flag on the site, default on for
  Starters/demos, off for real tenants; the same tour engine as the CMS one.

Draft email (Peter): "Hey {Name}, this website is for you. Claim it now for free" →
[hero image] → [Claim] → dedicated page: "Congratulations {Name}! Here is what we are
giving for free: free domain, SMS, hosting, … We only take 5% of the bookings you make
on the website after claiming it." → Try it out (interact) → Signup → links to offer /
terms / privacy.
