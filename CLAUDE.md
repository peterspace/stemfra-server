# Stemfra Server — Claude memory

**Last updated: 2026-06-07**

Node/Express backend serving CMS, Platform, CRM, n8n, and marketing-site concerns for the Stemfra platform. Companion file to `~/Documents/stemfra/stemfra_platform/CLAUDE.md` (the customer-facing monorepo) and `~/Documents/stemfra/stemfra-ops/CLAUDE.md` (the internal CRM). When working in `stemfra_server/`, this file is the source of truth.

If a new Claude Code session reads only one file before starting work here, this is it. Read top to bottom once, then refer back when needed.

## What this service is

One Node/Express process at `localhost:4000` that, today, handles five concerns side by side. The split is deliberate: ship one service until operational evidence justifies splitting (see section 9). Trying to architect microservices before there's any operational signal would burn weeks of plumbing time we don't have.

The five concerns:

1. **CMS endpoints** (`/api/cms/*`) — server-side counterpart to the customer CMS at `localhost:5180`. Today, just image upload + delete via Cloudinary. Future slices add content-section CRUD, services/team CRUD, booking calendar reads, etc.
2. **Platform booking endpoints** (`/api/site-forms/*`, `/api/site-bookings/*`) — public endpoints called by the customer-facing template sites at `localhost:5174-5177`. Lead form submission, availability calculation, booking writes. This is the Mode N native scheduler.
3. **CRM Twilio voice + SMS + presence** (`/api/twilio/*`, `/api/presence/*`) — the call/SMS rails for the internal CRM at `localhost:5173`. Includes a background presence sweeper that flips stale CRM users offline.
4. **n8n webhook bridge** (`/api/leadgen/*`, `/api/speed-to-lead/*`) — proxies CRM events into n8n workflows hosted on the same VPS, gated by a shared secret.
5. **Marketing-site contact + insights** (`/api/contact`, `/api/insights/*`) — the contact form on `stemfra.com` and CRUD for the public-facing Insights/blog content.

All Supabase writes use the service-role key (server-trusted, bypasses RLS). The browser-side apps each have their own anon-key clients for read-side queries.

## Local dev

```bash
cd ~/Documents/stemfra/stemfra_server
npm install
cp .env.example .env   # fill in real secrets locally
npm run dev            # nodemon, listens on :4000
```

Loads `.env` via `require('dotenv').config()` at the top of `index.js`. If you run individual modules with `node -r dotenv/config -e "..."` to typecheck them, you'll need the `-r dotenv/config` flag — the modules' strict env checks (`config/supabase.js` exits if `SUPABASE_URL` or `SUPABASE_SECRET_KEY` is missing) will hard-fail without it.

`/health` returns `200 OK` for liveness probes. Healthcheck for the CMS upload subsystem is `/api/cms/site-uploads/healthcheck` (returns whether Cloudinary env vars are loaded).

Peter previews the customer CMS in his own browser; this server backs that preview. When Peter has the CMS open, he often runs `stemfra_server` in his own terminal. **If port 4000 is already in use, don't start a second instance.** Edit files in place and let nodemon reload, then `curl` against the running instance.

## Environment variables

Full list lives in `.env.example` (committed as documentation only — never put real secrets there). Grouped by purpose:

**Server runtime**
- `NODE_ENV` (`production` in deploy; `development` locally)
- `PORT=4000`
- `CLIENT_URL` (dev origin for CORS; production frontends are hardcoded in `index.js`)
- `API_HOST` (used by Traefik labels in `docker-compose.yml`, not read by the app)
- `PUBLIC_BASE_URL` (the externally-reachable HTTPS base; required for Twilio webhook signing)

**Supabase**
- `SUPABASE_URL`
- `SUPABASE_SECRET_KEY` (the new `sb_secret_...` form; server-side; bypasses RLS)

The server uses the **service-role key only — no anon key is required**. The service-role client can introspect end-user JWTs via `supabase.auth.getUser(jwt)`, which is what `middleware/cmsAuth.js` does to authenticate CMS users without needing a second anon-keyed client.

