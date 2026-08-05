# Stemfra — Commission Model Pivot & Plan

_Authoritative plan doc. Created 2026-07-27 (Peter + Claude strategy session).
Roadmap arc: **P13** in `ROADMAP.md`. Full narrative + diagrams also live on the
**Business Model page** in `stemfra_business` (`/business-model`). Airwallex research
+ the account-manager email are captured there too._

---

## 0. The core pivot

**Stemfra is switching from a subscription model to a pure commission model.** The old
offer ($1,000 build + $49–99/mo tiers) is **retired**. New model: **free website + 5%
commission on all sales, no tiers, everyone gets every feature.** We are
**pre-launch (no live paying subscribers)**, so there is no revenue to bridge — the
first tenants onboard directly onto commission. The whole payments discussion has been
about **how we *collect* that commission**.

## 1. Commission model — DECIDED

- **Flat 5% on ALL sales (unified).** Online bookings + at-visit sales the tenant marks
  **"collected" in the CMS** (Reports v2 / `BookingDetailModal` → `metadata.collected`,
  already built) = our source of truth for total GMV. No tiers, no setup fee, no monthly
  minimum, no dormancy fee.
- **Everyone gets everything** (Option A). The Essential/Growth/Pro tier system is
  retired; tier-based feature gating goes away (features become universally on; a few
  may become optional paid add-ons later, but NOT tiered subscriptions).
- **Processing fee (~2.8% + $0.30) shown SEPARATELY** (Etsy-style), never blended into
  our 5%.
- **Offline/cash is STILL commissioned** via the CMS "Mark as collected" flow (unified
  basis — we stay the source of truth). It runs on the tenant's own bank POS (**we issue
  no POS hardware**) and never routes through us; only its *collection* differs (below).
- **Etsy lessons banked:** separate platform-fee vs processing-fee lines (done).
- **Fresha "own-vs-new clients" question — DECIDED 2026-07-29 (Peter): flat 5% on ALL
  bookings and memberships made through the tenant's Stemfra website, existing clients and
  new alike. NO attribution / "only customers we bring" carve-out, and we never use that
  framing.** Rationale (Peter): the free premium website + booking + AI Front Desk + tools
  + support + SEO + Google Business Profile integration is already a large service that
  makes the tenant look professional and reliable, wins them more (and more loyal) clients,
  and grows their revenue. It is a partnership: tenants keep driving their own traffic
  (paid ads, Instagram, their own networking) to the site we provide and manage, and both
  sides benefit when each does their part. So the commission is on all sales transacted
  through the site, not scoped to customers Stemfra sources. (The Offsite-Ads-style
  attribution model is explicitly NOT adopted.)
- **Refunds reverse the commission — DECIDED 2026-07-29 (Peter).** If a tenant refunds a
  customer for a sale, our 5% commission on that sale reverses (the sale did not stand).
  Fees are otherwise non-refundable. This is the rule stated in the public Fees & Payments
  Policy and reflected in the metering (a refunded booking is excluded from the
  commissionable basis).

## 2. How we collect it — Airwallex manual invoicing (UPDATED 2026-07-27 after Airwallex call)

**The marketplace/auto-split path is SHELVED.** Airwallex's account manager (Harry Raj)
confirmed: the connected-accounts/marketplace model is **white-labelling Airwallex** — a
**~$20–25k/mo** commitment aimed at very-high-volume platforms. Not viable at our stage.
**Do not send the drafted Platforms email; it is retired.** (Stripe Connect / Adyen carry
the same "become a payment platform" cost + complexity — same verdict.)

**What we actually do (Airwallex's own recommendation):**
- **Monthly metered COMMISSION INVOICE.** The commission meter (Batch 1) produces a
  `billing_charges kind='commission'` row per site per month (unified 5% across bookings +
  memberships + orders). That row becomes the tenant's invoice.
- **Tenant pays to Stemfra's Airwallex Global Account** (US bank: ACH / wire / SWIFT; details
  in `crm_settings.commission_bank`, stored 2026-07-27, NOT committed to the repo). EUR/GBP
  accounts can be added later on the same system.
- **Tenant uploads the payment receipt** to confirm the invoice (initially required so we can
  show Airwallex **source of funds**). Proof-of-service = the exported bookings report. This
  is exactly the *Billing & compliance flow* already designed.
