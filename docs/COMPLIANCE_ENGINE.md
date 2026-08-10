# Stemfra Compliance Engine — build spec (v1)

_Written 2026-08-10 by the Fable advisor session for an Opus executor. Peter
approved the direction (CRM tabs + a dedicated compliance surface, US +
non-US). Read this whole doc, then the repo CLAUDE.mds, before coding.
Questions of tax LAW go to Peter/the cross-border CPA, never guessed._

## 1. Why we build our own

Airwallex Billing's Global Tax Automation only CALCULATES tax in jurisdictions
where we have DECLARED a registration; it does no nexus determination and no
threshold monitoring (verified against their docs 2026-08-10). Nexus watching,
books, and filing deadlines are Stemfra's own responsibility. This engine is
deliberately independent of any provider.

## 2. Entity facts (source of truth: stemfra_business `src/data/taxGuidance.ts`)

Read that file in full before building the Calendar/Filings surfaces — it is
Peter's curated cross-border analysis and the canonical fact base.

- **Stemfra LLC, Delaware, MULTI-member, manager-managed**: Peter Okeme 60%
  (Nigeria, manager) · Roseline Omale 20% (Nigeria) · Anastasiia Ilina 20%
  (Russia). All three are non-resident aliens.
- **Tax classification: pass-through (DECIDED by Peter).** US federal filing is
  **Form 1065 + Schedule K-1s** (partnership), due **March 15** (extension via
  7004). NOT the single-member 5472 + pro-forma 1120 route — that applies to
  single-member foreign-owned LLCs only.
- **The unsettled hinge**: whether Stemfra is "engaged in a US trade or
  business" (ETBUS) making income ECI. If yes: §1446 withholding (Forms
  8804/8805/8813) on each foreign member's share, reclaimable via 1040-NR
  (each member needs an **ITIN**, Form W-7). If no: 0% US. A cross-border CPA
  decides this; the engine only TRACKS the answer and its consequences.
- **No US-Nigeria income-tax treaty** (Peter + Roseline: Nigerian PIT up to
  ~24% on worldwide income, no US credit mechanism guaranteed → the double-tax
  risk Peter flagged). **US-Russia treaty suspended** (Anastasiia: true double
  tax on her 20%).
- **Delaware**: flat **$300 annual tax + annual report, due June 1**, plus the
  registered agent.
- **1099-NEC** to any US contractor paid > $600/yr, due **January 31**.
- **FinCEN BOI**: legally volatile; track "last confirmed" date, don't assume.
- **Nigeria side**: PIT on worldwide income (individual returns due March 31
  in Nigeria); CBN/FX repatriation mechanics. Needs a Nigerian accountant;
  the engine carries these as calendar entries + notes, not calculations.

## 3. Product tax categories (sales tax)

- **Platform commission (5%)** = consideration for the platform → treated as
  **SaaS**. ~22 states + DC tax SaaS (NY, TX, PA, WA, MA, CT, OH among them;
  CA/FL do not; TX taxes 80% of the price as data processing, CT 1% B2B).
- **Domain registration** = digital automated service. Explicitly taxable in
  WA; broad-base states (HI, NM, SD style) likely; most others don't
  enumerate it. Narrower footprint than SaaS.
- Obligation only attaches where we have **nexus** (economic nexus ≈ $100k
  sales OR 200 transactions/state/year; some states dropped the 200-txn
  prong, some kept it — many small domain invoices can trip counts before
  dollars). Today Stemfra is far below everywhere → 0% posture is correct;
  the registry's job is to see a threshold coming.

## 4. v1 scope

### 4a. CRM Billing page → tabs
Restructure `stemfra-ops/src/pages/Billing.jsx` into tabs like the CMS billing
page: **Due this cycle | Invoices | Subscriptions**. Keep all existing
behavior (OpenChargeCard, InvoicesTable, chips, mirror links) — this is a
layout reorganization, not a rewrite.

### 4b. New CRM page: `/compliance` (sidebar: "Compliance", Platform group)
Four tabs:

**Tax registry**
- Per-jurisdiction rolling-12-month rollup from `billing_charges`
  (status requested/paid) joined `sites` → `contacts` (billing state via
  `sites.owner_contact_id`). Columns: jurisdiction · billed $ (12mo) ·
  invoice count · split commission vs domain/other · taxability flags for our
  two categories (constants file, from §3) · threshold progress (default
  $100k / 200 txns, per-state override constants) · status chip (Clear /
  Approaching ≥80% / Registered).
