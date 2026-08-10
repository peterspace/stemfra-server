# Domains — registration, wiring, billing & monitoring

_Status: ✅ LIVE end-to-end (first real purchase: `argyleandsons.click` for
Argyle & Sons, 2026-08-10, Porkbun order 11293757). Registrar = **Porkbun**
(prepaid balance); DNS/SSL/email = **Cloudflare** (zone per domain). Rewritten
2026-08-10 — the pre-build spec this file used to hold is superseded by what
shipped. §6 is the step-by-step walkthrough written for a tutorial video._

## 1. The model in one paragraph

A tenant searches for a domain inside the CMS (Settings → Domain) and registers
it with one click. While our prepaid Porkbun balance is healthy, the purchase is
**instant**: Stemfra buys the domain at wholesale, wires all DNS + SSL + email
routing automatically, and the invoice (bank transfer to our Airwallex account,
like every Stemfra invoice) follows. If the balance drops below the threshold
($30 default), the CMS automatically switches to **invoice-first**: the tenant
gets the invoice up front and staff register the domain after payment clears.
The mode flips back to instant on top-up, with no deploy. Stemfra holds the
registration (reseller model — we renew and bill); WHOIS privacy + SSL are
included free.

## 2. The two purchase modes (the fintech reconcile pattern)

| | **Instant** (balance ≥ $30) | **Invoice-first** (balance < $30) |
|---|---|---|
| Trigger | `domainBalance.purchasesSuspended()` false | true |
| What happens on Register | Buy at Porkbun → wire everything → invoice after | Insert pending invoice → email it → stop |
| Who completes it | Fully automatic | Staff: CRM Sites → Domain → Buy → Register & connect (reuses the pending invoice — no double bill) |
| Owner-facing copy | "We register it immediately and connect it to your site" | "We'll email you an invoice, then register once payment is confirmed" |
| Where decided | `controllers/cms/domainController.js registerOwn`; search returns `purchaseMode` so the CMS shows the right copy before the click | same |

Why: an instant purchase never loses the name (or its price) to a staff delay,
and the balance cap means we never spend money we haven't got covered. This is
the standard prepaid-float reconciliation model.

## 3. What a purchase actually does (shared orchestrator)

`lib/domainPurchase.js purchaseAndWire()` — used by BOTH the owner instant path
and the staff CRM path (`controllers/admin/domainsController.registerDomain`).
Never inline these steps; they drifted once.

1. **Porkbun `domain/create`** at the freshly-checked cost (WHOIS privacy on).
   Draws from the prepaid balance.
2. **Porkbun DNS**: apex ALIAS + `www` CNAME → `{project}.pages.dev` (serves
   during NS propagation).
3. **Cloudflare Pages attach** (`attachCustomDomain`) → SSL issuance.
4. **Case 7 zone** (`lib/domainZone.js provisionDomainZone`): CF zone in our
   account → Porkbun nameservers → the zone's pair → proxied apex+www CNAMEs →
   Email Routing enable.
5. `sites.custom_domain` written → the CMS + tenant site pick it up.

Every post-purchase step is best-effort (a hiccup never loses the paid
registration); failures land in the `steps` map + the `site_activity` audit row
(`domain_registered`).

## 4. Money: pricing, invoicing, balance

- **Retail formula** (`lib/registrar/porkbun.js retailCents`, 2026-08-10):
  `cost + 10% + $2` (`DOMAIN_MARKUP_PCT` / `DOMAIN_MARKUP_FLAT_CENTS`). Applied
  to the first-year (promo) cost AND the renewal cost, so the renewal price we
  quote is honest from day one. Rationale: domains are an enabler (the 5%
  commission is the revenue) — retail stays within ~$2-4 of at-cost registrars
  (Cloudflare = at cost; e.g. .com: CF $10.46, our $14.19, Namecheap ~$15).
  ⚠ Porkbun first-year promos renew much higher (.site $1.96 → $28.84 cost);
  `checkDomain` now returns `renewalCostCents`/`renewalRetailCents` and the CMS
  shows "renews at $X/yr" everywhere. **The renewal sweeper (still to build)
  must invoice from the renewal cost, not year-one.**
- **Invoice** = `billing_charges` `kind='adjustment'`, `provider='airwallex'`,
  due +7d, metadata `{type:'domain_registration', domain, cost_cents,
  renewal_cost_cents, order_id, pending_registration}`. The insert rings the
  owner's bell (cms_notifications trigger); `billing.markRequested` emails the
  branded invoice PDF **with the Airwallex bank-transfer panel** (invoice number
  = payment reference; receipt upload under Billing → Invoices). Payoneer is
  fully retired from this path (2026-08-10 — provider registry default, the
  `billing_active_provider` setting, and both register paths now say airwallex).
- **Balance monitor** (`lib/domainBalance.js` + CRM **Platform → Domains**):
  Porkbun has no balance endpoint, so we read it via a native no-charge dryRun
  probe (cached 10 min; forced refresh after every instant purchase). Below
  `DOMAIN_MIN_BALANCE_CENTS` ($30): daily alert email to `NOTIFY_EMAIL`, CMS
  flips to invoice-first, CRM page shows "Owner purchases: Paused" + a top-up
  banner. Recovery is automatic.

## 5. Owner-facing UX states (CMS Settings → Domain)