- **Later — auto-debit:** as trading history builds, Airwallex approves **card processing**
  (our KYB was declined only for **lack of business activity / no paying tenants yet** — it
  fixes itself as we invoice + collect). Then we generate **auto-debit invoices** and the
  whole cycle automates. That is Batch 2b.
- **No marketplace, no per-tenant KYB, no split.** Tenants are not connected accounts — they
  just pay an invoice. One invoice covers ALL income (online + offline), so the earlier
  online-split / offline-statement hybrid **collapses into a single monthly invoice**.
- **Collection risk** (tenants must actually pay) is managed by suspend-on-nonpayment, the
  relationship, and eventually auto-debit — standard for invoiced SaaS.

**Provider posture:** **Payoneer is dormant** (its only job was subscription collection, which
is retired) — the `lib/billing/payoneer.js` adapter stays for fallback, not deleted.
**Airwallex is our financial backbone** (US bank now; card processing + auto-debit later; a
dedicated account manager vs Payoneer's slow support). The `billing_charges` ledger +
`lib/billing/` layer are **repurposed** for commission invoicing.

## 2b. Online payments SUSPENDED, pay-at-venue is the model (DECIDED 2026-08-05, Peter)

Field reality (Peter + partner): local businesses' customers overwhelmingly pay at the
place of service (multiple POS providers, card/cash/QR/transfer); barbers/salons ask at
most a ~10% deposit in festive periods; gyms/yoga sign physical agreements first, then
pay in person. So:

- **Stripe online payments are SUSPENDED in the booking flow** (all verticals) for the
  first clients. The direct-keys pipeline stays built and dormant, NOT deleted — it
  returns later as an optional add-on (e.g. festive deposits). Simplifies onboarding.
- **Stripe Connect functionality suspended** likewise (it was already dormant/legacy).
- **NO Stripe-level commission anywhere** (no application fees). Stemfra's 5% is
  collected ONLY via the monthly commission invoice — kills the 4.5% app-fee +
  5% meter double-dip that existed on the old Connect membership path.
- **Memberships become sign-up-then-pay-at-venue**: the site/Front Desk chat captures
  the signup (pending), the business signs the agreement + collects payment in person,
  the owner confirms in the CMS ("mark as collected" pattern) — that confirmation is
  the commissionable event. The old Connect membership checkout is NOT migrated; it is
  parked with the rest of the Stripe pipeline.

## 3. Domain — the customer's responsibility, Stemfra fronts $0

> ⚠ **2026-08-04 audit note — this section disagrees with its own heading and with
> ROADMAP P13.** The heading says "fronts $0"; §3(a) below says "we front the cost,
> capped ~$15"; ROADMAP P13 + task 57 say **collect-first / never front** (blocked on
> a payment rail). ROADMAP is the later, prioritized source — treat COLLECT-FIRST as
> the standing policy. Note the code implements neither cleanly yet: the existing
> owner register path is front-then-bill AND gated on `subscriptions.status='active'`,
> which no commission-era tenant has, so it is inert for new tenants (details in
> ROADMAP task 57).

- **Free `*.stemfra.com` subdomain** (default) · **BYO connect-only** (point DNS; no
  transfer, no 60-day wait) · **buy-through-us** · or **self-serve at Cloudflare Registrar
  (at-cost) / Porkbun**.
- **Buy-through-us has two modes (decided 2026-07-27):** (a) **on-the-spot for
  non-tech owners** — Stemfra buys the domain immediately (zero friction) and adds it as a
  `billing_charges kind='adjustment'` line on the tenant's **first invoice**; we front the
  cost but **cap the auto-front at ~$15 (standard TLDs)**. (b) Premium domains (can be $100s)
  → **collect-first or BYO** — never auto-front a large amount on a tenant who might churn.
  (Automated on-the-spot buy needs the Porkbun balance funded + Cloudflare token scopes —
  both pending Peter; until then, buy manually and add the charge.)
- **Connect != transfer:** launching only needs DNS pointed at us; a full registrar
  transfer to Cloudflare is OPTIONAL (at-cost renewals; 60-day rule + EPP code + ~5
  days). Shopify/Wix/Squarespace domains block NS changes → intermediate registrar
  first. Document both; default to connect-only.
- **Onboarding gains "Do you already have a domain?"** → No = subdomain + buy-later;
  Yes = capture + connect (offer transfer docs).
- Managed (buy-through-us) domains already auto-provision a Cloudflare zone (Case 7).

