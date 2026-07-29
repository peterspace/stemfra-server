# P12 — Payments Pivot + Acquisition Funnel (agreed plan)

_Agreed 2026-07-22 (Peter + Claude, full discussion in-session). This is the
system-of-record for the P12 arc: the Stripe direct-keys pivot, the
VSL→setup-call→pay-and-publish funnel, owner SMS alerts, voice-agent
enhancements, and sequencing. Inputs: the Kai Stone interview
(`stemfra_video/mwMQLJ5GoRM/notes.md` → `docs/SALES_SCRIPT_TEMPLATES.md`),
Peter's Gemini research chat, and the existing System A/B billing docs
(`docs/BILLING_AND_PAYMENTS.md`)._

**Peter's decisions (2026-07-22):**
1. **Pivot confirmed** — tenant payments via each business's own Stripe keys
   (direct), Connect code kept dormant.
2. **VSL** — Peter's voice over a screen-share of a demo site — **scheduled
   LAST** in the arc, not first.
3. **Blog** — Stemfra marketing blog (Insights cadence) deferred; **tenant
   blogs completeness is the priority** (currently on Massage + Spa themes
   only — verify and complete whatever is pending there first).
4. **A2P/SMS** — one Stemfra Twilio number (never Peter's personal number).
   **Scope simplification:** NO tenant→end-customer SMS program. End customers
   get email confirmations only (as today). The SMS goes to the **business
   owner + assigned team member (if applicable)** carrying the captured
   lead/booking details INCLUDING the customer's phone number, so the owner
   follows up personally. One brand, one campaign, one program.
5. **Wave order** — as recommended below; payments pivot moves AHEAD of Voice
   Phase 3 (resequencing P11).

---

## 1. Payments pivot — direct Stripe keys per tenant

**Why (the real argument):** Stemfra's own Stripe account is still pending
verification; with direct keys, tenant payments stop depending on it entirely.
Each client's payments run on THEIR Stripe account. Deposits-at-booking (the
no-show killer, our biggest pitch feature) becomes shippable now. Marketing
frame: "we never touch your money — it goes straight to your bank" (true
differentiator vs Wix/Squarespace; Stemfra's revenue is the subscription,
never a payment rake, so losing Connect application fees costs nothing).

**Design (corrections to the Gemini advice baked in):**

1. **Restricted keys, not full secret keys.** During the done-for-you setup
   call, guide the owner to create a Stripe *restricted* key (`rk_live_…`)
   with only: Checkout Sessions (write), PaymentIntents (write), Refunds
   (write), Customers (write if memberships need it). Never accept/store a
   full `sk_live_` when a restricted key will do.
2. **Storage:** new `site_payment_credentials` table —
   `site_id · provider ('stripe' now, 'square' later) · encrypted_credentials
   (AES-256-GCM; key-encryption-key lives ONLY in server env) · webhook_secret
   (encrypted) · status · created/updated`. Decrypt in memory at call time;
   never log; never ship to any client app.
3. **`getStripeForSite(siteId)`** helper replaces the global key in the
   existing controllers (`sitePaymentsController`, `siteMembersController`,
   `siteMembershipsController`, `bookingController` payment hooks,
   `cms/refundsController`). Most existing booking/membership/refund logic
   survives — this is a re-plumb, not a rewrite.
4. **Redirect-verify is the source of truth, webhooks are belt-and-braces.**
   Checkout success URL carries the session id → server retrieves the session
   with the tenant's key → then mark booking paid. Per-tenant webhooks are
   added to each client's Stripe dashboard during onboarding (endpoint
   `/api/stripe/webhook/:siteId`, verified with that site's stored signing
   secret) to catch abandoned-tab cases.
5. **Connect code stays dormant, not deleted.** When Stemfra's Stripe
   verifies, "Stemfra Payments" (Connect-managed for owners without their own
   Stripe) can return as a convenience option.
6. **Onboarding capture:** key entry lives in CMS payment settings + is done
   WITH the client on the setup call (done-for-you). Publishable key is
   fine in plaintext; secret/restricted key + webhook secret encrypted.

## 2. Processor roadmap

