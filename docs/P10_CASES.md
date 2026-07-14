# P10 — Planning Cases (Peter's questions + agreed plans)

_Recorded 2026-07-10. Peter raised 11 cases for discussion-before-build; plans below were
agreed the same day. Build order (agreed): **Case 4 → Case 2 → Case 3 → Cases 7+11 (one
arc) → Case 1 (click-to-edit) → Case 6 R1 → Case 5 (PWA-only)**. Tracked as ROADMAP.md
items 37–45. Case 8 was executed before this doc (CMS beta test as peechizzy); Case 10 =
the standing pending list in ROADMAP.md._

---

## Case 1 — CMS ease-of-use for non-tech owners

**Peter's question:** Since we are focused on local businesses, on a scale of 1–10, how
easy is it for non-tech-savvy people to use our CMS to manage and customise their website
and business? How can we make it easier — documentation with video tutorials, a YouTube
channel, versioned CMS releases like Squarespace 7.0/7.1?

**Assessment:** ~6.5/10 overall, split: business management (bookings/leads/services/
hours/team) is 7–8 — task-shaped pages + Stacy's onboarding checklist. Website
customization is 5–6 — designer vocabulary leaks ("eyebrow", "OG image"), no visual
mapping from form → page without the preview drawer, no undo.

**Plan (leverage order):**
1. **Click-to-edit live preview** — the parked Phase-B postMessage bridge (click a
   section in the preview → its editor opens; edits reflect before saving). Biggest mover.
2. **Plain-language pass** — relabel jargon fields, richer hints, empty-state guidance.
3. **Docs + videos AFTER UI stabilizes** (videos of a changing UI rot): 5–10 task-based
   60–90s clips ("change your prices", "reply to a lead") on YouTube (doubles as
   marketing/SEO), linked from an in-CMS per-page Help menu.
4. **NO Squarespace-style version branding** — that pattern exists because of their
   painful platform generations. Our versioned surface is themes; the CMS updates
   additively. For communication, use what we built: `broadcast_announcement` → in-app
   "What's new" feed + a public changelog page.
5. **Usability sessions with 2–3 founding-cohort owners** — 20 minutes each will reorder
   this list better than speculation.

## Case 2 — Theme studio + plans display in the CMS

**Peter's question:** A CMS section where users see all available themes per vertical
(like a studio), displayed like the marketing site's templates page; and somewhere like
the marketing pricing page showing all plans/offers in tiers.

**Plan:** Both are low-effort because the data exists.
- **Theme studio**: upgrade Settings → Style's theme cards to the marketing gallery
  register — hero-fold mockups already served by `GET /api/marketing/mockups`, brand/city
  labels, "Preview" → the live demo, existing Switch mutation stays. Scoped to the site's
  vertical (templates can't cross verticals). Extension: a cross-vertical browse view
  whose real job is feeding **"+ New site"** (see a spa theme → create a spa site on it).
- **Plans display**: render Account → Billing's "Change plan" as the marketing-style tier
  cards from the same `/api/plans` catalog — pricing can never drift between surfaces.

**SHIPPED 2026-07-10 + verified:**
- *Theme studio*: `ThemesSection` cards now show each theme's LIVE demo hero-fold
  (matched via `GET /api/starters?vertical=` theme-name → demo, + the hero-fold scene
  from `GET /api/marketing/mockups`; swatch strip kept, Aa preview = fallback for
  demo-less themes) + a "Preview live site ↗" link to the demo. Verified on argyle:
  Classic NYC + Manhattan cards render fold images + correct demo links + Active badge.
- *Plans*: `ChangePlanCard` merged with the public catalog via new `usePublicPlans()`
  (lib/billing.ts) — full tier cards: price, promise, live features (≤6), "Most popular"
  badge, current-plan marking, Switch CTAs → the existing change-plan confirm flow.
  Verified on lull (active Essential sub): 3 cards, badge on Growth, features render.

## Case 3 — Banner / popup offer catalog

**Peter's question:** Banners, notifications, offers on client websites (incl. holiday
offers) — a catalogue of up to 10 pop-up banners with dark overlay and inline display.

**Plan:**
- Schema `site_promotions`: title, body, CTA text/href, image, `style_key`,
  `placement` (popup | inline | top bar), start/end, active.
- **~10 token-driven banner archetypes** (overlay popups: centered card, bottom sheet,
  image-split, holiday-framed · inline bands · announcement bar) — `--site-*` tokens mean
  one catalog matches every theme automatically.