## 4. Free-tier economics & hygiene

- A dormant tenant costs ~**$0** (domain off our books; SMS/AI/infra ~$0 when idle;
  infra marginal ~$0 until a capacity tier).
- **No automatic dormancy sweep** — new businesses can take ~8 months to rank on Google,
  and idle sites cost nothing, so **we keep them**.
- Instead: a **CRM Activity/Performance monitor** (observe-only) — per-site metrics
  (bookings, visits, last-active) + month / date-range / "inactive > 1 year" filters +
  **manual** staff actions (pause, nudge). No auto-purge for dormancy.

## 5. Product / agent changes from the pivot

- **Tenant Voice assistant: RETIRED** (high cost). Front Desk **chat** (Agent 2) covers
  tenants.
- **Stemfra keeps its own "Mark" voice agent** (Agent 3) for internal lead-gen /
  concierge / support.
- **Subscription model PRESERVED IN DOCUMENTATION ONLY** — retired from the live offer,
  design/infra notes kept in case we revive a subscription/hybrid later.

## 6. Public Docs / Help Center — new first-class item

> ✅ Shipped 2026-07-29 (ROADMAP task 56) with **6** categories, not the 7 planned
> below — "CMS how-tos" and "SMS & notifications" were not built, "Bookings &
> payments" split into two. The list below is the planning-era sketch.

- Markdown-driven, searchable, at `stemfra.com/docs`. Categories: Getting started ·
  Domains (connect/buy/transfer) · CMS how-tos · Bookings & payments · SMS &
  notifications · Billing & commission · Account.
- Payoffs: support deflection + SEO + a legitimacy signal for Airwallex/A2P compliance.

## 7. Build plan — buildable now vs blocked

**Buildable NOW (no external gate):**
- **Commission engine Batch 1** — flat `commission_rate` config (`basis:'all'`);
  monthly metering of **unified GMV** = online-paid bookings **+** `metadata.collected`
  at-visit bookings (reuses EXISTING fields `amount_cents` / `payment_status` /
  `metadata.collected` from Reports v2 — no new booking columns) → `billing_charges
  kind:'commission'` (ledger only); payments ToS clause. Collection = Airwallex manual
  invoicing (Batch 2a, buildable now); auto-debit = Batch 2b (card KYB).
- **Domain onboarding + free-subdomain default** (subdomain + BYO tiers).
- **Docs Help Center.**
- **CRM performance monitor.**
- **Retire the tier system** — collapse pricing page / onboarding / catalog /
  feature-gating from tiers → flat commission.
- Business Model page update.

**Blocked on external (do NOT wait):**
- **Auto-debit** commission collection (Batch 2b) — needs Airwallex **card-processing KYB**,
  which unlocks as trading history builds. (Manual Airwallex invoicing — Batch 2a — is NOT
  blocked; build it now. Marketplace/auto-split is SHELVED — ~$20–25k/mo white-label.)
- SMS Wave 2 (A2P v2 vetting).
- buy-through-us collect-first domain purchase (needs card processing).

## 7b. Build log — Batch 1 core (2026-07-27, SHIPPED + verified)

Provider-agnostic commission **metering** (ledger only; no charging). Verified end-to-end
against a live seed site (forge-and-bell): $325/mo membership + $190 June online bookings
→ $515 GMV → $25.75 commission; idempotent re-run; row shape correct; test row deleted.

- **Migration** `billing_charges_add_commission_kind_and_nullable_subscription` (applied to
  prod, additive): `kind` CHECK now allows `commission`; `subscription_id` nullable.
- **`lib/commission.js`** — flat config in `crm_settings` key `commission`
  (`{rate:0.05, basis:'all', currency:'USD'}`), get/set, no deploy to change.
- **`lib/commissionMeter.js`** — `meterSiteCommission(siteId, 'YYYY-MM')` +
  `meterAllSitesForPeriod`. Unified GMV = `buildModel` (online bookings + at-visit
  collected + membership run-rate) + `site_orders` paid in period → 5% → one
  `billing_charges` row (`kind:'commission'`, `status:'due'`, `provider:'pending'`),
  idempotent per (site, period_start). `reportsController.buildModel` is now exported so
  the meter is a faithful extension of the owner Reports.
- **Admin trigger** — `POST /api/admin/billing/commission/run` `{period?,siteId?,dryRun?}`
  (PLATFORM_ADMIN) → `runCommission` in `billingController`. Commission rows already surface
  in `GET /api/admin/billing/charges`.
