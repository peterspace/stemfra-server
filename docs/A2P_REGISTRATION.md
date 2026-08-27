# A2P 10DLC Registration — prepared answers for Peter

> **➕ PLANNED SECOND CAMPAIGN — STATUS: DEFERRED (Peter, 2026-08-27: "I will do the new campaign later"; on the pending list. Everything below is ready to paste when he picks it up):** tenant→their-customers
> lifecycle SMS (review links, birthday, win-back, seasonal) needs its OWN campaign under the
> SAME Stemfra brand + 1–2 dedicated new numbers (never Mark's/CRM numbers). **Opt-in is the
> END CUSTOMER'S OWN, never the tenant's on their behalf** (TCPA consent is personal to the
> recipient). Declared mechanisms — both must EXIST and be publicly provable before submitting
> (the two rejections below both came from describing flows that did not exist or sat behind
> a login): (1) the announcement email's opt-in link → public confirmation page →
> `site_customers.sms_opt_in` + timestamp + source (LIVE since 2026-08-27); (2) an unchecked
> checkbox at the booking "Your details" step with the four disclosures (✅ BUILT + live-
> verified 2026-08-27: BookingForm + MultiServiceBookingForm; server records
> `sms_opt_in` + timestamp + source `booking_form`). Imported `smsOptIn` flags are NOT
> declared and NOT sufficient — only consent we recorded ourselves triggers sends. Samples
> shaped "[Business Name] via Stemfra: … Reply STOP to opt out."; STOP → `sms_opt_in=false`
> for that customer. **Proof page LIVE: stemfra.com/sms-consent, second section ("Customer
> messages sent for businesses on Stemfra") with real screenshots of both flows.**
> Remaining before submission: extend the privacy policy's SMS clause to name this program.
>
> **Ready-to-paste fields for the SECOND campaign (drafted 2026-08-27; same brand):**
>
> | Field | Value |
> |---|---|
> | Use case | Low-Volume Mixed (reminders + review invitations + occasional updates) |
> | Campaign description | "Stemfra is a website and booking platform for local service businesses (salons, barbershops, gyms, wellness studios). This campaign sends messages on behalf of those businesses to THEIR customers who personally opted in: appointment reminders, a review invitation after a visit, and occasional updates such as a birthday greeting. Every message names the business it is sent for and carries STOP/HELP." |
> | Message flow / opt-in description | "End customers opt in personally, one of two ways, both shown with screenshots at https://stemfra.com/sms-consent (section: Customer messages sent for businesses on Stemfra). (1) When booking an appointment on a business's website, the 'Your details' step shows an unchecked checkbox with the full consent wording ('Text me appointment reminders and occasional updates from this business. Message frequency varies. Message and data rates may apply. Reply STOP to opt out or HELP for help.'); booking does not require ticking it. (2) A business may email its existing customers a personal 'prefer text reminders?' link; tapping it records the opt-in and shows a confirmation page restating the STOP instruction. Consent is recorded per customer with a timestamp and source. Businesses cannot opt customers in on their behalf, and imported contact lists are never texted. Privacy policy: https://stemfra.com/privacy · Terms: https://stemfra.com/terms" |
> | Sample 1 | "Clean Cuts Barbers via Stemfra: reminder, your Classic Cut is tomorrow at 2:30 PM. Reply STOP to opt out." |
> | Sample 2 | "Clean Cuts Barbers via Stemfra: thanks for visiting! If you have a moment, we'd love a Google review: https://stemfra.com/r/abc. Reply STOP to opt out." |
> | Sample 3 | "Clean Cuts Barbers via Stemfra: happy birthday from all of us! We hope it's a great one. Reply STOP to opt out." |
> | Opt-in keywords / message | (blank — web opt-in only, no text-to-join) |
> | HELP response | "Messages sent by Stemfra on behalf of the business you opted in with. Support: support@stemfra.com. Reply STOP to unsubscribe." |
> | Opt-out handling | STOP honored automatically (Advanced Opt-Out) + `site_customers.sms_opt_in` set false via inbound webhook |
> | Embedded links / phone numbers | Yes (review links on our own domain — never public shorteners) / No |
> | Number(s) | Buy 1–2 NEW local numbers for this campaign only. Never attach Mark's/CRM numbers. |

_Prepared 2026-07-22 as part of P12 Wave 1 (`docs/P12_PLAN.md` §4). This is a
**Peter console action**: Twilio Console → Messaging → Regulatory Compliance →
A2P 10DLC (US). Register the **brand** first, then the **campaign**, then
attach the number. Approval has lead time (typically days) — submit before the
SMS build starts. Fees below are approximate; the console shows exact current
amounts at submission._

> Sender = **Stemfra's Twilio number(s) only** (the existing
> `TWILIO_PHONE_NUMBER` / `VOICE_PHONE_NUMBER`) — never a personal number.
> Registering also legitimizes SMS we already send today (missed-call
> follow-ups, live-transfer staff alerts).

## Step 1 — Brand registration (Standard brand)

| Field | Answer |
|---|---|
| Legal business name | STEMFRA LLC _(exactly as on the EIN letter — verify spelling/casing)_ |
| Business type | Private / Limited Liability Company |
| EIN (US Tax ID) | ⟨Peter: fill from the IRS EIN letter⟩ |
| Business registration country | United States |
| Registered address | ⟨Peter: the Delaware registered address — Dover, DE⟩ |
| Business industry / vertical | Technology / Software (SaaS) |
| Website | https://stemfra.com |
| Stock exchange / ticker | Not publicly traded |
| Business contact | Peter Okeme · ⟨title, e.g. CEO/Managing Member⟩ · peter.space.io@gmail.com _(or support@stemfra.com)_ · ⟨phone⟩ |

Fee: one-time brand registration (~$4–5) + one-time brand vetting if using
Standard (~$40 only if "secondary vetting" is chosen — skip unless throughput
demands it; the basic Standard brand suffices for our volume).

## Step 2 — Campaign registration

| Field | Answer |
|---|---|
| Campaign use case | **Low Volume Mixed** (covers account notifications, OTP/2FA + customer care; <6,000 msg segments/day — far above our need) |
| Messaging Service | **Create new Messaging Service** (auto-created with the campaign; attach the Stemfra number to it at the end) |
| Campaign description | "Stemfra is a website and booking platform for local service businesses (salons, barbershops, gyms, wellness studios). This campaign sends account notifications to Stemfra's own registered business customers and their staff: alerts when a new customer lead or booking arrives on their account (including the customer's contact details for follow-up), missed-call follow-up texts, billing and payment notifications, and support and service notifications. Recipients are Stemfra account holders who opted in at signup; no marketing lists, no messaging to consumers at large." (OTP removed; billing added to match sample #5 — see rejection note below) |
| Message flow / opt-in description | "Business owners create a Stemfra account at stemfra.com and provide their mobile number in account settings, where SMS notifications are presented as an opt-in toggle with consent language ('Receive SMS alerts for new leads and bookings. Msg & data rates may apply. Reply STOP to opt out, HELP for help.'), or provide a number at signup for one-time verification. Consent is recorded per account. Owners can disable alerts anytime in their dashboard or by replying STOP." |
| Privacy Policy URL | **https://stemfra.com/privacy** |
| Terms & Conditions URL | **https://stemfra.com/terms** (SMS program clause added 2026-07-26 — program description, frequency, msg&data rates, HELP/STOP) |
| Opt-in keywords | (leave blank — web/signup opt-in, no text-to-join) |
| Opt-in Message | (leave blank — only required if opt-in keywords are set) |
| Opt-out handling | STOP/UNSUBSCRIBE honored automatically (Twilio Advanced Opt-Out enabled) + account flag set via inbound webhook |
| HELP response | "Stemfra: account alerts for your business. Support: support@stemfra.com. Reply STOP to unsubscribe." |
| Embedded links? | Yes (links to the owner's Stemfra dashboard) |
| Embedded phone numbers? | Yes (the inquiring customer's phone number, so the owner can call them back) |
| Age-gated / direct lending content? | No / No |

**Sample messages (v2 — OTP removed + templated fields bracketed after v1 rejection [error 30893]; all account-notification / customer-care):**

1. "Stemfra: New lead for [Business Name] - [Customer Name], [Customer Phone], asked about [Service]. Reply or call them now. Details: cms.stemfra.com. Reply STOP to opt out."
2. "Stemfra: New booking at [Business Name] - [Customer Name], [Customer Phone], [Day] [Time], [Service]. Contact them to confirm any details. Reply STOP to opt out."
3. "Hi [Customer Name], it is [Staff Name] from Stemfra - I just tried to call about the note we emailed you. Reply to the email any time, or call this number back when it suits you."
4. "Stemfra: your support request has been received - our team will email you today. Reply STOP to opt out."
5. "Stemfra: Payment for your [Plan Name] plan ([Amount]) could not be processed. Update your payment method at cms.stemfra.com to keep your site active. Reply STOP to opt out."

> **v1 rejection cause (error 30893):** two things — (a) the OTP sample: OTP/2FA
> is a **separate A2P use case**, so it read as inconsistent with our
> account-notification campaign → removed (register a dedicated **2FA campaign**
> later, when phone-verification is built); and (b) sample messages must show
> **dynamic fields in [brackets]** (not literal values) so carriers see the
> template — all samples above are now bracketed. Ref:
> https://www.twilio.com/docs/api/errors/30893 ·
> https://help.twilio.com/articles/11847054539547

Fees: one-time campaign vetting (~$15) + recurring campaign fee
(Low Volume Mixed ≈ $1.50–2/month) + per-segment carrier passthrough fees
(fractions of a cent). Trivial at our volume.

## Step 3 — Attach the number(s)

Add the existing Stemfra Twilio number(s) to the approved campaign's Messaging
Service. If voice and SMS use different numbers, attach the one(s) that send
SMS (missed-call texts come from `VOICE_PHONE_NUMBER` — attach it too).

## Registered resource SIDs (submitted 2026-07-26)

Created during onboarding; **campaign pending vetting** at time of writing
(Customer Profile + Brand already approved). Check status at Messaging →
Regulatory Compliance → Campaigns.

| Resource | SID |
| --- | --- |
| Customer Profile (Trust Hub) | `BU2b4ccff4a5fa1a7e4fb54caeaad05ecb` |
| A2P Brand | `BNf66814020b206698d2939440ffb9c34f` |
| A2P Campaign (v1 — REJECTED, see below) | `CM5a84819732921518015d491257ad78c5` |
| Linked Messaging Service | `MG5d2c2003ebd1ae6480d34c05dc5301e7` |
| SMS sender number | `+13025277810` (`TWILIO_PHONE_NUMBER`) |
| Voice / missed-call-text number | `+16672205540` (`VOICE_PHONE_NUMBER`) |

### ⚠ v1 rejected by TCR (2026-07-26) — cause + fix
Campaign v1 was **rejected: "invalid sample message content"**, flagged on
**Sample #1 (the OTP verification code)**. Terms/Privacy URLs were NOT flagged
(the SMS clause we added passed). Root cause: **OTP / 2FA is a separate A2P
use case** and cannot ride in a general "Low Volume Mixed" account-notifications
campaign.

**Fix applied to the samples + description below:** the OTP sample and the OTP
mention in the description were **removed**. Resubmit via "Fix Campaign" / a new
campaign (reuses the same Brand + Messaging Service `MG5d2c…` + numbers; ~$15
re-vetting). **OTP will be registered later as its own dedicated 2FA campaign**
when phone-verification is actually built.

Both numbers submitted for association to the campaign's Messaging Service
(async, a few minutes to reflect). The **Messaging Service SID** auto-created
with the campaign is what the send code targets — grab it from Messaging →
Services once the numbers show as connected, and set it in `.env`.

## After approval → tell Claude

The Wave-2 SMS build starts then: `lib/notifySms.js`, owner phone +
`sms_alerts_enabled` toggle + consent copy in CMS, optional staff phone on
`site_team_members`, hooks beside the existing lead/booking notification
emails, STOP webhook → flag off. Design: `docs/P12_PLAN.md` §4.

---

## 2026-08-03 — second rejection (error 30896) and the real cause

Campaign `CM5a84819732921518015d491257ad78c5` (Low Volume Mixed, brand
`BNf66814020b206698d2939440ffb9c34f`) was rejected again. Reviewer note:

> Opt-In Error: The Opt-in link provided (https://cms.stemfra.com/) lacks purpose
> details on types of messages that will be sent. [Need to share proof about the
> account setting]

**Root cause: the consent flow we described did not exist.** The submitted
`message_flow` said SMS notifications were "presented as an opt-in toggle" in
account settings. There was no such toggle in the CMS: the only `smsOptIn` in the
codebase was in the customer IMPORT (a tenant's consent for THEIR customers).
The reviewer went looking for it, could not find it, and asked for proof.
Secondary cause: the opt-in URL we gave was the CMS **login page**, which a
carrier reviewer cannot get past.

### What Twilio's own doc requires (https://www.twilio.com/docs/api/errors/30896)

- `message_flow` must name the URL, describe the consent action, state message
  frequency, and include links to the privacy policy AND terms **inside that
  field** (not only in the separate URL fields).
- If the opt-in is behind a login, host **screenshots of the full consent flow**
  at a public URL and reference it in `message_flow`.
- The **privacy policy** must state mobile numbers are not shared with third
  parties or affiliates for marketing, AND include message frequency AND
  "message and data rates may apply".
- Sample messages must name the brand and include opt-out language.

### ⚠ Edit the campaign, do NOT create a new one

The Twilio console sidebar suggests "Register a new A2P Campaign". The error doc
says the opposite, and the doc is right: *"Edit the rejected campaign rather than
deleting and recreating it… A vetting fee is assessed only once per campaign.
Resubmitting the same campaign does not incur a new fee."* Creating a new
campaign pays the vetting fee again for nothing.

### Status

- ✅ **Owner SMS opt-in built** (`stemfra_cms/src/components/SmsAlertsCard.tsx`,
  shown on `/profile/notifications`). Unchecked by default, separate from terms
  acceptance, all four disclosures beside the box. The exact sentence is the
  versioned constant `SMS_CONSENT_TEXT` / `SMS_CONSENT_VERSION` in
  `lib/notifications.ts`; consent is stored VERBATIM with a timestamp on
  `cms_notification_prefs.prefs.sms`, so we can prove what an account agreed to.
  Opting out keeps the original record and stamps `opted_out_at`.
- ✅ Privacy policy carries the non-sharing line, and Terms carry rates +
  frequency.
- ✅ **Privacy policy now also carries** message frequency + "message and data
  rates may apply" + STOP/HELP, and links to `/sms-consent`. Verified live
  2026-08-03: "We never share or sell your mobile number or SMS opt-in data with
  third parties or affiliates for marketing or promotional purposes."
- ✅ **`stemfra.com/sms-consent` PUBLISHED and live** (2026-08-03). Carries all
  three dashboard screenshots (step 1 the page in context, step 2 the form at
  rest with the box unchecked and the button disabled, step 3 number entered and
  consent given) plus the verbatim consent sentence. Resolves at both
  `/sms-consent` and `/sms-consent/`.
  ⚠ It was **404 in production until 2026-08-03** because every commit in the arc
  was unpushed. Re-verify the URL actually loads before each resubmission; a dead
  opt-in link is a guaranteed rejection.
- ✅ **Confirmation SMS implemented** (`OPT_IN_MESSAGE` in
  `controllers/cms/smsConsentController.js`, sent best-effort on opt-in and
  reported back as `confirmationSent`). The Opt-in Message field below can now be
  filled honestly; see the note there.
- ⬜ **Paste `message_flow`** (below) into the campaign and resubmit the SAME
  campaign. This is the only remaining step.
- ⚠ **Strategic**: this campaign covers messages to STEMFRA'S OWN account holders.
  Sending SMS to tenants' end customers is messaging on behalf of third parties
  and needs the ISV model (brand + campaign per tenant), not this campaign.

⚠ If `SMS_CONSENT_TEXT` changes, bump the version, re-shoot the screenshots on
the public page, and resubmit. The stored record, the CMS screen, and the public
proof page must all show the same sentence.

### Where the opt-in URL goes (there is NO separate field)

Confusing on first look, and worth writing down: the **Edit A2P Campaign Details**
modal has no "opt-in URL" input. Its fields are Message contents (checkboxes),
**"How do end-users consent to receive messages?"**, Privacy Policy URL, Terms and
Conditions URL, and the confirm checkbox.

The opt-in URL goes **inside the "How do end-users consent to receive messages?"
free-text box** (that is TCR's `message_flow`). That is also where the rejected
link came from: the reviewer's "The Opt-in link provided (https://cms.stemfra.com/)
lacks purpose" refers to a URL inside that prose, not to a dedicated field.

⚠ That box currently holds the **rejected text**, which must be replaced wholesale,
not appended to. It describes "an opt-in toggle" with the wording *"Receive SMS
alerts for new leads and bookings…"* — a toggle that never existed, quoting a
sentence the form has never shown. That mismatch IS error 30896. Select all, delete,
paste the block below.

The Privacy Policy URL and Terms and Conditions URL fields in the same modal are
already correct (`https://stemfra.com/privacy`, `https://stemfra.com/terms`).

### Ready-to-paste campaign fields (2026-08-03)

**"How do end-users consent to receive messages?" (`message_flow`)** — replaces the
rejected text. 1,164 characters, inside the 40 to 2,048 limit. Names the URL, the
consent action, frequency, both legal links, and the public proof page, per the
30896 checklist:

> Stemfra account holders (owners and staff of businesses that use Stemfra) opt in
> inside their own dashboard. After creating an account at https://stemfra.com, the
> owner opens Profile > Notification settings at https://cms.stemfra.com, enters
> their mobile number, and ticks a checkbox that is unchecked by default and
> separate from terms acceptance. The checkbox reads: "Text me Stemfra account
> alerts: new leads, new bookings, missed calls, and billing notices. Message
> frequency varies with your business activity. Message and data rates
> may apply. Reply STOP to opt out, HELP for help." Consent is stored per account
> with a timestamp and the exact wording agreed to, and is never bought, shared or
> transferred. Because this page is behind a login, the full consent flow and
> wording are published publicly for review at https://stemfra.com/sms-consent.
> Privacy Policy: https://stemfra.com/privacy (states mobile numbers are never
> shared or sold to third parties or affiliates for marketing, and includes message
> frequency and message and data rates disclosures). Terms:
> https://stemfra.com/terms. Owners opt out any time from the same setting or by
> replying STOP.

**End User Consent section — Opt-in Message is currently empty ("-").** Opt-out and
Help keywords/messages are auto-managed by Twilio and are fine as-is. Opt-in
KEYWORDS stay empty on purpose: ours is a website opt-in, not a text-to-join
keyword, and inventing a keyword we do not support would be a fresh rejection.
Populate the Opt-in MESSAGE, which is the confirmation sent right after a web
opt-in and which reviewers look for:

> Stemfra: You are now subscribed to Stemfra account alerts (new leads, bookings,
> missed calls, billing). Msg frequency varies. Msg &
> data rates may apply. Reply HELP for help, STOP to cancel.

✅ **Safe to fill as of 2026-08-03.** This send IS implemented: `OPT_IN_MESSAGE` in
`controllers/cms/smsConsentController.js` fires on opt-in (best-effort, surfaced to
the CMS as `confirmationSent`), and the constant is byte-identical to the text
above. Keep the two in step: if one changes, change the other and resubmit.
The earlier warning here (that it was NOT built, and describing a confirmation that
does not fire would repeat the 30896 mistake) no longer applies, but the principle
does. Never describe behaviour the code does not have.

### Done since the rejection

- ✅ Owner SMS opt-in card in the CMS (commit `10b9d5b`), later moved onto the
  shared `PhoneField` archetype (`3d3857d`) so it has a country selector, real
  E.164 validation and an echo of the exact number that will be texted.
- ✅ Privacy policy carries message frequency + "message and data rates may
  apply" alongside the non-sharing statement, and links to /sms-consent.
- ✅ Public proof page **live at https://stemfra.com/sms-consent** (verified in a
  browser 2026-08-03, after the push that first deployed it) reproducing the
  dashboard card and the verbatim consent sentence, so a reviewer never needs an
  account. Screenshots re-shot to match the current form; `REV` cache-buster at 4.
- ✅ Confirmation SMS implemented, so the Opt-in Message field can be filled.
- ✅ **DONE (campaign VERIFIED — confirmed in the console 2026-08-27).** This
  step was completed: the resubmitted campaign passed review and shows
  status Verified. Historical instruction kept below for the record; it
  applies ONLY to fixing THAT campaign. The 2026-08-27 tenant-customer
  campaign at the top of this doc is a genuinely NEW, SEPARATE registration
  (different audience + use), so for it "Register a new A2P Campaign" is the
  CORRECT action and its vetting fee is expected, not wasted. Never edit the
  verified account-alerts campaign to add tenant-customer traffic.
  - (original step:) paste the `message_flow` above into the campaign
  (replacing the rejected text) and resubmit the SAME campaign via **Fix
  Campaign**, never "Register a new A2P Campaign" (that re-charges the vetting
  fee for nothing).