**Email (Gmail SMTP via Nodemailer)**
- `GMAIL_USER`, `GMAIL_APP_PASSWORD` (App Password, NOT the account password)
- `NOTIFY_EMAIL` (where contact-form notifications land)
- `LOGO_URL` (optional — has a hardcoded fallback)

**Twilio**
- `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` (signature validation requires the auth token)
- `TWILIO_API_KEY_SID`, `TWILIO_API_KEY_SECRET` (Voice SDK token endpoint)
- `TWILIO_PHONE_NUMBER` (E.164)
- `TWILIO_TWIML_APP_SID` (the TwiML App whose Voice URL points at `/api/twilio/voice`)

**n8n bridge (lead-gen + speed-to-lead)**
- `N8N_LEADGEN_COLD_URL`, `N8N_LEADGEN_WARM_URL` (production webhook paths in n8n; `/webhook/...`, NOT `/webhook-test/...`)
- `N8N_SPEED_TO_LEAD_URL` (separate workflow; may be blank until the workflow is built — server returns 503 if unset)
- `N8N_WEBHOOK_SECRET` (sent as `x-leadgen-secret` header; n8n workflow verifies)

The n8n URLs use the **public hostname**, not loopback. `stemfra_server` and `n8n` run as sibling Docker containers; `127.0.0.1` from inside `stemfra_server` resolves to that container, not the VPS. See the [Docker container loopback gotcha](../docker_container_loopback_gotcha.md) memory.

**Cloudinary** (new in Slice 2c)
- `CLOUDINARY_CLOUD_NAME`
- `CLOUDINARY_API_KEY`
- `CLOUDINARY_API_SECRET`

All three are required. `config/cloudinary.js` logs a warning at boot if any are missing (`isCloudinaryConfigured()` returns false; healthcheck reflects this). For production, all three must be added to the GitHub Actions secrets and to the deploy workflow's `environment-variables` block (see section 10 — there's a current gap to close).

## CMS endpoints (under `/api/cms/*`)

Established in Slice 2c. All three endpoints live under `/api/cms/site-uploads/*` with handlers in `controllers/cms/uploadController.js` and the route file at `routes/cms/siteUploads.js`. The `/api/cms/*` prefix and `routes/cms/` + `controllers/cms/` directories are deliberate — they establish the seam for a future microservice split (see section 9).

**`GET /api/cms/site-uploads/healthcheck`** — `healthcheck` in `controllers/cms/uploadController.js`. Unauthenticated. Returns `{ ok: true, cloudinary_configured: <bool>, endpoint: "cms/site-uploads", version: "2c" }`. Does NOT call Cloudinary — only checks that the three env vars are present. Used by post-deploy verification and uptime monitors to catch "deploy forgot the secrets" failures.

**`POST /api/cms/site-uploads/upload`** — `uploadImage` in `controllers/cms/uploadController.js` (the function name is a Slice 2c legacy — it now handles images AND videos). Auth-gated by `requireCmsAuth`. Multipart form: field `siteId` (UUID), optional field `alt` (images only), file `image` (the field name is a transport label, not a content check). MIME-sniffs the file part and routes:

- **Image** (`image/jpeg|png|webp|gif`): `resource_type: 'image'`, transcoded to WebP via `format: 'webp'` + `quality: 'auto:good'`. 8 MB input cap (busboy hard limit 10 MB + handler check at 8 MB). DB row's `mime_type` normalized to `'image/webp'` (output, not input). Stored URL ends in `.webp`. Inputs 5–10× larger than outputs in practice.
- **Video** (`video/mp4` only in v1): `resource_type: 'video'`, no transform. 50 MB cap. DB row keeps `mime_type: 'video/mp4'`. Server does NOT enforce duration; client (`VideoUploadField`) shows a soft warning above 15 s with an "Upload anyway" option.
- Other MIMEs → 400.