- **Bank config** — `lib/commission.js` `getCommissionBank/setCommissionBank`; the Airwallex
  Global Account details stored in `crm_settings.commission_bank` (for the invoice layer).

**Batch 1 remaining (next increments):**
- ✅ **Monthly scheduler DONE (2026-07-28)** — `lib/commissionScheduler.js`
  (`startCommissionScheduler`, wired in `index.js`) auto-runs `meterAllSitesForPeriod`
  for the just-closed month during the new month's first 5 days (freeze window; meter
  idempotency makes reruns safe). **Env-gated OFF** (`COMMISSION_SCHEDULER_ENABLED=true`
  to arm) so it doesn't auto-invoice demo/fixture live sites pre-launch; the manual
  `POST /api/admin/billing/commission/run` trigger stays available meanwhile.
- ✅ **Marketing — commission messaging DONE (2026-07-29, verified in-browser).**
  Pricing page rebuilt (single "Free" card: $0/month + Offer box [Premium website /
  Free subscription / No contract / 5% only] + unified "Included Free" feature list;
  Custom tier as a landscape section on the chocolate band; "Every plan includes"
  removed). New **`/fees` Fees & Payments Policy** page (Etsy-style: what the 5%
  applies to — new AND existing clients, no attribution carve-out; tips/taxes excluded;
  platform fee vs processing fee separate; refund reverses the commission).
  **Terms §5** rewritten (Fees, Billing & Payments — commission framing, bank-transfer
  invoice flow, fee-change notice) + **Refund policy** rewritten (commission reversal).
  **Signup**: plan selection dropped; commission summary + a required
  "I agree to the Fees & Payments Policy" checkbox whose acceptance is persisted
  server-side with a server-stamped timestamp + rate + policy version
  (`sites.metadata.onboarding.fees_policy`, `lib/onboardSite.js` — bump
  `FEES_POLICY_VERSION` when /fees changes). DB catalog gained `commission_percent`
  (public `/api/plans`). ⚠ Still open from this line: the explicit **Airwallex
  "payment processing provided by" ToS clause** (add when Airwallex card processing
  actually activates; current Terms already cover processing-fee separation).

**Batch 2a — commission invoicing (server foundation SHIPPED 2026-07-27; UI remaining):**
- ✅ `getBilling` now fetches charges by **`site_id`** (was `subscription_id`) so commission
  invoices show for owners with no subscription; returns `period_start/end` + `metadata`.
- ✅ **Receipt upload** — `POST /api/cms/billing/charges/:chargeId/receipt {receiptUrl}`
  (`submitReceipt`): attaches the tenant's payment receipt to the charge for source-of-funds;
  staff verify → mark paid. Audited to `site_activity` (no entity-type CHECK there).
- ✅ **Invoice PDF** (`lib/invoicePdf.js`) renders a commission summary line
  ("Stemfra commission — 5% on $X of sales (period)") + a **PAY BY BANK TRANSFER** block
  with the Airwallex Global Account details (from `getCommissionBank`) + the invoice
  **Reference** + a receipt-upload instruction. Verified via a real render (valid PDF).
- ✅ **Invoice polish (2026-07-28):** itemized by income stream; shaded "Pay by bank
  transfer" panel (CMS indigo `#6366F1` accent, divider under the heading, no bar);
  **full ACH bank details** (account type + bank address + city/ZIP, like Airwallex) from
  `crm_settings.commission_bank`; footer kept above A4's 792pt margin (one page). **Copy
  buttons are NOT on the PDF** (a PDF cannot copy-to-clipboard) — they go in the CMS
  Invoices web view (below), which is where electronic-payment copy/paste actually helps.
- ✅ **CMS Billing → Invoices UI SHIPPED (2026-07-28), verified in-browser on forge-and-bell.**
  New `/billing/invoices` tab + `BillingInvoicesPage` (`stemfra_cms`): lists commission +
  adjustment invoices (period, amount, status, due date), **View / Download PDF**, an
  **Airwallex-style "Pay by bank transfer" panel with per-field copy buttons** (from
  `getBilling.commissionBank`), and **receipt upload** (`useUpload` → `useSubmitReceipt` →
  `POST /api/cms/billing/charges/:id/receipt`). `getBilling` now returns `commissionBank`;
  the meter stamps a **net-15 `due_date`**. Verified: $25.75 Jun invoice renders with the
  bank panel, due Jul 15, and the upload control. Sidebar Account → Billing gained "Invoices".
