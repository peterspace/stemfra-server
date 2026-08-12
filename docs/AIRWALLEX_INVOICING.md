# Airwallex Invoicing — system of record

**Last updated: 2026-08-12.** Owner-facing invoicing runs as a **hybrid**: our own
Stemfra-branded email (from `mail.stemfra.com`) carries the **canonical Airwallex
invoice** (a "View invoice online" link + the Airwallex PDF). This doc is the
single source of truth for how that works end to end, plus the **tax lifecycle**
the model is built to adapt to.

Related docs: [`COMMISSION_MODEL.md`](./COMMISSION_MODEL.md) (why we invoice at
all + §7b mirror build log), [`RECONCILIATION.md`](./RECONCILIATION.md) (how
payments auto-confirm), [`COMPLIANCE_ENGINE.md`](./COMPLIANCE_ENGINE.md) (nexus +
books that drive tax filing). Code: `lib/airwallexBilling.js`,
`lib/billingEmails.js`, `lib/billing/index.js`, `templates/transactionalEmails.js`.

---

## 1. The decision (2026-08-12)

Airwallex's account manager suggested we lean on Airwallex's own Invoicing product
(one canonical numbered invoice + reminders) instead of only our custom PDF. After
research + live testing we chose a **hybrid**, because it keeps the best of both:

- **We send the email** from our own domain, fully Stemfra-branded, high
  deliverability (Resend, `mail.stemfra.com`). No unfamiliar Airwallex sender in
  front of the tenant, and no dependency on Airwallex's custom-email-domain feature.
- **Airwallex owns the canonical invoice**: the official numbered record (builds
  KYB trading history), its hosted "View invoice online" page, and its PDF. The
  same hosted link becomes a real **card checkout** the day Airwallex Payments is
  approved, with zero re-work.
- **No double email**: all Airwallex customer emails stay **OFF**; our system is
  the only thing that ever emails a tenant.

Rejected alternatives: (a) switch tenant-facing email to Airwallex's own emails
(loses our branding, needs their custom-email-domain, risks double sends); (b) keep
our own PDF as canonical (two divergent documents, not card-ready). The hybrid
avoids all of that.

> **Experiment run 2026-08-12 (Peter observed live):** temporarily enabled
> Airwallex's own "Invoice finalised" email and sent one to peechizzy@gmail.com.
> Findings that confirmed the hybrid decision: it arrives from
> **`no-reply@info.airwallex.com`** (an Airwallex domain, not ours — a custom
> sender needs their paid Beta custom-email-domain feature); its template
> **flattens the memo** into a run-on paragraph (loses the bank-detail line
> breaks our email/PDF/hosted view keep); and the CTA is "View invoice online"
> (view-only, since we are OUT_OF_BAND). Verdict: our branded email is better.
> The toggle was turned back OFF — **all Airwallex customer emails must stay OFF**
> so our system is the only sender (no double email).

---

## 2. Invoice lifecycle

```
staff/flow → billing.markRequested(chargeId)
   1. billing_charges.status = 'requested'
   2. $0 charge? → stop (no mirror, no email; nothing to collect)      [§7]
   3. await mirrorInvoice(chargeId)         (lib/airwallexBilling.js)  [§3]
        - ensureBillingCustomer  (name/email/address/nickname)         [§6]
        - create OUT_OF_BAND invoice: number = our INV-XXXXXXXX,
          memo = bank details, footer = due/ref/terms                  [§4,§5]
        - add line item (product routed by charge kind)                [§3]
        - finalize → stores metadata.awx_invoice_id / awx_pdf_url
   4. sendInvoiceEmail(chargeId)            (lib/billingEmails.js)      [§5]
        - airwallexInvoiceAssets(): fresh GET → hosted_url + PDF bytes
        - our branded email: "View invoice online" btn + Airwallex PDF
          attached + bank details + payment reference in the body
        - fallback: our own rendered PDF if the mirror is unavailable

tenant pays by bank transfer to our Airwallex Global Account
   → deposit lands → Reconciliation Engine auto-matches on the exact
     amount + payment reference → billing.markPaid()                   [RECONCILIATION.md]
        - sendReceiptEmail()
        - markInvoicePaid() → Airwallex invoice marked paid

overdue → sweepers → sendDunningEmail() (same hybrid: Airwallex PDF + link)
```

