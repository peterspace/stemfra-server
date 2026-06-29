# Stemfra — Roadmap & Pending Tasks (prioritized)

_Updated 2026-06-29. Single cross-repo source of truth. The order below IS the
recommended build sequence. Per-feature detail lives in the linked docs; this is
"what's next and why."_

## ✅ Done this session (2026-06-28/29)
- 9 demo sites (one per active theme, 4 verticals), owner `peechizzy@gmail.com`
  ("Marcus Argyle"); `demo_link` map + send-outreach wiring.
- Email open-tracking (pixel + endpoint); Mark outreach (send as `mark@`, reply sweeper).
- `provisionSite` vertical-alias fix; `boutique_gyms` vertical deactivated.

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

## P4 — Growth levers (lead-gen)
17. ✅ **Outbound auto-call guardrails** — DONE: `lib/callGuardrails.js` (DNC flag +
    pan-US safe window + daily cap), wired into the reply sweeper; manual Call-with-AI
    also DNC-gated. _(Window is conservative 12–18 ET; refine to per-lead tz later.)_
15. **#7 demo_link full template-fill merge** — `{{first_name}}`/`{{business_name}}`/
    `{{demo_link}}` across the drafter + n8n (only `{{demo_link}}` in send-outreach today).
16. Follow-up sequencer (A1 → A2 no-reply → A20 breakup) + reply-classification.
    _(Needs a brief design pass: cadence, which templates, stop-on-reply; partly n8n work.)_

## P5 — Hardening + platform roadmap
18. Voice hardening — Twilio signature validation + WS auth.
19. Per-role RLS data hardening (stemfra-ops) — role-scoped policies vs blanket `is_stemfra_staff()`.
20. Stacy **S3 (act)** + **S4**.
21. **Ledger** agent (Agent 6).
22. Dynamic CORS (query live custom domains) — deferred.

---
_Conventions: additive schema only (regen types after); propose → ship in focused
batches → verify; keep this file current as items land._
