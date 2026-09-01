# Stemfra — Roadmap & Pending Tasks (prioritized)

_Updated 2026-07-29 (full-project audit pass). Single cross-repo source of truth.
The order below IS the recommended build sequence. Per-feature detail lives in the
linked docs; this is "what's next and why."_

## 📌 WHERE WE STAND (2026-07-29 audit — read this before the per-arc detail)
_Verified against code + DB + env, not just doc claims._

### 🚀 ACTIVE ARC (2026-08-18): LAUNCH — phased, barbershop first → **[`LAUNCH_PLAN.md`](LAUNCH_PLAN.md)**
Peter's 10 launch tasks (VSL video · 3-contact prospecting sequence · Stacy+routes refresh ·
CMS tour re-walk · legal pages · lead-gen city/state coverage in the CRM · Mark voice refresh ·
end-to-end barbershop via UI · demo/test-data isolation · release checklist) + the release
checklist + the marketing-funnel discussion live THERE. Read it after this block.
- **PENDING (Peter, dashboard) — do AFTER the launch tasks:** Supabase auth-email SMTP (Part A)
  + paste the 4 branded templates (Part B) per `SUPABASE_AUTH_EMAILS.md`. The HTML exports in
  `docs/supabase-auth-templates/` were regenerated 2026-08-18 (they were stale from Jul 13, pre-
  redesign) and are em-dash-free; nothing to regenerate, just paste when ready.
- **PREREQ for the self-serve funnel:** the `*.stemfra.com` wildcard Worker (item "Domain routing
  at scale" below, agreed 2026-08-07, still PENDING) — Pages caps 100 custom domains/project and
  every provisioned site burns a slot.
- Suspended until approval (NOT launch): Airwallex `invoice.paid` webhook + tax-aware ledger.

_Previous active arc = **P13 commission model** (`docs/COMMISSION_MODEL.md`), shipped; theme-polish arc below closed 2026-08-17._

### 📥 PENDING — Inbox parity upgrades (queued 2026-08-29, Peter)
The Helen lead-gen CRM's inbox (repo `stemfra/client-helen-leadgen`, see its
`SESSION_HANDOFF.md`) is now the REFERENCE inbox across all builds. Upgrade the
CMS enquiries inbox and the CRM Gmail inbox to that standard when their arcs
next open. The parity checklist (all live-verified in the Helen build):
Gmail-style thread anatomy (subject once, collapsed rows, latest expanded,
quoted tails behind a ··· toggle) · sanitized-HTML message rendering (server
allowlist, one trust level) · AI suggested-reply pill under the last inbound
message (click opens the composer prefilled) · Tiptap rich-text composer with
attachments (25MB), signature auto-append, and refine chips (Simplify/Shorten/
Lengthen/Warmer/Professional, server-whitelisted, Cmd+Z undo) · archive/
restore/delete with an Archived tab · outbound message-id storage +
In-Reply-To threading + thread-priority reply matching. The same task for the
stemfra_ai Front Desk inbox is relayed via its own handoff (parallel-session
boundary; do not edit that repo from here).
SECURITY POSTURE for the sanitized-HTML item (the XSS-sensitive one; the
stemfra_ai session correctly flagged it for an advisor pass): copy the
reference implementation `client-helen-leadgen/.../server/lib/emailHtml.js`.
Sanitize at INGEST with a server-side allowlist and store ONLY sanitized HTML
(never sanitize client-side at render time); pass your own outbound HTML
through the same filter (one trust level); strip scripts/event handlers/
iframes/javascript: URLs; force links to rel=noopener target=_blank; limit
inline styles to text formatting; cap stored size. For MULTI-TENANT
dashboards add: block or click-to-load remote images (tracking pixels leak
the reader's IP and open-time; the Helen build allows https images as a
single-operator trade-off).

