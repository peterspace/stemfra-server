# P15 — Interactive demos, walkthroughs & VSL (the video arc)

_Agreed 2026-08-06 (Peter + Fable). Executor sessions follow this doc phase by
phase; update the Build log at the bottom after each slice. Standing rules
apply: commit per slice, NO push without Peter; no em-dash in user-facing copy;
verify-before-assert (walk every published demo in a browser); n8n via Peter._

## 0. Why / research base

Goal: make the **setup call optional, not mandatory** — tenants self-onboard via
Stacy + docs + interactive walkthroughs — and give sales a VSL + per-vertical
demo assets for stemfra.com and Mark's email outreach.

Research (2026-08-06, Sonnet /watch pass): `~/Documents/stemfra/video_research/`
(INDEX.md + 5 per-video transcript/notes pairs). Headlines:

- 3 of the 5 reference videos are one Supademo content campaign; the 2 "VSL
  samples" are 30-47s Mindbody brand/feature ads, NOT VSLs. The VSL structure in
  Phase E is therefore synthesized from first principles + the Mindbody
  techniques, unless Peter supplies a genuine long-form VSL reference.
- **The triple-corroborated tour spec** (Supademo's data from 200k+ companies,
  1,000 demos studied): 10-12 steps · ONE hotspot per step · 15-18 words per
  hotspot, written as a benefit ("sells the feature, not labels the button") ·
  one straight path, no branching for first-time visitors · AI voiceover (54% of
  top demos) · **the aha moment inside step 3, never a finale**.
- "Watched vs used": video captures attention, the interactive demo closes it.
  Beeminder case: interactive demo beside signup → $10k self-serve revenue in 2
  months, 50% better conversion than any other page.
- **Demo rot** is the operational risk: demos showing stale UI as the product
  ships. Our CMS changes near-daily → maintenance cadence is part of this plan.
- Mindbody techniques worth stealing: audience-qualifier hook naming every
  vertical in one breath; one composite shot proving multi-vertical coverage;
  REAL numbers in screenshots (never placeholders); per-vertical cuts of one
  script; feature-ad structure = 1 feature + 1 real screenshot + 1 sentence, x4.

## 1. Verified infrastructure (probed 2026-08-06, not assumed)

- **Supademo MCP connected** to Peter's account; workspace `My Company`
  (id `cmshuv0tt01shvs0kgwkyh60z`), role Admin, **plan reports "Growth"**
  (Peter signed up free → this is a trial; ⚠ find the expiry date in-app and
  decide the paid tier before the trial lapses — voiceover/branding features
  will constrict on Free).
- **Programmatic build pipeline confirmed** (the automation seam):
  `create_upload_job` → browser upload portal (human drags files, 60-min window)
  → `get_upload_job` → `create_demo_from_uploaded_media` (≤200 images, each =
  one step, ordered) → `create_hotspots` (x/y % coords; Tooltip/Circle/Area
  styles) → `generate_voiceovers` (one call, ≤75 steps, ElevenLabs voiceId) →
  `update_demo_settings` → `publish_demo` → `get_demo_embed_code`. Per-demo +
  per-hotspot analytics readable. Constraint: image URLs MUST come from the
  upload portal (no direct external-URL ingestion).
- **Capture side is already ours**: stemfra_server has Playwright (the mockups
  pipeline). Scripted, deterministic CMS screenshots = re-runnable capture =
  the demo-rot antidote.
- **69 built-in ElevenLabs voices; zero clones yet.** Growth supports cloning.
- **Trade-off (deliberate):** MCP-built demos are screenshot tours (first-class
  in Supademo). The clickable HTML-replica capture needs the Chrome extension
  (Peter, manual) — reserved for the marketing hero demo where "feel the
  product" matters; tenant how-to tours use screenshots.

## 2. Standing decisions

