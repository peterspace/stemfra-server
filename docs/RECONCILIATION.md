# Billing Reconciliation Engine — spec (agreed 2026-08-11)

**Goal:** invoices confirm themselves. Deposits arriving in Stemfra's Airwallex
account are matched against unpaid `billing_charges` automatically, so tenants
stop uploading receipts and staff stop manually verifying + clicking Paid.
Peter's framing (from his blockchain reconciliation engine): deposits are
events, invoices are expected transactions, matching is the engine.

Status: **SPEC — not built.** Docs read done 2026-08-11 (facts pinned below).
Owner of the build: executor session per ADVISOR_STRATEGY; commits only, no push.

---

## 1. Airwallex facts (pinned from the official docs, 2026-08-11)

Verified against airwallex.com/docs (Deposits API page + webhook event-types →
Deposits payload examples). Our authenticated client (`lib/airwallexBilling.js`
`awx()`, token cached 25 min) already talks to `AIRWALLEX_API_BASE`.

### Deposits API
- `GET /api/v1/deposits` — paginated list. Query: `from_created_at` /
  `to_created_at` (ISO8601; **defaults to last 30 days** if unset), `page_num`
  (0-based), `page_size` (default 100).
- `GET /api/v1/deposits/{id}` — single deposit.
- Deposit object fields (the ones we use):
  - `id`, `amount` (numeric, NOT cents), `currency` (ISO-4217)
  - `reference` — the payment memo. ⚠ **USD reference is 1–10 chars** per the
    docs, so our 12-char `INV-XXXXXXXX` display ref may not survive; use the
    bare 8-char code as the payment reference (see §5).
  - `type` — `BANK_TRANSFER` | `DIRECT_DEBIT` | `DIGITAL_WALLET_TRANSFER` | …
  - `status` — `PENDING` | `SETTLED` | `REJECTED` | `REVERSED`
  - `created_at`, `estimated_settled_at`, `settled_at`
  - `global_account_id` (bank-transfer deposits) / `funding_source_id` (direct debit)
  - `payer.name`, `payer.country_code`, `payer.bank_account` (ACH/IBAN/BSB… routing shapes)
  - `fee.amount`/`fee.currency`, `failure_details` (rejected/reversed only),
    `provider_transaction_id`

### Webhooks
- Events: **`deposit.pending`**, **`deposit.settled`**, **`deposit.rejected`**,
  **`deposit.reversed`** (cover bank-transfer AND direct-debit deposits).
- Envelope: `{ accountId, id, name, data }` where `data` = the deposit object
  above (settled payloads carry `settled_at` + `fee`; rejected/reversed carry
  `failure_details`).
- **Registration is dashboard-only** (web app → Settings → Developer → Webhooks
  → New webhook, pick URL + events). **PETER ACTION** at arm time; the signing
  secret goes to `AIRWALLEX_WEBHOOK_SECRET` (.env + deploy.yml env block).
- Signature: header **`x-signature`** = HMAC-SHA256 over
  (**`x-timestamp`** + raw JSON body) with the endpoint's secret. Compute on the
  RAW body → the route must mount with `express.raw()` **before** the global
  `express.json()` (same precedent as `/api/stripe/webhook`).
- Delivery retries until a `200` is returned (exact schedule undocumented) →
  handler must be idempotent.