- Template `PromotionHost` in each Layout: fetch active promo (anon RLS), render the
  chosen style with etiquette — once per session, dismissal remembered, delay/scroll
  trigger, ESC + focus trap.
- CMS "Promotions" page: create offer, pick style from a visual mini-preview catalog,
  schedule, activate.
- v1 display-only; v2 ties into promo codes at booking/checkout when payments land.

## Case 4 — Advanced admin CMS?

**Peter's question:** Should we have an advanced CMS for admin access only, so we manage
some websites from the CMS instead of porting CMS functionality into the CRM? Admin logs
into both CMS + CRM with @stemfra.com Google auth?

**Plan (agreed): staff MODE in the existing CMS, not a separate app.**
- @stemfra.com Google sign-in on the CMS login → recognized as staff → site picker across
  ALL sites → edits under an "Editing as Stemfra staff" banner.
- The DB layer already permits it: `is_stemfra_staff()` RLS grants staff access to all
  `site_*` tables. Gaps: the CMS's owner-context lookup (no contacts row for staff) and
  the server's `verifySiteOwnership` (staff bypass + audit to `site_activity`).
- CRM keeps ops (billing/domains/fleet); CMS is THE content-editing surface for owners
  and staff alike. Also fixes our own demo management (no more logging in as peechizzy).
- Shipped 2026-07-10 — see the implementation notes at the bottom of this doc.

## Case 5 — CMS mobile app?

**CLOSED (Peter, 2026-07-10): no PWA, no store apps.** Responsive polish continues as ordinary work; nothing to build here.

**Peter's question:** Do we need the CMS as a mobile app on the App Store / Play Store?

**Plan: not yet — ladder.** (1) Responsive polish + **PWA** now-ish (installable, push
via the existing notification system) ≈ 80% of the value; owners' real mobile jobs are
seeing bookings, answering leads, getting notified. (2) Capacitor store wrapper when
store presence matters commercially. (3) Native only on real client demand. Store review
cycles add release friction that hurts a fast-moving product.

## Case 6 — Website "Remix" (AI theme composer)

**Peter's question:** Stacy or a new agent looks at a vertical's reference, lists pages/
sections, composes a new theme from existing archetype components + a font family + a
palette, and registers it as an additional theme. Requires a registry of all components
and a way to preview them individually (almost a page builder from built components).
Do we need this?

**Plan (agreed): yes — phased, internal-first.** Feasible because a theme IS data
(`templates` row = design_tokens + archetype_variants + home_arrangement); we have ~20
archetypes / 60+ variants, 12 curated palettes, font machinery, and the theme-audit
validator.
- **R1 — Variant registry + visual browser** (valuable regardless of Remix): a
  machine-readable registry (archetype → variants → required content keys) + a preview
  screenshot per variant (generated via the existing screenshot pipeline with fixture
  data) + a filterable browser UI.
- **R2 — Remix engine**: given vertical + mood/reference, an LLM picks arrangement,
  per-section variants, palette, fonts — constrained by a compatibility matrix
  (dark/light registers, theme-specific variants, token purity) — writes an INACTIVE
  templates row → theme-audit validates → preview on a scratch clone → human approves.
- **R3 — Owner-facing**: the registry powers a bounded per-section "swap the look"
  picker — page-builder feeling without page-builder chaos.
- **Caution (distinctness standard):** the Editorial-Argyle lesson — a layout remix with
  inherited palette/fonts does NOT qualify as a distinct catalog theme. Remix output =
  drafts gated by human curation.

## Case 7 — Porkbun → Cloudflare (linking vs transfer)

**Peter's question:** When we buy a domain from Porkbun, can we already transfer it to
Cloudflare, or link it and operate from our Cloudflare account? How does transfer work,
given users can also bring their own domain?

**Today:** registration + DNS live at Porkbun; we set apex ALIAS + www CNAME there and
attach the custom domain to the CF Pages project. No transfer/zone functionality exists.

**Plan:** keep registration at Porkbun, **move DNS to a Cloudflare zone at purchase** —
create zone (CF API) → set nameservers (Porkbun API) → manage records in CF. Gains:
proxy/SSL/WAF/caching + programmatic DNS (the enabler for Email Routing + Workspace DNS,
Case 11). Full registrar transfer to CF Registrar is blocked by ICANN's **60-day lock**
on new registrations (plus auth/EPP code + transfer≈1yr renewal) — optional cost play
later, not v1. **BYO-domain clients stay connect-only** (their ownership, their
registrar) — taking custody of client domains is unwanted liability.