- **One canonical "Mark" voice** across walkthrough voiceovers, in-CMS tour
  audio (later), and VSL narration. Start with a built-in (candidates: **Drew**
  "educational news-anchor" or **Richard Yu** "clear, authoritative"; both
  American, matching Mark's persona). Phase A generates the pilot in the top
  candidate; Peter picks after hearing it in context. A proper ElevenLabs clone
  is a Growth-tier follow-up, not a blocker.
- **Tour spec (hard requirements for every demo we ship):** ≤12 steps, one
  hotspot/step, 15-18-word benefit-framed hotspot copy, straight line, voiceover
  on, aha moment ≤ step 3, mutable audio (player default).
- **Demo data before capture:** seed the source site with REAL-looking numbers
  (bookings, revenue, members) — never zeros or round placeholders.
- **Native in-CMS tours are a separate, complementary layer** (Gmail-style
  spotlight tooltips inside the live CMS) — Phase D, driver.js-based, triggered
  by Stacy/first-login. Supademo = shareable/embedded; native = in-product.
- Supademo workspace branding (violet #4f46e5 default → Stemfra brand, logo,
  watermark) is a one-time in-app setup by Peter (workspace globals aren't
  writable via MCP; per-demo settings are).

## 3. Phases

### Phase 0 — hardening prerequisites (GATED on Peter's UI corrections)
- **0a. Stacy onboarding fix slice** (audited 2026-08-06, findings in
  SESSION_HANDOFF): `?section=<type>` deep-link support in ContentPageEditPage
  (reuse the click-to-edit open+scroll mechanism); repoint the contact/hero/
  about/seo steps; fix dead `cmsRoutes` anchors (`booking`, `pricingDisplay` →
  `/settings/payments#payments`); rewrite step guidance copy; **new Stacy S3
  action `update_contact`** (collect address/phone/email in chat → confirm card
  → patch the home location_map content) — the first do-it-for-me step and the
  proof point for the hero demo. Verification: live click-walk of all 12 steps.
- **0b. Demo-data pass** on the capture site (pick ONE: forge-and-bell has the
  richest operational data) — believable bookings/revenue/members/leads.
- **0c. Peter:** Supademo workspace branding; note trial expiry; keep the
  Chrome extension installed.

### Phase A — pilot tour, proves the whole pipeline (1 demo)
"**Meet your Stemfra dashboard**" (first-login tour). Script it with the
Step/Action/Why template (research: claude-saas-demos/notes.md) against the
tour spec; **aha at step 3 = Stacy applying a real edit from chat**. Pipeline:
Playwright screenshot script (checked into stemfra_server/scripts or scratch)
→ upload portal (Peter drags, ~1 min) → MCP assemble + hotspots + voiceover
(top Mark-voice candidate) → publish → **verify by walking the published demo
in the browser** → Peter review (voice + pacing + copy). Deliverables: the
live demo link + embed code + the reusable capture script + a documented
15-minute re-capture ("demo rot") procedure.

### Phase B — the Stacy hero demo (marketing centerpiece)
An owner does everything by chatting: rewrite headline → draft About → update
contact details (the 0a action) → hide a section → publish. **HTML-replica
capture via the Chrome extension (Peter, ~10 min, second take is fine)**, then
MCP polish (trim to ≤12 steps, hotspot rewrite, voiceover). Double duty:
(a) embedded below the hero on stemfra.com, (b) screen-recorded as VSL footage.

### Phase C — tenant walkthrough library + distribution
One tour per CMS surface, priority order: bookings calendar · services & prices
· memberships/Renewals (confirm-collected!) · leads inbox · publish/domain ·
reports. Each: Playwright capture → MCP assemble (the Phase-A machinery makes
this ~1 session for several tours). Distribution: embed in the matching Help
Center article; link from Stacy's onboarding steps ("want me to show you?");
a **Demo Hub per vertical** for outreach (upgrade Mark's `{{demo_link}}` to an
interactive demo link). Consider a **Form chapter** (lead capture) at the end
of outreach-facing demos.

### Phase D — native in-CMS guided tours
driver.js (~5KB MIT) spotlight engine in stemfra_cms; tours as data
(`lib/tours.ts`: id, steps[{selector, title, body, route}]); triggers:
first-login, Stacy ("show me around"), a Help entry. Voice-per-step ("Mark"
clips, mutable) = D2, only after the silent version proves itself. Reuses the
15-18-word copy from Phase C scripts.

### Phase E — VSL + short ads (LAST, per the original sequencing)
- **VSL** (3-6 min, stemfra.com + funnel + email): hook (audience-qualifier
  naming all 6 verticals) → problem (no-shows, no front desk, ugly site, fee
  stacking) → solution reveal ≤90s in (the Stacy hero footage) → proof (demo
  sites, real screenshots w/ real numbers) → offer (free website, flat 5%
  commission, no monthly fee — per the live pricing model) → CTA (start free /
  see a live demo). Structure is first-principles direct-response — flag to
  Peter: supply a real VSL reference if he wants one imitated.
- **Short ads** (30-45s, per-vertical cuts of ONE script): Mindbody pattern —
  1 feature + 1 real screenshot + 1 sentence ×3-4 + direct CTA. Footage from
  Phases B/C captures.

## 4. Out of scope (this arc)
- Voice cloning of a human (Mark stays a picked AI voice until Peter wants a
  clone); translations; Supademo Demo Agent/analytics automation; paid-ads
  buying/placement (we produce assets only); re-opening any P14 payment scope.

## 5. Maintenance (demo rot)
Every shipped tour lists its capture script + source site. After any CMS UI
change that touches a toured surface: re-run the script → replace media
(`replace_step_media`) or re-assemble → re-publish (same link). Budget: 15 min
per tour. A quarterly sweep re-walks every published demo.

## Build log

- 2026-08-06 — Plan authored (Fable). Research + MCP verification complete.
  SMS Task 9 shipped separately the same day. Phase 0 waiting on Peter's UI
  corrections; Phase A ready to start the moment 0 clears (or before it, if
  Peter wants the pilot on the current UI, accepting one early re-capture).


## Build log — Phase 0 pilot SHIPPED (2026-08-07)

**"Stemfra CMS in 30 seconds"** — demo id `cmsj17qj000k5rq20fo7y47gy`, published
public: https://app.supademo.com/demo/cmsj17qj000k5rq20fo7y47gy

Pipeline proven end to end in one sitting:
1. **Capture**: Playwright (server dep) against the live CMS at 1920x1080@2x,
   authenticated by injecting the browser session token into localStorage
   (`scratchpad capture_pilot.js` pattern; the demos-cms-login password file had
   gone stale, now updated). 7 frames: dashboard, pages, hero editor (deep-link
   `?section=hero`), live-preview drawer, click-to-edit chip (dismiss the promo
   popup inside the iframe first or it blocks hover), Stacy greeting, publish.
2. **Upload**: create_upload_job -> Peter dragged the 7 PNGs into the portal
   (requires HIS Supademo login; claude-in-chrome file_upload is the automated
   path when the extension is connected) -> get_upload_job -> CDN URLs.
3. **Assemble**: create_demo_from_uploaded_media (step texts) ->
   create_hotspots (violet #6366F1 tooltips, Pulse, action-framed labels) ->
   generate_voiceovers (Drew, 7 lines, ~46s total) ->
   update_demo_settings (autoplay + play bar + public) -> publish handled by
   creation; get_demo_embed_code.

Learnings for Phases A/B: results from get_upload_job come back in upload
order; hotspot coords are % of the image (read the frames back to place them);
per-frame narrative + one hotspot per step matches the tour spec cleanly.
