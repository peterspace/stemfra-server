# Email & SMS Notification Catalog — target state + gap analysis

**The master map of every email/SMS a business on Stemfra needs, benchmarked
against Mindbody's Notifications system** (captured 2026-07-10 from
[Auto emails & text descriptions](https://support.mindbodyonline.com/s/article/203254073-Auto-emails-text-message-descriptions)
+ [Setting up auto emails & texts](https://support.mindbodyonline.com/s/article/203254063-Setting-up-Auto-Emails-and-Texts)).
Companion to [OUTREACH.md](OUTREACH.md) (Stemfra's own prospecting mail) and the
Case 9 notes in [P10_CASES.md](P10_CASES.md). Indexed in the [docs hub](../../docs/README.md).

## How Mindbody structures it (the model to copy)

**Five categories with distinct opt-in semantics:**

| Category | Opt-in rule | Channel |
|---|---|---|
| Account Updates (billing/contracts) | client "Transactional" opt-in | email (+ SMS add-on) |
| Client Schedule (bookings) | client "Transactional" opt-in | email + SMS |
| **Operations** (receipts, resets, forms) | **mandatory — cannot opt out** | **email only** |
| Promotional (follow-ups, birthdays) | client "News & promos" opt-in | email (+ SMS via marketing) |
| Staff Facing | n/a | email |

**Per-notification owner controls** (their Notifications screen — the model for a
future CMS surface): on/off toggle per email (required ones locked ON) ·
**Business reply-to name/email** per notification · **Business copy email** (BCC
the business) · "Always Send / Default On" vs staff-prompted · copy-the-teacher.
Sender: platform system address by default (`automatedemail@mindbodyonline.com`),
reply-to routes to the business; custom SMTP is an advanced opt-in.

## The full catalog vs Stemfra today

Legend: ✅ have · 🟡 partial · ❌ missing-relevant · ⛔ N/A (feature doesn't exist yet — becomes relevant only if/when the feature ships)

### Client Schedule (bookings — our core)
| Notification | Stemfra | Notes |
|---|---|---|
| Appointment booking confirmation | ✅ email (branded, Case 9) | single + salon multi-visit + class |
| **Appointment reminder (24h/2h)** | 🟡 **fields exist, NOTHING SENDS** | `reminder_24h_sent_at`/`reminder_2h_sent_at` on site_bookings — the sweeper was never built. Mindbody's most-used notification. **P1** |
| **Appointment cancellation notification** | ❌ | owner-cancel + member-self-cancel send NO email to the client today. **P1** |
| **Appointment change/reschedule notification** | ❌ | the Phase-6.1 TODO (owner reschedule); member reschedule too. **P1** |
| Reservation (class) reminder | 🟡 same as above | same sweeper |
| No-show notification | ❌ (low) | we track no_show status; polite email optional. P4 |
| Waitlist set (booked-from-waitlist, course waitlist) | ⛔ | waitlists are a parked feature |
| Appointment request/approve/deny flow | ⛔ | we book instantly; request-mode is a possible future booking mode |
| Teacher sub notification | ⛔ (low) | no substitution concept yet |

### Account Updates (memberships/billing — System B)
| Notification | Stemfra | Notes |
|---|---|---|
| AutoPay purchase confirmation (renewal receipt) | 🟡 | Stripe CAN send receipts (`receipt_email` / Billing settings) — not enabled. **P1 cheap** |
| AutoPay failed | 🟡 | Stripe Smart Retries + dunning emails — configure, don't build. P2 |
| Card expiring | 🟡 | Stripe billing setting. P2 |
| Membership welcome / contract emails | ❌ | branded "membership started" email on `site_membership` checkout. P2 |
| Invoice email (Stemfra→owner, System A) | ❌ | billing_charges notify in-app only — the flagged dunning builder. P2 |
| New client / welcome email | ❌ | after first booking or member-account claim. P4 |

### Operations (mandatory)
| Notification | Stemfra | Notes |
|---|---|---|
| Purchase receipt (paid booking) | 🟡 | flip Stripe `receipt_email` on the PaymentIntent. **P1 cheap** |
| Forgot login / password reset | 🟡 | Supabase defaults — restyle on our base + our SMTP (Case 9 P2) |
| Gift card delivery | ⛔ | gift commerce not built (wellness gift pages are inquiry-based) |
| Client forms notification | ⛔ | intake forms are a parked offer item |
| Live stream link | ⛔ | n/a |

### Promotional (client lifecycle — our B-family!)
| Notification | Stemfra | Notes |
|---|---|---|
| Appointment follow-up / first-visit email | ❌ engine | copy EXISTS (B4 post-visit thank-you) — no sender. P4 |
| Birthday email | ❌ | needs birthdate capture. P4 |
| First-visit anniversary | ❌ | B9 copy exists. P4 |
| Win-back / closed follow-up | ❌ engine | B5 copy exists. P4 |
| Series expiring / visits low | ⛔ | class-pack tracking is external (Wodify) today |
| **⚠ prerequisite** | ❌ | promotional sends REQUIRE client opt-in prefs + unsubscribe links (CAN-SPAM) — site_customers has neither. **P2** |

### Staff/owner-facing
| Notification | Stemfra | Notes |
|---|---|---|
| New lead generated | ✅ email + bell | contact form + chat leads |
| **New booking notification (owner)** | 🟡 bell only | Mindbody emails/BCCs the business. Owner email + per-notification toggle. **P1** |
| Booking cancelled (owner) | 🟡 bell only | same. **P1** |
| Daily schedule summary | ❌ (nice) | "your day tomorrow" digest. P4 |
| Business copy (BCC) on client emails | ❌ | Mindbody's "Business copy email" option. P2 |

### SMS (the whole channel)
| Piece | Stemfra | Notes |
|---|---|---|
| Any tenant SMS at all | ❌ | Twilio rails exist but only for Stemfra's own CRM calling/SMS |
| A2P 10DLC registration | ❌ | required for US business SMS — register Stemfra brand + a "customer notifications" campaign; shared number first, per-tenant numbers later |
| SMS confirmation + reminder | ❌ | the two highest-value SMS per Mindbody's model; needs `sms_opt_in` on site_customers + STOP/HELP handling (Twilio Messaging Service does much of it) |
| Promotional SMS | ❌ (later) | separate consent class; after email lifecycle proves out |

## Proposed build order (to finalize with Peter)

- **N1 — Booking-comms reliability core:** reminder sweeper (24h email; 2h optional)
  · cancellation + reschedule notifications (client AND owner) · owner new-booking
  email · Stripe receipt_email + dunning config. *The trust layer — a no-reminder
  booking system reads as broken.*
- **N2 — Preferences + owner controls:** CMS **Notifications settings page**
  (Mindbody-style: per-email toggle, reply-to name/email, business-copy BCC) ·
  `site_customers` notification prefs (transactional/promotional + sms_opt_in) ·
  unsubscribe link + endpoint for promotional mail · System A invoice/dunning emails.
- **N3 — SMS channel:** A2P 10DLC (shared number) · SMS confirmation + reminder ·
  STOP handling · per-tenant sender later.
- **N4 — Lifecycle engine (B-family):** daily sweeper driving post-visit follow-up,
  win-back, anniversary, birthday from the B1–B9 templates + tenant overrides
  (the CMS "Emails" page).
- **N5 — Sender infrastructure:** dedicated transactional domain + ESP
  (the production-sender plan) · Supabase auth emails on our SMTP · send-from-their-
  domain Pro perk (we control the DNS for Stemfra-registered domains).

Case 9's remaining security phases (login alerts, 2FA recovery codes) run parallel;
the marketing-site **help-center docs** (Mindbody-style articles) come once N1–N2
stabilize the surface they document.

---

# EXECUTION PLAN (finalized with Peter, 2026-07-10)

**Decisions:** N1–N5 order approved · ESP = **Resend** (Peter opens the account,
FREE plan first: 3,000 emails/mo, 100/day, 1 domain — upgrade to Pro $20/mo at
volume) · payment-dependent emails are **built now, activated when Stripe
verification completes** · **Airwallex may replace Payoneer** for Stemfra (System A)
subscription collection — billing emails stay provider-agnostic (they already
ride `billing_charges` + the `lib/billing` provider seam); full Airwallex
discussion deferred.

## Per-item disposition of the Mindbody checklist

Legend: ✅ shipped · 🔨 build (phase) · 💳 build now, ACTIVATE post-Stripe · ⏸ parked
until its feature exists · ✖ not applicable to our model (v1)

**Client Schedule**
| Mindbody notification | Disposition |
|---|---|
| Appointment Booking Confirmation (Single) | ✅ shipped (Case 9 P1) |
| Reservation Confirmation (Single) [class] | ✅ shipped (class confirmation) |
| Appointment Reminder | 🔨 **N1** — 24h email via new reminder sweeper (fields already exist); 2h optional; "confirm" button later |
| Reservation Reminder [class] | 🔨 **N1** — same sweeper |
| Appointment Cancellation (Early + Late) | 🔨 **N1** as ONE "appointment cancelled" email (client + owner variants). Early/late SPLIT deferred — needs cancellation-policy windows + late fees we don't model yet |
| Appointment Change Notification | 🔨 **N1** — reschedule email (covers owner reschedule = the old Phase-6.1 TODO, and member self-reschedule) |
| Class/Event Cancellation (session cancelled by business) | ✅ **N2 DONE (2026-07-13)** — CMS SchedulePage "Cancel" on a session with enrollments → `POST /api/cms/bookings/cancel-class-session` cancels every booking + emails each client |
| No Show Notification | 🔨 N4 (low) — polite follow-up on no_show status |
| Appointment Booking Confirmation (Recurring) | ⏸ recurring bookings feature |
| Appointment Request Confirm / Deny / Notification (request-mode booking) | ⏸ we book instantly; request-mode is a possible future booking mode |
| Waitlist set (appt waitlist, course waitlist, added-from-waitlist) | ⏸ waitlist feature (already on the offer roadmap) |
| Course / Advanced Course Confirmations (+ Payment Plan) | ⏸ course-enrollment feature (payment plans additionally need Stripe) |
| Teacher Sub Notification | ⏸ staff-substitution concept |

**Operations**
| Mindbody notification | Disposition |
|---|---|
| Purchase Receipt (paid bookings) | 💳 **N1** — enable Stripe `receipt_email` on booking PaymentIntents (one line) + membership receipts via Stripe Billing settings. Activates when Stripe verification completes |
| Invoice / Payment request (System A) | ✅ **N2 DONE (2026-07-13)** — `lib/billingEmails.js` `sendInvoiceEmail` fired on `billing.markRequested`; Stemfra-branded, provider-agnostic (Payoneer copy + default) |
| Purchase/Payment Receipt (System A) | ✅ **N2 DONE (2026-07-13)** — `sendReceiptEmail` fired on `billing.markPaid` |
| AutoPay Failed / dunning | 🔨 N2 remaining — overdue/dunning email from the billing-cycle sweeper (System A); Stripe dunning config for System B |
| Appointment Confirmation (Manual) | ✅ **N2 DONE (2026-07-13)** — "Resend confirmation" button in the CMS BookingDetailModal → `POST /api/cms/bookings/resend-confirmation` |
| Client Schedule (Manual) | 🔨 N2 remaining — "Email their upcoming schedule" owner tool (not built yet) |
| Forgot Login Information | 🔨 N5 — Supabase auth templates on our base + our SMTP (CMS owners + member accounts) |
| Client Forms Notification | ⏸ intake-forms feature |
| Gift Card Delivery | ⏸ gift commerce (wellness gift pages are inquiry-based today) |
| Live Stream Class Link | ✖ |

**Promotional** (ALL gated on N2's opt-in + unsubscribe infrastructure)
| Mindbody notification | Disposition |
|---|---|
| Appointment Follow-up / First Visit Email (appt + class) | 🔨 N4 — B3/B4 templates, lifecycle sweeper |
| First Visit Anniversary | 🔨 N4 — B9 |
| Birthday Email | 🔨 N4 — needs optional birthdate capture on site_customers (schema in N2) |
| Series — Time Running Out / Visits Low | ⏸ native class-pack tracking (packs are external/Wodify today) |
| Client Closed / Close Follow-up | ✖ v1 — Mindbody prospect-pipeline concept; OUR prospecting equivalent already lives in the A-family outreach (OUTREACH.md) |
| Open Ticket Quote | ✖ |

**Staff Facing trio (Peter's question, 2026-07-11):** New Lead Generated = ✅ shipped
(owner lead email). Contact Log Follow-up = ✖ v1 (Mindbody's internal sales-CRM
feature; our staff CRM is stemfra-ops — tenants have no contact-log/assignment
concept). Teacher Sub Reminder = ⏸ with the substitution feature. **The useful
kernel = Mindbody's "copy teacher": notify the assigned TEAM MEMBER of their own
bookings — requires an `email` field on site_team_members (none today) + an email
input in the CMS Team editor + a per-member "notify of bookings" toggle → added
to N2.**

**Also in plan (not on Mindbody's list):** owner **new-booking** + **booking-cancelled**
notification emails w/ per-notification toggles (N1), the CMS **Notifications
settings page** (N2 — Mindbody-style toggles + per-notification reply-to +
business-copy BCC), client notification preferences + unsubscribe (N2),
System A invoice/payment-request emails (N2), SMS channel (N3), tenant template
overrides (N4).

## Resend onboarding (N5 groundwork)

**✅ STEPS 1–3 DONE (2026-07-13). `mail.stemfra.com` is VERIFIED for sending.**
- Domain id `e29b9c82-e13f-43a3-9625-ce2a8424e098`, region **us-east-1** (Virginia),
  sending enabled. DKIM + SPF (MX + TXT) all verified.
- The 4 DNS records live in the stemfra.com **Cloudflare zone** (added via API with
  our token — it already carries `DNS:Edit`; no dashboard clicking):
  `resend._domainkey.mail` TXT (DKIM) · `send.mail` MX →
  `feedback-smtp.us-east-1.amazonses.com` · `send.mail` TXT (SPF `v=spf1
  include:amazonses.com ~all`) · `_dmarc.mail` TXT (`v=DMARC1; p=none;` — optional
  monitoring). Names are root-relative → append `.stemfra.com`.
- `RESEND_API_KEY` is in `.env` (a **sending-only** key — least-privilege for the
  server) + GitHub secret. A temporary Full-access key was used ONCE to add the
  domain/fetch records/verify, then Peter reverted it to sending-only.
- **From addresses** now available: anything `@mail.stemfra.com` (e.g.
  `notifications@mail.stemfra.com`). Tenant mail = `"Business Name"
  <notifications@mail.stemfra.com>` with reply-to = the business email.

**✅ STEP 4 (transport cutover) DONE (2026-07-13, verified delivered).**
- New **`lib/mailer.js`** = the single `sendMail({fromName, to, replyTo, subject,
  text, html})` used by ALL transactional senders. Routes to **Resend HTTP API**
  (`api.resend.com/emails`) or **Gmail SMTP** by `EMAIL_PROVIDER` (`resend`|`gmail`),
  with fallback to whichever is configured. `.env` now `EMAIL_PROVIDER=resend` +
  `RESEND_FROM_ADDRESS=notifications@mail.stemfra.com`. Callers pass a display
  NAME; the mailer picks the correct from-address per provider.
- Refactored ALL 7 send sites off their own nodemailer transporters onto the
  shared mailer: `lib/bookingEmails.js` (N1), `bookingController` (×3: single/
  visit/class confirmations), `siteFormController` (lead), `siteChatController`
  (chat lead), `contactController` (marketing ×2), `stripeWebhookController`
  (orphan alert), `cms/assistantController` (Stacy handoff). Reminder-sweeper
  start guard now checks `activeProvider()`, not Gmail creds.
- **Verified:** a branded test (Case 9 base) sent via `sendMail` →
  Resend `last_event: **delivered**` to peter.space.io@gmail.com (inbox, SPF+DKIM
  aligned). Gmail stays the dev fallback (flip `EMAIL_PROVIDER=gmail`) AND Mark's
  1:1 outreach permanently (that's n8n/Gmail, not this mailer).
- **Prod:** add `RESEND_API_KEY` + `EMAIL_PROVIDER=resend` +
  `RESEND_FROM_DOMAIN`/`RESEND_FROM_ADDRESS` to deploy.yml's env block (RESEND
  key is already a GitHub secret).
- Reusable **`lib/cloudflareDns.js`** (`upsertDnsRecord`/`upsertDnsRecords`/
  `deleteDnsRecord`/`listDnsRecords`, idempotent, proxied:false default) factored
  out of the one-off Resend-record scripts — the single path for any future
  "add a DNS record to our zone" need (ESP setup, TXT verification, subdomains).

Historical steps (for reference):
1. ~~Peter: create the Resend account → add `mail.stemfra.com` → copy records.~~
2. ~~Claude: add records to the Cloudflare zone via API → verify.~~
3. ~~Peter: create an API key → `RESEND_API_KEY` (+ GitHub secret).~~
4. ~~Claude: route all transactional senders through Resend behind an env flag.~~
4. **Claude:** switch `createTransporter()` to Resend's SMTP interface
   (`smtp.resend.com`, API key as password) behind an env flag — zero template
   changes, Gmail stays the dev fallback AND stays permanently for Mark's 1:1
   outreach (deliberately personal, real inbox).
5. Watch the free-plan limits (100/day) — upgrade to Pro when tenant volume nears it.
   Side benefit: fewer Google Workspace seats needed for sending identities.

## Phase checklists (the "revisit at the end" list)

- **N1 ✅ DONE (2026-07-11, verified end-to-end):** reminder sweeper (24h; per-site
  toggle later) · cancellation email (client+owner) · reschedule email (client+owner)
  · owner new-booking email · Stripe receipt_email flag (💳) · all on the Case 9 base,
  all in /dev/preview. Build map: `lib/bookingEmails.js` (context loader + 4 senders),
  `lib/bookingReminderSweeper.js` (5-min sweep, stamp-first claim, started in index.js),
  `templates/transactionalEmails.js` (+bookingReminder/bookingCancelled/
  bookingRescheduled/ownerBookingNotification), `routes/cms/bookings.js`
  `POST /api/cms/bookings/notify` (owner cancel/reschedule → customer email; the CMS
  fires it from `useUpdateBooking`/`useRescheduleBooking` via `lib/bookingNotify.ts`),
  owner new-booking notify in all 3 booking paths (single/class/group), member
  self-cancel/reschedule emails in `siteMembersController`, `receipt_email` threaded
  BookingForm → template lib → `sitePaymentsController` (💳 dormant until live mode).
  Verified: sweeper sent a real reminder + claimed the stamp; notify endpoint e2e with
  a real owner JWT (client email sent; cross-tenant denied; bad event 400); 4 preview
  routes render. Owner-notify pre-N2 toggle:
  `site_theme_settings.metadata.notify_owner_bookings !== false`.
- **N2 (in progress):** ✅ **team-member email + "copy on their bookings" DONE
  (2026-07-13)** — additive `site_team_members.email` + `notify_bookings`; CMS Team
  editor fields; `lib/bookingEmails.js` joins the team member + `notifyTeamMember()`
  copies them on new/cancelled bookings when opted in; verified (coach copy
  delivered via Resend, CMS save persisted). ✅ **one-click CMS access DONE
  (2026-07-13)** — `lib/cmsMagicLink.js` puts a Supabase single-use magic link on
  every owner-facing CTA (booking + lead notifications) so the owner lands in the
  CMS signed in; needs cms.stemfra.com/** + localhost:5180/** in the Supabase Auth
  redirect allowlist (Peter action). ✅ **Notifications settings page DONE
  (2026-07-13)** — Settings → Notifications, per-event toggles (new booking /
  cancellation / reschedule / lead / chat lead / customer reminder), stored at
  `metadata.notifications` + read server-side by `lib/notifyPrefs.js`; added the
  owner-reschedule notification. ✅ **customer prefs + unsubscribe DONE
  (2026-07-13)** — `site_customers.email_opt_out`/`sms_opt_in`/`birthdate`;
  signed-token public endpoint `/api/site-emails/{unsubscribe,resubscribe}`
  (`lib/emailTokens.js`, no DB token column); base-email footer "Unsubscribe" link;
  reminders skip opted-out customers + carry the link (transactional confirmations
  don't). ✅ **booking-side owner tools DONE (2026-07-13)** — resend-confirmation
  (BookingDetailModal button) + class-session cancel-and-notify (SchedulePage →
  cancel-class-session endpoint). REMAINING (N2 tail):
  · **System A invoice + payment-request/dunning emails** (provider-agnostic —
  Payoneer/Airwallex/Stripe; needs a scope chat — see NEXT) · "email their upcoming
  schedule" owner tool · CMS surface showing a customer's opt-out status (minor) ·
  hand-patch database.types.ts for the site_customers pref columns.
- **N3:** A2P 10DLC registration (Peter: Twilio brand/campaign forms) · SMS
  confirmation + reminder · STOP/HELP via Messaging Service · segment-cost note.
- **N4:** lifecycle sweeper (B-family: first-visit, follow-up, anniversary, birthday,
  win-back) · tenant template overrides (CMS "Emails" page) · no-show note.
- **N5:** ✅ **transport cutover DONE (2026-07-13)** — `mail.stemfra.com` verified +
  `lib/mailer.js` routes all transactional mail through Resend (verified delivered).
  ✅ **prod env DONE (2026-07-13)** — `EMAIL_PROVIDER`/`RESEND_API_KEY`/
  `RESEND_FROM_DOMAIN`/`RESEND_FROM_ADDRESS` added to deploy.yml's env block
  (ready for push; RESEND key already a GitHub secret).
  ✅ **branded Supabase auth emails DONE (2026-07-13)** — `templates/authEmails.js`
  renders confirm-signup / magic-link / reset-password / change-email through the
  Case 9 base (Stemfra brand, `{{ .ConfirmationURL }}` survives escaping);
  paste-ready HTML in `docs/supabase-auth-templates/*` + runbook
  `docs/SUPABASE_AUTH_EMAILS.md`. **Peter action: set Supabase custom SMTP
  (smtp.resend.com) + paste the 4 templates.** Previews at `/dev/preview/auth-*`.
  REMAINING: security track (login alerts, 2FA recovery codes) · send-from-their-
  domain Pro perk · marketing-site help-center docs · tighten root DMARC
  `p=none`→quarantine/reject once CF DMARC reports confirm alignment.
