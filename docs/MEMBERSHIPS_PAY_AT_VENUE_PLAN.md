# Memberships & Pay-at-Venue — Execution Plan (P14)

_Authored 2026-08-05 by the Advisor (Fable 5) from Peter's decisions; see
`COMMISSION_MODEL.md` §2b for the decision record and the memory note
`project_pay_at_venue_pivot`. **Executor: Opus 4.8 sessions** following
`~/Documents/stemfra/docs/ADVISOR_STRATEGY.md`. Work phase by phase, in order;
each task is numbered for cross-session tracking. Update the Build log at the
bottom of this file + ROADMAP P14 as tasks land._

---

## 0. Context (read first, do not skip)

- **The model:** free website + flat 5% commission on all sales, collected ONLY
  via the monthly commission invoice (Airwallex bank transfer). There is NO
  online card payment in the product for now: customers pay at the place of
  service (multi-POS reality; gyms/yoga sign physical agreements first). The
  Stripe direct-keys pipeline and the legacy Connect code stay DORMANT, never
  deleted (future optional deposits feature), and are NOT to be repaired,
  migrated, or extended in this arc.
- **Memberships become sign-up-then-pay-at-venue:** the website (and Front Desk
  chat) captures a signup; the business signs the agreement + collects payment
  in person; the owner confirms collection in the CMS. That confirmation is the
  commissionable event AND what advances the membership period.
- **Research basis (2026-08-05 sweep):** membership checkout was never migrated
  off Connect and is non-functional in production; only crossfit renders a
  purchase surface; no membership↔booking linkage exists anywhere; the meter
  counts an MRR run-rate estimate, not cash. This arc replaces the broken
  purchase path with the no-payment signup flow and moves the meter to
  collected cash.

### Executor ground rules (standing, from Peter)

1. **Commit per slice, do NOT `git push`** until Peter says so. A server push
   triggers a prod deploy.
2. No em-dash in ANY user-facing copy (colon/comma/period instead).
3. Verify before asserting: live-walk every UI change in the browser preview
   (CMS :5180, templates :5174–:5182, API :4000 — keep :4000 running, never
   start a second instance). DB claims verified via SQL.
4. Additive schema only; regenerate/hand-patch `database.types.ts` BEFORE
   writing TS against new shapes. Dry-run + guards before DB writes; clean up
   test fixtures after walks.
5. Platform audit events go to `site_activity` (never the CRM `activity_feed`);
   owner-originated audits go through `POST /api/cms/activity` or server-side
   `logSiteActivity`.
6. n8n changes: hand Peter the node code to paste; never curl the prod webhook.
7. New owner-facing surfaces must be added to `lib/stacyContext.js`
   `buildSiteContext` (Stacy + Front Desk grounding) and, where routes are
   referenced, `lib/cmsRoutes.js`.
8. Emails: route through `lib/mailer.js` + `templates/baseEmail.js` builders
   (tenant brand mode for member-facing mail); always both `html` and `text`;
   preview every new variant at `/dev/preview`.
9. **Escalate to /advisor (Fable)** before: any deviation from the schema in
   §1, any change to the commission meter beyond B2 as specced, anything that
   touches the dormant Stripe paths, or after 2 failed attempts at the same
   problem.

---

## 1. Design (the contract all phases implement)

### 1a. Membership state machine (venue collection)

`site_subscriptions.status` (text) values for venue memberships:

- `pending` — signed up online (site or chat); no agreement, no payment yet.
- `active` — owner activated it (agreement signed, first payment collected).
- `renewal_due` — `current_period_end` has passed without a confirmed payment;
  14-day grace window. Member keeps access/status display.
- `expired` — grace passed unconfirmed. Terminal unless owner reactivates by
  confirming a payment (periods restart from confirmation date).
- `cancelled` — member or owner cancelled (`canceled_at` stamped;
  `cancel_at_period_end` honored: stays `active` until period end, then
  `cancelled`, no reminders).

`renewal_due` and `expired` are DERIVED + STAMPED by the sweeper (E2), not by
readers: readers trust `status`.