- ✅ **PDF receipts DONE (2026-07-28)** — `uploadController.js` now accepts
  `application/pdf` (`resource_type:'raw'`, 15MB cap; DELETE destroys as raw); the CMS
  `ReceiptUpload` input `accept="image/*,application/pdf"`. Tenants can upload a PDF or an
  image receipt.
- ✅ **CRM receipt + compliance packet DONE + verified (2026-07-28).** The CRM Billing
  "Due this cycle" commission/adjustment cards now show a **receipt badge** (green
  "Receipt" ↔ amber "Awaiting receipt") + a **Compliance** row: **Invoice PDF** (staff
  view of the tenant's branded invoice), **Bookings export** (period CSV = proof-of-service
  / source-of-funds), and **View receipt** (the tenant's uploaded receipt) with the upload
  date. Staff verify the packet → **mark paid** (existing `POST /charges/:id/paid`). Server:
  `GET /api/admin/billing/charges/:id/invoice.pdf` + `/booking-export.csv`
  (`controllers/admin/billingController.js`, PLATFORM_ADMIN); reuses `lib/invoicePdf.js`.
  CRM: `openAdminInvoicePdf` / `downloadBookingExport` in `hooks/useBilling.js` + the
  enhanced `OpenChargeCard` in `pages/Billing.jsx`. Verified: PDF 200 (`%PDF-`, 13.6 KB),
  CSV 200 (header + 3 booking rows), and the receipt badge/link both states.
- ⬜ **Remaining (Batch 2a):** none — the manual Airwallex invoicing loop is complete
  (meter → invoice PDF → CMS bank panel + receipt upload → CRM compliance packet →
  mark paid). Batch 2b (auto-debit) stays blocked on Airwallex card KYB.

**Batch 2b — auto-debit (blocked on Airwallex card KYB, which trading history unlocks):**
auto-debit invoices so collection automates. Also capture real subscription/order payment
events so membership commission is on collected cash, not the run-rate estimate.

## 8. External action items (Peter)

- ~~Send the Airwallex Platforms email~~ **DONE via a call with Harry Raj (2026-07-27)** —
  marketplace shelved (~$20–25k/mo); proceed with manual Airwallex invoicing; card KYB
  (for auto-debit) unlocks as trading history builds.
- **A2P v2** — await vetting; notify on approval.
- **Porkbun** — fund the prepaid balance.
- **Cloudflare API token** — add zone / DNS / email-routing scopes.
- Pending from before: Stripe verification; Supabase auth-email re-paste after the
  redesign.

---

## 9. Prior pending-tasks reconciliation (status as of 2026-07-27)

Cross-checked against `ROADMAP.md` P0–P12. Grouped by status.

### ✅ Done (major arcs)
- **P0** billing schema + `billing_charges` ledger + Payoneer provider + CRM `/billing`
  + monthly cycle opener + KYC fields.
- **P1** CMS client Billing · self-serve CMS `/signup` + onboarding backend ·
  booking/payment-provider setting.
- **P2** favicon · per-host OG edge function · contact-form dedup.
- **P3** `verticalConfig` consolidation · `/api/plans` DB catalog → marketing.
- **P4** outbound call guardrails · follow-up sequencer + reply classifier ·
  template-fill merge.
- **P6** 23 Pro→coming-soon · 24 server-driven offers · 25 CMS plan up/down · 26 site
  deletion + 90-day lifecycle.
- **P7** 28 per-vertical theme gallery · 30 onboarding consumes theme (Starter clone).
- **P8** 31 Pro decision (voice dropped from client tiers) · 33 "Start for free" kept ·
  34 customer email (Cloudflare Email Routing, Case 11 built).
- **P10** 43 domain→CF zone (Case 7 built) · 45 customer pro email (Case 11 built).
- **P11 Voice** 46 Phase 0 (support routing/transcripts/dispositions) · 47 Phase 1
  (speed-to-lead/transfer/recap/voicemail) · 48 Phase 2 (caller-ID/account context/tools).
- **This session:** A2P Brand + Customer Profile approved · Terms/Privacy SMS clause
  live · Business Model page (Marketplace / Unit economics / Billing & compliance /
  Airwallex email) added.

### ⏳ Awaiting approval / external (built or ready, waiting on a third party)
- **A2P 10DLC campaign v2** — resubmitted 2026-07-26; awaiting Twilio/TCR vetting
  (~5 business days). Unblocks SMS Wave 2 (owner/staff alerts).
- **Domain registrar (P6.27)** — code built + inert; blocked on **Porkbun balance
  funding** + **Cloudflare token scopes**.
- **Airwallex** — marketplace SHELVED (call 2026-07-27, ~$20–25k/mo). Proceeding with
  **manual invoicing to our Airwallex Global Account**; **card-processing KYB** (for
  auto-debit) unlocks as trading history builds. Payoneer → dormant.
- **Stripe verification** — operational, for any Stripe-based collection path.

### 🔨 Open / pending (buildable, still relevant)
- **P5.18** Voice hardening (Twilio signature validation + WS auth) — still valid for
  Stemfra's own "Mark".
- **P5.19** per-role RLS hardening (stemfra-ops).
- **P5.20** Stacy **S4** (S3 = clone, done).
- **P5.21 / Agent 6 — Ledger agent** — the last unbuilt AI agent.
- **P8.35** unified inbox + 2-way texting — needs A2P (in flight).
- **P8.36** Table-3 backlog: pageview/traffic analytics · churn/at-risk alerts · lead
  conversion board · report builder. (Analytics overlaps the new CRM performance monitor,
  task 59.)
- **P9** Marketing Mockups → production (commit pass · Docker Playwright base ·
  flip CRM `.env` to prod) · Escape-theme fidelity variants · teach n8n the
  massage + spa verticals.
- **P10** build order 40 → 38 → 39 → 43+45 → 37 → 42-R1 → 41: 40 staff-mode-in-CMS ·
  38 CMS theme studio + plans display · 39 promo banners/popups · 37 CMS ease-of-use ·
  42 Remix composer · 41 CMS mobile. (43/45 email+domain-zone largely done via Case 7/11.)
- ~~P12 Wave 2 pay-and-publish automation · Case 2 tenant email redesign · switcher
  messaging~~ ✅ **all three were already built when this was written** (2026-08-04
  audit): `lib/billing/publishOnPayment.js` (pay-and-publish), `tenantDocument()` in
  `templates/baseEmail.js` (Case 2), switcher handling in the CRM LeadCard/LeadModal.
  (Setup-call booking = DONE.)
- **P12 Wave 3** tenant blog completeness (massage/spa finish, per-theme audit) ·
  Square adapter (on demand).
- **P13** new: 56 Docs · 57 domain policy · 58 commission engine · 59 CRM performance
  monitor.

### ♻️ Superseded / changed by the pivot
- **P3.12** pricing single-source & **P8.32** un-gate Table-2-when-Stripe-live —
  **MOOTED**: flat commission = no tiers, everyone gets everything, so tier gating goes
  away entirely (becomes the "retire the tier system" task).
- **P11.49 tenant Voice (Phase 3)** & the P12 Wave-3 voice line — **RETIRED** (Front
  Desk chat covers tenants; Stemfra keeps internal Mark). **P11.50 Phase 4** = lower
  priority (internal voice only).
- ~~P12 Wave 1 direct per-site Stripe keys — SUPERSEDED by the marketplace
  connected-account split; code goes dormant~~ ⚠ **WRONG — corrected 2026-08-04.**
  This bullet was written against the marketplace plan that §2 of THIS SAME DOC
  killed the same day (Harry Raj call: ~$20-25k/mo, shelved). With the marketplace
  gone, **direct per-site Stripe keys are the LIVE tenant-payment path**, not
  dormant: `lib/paymentCredentials.js` + `getStripeForSite` + the CMS
  `DirectStripeCard` + 5 template checkout consumers, with
  `PAYMENT_CREDENTIALS_KEK` in deploy.yml. Card money flows to the tenant's own
  Stripe; the 5% is metered and invoiced separately (§2) — no PayFac needed to
  collect it. An audit found this stale bullet had already misled one session into
  doubting whether a payments fix addressed a real state.
- **P12 VSL (Last)** — unchanged, still last; funnel messaging shifts subscription →
  commission.

### 🧭 Remaining AI agents (from the 5+1 roadmap)
- **Ledger (Agent 6)** — the only unbuilt one. Tenant Voice retired; Stemfra's own
  Voice (Mark) shipped (Phases 0–2).
