# Stemfra Voice Agent — Baseline Scorecard & Roadmap

_Created 2026-07-21 (Peter + Claude). This doc is the single source of truth for
the Voice agent's maturity: a DATED baseline scorecard measured against two
industry evaluations, and the prioritized roadmap that closes the gaps. When the
agent improves, re-score against the same tables and append a new dated column —
never overwrite the baseline._

Benchmarks used (read in full, 2026-07-21):

- Retell AI — "I Tested the Top AI Voice Agents for **Customer Support** in 2026"
  <https://www.retellai.com/blog/best-ai-voice-agents-for-customer-support>
- Thoughtly — "7 Best AI Voice Agents for **Outbound Sales Calls** in 2026"
  <https://thoughtly.com/blog/best-ai-voice-agents-for-outbound-sales-calls-2026>

Reference numbers from the articles worth keeping in view:

- Well-built support agents resolve **40–70% of inbound calls without escalation** (Retell).
- Leads called **within 60 seconds** of a form fill convert **5–10×** better than after five minutes (Thoughtly).
- **60–70% of outbound calls are not picked up** — multichannel follow-up is what recovers them (Thoughtly).

## What exists today (2026-07-21)

One agent: **"Mark with Stemfra"** — Stemfra's OWN sales/marketing phone
receptionist. Files: `routes/voice.js` → `controllers/voiceController.js`
(Twilio ConversationRelay WebSocket at `/voice/relay`) → `lib/voiceBrain.js`
(GPT-4o streaming, concierge marketing knowledge) · outbound warm calls via
`lib/leadgenCall.js` (manual CRM "Call with AI" + auto reply-sweeper trigger).

- Inbound: streaming replies, barge-in (interruptible/high sensitivity), AI-disclosure
  honesty, grounded answers (never invents pricing), stepwise contact capture with
  spell-back, deep in-call memory (60-message window + never-re-ask rule + caller-ID
  awareness — all fixed 2026-07-21 after the "it kept re-asking my email" call).
- Outbound: warm follow-up only (lead replied to outreach). FCC AI disclosure up
  front, opt-out handling, US-business-hours gate. No cold dialing by design.
- Post-call: `extractLead` distills the transcript → CRM `leads` insert
  (name/email/phone/vertical/summary/wants_followup, `source: voice_call`).

**It is NOT a support agent**: no caller authentication, no account lookup, no
password reset, no billing lookup, no ticketing, no live transfer — and a support
call that leaves details is currently filed as a NEW SALES LEAD (wrong queue).
It also is not the per-tenant "never miss a call" agent for client businesses.

## Baseline scorecard — 2026-07-21

Legend: ✓ have it · ◐ partial · ✗ missing. Re-score by appending a dated column.

### A. Evaluation criteria (how the articles score an agent)

| # | Criterion (source) | What they test | 2026-07-21 |
|---|---|---|---|
| 1 | Voice quality & call-flow realism (Retell) | Natural over long calls, pacing, tone stability, interruption recovery | ◐ stock Twilio voice; barge-in + recovery solid |
| 2 | Intent recognition & context retention (Retell) | Intent shifts, follow-ups, remembering without repeating | ✓ (60-msg memory, never-re-ask, caller-ID) |
| 3 | Edge-case handling & recovery (Retell) | Partial answers, contradictions, pauses, off-script, graceful recovery | ◐ prompt rules; never stress-tested |
| 4 | Support-specific integrations (Retell) | CRM, ticketing, calendars, internal tools; record updates | ◐ own CRM insert-only; no ticketing/calendar/tools |
| 5 | Setup complexity & iteration speed (Retell) | Build/test/adjust/redeploy quickly, by the support team | ◐ code-first, developer-only |
| 6 | Reliability, latency & stability (Retell) | Response times, dropped calls, repeated-test behavior | ◐ streaming + warm-up good; unproven under load |
| 7 | Compliance & data handling (Retell) | Compliance posture, recording controls, access management | ◐ FCC disclosure/opt-out/hours on outbound; no SOC2/HIPAA/recording controls |
| 8 | Speed-to-dial & pacing (Thoughtly) | Sub-60s trigger-to-ring, webhook-triggered dialing, dialing modes | ◐ reply-triggered but 180s sweeper; no modes |
| 9 | Conversation quality & qualification logic (Thoughtly) | Engaging, turn-taking, defined qualification schemas navigated unscripted | ◐ conversation ✓; no qualification schema |
| 10 | CRM & workflow integration (Thoughtly) | Structured dispositions (qualified/DNQ/callback/voicemail/no-answer) → records, tasks, stages, workflows | ◐ lead+summary only; no dispositions; outbound doesn't update source lead |
| 11 | Multichannel follow-up (Thoughtly) | SMS after missed call, email summary after call, channel-retry cadence | ✗ |
| 12 | Compliance & consent (Thoughtly) | TCPA, DNC scrubbing, consent capture, hour windows, recording disclosure | ◐ disclosure/opt-out/hours ✓; DNC/TCPA/consent ✗ |
| 13 | Pricing transparency (Thoughtly) | Per-call economics | n/a (internal agent) |

