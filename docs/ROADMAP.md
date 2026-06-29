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

## P1 — Scale the motion: onboarding + client-facing billing
6. **Onboarding redesign** (Squarespace-referenced — see SQUARESPACE_REFERENCE.md).
   **Entry point (decided 2026-06-29): onboarding lives in the CMS, not
   stemfra_client.** Marketing pricing "Start for free" on a plan → redirect to the
   CMS carrying plan + vertical → CMS signup → guided onboarding (Squarespace/
   Mindbody pattern). Reuse onboardCustomer/provisionSite + Stacy checklist.
   Capture KYC fields + **"How do you currently receive payments?"** (Stripe/PayPal/
   Square/cash/other/none) → informs Connect type (Standard vs Express) + which
   System-B integrations to add; feeds payer data (incl. `contacts.state`) into P0.
7. **CMS client Billing section** (System A, client-facing): their subscription
   (tier, $1,199 → $199), charge history, editable billing contact. Distinct from
   Settings → Payments (System B Stripe Connect).

## P2 — Polish what we sell (first impressions, incl. emailed demo links)
8. **#2 Favicon** default in each template `index.html` (+ optional per-demo).
9. **#3 Link-unfurl OG** — extend the existing Cloudflare Pages Functions
   (`functions/`) with a per-host OG injector (browser case already done by
   SiteHead). Cheap stopgap: neutral static `<title>`.
10. **#8 Marketing contact form email dedup** — stop duplicate `leads` on re-submit.

## P3 — Maintainability before scaling verticals (kill sync risk)
11. **#4 `verticalConfig` consolidation** — `VERTICAL_PROJECT` (3 copies),
    `SEED_SOURCE_BY_VERTICAL`, `VERTICAL_ALIASES` (2 copies), `KNOWN_VERTICALS`
    vs `LEADGEN_VERTICALS` → one source imported everywhere.
12. **#5 Pricing single-source** — DB `verticals` → client (stop `verticals.js`
    drift); sync Stripe products. (Partly begun in P0.)
13. **#6 boutique_gym** out of `KNOWN_VERTICALS` + `LEADGEN_VERTICALS` (vertical already inactive).
14. Demo links → `demo_sites` table; `SUBJECT_TO_SERVICE` / `KNOWN_TEMPLATE_SLUGS` → DB. _(lower)_

## P4 — Growth levers (lead-gen)
15. **#7 demo_link full template-fill merge** — `{{first_name}}`/`{{business_name}}`/
    `{{demo_link}}` across the drafter + n8n (only `{{demo_link}}` in send-outreach today).
16. Follow-up sequencer (A1 → A2 no-reply → A20 breakup) + reply-classification.
17. Outbound voice guardrails (per-lead timezone windows, daily cap, DNC) before broad auto-call.

## P5 — Hardening + platform roadmap
18. Voice hardening — Twilio signature validation + WS auth.
19. Per-role RLS data hardening (stemfra-ops) — role-scoped policies vs blanket `is_stemfra_staff()`.
20. Stacy **S3 (act)** + **S4**.
21. **Ledger** agent (Agent 6).
22. Dynamic CORS (query live custom domains) — deferred.

---
_Conventions: additive schema only (regen types after); propose → ship in focused
batches → verify; keep this file current as items land._