Mirror + email are **best-effort**: our ledger (`billing_charges`) is always the
system of record and never blocks on Airwallex. The mirror is **awaited before**
the email (so the email can read `awx_invoice_id`), but `mirrorInvoice` swallows
its own errors and returns null, so a mirror failure just degrades the email to
our own PDF. Gate: `AIRWALLEX_MIRROR_ENABLED !== 'false'` + both creds present.

---

## 3. Named products + routing

Charges map to **three** Airwallex products (created by hand in the dashboard,
looked up by name + cached in `crm_settings.airwallex_billing`, never hardcoded):

| Charge | Product | Unit label | Tax category |
|---|---|---|---|
| `kind='commission'` | **Platform commission** | `month` | SaaS – Business |
| `metadata.type='domain_registration'` | **Domain registration** | `year` | IaaS / Web Hosting – Business |
| everything else (setup, adjustments) | **Stemfra services** (fallback) | — | — |

`productIdFor(charge)` (`lib/airwallexBilling.js`) does the routing. Domain charges
are `kind='adjustment'` (a shared bucket), so the `metadata.type` marker is what
distinguishes them, not `kind`. Unit labels: "month"/"year" describe the billing
cadence (a per-unit label reads better than the circular "per commission"; the
amount can still vary each month, which the line-item label makes explicit). Tax
categories only take effect **if** Automatic Tax is enabled (it is not — see §8).

`price.description` does **not** render anywhere on the Airwallex PDF (verified via
a live test invoice); only the **Product name** + **memo** are visible. So the
"what is this charge" meaning must live in the product name + the line label.

---

## 4. The memo (bank-transfer details)

`bankMemo(bank)` builds the invoice `memo` from the same `CommissionBank` fields
(`crm_settings.commission_bank`) the CMS BankPanel + our own `invoicePdf.js` render,
so it can never drift from the real account. Airwallex renders the memo prominently
above the line items (labelled "Memo" on the hosted view; an unlabelled block on
the PDF). Layout matches Airwallex's own out-of-band convention.

