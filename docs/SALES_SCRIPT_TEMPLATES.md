# Sales Script Templates — patterns for human reps & the Voice agent

**Reusable call/pitch structures for Stemfra, written for Stemfra's own
product and leads.** Indexed in the [docs hub](../../docs/README.md).
Companion docs: [OUTREACH.md](OUTREACH.md) (the email cadence these calls
follow up on) and [VOICE_AGENT.md](VOICE_AGENT.md) (where the AI agent's
qualification prompt lives — `lib/voiceBrain.js`).

**Where this came from:** technique-level inspiration from a 2026-07-22
podcast watch (`stemfra_video/mwMQLJ5GoRM/notes.md` — Kai Stone / Stone
Systems, a $509K/mo GoHighLevel reseller). The scripts below are original —
written from scratch for Stemfra's product, price points, and leads — not
transcribed from that video. Two structural ideas are worth crediting: **send
a short video before the call so the prospect arrives pre-sold**, and **close
by absorbing objections one at a time with "what questions do you have?"**
rather than a scripted pitch-then-close.

---

## 1. Pre-call video (send before every discovery/demo call)

The idea: a prospect who has already watched a 2–3 minute walkthrough arrives
relaxed and informed, not defensive — the call becomes Q&A + close, not a
cold pitch. Applies to Stemfra's warm outbound (reply-triggered AI calls,
`lib/leadgenCall.js`) and to any human demo call booked from the CRM.

**Video outline (2–3 min):**
1. **Pattern interrupt (5s):** "If you've got a website already, this is
   probably not what you think it is — thirty seconds."
2. **One real example, feature → outcome pairs** (pick 2, not a feature dump):
   - *Feature:* "Every booking gets an automatic reminder text."
     *Outcome:* "That alone is usually the difference between a no-show and a
     paying customer — most missed-appointment revenue comes back on its own."
   - *Feature:* "The site answers booking questions and takes appointments
     24/7, even when you're with a client or asleep."
     *Outcome:* "You stop losing the customer who called at 9pm and gave up
     because no one picked up."
3. **The number, no hedging:** "It's $X a month, no setup fee to start free."
4. **The close line:** "Watch the whole thing — if it's not for you, just
   tell me and I'll cancel the call. If it looks good, I'll see you at
   [time]."

## 2. Warm-open template (referencing a real, named source)

Stemfra rarely needs a *cold* open — outbound calls are reply-triggered
(the lead already emailed back) or demo-booked. Use this shape for the rare
genuinely-cold local outreach call (e.g. a referral from an existing client
in the same city/vertical), and always with a REAL name — never invent one:

> "Hi, is this [Name]? This is [Rep] from Stemfra — [Existing Client], who
> uses us for [their shop], mentioned you might be looking to get your
> booking online. Is now an OK time for two minutes?"

If there's no real referral, skip the referral framing entirely and lead with
the outcome instead: "Hi [Name], quick one — are you still handling all your
bookings by phone/DM?" Never fabricate a referral source; Stemfra's brand is
the done-for-you, trustworthy alternative — a fake name undercuts that on
the very first sentence.

## 3. The absorb-objections close (for the call itself, after the video)

```
REP: Did you get a chance to watch the video I sent?
LEAD: Yeah.
REP: Great — what questions do you have?
```

Then, ONE question at a time, in the lead's own order — don't pre-empt with
a rehearsed objection list. When they run out of questions:

> "Anything else you need before we get your site started today?"

Then straight to the close — the free preview signup, or the paid tier if
they're ready — never a re-pitch after they've said they have no more
questions. If the answer to "what questions do you have?" is "I don't have a
website issue" or "I'm not looking right now," say so back honestly and ask
if a follow-up in N weeks/months makes sense — don't push.

## 4. Feature → outcome bank (Stemfra-specific, for both video and live use)

| Feature | Outcome framing |
|---|---|
| Free preview before paying | "You see your actual site before spending a cent — nothing to lose by trying." |
| 24/7 AI receptionist / booking | "Bookings and questions get handled at 11pm on a Sunday, not just during business hours." |
| Automatic reminder texts | "Fewer no-shows without you having to chase anyone." |
| Missed-call text-back | "A call you couldn't answer still turns into a booked appointment." |
| Done-for-you setup | "You're not learning software — someone builds and maintains it for you." |
| One flat monthly price | "No surprise line items — you know the cost before you start." |
| Google listing connection | "You've already got the Google reviews — we point that listing at your new site so people can Book straight from Google." |

### Google Business Profile — say this on every setup call (Task #23)

Our lead-gen prospects already have a Google listing (that's how we found them) —
it's their single biggest source of "found on Google." Closing the loop is a
strong, concrete value-add to offer live on the setup call:

- **Have a listing (most lead-gen prospects):** *"On this call we'll also connect
  your Google listing to your new site — set the Website field to your site and
  add your booking link so a **Book** button shows up right on Google. Takes two
  minutes and it's where most of your searches come from."* Do it live via
  screen-share, or ask them to add you as a **manager** on the profile.
- **No listing yet (newer businesses):** *"You don't have a Google listing yet?
  That's the first thing we'll fix — it's free and it's how local customers find
  you. We'll create and claim it together, then point it at your new site."*
- Keep **name / address / phone identical** on Google and the site (Google trusts
  matching details). The CMS **Google Business Profile** page shows the owner the
  exact website + booking URL + their NAP to paste — walk them through it there.

## 5. Objection lines (honest, no overreach)

- **"I already have a website."** → "Totally fine — a lot of our clients did
  too. The question is usually whether it's actually booking appointments for
  you around the clock, or just sitting there. Want to see what that would
  look like?"
- **"I don't have time to deal with a new website."** → "That's exactly why
  it's done-for-you — we build and manage it. Your part is a 15-minute call."
- **"How do I know it'll work for my business?"** → Never guarantee a
  result Stemfra can't back — echo the honesty norm from `voiceBrain.js`:
  point to the free preview and the specific features, not a promised outcome.

---

## Applying this to the Voice agent

`lib/voiceBrain.js`'s `buildSystemPrompt` already carries a lightweight
version of §3/§4 (its QUALIFICATION block + outcome-led plan pitching). If/when
Phase 1's qualification-schema quick win (`docs/VOICE_AGENT.md`) is built out
further, these feature→outcome pairs and the objection lines above are the
canonical source to prompt-engineer from — keep the prompt's phrasing
consistent with this doc so a human rep and the AI receptionist never
contradict each other on offer framing.