- **No domain**: "Your Stemfra address" ({sub}.stemfra.com) + "Find a new
  domain" search (exact-match hero + a scrollable Cloudflare-style list of ~24
  TLD alternates, each showing first-year + renewal retail; per-row Check does
  the live availability call) + "Use a domain you own" BYO connect.
- **Search → Register** confirm panel: mode-aware copy + the renewal price.
- **Connecting (Stemfra-registered, DNS propagating)**: "We're setting
  everything up" — we tell the owner we configured DNS/SSL/email automatically,
  nothing to do, Check status button. NO registrar instructions (the server's
  `status` endpoint returns `managed:true` when a domain_registration charge
  exists for the domain).
- **Connecting (BYO)**: the Render-style 3-step guide (record to add at their
  registrar + Verify button).
- **Connected** (either kind): the custom domain is the PRIMARY address card
  ("argyleandsons.click · CONNECTED · live with SSL"), verification is
  automatic (the card polls Cloudflare on load — no Verify button once live),
  and the stemfra.com subdomain demotes to a footnote ("keeps working and shows
  the same site"). The top-bar "Open" link uses the custom domain.

## 6. Walkthrough (video-tutorial script)

### A. Tenant: buying a domain (instant mode)
1. CMS → sidebar **Account → Domain** (Settings → Domain).
2. "Find a new domain": type a name (`myspa` or `myspa.com`) → **Search**.
3. The exact match shows AVAILABLE/TAKEN + "$X first year · renews at $Y/yr";
   scroll "More options" for other endings; **Check** any row for live
   availability.
4. **Register** → confirm panel restates price, renewal, WHOIS privacy + SSL →
   **Register domain**.
5. 🎉 "{domain} is registered" — the card flips to *Connecting*: "We're setting
   everything up… no action needed."
6. Bell rings + email arrives: the invoice PDF with the bank-transfer details
   (pay by transfer, reference = invoice number, upload the receipt under
   Billing → Invoices). Also visible under **Billing → Payment history**.
7. Within ~an hour the card shows **CONNECTED · live with SSL**; the site
   answers on the new domain AND the stemfra.com address.
8. **Email forwarding** (same Settings group): create hello@{domain} → any
   inbox, free, up to 20 addresses.

### B. Tenant: connecting a domain they already own (BYO)
1. Same page → "Use a domain you own" → enter it → **Connect**.
2. Follow the 3-step guide: add the shown CNAME at their registrar (provider
   dropdown adapts the instructions) → **Verify**.
3. On success: same CONNECTED state. (No zone/email routing — we don't take
   custody of BYO DNS.)

### C. Staff: monitoring + the low-balance mode
1. CRM → **Platform → Domains**: Porkbun balance vs the $30 threshold, every
   registered domain (site mapping, status, expiry, auto-renew, WHOIS privacy),
   and the "Owner purchases: Open/Paused" card.
2. Balance < $30 → daily alert email + CMS purchases switch to invoice-first.
   Top up at porkbun.com/account → Refresh → everything resumes.
3. Invoice-first fulfilment: CRM → Sites → (site) → **Domain → Buy a domain**
   tab → Check → **Register & connect** once the owner has paid. It reuses the
   pending owner invoice (stamps the order id) — never a second charge.
4. Payment arrives (bank transfer): CRM Billing → verify the receipt packet →
   **Mark paid** → the owner gets the receipt email.

## 7. Setup / env

```
DOMAIN_REGISTRAR=porkbun
PORKBUN_API_KEY / PORKBUN_SECRET_API_KEY   # Account → API Access; account must be email+phone VERIFIED + balance funded
DOMAIN_MARKUP_PCT=10                        # retail = cost +10% +$2
DOMAIN_MARKUP_FLAT_CENTS=200
DOMAIN_MIN_BALANCE_CENTS=3000               # $30 pause threshold
CLOUDFLARE_API_TOKEN                        # needs: Zone:Zone:Edit, Zone:DNS:Edit,
                                            # Zone:Email Routing Rules:Edit (all zones),
                                            # Account:Email Routing Addresses:Edit
```
Secrets → GitHub Actions `deploy.yml` env block (the deploy REPLACES the env
panel). ⚠ 2026-08-10: the live CF token is missing the two Email Routing
permissions — the `emailRouting` step of `provisionDomainZone` fails with auth
error 10000 until Peter extends the token (then re-run email forwarding for
already-registered domains).

## 8. Gotchas (learned live)

- `checkDomain` is rate-limited ~1/10s account-wide → one live check per
  search, alternates priced from the cached public `/pricing/get`.
- `domain/create` requires `cost` to match the current price → always re-check
  immediately before registering.
- Porkbun balance: no endpoint — native dryRun create returns `balance` free.
- The first-year price can be a promo (`firstYearPromo:'yes'`); renewal cost
  comes from `additional.renewal.price` / `regularPrice`.
- `subscriptions.provider` CHECK now includes `'airwallex'` (extended
  2026-08-10).
- Both register paths must stay on `lib/domainPurchase.purchaseAndWire` +
  `provisionDomainZone` — keep them shared.

## 9. Deferred / next

- **Renewal sweeper** (the big one): auto-renew is ON at Porkbun (draws from
  the balance); we still need the yearly `billing_charges` line at
  **renewal-cost retail** + expiry warnings. With it, a
  `site_domain_purchases` table (v1 records purchases in charge metadata +
  `site_activity`).
- CRM Buy panel success state after Register & connect (still shows the form).
- Transfers in/out; premium-domain handling (collect-first stays the rule).
