# Offer & tiers — what we sell vs. what ships today

_Decision 2026-06-29: the public pricing page lists ONLY what ships today
("trim"); intended/roadmap features are kept and re-added to the page as they land._

> **Tier design history (V1 → V2 → V3):** see
> `stemfra_pricing_system/TIER_VERSIONS.md` (next to the Squarespace/Mindbody/Wodify
> analysis). The status mirror below = current **V2**; V3 ("generous core + growth
> tiers", Voice dropped from client tiers) is the next target. Roadmap: ROADMAP.md **P8**.

## ✅ Now server-driven (implemented 2026-06-29)
The offer below is **no longer hardcoded** — it lives in the DB plan catalog
(`crm_settings.billing_plans`) and is edited in the **CRM → Billing → Offer & plans**
(`/billing/plans`). Each feature carries a `status`:
- **live** → shown on the public page.
- **gated** → needs Stripe Connect (payments/memberships/promo/revenue). Hidden on a
  live tier; flip to `live` in the CRM when Connect is on — no deploy.
- **soon** → not built yet. Hidden on a live tier.
A tier with `coming_soon: true` renders as a **waitlist card** and shows ALL its
features (aspirational). `stemfra_client/.../verticals.js` is the structural
**fallback** only (server down / first paint). The ✅/🔴/🟡 table below is the
human-readable mirror of those status flags — keep it roughly in sync, but the DB
catalog is the source of truth.

**Pro = Coming soon** (decided 2026-06-29): we sell Essential + Growth; Pro is a
waitlist card until voice-booking ships (set `pro.coming_soon=false` in the CRM to
launch it).

## The gate
The big deferred capability is **System B — clients taking card payments from
THEIR customers via Stripe Connect** (waiting on Stripe verification). Anything
that depends on the business *getting paid through Stemfra* is not deliverable yet.

## Feature status (full intended set)
✅ = ships today · 🔴 = payment-gated (needs Stripe Connect) · 🟡 = not built yet

**Essential ($99)**
- ✅ Designed, mobile-first website for the industry
- ✅ Free custom domain (or transfer your own)  *(buy-a-domain from CMS = 🟡, no registrar connected)*
- ✅ 24/7 online booking (free services native; priced → link out to their system)
- 🔴 Card payments at booking, paid to their bank
- 🔴 Memberships, class packs & drop-ins (recurring billing)
- 🟡/🔴 Member accounts (booking ok; "manage their plan" = memberships = gated)
- ✅ Owner dashboard (CMS)
- ✅ Leads inbox + bookings calendar + client list
- ✅ Automated email booking confirmations & reminders
- 🟡 Client intake forms & waivers
- ✅ Works alongside their current system
- ✅ Done-for-you setup + ongoing updates
- ✅ Stacy (AI dashboard assistant — answers + drafts; S3 "act" not built)
- ✅ Email & chat support

**Growth (+$199)**
- ✅ Front Desk — 24/7 AI chat receptionist (answers from live data, captures leads, books free services)
- 🔴 Promo codes & discounts
- ✅/🔴 Owner analytics — bookings/services/new-vs-returning ✅; **revenue** 🔴
- 🟡 Class waitlists & capacity

**Pro (+$399)**
- 🟡 AI Voice Receptionist — voice agent answers as the business + captures;
  **booking-in-call + missed-call forwarding NOT built** (Voice deliberately doesn't book)
- ✅ SMS appointment reminders
- 🟡 Custom business email (you@yourbusiness.com) — no mailbox provisioning yet
- ✅ Priority + phone support

**Core strip ("every plan includes")** — "Payments through your own Stripe" 🔴
and "Memberships & member accounts" 🔴 are gated; the rest ✅.

## Trimmed LIVE set (what the page shows now)
**Essential** — designed site · free domain · 24/7 online booking · owner dashboard ·
leads inbox + bookings calendar + client list · email confirmations/reminders ·
works alongside your current system · done-for-you setup + updates · Stacy · support.
**Growth (+)** — Front Desk AI chat · owner analytics (bookings/services) · priority new themes.
**Pro** — **Coming soon / waitlist** (decided 2026-06-29). Shown as a waitlist card
with its aspirational features (AI Voice Receptionist, custom email); not sellable
until voice-booking ships. Was too thin to sell (only SMS reminders + priority
support are deliverable today).

Core strip → drop the Stripe-payments + memberships cards until Connect is live.

## Re-add when ready
- Stripe Connect live → card-at-booking, memberships/packs/drop-ins, promo codes,
  revenue analytics, the core "payments" + "memberships" cards.
- Voice-booking + missed-call forward → restore the Pro AI Voice Receptionist line.
- Mailbox provisioning → custom business email. Registrar integration → buy-a-domain.
- Intake/waivers, class waitlists → when built.
