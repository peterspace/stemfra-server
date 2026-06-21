# Stripe webhook — local testing & production setup

The webhook is the **robustness backstop** for the payments flow. It is NOT on
the critical path of a booking (the booking is written by `createBooking` after
`confirmPayment` succeeds) — it exists to catch the cases the happy path can't:
a paid-but-dropped booking, a refund, or a Connect-account status change.

- **Endpoint:** `POST /api/stripe/webhook`
- **Handler:** `controllers/stripeWebhookController.js`
- **Route:** `routes/stripeWebhook.js`
- **Mount:** `index.js` registers it with `express.raw({ type: '*/*' })` **before**
  the global `express.json()` — Stripe signature verification needs the raw,
  unparsed request body, so this ordering is load-bearing.

## Events handled

| Event | Action |
|---|---|
| `account.updated` | Sync `site_payment_accounts` (`charges_enabled`, `payouts_enabled`, `details_submitted`) by `stripe_account_id` — keeps the CMS Connect status fresh without polling. |
| `charge.refunded` | Set the matching booking's `payment_status = 'refunded'` (by `stripe_payment_intent_id`). |
| `payment_intent.payment_failed` | Log only. |
| `payment_intent.succeeded` | **Paid-but-dropped backstop.** If no booking has that PI after a 20s grace window (rules out a webhook-vs-`createBooking` race), log + email `NOTIFY_EMAIL` for manual reconcile. Does NOT auto-create the booking — the PI metadata only carries `site_id`/`service_id`, not the chosen slot/customer. Only fires for **booking** PIs (those carrying `metadata.service_id`), so subscription-invoice PIs don't false-alarm. |

### System A events (platform billing — Stemfra → business)

Both payment systems settle on Stemfra's own Stripe account, so these arrive at
the same endpoint and are routed by `metadata.kind === 'platform_billing'` (set
on the Checkout session + subscription). They update the top-level
`subscriptions` table.

| Event | Action |
|---|---|
| `checkout.session.completed` | Store `stripe_subscription_id`, set `status='active'`, `started_at`, and stamp `build_paid_at` (a completed subscription checkout means the first invoice incl. the build fee was paid). |
| `customer.subscription.created/updated/deleted` | Map Stripe status → `subscription_status` enum; update period dates + `cancel_at_period_end`/`cancelled_at`. |
| `invoice.paid` | Set `status='active'`; stamp `build_paid_at` on the first invoice. Looks up the row by **`stripe_customer_id`** (race-proof — `invoice.paid` can precede `checkout.session.completed`). |
| `invoice.payment_failed` | Set `status='past_due'` (dunning). |

Auto-creating the dropped booking (via enriching the PaymentIntent metadata with
the full booking payload, then replaying the booking engine) is a documented
future refinement, not built.

## Local testing

The webhook only fires for real on a public URL, so locally we use the **Stripe
CLI** to forward live test-mode events to `localhost`.

### One-time: install the CLI (no Homebrew)

Homebrew install can fail on an unrelated tap-trust snag (`mongodb/brew`), so we
install the binary directly:

```bash
# find the latest macOS asset + your arch, then download/extract:
curl -fsSL -o /tmp/stripe.tar.gz \
  https://github.com/stripe/stripe-cli/releases/download/v1.42.13/stripe_1.42.13_mac-os_x86_64.tar.gz
mkdir -p ~/.local/bin
tar -xzf /tmp/stripe.tar.gz -C ~/.local/bin stripe
~/.local/bin/stripe version   # -> stripe version 1.42.13
```

(For Apple Silicon use the `_arm64` asset; the `_x86_64` build also runs via
Rosetta. Check the latest release tag at github.com/stripe/stripe-cli/releases.)

### Each session: forward events to the local server

```bash
# 1. Start the server (loads .env, listens on :4000)
npm run dev

# 2. In another shell, forward Stripe test events to the webhook.
#    --api-key reads the secret from .env at runtime so it never appears in shell history:
~/.local/bin/stripe listen \
  --api-key "$(grep -E '^STRIPE_SECRET_KEY=' .env | cut -d= -f2)" \
  --forward-to localhost:4000/api/stripe/webhook
```

`stripe listen` prints a **webhook signing secret** (`whsec_…`). Put it in `.env`
and restart the server so signature verification passes:

```
STRIPE_WEBHOOK_SECRET=whsec_…
```

> The `whsec_` printed by `stripe listen` is a **local CLI test secret** — it is
> NOT the production webhook secret (see below). It's stable per machine/CLI, so
> you usually only paste it once.

### Trigger test events

```bash
# fires a fresh payment_intent.succeeded (no matching booking) -> orphan backstop
~/.local/bin/stripe trigger payment_intent.succeeded \
  --api-key "$(grep -E '^STRIPE_SECRET_KEY=' .env | cut -d= -f2)"
```

In the `stripe listen` shell every forwarded event should show `[200]` (a `[400]`
means the signing secret is wrong). The orphan backstop logs
`[stripe.webhook] ORPHAN PAYMENT …` ~20s later (and emails `NOTIFY_EMAIL`).

## Production setup

The CLI is for local dev only. In production, Stripe delivers to the public URL:

1. **Stripe Dashboard → Developers → Webhooks → Add endpoint**
   - URL: `https://api.stemfra.com/api/stripe/webhook`
   - Events: `payment_intent.succeeded`, `payment_intent.payment_failed`,
     `charge.refunded`, `account.updated`
2. Copy that endpoint's **signing secret** (`whsec_…`) into the production env —
   i.e. add `STRIPE_WEBHOOK_SECRET` to the `environment-variables` block in
   `.github/workflows/deploy.yml` (it REPLACES the panel on each deploy, so any
   omitted var gets wiped).
3. After deploy, send a test event from the Dashboard and confirm a `200`.

If `STRIPE_WEBHOOK_SECRET` is unset the handler acknowledges with `200` but skips
processing (logs a warning) — so a missing prod secret fails safe (no crashes)
but silently drops the backstop. Don't forget step 2.