- **EXCLUDE demo data**: skip charges with `metadata.demo_seed = true` AND
  charges whose site has `metadata.is_starter = true` (the 26 seeded demo
  invoices + the demo fleet must never count toward nexus).
- `contacts.country`/`state` store HUMAN NAMES ("United States", "New York").
  `lib/airwallexBilling.js` has `isoCountry()`; lift the mapping into a shared
  `lib/geo.js` if needed server-side, or map client-side.
- Registrations table: a new `compliance_registrations` table (jurisdiction,
  category scope, registration number, effective date, status, notes) with
  staff RLS — mirrors what gets declared in Airwallex → Billing settings → Tax.
- Alert at ≥80% of any threshold: CRM-visible badge + a `site_activity`-style
  log entry (platform audit goes to `site_activity`, never `activity_feed`).
- Non-US jurisdictions are just more rows (jurisdiction table is generic, not
  a US-state enum) so VAT/GST exposure slots in later.

**Books**
- Revenue: monthly rollup of PAID `billing_charges` by kind (same demo
  exclusions).
- Expenses: build on the CRM's existing finance tables (`expenses` — check
  the live schema first) with categories mapped to deduction buckets:
  infrastructure (Hostinger/Cloudinary/Twilio/OpenAI/ElevenLabs), domain COGS
  (Porkbun), software, fees (Airwallex/Stripe), professional services.
- A simple monthly/quarterly P&L view. No accounting-grade ledger in v1.

**Calendar**
- A static obligations catalog (constants) instantiated per year with a
  status row in a `compliance_filings` table (obligation key, period, due
  date, status open/filed/na, filed_at, notes):
  - Jan 31: 1099-NEC (US contractors)
  - Mar 15: Form 1065 + K-1s (US partnership return)
  - Mar 31: Nigeria PIT individual returns (Peter + Roseline, informational)
  - Apr 15: members' 1040-NR (only if ECI/withholding applies — gated on the
    CPA's ETBUS answer, stored as an engine setting)
  - Jun 1: Delaware $300 annual tax + report
  - Quarterly: 8813 §1446 deposits (same ECI gate)
  - Per-state sales-tax filings appear once a registration row exists
- Lead-time alerts (30/7 days) surfaced in the CRM.

**Filings & status**
- The taxGuidance action checklist as trackable items: CPA engaged · Nigerian
  accountant engaged · ITIN per member (3 rows) · operating agreement updated ·
  SDN/OFAC screening date per member · BOI last-confirmed date · ETBUS/ECI
  determination (the master switch other surfaces read).

## 5. Explicitly out of scope (v1)

- Rate calculation and invoice-level tax lines (Airwallex does this once
  registrations are declared + products get tax codes).
- Automated filing/remittance.
- The MoR (merchant-of-record) decision — a standing advisor question, not
  an engine feature.
- Accounting integrations (QuickBooks etc.).

## 6. Executor guardrails (standing house rules)

- Read `SESSION_HANDOFF.md`, `docs/README.md`, `stemfra-ops/CLAUDE.md`,
  `stemfra_server/CLAUDE.md`, and this doc before coding.
- No em-dashes in ANY user-facing copy. CRM dark-theme tokens (`glass-card`,
  `text-text-*`, `btn-*`); tables follow the existing Billing table style.
- Commit per slice; **NEVER git push** (server push deploys prod).
- Never restart the :4000 server (nodemon reloads); never curl prod webhooks.
- Verify in the browser (CRM :5178, dev login dev@stemfra.com) before
  claiming done; screenshots for Peter.
- Schema changes: additive only, document in the repo CLAUDE.md, staff RLS
  via `is_stemfra_staff()`.
- Anything ambiguous about tax LAW: stop and ask Peter — the engine records
  facts and deadlines; it does not invent tax positions.

## 7. Open items for Peter / the CPA (tracked in Filings & status)

1. ETBUS/ECI determination (the 0% vs §1446-withholding hinge).
2. Sales-tax taxability of the commission + domain fees per state (before any
   registration).
3. MoR for System A: yes/no once the first-year state footprint is visible.
4. ITIN applications (W-7) for all three members.
5. Nigerian accountant engagement (PIT + CBN/FX path).