Presentation choices (verified on live PDFs, Peter's calls):
- **No SWIFT line** — our transfers are domestic ACH/Fedwire; SWIFT is noise here
  (our own PDF still shows it for the rare wire payer).
- **City / ZIP exactly as Airwallex's own Global Account panel shows them**: the
  state stays with the city (`Bank city: Woodhaven, NY`) and the ZIP is the bare
  postcode (`ZIP Code: 11421`). This is the source tenants cross-check against, and
  it maps directly to our stored fields (`bank_city` already holds "City, State").

Footer = `Payment due by <date>. Include the payment reference <payRef> ... send
the exact invoice amount; bank or transfer fees are not part of your invoice. Your
payment is confirmed automatically once it arrives.`

---

## 5. The hybrid email (`lib/billingEmails.js`)

`airwallexInvoiceAssets(ctx)`:
- reads `ctx.charge.metadata.awx_invoice_id` (set by the mirror). If absent → null.
- `GET /api/v1/billing/invoices/{id}` returns a **freshly re-signed** `hosted_url`
  + `pdf_url` on every call (**~43-day** expiry). The signed LINKS expire; the
  INVOICE is permanent — so we re-mint the link on every send and never store a
  stale URL. This is what makes "non-expiring" free.
- downloads the PDF bytes (permanent once attached) and returns
  `{ hostedUrl, pdf }`. Any error → null → **fallback** to our own rendered PDF.

`sendInvoiceEmail` / `sendDunningEmail`:
- attach the **Airwallex PDF** (fallback: our `invoiceAttachment`).
- pass `hostedUrl` to the template → primary CTA **"View invoice online"**
  (becomes "Pay now" once card is live). Fallback CTA → CMS billing page.
- `paymentInstructions = bankTransferInstructions(payRef)` — recon-accurate copy
  (names the payment reference, "confirmed automatically", no receipt upload).
- keep the bank details + payment reference in the body so a tenant can pay by
  transfer **without clicking anything**.

Guardrails: Airwallex customer emails stay OFF (no double email); the note says
"by bank transfer" (not "card or bank transfer") until Payments is live.

### Payment reference (why the bare 8-char code)

- Invoice number = `INV-` + first 8 hex of the charge id → e.g. `INV-5FB045A0`.
- Payment reference = the **same 8 chars, bare** → `5FB045A0`.

They are the same code; we strip the `INV-` prefix because **USD bank reference
fields cap ~10 chars** — `INV-5FB045A0` (12) truncates and breaks the recon
auto-match, which keys on this exact string (RECONCILIATION.md R4). So the
reference is ours (derived from the invoice), not Airwallex's, and never the full
"INV-…".

---

## 6. Billing customer (`ensureBillingCustomer`)

Built from the owner contact: `name` = business name, `email` = owner email,
`address` = CMS billing-details (line1/line2/city/postal_code + country/state,
human-name→ISO-2), `nickname` = **business name**. The hosted invoice uses the
**nickname** as the "Bill to" heading, so nickname must be the business name, not
the subdomain (fixed 2026-08-12; pushed on create AND on later best-effort
updates, so existing customers self-correct on their next mirror). With an address,
Airwallex reports the customer `automatic_tax_eligibility: ELIGIBLE` (only relevant
once Automatic Tax is on).

---

## 7. $0 invoices

A zero-total Airwallex invoice **auto-settles as PAID** on finalize and **cannot be
voided** (a known cosmetic artifact). So a no-sales commission month must not be
mirrored or emailed. `markRequested` short-circuits at `amount_cents <= 0` (marks
the charge requested for ledger consistency, then stops). `sendInvoiceEmail` also
guards $0 defensively. In practice nothing auto-requests $0 charges (the meter only
creates them; staff/flows do the requesting), so this is a backstop.

---

## 8. Tax handling (design of record — currently INACTIVE at 0%)

### Current state
Automatic Tax is **OFF** (`enable_automatic_tax` never passed → false), and we hold
**zero tax registrations**. Airwallex applies **0% where you are not registered**,
so even flipping it on today would compute 0% everywhere. Every invoice shows
`Tax $0.00`. This is the correct, defensible posture while we are pre-revenue and
below every economic-nexus threshold (COMPLIANCE_ENGINE.md tracks the trigger).

### How tax actually works (do not misread this)
When tax applies, e.g. `$100 commission + $13 HST = $113`:
- **All $113 lands in our Airwallex account.** Nothing is auto-routed to any tax
  authority. Airwallex **calculates + reports** tax; the **merchant (us) files and
  remits** it (confirmed in Airwallex docs). The $13 is a **liability** we hold and
  pay to the jurisdiction on its filing schedule.
- Obligation is **triggered by nexus + registration**, not by revenue existing. No
  nexus + not registered = 0% + no remittance duty. (Income tax on the commission
  revenue is separate + always due — Form 1065/K-1.)
- **B2B reverse charge**: our tenants are businesses; many cross-border B2B sales
  are 0% with the customer self-accounting. Airwallex's B2B determination
  (`type: BUSINESS`) handles it. Net effect: our real collection footprint is
  narrow even at scale (mostly specific US states where we register + SaaS taxes).

### Reconciliation must match the tax-inclusive total
The tenant sends the **total incl. tax** ($113), so the deposit is $113 and recon
must match $113 — not the commission-only $100. **Adaptive model (near-term task,
§9):**
- keep `billing_charges.amount_cents` = commission ($100) so revenue reporting +
  the Compliance books stay clean;
- add `tax_cents` (+ `tax_rate`, `tax_jurisdiction`, `tax_type`) = the collected-tax
  liability ($13);
- recon matches the deposit against **`amount_cents + tax_cents`**; on auto-pay it
  records the split (revenue vs tax-collected-per-jurisdiction).
- **Today `tax_cents = 0`** everywhere → match target = commission = identical to
  current behavior. Zero risk now, fully ready when we register.

Edge cases: underpayment (tenant forgets tax → shortfall beyond the ±$5 fee
tolerance → review queue); fee shrinkage does **not** reduce the tax owed (tax owed
= invoiced tax); refunds → Airwallex credit note reduces revenue + tax liability;
multi-currency → match in the invoice's currency.

### Remittance
The Compliance Engine books/registry is the home for "tax collected per
jurisdiction per period", which drives the filings. Open item: confirm whether
Airwallex offers a filing-partner or we file via the accountant.

---

## 8b. CMS billing surfaces (2026-08-12)

The **invoice is now the single "where to pay" source** in the CMS too. The
standalone "Pay by bank transfer" panel was removed from the Invoices tab
(redundant with the invoice email/PDF/hosted page, and a stale-details risk once
per-currency Global Accounts exist). The Invoices + Payment-history **"View"**
action opens the **canonical hosted Airwallex invoice** via
`GET /api/cms/billing/charges/:id/hosted-invoice` (server re-mints a fresh
`hosted_url`; 404 when not mirrored → the CMS falls back to our own PDF preview).
This also fixed "View" downloading instead of previewing (a top-level PDF
navigation is subject to Chrome's "download PDFs" setting; the hosted invoice is
a web page that always previews). Files: `controllers/cms/billingController.js`
`hostedInvoice`, `stemfra_cms/src/lib/billing.ts` `openInvoice`,
`BillingPage.tsx`. The billing guided tour copy was updated to match.

## 9. Open / near-term tasks

- ~~**Tax-aware ledger + recon-on-total** (§8)~~ **DONE 2026-08-12.** Migration
  `billing_charges_tax_fields` added `tax_cents integer NOT NULL DEFAULT 0` +
  `tax_rate` / `tax_jurisdiction` / `tax_type` (all null default). `lib/reconEngine.js`
  now matches deposits against the tax-inclusive total via a `chargeTotal(c) =
  amount_cents + tax_cents` helper (T1/T2/T2-near/T3-sum + staff `applyDeposit`);
  candidate rows carry `tax_cents`/`total_cents`; auto-pay records the
  revenue-vs-collected-tax split in `metadata.recon` when tax > 0. **Today
  tax_cents = 0 everywhere → match target = commission = identical to prior
  behavior; zero risk now.** Remaining to ACTIVATE (only when we register a
  jurisdiction): turn on Airwallex Automatic Tax, add the tax line item to the
  mirrored Airwallex invoice + a tax row on our own PDF/email so the tenant-facing
  invoice total equals `amount + tax` (the deposit recon already expects), and set
  `tax_cents`/`tax_rate`/`tax_jurisdiction` on charge creation.
- **`invoice.paid` webhook** — REQUIRED when Airwallex Payments/card goes live: a
  tenant paying via the hosted link marks the Airwallex invoice paid, and our
  `billing_charges` must learn of it (we currently only handle `deposit.*`
  webhooks for bank recon).
- **Confirm Airwallex tax filing-partner** vs manual filing (account manager).
- **Custom domain** (`pay.stemfra.com` for the hosted page) — optional $10/mo Beta;
  not needed while the link sits behind a button in our own branded email.
- **Test-customer cleanup** — a few "TEST — …" / Argyle billing customers remain on
  the live account from email/PDF tests (harmless, labelled). All test INVOICES are
  voided.

---

## 10. How this was tested (2026-08-12)

Live against the real Airwallex account: created + finalized invoices, downloaded
the real PDFs, and sent a full hybrid email to `peechizzy@gmail.com` (approved).
Verified: named products render, memo city/ZIP matches Airwallex's panel, Bill-to =
"Argyle & Sons" (nickname fix), the "View invoice online" button opens the hosted
invoice, the Airwallex PDF attaches, and the bank details + reference are in the
body. All test invoices voided afterward. Code paths (mirror-first ordering,
`airwallexInvoiceAssets`, $0 guard) are code-verified; a final live end-to-end
through `markRequested` on a demo site is the remaining optional check.