**Periods are anniversary-based.** `current_period_end` is the renewal date.
Confirming a payment advances `current_period_end` by one plan interval FROM
ITS CURRENT VALUE (contiguous periods, so a late payment doesn't shift the
anniversary). Activation sets `current_period_end = now + interval`.

**Stripe-era rows:** any subscription with `stripe_subscription_id IS NOT NULL`
(the 2 June test subs) is out of scope for the new flows: never advanced,
never reminded, never confirm-listed. Guard every new query with
`stripe_subscription_id IS NULL` (or `collection_mode = 'venue'`).

### 1b. Schema (additive; one migration, task A1)

- `site_subscriptions.collection_mode text NOT NULL DEFAULT 'venue'`
  (`'venue' | 'stripe'`); backfill the 2 existing Stripe rows to `'stripe'`.
- **New table `site_subscription_payments`** — the collected-cash ledger and
  the commission source of truth:
  - `id uuid pk default gen_random_uuid()`
  - `site_id uuid NOT NULL references sites(id) on delete cascade`
  - `subscription_id uuid NOT NULL references site_subscriptions(id) on delete cascade`
  - `period_start timestamptz NOT NULL`, `period_end timestamptz NOT NULL`
  - `amount_cents integer NOT NULL`
  - `confirmed_at timestamptz NOT NULL default now()`
  - `confirmed_by text` (owner email)
  - `method text` (free text: card/cash/transfer/etc., optional)
  - `metadata jsonb NOT NULL default '{}'`
  - Unique `(subscription_id, period_start)` — one payment per period.
  - RLS mirrors `site_subscriptions`: owner read via `user_owned_site_ids()`,
    staff ALL, member self-read via their own `site_customers` link
    (`subscription_id in (select id from site_subscriptions where customer_id
    in (…own customers…))` — copy the existing `site_subscriptions_member_read`
    policy shape), writes service-role only.
- Hand-patch `packages/site-data/src/database.types.ts` (union + Constants
  where applicable) — the file convention is hand-patching, see prior entries.

### 1c. Flows

- **Signup (site):** visitor picks a plan → name/email/phone (prefilled if a
  signed-in member) → `POST /api/site-memberships/signup` → pending
  subscription + owner notification → success state: "You're on the list —
  visit us to sign your agreement and start your membership."
- **Signup (chat):** Front Desk collects the same via a card flow → same
  endpoint path (shared core function, not duplicated HTTP).
- **Activate (CMS):** owner opens Memberships → Pending → Activate → records
  agreement-signed + first payment (amount defaults to plan price, editable)
  → status `active`, period set, payment row written, member gets a
  tenant-branded welcome/receipt email.
- **Monthly confirm (CMS):** a "Renewals" view listing every venue membership
  whose `current_period_end` falls in (or before) the viewed month:
  **Confirm all collected** + per-row uncheck/exceptions. Confirming writes a
  payment row per membership and advances its period; exceptions stay
  `renewal_due` and are flagged for follow-up. Confirmed renewals email the
  member a receipt with the next renewal date.
- **Member area:** plan, status, renew-by date, visits this period (count of
  their bookings in `[period_end - interval, period_end]`), payment history.
- **Reminders:** member gets tenant-branded email 7 days before
  `current_period_end` and on the day (skip if `cancel_at_period_end` or
  cancelled/expired). Owner gets a monthly digest (start of month +
  when renewals go overdue).
- **Cancel:** member self-cancel (existing portal) becomes a DB-only update for
  venue subs (+ owner notification + `site_activity` audit). Owner cancel in
  the CMS likewise skips Stripe for venue subs.

### 1d. Commission basis (cash)

Membership commission = `SUM(site_subscription_payments.amount_cents)` with
`confirmed_at` inside the metering window (cash basis: commission follows the
month the money was CONFIRMED, which handles late payments cleanly). Replaces
the MRR run-rate estimate. Bookings/at-visit basis unchanged.

---

## 2. Phase A — signup + activation core (server + CMS + crossfit)

- **A1. Migration** per §1b (`apply_migration`, name
  `memberships_pay_at_venue`). Backfill `collection_mode`. Hand-patch types.
  Verify: RLS policies present; anon CANNOT read the payments table; owner can.