**Cloudinary folder = `site.subdomain`** (Phase 2; e.g. `argyle-and-sons/{hash}`). Human-readable in the dashboard, easy bulk-delete per customer. `verifySiteOwnership` already returns the site row including subdomain — no extra DB read. Subdomain stability is guaranteed by the locked-down Settings UI; if subdomain changes ever become supported, this convention will need a migration step. **Pre-Phase-2 uploads** (`sites/{uuid}/{hash}`) coexist — their absolute Cloudinary URLs still resolve, no migration done.

On success: streams the file directly into `cloudinary.uploader.upload_stream` (never buffers in memory), then writes a `site_media` row with `storage_provider='cloudinary'`, `storage_key=result.public_id` (e.g. `argyle-and-sons/{hash}`), `original_url=result.secure_url`, and returns `{ mediaId, secure_url, public_id, width, height, bytes, format, mime_type, resource_type }`.

**`DELETE /api/cms/site-uploads/:mediaId`** — `deleteMedia` in `controllers/cms/uploadController.js`. Auth-gated. Looks up the `site_media` row, calls `verifySiteOwnership` against `media.site_id`, derives `resource_type` from the stored `mime_type` (videos require `resource_type: 'video'` for Cloudinary destroy), then calls `cloudinary.uploader.destroy(storage_key, { resource_type })` followed by the DB row delete. Best-effort on the Cloudinary side: if `destroy` throws, the row is still deleted (we don't want stuck rows blocking ongoing edits). Returns `{ ok: true }`.

**`GET /api/cms/site-uploads?siteId=<uuid>`** — `listMedia` in `controllers/cms/uploadController.js` (added 2026-06-16 for the CMS Media library). Auth + `verifySiteOwnership`. Returns the site's `site_media` rows newest-first, each with a best-effort **`referenced`** boolean ("In use" / "Unused"). `buildUsageHaystack` serializes everything that can point at an asset — `site_sections.content` + `site_services` + `site_team_members` + `site_testimonials` + `site_theme_settings` — into one string; an asset is `referenced` if its **id, original_url, OR storage_key** appears in it. Shape-agnostic on purpose (media ids live in many nested JSONB shapes); the storage_key/public_id match catches references that stored a transformed Cloudinary URL. Powers the Media library grid + the reuse asset-picker; deletes warn harder when `referenced`.

**Custom-domain connect (`/api/cms/site-domain`, added 2026-06-23)** — `controllers/cms/domainController.js` + `routes/cms/siteDomain.js`. Owner self-serve brand-domain connect from the CMS Settings → Domain card, all gated by `requireCmsAuth` + `verifySiteOwnership`:
- **`POST /`** `{ siteId, domain }` — `connect`. Mirrors the admin `setCustomDomain` Cloudflare logic (`attachCustomDomain` to the vertical's Pages project via `projectFor`; adds our CNAME only for `*.stemfra.com` hosts), writes `sites.custom_domain`, returns `{ domain, cnameTarget: "{project}.pages.dev", status }`.
- **`GET /?siteId=`** `status` — current `custom_domain` + live CF status.
- **`DELETE /`** `{ siteId }` — `disconnect` (detach + clear). The admin/CRM path (`controllers/admin/sitesController.js`) is intentionally NOT refactored — staff can still assign domains too; keep the two CF blocks in sync.

**Owner "+ New site" (`POST /api/cms/sites`, added 2026-06-23)** — `controllers/cms/sitesController.js` + `routes/cms/sites.js`, `requireCmsAuth`. Existing owner provisions an ADDITIONAL site (multi-site): `resolveContactId(jwt)` → insert a new `companies` row → `provisionSite({ vertical, companyId, ownerContactId, displayName, city })` (the proven seed-clone lib; rolls itself back on failure, and we delete the orphan company on its failure) → best-effort `attachSiteDomain` (site still provisions if CF is down). Returns `{ siteId, subdomain, previewUrl, status, domain }`. Mirrors `onboardCustomer` minus the auth-user/contact creation (the owner already exists).

**Site cloning + Starters (2026-07-01)** — full arc doc: `stemfra_platform/docs/CLONING_AND_STARTERS.md`. `lib/provisionSite.js` now exports **`cloneSite(sourceSiteId, …)`** (+ shared `cloneContent`) — clones ANY site EXACTLY, including `site_theme_settings` + the source's exact `template_id` (the `cloneThemeSettings` flag is what distinguishes it from `provisionSite`, which skips theme_settings so a fresh customer gets clean template defaults). Rolls back on failure; copies design+catalog+content, NOT bookings/leads/customers/billing. Four callers, one core: (1) **owner** `POST /api/cms/sites/clone` (`cloneOwnSite`, ownership-checked, writes a `site_cloned` audit); (2) **admin** `POST /api/admin/sites/:id/clone` (`cloneAdmin`, `PLATFORM_OPS`, new account via `onboardCustomer` `cloneSourceId` → temp password); (3) **Starters** — `lib/starters.js` (`metadata.is_starter` whitelist), `GET /api/starters[?vertical=]` (public catalog), `onboardCustomer({ starterId })` clones an approved Starter (starterId = subdomain OR id); the 4 fixtures + 9 demo sites are flagged Starters; (4) **Stacy S3** — `assistantController.send` relays a whitelisted `{type:'clone'}` action (confirm-before-act; the CMS card runs the owner clone endpoint). `normalizeAction` guards the action; `onboardCustomer` gained `starterId` (public, whitelisted) + `cloneSourceId` (staff, any site).

**Stacy CMS copilot (`/api/cms/assistant`, added 2026-06-24)** — `controllers/cms/assistantController.js` + `routes/cms/assistant.js`, `requireCmsAuth` + `verifySiteOwnership`. The CMS chat panel (Agent 5). `POST /init` (start a conversation row), `POST /send` (build site context via `lib/stacyContext.js` `buildSiteContext` + last-~12 history → POST to `STACY_N8N_URL` with `x-leadgen-secret` → persist messages → return `{reply, handoff}`; also auto-titles the conversation from the first user message), `GET /list` + `GET /:id` + **`PATCH /:id`** (rename {title}). Conversations in the additive **`agent_conversations`** table (RLS staff/service-role only). n8n side runs a **native AI Agent node + lmChatOpenAi (GPT-4o)**; iterate the prompt by pasting `~/Documents/stemfra/n8n-workflows/stacy-build-prompt-S2.js` into the workflow's Build Prompt node (no re-import). Env: `STACY_N8N_URL` + `STACY_MODEL`. Onboarding checklist (2026-06-24): `lib/stacyOnboarding.js` + `GET/POST /api/cms/assistant/onboarding` — a 10-step setup checklist (fill steps auto-detected from data, personalize steps owner-marked), progress in `site_theme_settings.metadata.onboarding` (select-then-update/insert, no upsert). S1 (answer) + S2 (draft copy) done; **S3 (act) = site CLONE (2026-07-01, verified live)** — `send` relays a whitelisted `{type:'clone',businessName?}` action (prompt: `stacy-build-prompt-S3.js` + `stacy-parse-S3.js` — the Parse node must carry `action` through); the CMS confirm card runs the owner clone endpoint. Stacy's first mutating tool (confirm-before-act). Handoff is REAL (2026-06-24): `notifyHandoff` writes a `site_activity` audit row (`stacy_handoff_requested`) + a best-effort staff email to `NOTIFY_EMAIL`/`GMAIL_USER` (fire-and-forget; email needs `GMAIL_APP_PASSWORD`). Full picture in the platform CLAUDE.md "Stacy" entry.

**Front Desk chat (`/api/site-chat`, Agent 2, added 2026-06-24)** — `controllers/siteChatController.js` + `routes/siteChat.js`. **PUBLIC** (no owner auth) — called by the chat widget on a client's template site. `POST /send {siteId, conversationId?, message}`: validate site live/previewing + `site_theme_settings.metadata.frontdesk_enabled === true`; **reuses `lib/stacyContext.js` `buildSiteContext`**; proxy to `FRONTDESK_N8N_URL` (x-leadgen-secret); persist to `agent_conversations` (`agent='frontdesk'`, `created_by=null`). Per-IP+site **in-memory rate limit** (20/min — protects the public endpoint + LLM cost; per-instance). Env: `FRONTDESK_N8N_URL`, `FRONTDESK_MODEL`. Response contract: `{reply, handoff, lead}`. **F1 = answer** (grounded from site context). **F2 = capture lead (done 2026-06-24)**: when the n8n response carries a `lead` object (visitor left name + email/phone), `captureLead()` writes a `site_leads` row — `source_page='Chat assistant'`, `metadata={source:'website_chat', conversation_id, captured_by:'frontdesk', intent}` (the table has NO `source` column; use `source_page`/`metadata`). Idempotent per conversation (dedup by `metadata->>conversation_id` → UPDATE not INSERT). Best-effort owner email, gated to `status='live'`. Leads surface in the CMS Leads inbox. **F3 = book in-chat (done 2026-06-24)**: response contract now `{reply, handoff, lead, booking}`. The agent emits a `booking` object; `send()` runs a **server-orchestrated tool loop** — `lib/frontdeskBooking.js` `runBookingTool()` resolves service/barber/date against real data and returns a `note`; if a note results, `send()` re-invokes the workflow ONCE with `context.booking_system_note` so the agent's reply is grounded in real availability / a real confirmation (max 1 extra round-trip; never invents times). **FREE services book in chat** (confirm step required: `booking.confirm===true` only after the visitor approves a summary); **PRICED services hand off** to the booking page (no card payment in chat). Booking logic is **shared, not duplicated**: `bookingController.js` exports cores `computeAvailability` + `placeBooking` (`allowedStatuses` param — public handlers pass `['live']`, the chat tool passes `['live','previewing']` so it's testable on preview sites). `context` also carries `today` (site-zone date) for relative-date resolution. n8n node scripts (repaste both): `n8n-workflows/frontdesk-build-prompt.js` (Build Prompt — emits `booking`, consumes `today`+`booking_system_note`) + `n8n-workflows/frontdesk-parse.js` (Parse — passes `lead`+`booking`). Widget got a `previewing` prop (lifts above the PreviewRibbon). **Phase 1 structured interaction layer (Mindbody-parity, done 2026-06-24)**: response is now `{reply, conversationId, card, quick_replies}`. `runBookingTool` returns `{note, card, quickReplies}` — real time slots as tappable **chips**, plus structured **cards**: `booking_confirm` (service/staff/date/time/total + Confirm/Not now action buttons), `booking_done`, `handoff_booking` (Open booking page → /book). Server injects exact time chips (overriding the agent's); the agent also emits general `quick_replies` (Yes/No, menus) via the n8n Parse passthrough + Build Prompt persona/handoff. Widget renders chips (last msg only) + `BookingCard`. Blueprint: `stemfra_platform/docs/STACY.md`.

**Payments (`/api/cms/payments`, `controllers/cms/paymentsController.js`)** — Stripe Connect (Express). `POST /connect-link` (create/reuse Express account + onboarding link), `GET /status?siteId=` (refresh capabilities from Stripe; also returns `account.livemode` for the CMS "Test mode" badge), `POST /dashboard-link` (added 2026-06-23 — `stripe.accounts.createLoginLink` → Express dashboard, for the CMS "Manage in Stripe" link), `GET /healthcheck`.

## CMS auth middleware

`middleware/cmsAuth.js`. Exports three helpers used by the upload routes (and intended for every future CMS endpoint):

- **`requireCmsAuth(req, res, next)`** — Express middleware. Reads `Authorization: Bearer <jwt>`, calls `supabase.auth.getUser(token)` to validate, and attaches `req.cmsUser = { id, email }` on success. Returns 401 on missing/invalid token.
- **`verifySiteOwnership(authUserId, siteId)`** — Returns the `sites` row if the auth user owns it (via `sites.owner_contact_id → contacts.auth_user_id`), or `null` if not. Every CMS endpoint that takes a `siteId` MUST call this before doing any write.
- **`resolveContactId(authUserId)`** — Looks up the `contacts.id` for the auth user. Used when stamping `uploaded_by` on `site_media` rows.

All three use the service-role client imported from `config/supabase.js`. There is no second anon-keyed client — the service-role client introspects user JWTs via `supabase.auth.getUser()` directly, which is supported and the convention here.

## Platform booking endpoints

These are the public-facing endpoints called by the customer template sites. All five live under `/api/site-forms/*` and `/api/site-bookings/*`. The expensive booking-engine logic lives in `controllers/bookingController.js`.

- **`POST /api/site-forms/lead`** — `submitSiteLead` in `controllers/siteFormController.js`. Contact-form submission. Validates the target site is `status='live'`, writes a `site_leads` row, emails the owner via Nodemailer/Gmail. Email failure does NOT fail the request (best-effort).
- **`GET /api/site-bookings/availability`** — `getAvailability` in `controllers/bookingController.js`. Returns a 15-minute availability grid for `(siteId, teamMemberId, serviceId, date)`. Filters past dates, applies the team member's `site_availability` rules, subtracts existing bookings, enforces back-to-back-is-not-overlap.
- **`GET /api/site-bookings/month`** — `getMonthAvailability`. Month-level availability for the calendar widget. Same engine logic, run per day.
- **`POST /api/site-bookings`** — `createBooking`. Single-service booking write. Re-checks the requested slot against the engine, upserts the customer record, writes the `site_bookings` row, sends confirmation email.
- **`POST /api/site-bookings/group`** — `createBookingGroup`. Multi-service basket write (salons template only). Does a self-conflict pre-check on the basket, per-item DB re-check, then partial-success semantics: creates a `site_booking_groups` row only if at least one child succeeds; successful children get a `group_id`; failed children are returned for re-pick. One summary email per group.

CORS for these endpoints is hardcoded in `index.js` to explicitly list each dev port (5174 barbers, 5175 salons, 5176 crossfit, 5177 yoga) plus the production marketing/CRM/CMS origins. Production CORS is currently static — a known deferred item.

## CRM Twilio / presence / leadgen

These are CRM-side concerns called by `stemfra-ops` (the internal CRM at `localhost:5173`).

**`routes/twilio.js`** — voice + SMS + recording webhooks. Mounted at `/api/twilio/*`. The 12 endpoints:

| Method | Path | Purpose |
|---|---|---|
| POST | `/token` | Voice SDK access token for the CRM browser |
| POST | `/sms/send` | Outbound SMS |
| POST | `/sms-status` | Twilio status callback (delivered/failed) |
| POST | `/sms-inbound` | Twilio inbound SMS webhook |
| POST | `/voice` | Outbound voice TwiML (`<Number url>` whisper for [disclosure leg](../twilio_disclosure_legs_gotcha.md)) |
| POST | `/recording-disclosure` | The whisper TwiML target |
| POST | `/voice-status` | Twilio voice status callback |
| POST | `/recording-status` | Twilio recording status callback |
| POST | `/inbound-voice` | Twilio inbound voice webhook (top-level `<Say>` disclosure) |
| POST | `/inbound-dial-result` | Inbound `<Dial>` result handling |
| POST | `/voicemail-complete` | Voicemail recording complete |
| GET | `/recording/:callId` | Signed recording URL fetch |

Activity-feed inserts use a `logActivity({ action, entityType, entityId, actorId, actorName, entityName, details })` helper defined inline in `routes/twilio.js` (~line 103). It writes to the same `crm_activity_log` table the ops CRM's own `logActivity` helper writes to. If/when a second route file needs to log activity, lift this helper into `lib/activity.js` rather than duplicating it.

**`routes/presence.js`** — CRM user online/offline tracking. `POST /api/presence/heartbeat`, `POST /api/presence/offline`. Plus `startStalePresenceSweeper({ intervalMs: 60_000, staleMs: 150_000 })` — a `setInterval` background task started from `index.js` after `app.listen` succeeds. Every 60 seconds it flips any CRM users whose last heartbeat is older than 150 seconds to offline. The 150s threshold gives 5 missed heartbeats of slack to account for browser throttling of `setInterval` in hidden tabs.

**`routes/leadgen.js`** — `POST /api/leadgen/trigger` proxies CRM lead-gen requests to the n8n workflows at `N8N_LEADGEN_COLD_URL` or `N8N_LEADGEN_WARM_URL`. Sends `x-leadgen-secret: ${N8N_WEBHOOK_SECRET}` — the n8n workflow verifies before doing anything. Returns 503 if the corresponding URL env var is unset. See the [Lead-Gen module architecture](../leadgen_module_architecture.md) memory for the full CRM ↔ stemfra-server ↔ n8n flow.

**`routes/speedToLead.js`** — `POST /api/speed-to-lead/engage`. Same pattern as leadgen, separate n8n workflow; the trigger logs the arrival and flips status either way, and the CRM's escalation scan is the backstop.

**Marketing site adjacent (not CRM but bundled here):**
- `routes/contact.js` — `POST /api/contact` (marketing site form), `GET /api/contact` (admin list).
- `routes/insights.js` — CRUD for the `/blog`/Insights public content. GET/list, GET/:slug, POST, PATCH/:slug, DELETE/:slug.
- `routes/userSettings.js` — `GET`, `PATCH /api/user-settings`. CRM user prefs.
- `routes/devPreview.js` — dev-only email template previews under `/dev/preview`, gated by `NODE_ENV !== 'production'`.

## Future architecture: planned CMS service split

All CMS endpoints live under `/api/cms/*` and CMS-only code is isolated under `routes/cms/` + `controllers/cms/`. `middleware/cmsAuth.js` is also CMS-only. This isolation is intentional: it establishes a clean seam so that, when the moment is right, the CMS becomes its own service without a refactor.

**Triggers for the split — split when any 2 of these are true, not before:**

1. CMS endpoints reach 15+ routes (currently 4: upload, delete, list, healthcheck).
2. A real bug in CRM/Twilio code actually breaks a CMS endpoint (or vice versa).
3. CMS and CRM/Platform need genuinely different scaling profiles (e.g. CMS is bursty around customer site launches; CRM/Twilio is steady).
4. A team member (or contractor) needs to work on CMS without touching CRM code.
5. The combined deploy pipeline becomes a bottleneck — e.g. CMS hotfixes blocked behind unrelated Twilio rollouts.

**Split mechanics (when triggered):**

- Move `routes/cms/`, `controllers/cms/`, `middleware/cmsAuth.js` into a new repo (e.g. `stemfra_cms_server`).
- Both services share the same Supabase project (`acxepovfklgthxmteqxr`) — no schema migration required.
- Both services use the same Cloudinary credentials (same `cloud_name`, separate API keys per service for revocation).
- CORS on the new CMS service includes only the CMS frontend origin (`http://localhost:5180` in dev, the production CMS host).
- The CMS frontend changes its `SERVER_BASE` constant (currently in `lib/useUpload.ts` and `lib/useDeleteMedia.ts`) to point at the new host. Nothing else changes in the customer-facing CMS code.

This is deliberate deferral — split when there is operational evidence justifying it, not before.

## Production deploy

GitHub Actions workflow at `.github/workflows/deploy.yml` redeploys the Docker Compose stack on the Hostinger VPS on every push to `main`. The workflow uses `hostinger/deploy-on-vps@v2`, which calls Hostinger's internal API to redeploy the matching Docker Manager Compose project.

The workflow's `environment-variables` block is the **single source of truth** for production env. Hostinger's deploy action REPLACES (not merges) the project's Environment panel — any var omitted from this block gets wiped on deploy. `.env.example` is local-dev documentation only.

Required GitHub Actions secrets (set in repo Settings → Secrets and variables → Actions):
- `HOSTINGER_API_KEY` (and `HOSTINGER_VM_ID` variable)
- `SUPABASE_SECRET_KEY`
- `GMAIL_APP_PASSWORD`
- All six `TWILIO_*` secrets
- `N8N_WEBHOOK_SECRET`, `N8N_SPEED_TO_LEAD_URL`
- **`CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`** — added in Slice 2c

**⚠ Known gap (flagged 2026-06-07, deploy.yml inspection):** The current `deploy.yml`'s `environment-variables` block does NOT include the three `CLOUDINARY_*` vars. Until those three lines are added, the next production deploy will wipe Cloudinary env on the VPS and break uploads (the healthcheck will report `cloudinary_configured: false`). Adding them is a one-line-per-var change.

Post-deploy verification:

```bash
curl https://api.stemfra.com/api/cms/site-uploads/healthcheck
```

Should return `{"ok":true,"cloudinary_configured":true,"endpoint":"cms/site-uploads","version":"2c"}`. If `cloudinary_configured` is `false`, the deploy workflow's `environment-variables` block is missing the Cloudinary vars (most likely cause) or the GitHub Secrets aren't set.

The VPS is on Hostinger and has had [recurring edge outages](../hostinger_vps_edge_outages.md) — Cloudflare proxy mitigation is already in place. Standard diagnostic ladder via Hostinger's browser console.

## Working conventions

These are mandatory unless explicitly overridden.

- **Supabase import is single-var, not destructured.** `config/supabase.js` exports the client directly (`module.exports = supabase`), so the convention across every controller/route is `const supabase = require('../config/supabase')`. The destructured form `const { supabase } = require(...)` would yield `undefined` and break every call. New files (including `middleware/cmsAuth.js` and `controllers/cms/uploadController.js`) follow the same convention with an inline comment explaining the choice.
- **Ownership checks via `verifySiteOwnership` for every endpoint that takes a `siteId`.** The auth middleware proves the JWT belongs to a real user. `verifySiteOwnership` proves that user owns the target site. Both are required for any write; uploadController calls them in the right order. New CMS endpoints in future slices should follow this pattern verbatim.
- **CMS endpoints isolated under `routes/cms/` + `controllers/cms/`.** Every future CMS route belongs there, not in the top-level `routes/`. This isolation is what makes the section-9 split a config change rather than a refactor.
- **Activity logs via the existing `logActivity` helper.** Today the helper is defined inline at the top of `routes/twilio.js` (~line 103). When a second route file needs to log activity, lift it into a shared `lib/activity.js` and re-import from both — don't duplicate.
- **Email is best-effort.** Confirmation, notification, and alert emails go through Nodemailer/Gmail with an App Password. Email failures are logged but never fail the originating request.
- **Twilio webhook signatures.** Inbound webhooks from Twilio are signed; `TWILIO_AUTH_TOKEN` is required for signature validation. `PUBLIC_BASE_URL` is required to reconstruct the URL Twilio signed against. Both must match production for signatures to verify.
- **n8n webhook URLs use the public hostname**, not loopback. See the [Docker container loopback gotcha](../docker_container_loopback_gotcha.md) memory.
- **Twilio disclosure-leg whispers.** Outbound calls use `<Number url>` whisper TwiML; inbound calls use top-level `<Say>`. Don't mix these up — spec drafts have gotten this wrong twice. See the [Twilio disclosure leg gotcha](../twilio_disclosure_legs_gotcha.md) memory.
- **Don't kill or restart this server if port 4000 is already in use.** Peter often runs it in his own terminal while a Claude session is editing files. Edit in place, let nodemon reload, then `curl` against the running instance.