### B. Tasks/functions the articles expect a voice agent to execute

| Task / function (source) | 2026-07-21 |
|---|---|
| **Support tasks (Retell)** | |
| Natural inbound conversation, not IVR menus | ✓ |
| Follow-ups, remembered answers, multi-step flows without transfer | ✓ |
| Check order/subscription status | ✗ |
| Reset passwords | ✗ |
| Update/change appointments | ✗ |
| Answer billing questions | ◐ generic pricing only |
| Route calls intelligently | ✗ |
| Escalate to human with full context / clean summary | ✗ |
| Authenticate callers / account verification | ✗ |
| Update records in CRM | ◐ creates new leads only |
| Trigger downstream workflows | ✗ |
| Structured post-call summary (issue type, resolution, sentiment, next steps) | ◐ summary/vertical/wants-follow-up; no sentiment/resolution; transcript not stored |
| Refunds & basic troubleshooting | ✗ |
| Knowledge-base grounding | ✓ (marketing knowledge only) |
| Book appointments | ✗ |
| Benchmark: resolve 40–70% without escalation | unmeasured |
| **Outbound tasks (Thoughtly)** | |
| Trigger-called within 60s of a lead event | ◐ (~3-min sweep) |
| Qualify against a defined script/schema | ◐ loose |
| Book a meeting / schedule a callback on a calendar | ✗ |
| Voicemail detection + voicemail drop | ✗ |
| Same-agent voice+SMS+email cadence with carried context | ✗ (◐ credit: email-read-gated call) |
| SMS after missed call / email summary after call | ✗ |
| Escalation rules (risk/urgency → human) | ✗ |
| Consent capture + DNC scrub + hour windows + recording disclosure | ◐ |
| Dynamic objection handling (LLM, not scripts) | ✓ |
| Surface only qualified prospects to humans | ◐ |
| Appointment confirmations / aged-pipeline re-engagement | ✗ |
| Call analytics: scoring, sentiment, dashboards, stored transcripts | ✗ |

**Baseline tally (2026-07-21): ✓ 7 · ◐ 15 · ✗ 16.** Strong conversational core;
thin on everything around the call (actions, escalation, dispositions,
multichannel, analytics, compliance machinery).

## Prioritized roadmap

The strategic unlock: **Stacy (CMS copilot) and Front Desk (site chat) already
hold the hard pieces** — `lib/stacyContext.js buildSiteContext` (full per-site
context, live-read), the server-orchestrated tool loop (`lib/frontdeskBooking.js
runBookingTool`, shared `computeAvailability`/`placeBooking` cores), Stacy's
confirm-before-act action relay, and the CMS-routes single source
(`lib/cmsRoutes.js`). Extending Voice = plumbing these EXISTING libs into the
voice relay, not new invention.

### Phase 0 — Correctness fixes ✅ DONE 2026-07-21 (same day as baseline)
1. **Support-call routing**: teach the persona to distinguish
   prospect / existing-customer-support intents; support calls → email to
   `support@stemfra.com` + CRM note tagged support — NOT a `new_lead` insert.
   Honest phrasing on-call ("I'll pass this to our support team today").
2. **Persist the transcript** on the lead/call record (foundation for QA + analytics).
3. **Structured outcomes v1**: extend `extractLead` with disposition
   (qualified / not-qualified / callback / support / no-interest), sentiment,
   plan-discussed.
4. **Outbound calls update the SOURCE lead** (dedup) instead of inserting a new one.

### Phase 1 — Sales quick wins ✅ DONE 2026-07-21 (verified same day)