- **A2. Server signup endpoint.** `controllers/siteMembershipsController.js`:
  add `signup` (public): validate site live/previewing + plan active +
  product_type='membership'; upsert `site_customers` by email (reuse the
  booking flow's customer-upsert helper; respect `suspended`); create
  `site_subscriptions` row `{status:'pending', collection_mode:'venue',
  amount_cents: plan.price_cents, application_fee_percent: null}`; idempotent
  (an existing pending/active sub for the same customer+product returns it,
  no dup); rate-limit per IP+site like the newsletter endpoint; owner
  notification (email via `transactionalEmails` owner-notification pattern +
  `cms_notifications` — check whether a DB trigger already covers
  site_subscriptions INSERT: the notif trigger `member_subscribed` exists;
  verify it fires for pending and reword if needed); `logSiteActivity
  'membership_signup'`. Route: `POST /api/site-memberships/signup` in
  `routes/siteMemberships.js`. The old `/checkout` route stays but is not
  called by anything new.
- **A3. CMS Memberships page rework** (`stemfra_cms/src/pages/MembershipsPage.tsx`
  + `lib/memberships.ts` + server `controllers/cms/membershipPlansController.js`
  + `subscriptionsController.js`):
  - Plans manager: STOP creating/updating Stripe Products/Prices — plans are
    plain DB rows (`stripe_product_id`/`stripe_price_id` stay null). Do not
    touch existing Stripe-linked plans' Stripe objects (leave them; they're
    display-inert).
  - New **Pending** section: pending signups with member details +
    **Activate** (dialog: amount [default plan price], method, optional note)
    → server `POST /api/cms/subscriptions/:id/activate` (sets active, period,
    writes the first `site_subscription_payments` row, audits
    `membership_activated`, sends the member welcome/receipt email) +
    **Decline** (sets cancelled + audit).
  - Subscriber actions (pause/cancel/refund) must branch: venue subs skip all
    Stripe calls (pause = metadata flag + no reminders; cancel = DB; refund
    action HIDDEN for venue subs — money moved at the venue, outside us).
  - Verify: full walk on forge-and-bell (create plan → signup from the
    template → pending appears → activate → active with correct period +
    payment row; decline path; cancel path). Clean fixtures after.
- **A4. Crossfit template: Subscribe → Join.**
  `stemfra_templates/stemfra_crossfit/src/pages/MembershipsPage.tsx` +
  `packages/site-data` `startMembershipCheckout` replaced by `joinMembership`
  (posts to `/signup`); CTA copy "Join" / success panel per §1c. Member
  session prefill via the existing `claimAccount` pattern. PricingTiers CTA
  wording: no payment language.
- **A5. Member/owner cancel endpoints branch for venue subs.**
  `controllers/siteMembersController.js` (`cancel-subscription`,
  `reactivate-subscription`): if `collection_mode='venue'` → DB-only status
  flip + owner notification + audit; `billing-portal` returns a clear 400 for
  venue subs (the portal button is hidden client-side in E1). Same branch in
  `controllers/cms/subscriptionsController.js`.
- **A6. Sync:** add memberships (plans + pending/active counts) to
  `lib/stacyContext.js buildSiteContext` if not already exposed, so Stacy and
  Front Desk can answer about them.

## 3. Phase B — monthly confirm + commission on cash

- **B1. CMS "Renewals" view** (new tab/section on MembershipsPage): month
  picker (default current); rows = venue memberships with `current_period_end`
  in or before the viewed month and status active/renewal_due; columns member /
  plan / amount / renewal date / status. **Confirm all collected** (checkbox
  rows, all checked by default; per-row uncheck) → server
  `POST /api/cms/subscriptions/confirm-payments` `{siteId, items:[{subscriptionId,
  amountCents?, method?}]}` — per item: write payment row (unique-guard makes
  re-confirm idempotent), advance `current_period_end` one interval from its
  current value, restore status `active` if `renewal_due`, audit
  `membership_payment_confirmed`, queue the member receipt email. Unconfirmed
  rows show an amber "payment due" flag.