## Case 8 — CMS beta test as a real user ✅ DONE

Executed before this doc: operated the CMS as peechizzy@gmail.com across verticals/
themes, fixed bugs found, documented in the work logs (WORK_2026-07-07.md).

## Case 9 — Email template suite + auth security

**Peter's question:** Good email templates for all use cases — invoices, signup, email
OTP, login attempt from new device/location with allow-permission from email, 2FA with
authenticator apps.

**Plan:**
- **One branded base template** (logo header/footer) → migrate all transactional mail
  (billing request/receipt, booking confirmations, welcome, handoff notices). Dev-preview
  route exists for iteration.
- **Auth emails (OTP/magic-link/reset)** are sent by Supabase Auth → customize Supabase's
  email templates + point Supabase at OUR SMTP for consistent branding.
- **New-device/location alerts**: capture login events (device/IP-geo comparison on
  session start) → alert email with "This was me / Secure my account". The full
  email-approved login GATE is a custom auth flow — sequence after alerts prove out.
- **2FA**: TOTP already live (CMS → Profile → Security, QR enrollment verified). Gaps:
  recovery codes + enforcing 2FA for staff. WebAuthn later.

## Case 10 — Previous pending tasks

The standing list lives in ROADMAP.md (refreshed 2026-07-10 — see "Status refresh").

## Case 11 — Customer professional email (Google Workspace)

**Peter's question:** What do we need to provide professional email? What else suggested?

**Plan (ladder):**
1. **Cloudflare Email Routing as the Pro perk (now)** — free receive-forwarding +
   send-as via Gmail SMTP. $0 COGS; lands almost free once Case 7's CF zones exist
   (we control DNS → MX/SPF/DKIM are API calls). Ship Cases 7+11 as one arc.
2. **Workspace referral / assisted setup** — client pays Google (~$7–8/user); we do DNS +
   setup as high-touch onboarding.
3. **Full Workspace resale** — via a distributor (Pax8/Sherweb; ~$3–4 wholesale),
   provision through the Reseller API, bill via System A. Real margin, real support
   burden — only at volume.

**DECISION (Peter, 2026-07-10, after the market survey):** ship **rung 1 only** in the
Cases 7+11 arc; rung 2 (Workspace concierge) is a future add; Titan white-label
mailboxes = the v2 revenue product (parked — starts with a Titan sales conversation).
Survey findings: Squarespace/Wix resell Google Workspace; WordPress.com/GoDaddy/
Hostinger/Name.com white-label **Titan** (partner APIs, GoDaddy ARPU +76%); Hostinger
also runs its own mail; the vertical incumbents (Mindbody/Wodify/Booksy) offer NO
email at all. Our verticals' familiar upgrade path is Gmail → Google Workspace.
Porkbun's own forwarding was rejected (requires Porkbun nameservers — conflicts with
the Case 7 CF-zone move). Own mail server rejected (deliverability burden).

---

## Case 4 implementation notes (2026-07-10) — SHIPPED + VERIFIED