**Phase 1.5 (added 2026-07-22, P12 Wave 1):** CRM "Call with AI" gains an
optional "Reason for this call" (→ `REASON FOR THIS CALL (from staff): …` in
Mark's context) and `buildLeadContext` is enriched with the lead's history —
recent `activity_feed` entries (Phase 0 persists call transcripts +
dispositions there, so Mark remembers prior calls), the outreach email thread,
and recent notes, compacted to ~1.5–2K tokens. Assembled at call placement;
zero latency cost.
5. **Sub-60s speed-to-lead**: trigger the warm call from the inbound-reply event
   itself, not the 180s sweeper (the 5–10× conversion stat).
6. **Live transfer**: mid-call `<Dial>` to Peter in business hours, with the
   summary SMS'd to staff; falls back to today's "teammate will follow up."
7. **Same-agent follow-up**: post-call recap email to the captured lead (the new
   chocolate Stemfra templates); SMS after a missed outbound call.
8. **Voicemail detection + AI voicemail drop** on outbound.
9. **Qualification schema** in `leadContext` (vertical, timeline, current
   tooling, interest level) → feeds the Phase-0 dispositions.

### Phase 2 — Support abilities ✅ DONE 2026-07-22 ("a barbershop owner calls about their account")
10. **Caller identification**: caller-ID → contacts/sites lookup; soft-identified
    callers get account-context answers; sensitive actions require verification
    (e.g. confirm registered email; never speak secrets).
11. **Account context via Stacy's builder**: reuse `buildSiteContext` so the agent
    can answer "is my site live / what plan am I on / when is my invoice due"
    (site status, subscription, `billing_charges`).
12. **Action tools** (server-orchestrated loop, one extra round-trip max — the
    Front Desk pattern): trigger password-reset email (Supabase — safe, nothing
    spoken), open a support ticket (site_activity + support@ email), request a
    call-back. Confirm-before-act, like Stacy's clone action.

### ~~Phase 3 — Tenant voice~~ ❌ RETIRED (Peter, final 2026-08-04: no tenant voice agent, ever — Mark stays Stemfra-internal only; struck everywhere to prevent the mistake recurring)
_First retired 2026-07-27 by the P13 pivot (cost; Front Desk CHAT covers tenants),
made final and unconditional by Peter 2026-08-04. Do NOT spec, build, or resequence
this — an audit found three docs still treating it as live after the retirement,
which is exactly how a dead plan gets rebuilt. The section below is kept struck-out
as the historical scope record only._

~~RESEQUENCED 2026-07-22 (P12): Phase 3 runs AFTER P12 Waves 1–2. Scope included
browser-voice (Stacy call tier B): Twilio Voice JS SDK in the CMS → TwiML App →
this same ConversationRelay, with identity from the CMS login._
13. Per-site phone numbers; resolve the SITE from the dialed number.
    **DECISION 2026-07-23 (Peter): dedicated Twilio number per opt-in tenant**
    (not shared-number routing) — provision one number per site at opt-in,
    resolve the site directly from the dialed `To`. Accept ~$1–2/mo per number +
    a provisioning step. (Moot since the 2026-08-04 final retirement — recorded for history.)
14. Reuse the Front Desk brain over the voice relay: `buildSiteContext` grounding
    + `runBookingTool` — book free services on the phone; priced services get an
    SMS'd booking link. Tenant persona/branding; owner opt-in via CMS setting
    (mirror `frontdesk_enabled`).
15. This phase is what makes the answer to "can our voice agent serve every
    business on the platform" become YES.

### Phase 4 — Scale, analytics, compliance
16. CRM call-analytics surface: transcripts, dispositions, sentiment, resolution
    rate (measure the 40–70% benchmark for real).
17. DNC/TCPA/consent machinery — REQUIRED before any colder outbound.
18. Premium voice (TTS options/cloning), load testing, sampled AI-QA reviews.

_Rule of thumb for sequencing: Phases 0–1 sharpen the SALES agent we already
have; Phase 2 makes support calls honest and useful; ~~Phase 3~~ (retired — no
tenant voice, ever); Phase 4 (Mark-internal analytics/compliance) rides on real
volume._


## Changelog

- **2026-07-21 — Phase 0 shipped** (all four items, verified by scripted LLM
  regressions + a controlled DB roundtrip):
  1. Support-intent routing: persona handles existing-customer support honestly
     (no pitching, promises same-day email); `extractLead` v2 classifies
     `intent`/`disposition`; support calls → `staffVoiceSupportNotification`
     email to `SUPPORT_EMAIL` (default support@stemfra.com) + activity entry —
     NO sales-lead insert.
  2. Transcripts persist on every finalized call (`activity_feed` `voice_call`/
     `voice_call_support` entries, `details.transcript`, 8k cap).
  3. Structured outcomes v1: disposition (qualified/not_qualified/
     callback_requested/support_request/no_interest), sentiment, plan_discussed
     — in the lead notes + activity details.
  4. Outbound dedup: `leadgenCall` passes `leadId`; finalize UPDATES the source
     lead (`appendLeadNote`) instead of inserting a duplicate.
  Affected scorecard rows (reflect at next full re-score): "Structured post-call
  summary" ◐→✓ · "Update records in CRM" ◐ improved (source-lead updates) ·
  "CRM & workflow integration (Thoughtly #10)" ◐ improved (dispositions, no dups)
  · "Call analytics" ✗→◐ (transcripts + dispositions stored; no dashboard yet).
  NOT yet deployed to production (push pending with the email redesign).

- **2026-07-21 — Phase 1 shipped** (implemented in a parallel session following
  this doc; verified end-to-end by scripted probes + live webhook curls):
  5. Sub-60s speed-to-lead: reply sweeper now defaults to 60s
     (`OUTREACH_SWEEP_MS`), calling the lead in the same sweep that detects the
     reply.
  6. Live transfer: brain emits a `[TRANSFER]` start-of-reply marker (buffered
     so it is never spoken) → relay ends with handoffData → `<Connect action>`
     POST `/api/voice/handoff` → summary SMS to `STAFF_TRANSFER_PHONE` +
     `<Dial>`; graceful hangup/fallback when unconfigured or off-hours
     (`TRANSFER_TZ`/`TRANSFER_HOURS`, default America/New_York 9-18).
  7. Same-agent follow-up: recap email to captured leads (qualified/callback,
     chocolate template `voiceRecapEmail`, reply-to Mark's watched inbox) +
     missed-call SMS via `/api/voice/outbound-status`.
  8. Voicemail drop: async AMD (`machineDetection: DetectMessageEnd` +
     `/api/voice/amd`) → live-call TwiML update speaks a short message; noted on
     the lead.
  9. Qualification schema in the persona (business type · current site/booking
     tool · timeline · interest), feeding the Phase-0 dispositions.
  Verified: [TRANSFER] fires on demand-for-human when available, absent when
  unavailable and on normal questions; webhooks return correct TwiML/204 with
  graceful fallbacks; recap email renders. Scorecard rows improved (next
  re-score): Thoughtly #8 speed-to-dial ◐→✓ · #11 multichannel ✗→◐ · Retell
  escalation ✗→✓ · voicemail ✗→✓. ⚠ Peter actions: set `STAFF_TRANSFER_PHONE`
  (.env + deploy env block) to turn transfers ON; still not deployed to prod.

- **2026-07-22 — Phase 2 shipped** (verified: marker-filter unit tests, real-data
  identification, live persona probes, live ticket action with cleanup):
  10. **Caller identification** — `lib/voiceAccount.js identifyCaller`: caller-ID
      → `contacts` (last-10-digit phone match, format-agnostic) → owned `sites`;
      soft-identity model documented in the lib header (read-back + email to the
      REGISTERED address only; never account changes; caller ID is spoofable).
  11. **Account context** — `buildAccountContext`: per-site status · plan ·
      open invoice · new-leads / upcoming-bookings counts (Stacy's query
      shapes), injected into the voice system prompt; identified callers are
      greeted by name and never get the sales pitch.
  12. **Action tools** — `[ACTION:reset_password|ticket|callback]` start-token
      protocol (generalized from Phase 1's `[TRANSFER]`; filter extracted as
      `createMarkerFilter`, unit-tested incl. split-across-chunks): the persona
      confirms verbally → emits the token → server executes with identity
      GUARDS → result fed back as a system note → one grounded follow-up turn.
      Reset goes only to the on-file email (spoken masked); ticket →
      `site_activity` (mention-based site attribution for multi-site owners) +
      support inbox (finalize skips the duplicate email); callback → support
      inbox. Test rig: Peter's number (+1 302 687 4540) is set on the demo
      owner contact (Marcus Argyle), so calling from Peter's phone exercises the
      identified-customer path against the demo fleet.
  Affected scorecard rows (next re-score): "Authenticate callers" ✗→◐ (soft
  caller-ID identity) · "Reset passwords" ✗→✓ · "Check subscription status" ✗→✓
  · "Answer billing questions" ◐→✓ (account-level) · "Route calls intelligently"
  ✗→◐ · "Trigger downstream workflows" ✗→◐ (ticket/callback). NOT yet deployed.


## 2026-08-19 — Launch refresh (#7)
- Knowledge: pay-at-the-business booking (online card payments "later as an option"), SMS/email
  alerts, the Claim page. Kept in `lib/conciergeContext.js` (structured + `buildVoiceKnowledge`).
- Outbound prospecting calls (sequence step 2, +7d, read-gated): `buildLeadContext` now describes the
  branded "Claim your website" email (date, subject, opened?) and the goal is to get the prospect to
  claim; new marker **`[ACTION:resend_claim]`** resends touch 1 (`lib/claimSend.js`) to the call's
  lead, with a system-note result Mark relays. Guards: outbound lead calls only; never `do_not_email`.
