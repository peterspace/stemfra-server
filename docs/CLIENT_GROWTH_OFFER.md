# The Client Growth Engine — the Stemfra offer (retention-first)

_Created 2026-08-27 from Peter's research note. Companion to `OFFER_TIERS.md`
(tier/pricing history) and `stemfra_pricing_system/TIER_VERSIONS.md` (design
history). This doc is the OFFER NARRATIVE: what we promise a client and the
order we build it in. The commission model stands: free to build, free to
publish, Stemfra earns 5% on bookings (pay-at-venue, invoice-only)._

**Positioning line:** We don't just build your website. We keep your chairs full.

**The strategic shift (Peter, 2026-08-27):** the offer is not a website, it is
a flywheel that STARTS with the clients a business already has. Retention
first, then reviews, then ranking, then new clients. Most competitors sell
acquisition; we sell retention and acquisition falls out of it.

---

## 1. The client-facing offer

### The foundation: a website that books for you
A professionally designed website with 24/7 online booking, SEO built in from
day one. Free to build, free to publish. Stemfra earns 5% on bookings, so we
only win when you do.

### The launch: bring your existing clients with you
Import your client list and every one of them gets a message: "We have a new
website, book your next visit in seconds." Your existing base becomes online
bookers in week one, not month six.

### The reputation loop: every visit builds your rating
After each appointment, an automatic review invitation by email or SMS.
Five-star Google reviews stack up, your Google Business Profile climbs, and
new clients searching "barber near me" find you first, backed by a website
Google already ranks.

### The retention net: no client slips away
- **We miss you:** a warm, no-pressure note when someone has not visited in a
  month. It reads as care, not sales.
- **Birthday and anniversary:** a greeting on their birthday, and on the
  yearly anniversary of their first visit.
- **Seasonal:** Christmas, New Year, Thanksgiving, July 4th.

### The flywheel, stated plainly
Clients who feel remembered come back more often. More visits mean more review
invitations. More five-star reviews mean higher Google ranking. Higher ranking
brings new clients, who enter the same loop.

---

## 2. Build map (internal) — CORRECTED 2026-08-27 after code verification

⚠ The first version of this table guessed from memory and was WRONG: the N4
lifecycle arc already shipped most of the offer. Verified against
`lib/lifecycleEmails.js` + `lib/lifecycleSweeper.js` (running in prod via
index.js) + the CMS EmailsSection/CustomersPage; a live test send passed
end-to-end on clean-cuts 2026-08-27.

| Piece | Status | Notes |
|---|---|---|
| Website + booking + SEO | ✅ live | Templates, native scheduler, prerender/meta/JSON-LD |
| Booking reminder emails | ✅ live | bookingReminderSweeper (24h/2h) |
| Post-visit Google review request | ✅ SHIPPED (N4) | Auto: ~2 days after a visit, ONCE-EVER per customer; owner sets the Google link + per-email discount in CMS Notifications → Automated emails; manual per-client send on the Clients page kebab; live-verified 2026-08-27 |
| Client CSV import | ✅ SHIPPED | CMS Clients → Import panel (column mapping + preview) + admin variant |
| "We miss you" win-back | ✅ SHIPPED (N4) | Fires at ~60 days lapsed (Peter's note says 1 month — knob decision below) |
| Birthday + first-visit anniversary | ✅ SHIPPED (N4) | Birthday once/year from site_customers.birthdate; anniversary ~365d after first visit; plus first-visit follow-up + no-show emails (bonus) |
| **Import ANNOUNCEMENT blast** | ✅ SHIPPED 2026-08-27 | `lib/announcementEmail.js` + `POST /api/cms/customers/announce` + the post-import button; once-ever per customer, batches of 200, live sites only; carries the **SMS opt-in link** (`/api/site-emails/sms-optin`, signed token → sms_opt_in + consent timestamp/source). Live-verified E2E on clean-cuts (send + opt-in click) |
| **Seasonal holiday messages** | 🟡 BUILD 2 (next) | Christmas, New Year, Thanksgiving, July 4th; fixed calendar, per-site toggle, owner-editable copy |
| SMS variants of lifecycle emails | 🟡 later | Lifecycle is email-only today; SMS needs per-customer opt-in (captured by the announcement + booking flow) |

**Knob decisions (settled 2026-08-27, Peter: "go on as you recommend"):**
1. Win-back timing: now PER-SITE (CMS Notifications → Automated emails →
   Win-back → "Send after N days", 14–180) with the default moved 60 → 30.
2. Review-ask frequency: stays ONCE-EVER automatic + the manual re-send on the
   Clients page (per-visit asks risk unsubscribes and review-gating optics).

## 3. Compliance rails (bake in from day one)

- **SMS to imported lists requires opt-in.** The announcement EMAIL is the
  opt-in collector ("Prefer texts? Tap here"). Never text imported numbers
  cold (see the 2026-08-27 cold-call post-mortem: TCPA + carrier filtering).
- **No review gating.** The review invitation goes to EVERY completed
  appointment, not only happy clients. Google explicitly prohibits selective
  asking; gating risks the client's GBP listing.
- **Every message carries unsubscribe/STOP** and honors `email_opt_out` /
  SMS STOP. Transactional (booking confirmations/reminders) stays separate
  from marketing suppression.
- Voice policy (2026-08-27): **Mark is INBOUND-ONLY.** All outbound AI call
  paths sit behind `crm_settings.leadgen_auto_call` (OFF). Outbound calls are
  made by a HUMAN via the CRM dialer or a personal line.

---

## 4. Human cold-call scripts (based on this offer)

_For Peter or a human caller, from the registered Twilio number (CRM dialer)
or a personal line. Rules: under 3 minutes, one ask at a time, never pressure,
log do-not-call requests in the CRM immediately, only text the claim link
after a clear yes on the call._

### Script 1 — "The website is already built" (direct opener, default)

**Open:**
"Hi, is this the owner of [Shop Name]? ... Great. My name is [Name], I'm
calling from Stemfra. I'll be quick. We build websites for barbershops, and we
actually already built one for [Shop Name]. It has online booking built in and
it's completely free. Can I text you the link so you can see it?"

**If yes:** "Perfect. I'm sending it to this number right now. It takes about
a minute to claim, there's nothing to pay, and the site is yours. Any
questions, just call this number back. Thanks [Name]!"

**If "what's the catch":** "Fair question. The website is free, publishing is
free. We only make money when the site makes YOU money: 5% on bookings that
come through it. No bookings, you pay nothing."

**If "I already have a website":** "That's good to hear. Quick question then:
when a client books with you today, do they call, or can they book themselves
online any time? ... That's the part we solve. And ours also asks every happy
client for a Google review automatically, which is what moves you up when
people search 'barber near me'. Worth a look? I can text the link."

**If busy:** "No problem at all, I'll be two more seconds. I'll text you the
link and you can look whenever suits you. Is that okay?" (Only text on a yes.)

**If not interested / stop calling:** "Understood, no problem. I'll make sure
you're not contacted again. Have a good one." (Mark do-not-call in the CRM
before the next dial.)

