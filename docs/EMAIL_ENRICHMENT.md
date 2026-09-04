# Email enrichment for no-website leads

_2026-09-03. How we find outreach emails for scraped businesses that have no
website (the core Stemfra segment). Built from a research pass + a live
5-lead pilot; companion to [EMAIL_DELIVERABILITY.md](EMAIL_DELIVERABILITY.md)
(how to SEND once you have the email) and [LEADGEN.md](LEADGEN.md)._

## The facts

- The Google Business Profile registration email is **not obtainable** —
  no API/registry exposes it (Google feature request open since 2016).
- Every "Google Maps email extractor" actor crawls the listed WEBSITE, so
  they return nothing for our segment. Don't spend credit there.
- The emails that exist live on the business's **Facebook page** (primary),
  **Instagram bio** (secondary), and occasionally state records. Booking
  platforms (Booksy/Fresha/StyleSeat) show phone only — they are a lead
  SOURCE, not an email source.

## Live pilot result (5 Bronx barbershop leads, ~2¢)

FB-match + Apify contact actor: **1/5 verified email** (Ortiz Barbershop —
the FB page's phone matched our lead exactly). 2/5 had a findable FB page at
all; 1 had only a celebrity-barber IG with agent handles, no email; 2 had no
usable social. Full table: stemfra root
`video_research/google-maps-scraping-three-ways/notes.md`.

## Working recipes (Apify, token currently borrowed from Helen's server .env)

1. **Facebook contact extraction** — `apify~facebook-page-contact-information`
   (official, ~$6.60/1,000, no rental):
   `POST /v2/acts/apify~facebook-page-contact-information/run-sync-get-dataset-items`
   with `{"pages": ["<fb page url or username>", ...], "language": "en-US"}`.
   Returns email/phone/address/IG/websites. Finding the page first: search
   `"<business name>" <city> facebook` (Serper.dev is the cheap primitive at
   scale, ~$0.3-3/1k queries).
2. **Instagram bio extraction** — `apify~instagram-profile-scraper` (official,
   no rental): `{"usernames": ["<handle>"]}` → regex the `biography` for
   emails + follow `externalUrl` (linktree) for mailto links. Only run on
   VERIFIED handles — name-alike accounts poison the data.

## ⚠ Verification rule (load-bearing)

An email is only written to a lead when the source page is verified as the
same business: **the page's phone OR street address must match the scrape**.
A name match alone is never enough (the Ortiz hit was phone+address
verified; the "Wonka Barber Shop" IG name-alike was a shop in Hungary).
Record the provenance in `leads.notes`.

## Outscraper pilot (Peter action → then Claude runs the import)

Outscraper is the one vendor whose email enrichment is BUILT for no-website
businesses (it finds the FB page itself and address-verifies — the automated
version of recipe 1). Pilot steps:

1. **Peter**: create the account at outscraper.com (first **500 records
   free**; after that ~$3/1k Maps + $3/1k emails). Grab the API key from
   Profile → API. Never paste the key in chat — drop it in
   `stemfra_server/.env` as `OUTSCRAPER_API_KEY=`.
2. **Claude**: export our email-less leads (place IDs live in
   `leads.source_detail`) → submit to Outscraper's
   "Emails & Contacts" service against those exact places → import results
   back onto the leads WITH the phone/address verification rule + provenance
   notes, and flag which leads remain email-less (those stay SMS/call-only).
3. Measure the real hit rate on our list — that number decides whether we
   also build recipes 1+2 as a standing post-scrape enrichment stage in the
   n8n pipeline.

## Outscraper pilot RESULTS (2026-09-04, ~134 of the 500 free records)

All 67 email-less leads submitted (place-id or name+address queries,
`/google-maps-search` + `enrichment: ["domains_service"]`, X-API-KEY auth):

- **67/67 queries matched the right place** (their matcher is good).
- **7/67 got a Facebook page** (10%); **1/67 got an email** — Proper Cuts
  Barbershop (propercutsbarbershop@gmail.com), written to the lead.
- Cross-check: the Apify FB extractor run on the same 7 pages found the SAME
  single email — the other pages publish none. Outscraper's reading is fine;
  the data simply is not there.
- Their FB matching also MISSES pages a manual search finds (it found no
  page for D'Esther, which we had manually verified) — manual/SERP matching
  still adds a little on top.

**Honest conclusion:** no-website micro-businesses mostly publish NO email
anywhere. Realistic automated email yield ≈ **1-5% per pass** (the earlier
~18% manual figure was small-sample luck). Email enrichment is a cheap
bonus trickle to run per scrape cohort — not a pipeline. **Phone/SMS (which
we capture at 100%) is the structural channel for this segment**, with the
claim email reserved for the minority that surface an email. Apollo was
evaluated and skipped (domain/LinkedIn-keyed B2B data; no coverage here).

## Registry angle (parked, cheap when wanted)

State barber-license files give OWNER NAMES (not emails): Texas TDLR
publishes free daily CSVs; Florida DBPR extracts are free and a
public-records request there for licensee emails is legitimate; Washington
SoS bulk data includes emails. Best use: personalizing outreach ("Hi Maria"
instead of "Hi Owner") and person-level social matching.