- **Server** (`stemfra_server/middleware/cmsAuth.js`): `getStaffInfo(authUserId)` — staff =
  @stemfra.com auth email (via `auth.admin.getUserById`) + ACTIVE `profiles` row (same
  gate as the CRM; the email check keeps the 6 legacy client profiles out), cached
  in-process 5 min. `verifySiteOwnership` falls back to the staff check when the caller
  isn't the owner → returns the site; each bypass is **audited** to `site_activity`
  (`action='staff_cms_access'`, actor = staff email, deduped per user+site for 10 min so
  reads don't flood). Every CMS endpoint inherits this (uploads, domains, Stacy, billing…).
- **CMS** (`stemfra_cms`): `useOwnerContext` — contacts lookup is now `maybeSingle`; no
  contact + @stemfra.com + active profile → **staff branch**: fetches ALL non-deleted
  sites (staff RLS grants the reads) ordered by subdomain, synthesizes the contact from
  the profile name, sets `isStaff` on the context. `CmsLayout` renders an amber
  **"Editing as Stemfra staff — actions are audited"** banner. Login needs no change —
  the Google button already existed on the CMS login page.
- **Verified end-to-end as dev@stemfra.com**: banner renders · /sites lists all 16 ·
  switched to argyle → edited + saved the hero headline (RLS write path) + reverted ·
  server endpoints 200 on two non-owned sites (403 pre-change) · three
  `staff_cms_access` audit rows landed with the right actor.
- **Notes**: owner path unchanged; a non-staff login with no contact now gets a clear
  "No account found" error. v1 audit granularity = per-site access events (not per-write);
  section saves go direct through Supabase RLS, so per-write server auditing would need
  routing those mutations through the server — deliberate v1 scope.

## Case 3 implementation notes (2026-07-10) — SHIPPED + VERIFIED

- **Schema**: `site_promotions` (migration `create_site_promotions`) — style_key,
  eyebrow/title/body, cta_text/href, image_url + image_media_id (FK site_media SET NULL),
  collect_lead, starts_at/ends_at window, is_active, display_order, metadata. RLS:
  anon read (active + site live/previewing), owner ALL (`user_owned_site_ids()`),
  staff ALL. Types hand-patched into `database.types.ts`.
- **Style catalog** (`packages/site-data/src/promotionStyles.ts`, exported from the
  barrel): **11 token-driven styles** — popups `split-image` / `split-image-dark` /
  `split-lead` (photo + signup form) / `centered-card` / `centered-dark` /
  `bottom-sheet` / `holiday-frame`; bars `top-bar` / `cookie-bar`; in-page
  `inline-band` / `inline-photo` (reuse CtaBanner). All render via `--site-*` tokens,
  so one catalog matches every theme. The three reference screenshots map to
  split-lead (respace), split-image-dark (hot8yoga), split-image (CrossFit Union Sq).
- **Archetypes** (`packages/archetypes/src/Promotions/`): `PromotionPopup` (overlay,
  ESC/backdrop close, scroll lock, focus on close; `PromoLeadForm` POSTs
  `/api/site-forms/lead` with subject = the offer title → Leads inbox, shows a
  thank-you then auto-closes), `PromotionTopBar` + `PromotionCookieBar`,
  `PromotionSurface` (etiquette: popup after 2.5s, once per session
  [sessionStorage], dismiss = 3-day silence [localStorage], cookie accept =
  permanent `stemfra-cookie-consent`; picks at most one promo per surface kind),
  `SitePromotions` (self-fetching wrapper the Layouts mount).
- **Templates**: all 6 Layouts mount `<SitePromotions client={supabase} siteId={site.id}/>`
  just before `<Footer>` (inline styles flow in the page; overlays/bars are fixed).
- **CMS**: `/promotions` page (Website nav, GlobalSearch) — list rows with
  Live/Scheduled/Ended/Off pills + create/edit card: visual style picker (schematic
  thumbnails per style), eyebrow/headline/body, CTA, ImageUploadField (image styles),
  "collect leads" checkbox (non-form popups), schedule window, On/Off. Cookie-bar
  selection relabels fields (Notice text / Accept button / Learn-more link).
  CRUD hooks in `lib/queries.ts` (posts pattern).
- **Verified end-to-end** on argyle-and-sons: split-lead popup + cookie bar seeded;
  popup rendered after delay with 3-field form → POST 201 → lead row in `site_leads`
  (source_page "Promotion popup") → success message → auto-close; cookie accept
  persisted across reload; popup once-per-session honored; CMS list/editor
  verified as staff incl. a save round-trip (eyebrow edit → DB → reverted).
  Demo promos LEFT SEEDED on argyle for Peter's review (:5174).
- **v2 later**: tie into promo codes at booking/checkout when that arc lands;
  scroll/exit-intent triggers; per-page targeting.

## Cases 7+11 implementation notes (2026-07-10) — BUILT; live e2e gated on 2 Peter actions

- **Case 7 (DNS → Cloudflare zone at purchase).** New `lib/cloudflareZones.js`
  (zone create/lookup-by-name, zone DNS records, Email Routing enable/status/rules,
  account-level destination addresses) + `lib/domainZone.js` `provisionDomainZone(domain,
  pagesTarget)` — the SHARED orchestrator both register paths call so they can't drift:
  create zone (idempotent) → Porkbun `updateNameServers` (new in lib/registrar/porkbun.js,
  POST /domain/updateNs) → proxied apex+www CNAMEs in the zone → enable Email Routing.
  Wired into `cms/domainController.registerOwn` + `admin/domainsController.registerDomain`
  right after the existing steps; the Porkbun ALIAS/www records stay as the serving
  fallback during NS propagation. Zone ids are NOT persisted — looked up by domain name
  (no schema change). All steps best-effort into the `steps` report (purchase never lost).
- **Case 11 (email forwarding).** New `/api/cms/site-email` (routes/cms/siteEmail.js +
  controllers/cms/emailController.js, requireCmsAuth + verifySiteOwnership):
  GET status (zoneStatus/routingEnabled/aliases w/ per-destination verified flag) ·
  POST create alias (registers the destination — Cloudflare emails it a verification
  link — then creates the routing rule; 20-alias cap) · DELETE alias (rule must belong
  to the site's own zone). **Privacy rule:** Cloudflare destination addresses are
  ACCOUNT-level and shared across all customers — the controller only ever returns the
  destinations referenced by THIS site's rules, never the raw account list.
  Gates: needs `sites.custom_domain` (409 `no_domain`) + the domain's zone in OUR
  account (409 `unmanaged_domain` — BYO connect-only domains excluded by design).
  Activity audit: `email_alias_created` / `email_alias_deleted`.
- **CMS:** Settings → Domain gained an **Email forwarding** card (`EmailSection.tsx` +
  `lib/useSiteEmail.ts`; registered in settingsSections/SettingsPage/sectionIcons):
  no-domain explainer → register pointer · BYO "not managed by Stemfra" explainer ·
  amber "DNS still activating" note (zoneStatus != active) · alias list with
  Active/Pending-verification badges + remove-confirm · add form (alias@domain +
  forwards-to) · receive-only + verification copy. Verified in preview on argyle
  (no-domain state end-to-end through the real 409). CMS typecheck clean.
- **⛔ BLOCKED for live e2e — Peter actions:**
  1. **Cloudflare API token upgrade** (probe 2026-07-10: zone-create returned
     "Requires permission com.cloudflare.api.account.zone.create"; Email Routing reads
     returned auth errors). Edit the token (dash.cloudflare.com → API Tokens) to add,
     scoped **All zones from account**: `Zone → Zone → Edit`, `Zone → DNS → Edit`,
     `Zone → Email Routing Rules → Edit`, plus account-scope
     `Account → Email Routing Addresses → Edit` (keep Cloudflare Pages Edit). Update
     `CLOUDFLARE_API_TOKEN` in stemfra_server/.env (+ the GitHub Actions secret later).
  2. **Porkbun account** email+phone verification + prepaid balance (pre-existing
     blocker — VERIFICATION_REQUIRED stops all registration incl. dryRun).
  Once both land: register a real domain end-to-end → confirm NS switch, zone active,
  site serves via the CF zone, alias forwarding + verification mail.
- **Deliberately NOT built:** registrar transfer to CF Registrar (ICANN 60-day lock;
  optional cost play later) · custody of BYO domains · send-from-domain (receive-only
  v1; mailboxes = Titan v2) · Workspace DNS one-click (comes with the concierge rung).

## Case 1 implementation notes (2026-07-10) — items 1+2 SHIPPED + VERIFIED

- **Click-to-edit live preview (item 1, the "biggest mover").** The parked preview
  bridge, built as a postMessage channel (NOT the full live-as-you-type draft layer —
  that stays a later slice):
  - `packages/site-data/src/previewBridge.ts` (`initPreviewBridge`, exported from the
    barrel; called in every template `main.tsx`) — activates ONLY inside an iframe
    with `?stemfraEdit=1`: violet dashed hover outline + a floating "Edit section"
    chip on `[data-stemfra-section]` blocks; click (capture, swallowed so links don't
    navigate) → posts `stemfra:edit-section {sectionId, sectionType}` to the CMS;
    listens for `stemfra:scroll-to-section` → smooth-scrolls to that section.
  - All 6 template HomePage section loops now tag their wrappers with
    `data-stemfra-section={section.id}` + `data-stemfra-type` (Fragment branches →
    plain divs; anchor/section branches keep their ids/styles). Home page only in v1;
    inner pages when needed.
  - CMS: `buildLiveUrl` appends `?stemfraEdit=1`; `ContentPageEditPage` listens for
    the click message → expands that section's editor + scrolls its row into view
    (rows got `id="section-row-<id>"`); opening any editor fires the reverse scroll
    via a new `requestPreviewScroll` in the livePreview store, relayed into the
    iframe by `LivePreviewPanel` (new iframe ref).
  - Verified both directions live (barbers + CMS): iframe click → the right editor
    opened + scrolled; editor expand → preview scrolled to the section (smooth scroll
    takes ~1.5s — early probes that sampled sooner read as "no scroll").
- **Plain-language pass (item 2).** "Eyebrow" (13 editors) → **"Small label"** with a
  default hint ("The little line above the headline…") added where none existed;
  "Footer CTA label/link" → "Bottom button text/link"; "Meta description" → "SEO
  description" (incl. the Stacy field label so refine chips read naturally).
  OG image was already "Social sharing image".
- **Deliberately deferred (per the agreed plan):** live-as-you-type draft overrides
  (full Phase B); docs + task videos until the UI stabilizes; "What's new" already
  has its rail (`broadcast_announcement` → notifications feed); usability sessions
  with founding-cohort owners = Peter.

## Case 6 R1 implementation notes (2026-07-10) — SHIPPED + VERIFIED

- **Machine-readable variant registry**: `stemfra_server/lib/variantRegistry.js` — all
  14 dispatched archetypes (the `templates.archetype_variants` keys) × 104 variants,
  each with register (light/dark/any) + a one-line description. Seeded from the
  archetype type unions (existence truth) + docs/THEME_VARIANTS.md (the doc's tables
  were ~10 days stale — the ~20 wellness variants existed only in prose; the registry
  now covers them all). KEEP IN SYNC rule: new variant = union + registry + doc row,
  same PR. R2 (Remix) consumes this as its component menu; R3 moves/mirrors it into
  @stemfra/site-data for the owner-facing picker.
- **Live usage endpoint**: `GET /api/admin/theme-registry` (PLATFORM_OPS) — joins the
  registry with the `templates` table (which theme declares which variant, incl.
  inactive ones) + each template's first Starter demo site → a real
  `https://{subdomain}.stemfra.com` page rendering the variant. Usage can never drift:
  it's computed per request.
- **CRM browser**: Marketing → **Components** tab (`/theme-components`,
  `pages/ThemeComponents.jsx`) — filterable by archetype / Light–Dark register /
  search / "Unused only"; variant cards show register badge, description, used-by
  theme chips (vertical-labelled, strikethrough when the theme is inactive),
  **View live ↗** demo links, and Dead-code / Unused flags. Header stats:
  14 archetypes · 104 variants · 10 unused · 18 active themes. Verified live as
  dev@stemfra.com (incl. the Unused-only filter surfacing the 10 reuse candidates:
  tile-grid, feature-cards, council, showcase-carousel, visit-deep location [dead
  code], accent-panel, + 4 that are inner-page-picked — the UI notes that caveat).
- **Deviation from the R1 sketch**: per-variant preview SCREENSHOTS were swapped for
  live-demo links (every variant links to a real page rendering it — fresher than
  static captures, zero pipeline work). Screenshot generation via the prepared-masters
  mockup pipeline stays a follow-up if R2 needs thumbnails.
- **Known caveat**: usage = archetype_variants declarations; inner-page code picks a
  few variants directly (accordion, detail-cards, profiles, editorial) so they read
  "Unused" — noted in the UI copy.
- **Next (R2, separate arc)**: compatibility matrix + the LLM composer writing
  INACTIVE templates rows gated by theme-audit + human curation.

## Cases 7+11 status update (2026-07-10, later)

- **CF token permissions verified** (Peter updated the existing token in place — no
  .env change): zone-create ✓ (probe zone created + deleted), Email Routing rules ✓,
  account destination addresses ✓. **One gap:** the routing SETTINGS endpoints
  (`GET /zones/:id/email/routing` + likely `POST …/enable`) need **Zone → Zone
  Settings → Edit** — add to the token when convenient. The email status endpoint now
  degrades gracefully if settings-read fails (best-effort catch).
- **Porkbun funded** ($20). Live end-to-end purchase test deferred at Peter's call.
- **Pages infrastructure audit** (the queued "verify Template Pages env" item): all 7
  Pages projects (barbers/salons/crossfit/yoga/cms/massage/spa) exist with complete
  env vars and green deploys — the "create stemfra-massage/spa projects" roadmap item
  was stale (repo pushed + projects created 2026-07-07).

## Case 9 implementation notes — Phase 1 (2026-07-10): unified email base + migration

- **Style decision (Peter, from 5 provider samples):** Hostinger STRUCTURE (centered
  logo header, bold heading, label/value summary table, tidy fine-print footer) +
  Claude RESTRAINT (soft warm #F4F3EF canvas, one white card, single dark button).
- **`templates/baseEmail.js`** — the one branded base every transactional email
  renders through. Blocks: `renderEmail` (shell: preheader/heading/paragraphs/rows/
  cta/note/reason) + `rowsTable` (Hostinger summary w/ bold total rows) +
  `quoteBlock` + `button`. Email-safe (tables + inline styles only). **Two brand
  modes:** Stemfra (default — logo+wordmark header, Stemfra footer) and **tenant**
  (`brand:{name,logoUrl?}` — the BUSINESS is the sender: business wordmark header,
  "Sent by {business} · website powered by Stemfra" footer). Booking confirmations
  are tenant-branded — a visitor books with the barbershop, not with Stemfra.
- **Migrated senders (kept their plain-text alternative — never drop it):**
  marketing contact pair (confirmation w/ the numbered what-happens-next steps +
  staff notification, rebuilt on the base), booking confirmations ×3 (single w/
  service/date/time/duration rows · salon multi-service visit w/ itemized rows +
  bold Total + failure note · class), owner lead notification + chat-lead
  notification (rows + message well + "Open your Leads inbox" → cms.stemfra.com/leads),
  Stacy staff handoff, Stripe orphan-payment alert.
- **Preview**: `/dev/preview` (dev-only) lists all 9 variants w/ sample data —
  visually verified in-browser (tenant booking, owner lead, itemized visit,
  marketing confirmation). `CMS_PUBLIC_URL` env optional (defaults cms.stemfra.com).
- **⚠️ Incident note:** a mid-edit syntax error crashed nodemon (server :4000 went
  down); repaired + restarted per the keep-server-on convention.
- **Remaining Case 9 phases:** (2) Supabase AUTH emails — customize the Supabase
  templates on the base design + point Supabase at our SMTP (dashboard config =
  Peter-assisted); (3) new-device/location login alerts (session-event capture →
  alert email w/ "This was me"); (4) 2FA recovery codes + staff 2FA enforcement;
  (+) a billing payment-request builder when System A dunning emails get wired
  (none exist today — billing_charges are notified in-app only); (+) B1–B9
  tenant-lifecycle sends (see OUTREACH.md).

## Case 9 — sender identity & email-loop proposal (2026-07-10, discussed with Peter)

**Research finding (the industry pattern):** Mindbody & co. send from the PLATFORM's
own authenticated domain (Mindbody's default: noreply@hirefrederick.com) with the
business as the display name; reply-to routes to the business; a custom sender domain
is an advanced opt-in requiring the business to add SPF/DKIM/DMARC records
(deliverability is the platform's moat). Postmark's on-behalf-of guidance says the same.

**Proposed ladder (to finalize):**
1. **Now (done):** Gmail sender + business display name + replyTo = the business's
   public email + anti-phishing footer naming both the business inbox and
   support@stemfra.com.
2. **Production sender:** a dedicated transactional domain (e.g. no-reply@mail.stemfra.com)
   via an ESP (SES/Resend/Postmark) with aligned SPF/DKIM/DMARC, separate from
   marketing/outreach traffic. Auth emails (Supabase SMTP) ride the same domain.
3. **Send-from-their-domain (our unique edge):** for Stemfra-REGISTERED domains we
   control the Cloudflare zone (Case 7) — we can set the DKIM/SPF records OURSELVES
   and offer true bookings@their-domain.com sending as a one-click Pro perk. Mindbody
   makes the business do DNS by hand; we don't have to.
4. **Booking management from email = ACTION LINKS, not inbound parsing:** "Manage
   booking" button → tokenized manage page reusing the member self-service APIs
   (cancel/reschedule shipped in System B 2d-3); a reschedule/cancel REQUEST notifies
   the owner (bell + email) and the owner confirms in CMS → Bookings. Replies-in-prose
   (visitor emails "please cancel") already reach the business via reply-to; parsing
   inbound mail with an agent = a later n8n arc, not v1.
5. **Tenant-customizable templates:** v1 = automatic branding (logo/name — done);
   v2 = a CMS "Emails" page seeded from the B1–B9 catalog (per-tenant overrides of
   subject/body with merge fields — the tenant mirror of the CRM Template Manager).
