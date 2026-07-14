# Outreach System — templates, sequencing & voice-call rules

**The system of record for how Stemfra prospects clients by email + phone.**
Consolidates what was built across the 2026-06-29 arc (see
[WORK_2026-06-29.md](WORK_2026-06-29.md) §1/§P4 for the build narrative) so the
design is findable in one place. Companion docs: [LEADGEN.md](LEADGEN.md)
(server trigger/flow) and [stemfra-ops/docs/LEADGEN.md](../../stemfra-ops/docs/LEADGEN.md)
(CRM review queue). Indexed in the [docs hub](../../docs/README.md).

---

## 1. The Template Manager — the single source of truth for email copy

**CRM → Email Templates** (`stemfra-ops/src/pages/EmailTemplates.jsx`), backed by
the **`email_templates`** table. 29 active templates in two families:

- **Part A — outbound prospecting (A1–A20)**, by category:
  - *Prospecting*: A1 cold first-touch · A2 no-reply follow-up · A3 warm ·
    A4 formal intro · A5 referral ask · A6 mutual-contact intro · A7 met-in-person ·
    A8 insight share · A9 seasonal angle
  - *Discovery & qualification*: A10 demo offer · A11 pricing · A12 social proof ·
    A13 objection "already have a website" · A14 objection "no time"
  - *Closing*: A15 proposal sent · A16 ready to start · A17 final follow-up
  - *Re-engagement*: A18 reconnect · A19 new reason · A20 breakup
- **Part B — tenant lifecycle (B1–B9)**: booking confirmation, day-before
  reminder, welcome, post-visit thank-you, win-back, rebooking nudge,
  review request, seasonal promo, anniversary. *(These are the seed material
  for Case 9's branded transactional-mail suite.)*

Templates carry **merge fields**. Two kinds — this distinction is load-bearing:
- `{{demo_link}}` and `{{start_free_link}}` are resolved **at send time** by the
  server (`lib/demoLinks.js fillOutreachLinks` — vertical → flagship demo URL +
  the self-serve pricing CTA). Drafts must keep them LITERAL.
- Everything else (`{{first_name}}`, `{{business_name}}`, `{{setup_fee}}`, …) is
  rendered by the **sequencer** for template sends, but NOT by `send-outreach`
  for the AI-drafted first email — the drafting agent substitutes real values.

The CRM page has AI refine presets (Shorten / Warmer / More direct / Fix grammar)
via `POST /api/leadgen/refine-template` (`lib/leadgenDraft.js`, GPT).

## 2. Who sends, and how

- All prospecting email goes out **as `mark@stemfra.com`** (Google service
  account with domain-wide delegation — `lib/gmailOutreach.js sendAsRep`).
  Real-inbox deliverability; replies land in Mark's actual mailbox.
- Every send carries a **1×1 open-tracking pixel**
  (`GET /api/leadgen/o/:token.gif` → `leads.outreach_opened_at/open_count`).
- The **reply sweeper** (`lib/outreachReplySweeper.js`) reads Mark's inbox;
  `lib/replyClassify.js` classifies: **unsubscribe** → `do_not_email` +
  `do_not_call` · **"no thanks"** → declined (stage lost) · **interested** →
  warm + a (guardrailed) call.
- A **Mark signature is auto-appended** when the body lacks his email — drafts
  and templates should not include their own signature block.

## 3. The agreed cadence (when emails go & when the voice agent calls)

DB-driven — `crm_settings.leadgen_sequence` (tune in the DB/CRM, no deploy):

| Step | Day | What | Gate |
|---|---|---|---|
| 1 | 0 | **A1 slot** — the AI-drafted, human-reviewed first email (`send-outreach`) | Reviewer approves in the CRM Review Queue |
| 2 | +7 | **A2** template (merge-field rendered) | still `outreach_status='sent'` |
| 3 | +8 | **Voice call** (`lib/leadgenCall.js`) | **read-gated**: only if A2 was OPENED and they haven't signed up |
| 4 | +14 | **A8** insight-share template | |
| 5 | +21 | **A20** breakup template | |

Campaign window 30 days · 200 emails/day cap. The drip **stops automatically**
on reply, bounce, opt-out, or signup (a `contacts` row exists for the email).
Driven by `lib/outreachSequencer.js` (started from index.js).

**Voice-call guardrails** (`lib/callGuardrails.js canAutoCall`): never on
`do_not_call` · pan-US safe window **12:00–18:00 ET** · daily cap
`crm_settings.leadgen_daily_call_cap` (50).

**Master switches — all OFF by default** (`crm_settings`): `leadgen_auto_send`,
`leadgen_auto_call`, `leadgen_sequencer`. Until flipped in the CRM, everything
is reviewer-driven.

## 4. How Lead-Gen System B feeds this

The n8n workflow (*Stemfra Lead-Gen — System B v11*) scores each scraped
candidate and drafts `draft_subject`/`draft_message` → stored as
`leads.ai_draft_*` → reviewed (optionally refined via `refine-draft`) →
**`send-outreach` sends that draft as step 1**. Steps 2–5 never touch the
agent — the sequencer sends the literal A2/A8/A20 templates.

**A1 injection (2026-07-10):** `/api/leadgen/trigger` now fetches the active A1
template and passes it in the webhook payload (`template_a1`); the workflow's
Build Prompt node (`n8n-workflows/leadgen-build-prompt.js`) appends it to every
candidate prompt with the rules above (keep `{{demo_link}}`/`{{start_free_link}}`
literal, substitute real values elsewhere, omit the signature). **Editing A1 in
the CRM retunes the agent on the next run** — the Template Manager is genuinely
the single source of truth for the first email's structure. n8n paste files:
`leadgen-build-prompt.js` (Build Prompt node) + `leadgen-system-prompt.txt`
(Score & Draft (Agent) system prompt).

## 5. File map

| Piece | Where |
|---|---|
| Template Manager UI | `stemfra-ops/src/pages/EmailTemplates.jsx` + `hooks/useEmailTemplates.js` |
| Templates data | `email_templates` table (codes A1–A20, B1–B9) |
| Send as Mark + read replies | `stemfra_server/lib/gmailOutreach.js` |
| First-email send | `POST /api/leadgen/send-outreach` (routes/leadgen.js) |
| Drip engine | `stemfra_server/lib/outreachSequencer.js` |
| Voice call + guardrails | `lib/leadgenCall.js` + `lib/callGuardrails.js` (+ `lib/voiceBrain.js`) |
| Reply sweep + classify | `lib/outreachReplySweeper.js` + `lib/replyClassify.js` |
| Draft/template AI refine | `lib/leadgenDraft.js` (`refine-draft`, `refine-template`) |
| Demo/pricing links | `lib/demoLinks.js` (`{{demo_link}}`, `{{start_free_link}}`) |
| Cadence + switches | `crm_settings`: `leadgen_sequence`, `leadgen_auto_send`, `leadgen_auto_call`, `leadgen_sequencer`, `leadgen_daily_call_cap` |
| n8n paste files | `n8n-workflows/leadgen-build-prompt.js` + `leadgen-system-prompt.txt` |

## 6. Open items

- **Case 9** (P10) reworks the transactional side: one branded base template,
  migrate all system mail, Supabase auth emails via our SMTP — the B-family
  templates are its seed material.
- The B1–B9 tenant-lifecycle templates exist as copy but are **not yet wired**
  to automated tenant sends (booking confirmations use their own hardcoded
  mail today).
- Warm-track (`N8N_LEADGEN_WARM_URL`) workflow: same contract, separate n8n flow.