### 🎨 Theme polish — About Us + Contact page review (ACTIVE arc, started 2026-08-13)
A cross-vertical walkthrough with Peter: review the **About Us** and **Contact** pages of
every active theme, **vertical by vertical, default theme (★) first**, then the next theme
after Peter's review, until the vertical is done, then the next vertical. Open each theme
in the browser theme-by-theme (repoint a demo site to the theme via the CMS picker — zero
data migration — or use the theme's own demo site). **Document + commit each change; do NOT
push to GitHub until Peter confirms.**

Review order + checklist (default ★ first; tick a theme once its About + Contact are approved):
- ✅ **barbers** — DONE (Peter, 2026-08-17: fine as-is now that chrome is CMS-editable; titles/text tuned from the CMS)
- ✅ **salons** — DONE (2026-08-17, same call)
- ✅ **crossfit** — DONE (2026-08-17, same call)
- ✅ **yoga** — DONE (2026-08-17, same call)
- [ ] **massage** — ★ Escape · Umbra (massage-zenhaven) · Reverie  ← **ACTIVE FOCUS** (Peter gave these pages least attention)
- [ ] **spa** — ★ Ellaris · Lumora · Respira  ← **ACTIVE FOCUS**
- boutique_gyms (Facility ★ / Signal) exist in the catalog but the app (`stemfra_gyms`) is deferred — skip unless asked.

_2026-08-17 (Peter): About/Contact for barbers · salons · crossfit · yoga marked DONE — now that every part
of those pages is CMS-editable, Peter will adjust titles/text from the dashboard. The review now focuses ONLY
on **massage + spa**, whose About/Contact pages got the least attention._

**Logistics:** some themes have no live demo site (e.g. `respira-spa`/`lumora-spa` are not in
the DB — only `ellaris-spa` is live). Repoint an existing demo site to the theme, or recreate
the demo, before reviewing that theme.

**🔍 Sub-arc — Hardcoded-content audit (precursor to the About/Contact review; Peter, 2026-08-14):**
Before reviewing About + Contact for each theme, **audit that theme's app + variants for text/images/
content that a tenant CANNOT edit in the CMS** (hardcoded strings, fallback-default literals, hardcoded
image URLs, hardcoded nav/footer/chip arrays). Document per vertical, then decide what to make editable —
exactly the barbers pass below. **Process per vertical:** scan → present the list → Peter picks which to
make editable → build (current text = defaults so nothing changes until edited) → then the About/Contact review.
- ✅ **barbers DONE** — audit produced (Layout/pages/lib + barbers-used archetype variants). Peter's call:
  make editable everything EXCEPT nav labels + footer legal links; skip generic UI chrome (forms/booking).
  Shipped in 2 phases → `metadata.labels` (header CTA, footer heading/copyright/texture image, team-years
  label, featured badge, chat chips) via a new CMS **"Buttons & labels"** panel (Settings → Style) +
  section content (home location button, contact Visit/Phone labels, review-panel captions). All default
  to current text. **Standing decision:** nav labels + footer legal links stay hardcoded; UI chrome (section D) untouched.
- ✅ **All 5 remaining verticals SCANNED (2026-08-14)** — salons · crossfit · yoga · massage · spa.
  Consolidated findings + per-vertical make-editable recommendations documented in
  **[`docs/HARDCODED_AUDIT.md`](HARDCODED_AUDIT.md)**. Includes a **cross-cutting bug list**
  (wrong-vertical clone leftovers: 'Lila Studio'/'Calm Roots Massage'/'Massage Studio' brand leaks,
  "Switching to another gym" on yoga, "Est. 2019/Serving Austin" on massage, yoga BookPage leftovers
  on massage+spa, "Sukhasana"/"Serenity Spa" footer labels) — fix those regardless of the editability decision.
- ✅ **make-editable pass DONE for ALL 5 remaining verticals (2026-08-17, local only, not pushed)** —
  salons · crossfit · yoga · massage · spa. The barbershop-only "Buttons & labels" panel was refactored into
  ONE **vertical-aware, config-driven** component (`stemfra_cms/.../ButtonsLabelsSection.tsx`: `VERTICAL_FIELDS`
  keyed by template-slug prefix; per-field `kind:'image'` + `when(av)` gating). Each vertical's chrome labels
  (header CTA · footer description/column-headings/copyright/accent photo+caption · chat chips · home team/
  location/hero-gift CTAs, per the audit) now write to `site_theme_settings.metadata.labels`, and each template
  Layout/HomePage reads them with current text as the default (blank = unchanged). Standing decision honoured:
  nav labels + footer legal links + forms stay hardcoded. Verified per vertical (typecheck + template render +
  CMS panel field set); the write loop is the proven barbers `useUpsertThemeSettings` path. See SESSION_HANDOFF
  2026-08-17. **NEXT in this arc: the per-vertical About/Contact page review (default theme first).**

**Done in this arc so far:**
- ✅ **Grey→colour-on-hover removed repo-wide** (`group-hover:grayscale-0` / `hover:grayscale-0`)
  from all 6 archetypes that had it: TeamGrid `BwPortraits`/`Editorial`/`Carousel`/`BlackFly`,
  `GalleryMasonry`, `MembershipRuledGrid`. Photos stay B&W; other hovers (e.g. `group-hover:scale-105`) kept.
- ✅ **Spa home Team → marquee** (Ellaris `bw-portraits` + Respira `soft-tiles` via the new shared
  `TeamGrid/TeamMarquee`: scroll-snap cards + arrows BELOW + "View All"; the `/teachers` page stays a
  grid). Lumora already used `soft-carousel`. **Note (Peter): do NOT move arrows below on themes that
  already have carousels — only the newly-converted spa grids get arrows-below.**
- ✅ **Ellaris services** "Read More" moved off the photo into the text row (outlined, on the price line).
- ✅ **Gift-cert tiers clickable → pre-filled enquiry** (`/contact?gift=<tier>` → ContactForm `initialMessage`) on spa/massage/salons.
- ✅ **Phone picker: full ISO country list + dynamic default from business country.** The
  full list was already there (Intl.DisplayNames names every country). Added the dynamic
  default: new `countryFromTimeZone(tz)` (IANA zone → ISO country; `sites.time_zone` is the
  reliable signal, not the free-text address) so a US shop shows +1, Nigeria +234, Russia +7.
  Threaded `defaultCountry` PhoneField → ContactForm → all 6 template ContactPages. Verified
  barbers (argyle/America_New_York → US +1). All CMS phone pickers already share PhoneField,
  so the full list applies everywhere; the dynamic default is contact-form only for now.
- ✅ **On-map Google-style info card (Maps Option B)** — see task 13 below. Card on the Mapbox
  tiles (name/address + Directions + Open in Maps), rating row coded but data-gated (no Places
  call yet); future live-Google-rating is documented under task 13.
  ✅ **Map-tile regression FIXED** — the card wrapper set the mapbox container to `absolute
  inset-0`, but mapbox-gl.css forces `.mapboxgl-map{position:relative}` → `inset-0` gave 0 height →
  tiles clipped to nothing. Now an in-flow `h-full w-full` block (LocationMap.tsx). Verified DOM.
- ✅ **CMS IA (Peter): Style / SEO / Front desk moved from the Account group to the Website group**
  in the sidebar (they're website-presentation concerns). Account keeps Publish/Domain/Social.
  Route paths unchanged, so Stacy + the tour (URL/`data-tour`-driven) are unaffected. `Sidebar.tsx`.
- ✅ **Global search: "address" (+ location/map/directions/phone) is now searchable** → "Business
  address & location" (Home Location section) + "Billing details". Added a `keywords` field to the
  search index (`GlobalSearch.tsx`).
- ✅ **Phone default now = business country from the ADDRESS (billing first, then location), not
  timezone.** Location section gained a structured `country` (ISO-2) with a CMS Country dropdown
  that syncs from the billing address; `useBusinessLocation` (6 templates) exposes it; ContactPages
  use `loc.country || countryFromTimeZone(...)`. PhoneField now follows a late-async defaultCountry.
  Verified: argyle contact → 🇬🇧 +44 with location country=GB (overriding US timezone), then 🇺🇸 +1.


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
   + CMS search/buy UI were already DONE.
   ✅ **DOMAIN BUY-THROUGH-US IS LIVE END-TO-END (superseded the 2026-08-04 audit
   note; re-verified against code 2026-08-18).** First real purchase
   `argyleandsons.click` on 2026-08-10 (Porkbun order 11293757). Both audit gaps
   were FIXED in `controllers/cms/domainController.js registerOwn`: (a) the retired
   `subscriptions.status='active'` gate is gone — the subscription row is now
   OPTIONAL (commission-era tenants have none; the invoice rides `billing_charges`
   with `subscription_id` nullable); (b) "front-then-bill vs collect-first" is now
   the deliberate **prepaid-float model** in `docs/DOMAINS.md`: INSTANT purchase while
   the Porkbun balance is ≥ $30 (buy → wire DNS/SSL/email → invoice after), auto-
   flipping to INVOICE-FIRST below the threshold (invoice → staff register after
   payment). Shared orchestrator `lib/domainPurchase.js purchaseAndWire()` used by
   both the owner and staff paths. Safe to demo. **Genuinely remaining:** nothing
   blocking; year-2 renewal billing sweeper + transfers/DNS-record visibility deferred.
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
8. **Memberships: Mindbody-parity items** (2026-08-10 comparison vs their
   Membership Settings screen; Peter asked what we miss). We already have what
   they lack for our model: pay-at-venue renewals collection, per-member
   pause/suspend/cancel, MRR reporting. Worth adding LATER, in order:
   (a) **member perks / discount %** on a plan (e.g. "members save 10% on
   services") — store on the site_products row, show on the site tiers and at
   owner collection time; cheap once membership tiers render beyond crossfit.
   (b) **members-only booking** — per-service "members only" flag gating the
   public booking flow behind member sign-in; pairs with the existing
   magic-link member accounts, needs member context in BookingForm.
   (c) plan sort order in the CMS if plan lists grow. SKIPPED deliberately:
   membership icons, self-sign-in restrictions and non-member purchase toggles
   (tied to Mindbody's commerce model, N/A under pay-at-venue).
9. **Airwallex HYBRID invoicing — SHIPPED 2026-08-12** (branded email carries the
   canonical Airwallex invoice: link + PDF; see `docs/AIRWALLEX_INVOICING.md`).
   **Remaining near-term tasks** (all in that doc §9): (a) **tax-aware ledger +
   recon-on-total** — add `tax_cents` etc.; recon matches `amount_cents +
   tax_cents`; defaults to 0 (no behavior change now), build before we register
   for sales tax anywhere; (b) **`invoice.paid` webhook** — REQUIRED when
   Airwallex Payments/card goes live (a hosted-link card payment must flip our
   `billing_charges`; today we only handle `deposit.*`); (c) confirm Airwallex
   tax filing-partner vs manual filing; (d) optional `pay.stemfra.com` custom
   domain ($10/mo Beta). Also queued: (optional) final live e2e via `markRequested`
   on a demo site; the Airwallex-email observation experiment.
8. ✅ **Front Desk widget rollout to all 6 verticals — DONE 2026-07-31.** This entry
   was written 2026-07-29, two days before the rollout landed, and stayed stale.
   **Re-verified independently 2026-08-03**, not taken from the doc's own claim:
   `logoUrl` + `suggestions` passed in all 6 Layouts; `memberToken` in
   crossfit/massage/spa (the only three with a member portal); the "Chat assistant"
   privacy clause present on **18/18** live+previewing sites (SQL over
   site_pages/site_sections); `metadata.classes` + `expires_days` on **3/3** active
   class packs (only lila-studio sells them, so nothing else was in scope).
   **BUILD IS COMPLETE — nothing left to code (re-confirmed 2026-08-18).** What
   `stemfra_platform/docs/FRONTDESK.md` §9 still lists are LIVE-VERIFICATION items that
   cannot be driven from a dev machine (a real agent turn needs the prod n8n host,
   which is unproxied and unreachable from a laptop; the workflow itself is live and
   its Build Prompt node was diffed against the repo file 2026-08-03 — matches).
   → **Fold into the LAUNCH TEST (Peter, 2026-08-18)**, not the roadmap: (a) member
   reschedule/cancel through a real signed-in chat (crossfit/massage/spa); (b) a
   multi-line slot card (needs a site that sets locations); (c) one human Shift+Enter
   keypress + a paste. (Lira Yoga's 6 stale service rows were deactivated 2026-08-03,
   FRONTDESK.md §9 #11.)

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
    ✅ **RESOLVED (verified 2026-08-18): NO per-Pages action needed.** The token is
    served by the SERVER — `GET /api/public-config` (`routes/publicConfig.js`, mounted
    in index.js) returns `MAPBOX_PUBLIC_TOKEN` from `deploy.yml`, and `LocationMap`
    fetches it at runtime (the build-time `VITE_MAPBOX_TOKEN` is only an override).
    Prod confirmed returning a `pk.` token. One source of record; rotating it reaches
    every site on the next fetch, no Pages rebuilds. (An earlier version of this line
    said "add to 6 CF Pages projects" and outlived the 2026-08-04 fix.) Optional
    hardening still stands: restrict the token to *.stemfra.com + localhost in Mapbox.)
    ✅ **On-map info card SHIPPED 2026-08-13** (Option B, Peter's call): a
    Google-Maps-style overlay card on the tiles — business name + address +
    **Directions** (accent-filled, Google Maps dir link) + **Open in Maps**
    (outline, Google Maps search link), bottom-left, cleaner than Google's own.
    Built into `LocationMap` (`MapInfoCard`), so BOTH map variants get it free;
    `name` threaded from LocationCardDefault + LocationCardDarkPanel. Verified via
    DOM on argyle (name + both hrefs correct). **Rating row is coded but
    data-gated** — `LocationMap` accepts `rating`/`reviewCount` and renders the
    star row ONLY when passed; nothing passes them yet, so there is NO paid Places
    call and no owner false-claim.
    🟡 **FUTURE (Peter agreed 2026-08-13): live Google rating on the card.** Wire
    Google Places API (Place Details → rating + user_ratings_total) so the star
    row lights up with the REAL Google rating. Needs: a server endpoint (key stays
    server-side, we already hold a Places key from AddressAutocomplete), a per-site
    Google Place ID resolved once from the address (the "Google Business Profile
    linkage"), 24h caching to bound API cost, and reading Google's Places docs
    first (standing "third-party docs first" rule). Deferred now purely to avoid
    the per-pageview API cost; the card layout already reserves the slot, so
    lighting it up is just passing the two props.) Original:** Pattern + credentials come from unekride:
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

## P15 — Video/demos arc + CMS UI polish (NEW, 2026-08-07)

**Video/demos plan doc (source of truth): [`P15_VIDEO_DEMOS_PLAN.md`](P15_VIDEO_DEMOS_PLAN.md).**
Phase 0a (Stacy onboarding fixes + update_contact do-it-for-me) DONE + live-verified
2026-08-07; the CMS UI-polish pass shipped alongside it (form kit `components/form/`,
violet PrimaryButton standardization, refined Select dropdown + category creation,
CMS boot spinner, card active states, FAQ+legal onboarding steps).

**Pending (queued after the UI pass, agreed with Peter 2026-08-07):**
1. **Phone validation + Google address autocomplete slice** —
   ✅ **Address autocomplete DONE 2026-08-11** (verified live): Google Places
   `PlaceAutocompleteElement` on the Location editor's Street-address field
   (`stemfra_cms` `lib/googleMaps.ts` + `components/AddressAutocomplete.tsx`);
   project **stemfra-maps** + referrer-restricted key set up; `VITE_GOOGLE_MAPS_KEY`
   in CMS `.env.local`. ⚠ PROD: set that env var in the CMS Cloudflare Pages
   build env (see SESSION_HANDOFF). **STILL PENDING:** libphonenumber phone
   validation with the tenant's country (known from onboarding), resolved-number
   echo (PhoneField's showResolved pattern), parallel `phone_e164` in location_map
   content for tel: hrefs; and later a "Business location/country" setting under
   Billing that drives formatting app-wide (the Google-account model) — which
   should also feed the autocomplete's country bias (currently hardcoded 'us').
1b. **Billing Reconciliation Engine (AGREED 2026-08-11, spec written, NOT built)**
   — auto-match Airwallex deposits against unpaid `billing_charges` so invoices
   confirm themselves (webhook-primary `deposit.settled` + CRM-adjustable sweep
   backstop; T1 reference / T2 unique-amount auto-pay; ambiguous → CRM review
   queue; `deposit.reversed` un-pays; receipt upload hidden by default, CRM
   re-enables per invoice for disputes). Full spec + pinned Airwallex API facts:
   **[`RECONCILIATION.md`](RECONCILIATION.md)**. Build order R1 dry-run engine →
   R2 webhook (PETER: dashboard registration + secret) → R3 CRM → R4 CMS.
2. **Dashboard analytics upgrade** — Airwallex-inspired: a richer balance/revenue
   chart block on the CMS dashboard (inspiration screenshot 2026-08-07).
3. **Supademo 30-second pilot workflow** — then Phases A/B per the plan doc;
   Growth-trial window is ticking (14 days from ~2026-08-06).
5. **Live Porkbun purchase + connect test (Peter + Claude, 2026-08-07):** buy a
   real domain through the CMS Porkbun flow and walk the new 3-step connect
   card end to end against Cloudflare (first real registration; Porkbun
   account email/phone verification + funded balance are prerequisites).
6. **Domain scale infra — (a) wildcard Worker ✅ BUILT 2026-08-18, awaiting deploy;
   (b) Custom Hostnames still pending.** The `*.stemfra.com` tenant-router Worker
   lives at `stemfra_platform/workers/tenant-router/` (README = runbook + rollout +
   rollback). Verified locally against real Supabase + Pages origins (barbers →
   stemfra-barbers, spa → stemfra-spa, unknown → branded noindex 404, infra hosts
   pass through). Also shipped: `functions/robots.txt.ts` + `sitemap.xml.ts` honor
   `X-Forwarded-Host`; `attachSiteDomain` gained `TENANT_WILDCARD_ROUTING=true`
   (skips per-subdomain Pages attach); `stemfra_server/scripts/setup-tenant-wildcard.js`
   (dry-run-default: wildcard A record + no-worker bypass routes for the 6 non-tenant
   hosts api/cms/crm/www/bazeride/blazeride — dry-run verified). **Peter actions to go
   live (in order):** deploy platform → run the setup script `--apply` → `wrangler
   deploy` with a Workers-scoped token → verify → flip `TENANT_WILDCARD_ROUTING=true`
   in deploy.yml. Full architecture + triggers in item 4 below.
4. **Domain routing at scale (AGREED direction 2026-08-07; build BEFORE the
   self-serve funnel launches):** our BYO connect flow already implements the
   "Cloudflare for SaaS" pattern via Pages custom domains (owner keeps
   registrar + renewals, one CNAME, auto SSL; transfers permanently out of
   scope: CF Registrar inbound transfers are dashboard-only). BUT the limit is
   sharper than first noted: **Pages caps custom domains per project at
   100 (Free) / 250 (Pro) / 500 (Business+), and attachSiteDomain attaches
   EVERY site's {subdomain}.stemfra.com as a Pages custom domain — so the cap
   counts ALL sites per vertical, not just BYO tenants.** Verified against CF
   Pages limits docs 2026-08-07. The 1M-user architecture (Render provably
   runs the same stack: their wildcard flow sets _cf-custom-hostname records,
   i.e. resold Cloudflare for SaaS):
   (a) subdomains: ONE wildcard *.stemfra.com DNS record -> a Cloudflare
   WORKER that resolves host -> vertical -> serves that vertical's bundle;
   new site = DB row only, no per-site attach, unlimited subdomains;
   (b) custom domains: Cloudflare for SaaS Custom Hostnames on the
   stemfra.com zone (fallback origin = the Worker), API-automated, auto-SSL,
   ~$0.10/hostname/mo after 100 (paying tenants only, scales linearly);
   (c) incremental migration: keep Pages builds, front with the Worker, swap
   the attach calls Pages API -> Custom Hostnames API in attachSiteDomain +
   cms/domainController.
   Near-term (separate small slice): DomainSection redesign on Render's
   3-step model (Add domain -> Configure DNS w/ per-provider instructions ->
   Verify button; render.com/docs/custom-domains is the reference).

## P16 — Interactive onboarding + What's New + Support system — ✅ CLOSED 2026-09-01 (items 2+3 shipped; item 1 DROPPED by Peter)

Context: the native CMS walkthrough (P15) shipped 2026-08-08 (10 spotlight steps,
Jessica voice @ 0.95, docs in P15_VIDEO_DEMOS_PLAN.md). Peter's goal: the setup
call must become optional/minimal; Stacy + interactive tours carry onboarding.

1. ❌ **Interactive "do-it" tour steps** — DROPPED (Peter, 2026-09-01): the
   existing "Take a quick tour" (Dashboard) + per-page "Take a tour" already
   serve the goal. Video strategy instead: several VSL videos uploaded to
   YouTube + dedicated YouTube-ad promo videos, created later (see the VSL
   item in LAUNCH_PLAN / P15).
2. **What's New channel** (absorbs the parked P10 case-1 "What's new" item):
   feature announcements via the existing broadcast_announcement rail + a
   What's New surface in the CMS; each entry can carry a "Show me" hook that
   launches a mini-tour of the new feature.
3. ✅ **Support system CORE SHIPPED 2026-08-09** (server 2881147 + platform e9a7cc8):
   support_requests table (service-role RLS) + /api/cms/support (create/list +
   call-config) + CMS /support page (category dropdown, ticket list, schedule-a-
   call). The dogfood proposal was validated LIVE: internal site 'stemfra-support'
   (5 call services = the categories, support team member, Mon-Fri 9-17 ET) takes
   REAL site_bookings through the public engine — a test call booked from the CMS
   confirmed end to end, then cancelled. CRM ticket view + staff book-on-behalf SHIPPED
   2026-08-09 (server ab06700 + ops 35489ae: CRM /support page — cross-site
   ticket table w/ status triage, Book-call modal prefilled from the ticket,
   real booking verified + cancelled). Concierge booking hook SHIPPED 2026-08-09
   (server 145cdde + client 5c938dbb: 'Consultation call' sales service on the
   support site, public /api/concierge/call-config, widget inline scheduler via
   a local starter + agent cta 'book_call'; ⚠ PETER PASTE: the updated
   n8n-workflows/concierge-build-prompt.js into the Concierge Build Prompt node
   so the AGENT can offer booking — the widget starter works without it).
   REMAINING:
   ticket ack email to the owner; support-calendar staffing (who answers).
   ─ Original design: CMS Support surface
   with category dropdown (General / Domain / Email / Payments / Accounts) →
   ticket + email + CRM visibility; optional "schedule a call" per category.
   Proposal to validate: DOGFOOD our own booking engine — a Stemfra-internal
   site whose services are the call types and whose team is support staff, so
   owner-side CMS, marketing Concierge, AND CRM staff all book through the
   same site_bookings rails (CRM books on behalf of a client who stalled).
4. ✅ **Marketing booking page CONSOLIDATED onto the support engine 2026-08-09**
   (client 2a59c471): /book-a-call keeps its hero + two-step calendar design but
   books the sales Consultation call through the public /api/site-bookings flow
   (coordinates via /api/concierge/call-config) — one support calendar, Meet +
   host free/busy, visitor-timezone slots + picker, duration from config (30
   min). Business name/vertical/notes ride in customer_notes → Meet event
   description. ⚠ RETIRE /api/setup-call server-side once this deploys clean
   (client no longer calls it).
5. ✅ **Concierge widget rebuilt on the Front Desk architecture 2026-08-09**
   (client a68cef5e, all three phases in one arc per Peter): docked booking
   drawer (month grid greyed by real availability — closes the Calendly
   month-hints gap for Stemfra calls — visitor-tz slots + zone picker, details
   step, in-thread receipt), options drawer for 5+ quick replies, Chat options
   menu (Start over) + minimize chevron, seeded AI-identity disclosure,
   Claude-style rewind, auto-grow composer (touch-aware Enter, IME guard),
   emoji picker (code-split), linkified paths, privacy footer link. Shared tz
   helpers in stemfra_client src/app/lib/timezone.js.
6. **Tour types settled 2026-08-09 (platform 21200c7)**: main walkthrough is
   fully PASSIVE (Next auto-navigates; no do-it steps); do-it mechanics live
   only in Stacy checklist mini-tours (guided editing = mini-tour + Stacy
   drafting). Mini-tour instruction label restyled (hand-pointer icon, default
   cursor) so it cannot be read as a button.

## P17 — Platform subscriptions & expense receipts (CRM + n8n) (queued 2026-08-11; **v1 BUILT IN THE CRM 2026-08-31**)

**STATUS 2026-08-31: v1 shipped (in-CRM, no n8n — supersedes item 2's
planned n8n harvester, per the P22 note).** `lib/expenseScan.js` (read-only
IMAP over admin@stemfra.com [existing app password] + peter.space.io@gmail.com
[app password reused from the leadgen build; env EXPENSE_MB2_*]; 120-day
window, subject heuristics -> full parse of candidates only; amount/vendor
best-effort; PDF/image attachments archived to Cloudinary
`stemfra_assets/expense-receipts` — chosen over Google Drive so the CRM UI
owns the copies; a periodic Drive export for the accountant can come later)
-> `expense_receipts` table (message-id dedupe, staff RLS) -> CRM page
**Finance -> Expense Receipts** (`/expense-receipts`): include/EXCLUDE
toggle (personal spend never counts — Peter's Figma/Atlassian case),
editable renewal dates driving a "renewing within 7 days" alert banner,
month total, receipt links, on-demand Scan. Live-verified: 85 receipts
harvested (43 admin@ + 42 peter.space.io), Figma excluded, Anthropic PDF
archived. NEXT: periodic auto-scan (interval sweeper), email reminders for
due-soon renewals, push into `expenses` for the Compliance books, vendor
grouping/registry view (item 1 below).
**v1.1 same day (Peter's review):** N mailboxes via EXPENSE_MB2..MB9 env
pairs (⚠ PETER ACTION: create an app password for peter.okeme@gmail.com
— it holds the Northwest Registered Agent incorporation invoice — and
hand it over for EXPENSE_MB3_*); failure/decline notices SKIPPED at scan
entirely (never shown: not submittable for tax anyway); same-vendor +
same-amount + same-day twins auto-excluded at scan ("duplicate?" chip);
receipts stored as ORIGINAL PDFs, full quality, all pages (the earlier
page-1 JPG conversion is dropped; ⚠ PETER ACTION: Cloudinary console →
Settings → Security → check "Allow delivery of PDF and ZIP files", else
Open links 401; the restriction also lifts on any paid Cloudinary plan);
header All checkbox (bulk include/exclude) + search +
date range + sortable columns + pagination (tablekit) + Export menu
(xlsx/CSV, included-only, duplicate twins by vendor+amount+day dropped
and chip-flagged in the table).
**v2 idea, AI classification layer (Peter, 2026-08-31):** run each
candidate email through one cheap LLM pass at scan time to (a) verdict
receipt vs failure vs marketing noise (replaces the regex), (b) category
(software / infrastructure / telecom / fees / professional services),
(c) business-vs-personal guess with confidence (auto-untick personal
vendors like Figma), (d) vendor normalization ("Google Payments" and
"The Google Workspace Team" are one vendor), (e) renewal cadence
(monthly/yearly) for a real renews_on instead of the +1 month guess.
Back-office AI = OpenAI per the 2026-06-26 decision; category column +
export follow.
**v1.2 additions (2026-08-31): manual entry + receipt upload.** "Add
expense" (account='manual') + per-row receipt attach/replace (PDF/image,
Cloudinary originals) + delete for manual rows only. Covers dashboard-only
invoices (Northwest Registered Agent bills the card as "Corporate Filings
LLC"; the invoice never arrives by email). DECISION: the peter.okeme@
gmail.com app password (EXPENSE_MB3) is SKIPPED for now, manual entry
covers its only subscription; revisit if more billing lands there.
**Airwallex card feed (recorded, not built): the P17 v2 direction.** Most
subscriptions now charge the AWX debit card, so the authoritative expense
LEDGER should be the Airwallex issuing/transactions API (catches every
charge, even without an email receipt), with the email scan ATTACHING
receipts to matching transactions (vendor+amount+day, the dup-detection
matcher) and manual entry covering other cards + dashboard invoices. A
mini recon engine for spend, mirroring lib/reconEngine.js for deposits.
Combination beats either source alone: card feed = completeness, email =
documentation, manual = the tail.
**Related idea recorded (Peter): Gmail-style MULTI-ACCOUNT sign-in**
(switch between logged-in accounts / add another, the Google account
menu pattern) for the Stemfra AI dashboard and the Lead-Gen CRM — an
account-model feature for their auth layer; flag to the stemfra_ai
session for their side.

Not previously in the roadmap (confirmed 2026-08-11 — this is a genuinely new
item, not a rediscovery of an existing one). Goal: give Stemfra staff a single
place to see every recurring third-party bill the platform itself pays, with
the receipts automatically collected as accounting evidence.

1. **CRM subscriptions registry (stemfra-ops)** — a new page listing every
   third-party integration/subscription Stemfra pays for to run the platform
   (Twilio, Cloudinary, ElevenLabs, Airwallex, Hostinger, Supabase, OpenAI,
   Porkbun, Resend, Google Workspace, etc.): vendor, plan/tier, monthly cost,
   billing cadence, renewal date, and the receipt(s) matched to it. A manual
   "Add subscription" button covers anything not yet auto-discovered. This is
   platform OPEX bookkeeping — distinct from `subscriptions`/`site_subscriptions`
   (client-facing billing, System A/B) and from `expenses` (already used by the
   Compliance Engine's books view) — likely backed by its own table rather than
   overloading either.
2. **n8n AI receipt-harvester workflow** — fetches receipts from the three
   Gmail accounts `peter.space.io@gmail.com`, `support@stemfra.com`,
   `peter@stemfra.com`, auto-matches each receipt to a subscription row (vendor
   name + amount + cadence heuristics), and lands unmatched or ambiguous
   receipts in a **review queue** modeled on the Lead-Gen `needs_review` flow
   (see [[leadgen_module_architecture]]) rather than auto-filing them blind.
   Each receipt gets a **"not a Stemfra expense — exclude"** toggle so a
   personal purchase in the same inbox never gets counted as platform OPEX.
   Dedupe by Gmail message-id so re-runs never double-count a receipt.
3. **Google Drive archive** — matched (and confirmed) receipts are copied into
   a Drive folder on the `support@stemfra.com` account, for accounting
   evidence of business expenses (feeds the same P&L instinct as the
   Compliance Engine's books view, but for what Stemfra spends, not what it
   earns).

Per the standing rule, n8n changes are drafted as workflow/node code and
handed to Peter to paste into n8n directly (state checked via Peter or the
n8n Executions tab) — never curl the webhook to test it live. This item is
documentation only; nothing has been built yet.

## P18 — Stacy image upload → placement (POST-LAUNCH, agreed 2026-08-20)

Peter's ask: a paperclip in Stacy's composer so tenants upload images IN the chat,
and Stacy places them in the right slot from the conversation ("use this as my
hero image"). Design agreed in review (2026-08-20); build AFTER the launch.

1. **S3a — paperclip upload**: composer attach → existing `site-uploads` endpoint →
   the site's Media library (same Cloudinary folder); the upload renders as a
   thumbnail message in the thread.
2. **S3b — `set_image` action (focused field)**: new Stacy action
   `{type:'set_image', target, assetId}`; easiest first target = the focused image
   field (the `stacyTarget` mechanism that powers "Use in Headline"). Confirm card
   (preview + target + Apply), like the update_contact card — never silent.
3. **S3c — conversational targeting**: "put this on the About page" → target from
   the CMS map (hero | service:<id> | team:<id> | gallery | logo | about); same
   confirm card. Enforce per-slot specs (hero ≥1600px wide, logo PNG/SVG) and log
   `site_activity`.
4. **S3d — bulk**: "here are 6 gallery photos" → multi-upload → gallery reorder card.

## P19 — Multi-site (second business) gaps (agreed 2026-08-20, Peter: all important) — ✅ ALL FOUR DONE 2026-09-01

Found while walking "+ New site" during the final E2E test. Each site already has its
own `companies` row, so two businesses under one owner ARE modeled; these close the rest:

1. ✅ **Per-business billing details.** (2026-09-01: `companies.billing_profile` jsonb + backfill migration `p19_company_billing_profile` [18/20 companies]; `lib/billingProfile.js` `resolveBillingIdentity` [company-over-contact per-field merge] + `saveCompanyBillingProfile` [contact prefill]; consumers switched: cms billingController [GET returns `billingIdentity`, PATCH /contact with `siteId` writes the company profile, invoice PDF bill-to], admin invoice, billingEmails attachment, siteCompleteness billing gate; CMS BillingPage details tab edits per business + LocationSectionEditor "use my billing address" reads the identity. Airwallex payer/awx_customer_id deliberately stays contact-level.) Today `contacts.billing_profile` = ONE billing
   name/address per LOGIN, shared by every site; a barbershop + a CrossFit club need
   distinct invoice identities. Move/duplicate the billing profile to the COMPANY level
   (prefill from the owner's existing details; editable per site at Account → Billing →
   Billing details); invoices/commission statements + the publish gate read the site's
   company profile. Touches: billingController (contact → company), invoicePdf,
   BillingPage details tab, siteCompleteness `billing_details`, CRM billing views.
2. ✅ **Fees-policy acceptance for site #2.** (2026-09-01: `stampNewSite` in cms sitesController stamps `metadata.onboarding.fees_policy` [onboardSite shape] + a `legal_acceptances` fees row on createSite/cloneOwnSite when the modal's confirm line is ticked; NewSiteModal + CloneSiteModal gained the required "same terms: free website, 5% commission" checkbox. Stacy's clone card sends no acceptance so nothing is fabricated.) Signup stamps `metadata.onboarding.fees_policy`;
   `POST /api/cms/sites` (+ /clone) never does — the second business has no recorded 5%
   acceptance. Add a confirm line to NewSiteModal ("Free website + 5% commission, same
   as your other sites") and stamp server-side (same shape as onboardSite).
3. ✅ **`is_test` inheritance.** (2026-09-01: same `stampNewSite` — flags when `isTestEmail(owner email)` OR every existing sibling site is already test; best-effort, never fails the provision.) A new/cloned site by a TEST owner is not flagged
   `is_test` (flag comes from the signup email only) → escapes Clean up test data +
   pollutes KPIs. In createSite/cloneSiteEndpoint: flag when `isTestEmail(owner.email)`
   or when all the owner's existing sites are test.
4. ✅ **Theme selection at creation.** (2026-09-01: NewSiteModal theme cards [per-vertical active templates, color swatches, default preselected, resets on vertical change] → `templateSlug` through `POST /api/cms/sites` → provisionSite's existing `templateSlug` param; cross-vertical slugs rejected by resolveTemplate.) NewSiteModal offers vertical only; owner lands on
   the default theme and must find Website → Style → Themes. Add a theme step (the
   vertical's template cards, like the Claim funnel's Starter pick) to the modal.

## P20 — Security posture / compliance readiness (queued 2026-08-20)

Peter's Q: do we need SOC 2 / ISO 27001? Answer: those are ORG certifications
(auditor, 6–12 months, $20k+), not features — and our infra already carries them
(Supabase SOC 2 Type II · Cloudflare ISO 27001/SOC 2 · Stripe PCI DSS L1 ·
Twilio/Google). For local-business tenants, provider inheritance + honest
practices is the norm; pursue Stemfra's own SOC 2 only when bigger customers
send security questionnaires. What to actually do, in order:
1. Publish a marketing **Security page** (data handling, per-tenant RLS isolation,
   encryption in transit/at rest, subprocessor list — reuse Privacy §5a).
2. **Staff account hardening**: require MFA (CMS TOTP already built) for
   @stemfra.com staff; least-privilege CRM roles = the parked "Per-role RLS data
   hardening" item (that's the real internal gap — all staff share full data RLS).
3. Backups/incident basics: confirm Supabase PITR tier, a security@stemfra.com
   contact, and a one-page incident-response note.
4. LATER: SOC 2 readiness (vendor like Vanta/Drata) when enterprise/chain deals
   need it.

## P21 — Data safety before the first client (queued 2026-08-27)

The production Supabase org runs the FREE plan (no backups, 500MB cap). Peter's
call: upgrade to Pro once real clients arrive (~first 10); Claude's standing rec
is to treat the FIRST paying client as the trigger. Until then:
1. ✅ **Nightly backup sweeper — DONE 2026-09-01** (`lib/backupSweeper.js` +
   `routes/admin/backups.js` + the `./backups` compose bind mount): nightly at
   BACKUP_HOUR_UTC (default 7 ≈ 2-3am ET) it streams 30 business-critical
   tables to gzip JSON (per-night dir + manifest), rolling 7-day retention,
   boot catch-up when the newest dump is >26h old, failure email to
   NOTIFY_EMAIL, `POST /api/admin/backups/run` + `GET /api/admin/backups`
   (PLATFORM_ADMIN), manual `scripts/backup-now.js`. ON by default
   (BACKUP_ENABLED=false kills). Verified: full prod dump 3,174 rows / 0.4MB /
   0 errors, every file re-parses as valid JSON (argyle + 116 bookings
   present), retention prune exercised. Restore = manual by design (header
   comment documents FK order).
2. **Supabase MFA for admin@'s dashboard login** (Team page showed MFA
   Disabled for both owners) — same hygiene bucket as the Cloudflare TOTP done
   2026-08-27.
3. **Pro upgrade** (~$25/mo) at the first paying client; consider the PITR
   add-on once revenue justifies.

## P22 — Expense Tracker AI (PRODUCT sketch, recorded 2026-08-31)

The sellable, tenant-facing sibling of P17 (which stays the internal OPEX
version and becomes the dogfood). Origin: while building the Helen Lead-Gen
CRM's telephony arc, Peter asked for a live case study — a read-only IMAP
scan of his connected Gmail (546 August messages) surfaced 8 real expense
documents with a plain subject filter (Anthropic x2, ElevenLabs, Cloudflare,
Atlassian, Figma x2, Tello). Proof: the hard plumbing (mailbox connect,
vaulted credentials, sync) ALREADY exists in the lead-gen CRM; the product
is the extraction + books layer on top.

Product shape (v0 sketch):
1. **Connect mailboxes — PLURAL, a core requirement (Peter 2026-08-31):**
   a business's subscriptions scatter across addresses (Peter's own case:
   peter.space.io@gmail.com, admin@stemfra.com, peter@stemfra.com). The
   account model is one workspace -> N linked mailboxes from day one; the
   lead-gen CRM's single `email_account` key generalizes to a list. Reuse
   the same app-password flow + docs page now, the stemfra_ai OAuth broker
   at product scale.
2. **Harvest**: scheduled scan per mailbox (subject/sender heuristics find
   candidates cheaply — measured 546 -> 8 with zero AI cost), then the LLM
   opens only the candidates and extracts vendor / amount / currency /
   date / cadence / last4. Dedupe by message-id AND by vendor+amount+period
   (a Figma "renewal reminder" and its receipt must not double-count).
3. **Books**: monthly expense P&L by category, renewal calendar with
   upcoming-charge warnings, "not a business expense — exclude" toggle
   (P17's rule), CSV/Excel export (the lead-gen CRM's SheetJS exporter
   ports straight over).
4. **Metering/pricing**: AI extraction runs through the same aiMeter
   25%-markup pattern; candidate-filtering-first keeps unit cost tiny.
   Could ship as a module inside the CRMs or a standalone product under
   the Stemfra AI umbrella (the Google-style multi-product launcher idea,
   recorded in the lead-gen plan doc).

Build trigger: after the Helen handoff + billing arc; P17's n8n harvester
can be superseded by this product's engine (build once, use internally
first — the platform is customer #1).

## P24 — CMS lead-reply email: dual mode — ✅ BUILT + VERIFIED 2026-08-31 (local commits, not pushed)

Option B (platform Resend, business display name, reply-to = owner) had
already shipped 2026-08-07 (replyToLead + the CMS ReplyComposer). This
session added the remaining delta, verified live in the CMS as
Marcus/argyle:
- **Gmail connector, test-before-store**: `site_email_connectors`
  (server-only RLS) + `lib/tenantGmail.js` (real SMTP login check BEFORE
  storing; app password AES-256-GCM encrypted with a key derived from
  the server secret; decrypted only at send) + `/api/cms/email-connector`
  + CMS Settings, Notifications, "Reply sending" section (default card,
  connect form, Connected/Disconnect). Wrong password rejected with
  guidance; real admin@stemfra.com app password accepted, then
  disconnected to leave the demo clean.
- **replyToLead dual mode**: connector present sends via the owner's own
  Gmail; otherwise the platform path. Reply metadata records `via`.
- **Composer register**: ReplyComposer gained the leadgen typography set
  (light-theme ReplyToolbar: 10 email-safe fonts, TT sizes, link
  popover, underline) + a mode-aware footer.
- Sync kept: settingsSections + sectionIcons + server lib/cmsRoutes.js
  `replySending`. CMS tiptap aligned at 3.30.6 (a nested dual
  @tiptap/core broke typecheck).

Original decision text (kept for context):

Tenants replying to site leads from the CMS get REAL sending (replacing
the mailto link): **default = Option B** (platform Resend from
notifications@mail.stemfra.com with the owner's address as reply-to; zero
setup) **plus an optional Gmail connector** (app-password only, Gmail
only for now — the leadgen CRM's connect/vault/test-before-store model
ported to the CMS) for tenants who want to send AS their own address.
Composer = the leadgen RichToolbar register. Build after the CRM email
arc (P23-adjacent slices: ops AI-assist chips, staff signatures, ops
inbox).

## P23 — CRM call workspace + side Copilot + Lead-Gen monitoring (recorded 2026-08-31, Peter)

Three stemfra-CRM (stemfra-ops) items agreed while building the Helen
Lead-Gen CRM's telephony arc:

2 (of the P23 list). **Side Copilot: ✅ BUILT + VERIFIED 2026-08-31** (local
   commits, not pushed). The Helen Lead-Gen copilot ported: server
   `/api/admin/copilot` (routes/admin/copilot.js + lib/crmCopilotContext.js
   live snapshot of sales pipeline + tenant sites + billing + expenses;
   `crm_copilot_conversations` table, per-staff), CRM `components/copilot/`
   CopilotPanel (docked resizable right rail, Chat|History, markdown,
   link chips, rewind) + TopBar Copilot launcher. Whitelisted
   confirm-before-act actions: set_stage, email_lead (opens the composer),
   scan_expenses. Verified live: grounded pipeline answer (63 leads, 11
   contacts) + the scan action end-to-end with the honest "Done" note.

1. **Persistent call widget: ✅ BUILT IN THE LEAD-GEN CRM 2026-08-31** (CallDock,
   per the build-there-first plan; port back here when browser calling lands —
   the ops CRM's existing CallWidget already covers its Twilio Voice SDK flow).
   Original spec: Replace the
   modal-style call UX with a floating, page-independent widget (the
   Front Desk launcher pattern from tenant sites): active call docks to a
   corner and survives navigation, so staff can edit a contact, draft a
   note, or add a calendar event (e.g. the prospect agrees to a Zoom/Meet
   mid-call) WHILE talking — the bank-agent mental model. Same pattern
   ships in the Lead-Gen CRM (design recorded in its docs/TELEPHONY.md
   §4b); build there first on the smaller surface, port back here where
   the Twilio Voice JS SDK (browser audio) already exists.
2. **Side Copilot for the stemfra CRM.** A docked side-panel copilot like
   the Lead-Gen CRM's Copilot and Stacy in the CMS — staff-facing,
   context = the open record + CRM data. Reuse the Lead-Gen copilot's
   panel UX + the aiMeter metering pattern.
3. **Lead-Gen product monitoring: ✅ BUILT + VERIFIED 2026-08-31** (local
   commits, not pushed). leads-api `GET /api/ops/monitor` (routes/ops.js,
   `x-ops-secret` = OPS_MONITOR_SECRET, service-to-service) → stemfra_server
   proxy `/api/admin/leadgen-monitor` (LEADGEN_API_URL + LEADGEN_OPS_SECRET
   env; requireStaffAuth) → CRM page /leadgen-monitor (Platform sidebar,
   Radar icon): summary cards + per-tenant table (health Active/Quiet/New,
   members, leads/enriched/contacted, inbox connected + emails/awaiting,
   number/compliance, AI calls + billed, last activity), search +
   pagination, 5-min auto-refresh. Verified live: 3 tenants, Helen Active
   with inbox connected. ⚠ AT PUSH TIME add OPS_MONITOR_SECRET to the
   Helen deploy env AND LEADGEN_API_URL + LEADGEN_OPS_SECRET to
   stemfra_server deploy.yml (public hostname, never loopback).
   Original spec: A surface
   showing per-tenant health of the Lead-Gen product (Helen first):
   plan/usage (the /api/usage/summary payload), lookups run + spend,
   emails sent, last inbox sync, telephony state, last activity.
   Mechanism: leads-api exposes a staff endpoint guarded by a shared
   secret (the STEMFRA_ADMIN_SECRET service-to-service pattern; public
   hostname, never loopback), proxied by stemfra_server for the CRM page.
   Start read-only; actions (suspend, top-up) come with the billing arc.

Sequencing: after the Helen handoff. Item 3 is small and first (it aids
the pilot itself); 1 and 2 ride with the Lead-Gen telephony T5/T6 arc.

## Deferred one-offs (kept pending per Peter 2026-08-09)
- First YouTube tutorial script ("Stemfra CMS in 5 minutes", ElevenLabs Studio
  + Jessica @ 0.95) — draft when Peter wants to record.
- Supademo pilot step-order fix (one reorder_steps call on demo
  cmsj17qj000k5rq20fo7y47gy) — before any marketing use of the pilot.
- ELEVENLABS_API_KEY into deploy.yml env block + GitHub secret AT PROD PUSH
  (deploys wipe unlisted vars).
