# Stemfra — Roadmap & Pending Tasks (prioritized)

_Updated 2026-07-29 (full-project audit pass). Single cross-repo source of truth.
The order below IS the recommended build sequence. Per-feature detail lives in the
linked docs; this is "what's next and why."_

## 📌 WHERE WE STAND (2026-07-29 audit — read this before the per-arc detail)
_Verified against code + DB + env, not just doc claims. Active arc = **P13 commission
model** (`docs/COMMISSION_MODEL.md`)._

**Genuinely OPEN engineering tasks:**
1. ✅ **Task 59 — CRM Site Monitor DONE (2026-07-29, verified in-browser).** Observe-only
   per-site activity/performance: server `GET /api/admin/sites/monitor`
   (`controllers/admin/siteMonitorController.js`, PLATFORM_OPS; window metrics bookings/
   revenue/leads/chats/subscribers + all-time + lastActiveAt from booking/lead/chat/
   site_activity; JS aggregation over capped fetches — move to SQL group-by at scale) +
   CRM `/site-monitor` (`pages/SiteMonitor.jsx` + `useSiteMonitor`): window presets +
   custom range, "Inactive > 1 year" filter, sort, totals strip, freshness tints, manual
   Nudge (mailto) + open-site. No automatic dormancy actions, by design.