### Script 2 — "Your client list isn't working for you" (established shops)

**Open:**
"Hi, is this the owner of [Shop Name]? ... My name is [Name] from Stemfra.
Quick question, and then I'll let you go: roughly how many clients have come
through your chairs over the years? Hundreds, right? ... Here's why I ask.
Most shops your age are sitting on a client list that does nothing for them.
We turn that list into repeat visits: when a regular hasn't been in for a
month, they get a friendly 'we miss you' text. Birthdays get a message.
After every cut, clients get asked for a Google review. All automatic."

**Bridge to the site:** "It all runs on a website we've already built for
[Shop Name], with online booking, and the website itself is free. Can I text
you the link so you can see your site?"

**If "my clients just walk in":** "And they'll keep walking in. This is about
the ones who DIDN'T come back last month. One returning regular a week pays
for itself many times over, and it costs you nothing up front. Want the link?"

**Close / objections / exit:** same as Script 1.

### Script 3 — "The Google reviews angle" (low rating or few reviews)

_Use when the lead data shows few reviews or a strong competitor nearby._

**Open:**
"Hi, is this the owner of [Shop Name]? ... My name is [Name] from Stemfra.
I was looking at barbershops in [neighborhood] on Google and noticed
[Shop Name] has [N] reviews while [competitor / 'some shops nearby'] have
hundreds. That gap is why they show up first when someone searches 'barber
near me'. We fix that: after every appointment booked through your website,
your client automatically gets a text or email asking for a Google review.
Happy clients actually leave them when you ask right away."

**Bridge:** "The website is already built for [Shop Name], online booking
included, and it's free. Can I text you the link to see it?"

**If "reviews don't matter":** "Totally your call. But when someone new moves
to the neighborhood, the shop with 200 five-star reviews gets the walk-in.
It costs nothing to try, and the site is already done. Want the link?"

**Close / objections / exit:** same as Script 1.

### Voicemail (any script, keep under 20 seconds)
"Hi, this is [Name] from Stemfra. We built a free website for [Shop Name]
with online booking. I'd love to text you the link. Call me back at this
number any time. Thanks!"

---

## 5. Remaining build order (corrected — most of the plan already shipped)

1. **Import announcement blast** ("your barber has a new website, book online
   any time") — sent optionally after a CSV import; collects SMS opt-in.
2. **Seasonal holiday messages.**
3. **SMS variants of the lifecycle emails** (after opt-in capture exists).

Everything else in the offer is live: the sales pitch can promise the full
flywheel TODAY. Each automation is a per-site toggle in CMS Notifications →
Automated emails, with per-email discounts, and every send honors opt-outs.
