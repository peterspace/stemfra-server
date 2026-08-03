# A2P 10DLC Registration — prepared answers for Peter

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
- ✅ Privacy policy already carries the non-sharing line (`Privacy.jsx`), and
  Terms already carry rates + frequency.
- ⬜ **Add to the privacy policy**: message frequency + "message and data rates
  may apply" (currently in Terms only; the doc wants them in Privacy too).
- ⬜ **Publish `stemfra.com/sms-consent`** with screenshots of the card above.
- ⬜ **Rewrite `message_flow`** naming that URL, the checkbox wording, frequency,
  and inline privacy/terms links; then edit + resubmit the SAME campaign.
- ⚠ **Strategic**: this campaign covers messages to STEMFRA'S OWN account holders.
  Sending SMS to tenants' end customers is messaging on behalf of third parties
  and needs the ISV model (brand + campaign per tenant), not this campaign.

⚠ If `SMS_CONSENT_TEXT` changes, bump the version, re-shoot the screenshots on
the public page, and resubmit. The stored record, the CMS screen, and the public
proof page must all show the same sentence.