2. **Task 56 — Public Docs / Help Center: ✅ BUILT 2026-07-29, PUSHED 2026-08-03.**
   Live in `stemfra_client` at `/docs` + `/docs/:category` + `/docs/:category/:slug`.
   Structured-block content in `src/app/docs/data/{gettingStarted,domains,payments,
   bookings,billing,account}.js` (6 categories / **26** articles — 25 → 24 with the link-out reversal, +2 GBP/review-link articles 2026-08-04) + `index.js` registry;
   components in `src/app/docs/` (DocsLayout/Sidebar/Toc/Blocks/Hub/Category/Article),
   all on WHITE canvas (Peter's call). Wired into routes.js (+ PRERENDER_PATHS via
   `docsPaths()`), seo.js (`seoForDocs`), Footer ("Help Center" link) + FAQ cross-link.
   Truth rules held (no tiers/SMS/auto-debit/voice; commission framing throughout).
   Verified: `npm run build` prerenders 50 routes (33 docs as of 2026-08-04; was 48/31) + sitemap; browser walk
   of hub + Stripe article (images/table/callout/TOC render); all 10 internal links
   resolve; `grep -R "—" src/app/docs` clean. Spec: `stemfra_client/docs/DOCS_CENTER_SPEC.md`.
   ✅ Follow-up DONE (2026-07-29, committed not pushed): `stemfra_client/src/app/pages/
   FAQ.jsx` + `stemfra_platform/docs/STRIPE_ONBOARDING.md` rewritten to the commission
   model (free website, no setup/monthly fee, flat 5% on sales billed separately by
   invoice; card money still flows to the tenant's own Stripe/bank) + em-dashes cleaned.
3. **Task 57 — domain policy:** ✅ onboarding "Do you already have a website domain?"
   question DONE (2026-07-29, verified UI + persistence) — signup step 1 cards (Not yet /
   Yes I own one + optional domain input); answer normalized (lowercase, proto/www/path
   stripped) into `sites.metadata.onboarding.domain {has_domain, domain}` for the
   Settings → Domain card + staff to act on post-signup. Subdomain default + BYO connect
   + CMS search/buy UI were already DONE. **Remaining: collect-first buy-through-us only**
   (waits on a payment rail).
   ⚠ **2026-08-04 audit — two code-vs-policy gaps in the existing register path**
   (`routes/cms/siteDomain.js` register): (a) it implements FRONT-THEN-BILL (register
   at Porkbun, then a `billing_charges` invoice) while the P13 policy here says
   collect-first/never-front — the shelved variant is the one wired; (b) its gate
   checks `subscriptions.status='active'`, which NO commission-era tenant has
   (subscriptions are retired), so owner self-serve domain buying is effectively
   dead-gated for every new tenant. Both resolve together when collect-first lands
   on a payment rail; until then the path is inert for new tenants, which is safe
   but worth knowing before demoing it.
4. ✅ **P12 Wave 2 Task 9 — owner SMS alerts — DONE 2026-08-06** (A2P campaign
   approved 2026-08-03, Peter confirmed via the Twilio email). `lib/ownerSmsAlerts.js`
   (consent-gated on `cms_notification_prefs.prefs.sms` from the SmsAlertsCard;
   `OWNER_SMS_ALERTS_ENABLED=false` kill switch) wired alongside the owner emails
   under the same per-event prefs: new booking / cancellation / reschedule /
   website lead / chat lead / chat escalation / membership signup. Inbound
   STOP flips the consent record (`routes/twilio.js` sms-inbound). Verified
   end-to-end: a real forge-and-bell booking produced a DELIVERED alert on the
   approved campaign; all fixtures + the seeded test consent cleaned.
   ⚠ Remaining Peter action: opt in for real via CMS → Settings → Notifications
   SmsAlertsCard (no consent rows exist yet; nothing sends until owners opt in).
5. **P10 case 42 "Remix" R2/R3** (AI theme composer engine) — R1 registry done; rest pending.
6. **P10 case 1 remainder** — task videos + a "What's new" channel (guidance polish shipped).
7. **VSL production** (P12 "Last") — deliberately last.
8. ✅ **Front Desk widget rollout to all 6 verticals — DONE 2026-07-31.** This entry
   was written 2026-07-29, two days before the rollout landed, and stayed stale.
   **Re-verified independently 2026-08-03**, not taken from the doc's own claim:
   `logoUrl` + `suggestions` passed in all 6 Layouts; `memberToken` in
   crossfit/massage/spa (the only three with a member portal); the "Chat assistant"
   privacy clause present on **18/18** live+previewing sites (SQL over
   site_pages/site_sections); `metadata.classes` + `expires_days` on **3/3** active
   class packs (only lila-studio sells them, so nothing else was in scope).
   **Genuinely still open** (verification gaps, not rollout work) in
   `stemfra_platform/docs/FRONTDESK.md` §9: the member path has never been exercised
   through a live signed-in chat; multi-line slot cards never rendered (no site sets
   locations); Shift+Enter and paste were reasoned, not demonstrated; and Lira Yoga
   still carries 6 duplicate/stale service rows that make `/list services` show 12
   rows where 6 are noise.

9. ✅ **BOOKABILITY HYGIENE CLOSED 2026-08-04 (Peter approved all groups).** Data:
   Group B — 30 priced massage/spa modalities flipped bookable + 96 staff links
   (lull/reveline/umbra/vela/aurea, the ellaris verdict applied); Group C —
   "Couples Massage (at home)" reclassified class→appointment + 16 links on all
   6 wellness sites (it was dead-ending everywhere, ellaris included); Group D —
   wildflower's Vinyasa Flow priced $24 + 16 daily 09:15 sessions seeded (lila's
   shape). Post-fix sweep: the ONLY remaining findings are crossfit's 24 group
   Programs = Group A, deliberate display-only. **Durable fix shipped:** Services
   page bookability badges (amber "Display only" stated neutrally; red "No staff
   linked" / "No upcoming sessions") — owners now see their own gaps; no more
   sweeps. Verified live: forge shows exactly 6 amber, 0 red.
   ─ Original record: **Front Desk sweep — COMPLETE 2026-08-01 across all 6 verticals** (4/4 starters
   each + visual pass). Fixes committed: details form now requires name, email AND
   phone, enforced server-side in `detailsCard()`/`hasContact` so BOTH the
   appointment and class branches get it (`2d7986c`, `9da0e8d`); "First time here"
   returns a real first-visit answer plus the services list instead of an empty
   welcome, and a trailing "tap any day for details" is stripped when no row in the
   card is tappable (`4e6470b`); message-avatar frame reduced to a hairline
   (`6b97bf6`). **Still open from the sweep:**
   - **Bookability data hygiene (NOT a bulk fix — needs per-vertical rules).** A
     cross-site query found 11 live/previewing sites with services that are ACTIVE
     but `bookable=false` (so they render as dead rows in the chat menu) and/or
     `bookable=true` with ZERO team links (so they dead-end at availability).
     ⚠ **Some of this is deliberate**: on crossfit (forge-and-bell, ironclad-athletics,
     212-strength-co, blackfly-barbell, aurea) the 6 non-bookable rows are the group
     PROGRAMS, intentionally kept out of the 1-on-1 wizard per the appointments-vs-
     classes model in `stemfra_platform/CLAUDE.md`. And "bookable with no staff" is
     fine for CLASS bookings, where the calendar comes from scheduled sessions rather
     than staff availability (lila-studio's 5 are likely this). So the task is to
     decide the rule per vertical, then fix only what is genuinely wrong.
     **Queued for this task (found 2026-08-03):** `wildflower-yoga-pilates` →
     **"Vinyasa Flow"** is `bookable=true` with `price_cents=0` and ZERO
     `site_class_sessions`, so it renders priceless next to a `$30` row in the chat
     list and dead-ends at availability if tapped. Surfaced when the site's 6 stale
     rows were deactivated (FRONTDESK.md §9 #11). Deliberately NOT bundled with that
     cleanup: this is a content call (seed sessions + a price, or deactivate), and it
     is the same "bookable with nothing behind it" rule this task exists to decide.
     ⚠ Note wildflower now shows only 2 services, one of them this broken row — check
     it before using that site in a demo.
     **Already fixed: ellaris-spa only**, where it was an unambiguous within-site
     inconsistency (6 massage modalities non-bookable while the site's other massages
     were bookable with the same 4 therapists; plus "Couples Massage (at home)" marked
     bookable with no staff). Now 17/17 bookable, min 4 staff. Revert by setting those
     6 back to `bookable=false` and deleting their `site_team_service_links`.
   - **The durable fix worth considering**: surface this in the CMS (warn when a
     service is active but unbookable, or bookable with nothing behind it) so owners
     see it, instead of relying on a sweep to catch it.
   - ✅ **Doc-vs-DB drift FIXED 2026-08-03**: the canonical mapping now lives in
     `stemfra_platform/CLAUDE.md` ("SUBDOMAIN ≠ BRAND NAME" table) + the massage/spa
     reference. Rule: identify fixtures by SUBDOMAIN (maison-lune = Maison Solène,
     lila-studio = Lira Yoga, `lull` = Lull Massage; the whole wellness demo fleet
     was renamed — calm-roots-massage/zen-haven/reverie-massage/respira-spa/lumora-spa
     are all DEAD subdomains).
   - **Never exercised**: member reschedule/cancel through a real signed-in chat on
     the member-portal verticals (crossfit/massage/spa).

10. ✅ **Tier-system residue — CLEANED 2026-08-04 (the parts that were residue).**
    Done: SignupPage no longer records a fabricated `tier: 'growth'` on every
    commission-era signup (nothing links `?plan=` any more — verified before
    cutting; the server still accepts-and-nulls the field for back-compat);
    dead `useChangePlan` + `PlanOption` + the unused availablePlans/currentTier/
    canChangePlan fields removed from `stemfra_cms/src/lib/billing.ts` (CMS
    typecheck clean); `SMSModal.jsx`/`SMSThread.jsx` DELETED from stemfra-ops
    (zero imports; ops build clean; ConversationPanel comments updated).
    ⚠ **Deliberately KEPT — this is the important finding:** the tier-shaped
    `/api/plans` catalog and the CRM `OfferEditor` are NOT residue. They are the
    live implementation of "everyone gets everything": `Pricing.jsx` and the CMS
    BillingPage render the UNION of live features across the catalog tiers, and
    OfferEditor is the no-deploy switch for feature statuses (live/gated/soon).
    Deleting them would remove real capability. The only remaining cosmetic item
    is `Pricing.jsx:36`'s own TODO (reshape the catalog from tiers to a flat
    feature list — a 4-consumer refactor with zero behavior change; do it only
    when touching the catalog anyway).

11. ✅ **Reassign a booking to a different team member — SHIPPED 2026-08-05**
    (verified live on forge-and-bell). Built exactly as proposed below: a "Change"
    control next to "with {staff}" in `BookingDetailModal` (confirmed + future +
    assigned bookings only) opens `ChangeStaffDialog` — qualified staff only
    (via `site_team_service_links`), anyone already booked at that time shown
    greyed out "Busy at this time"; `validateStaffAssignment` re-checks at save.
    A same-time swap keeps the reminder stamps (`useRescheduleBooking` gained
    `timeChanged` gating) and audits as `staff_reassigned`; the customer still
    gets the update email. The calendar drag path (`handleEventDrop`) now runs
    the same guard (qualification on cross-column drops + conflict always) and
    labels a pure column swap "Staff reassigned"/"Appointment reassigned".
    **Bonus fix:** the reschedule audit had NEVER landed — it wrote to the CRM's
    `activity_feed`, whose entity_type CHECK rejects `site_booking` (the
    [[feedback_audit_use_site_activity]] trap), and owners have no INSERT policy
    on `site_activity` anyway. New `POST /api/cms/activity` (allowlisted actions,
    ownership-checked, service-role `logSiteActivity`) + client
    `logBookingActivity` in `bookingNotify.ts`; reschedule/reassign audits now
    actually persist. Front Desk chat swap remains a possible follow-up.
    Original scope: Real
    scenario: a customer books Barber A, A calls in sick, the manager offers Barber
    B, B does the cut. **The capability half-exists**: dragging an appointment
    across staff columns in the Bookings calendar DAY view sets `newTeamMemberId`
    and updates `site_bookings.team_member_id` (`BookingsCalendarPage.tsx`
    `handleEventDrop`), and writes an `activity_feed` row. Attribution downstream is
    correct, because the team member is a live FK (only the service NAME is
    snapshotted). **Gaps:**
    - No staff picker in `BookingDetailModal` — the place a manager actually looks.
      Its pencil edits date/time only, so the feature is undiscoverable.
    - Drag works in DAY view only, and drag is the wrong interaction for a manager
      standing at the counter on a phone.
    - `handleEventDrop` runs NO guard: it does not check the target is linked to
      that service (`site_team_service_links`) and does not run the conflict check
      (`useBookingConflicts` is wired to the reschedule dialog, not the drop). So a
      service can be assigned to someone who does not offer it, or double-booked.
    - It reuses the reschedule mutation, so a same-time swap needlessly resets
      `reminder_24h_sent_at`/`reminder_2h_sent_at` and logs the reason as "Moved on
      calendar", which is wrong for a swap where nothing moved.
    - The Front Desk chat cannot do it (member reschedule/cancel exist; swap does not).
    **Proposed:** a "Change barber" control in `BookingDetailModal` reusing
    `useRescheduleBooking` with `newTeamMemberId` and the unchanged start time,
    offering only qualified + free staff, reason "Staff reassigned", no reminder
    reset. Apply the same qualification/conflict guard to the existing drag path.

12. ✅ **Clients page v2 — SHIPPED 2026-08-04** (revenue column + sortable headers +
    open numeric filters; loyalty SEGMENTS dropped by Peter's call — thresholds
    don't transfer across verticals, the owner filters by number instead. A
    per-client profile view + a dashboard Top-clients card remain optional
    follow-ups). Original scope: Today's Customers page is a directory (visits, last
    visit, tags, notes, opt-outs, CSV, suspend) with NO revenue view. Build:
    per-client lifetime revenue (sum of paid `site_bookings.amount_cents` + the
    at-visit `metadata.collected` amounts) + visit cadence on the list and a
    per-client profile; derived segments VIP / regular / new / lapsed (spend +
    recency); a "Top clients" dashboard card. The lifecycle emails (win-back,
    birthday w/ discount) already ACT on loyalty — this adds the insight layer
    that tells the owner who deserves the holiday bonus. **Design reference
    (Peter): the Idometrics admin Users table** (`/Volumes/Peter Drive/peters
    macbook air/Desktop/idometrics/May 2026 ido/ido-admin`, `app/(main)/users/`):
    generic `columns` config with multi-field cells + custom renderers, a Profile
    cell (avatar + name + email) linking to a per-user view page, status badges,
    a status filter dropdown, per-row actions. Sidebar already says "Clients".

13. ✅ **Mapbox location maps — CORE SHIPPED 2026-08-04** (LocationMap archetype:
    dynamic-import mapbox-gl, address geocoding, --site-accent marker; wired into
    BOTH map-showing variants — Default/streets + DarkPanel/dark — with the
    Google-embed fallback kept, so no-token sites are untouched. Verified live on
    argyle/Classic NYC. Token in each template's .env.local (gitignored).
    ⚠ REMAINING — PETER ACTION for prod: add `VITE_MAPBOX_TOKEN` to each of the 6
    Cloudflare Pages template projects' env (build-time var), else prod keeps the
    Google embed fallback (harmless, just unstyled). Optional hardening: restrict
    the token to *.stemfra.com + localhost in the Mapbox dashboard.) Original:** Pattern + credentials come from unekride:
    `unekride-customer-mobile/components/BookingMap.web.tsx` (mapbox-gl in the
    browser, PUBLIC token — safe to ship; style URLs streets-v12 / dark-v11 with
    a theme hot-swap). Token lives in
    `/Users/peterokeme/Documents/SAAS/unekride/unekride-customer-mobile/.env`
    (`EXPO_PUBLIC_MAPBOX_PUBLIC_TOKEN`; there is NO unekride-server dir — the
    mobile app is the only Mapbox consumer). Build: a Mapbox variant of
    `LocationCard` themed via `--site-*` (light/dark style per theme register),
    token as `VITE_MAPBOX_TOKEN` in the template apps, keep the current
    placeholder-behind-iframe fallback pattern. No server work (public token).

14. **Help Center: CMS how-to docs (Peter, 2026-08-04 — list to be agreed).**
    First articles: "Manage your Team" + "Manage your Services" — add / edit /
    reorder / photos / team-service linking / delete, every control on those
    pages, barbershop as the worked example. Proposed full list for discussion
    (mirrors what owners actually touch): Bookings calendar (statuses,
    reschedule, mark collected) · Pages & sections editing + live preview ·
    Media library · Promotions · Blog · Automated emails + review link ·
    Front Desk on/off + what it does · Reports · Billing (invoice → receipt) ·
    Clients page. Rule from the GBP articles: point at real product surfaces,
    embed videos only where a third-party UI is the confusing part — our own
    CMS should be documented with our own screenshots.

**DEPLOY/OPS GAPS (audit 2026-07-29; re-verified 2026-08-03):**
- ✅ **`PAYMENT_CREDENTIALS_KEK` is now in `deploy.yml`** (line 136, from the GitHub
  secret). Verified 2026-08-03. The P12 direct-keys payment system is no longer
  silently disabled in prod.
- ✅ **`COMMISSION_SCHEDULER_ENABLED=false` is now in `deploy.yml`** (line 137) —
  still intentionally OFF pre-launch (manual `/commission/run` works). **Flip to
  `true` at launch or invoicing will not run.** This is the one to remember.
- ✅ **The uncommitted surface is CLOSED.** Committed 2026-07-29 and **pushed
  2026-08-03** (server `b28363a`→`737ed5b`, platform `→3d3857d`, client
  `→3fcc07b2`; ops and business had nothing outstanding). All repos are at zero
  ahead, zero dirty, so a rebuild from `main` now ships everything.
  ⚠ The push also put `stemfra.com/sms-consent` live for the first time; it had
  been 404 in production the whole time the A2P arc was "done" locally. Worth
  remembering as a class of bug: local-done is not shipped.
- Per-tenant Stripe webhook (`/api/stripe/webhook/:siteId`) deliberately deferred
  (redirect-verify + sweeper covers one-time charges — see P12_PLAN); the stored per-site
  webhook secret is currently written but never read.

**Waiting on EXTERNAL (no code blocked behind them except as noted):**
- **A2P 10DLC** — campaign v2 resubmitted 2026-07-26, vetting typically ≤5 days → unlocks
  Wave 2 Task 9 (SMS alerts).
- **Airwallex card KYB** — unlocks Batch 2b auto-debit; activates with trading history.
  Manual bank-transfer invoicing loop is COMPLETE and is the live collection path.
- **Stripe (Stemfra's own) verification** — NOT blocking anything current (commission model
  collects by invoice; tenant card payments use the tenants' OWN keys). Only gates the
  dormant Connect/System-B path + platform auto-debit alternatives.
- ~~Porkbun account~~ ✅ verified + funded; CMS domain search tested live. First real
  purchase still untested (deliberate).
- ~~Cloudflare API token scopes~~ ✅ done — full domain-zone + Email Routing + Resend
  workflow shipped and tested (prod deploy.yml carries EMAIL_PROVIDER=resend + keys).

## ✅ Done this session (2026-06-28/29)
- 9 demo sites (one per active theme, 4 verticals), owner `peechizzy@gmail.com`
  ("Marcus Argyle"); `demo_link` map + send-outreach wiring.
- Email open-tracking (pixel + endpoint); Mark outreach (send as `mark@`, reply sweeper).
- `provisionSite` vertical-alias fix; `boutique_gyms` vertical deactivated.
- **Pricing page honesty pass** — removed "— 2 months free" from the Annual
  toggle; **trimmed all 3 tiers + the core strip to features that ship today**
  (payment/membership/voice features gated → documented in `docs/OFFER_TIERS.md`,
  re-add as they land). ⚠ **Pro is now thin** — see P6.1 (product decision pending).

## ⚙️ Operational / parallel (Peter — not code) — ⚠ HISTORICAL (2026-06-29); superseded by the "WHERE WE STAND" block above
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
8. ⛔ **Payment/booking-provider setting (#3) — REVERSED 2026-07-29 (Peter's call).**
   The external "link-out to Mindbody/Vagaro/etc." booking option was REMOVED so
   Stemfra's own native booking is the ONLY booking system. Gone: the `link_out`
   radio + provider dropdown + URL field in CMS `BookingSection.tsx`, the
   `bookingProviders.ts` catalog, the server `/api/cms/payments/booking-mode`
   endpoint + `getBookingMode`/`setBookingMode`, the Front Desk `link_out`
   deflection, the template CTA `link_out` branch, and the Help Center article.
   RETAINED: `consultation_form` ("no online booking" → phone/contact). The DB
   `booking_mode` enum still carries the unused `link_out` value (not dropped).
   The only competitor stance now on record is "no API integration" (unchanged).
   _Historical (superseded):_ DONE: CMS "Booking & payments"
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
20. Stacy ~~S3 (act)~~ ✅ S3 DONE (clone action, 2026-07-01 — see server CLAUDE.md) + **S4** (RAG + insights, still open).
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
    ⚠ **2026-08-04 audit: the UI half of this no longer exists.** `ChangePlanCard`
    was removed with the tier retirement (P13 — no tiers to change between);
    `useChangePlan` survives in `stemfra_cms/src/lib/billing.ts` with ZERO callers
    (dead code, cleanup candidate). The entry stays ✅ as history; do not go looking
    for the card.
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
- [x] ~~Create the Cloudflare Pages project `stemfra-massage`~~ DONE — verified 2026-07-10: all 7 Pages projects (4 templates + CMS + massage + spa) exist, env vars complete, latest deploys green (repo pushed 2026-07-07).
- [ ] Teach the n8n lead-gen workflow the 'massage' vertical (3-place sync: CRM + server done)
- [ ] Marketing site wiring for massage (themes.js gallery entry, pricing page, demo site + Starter flag) — after the theme walk
- [ ] **Spa vertical**: clone from the COMPLETED massage (app copy on :5182 + seed via onboardCustomer + reactivate the parked `spa`/`spa-classic` DB rows re-sourced from massage)

---

## 📌 Status refresh (2026-07-10)

**Peter's dispositions on the open list:**
- Porkbun: verification DONE — only **funding the prepaid balance** remains.
- Wellness pricing: **uniform 3-tier pricing for ALL verticals** (no per-vertical prices). ✅ DB `verticals` rows aligned 2026-07-10 (`build_price_cents=100000`, `monthly_price_cents=9900` fleet-wide — these feed publishController + admin Stripe checkout, so the legacy $750/49-style numbers would have billed wrong). Deeper follow-up: the publish flow should eventually read the chosen TIER's price from `crm_settings.billing_plans`, not the vertical row.
- ✅ Yoga un-flagged (theme card + drawer "Soon" badge removed; Wren Yoga card live w/ hero-fold).
- ✅ Annual discount threaded: Pricing.jsx now uses catalog `annual_discount_months` (verticals.js constant = fallback only).
- ~~Template Pages env~~ VERIFIED 2026-07-10 via CF API: all 7 projects carry VITE_SUPABASE_URL/ANON_KEY/SERVER_URL + NODE_VERSION — nothing to rectify.
- CRM `.env` stays on the dev endpoint during development (flip at deploy time only).

**P9 corrections (stale):** spa vertical DONE (3 themes: Ellaris default · Lumora · Respira); massage walk + marketing wiring DONE (themes.js/pricing/products/Starters all carry massage+spa); what remains from P9 = commit pass · Docker/Playwright base · CF Pages projects for massage+spa · n8n massage(+spa) vertical · Escape 🟡 fidelity variants.

## P10 — New planned arcs (2026-07-10, PLANNING AGREED — build order TBD with Peter)
_Peter's cases #1–#11 (#8 beta-test done; #10 = the standing pending list above). **Full Q&A + agreed plans: `docs/P10_CASES.md`.** Build order agreed: 40 → 38 → 39 → 43+45 → 37 → 42-R1 → 41._

37. **CMS ease-of-use program** (case 1) — honest score ~6.5/10 today. Plan: (a) plain-language + guidance polish pass in-product; (b) click-to-edit live preview (the parked Phase B postMessage bridge); (c) 5–10 short task videos + docs AFTER the UI stabilizes; (d) NO Squarespace-style version branding — use the existing notification system (`broadcast_announcement`) as an in-app "What's new" channel + a changelog page; (e) usability sessions with 2–3 founding-cohort owners.
38. **CMS Theme studio + plans display** (case 2) — upgrade Settings→Style themes grid to the marketing-gallery register (hero-fold mockups via `GET /api/marketing/mockups`, brand/city, Preview → demo, Switch stays); tier cards in Account→Billing "Change plan" rendered from `/api/plans` (same catalog as marketing).
39. **Promo banners/popups catalog** (case 3) — `site_promotions` schema + ~10 token-driven banner archetypes (overlay popups + inline bands + top bar) + template `PromotionHost` (frequency-capped, a11y) + CMS Promotions editor with visual style picker. v1 display-only; v2 ties into promo codes when payments land.
40. **Staff mode in the CMS** (case 4) — NOT a separate admin CMS: @stemfra.com Google auth recognized in the existing CMS → all-sites picker (staff RLS already grants data access) → "Editing as Stemfra staff" banner + `site_activity` audit on every write + server-side staff bypass of `verifySiteOwnership` (logged). CRM keeps ops; CMS becomes the shared content-editing surface.
41. **CMS mobile** (case 5) — ladder: (1) responsive polish + PWA (installable, web-push via the existing notification system) NOW-ish; (2) store wrapper (Capacitor) when store presence matters; (3) native = parked until client demand.
42. **Website "Remix" AI theme composer** (case 6) — phased: R1 machine-readable **variant registry** (archetype→variants→content keys) + per-variant preview captures (extend the mockup pipeline) + a visual component browser; R2 remix engine (LLM picks arrangement/variants/palette/fonts within compatibility rules → writes an inactive `templates` row → theme-audit validates → human approves); R3 owner-facing per-section "swap the look" picker. Internal catalog-velocity tool FIRST (distinctness standard still gates what ships).
43. **Domain → Cloudflare zone automation** (case 7) — today: registered + DNS at Porkbun, CF only validates the Pages custom domain. Target: keep registration at Porkbun, **move DNS to a CF zone** at purchase (create zone via CF API → set nameservers via Porkbun API) for proxy/SSL/WAF + programmatic DNS (synergy w/ email routing #34 + Workspace #45). Full registrar transfer to CF = optional ≥60 days post-registration (ICANN lock), not v1. BYO-domain users keep ownership (connect-only, as today).
44. **Email template suite + auth security** (case 9) — unified branded base template (header/footer) across ALL transactional mail (billing request/receipt, booking, welcome); customize Supabase Auth templates (OTP/magic-link) + wire custom SMTP for brand consistency; **new-device/location login alerts** (capture login events → email w/ "this was me / secure account"); 2FA TOTP already live in CMS → add recovery codes + staff enforcement; email-approved-login gate = later phase.
45. **Customer professional email** (case 11) — ladder: (1) **Cloudflare Email Routing forwarding as the Pro perk** ($0 COGS, needs #43's CF-zone DNS); (2) Google Workspace referral/assisted setup (client pays Google); (3) full Workspace resale via a distributor (Pax8/Sherweb, ~$3–4 wholesale vs $7–8 retail) only at volume — needs reseller onboarding, provisioning via Reseller API, billing + support burden.

## P11 — Voice agent maturation (NEW, 2026-07-21 — baseline scored, phased plan agreed)

_Benchmarked "Mark" against the Retell (customer-support) and Thoughtly (outbound-sales)
2026 evaluations. **Baseline: ✓ 7 · ◐ 15 · ✗ 16** — strong conversational core (barge-in,
grounded answers, 60-msg memory + caller-ID after the 2026-07-21 fixes), thin around the
call (actions, escalation, dispositions, multichannel, analytics, compliance).
**Full scorecard + phased roadmap: `docs/VOICE_AGENT.md`** — re-score there as we improve._

46. ✅ **Phase 0 — correctness** (DONE 2026-07-21): support-intent routing (support calls currently file as
    SALES LEADS — wrong queue), transcript persistence, structured dispositions v1,
    outbound updates the source lead (no dup inserts).
47. ✅ **Phase 1 — sales quick wins** (DONE 2026-07-21, verified): sub-60s reply-triggered calling (5–10× stat), live
    transfer + staff summary, post-call recap email/SMS (new chocolate templates),
    voicemail detection/drop, qualification schema.
48. ✅ **Phase 2 — support abilities** (DONE 2026-07-22): caller-ID→account identification, account context via
    Stacy's `buildSiteContext`, safe action tools (password-reset email, support ticket,
    callback) via the Front Desk server-orchestrated tool-loop pattern.
49. ~~Phase 3 — tenant voice~~ **RETIRED 2026-07-27 by the P13 pivot** (see the
    "Confirmed 2026-07-27" block below: tenant Voice dropped on cost; Front Desk chat
    covers tenants; Stemfra keeps its own "Mark"). The retirement was announced there
    but this line was never struck — a 2026-08-04 audit found three places still
    treating Phase 3 as live (here, Wave 3, the P12 arc header). Struck now.
50. **Phase 4 — scale**: CRM call analytics (measure the 40–70% resolution benchmark),
    DNC/TCPA machinery before colder outbound, premium voice, load testing.

## P12 — Payments pivot + acquisition funnel (NEW, 2026-07-22 — AGREED, supersedes P11 ordering)

_Peter + Claude planning session (Fable). **Full agreed plan: `docs/P12_PLAN.md`**;
A2P answers: `docs/A2P_REGISTRATION.md`. Key decisions: tenant payments pivot to
DIRECT per-site Stripe keys (restricted keys, encrypted; Connect code dormant, not
deleted) — unblocks deposits-at-booking NOW, independent of Stemfra's own Stripe
verification; the Kai-Stone-style funnel (VSL → 45-min setup call on OUR OWN
booking system → pay-and-publish); ONE SMS program only (Stemfra → owners+staff
with the customer's contact details — NO tenant→end-customer SMS); Mindbody hard
line ~~with an external-booking-URL escape hatch~~ (escape hatch REMOVED 2026-07-29
— native booking only, see the top block). **Resequencing note is historical: Voice
Phase 3 was RETIRED 2026-07-27 (P13), so "Phase 3 scope grows to include
browser-voice" no longer applies. VSL production is still deliberately LAST.**_

51. **Wave 1** — payments pivot build (`site_payment_credentials` + AES-256-GCM,
    `getStripeForSite`, redirect-verify Checkout, ~~per-tenant webhooks
    `/api/stripe/webhook/:siteId`~~ (deferred — never built; the flat webhook + sweeper
    covers it, see the deploy-gaps block), CMS/onboarding key capture,
    ~~external-booking-URL option~~ (built then REMOVED 2026-07-29 — native only))
    · Mark Phase 1.5 (call-reason modal + activity-feed-enriched context)
    · Stacy "Prefer to talk?" tier A · **Peter: submit A2P registration** (lead time).
52. **Wave 2** — setup-call booking on the internal Stemfra site (dogfood; reminder
    sweeper free) · pay-and-publish automation (billing_charges paid + checklist →
    auto-publish → domain step) · owner+staff SMS alerts (post-A2P-approval) ·
    **Case 2 tenant email redesign** (pre-existing) · switcher messaging (A13 upgrade).
53. **Wave 3** — tenant blog completeness (massage+spa finish, per-theme audit,
    rollout decision) · ~~Voice Phase 3 (tenant voice + browser-voice)~~ ❌ RETIRED (Peter, final 2026-08-04: no tenant voice agent, ever — Mark stays Stemfra-internal only; struck everywhere to prevent the mistake recurring)
    · Square adapter on first real demand (GoCardless trigger noted).
54. **Wave 4** — **Voice Phase 4** (analytics, DNC/TCPA, premium voice — scoped to
    Stemfra's OWN agent "Mark" only; the tenant half died with Phase 3).
55. **Last** — VSL production (Peter's voice over a demo-site screen-share; script
    `docs/SALES_SCRIPT_TEMPLATES.md` §1; Cloudinary hosting, `{{vsl_link}}` template
    variable, click tracking, Mark call-flow mention).

## P13 — Commission model + domain policy + public Docs (NEW, 2026-07-27)

_Strategy session (Peter + Claude). **Authoritative plan doc: `docs/COMMISSION_MODEL.md`**
(incl. a full prior-pending-tasks reconciliation with status marks). Full narrative +
diagrams also on the **Business Model page** in `stemfra_business` (`/business-model` →
Marketplace, Unit economics, Airwallex email). Decisions below are AGREED; the
non-external-dependency items can start now._

**Commission model — REPLACES the subscription model (not a co-model):**
- The subscription offer ($1k build + $/mo) is **retired**. The business model is
  **free site + 5% commission on ALL sales (unified)** — online bookings + at-visit
  sales the tenant marks "collected" in the CMS (Reports v2, already built) = our source
  of truth for total GMV. We are **pre-launch (no live paying subscribers)**, so there is
  no revenue to bridge — the first tenants onboard directly onto commission.
- Commission is collected by a **monthly metered INVOICE** paid to Stemfra's **Airwallex
  Global Account** (US bank; details in `crm_settings.commission_bank`) + tenant **receipt
  upload** (source-of-funds). **No setup fee, no minimum, no dormancy fee.** Processing fee
  shown SEPARATELY (Etsy-style). (UPDATED 2026-07-27 after the Airwallex call — see below.)
- **Marketplace / auto-split is SHELVED** — Harry Raj confirmed it is white-labelling
  Airwallex at **~$20–25k/mo** for high-volume platforms; not viable now. Stripe Connect /
  Adyen carry the same platform cost. **The drafted Platforms email is retired.**
- **Card processing + AUTO-DEBIT invoices come later** — our card KYB was declined only for
  **no business activity yet**; it unlocks as we invoice + collect. Then collection automates.
- **Offline/cash is STILL commissioned** (unified basis) via the CMS "Mark as collected"
  flow — no POS hardware from us. Since there is no split, **one monthly invoice covers ALL
  income** (online + offline); the earlier online/offline collection split is moot.
- **Revenue turns on when we start invoicing** (buildable NOW — no external gate). Pilot
  tenants run free-to-experience until invoicing is wired; that is intentional, not a gap.
- **Existing billing infra is REPURPOSED, not deleted:** the `billing_charges` ledger
  + `lib/billing/` provider layer serve commission billing; the subscription-specific
  OFFER (pricing tiers, "pick a plan") is what goes away. Downstream shifts required:
  marketing pricing page, `crm_settings.billing_plans`, onboarding plan-selection,
  CMS billing section, and tier-based feature gating all move from subscription to
  commission framing.

**Confirmed 2026-07-27:**
- **Option A — truly FLAT: no tiers.** Every tenant gets every feature; we monetize
  purely on booking volume via the uniform 5%. The Essential/Growth/Pro tier system
  (P8) is **retired** — feature gating by tier goes away (features become universally
  on; a few may become optional paid add-ons later, but NOT tiered subscriptions).
- **Tenant Voice assistant RETIRED** (cost). Front Desk **chat** (Agent 2) covers
  tenants. **Stemfra keeps its OWN voice agent "Mark"** (Agent 3) for internal
  lead-gen / concierge / support. → **P11 item 49 (Phase 3 tenant voice) is dropped**;
  P12 Wave 3's "Voice Phase 3" line is removed. (Consistent with P8 item 31, now final.)
- **Subscription model PRESERVED IN DOCUMENTATION ONLY** — retired from the live offer,
  but keep the design/infra notes intact in case we revive a subscription/hybrid option
  later (the `billing_charges` + provider layer already supports it).
- Etsy lessons applied: separate platform-fee vs processing-fee lines; attribution
  (charge more / only on customers WE bring — Offsite-Ads model) as a later refinement.

**Domain = the customer's responsibility → Stemfra fronts $0** (this is what makes
"no setup fee" financially safe; a dormant tenant then costs ~$0 marginal):
- **Free `*.stemfra.com` subdomain** (default) · **BYO connect-only** (just point
  DNS — no transfer, no 60-day rule) · **buy-through-us COLLECT-FIRST** (charge the
  client, then Porkbun — never front) · or self-serve at **Cloudflare Registrar
  (at-cost)** / Porkbun. Managed domains already auto-provision a CF zone (Case 7).
- **Connect vs transfer clarity** (from CF docs): a tenant only needs to POINT DNS
  to launch; a full registrar transfer to Cloudflare is OPTIONAL (at-cost renewals;
  60-day rule + EPP code + ~5 days). Shopify/Wix/Squarespace domains block NS changes
  → intermediate registrar first. Document both; default to connect-only.
- **Onboarding gains "Do you already have a domain?"** → No = subdomain + buy-later;
  Yes = capture + connect (offer transfer docs).
- **NO automatic dormancy sweep** (decided 2026-07-27). New businesses can take
  up to ~8 months to rank on Google; if dormant sites cost ~$0 we KEEP them. Instead,
  a **CRM Activity / Performance monitor** (observe-only): per-site activity metrics
  (bookings, visits, last-active) with month / date-range / "inactive > 1 year"
  filters and **manual** staff actions (pause, nudge, etc.). No `siteDeletionSweeper`
  auto-purge for dormancy. (The 90-day lifecycle from item 26 remains for
  owner/staff-INITIATED deletion only.)

New tasks:
56. **Public Docs / Help Center** — ✅ DONE 2026-07-29, pushed 2026-08-03 (see
    the top-status block for the file map + verification + the FAQ/STRIPE_ONBOARDING
    follow-up). Shipped as a structured-block help center at `stemfra.com/docs` on a
    WHITE canvas: 6 categories / **26** articles (Getting started · Domains · Payments &
    Stripe · Bookings · Billing & commission · Account; was 25 until the external-booking
    article was removed), each article with per-section sources, prerendered + in the
    sitemap, linked from the Footer + FAQ. Truth rules held (no tiers/SMS/auto-debit/voice).
    ⚠ 2026-08-04 audit correction: "Search + feedback widget intentionally skipped" is
    FALSE — `DocsSearch.jsx` shipped (wired into DocsHeader), and a full docs AI
    assistant shipped too (`DocsAssistantLauncher/Panel.jsx` + `docsAssistantStore.js`,
    mounted in DocsLayout) that no doc had recorded. Feedback widget alone is unshipped.
    Still ties into P10 case-1 task videos when those land.
57. **Domain policy build** — free-subdomain default + BYO connect + the onboarding
    "have a domain?" question + buy-through-us COLLECT-FIRST. Tiers 1+2 (subdomain +
    BYO) need no external approval — build now; collect-first buy waits on a card/
    payment provider.
58. **Commission engine — ✅ Batch 1 + Batch 2a COMPLETE (audited 2026-07-29).** Core meter
    shipped 2026-07-27; **monthly scheduler DONE 2026-07-28** (`lib/commissionScheduler.js`,
    env-gated OFF via `COMMISSION_SCHEDULER_ENABLED` — arm at launch, incl. deploy.yml);
    **Batch 2a manual invoicing loop DONE 2026-07-28** (invoice PDF w/ Airwallex bank block ·
    CMS `/billing/invoices` w/ per-field copy + receipt upload incl. PDF · CRM compliance
    packet: invoice PDF + bookings CSV + receipt badge → mark paid); **marketing/legal
    commission shift DONE 2026-07-29** (pricing page, /fees policy, Terms/Refund, signup
    acceptance persistence). **Remaining: Batch 2b auto-debit only** (blocked on Airwallex
    card KYB). Details: COMMISSION_MODEL.md §7b.
59. ✅ **CRM Activity / Performance monitor — DONE 2026-07-29** (see the WHERE WE STAND
    block, item 1, for the build record). Observe-only per-site metrics + window/date-range/
    inactive filters + manual nudge; no automatic dormancy purge. "Visits" metric is out of
    scope until site analytics ship (parked) — activity = bookings/leads/chats/audit events.
60. ✅ **Adjust-booking at delivery — DONE + verified (2026-07-28).** "Adjust service or
    price" control in `BookingDetailModal` (service swap / custom name / price / duration,
    with a reason) → **server endpoint** `PATCH /api/cms/bookings/:id/adjust`
    (`controllers/cms/bookingsController.js`, requireCmsAuth + verifySiteOwnership) updates
    `service_name_snapshot` + `amount_cents` + `duration_minutes` (recomputes `ends_at`) and
    **audits to `site_activity`** (`booking_adjusted`, before/after + reason + actor). Client
    call in `lib/bookingNotify.ts adjustBooking`. Server-side (not client) BECAUSE owners
    can't write `site_activity` via RLS. Verified end-to-end: $36→$60 update + audit row with
    the correct after-amount, note, and actor. **Matters for commission** (the meter reads
    `amount_cents`). _Remaining sub-item:_ ADD-a-service (a second `site_bookings` row sharing
    `group_id`, salon multi-service pattern) — deferred; swap + price override cover the
    common "facial → nails on arrival" case.

**Payment norms by vertical (Peter's study, 2026-07-28 — validates unified commission):**
- **Beauty & wellness (barber / salon / massage / spa):** pay **in-person at the POS AFTER
  service**, card often only held for no-show; **tip chosen at the terminal**. → mostly
  OFFLINE → commission relies on the CMS **"mark as collected"** flow; the final service/price
  is set at checkout (hence task 60). **Tips are NOT commissioned** (not service revenue).
- **Fitness (yoga / CrossFit):** **online / recurring BEFORE service** (memberships auto-billed,
  drop-ins/packs prepaid). → mostly ONLINE + memberships → captured automatically by the meter.
- Net: the **unified** commission basis (online + at-visit-collected + memberships + orders) is
  correct — beauty leans offline-marked-collected, fitness leans online/recurring.

## P14 — Memberships & pay-at-venue (NEW, 2026-08-05 — plan agreed, executor arc)

**Plan doc (the source of truth for this arc): [`MEMBERSHIPS_PAY_AT_VENUE_PLAN.md`](MEMBERSHIPS_PAY_AT_VENUE_PLAN.md).**
Decisions in COMMISSION_MODEL §2b (2026-08-05, Peter): online payments SUSPENDED
(pipeline dormant, kept for future deposits), no Stripe-level fees ever, 5% via
invoice only; memberships = sign-up online / chat → agreement + payment at the
venue → owner confirms in the CMS (the confirmation advances the period AND is
the commissionable event). Research basis: membership checkout was stranded on
un-migrated Connect (non-functional in prod), 1 of 6 templates had a purchase
surface, zero membership↔booking linkage, meter used an MRR estimate.
Phases: A signup+activation (server/CMS/crossfit) · B monthly Renewals
confirm-all + meter on collected cash · C Front Desk chat signup (n8n paste via
Peter) · D booking online-payment kill-switch + CMS quiet state + zero fees ·
E member lifecycle (portal v2 with renew-by/visits/payments, renewal reminder
sweeper T-7/T-0 + 14d grace, owner digest, yoga surface + member area).
Out of scope: credits/entitlement ledger, Stripe repairs, deposits, massage/spa
real-plan tiers, the Display-only UX rework (separate task). Executor: Opus 4.8
per ADVISOR_STRATEGY; commits only, NO push without Peter.