- **Stripe** — active core; the only adapter built now.
- **Square** — supported *on first real demand* (a signed client who insists
  on keeping Square). Shape for it today: `provider` column + a small adapter
  interface (`createCheckout / verifyPayment / refund`) mirroring System A's
  billing-provider pattern. No speculative build.
- **Helcim / GoCardless / Clover / Adyen** — market intelligence only.
  GoCardless gets a future trigger: revisit when membership-heavy fitness
  clients report card-expiry churn (bank debit rarely expires).
- **Mindbody/Vagaro/Boulevard — hard line, no API integration.** Formalize the
  escape hatch as product: per-site **external booking URL** option — Book-Now
  buttons become external links; the Front Desk chatbot *deflects* ("here's
  the booking link") instead of booking natively. Sells SEO sites to
  Mindbody die-hards today; native migration later. (Check `booking_mode` /
  `booking_config` for existing support before building.)

## 3. The acquisition funnel (from the Kai Stone playbook)

Items #1/#2/#3/#5 of Peter's list are ONE funnel, matching decisions already
made (free preview → pay-to-publish; high-touch onboarding). The human moment
(the setup call) is deliberately placed before money changes hands — small
businesses want to talk to someone before handing over a card.

```
VSL → book the 45-min setup call → build together on the call
    → pay-and-publish email → site live (+ custom domain)
```

- **VSL** (LAST in sequence, per decision #2): Peter's voice over a
  screen-share of a demo site; polish < authenticity. Script:
  `docs/SALES_SCRIPT_TEMPLATES.md` §1. Host on Cloudinary `stemfra_assets`;
  landing page; `{{vsl_link}}` variable in the Template Manager; wired into
  A-series outreach + Mark's call flow ("I'll text you a 3-minute video");
  click-tracked via a server redirect (`/t/:leadId/vsl` → 302 + activity log)
  so the CRM shows who watched before a call.
- **Setup-call booking — dogfood our own product.** Provision the internal
  Stemfra tenant with one service ("Website setup call — 45 min", staff =
  Peter). Onboarding flow + VSL email link to it. The existing
  booking-reminder sweeper then sends no-show-prevention reminders for free
  (a setup call is just a `site_booking` on our own site). The prospect
  *experiences* the booking flow they're about to buy.
- **Pay-and-publish**: `publish_on_payment` flag; email (chocolate template,
  "Pay & publish" → Payoneer request link today, Stripe checkout when
  Stemfra's account verifies). Trigger: when the site's initial
  `billing_charges` charge → `paid` AND the publish checklist passes →
  auto-publish + kick off the custom-domain step (Porkbun; P10 #43 CF-zone
  plan). Provider-agnostic because it triggers off the ledger — upgrades
  itself when Stripe lands.
- **Switchers** ("my provider never updates my site"): "Switching?" marketing
  angle; strengthen outreach template A13 with the rebuild-similar promise
  (mirror-reference-markup is already our internal build convention); switcher
  tag in CRM + Mark's qualification schema (already asks about current
  website/booking tooling).

## 4. SMS alerts — one program only (Peter's model)

**The program:** Stemfra → business owners (+ assigned team member when a
booking has one and their phone is on file). Fired on: new lead, new booking.
Content: customer name, phone number, service, time — "contact them now."
End customers continue to receive email confirmations only; no automated SMS
to end customers (parked indefinitely; if ever revisited it is a separate
campaign class — never piggyback it on this one).

**A2P 10DLC:** one brand (STEMFRA LLC, EIN on file), one campaign
(Low-Volume Mixed / account notifications), sent from Stemfra's Twilio
number(s) — never a personal number. Registration is a **Peter console
action** with lead time — start first. All form answers pre-prepared in
`docs/A2P_REGISTRATION.md`. Registering the brand also legitimizes the SMS we
ALREADY send (missed-call follow-ups from the voice number, transfer alerts).

**Build (after approval):** `lib/notifySms.js` helper (best-effort, logged);
owner phone + `sms_alerts_enabled` per site (CMS toggle + signup consent);
staff-member phone optional on `site_team_members`; hooks in the existing
lead/booking notification paths next to the emails; STOP/HELP handling
(Twilio Advanced Opt-Out or inbound webhook → flag off).

## 5. Voice agent — Phase 1.5 + resequencing

- **Phase 1.5 (small, Wave 1):** (a) CRM "Call with AI" opens a modal with an
  optional **"Reason for this call"** → passed through `leadgenCall` →
  prepended to Mark's context as `REASON FOR THIS CALL (from staff): …`.
  (b) `buildLeadContext` enriched with the lead's history: recent
  `activity_feed` entries — **Phase 0 already persists call transcripts +
  dispositions there**, so Mark genuinely remembers prior calls — plus the
  outreach email thread and recent notes, compacted (~1.5–2K tokens). Context
  is assembled before the call is placed; zero latency cost.
- **Resequencing:** Voice **Phase 3 (tenant voice) now comes AFTER P12 Waves
  1–2** (payments + funnel first — revenue feature beats differentiator).
  Phase 3's scope now explicitly includes **browser-voice** (see §6 tier B).
  Phase 4 unchanged, after Phase 3.

## 6. Stacy call icon

**No dedicated Twilio number is required.**
- **Tier A (Wave 1, near-zero):** "Prefer to talk?" element in the Stacy panel
  showing the existing Stemfra voice number. Phase 2 already identifies owners
  by caller ID, greets by name, gives account context, and can reset
  passwords / open tickets.
- **Tier B (inside Voice Phase 3):** in-browser call button — Twilio Voice JS
  SDK in the CMS → TwiML App → the SAME ConversationRelay brain. Identity
  from the CMS login (stronger than caller ID) → full Stacy-grade context.
  Token endpoint already exists (`/api/twilio/token`). Building B is building
  a slice of Phase 3's per-tenant relay routing.
- **Tier C (Phases 3/4):** full "Stacy speaks" with CMS action tools.

## 7. Blog

- **Tenant blogs — the priority.** Currently on **Massage + Spa themes only**
  (per Peter's recollection — verify at execution). Task: audit which themes
  render `site_posts`, complete anything pending on massage/spa, then decide
  rollout to other verticals. Future commercial angle (registered, not built):
  blog posts as an upsell ("4 vs 12 AI-drafted posts/mo", near-zero marginal
  cost) — design after Case 2 / pricing work.
- **Stemfra marketing blog** — already exists as **Insights** (full CRUD).
  Content cadence (1–2 SEO posts/week, Claude drafts + Peter reviews)
  **deferred** — start later; ties into the marketing SEO architecture arc.

---

## The waves (agreed order)

| Wave | Item | Size | Owner |
|---|---|---|---|
| **1** | Payments pivot build (schema+encryption → getStripeForSite → redirect-verify → CMS/onboarding capture → external-booking-URL option) | L | Claude |
| 1 | A2P brand+campaign registration (answers prepped in `A2P_REGISTRATION.md`) | S | **Peter** (lead time — start first) |
| 1 | Mark Phase 1.5: call-reason modal + history-enriched context | S | Claude |
| 1 | Stacy "Prefer to talk?" (tier A) | XS | Claude |
| **2** | Setup-call booking on internal Stemfra site + onboarding/VSL-email CTAs (reminders free via existing sweeper) | M | Claude |
| 2 | Pay-and-publish automation (ledger-triggered publish + domain step) | M | Claude |
| 2 | Owner+staff SMS alerts build (once A2P approves) | S | Claude |
| 2 | **Case 2** tenant email redesign (pre-existing pending task) | M | Claude |
| 2 | Switcher messaging (marketing angle + A13 upgrade + CRM tag) | S | Claude |
| **3** | Tenant blog completeness (massage/spa finish + per-theme audit + rollout decision) | M | Claude |
| 3 | **Voice Phase 3** — tenant voice incl. browser-voice/Stacy tier B (spec first) | L | Claude |
| 3 | Square adapter (on first real demand) · GoCardless trigger noted | M | demand-driven |
| **4** | **Voice Phase 4** — analytics, DNC/TCPA, premium voice | M | Claude |
| **Last** | **VSL production** — Peter's voice over demo-site screen-share; Claude scripts/hosts/wires/tracks | S | **Peter** + Claude |

**Execution convention:** per the Advisor strategy
(`~/Documents/stemfra/docs/ADVISOR_STRATEGY.md`), execution sessions run on
**Sonnet 5 or Opus 4.8** as executor; planning/architecture escalations via
`/advisor` (Fable). This plan was drawn up on Fable 5.

---

## Build log

### 2026-07-22 — Wave 1 Task 1 DONE: schema + encryption layer
- **`site_payment_credentials`** table created (migration
  `create_site_payment_credentials`, project acxepovfklgthxmteqxr). Columns:
  site_id → sites (ON DELETE CASCADE) · provider · publishable_key (plaintext) ·
  encrypted_credentials · encrypted_webhook_secret · key_type · status ·
  last_verified_at · timestamps. UNIQUE(site_id, provider). **RLS on, 0 policies**
  (service-role only).
- **`lib/paymentCredentials.js`** — AES-256-GCM encrypt/decrypt (`v1:iv:tag:ct`
  blobs), `saveSiteCredentials`, `setSiteWebhookSecret`, `getSiteCredentials`,
  **`getStripeForSite(siteId)`** (ready tenant Stripe client), `isConfigured`.
- **`PAYMENT_CREDENTIALS_KEK`** env var added to `.env.example` (+ a local dev
  KEK generated into `.env`). 32 bytes, hex-64 or base64.
- Verified (10/10): encrypt round-trip, plaintext never in blob, GCM tamper
  rejection, live DB save/get/webhook round-trip, getStripeForSite builds a
  client, DB column confirmed ciphertext-only, cleanup.

> ⚠️ **KEK is PERMANENT once secrets are stored.** Rotating or losing
> `PAYMENT_CREDENTIALS_KEK` makes every stored tenant key undecryptable (they'd
> have to re-enter keys). Generate ONE prod KEK, store it in the GitHub Actions
> secrets + the deploy workflow `environment-variables` block, and never change
> it. Key rotation, if ever needed, requires a decrypt-with-old / re-encrypt-with-new
> migration pass (add a `v2:` blob version then) — not a bare env swap.
>
> **Peter actions:** (1) `openssl rand -hex 32` → add as GitHub secret
> `PAYMENT_CREDENTIALS_KEK` + the deploy.yml env block (prod value ≠ the local dev
> one). (2) A2P registration (Task 4) — see `A2P_REGISTRATION.md`.

### 2026-07-22 — Wave 1 Task 2 architecture (advisor-reviewed, Fable) — SCOPE RESHAPED
Consulted the Advisor before writing the re-plumb pattern. Decisions:

**Scope split CONFIRMED:** Task 2 pivots the ONE-TIME booking-charge path only
(the flagship deposit / no-show-killer). Recurring memberships + per-tenant
webhooks are a SEPARATE later task (memberships don't function today anyway —
they need Stemfra's unverified Connect account, so nothing is blocked by
deferring). Connect controllers stay dormant, not deleted.

**The real design change (bigger than "swap the client"): booking-row-FIRST.**
Hosted Checkout redirects the customer OFF our page, so the current
payment-first / booking-after flow (and its orphan-alert machinery) breaks.
Invert it:
1. `placeBooking` writes the row `payment_status='pending_payment'` (slot HELD).
2. Create Checkout Session (`metadata:{site_id,booking_id}`, `expires_at`~30min,
   `payment_method_types:['card']`), store `stripe_checkout_session_id` on the row,
   return `{ url, sessionId }` (NOT clientSecret) — both consumers change (public
   booking page + Front Desk in-chat pay card render a Checkout link/button).
3. Success handler: look up booking BY stored session id (never trust query
   string), retrieve session with `getStripeForSite`, require `payment_status==='paid'`,
   flip to paid. Idempotent.
4. **Reconciler sweeper** (pattern-match the billing cycle sweeper): every ~5min,
   pending bookings with a session id → retrieve with tenant key → paid⇒confirm
   (catches closed-tab), expired⇒cancel + release slot. THIS is belt-and-braces;
   webhooks add nothing for one-time payments.

**Redirect-verify + sweeper is sufficient for one-time charges — no per-tenant
webhooks in Task 2.** (Per-tenant webhooks earn their complexity only for
subscription lifecycle = the deferred membership task.)

**Must-touch items (easy to miss):**
- `computeAvailability` MUST count `pending_payment` rows as occupied (else
  double-booking during checkout); sweeper MUST expire them (else dead slots).
- `sitePaymentsController.config()` returns the PLATFORM publishable key → make
  per-site (or drop Stripe.js entirely with hosted Checkout).
- Readiness gate: replace `site_payment_accounts.charges_enabled` with a
  `resolvePaymentMode(siteId)` helper (direct active → else dormant Connect).
- `stripeWebhookController.js` LEFT UNTOUCHED — stays correct for System A + dormant Connect.

**⚠ Follow-up flagged (do NOT fix in Task 2, but required before real refunds):**
`cms/refundsController` still uses the platform `config/stripe` client — against a
tenant-account PaymentIntent it will **404**. The CMS refund button silently breaks
on direct-key payments until this is fixed (→ new task). Owner onboarding doc: the
restricted key needs Checkout Sessions write + PaymentIntents read + **Refunds write**.

### 2026-07-22 — Task 2 DB foundation DONE (booking-first schema)
Migration `booking_checkout_pending_columns` applied. Design confirmed against
the live schema:
- `site_bookings.status` has **NO check constraint** → new `'pending_payment'`
  status needs no constraint change, and BLOCKS availability automatically
  (both `computeAvailability` + `placeBooking`'s conflict re-check filter
  `status != 'cancelled'`). Expiry = flip status→'cancelled' to release the slot.
- `payment_status` already allows `'pending'` (existing CHECK) → no change.
- Added 2 columns: `stripe_checkout_session_id`, `checkout_expires_at` + a
  by-session index and a partial index (`WHERE status='pending_payment'`) for the
  sweeper. Verified present.

State machine: pending → `status='pending_payment'` / `payment_status='pending'`
(no emails fire); success → `status='confirmed'` / `payment_status='paid'` (emails
fire THEN); expiry → `status='cancelled'`.

NEXT (code): sitePaymentsController `createBookingIntent`→`createBookingCheckout`
(booking-first), bookingController pending-mode + finalize-on-payment path, a
success-verify handler + route, the reconciler sweeper (pattern-match
lib/billingCycleSweeper), then the two consumers (template booking page + Front
Desk pay card).

### 2026-07-22 — Task 2 SERVER build DONE + state machine verified
Booking-first hosted-Checkout flow on the business's OWN Stripe (getStripeForSite):
- `bookingController`: extracted `upsertBookingCustomer` + `sendBookingConfirmationEmails`
  helpers; added `placeBooking({pending:true})` (writes held row, no emails, no charge)
  + `finalizeBookingPayment({bookingId, amountCents})` (flip to confirmed+paid, emails
  once, idempotent, race-guarded on status='pending_payment'). Confirmed path unchanged.
- `sitePaymentsController`: `createBookingCheckout` (free→books direct; paid→fail-fast if
  no creds, else hold slot → Checkout Session card-only, 30-min expiry, metadata{site_id,
  booking_id} → store session id+expiry; on session-create failure release the hold),
  `verifyCheckoutSession` (look up by stored session id, retrieve with tenant key, finalize
  if paid — idempotent), HTTP: `startCheckout`/`checkoutReturn`(server success_url→verify→
  redirect to site)/`verifyCheckout`. success/cancel origins derived SERVER-SIDE (no open-redirect).
- Routes: POST `/checkout`, GET `/checkout/return`, POST `/checkout/verify`.
- `lib/bookingCheckoutSweeper.js` (every 5m, wired in index.js): paid-but-closed-tab→finalize,
  expired→release slot, Stripe-unreachable-past-expiry→release (never strand a slot).
- Legacy Connect (`createIntent`/destination-charge in placeBooking) kept DORMANT.

**Verified locally (6/6, no real Stripe needed for the state machine):** pending hold created
w/ no email · hold BLOCKS the slot (409) · finalize→confirmed+paid+amount · finalize idempotent ·
confirmed still blocks · sweeper cancels stranded expired hold. Plus: paid+no-creds→notReady with
NO slot held.

**Needs real Stripe test keys (Peter offered a separate account):** the Checkout Session create
+ verify-against-Stripe round-trip. **Remaining for Task 2:** two client consumers (template
booking page + Front Desk pay card, cross-repo stemfra_platform). Task 3 (CMS key capture) is the
natural next step — it also lets us store the test key to run the real Checkout round-trip.

### 2026-07-22 — Task 3 SERVER API DONE (key capture + external-URL escape hatch)
`controllers/cms/paymentsController.js` + `routes/cms/payments.js` (all requireCmsAuth
+ verifySiteOwnership):
- `POST /api/cms/payments/keys` {siteId, publishableKey, secretKey, webhookSecret?} —
  shape-validates (rk_/sk_ _live/test_; pk_ publishable), records key_type
  (restricted/standard), best-effort LIVE check that distinguishes an invalid key
  (reject) from a valid restricted key with limited read scope (accept), encrypts via
  saveSiteCredentials, stores webhook secret, sets sites.payments_enabled=true. Never
  returns the secret.
- `GET /api/cms/payments/keys?siteId=` — NON-secret status (masked publishable, keyType,
  status, hasWebhookSecret, lastVerifiedAt, livemode). Never decrypts the secret.
- `DELETE /api/cms/payments/keys` {siteId} — disconnect: remove creds + payments_enabled=false.
- `GET/POST /api/cms/payments/booking-mode` — the Mindbody/Vagaro escape hatch. Writes
  sites.booking_mode ('native'|'link_out') + booking_config.booking_url. The Front Desk
  chat ALREADY deflects to that URL when link_out (lib/frontdeskBooking.js) — this just
  lets the owner set it. link_out requires a valid https URL.

Verified: shape validation (accept rk_/sk_/pk_, reject junk + pk-as-secret), keyType
derivation, booking-mode round-trip meets the Front Desk deflection condition + restores.
Legacy Connect endpoints (connect-link/status/dashboard-link) kept dormant.

**REMAINING for Task 3: the CMS UI** (cross-repo stemfra_cms) — Settings → Payments:
"Connect your Stripe" key-capture form (with the restricted-key onboarding guidance),
status display, disconnect, + the "Use an external booking tool?" link-out field. Next.

### 2026-07-22 — Task 3 CMS UI DONE (typecheck clean)
`stemfra_cms` Settings → Payments (`components/settings/PaymentsSection.tsx` +
`lib/usePayments.ts`):
- **DirectStripeCard** (primary path): connected/not-connected status (masked
  publishable key, restricted✓/standard badge, test-mode pill, verified✓,
  webhook-set note); connect form with the "create a Restricted key with
  Checkout Sessions / Payment Intents / Refunds write" guidance + secret/
  publishable/webhook inputs (password fields, no autocomplete); Update keys +
  Disconnect (confirm dialog). Calls the Task-3 endpoints via new
  usePayments helpers (getPaymentKeys/savePaymentKeys/deletePaymentKeys).
- **ExternalBookingCard**: native vs link_out radio + https URL field →
  get/setBookingMode. (Front Desk already deflects on link_out.)
- Legacy Connect card demoted to a subtle "Stemfra-managed Stripe" fallback line
  (dormant, not deleted). Old inline payments_enabled toggle removed (connecting
  keys sets payments_enabled server-side).
- CMS `npx tsc --noEmit` clean.

**Task 3 COMPLETE** (server API + CMS UI). Remaining before a LIVE tenant:
the real Stripe round-trip test with Peter's separate-account test keys (that's
Task 2's live verification — paste keys via this UI → simulate a customer paying
a deposit) + Task 16 (refunds fix). Client consumers for Task 2 (template
booking page + Front Desk pay card → Checkout link) still pending.

### 2026-07-22 — Wave 1 COMPLETE (builds) + Wave 2 Task 8 DONE

**Wave 1 (all buildable tasks done + verified live):** Task 2 client consumers
(5 single-service templates → `/api/site-payments/checkout` hosted redirect +
`?checkout=` return handling in the shared BookingForm; verified live Argyle
wizard → Stripe), Task 16 (direct-key refunds — bookings refund on the tenant's
OWN key, plain refund; finalizeBookingPayment now stores stripe_payment_intent_id;
subscriptions keep the Connect path; verified real $36 refund → CMS "Refunded"),
Task 6 (Stacy "Prefer to talk?" tel: element), Task 5 (Mark Phase 1.5 —
call-reason modal in the CRM [CallWithAiModal, both LeadCard + WarmLeads] +
history-enriched voice context via activity_feed; verified). **Only Wave 1 item
left = Task 4 (A2P registration — Peter's Twilio-console action).** Plus the
tenant-facing **Stripe onboarding guide** shipped: `stemfra_platform/docs/
STRIPE_ONBOARDING.md` (+ redacted screenshots) → feeds the future in-CMS help page.

**Task 8 — Pay-and-publish automation DONE + verified (reverted).** New reactor
`lib/billing/publishOnPayment.js`: when a site's INITIAL System-A charge clears,
open the billing gate (pending subscription → active) and auto-publish the site
(previewing → live) if the completeness checklist passes (publishSite also
attaches the host). PROVIDER-AGNOSTIC — same `maybeAutoPublishSite` core is
triggered by BOTH `billing.markPaid` (Payoneer/staff-confirm, today's live path)
and the Stripe webhook `checkout.session.completed` platform_billing branch.
Opt-out per site via `sites.metadata.publish_on_payment === false`; idempotent;
best-effort (never throws into the payment path); not-ready checklist → stays in
preview with an audit note (gate is open, owner publishes when done). Reuses the
existing invoice email + `site_published` notification. Verified end-to-end:
previewing site + pending sub + due initial charge → markPaid → charge=paid,
subscription=active, site=live (fully reverted). Custom-domain PURCHASE stays
owner-initiated (needs their domain choice); the subdomain host is attached on
publish. **Remaining Wave 2:** Task 7 (setup-call booking on an internal Stemfra
site), Task 9 (owner+staff SMS alerts — after A2P), Task 10 (tenant email
templates), Task 11 (switcher messaging).

### 2026-07-23 — Wave 2 status correction: Tasks 7, 10, 11 DONE

The "Remaining Wave 2" line above is STALE. Current state:

- **Task 7 — setup-call booking DONE (built differently + better than the
  original plan).** NOT a `site_bookings` tenant on an "internal Stemfra site"
  (the §3 sketch) — instead a purpose-built **Google Calendar + Google Meet**
  flow living natively on the marketing site:
  - Marketing: `stemfra_client/src/app/pages/BookCall.jsx` (month cal → slots →
    details → confirm), route **`/book-a-call`**.
  - Server: `routes/setupCall.js` → `/api/setup-call/{config,month,availability,book}`
    (public); `lib/setupCall.js` (45-min video call, Mon–Fri 12–5pm ET;
    availability = window − host's real Google free/busy − booked `setup_calls`);
    `lib/googleCalendar.js` (service account + domain-wide delegation, impersonates
    `SETUP_CALL_HOST_EMAIL`; booking CREATES a Meet event inviting prospect +
    staff and writes a `setup_calls` row).
  - Config: all `GOOGLE_SA_*` + `SETUP_CALL_*` env keys set; verified live — a test
    booking produced a real Google Meet invite. `setup_calls` table exists.
  - Reminders come from Google Calendar's own invite/notifications (not the
    `site_bookings` sweeper the plan assumed) — better fit for a sales call.
- **Task 10 — tenant email templates DONE** (CMS "Email templates" surface, this
  session).
- **Task 11 — switcher messaging DONE** (marketing "Switching?" section +
  competitor naming + CRM switcher tag/quick-toggle, this session).
- **Only genuinely-remaining Wave 2 item: Task 9** (owner/team SMS alerts) —
  A2P-gated (Peter's Twilio-console action = Task 4).

Consequence: the Voice roadmap's Phase-3 gate ("after P12 Waves 1–2") is
satisfied (modulo the A2P-gated SMS piece). Phase 3 itself was deferred
2026-07-23 (spec-first when picked up; dedicated Twilio number per tenant per
Peter — recorded in `stemfra_server/docs/VOICE_AGENT.md`).
