# Email deliverability — the Gmail Promotions playbook

_2026-09-03. The canonical record of the live A/B experiment (5 rounds,
~35 emails from mark@stemfra.com to Peter's Gmail accounts, including one
never-contacted mailbox) plus the supporting research (Google AI-Overview
findings + an email-agency video; full notes + transcript in the stemfra
root at `video_research/gmail-promotions-avoidance/`). These rules are
implemented in code — see "Where this lives" below — read this BEFORE
changing any outreach/claim template or send path._

## The experiment, in one table

Sender: mark@stemfra.com via the Google service account (real Gmail sends,
Workspace SPF/DKIM/DMARC, no ESP bulk headers). All rounds same day.

| Round | Anatomy | Result |
|---|---|---|
| 1 | Plain text/light HTML, ≤2 links, pixel, sales language | 8/8 **Primary** |
| 2 | Full branded claim template: 8 link destinations (claim, demo, 5-link footer, unsubscribe) + List-Unsubscribe header | 8/8 **Promotions** |
| 3a | Full branded template as a **"Re:" reply inside the touch-1 thread** | **Primary** (stayed with the thread) |
| 3b | Branded design, ZERO links, no bulk header | 8/8 **Primary** |
| 4 | Branded design, ONLY the claim link (hero + button, one URL), no bulk header | 8/8 **Primary** |
| 5 | Round-4 anatomy, the template's own promo-style subject ("X, this website is for you"), sent to a **never-contacted mailbox** | **Primary** — the clean cold-world datapoint |

## What decides the tab (for OUR sender profile)

1. **Link count + the List-Unsubscribe header** — the triggers. The same
   design flipped from Promotions to Primary when the 6-link footer, demo
   link, unsubscribe link, and the bulk header were removed. An email with
   one destination link and no bulk header reads like an invoice/receipt.
2. **Design/images are NOT a trigger here** — the full branded layout with a
   hero image cleared Primary once the links were gone (round 3b/4/5).
3. **Sales language, a couple of links, and the open pixel are tolerated**
   (round 1) — content wording is a weak signal at low 1:1 volume.
4. **Sender reputation dominates over time** (the research's "bank account"):
   engagement (opens/replies) warms placement per-recipient and globally.
   Warmed test mailboxes go Primary for almost anything — which is why the
   round-5 fresh-mailbox test was the only trustworthy cold datapoint.
5. **Thread standing is inherited** — a reply lands where its thread lives.

## The rules (apply to every Stemfra outreach email)

- **Cold first touch: at most ONE link destination.** Multiple anchors may
  point at that one URL (hero image + button), but there is exactly one
  destination. No footer link row, no mailto, no unsubscribe link.
- **No List-Unsubscribe header on cold 1:1 outreach.** It is an explicit
  bulk-mail declaration. Opt-out on a cold touch = the visible
  'Reply "stop" and we will not email again' line; a bare "stop" reply is
  auto-honored (replyClassify → do_not_email + do_not_call).
- **Branded/designed emails with full footers + unsubscribe links only ever
  go out as in-thread replies** (or to engaged/warm recipients). Never as a
  fresh cold thread.
- **Always send a real text/plain part** alongside HTML (buildRawTracked
  already does), keep SPF/DKIM/DMARC intact, and keep sends low-volume and
  human-paced (the sequencer's read-gating). Never blast unengaged cohorts —
  reputation is the long game.
- The open pixel is fine; keep it.

## Where this lives in code

- `templates/transactionalEmails.js prospectClaimEmail` — touch 1 renders the
  SLIM variant (claim link only, `plainFooter`, reply-stop reason line, no
  unsubscribe link); touch 2+ renders the full version (footer links +
  unsubscribe) because it rides the thread.
- `templates/baseEmail.js` — `plainFooter` option renders the chocolate
  footer's © line without anchors.
- `lib/claimSend.js sendClaimEmail` — touch 1 sends WITHOUT the
  List-Unsubscribe header; touch 2+ keeps it AND threads into the touch-1
  thread (threadId + In-Reply-To via `gmail.getReplyRefs`).
- `lib/gmailOutreach.js` — `sendAsRep({ threadId, inReplyTo })` +
  `getReplyRefs` power the reply threading.
- `lib/replyClassify.js` — a bare "stop" reply classifies as 'unsubscribe'
  (sets do_not_email + do_not_call in the reply sweeper).

## Caveats

- These findings are for THIS sender profile (low-volume 1:1 Gmail sends).
  They do not license bulk blasts; volume changes the reputation math.
- Gmail personalizes per recipient — a warmed mailbox is not a valid test
  instrument. Cold conclusions need a never-contacted address (round 5).
- If a template change reintroduces links, re-run a one-email fresh-mailbox
  test before shipping it to real leads (test only Peter's own accounts —
  never real prospects).