### Validate-at-build (cheap, do first)
Run `GET /api/v1/deposits` against the LIVE account before writing the matcher:
real deposits already exist (at minimum Peter's own balance top-ups), so we can
see exactly which fields US rails populate (`payer.name` casing, whether ACH
memos land in `reference`) and tune the matcher against truth, not assumptions.

---

## 2. Architecture

**Webhook-primary, sweep-backstop.**
- `deposit.settled` webhook → run the matcher for that one deposit → near-real-time
  confirmation.
- `lib/reconSweeper.js` — periodic sweep (interval CRM-adjustable, default 6h;
  lookback default 7 days to cover ACH settlement + weekends) fetches settled
  deposits and re-runs the matcher. Catches missed webhooks and is the ONLY
  mechanism until Peter registers the webhook.
- Both paths converge on one function: `reconcileDeposit(deposit)` in
  `lib/reconEngine.js`.

**Only `SETTLED` deposits can mark a charge paid.** `PENDING` may be recorded
for visibility but never pays anything.

### Matching tiers (per settled deposit, against open charges: status `due`|`requested`)

Candidate window: `deposit.created_at` must be **after** `charge.created_at`,
charge unpaid, currency match, amounts compared in cents
(`Math.round(deposit.amount * 100)` — deposit amounts are decimal, ours are cents).

> ✅ **Tax-aware matching (built 2026-08-12).** The matcher now compares deposits
> against the **tax-inclusive total** `amount_cents + tax_cents` (helper
> `chargeTotal` in `lib/reconEngine.js`), and auto-pay records the revenue/tax
> split in `metadata.recon` when tax > 0. Today `tax_cents = 0` everywhere, so the
> match target equals commission-only — identical to prior behavior, zero risk.
> Activation (Automatic Tax + presenting the tax line on the invoice so the tenant
> actually pays the total) waits until we register a jurisdiction. Design of
> record: [`AIRWALLEX_INVOICING.md`](./AIRWALLEX_INVOICING.md) §8.

- **T1 — reference match (auto-pay):** `deposit.reference` (case/space-insensitive)
  contains the 8-char charge code (`charge.id.slice(0,8)`) of exactly one open
  charge AND the amount matches exactly → mark paid. Reference match with a
  WRONG amount → review queue, never auto.
- **T2 — unique amount (auto-pay):** amount matches exactly one open charge
  across ALL tenants in the lookback window → mark paid. (`payer.name`
  similarity to the tenant/company name recorded as extra confidence in the log,
  but not required when the amount is unique.)
- **T2-near — fee-skimmed amount (auto-pay; Peter's call 2026-08-11, full
  automation):** the deposit lands within the fee tolerance (default ±$5,
  CRM-adjustable `near_tolerance_cents`) of exactly ONE open invoice → auto-pay,
  with the delta recorded on the charge as `metadata.recon.shortfall_cents`
  (write-off) or `overpay_cents` so the books stay honest. Motivated by Peter's
  real Grey top-up: he sent $200, Grey skimmed a $2 ACH fee, $198 landed — we
  only ever see what settles, never the sender's fees, so fee-skimmed payments
  can never exact-match. The T1 reference match applies the same tolerance
  (reference identifies the invoice; only the amount is short). The CMS Billing
  page carries a notice telling tenants to send the exact amount with sender
  pays fees.
- **T3 — ambiguous (review queue):** amount (exact or within tolerance) matches
  ≥2 open charges, or the deposit equals the SUM of one site's open charges
  (combined payment), or payer-name matches a tenant but no matching amount →
  CRM review queue with ranked candidates; staff one-click confirms (same
  markPaid path). Ambiguity always gets a human; only unambiguous matches
  auto-pay. Never auto-pay on name alone: ACH payer names are unreliable
  (personal accounts, LLC variants, bank truncation) and a wrong-tenant match
  poisons the Compliance Engine's books + nexus numbers.
- **Unmatched:** recorded and surfaced in the CRM (§6). Staff can `ignore`
  (load-bearing: **Peter's own balance top-ups are deposits too** and must be
  ignorable so they don't sit as noise), or manually attach to a charge.

### Marking paid
Auto and claim-triggered matches call the existing **`lib/billing markPaid(chargeId,
{ by: 'recon' })`** — the single choke point that already sends the tenant
receipt email, settles the mirrored Airwallex invoice, and runs pay-and-publish.
Recon additionally stamps `charge.metadata.recon`:

```json
{ "deposit_id": "…", "provider_transaction_id": "…", "settled_at": "…",
  "matched_by": "auto|claim|review", "tier": "T1|T2|T3", "matched_at": "…" }
```

**Idempotency:** before paying, assert no other charge already carries this
`deposit_id` (JSONB contains filter) AND the `recon_deposits` row (§3) isn't
already `matched`. A deposit pays at most one set of charges, exactly once.

### Reversals (the ACH-return case — must exist from day one)
`deposit.reversed` (or a sweep seeing status flip to `REVERSED`): find the
charge(s) carrying that `deposit_id` → flip status back to `requested`, stamp
`metadata.recon.reversed_at`, keep `paid_at` history in metadata for audit →
**staff alert email** + `site_activity` (`invoice_payment_reversed`) + a calm
owner email ("your bank returned the transfer; the invoice is open again").
ACH returns can arrive days after settlement; without this, reversed money
stays marked paid and the books lie.

---

## 3. Data model (additive only)

- **`recon_deposits`** (new table, staff-only RLS via `is_stemfra_staff()`,
  server-mediated like the compliance tables):
  `id` (the Airwallex deposit id, PK) · `payload` jsonb (raw deposit object) ·
  `status` text: `pending` | `matched` | `review` | `unmatched` | `ignored` |
  `reversed` · `matched_charge_ids` uuid[] · `candidates` jsonb (T3 ranked
  list) · `settled_at` · `created_at` · `resolved_by` / `resolved_at`.
  Upserted by every webhook/sweep; the CRM review queue and unmatched view read
  it directly. This is also the dedup ledger.
- **`billing_charges.metadata`** additions (no DDL): `recon` (above),
  `payment_claimed_at` (tenant clicked "I've paid"),
  `receipt_requested: true` (CRM toggled the upload back on).
- **`crm_settings` key `billing_recon`**:
  `{ enabled, interval_minutes: 360, lookback_days: 7 }` — the sweeper re-reads
  it every cycle, so the CRM interval control needs no restart. Env kill switch
  `RECON_ENABLED` gates the whole engine (sweeper + webhook processing),
  mirroring `NEXUS_ALERTS_ENABLED`; inert until armed.

---

## 4. Server build map

- **`lib/reconEngine.js`** — `fetchDeposits({sinceIso})` (paginate
  `GET /api/v1/deposits`, reuse `awx()` — export it or lift auth into a shared
  `lib/airwallexClient.js`), `reconcileDeposit(deposit)` (tiers above),
  `reconcileWindow({lookbackDays})`. Everything logs to `site_activity`
  (`invoice_auto_paid`, `invoice_recon_review`, `invoice_payment_reversed`) on
  the matched site.
- **`lib/reconSweeper.js`** — self-scheduling `setTimeout` loop (NOT a fixed
  `setInterval`, so the CRM-adjusted interval takes effect next cycle).
  Registered in `index.js` after `app.listen` — add the `require` AND the
  `start()` call together (the nexus-sweeper crash lesson).
- **`routes/awxWebhook.js`** — `POST /api/awx/webhook`, `express.raw`, HMAC
  verify per §1, route by `name`: `deposit.settled` → reconcile;
  `deposit.reversed` → reversal flow; others → upsert `recon_deposits` only.
  Always `200` fast; process async.
- **CMS claim endpoint** — `POST /api/cms/billing/charges/:chargeId/claim`
  (requireCmsAuth + ownership): stamps `payment_claimed_at`, runs a targeted
  fetch+match since `charge.created_at`; returns `{ status: 'paid' }` or
  `{ status: 'processing' }`. Claimed charges get priority ordering in sweeps.
- **Admin endpoints** — review-queue list/resolve (`confirm` → markPaid with
  `matched_by: 'review'`; `reject`), unmatched list, `ignore`, manual attach,
  recon settings get/set, per-charge `receipt_requested` toggle (which also
  sends the polite request email via `lib/mailer sendMail` + the branded
  template — copy follows the no-em-dash rule).

## 5. Invoice reference discipline (makes T1 the common case)

Add **"Payment reference: `<8-char code>`"** (e.g. `FC394268`) to the invoice
PDF's bank-details block and to `billingEmails` invoice email. Bare 8-char code,
NOT `INV-…`: the USD deposit reference caps at 10 chars, and 8 hex chars fit
every rail. The display invoice number stays `INV-XXXXXXXX` everywhere else.

## 6. CRM build (Billing page)

- **Review queue** — `recon_deposits status='review'`: deposit summary (payer,
  amount, date, reference) + ranked candidate charges + Confirm/Reject. Same
  pattern as the lead-gen review queue.
- **Unmatched deposits** — `status='unmatched'`: Ignore / attach-to-charge.
  Doubles as the treasury sanity view.
- **Settings** — enable toggle + interval + lookback (writes `billing_recon`).
- **Row kebab additions** (Due-this-cycle + Invoices tables): "Request receipt"
  toggle; auto-paid rows show a "Auto-matched" note from `metadata.recon`.

## 7. CMS build (tenant BillingPage)

- **Receipt upload hidden by default.** Show the existing upload
  (`POST /api/cms/billing/charges/:chargeId/receipt`, `receipt_url` metadata)
  only when `metadata.receipt_requested` OR a receipt already exists (back-compat).
  Receipts become a dispute-only artifact: the deposit event is the proof.
- **"I've paid" button** on unpaid transfer invoices → claim endpoint → either
  flips to Paid immediately or shows a **Processing** chip: "Processing. Bank
  transfers can take 1 to 2 business days." (calm, not an error).
- Show the payment reference prominently next to the bank details.

## 7b. Tenant email matrix (agreed with Peter 2026-08-11)

Per deposit event, what the TENANT sees (all mail through `lib/mailer sendMail`
+ the branded base template; copy follows the no-em-dash rule):

| Event | Tenant email? | Tenant UI (CMS) | Staff |
|---|---|---|---|
| `PENDING` | **No** (noise; most settle) | "Processing" chip on the invoice | — |
| `SETTLED` | **Yes — already exists**: `markPaid` sends the receipt email (`billingEmails.sendReceiptEmail`). No new email needed. | Invoice flips to Paid | activity log |
| `REJECTED` | **Yes, only if the deposit was tied to an invoice** (reference match / claimed): "your transfer did not go through, the invoice is still open" + bank details + payment reference. Funds never arrived, so nothing to un-pay. | Invoice stays/returns to unpaid | recon row `ignored` |
| `REVERSED` | **Yes — firm but polite**: "your bank returned the transfer, the invoice is open again" + bank details + reference + "reply to support if this is unexpected". This IS the re-deposit ask: same rails, same reference, fresh transfer. | Invoice returns to unpaid with a "payment returned" note | **staff alert email** (built in R1) + activity `invoice_payment_reversed` |

No auto-dunning/suspension on reversal — collection stays a human decision
(commission model has no service cutoff today).

## 8. Build order

1. **R1 — engine in dry-run:** `recon_deposits` + `reconEngine` + sweeper with
   `dry_run` flag (log would-be matches, mark nothing) → validate against the
   live account's real deposit history (§1 validate-at-build) → arm auto-pay.
2. **R2 — webhook:** endpoint + signature verify; PETER: register the URL in the
   Airwallex dashboard, drop the secret in env + deploy.yml.
3. **R3 — CRM:** review queue, unmatched view, settings, receipt-request toggle.
4. **R4 — CMS:** hide receipt by default, I've-paid/Processing, reference on
   invoice PDF + email.

## 9. Build log

- **2026-08-11 — R1 BUILT (dry-run), partially verified.** `recon_deposits`
  table live (migration `recon_deposits_v1`, staff RLS + set_updated_at);
  `lib/reconEngine.js` (fetch + tiered matcher + reversal + idempotency);
  `lib/reconSweeper.js` (self-scheduling, `crm_settings.billing_recon`,
  `RECON_ENABLED` gate) registered in index.js; `scripts/recon-dryrun.js`.
  **Matcher validated against the 5 REAL open charges** (synthetic deposits):
  T1 auto-pay ✓, T1-amount-mismatch → review ✓, amount-only correctly refused
  auto-pay because THREE $99 recurring invoices are open at once (T3-multi) ✓,
  unmatched ✓, name-resemblance → review ✓. Server healthy post-registration.
  ~~Live deposit fetch blocked on key scopes~~ → **RESOLVED same day: Peter
  granted Deposits READ on the API key** (Financial transactions/Balances still
  401 — optional, not needed for recon).
- **2026-08-11 — LIVE DRY-RUN VERIFIED + R2 webhook endpoint built.**
  - **API quirks found live** (now handled in `fetchDeposits`): the deposits
    list caps the from/to range at **31 days** (400 beyond), and with
    `to_created_at` omitted the window is measured FROM `from_created_at` — a
    long lookback silently searches the wrong month. Fixed with 30-day window
    chunking + boundary dedup. Response shape `{has_more, items, total_count}`;
    `page_size` has a minimum (~10).
  - **Real deposits: 2** (both Peter's own top-ups, US ACH from
    "Bridge Building"): $206 → `unmatched` ✓ (the row the ignore action is
    for); $198 → **`T3-sum` review** because it coincidentally equals Lull
    Massage's two open $99 invoices — the engine correctly REFUSED to auto-pay
    a sum-match and queued it. Live proof of the tier design.
  - **US-ACH reference reality (§10 open item answered):** `reference` carried
    `BR*GREY` — the payer bank's statement descriptor, NOT a typed memo. So T1
    depends on the payer's bank passing a real memo (wires + many bank apps do;
    some ACH flows don't). Reference discipline stays worth doing; T2 + the
    review queue carry the rest.
  - **R2 webhook endpoint BUILT + verified locally**: `routes/awxWebhook.js`
    mounted at `/api/awx/webhook` with `express.raw` (Stripe precedent);
    HMAC-SHA256(x-timestamp + raw body) vs `x-signature`, 5-min replay window,
    constant-time compare. Tested: bad sig → 401, valid sig → 200; processing
    respects `RECON_ENABLED` + CRM `dry_run`. **Peter registered the dashboard
    webhook** (`stemfra-deposit-recon`, wh_ZdHo8XuYvrmYaz3FrTdpjMczj_b3sBWM,
    the 4 deposit.* events); secret in `.env` as `AIRWALLEX_WEBHOOK_SECRET` +
    added to deploy.yml (PETER at prod push: add the GitHub secret). Prod
    deliveries 404 until the server deploys — fail+retry is harmless; re-enable
    the webhook if Airwallex auto-disables it.
  - **Arming path when real invoices flow:** set `RECON_ENABLED=true` (env; NOT
    yet in deploy.yml — add at arm time) → `crm_settings.billing_recon
    {enabled:true, dry_run:true}` → watch a sweep → flip `dry_run:false`
    (or use the CRM Reconciliation tab's Matching/Mode controls).
- **2026-08-11 — R3 BUILT + browser-verified; T2-near auto-pay; receipt flow
  flipped to dispute-only.**
  - **Engine:** near matches now AUTO-PAY (`T2-near`, exactly one invoice in
    tolerance; delta stamped as shortfall/overpay in `metadata.recon`); T1
    reference matches apply the same tolerance; multi-candidate near →
    `T3-near-multi` review. `near_tolerance_cents` is a CRM setting threaded
    through sweeper + webhook. Staff helpers `applyDeposit`/`setDepositStatus`.
  - **Server:** `controllers/admin/reconController.js` + `routes/admin/recon.js`
    (`/api/admin/recon/*`, PLATFORM_ADMIN): deposits list, resolve, ignore/
    restore, settings get/save, on-demand sweep, and
    `POST /charges/:id/request-receipt` (toggles `metadata.receipt_requested`
    + sends the new `platformReceiptRequest` branded email).
  - **CRM (verified live):** Billing gained a **Reconciliation tab** — Engine
    settings card (Matching on/off · Dry-run/Live · interval · lookback · fee
    tolerance + **Run check now**), deposits table with status filter, review
    rows expand to ranked candidates with per-candidate **Confirm** (+ "Confirm
    all N" for sum matches) and **Ignore/Restore**. Verified against the real
    rows: the $206 top-up Ignore → IGNORED → Restore available; $198 stays in
    review showing both Lull candidates. Invoices/Due rows: receipt chip is now
    uploaded/Requested/— (no more "Awaiting receipt") + a **Request receipt**
    kebab item.
  - **CMS (verified live):** amber fee notice on the bank-details panel ("send
    the exact invoice amount; transfer fees are yours; payment confirms
    automatically"), receipt upload **hidden unless `receipt_requested`** (or
    already uploaded), all "upload your receipt" copy rewritten to
    auto-confirmation language. CMS typecheck clean.
  - ~~Remaining (R4)~~ → done same day, see below.
- **2026-08-11 — R4 BUILT + verified · whole-dollar invoices · violet Notice.**
  - **"I've paid" (verified live):** `POST /api/cms/billing/charges/:id/claim`
    (owner-gated) stamps `payment_claimed_at` + runs `reconEngine.claimCharge`
    — an on-demand live check scoped to THIS charge (runs regardless of the
    sweeper gates; only ever pays the claimed charge; idempotent via the dedup
    ledger). CMS invoice card: "I have paid" → violet **Processing** chip +
    "Check again"; paid → confirmed toast. Check-failure still stamps the claim
    (the sweep keeps watching).
  - **Payment reference everywhere:** the invoice PDF's bank panel now prints
    **"Payment reference: XXXXXXXX"** (bare 8-char code — a 10-char USD memo
    field would truncate "INV-…" and break the match) + exact-amount/sender-
    pays-fees terms; the invoice email gained a Payment reference row
    (`platformInvoice payRef`) + matching text copy.
  - **REVERSED/REJECTED tenant emails:** new `platformPaymentReturned` builder;
    `handleReversal` emails each re-opened charge's owner ("bank returned the
    transfer, invoice open again, re-send with reference X"); a REJECTED deposit
    whose reference matches exactly one open invoice emails "did not go
    through". Both best-effort.
  - **Rounding policy (Peter, FINAL after a same-day reversal):** cents are
    already the hard 2-decimal cap. **Commission stays EXACT 5% to the cent**
    ($42.70 stays $42.70 — the "flat 5%, no hidden charges" identity; a brief
    nearest-dollar version was reverted the same day). **Domain retail** (a
    price we set, not a rate) rounds UP to the next whole dollar
    (`lib/registrar/porkbun.js retailCents`; $11.40 cost → clean $15). Card
    payments absorb decimals when they arrive. Cent-precise commissions are
    actually FRIENDLIER to the matcher (rarer amount collisions).
  - **Violet Notice component (Airwallex anatomy, EmptyState color set):** CMS
    `components/Notice.tsx` — applied to the bank-panel fee notice, the
    Subscription tab's "Included free" card + "Billed monthly by invoice", the
    Payment-method "Automatic card debit is coming" note, and the Payments
    pay-at-venue explainer. All verified live.
  - **The engine is now feature-complete (R1–R4).** To arm in prod:
    `RECON_ENABLED=true` in deploy.yml env + GitHub secret already set for the
    webhook + CRM Reconciliation → Matching On (start in Dry run).

## 10. Open items

- US-rail field coverage (does ACH memo reliably land in `reference`? payer
  name fidelity?) — answered by the R1 dry-run against real deposits.
- Partial payments: v1 leaves the charge open and routes to review; no
  partial-application ledger. Fee-shortfall near-misses auto-pay via `T2-near`
  (tolerance = CRM setting `near_tolerance_cents`, default 500) with the
  write-off recorded in `metadata.recon.shortfall_cents`. Payments short by
  MORE than the tolerance land in unmatched/review by design. Invoice PDF +
  email copy (R4) should repeat the CMS "exact amount, sender pays fees"
  notice.
- Multi-currency: v1 assumes USD (all charges are); currency mismatch → review.
- Peter top-up auto-recognition (auto-ignore deposits from his own known payer
  account) — nice-to-have after the ignore button exists.