- **B2. Meter switch** (`lib/commissionMeter.js`): replace
  `membershipRunrateCents` with the §1d cash sum over the window; delete the
  MRR call from the meter path only (Reports may keep MRR as an INFO metric).
  Re-run the rehearsal meter (admin trigger, `includeDemo:true`) and verify
  the invoice line matches the payments table. ⚠ Advisor checkpoint: post the
  before/after basis for one site before landing.
- **B3. Reports v2**: membership line becomes "collected this month" +
  "$X due from N members" (from renewal_due), replacing/annotating the MRR
  line. PDF/DOCX exports updated to match.

## 4. Phase C — Front Desk chat membership signup

- **C1.** `lib/frontdeskBooking.js` (or a sibling `frontdeskMemberships.js`):
  a membership tool — plan cards (reuse `frontdeskLists` plan listing; fix its
  `/memberships` href per vertical: crossfit route, else the home membership
  section), collect name/email/phone, `signup` core (shared function from A2,
  NOT an HTTP self-call), `membership_confirm` card (plan/price/what happens
  next) before creating, `membership_done` card after ("Visit us to sign your
  agreement and start — nothing to pay online").
- **C2.** n8n prompt updates: extend `n8n-workflows/frontdesk-build-prompt.js`
  + `frontdesk-parse.js` with the `membership` action contract. **Hand both to
  Peter to paste; verify via a live chat walk on a preview site afterwards.**
- **C3.** Remove the class-pack PACKAGE GATE's payment dependency: with online
  payments suspended, priced classes/packs book without card — but do NOT
  build pack credits (still no ledger). Packs remain listed-not-sold in chat;
  keep the handoff copy but reword away from online payment.
  ⚠ Advisor checkpoint if this task's blast radius looks larger than a copy +
  gating change.

## 5. Phase D — suspend online payments in booking

- **D1. Kill-switch:** env `ONLINE_PAYMENTS_ENABLED` (default OFF when unset).
  `controllers/sitePaymentsController.js config()` returns
  `{enabled:false}` when off → every template's BookingForm already keys the
  payment step off the config response (verify per template; the flow must
  fall through to the pay-at-venue path everywhere). Front Desk
  `resolveCardRail` respects the same switch (falls to venue messaging, not
  the legacy Connect intent).
- **D2. CMS quiet state:** Settings → Booking & payments: the Stripe key /
  Connect cards collapse to one "Online card payments: available later" note
  (keep `payAtVenue` message editing). Publish checklist + Stacy onboarding
  must not reference payment setup (check `lib/siteCompleteness.js` +
  `lib/stacyOnboarding.js`).
- **D3. No in-band fees, ever:** default `STRIPE_APPLICATION_FEE_BPS` and
  `SUBSCRIPTION_APP_FEE_PCT` to 0 in `config/stripe.js` with a comment citing
  COMMISSION_MODEL §2b (commission via invoice only), so a future re-awakening
  of the dormant paths cannot double-charge. Do not otherwise touch dormant
  Stripe code.
- **D4.** deploy.yml env: add `ONLINE_PAYMENTS_ENABLED=false` (the block
  REPLACES prod env — never omit existing vars).

## 6. Phase E — member lifecycle (portal + reminders + yoga)

- **E1. Member area v2** (`AccountPage.tsx` in crossfit/massage/spa; ADD the
  page + route + magic-link auth libs to **yoga** following the massage port
  pattern): membership card shows plan, status pill, **renew-by date**,
  "visits this period" (count bookings in the current period via the member
  read policies), payment history list (new payments table, member self-read).
  Hide "Manage billing" (Stripe portal) for venue subs. Fix the dead
  massage/spa "View plans →"/"Restart membership →" links: crossfit →
  `/memberships`; massage/spa → the home membership section anchor (add the
  anchor id if missing); yoga → its new plans surface (see E4).
- **E2. Renewal reminder sweeper:** extend `lib/lifecycleSweeper.js` (or a
  sibling following its pattern) with a venue-membership pass: (a) stamp
  `renewal_due` when `current_period_end < now` (active, venue, not
  cancel-at-period-end), `expired` when 14 days past; (b) send the member
  reminder at T-7d and T-0 (tenant brand mode, transactional register: no
  marketing opt-out gate, but standard footer; stamp sends in
  `site_subscriptions.metadata` so they fire once per period); (c) flip
  `cancel_at_period_end` subs to `cancelled` at period end. New builders in
  `templates/transactionalEmails.js` (`membershipRenewalReminder`,
  `membershipRenewed`, `membershipActivated`) + `/dev/preview` routes +
  preview walk (desktop AND mobile width).
- **E3. Owner digest:** monthly notification + email at the start of each
  month ("N renewals to confirm this month") and when items go overdue;
  deep-link to the Renewals view. Route through `cms_notifications` (bell) +
  mailer.
- **E4. Yoga membership surface:** render plans on the yoga template (a
  memberships page or home section following crossfit's PricingTiers usage,
  matching yoga's theme voice) with the Join flow from A4. Massage/spa
  real-plan rendering stays a FOLLOW-UP (per-site opt-in) — not in this arc.

## 7. Explicitly out of scope (do not build in this arc)

- Credits/entitlement ledger (class packs, "included with membership" booking,
  member pricing) — future arc, after this one proves out.
- Any repair/migration of Stripe checkout paths (booking or membership).
- Online deposits (the festive ~10% case) — future re-awakening of the
  dormant pipeline.
- Massage/spa display-tier → real-plan conversion (follow-up).
- The "Display only" services UX rework (labeled Online-booking switch) —
  separate small task, discussed 2026-08-05, awaiting its own go-ahead.

## 8. Defaults Peter can override (picked, not blocking)

- Grace before `expired`: **14 days**. Reminder timing: **T-7d + T-0**.
- Late confirmation keeps periods contiguous (anniversary preserved).
- Commission on membership cash is **confirmation-month based** (cash basis).
- Venue subs never show the Stripe billing portal; refunds for venue subs are
  out-of-band (no CMS refund button).

## Build log

_(Executor: append dated entries per task — what landed, what was verified,
fixtures cleaned. Commits only; no push without Peter.)_

### 2026-08-05 — A1 (schema) DONE

- **Pre-flight verification** (per ground rule 3 + the advisor checkpoint): the
  live DB matched §1b exactly before migrating — `collection_mode` absent,
  2 subscriptions both Stripe-linked, `site_subscription_payments` absent,
  `user_owned_site_ids()`/`is_stemfra_staff()`/`set_updated_at` all present. No
  deviation → no advisor escalation needed.
- **Migration `memberships_pay_at_venue`** applied via `apply_migration`:
  (1) `site_subscriptions.collection_mode text NOT NULL DEFAULT 'venue'`
  (CHECK venue|stripe); the 2 existing Stripe rows backfilled to `'stripe'`.
  (2) New table `site_subscription_payments` per §1b (unique
  `(subscription_id, period_start)`, two indexes, RLS enabled) with 3
  authenticated-only policies: owner_read (`user_owned_site_ids()` + staff),
  staff_all, member_read (via own `site_customers` → subscription). Writes are
  service-role only (no authenticated write policy).
- **Verified (SQL):** both subs now `collection_mode='stripe'` (so any NEW venue
  sub defaults `'venue'`); RLS enabled; exactly 3 policies, all `authenticated`,
  NO anon policy → anon reads nothing (deny by default).
- **Types hand-patched** (`packages/site-data/src/database.types.ts`):
  `collection_mode` added to the 3 `site_subscriptions` shapes; new
  `site_subscription_payments` table block (Row/Insert/Update + 2 FK
  relationships). Convenience exports added to `types.ts`: `SiteSubscription`,
  `SiteSubscriptionPayment`, `SiteSubscriptionPaymentInsert`.
- **CMS typecheck clean** (`tsc --noEmit -p stemfra_cms/tsconfig.json`, exit 0).
- Committed (no push): platform (types) + server (this plan doc). Migration is
  applied to the remote DB directly (Supabase MCP), not a repo file.
- **Next: A2** (server signup endpoint).
