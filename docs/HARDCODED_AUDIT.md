# Hardcoded / non-CMS-editable content audit — per vertical

_Created 2026-08-14. Precursor to the About/Contact review arc (see ROADMAP → 🎨
Theme polish). Goal: for each vertical's active themes, list the text/images/content
a tenant owner **cannot** edit in the CMS, so Peter can pick what to make editable
(same pass we did for barbers). Process per vertical: scan → present → Peter picks →
build (current text = defaults, nothing changes until edited) → then About/Contact._

**Standing decisions carried from barbers (apply to every vertical unless Peter says otherwise):**
- **Leave hardcoded:** nav labels · footer legal links (FAQ/Privacy/Terms/Cookies) · generic
  UI chrome (ContactForm/BookingForm/MultiServiceBookingForm placeholders + buttons, blog
  microcopy, map link text, loading/empty/error strings, aria-labels).
- **Make editable:** everything else — via the `metadata.labels` + CMS **"Buttons & labels"**
  panel pattern (per-app, since each vertical has its own Layout) + section content where a
  section editor already exists.
- Barbers is **DONE** (shipped). The five below are **audited, awaiting Peter's per-vertical pick.**

Each audit was produced by a scan of the vertical's app (`stemfra_templates/stemfra_<v>/src/`)
+ the archetype variants its active themes render. Line numbers are point-in-time (2026-08-14).

---

## 🐞 Cross-cutting bugs found (fix regardless of the editability decision)

These are **wrong-vertical leftovers** from cloning, not just "uneditable" — they render
incorrect content for real tenants:

| Vertical | File:line | Problem |
| --- | --- | --- |
| yoga | `ClassesPage.tsx:41` | Brand fallback `'Lila Studio'` — a stale real brand leaks if the company join fails (others use a generic like "Yoga Studio"). |
| yoga | `AccountPage.tsx:456` | Cancellation reason `'Switching to another gym'` — yoga isn't a gym. |
| massage | `ClassesPage.tsx:41` | Brand fallback `'Calm Roots Massage'` — real tenant name leak (dead-ish file, but wrong). |
| massage | `AboutPage.tsx:87` | ZenAbout stats hardcode `'Est. 2019' / 'Serving Austin'` — Zen-Haven/Austin specific, wrong for any other tenant on that theme. |
| massage | `BookPage.tsx:111,115,121,116,156` | Yoga leftovers: `'Book your first class'`, `'Class schedule'`, `'Book a one-on-one intro'`, `professionalNoun="teacher"`. |
| massage | `Layout.tsx:237` | Footer `accentImageLabel="Sukhasana · Easy pose"` — a yoga pose label on a massage footer. |
| spa | `HomePage.tsx:261` | `FALLBACK.brand = 'Massage Studio'` — wrong vertical (clone leftover). |
| spa | `BookPage.tsx:177,181,187,182,222` | Yoga leftovers: `'Book your first class'`, `'Class schedule'`, `'Book a one-on-one intro'`, `professionalNoun="teacher"` (spa should say *therapist*). |
| spa | `Layout.tsx:237` | Footer `accentImageLabel="Stillness · Serenity Spa"` — stale demo brand (Serenity was removed). |

**House-style (em-dash) violations found in hardcoded copy** — clean these when touched:
`salons Layout.tsx:21` (GENERIC_TAGLINE), `salons HeaderWordmarkPills.tsx:298` (mega-menu line),
`spa Layout.tsx:36` (GENERIC_TAGLINE), `spa TreatmentsPage.tsx:49-50` (SpaCatalog body).

---

## SALONS — active themes: Beauty House (★-ish default family), Sorrel

**Recommend make editable (the barbers-equivalent set):**
- Header: CTA text ("Book" Sorrel / "Book Appointment"), `brandTag="Salon"` (Beauty House),
  secondary CTA "Gift Cards"→/gift-certificates, mega-menu CTA "Book a Consultation" + the
  mega-menu footer sentence (`HeaderWordmarkPills.tsx:298`). `Layout.tsx:115,119,121-124`.
- FrontDesk chat chips (`Layout.tsx:167`).
- Footer: newsletter heading/placeholder/"Stay updated"/column headings ("Menu"/"Contact"/
  "Opening hours"/"Phone"/"Mail"/"Write to us"/"Social"), copyright line, "Visit" wordmark
  (Sorrel), "Back to top". `FooterNewsletterMultiCol.tsx` + `FooterVisitDeep.tsx`.
- Home section-heading fallbacks (service/team/reviews/location) `HomePage.tsx:162-169`;
  home location CTA "Book an appointment" `:385-386`.
- Gift Certificates page (`GiftCertificatesPage.tsx`) — **heavily hardcoded**: TIERS array
  (names/body/price chips + 3 Cloudinary tier images), INCLUDES bullets, "Every gift includes",
  "Enquire" labels, fine print. Good candidate for a dedicated editor or content section.
- Theme-variant labels: category-tabs "View the full {category} menu & pricing", instagram-grid
  "Posts/Followers/Following" + "+ Follow", photo-panel "Get directions", rotating-quote "/ 5 Stars".

**Fallback-defaults (already overridable by editing the section — lower priority):**
PageHeader titles (Our Story / Services / Get in touch / Book a visit / Our Stylists / Gift Cards / Blog / FAQ),
`FALLBACK_BRAND='Salon'`, GENERIC_TAGLINE, blog/gift body fallbacks, legal titles.

**Leave:** nav (Services/Stylists/About/Contact), footer legal, ContactForm/MultiServiceBookingForm chrome.

---

## CROSSFIT — active themes: Box, Volt, BlackFly, 212

**Recommend make editable:**
- Header CTA "Claim Free Intro" (`Layout.tsx:120`); HeaderVolt decorative `.`/` →` accents.
- Footer FOOTER_GROUPS column headings + links ("Train"/"Join"), extra footer links, GENERIC_TAGLINE.
- Home: section-heading fallbacks (Programs/Our Coaches/…), team `yearsLabel="years coaching"` +
  "View all coaches" CTA (`HomePage.tsx:351-353`), location "Book an appointment" (`:515-516`).
- Memberships/Training: plan CTA "Join", post-join banner + JoinDialog copy, TrainingPage
  "Train with a coach" heading + intro (`TrainingPage.tsx:68-69`).
- Theme-variant labels: HeroRingBurst "Claim Free Week", ClassSchedule "Book"/"W.O.D",
  FreeIntroOffer CTA, PricingTiers "Most popular"/"Joining…", TeamGridCoachCards "yrs",
  Testimonials "Verified reviews"/"Based on"/"reviews", GalleryBlackFly "Explore".

**Fallback-defaults:** PageHeader titles (Programs/Schedule/Our Coaches/Get in touch/Claim Your Free Intro/
Memberships/FAQ/Blog), `FALLBACK_BRAND='CrossFit Box'`, businessName 'us', legal titles.

**Leave:** nav (Schedule/Classes/Training/Memberships/About/Contact/Account), footer legal,
AccountPage member-portal chrome, forms. **Note:** AccountPage `CANCEL_REASONS` includes
gym-appropriate reasons here (unlike yoga) — fine for crossfit.

**Also flagged (not text):** hardcoded hex colors in a few spots — `AboutStoryHeader` `#FFFFFF`/`#0E0E0E`,
ContactPage `#080808`, PricingTiers light-card hexes. Not CMS-editable; usually intended, note only.

---

## YOGA — active themes: Sanctuary (★), Sawiet

**Recommend make editable:**
- Header CTA "Book Your First Class" (`Layout.tsx:91`); FrontDesk chips (`:139`).
- Footer: FOOTER_IMAGE_URL Cloudinary inset photo (`:23`), description template (`:108`),
  linkGroups headings+labels (`:110-114`), `accentImageLabel='Sukhasana · Easy pose'` (`:126`),
  FooterLightColumns "Explore" (Sawiet).
- Home: FALLBACK section headings + eyebrows (`HomePage.tsx:230-243`), location CTA "Book an appointment" (`:486`).
- Book page: "Class schedule", "Book a one-on-one intro" section headings, `professionalNoun="teacher"`.
- Contact "Visit"/"Phone"/"Hours" labels; Memberships copy (title/body/eyebrow/heading + per-plan "Join").
- Theme-variant: TeamGridSoftCarousel "View All"/"View Less".

**Fallback-defaults:** PageHeader titles, blog title+body, legal titles.
**Bugs (above):** `ClassesPage.tsx:41` 'Lila Studio' leak; `AccountPage.tsx:456` "Switching to another gym".
**Leave:** nav (Classes/Memberships/Teachers/About/Contact + Blog/Account), footer legal, forms.

---

## MASSAGE — active themes: Escape (★ default), Zen Haven, Reverie

_Hybrid single-page Layout (anchor nav + scrollspy + NAV/NAV_ACTIONS arrays)._

**Recommend make editable:**
- Header CTA "Book"; footer FOOTER_IMAGE_URL, description template, linkGroups
  (Treatments/Studio/Support), FrontDesk chips. `Layout.tsx`.
- Home: FALLBACK section headings, hero secondary CTA "Gift Certificate"→/gift-certificates
  (hardwired, `HomePage.tsx:337-338`), location "Book an appointment" (`:560-561`).
- About: ValuesBand "Three things we will not compromise" + 3 value cards, closing CTA band
  ("Come see for yourself") — `AboutPage.tsx:132-148`. Treatments/Team closing bands.
- Contact "Visit/Phone/Hours"; Gift Certificates page (TIERS + INCLUDES, "Every gift includes",
  "Enquire about a gift", fine print) + GiftBand ("Give the gift of relaxation", GIFT_IMAGE).
- Theme-variant labels: ServiceMenu detail-rows "Benefits"/"Perfect For"/"Book Service",
  detail-cards "Book", TeamGrid rating-cards-band "Book Service"/"View All", profiles "Book with
  {first}", soft-carousel "View All"/"View Less", HeroOverlayBooking "Online Booking"/"Book Now",
  GiftPackages "Explore Packages", BookingFormBand field labels, ProgramCards "Book this program".

**Fallback-defaults:** PageHeader titles, `FALLBACK_BRAND='Massage Studio'`, blog/FAQ/legal titles.
**Bugs (above):** ClassesPage 'Calm Roots Massage' leak; AboutPage "Est. 2019/Serving Austin";
BookPage yoga leftovers; footer "Sukhasana" label. **Dead code:** `PricesPage.tsx` not routed.
**Leave:** nav (Services/Team/About/Blog + Contact/Login), footer legal, AccountPage portal, forms.

---

## SPA — active themes: Ellaris (★ default), Lumora, Respira

_Same hybrid single-page Layout as massage._

**Recommend make editable:**
- Header CTA "Book"; footer description template, linkGroups, `accentImageLabel` (stale "Serenity Spa"),
  FOOTER_IMAGE_URL, FrontDesk chips. `Layout.tsx`.
- Home: section-heading fallbacks (Services/Our Team/Reviews/Visit Us), hero secondary CTA
  "Gift Certificate" (hardwired), location "Book an appointment".
- Gift Certificates page (TIERS + INCLUDES + labels + 3 Cloudinary tier images) + GiftBand.
- Theme-variant labels: HeroPhotoOverlay rotating disc "EXPLORE MORE" (Ellaris), ServiceMenu
  ruled-rows "Read More ↗" (Ellaris) / quiet-cards "Learn more →" (Lumora), Gallery journal-cards
  "Wellness Journal"/"View all insight"/"Read more →" (Lumora), MembershipFeaturedTiers "Book
  Session" (Lumora), CtaBanner "Book an Appointment" defaults, FooterAccentPanel "Connect With
  Us"/"A Moment Just for You"/"Book an Appointment →" (Lumora), FooterDarkEditorial "Explore"
  (Ellaris), ProgramCards "Book this program" (Respira).

**Fallback-defaults:** PageHeader titles, `FALLBACK_BRAND='Day Spa'`, blog "Notes on rest"/FAQ/legal titles.
**Bugs (above):** `FALLBACK.brand='Massage Studio'`; BookPage yoga leftovers; footer stale brand label.
**Leave:** nav (Services/Team/About/Blog + Contact/Login), footer legal, AccountPage portal, forms.

---

## Recommended sequencing

Same as barbers, one vertical at a time so Peter reviews between:
1. Fix the **cross-cutting bugs** (cheap, correctness — can batch across all verticals in one pass).
2. Per vertical, Peter picks the make-editable set → build `metadata.labels` + a per-app CMS
   "Buttons & labels" panel + section-content editors → defaults = current text.
3. Then the **About/Contact page review** for that vertical (default theme first).

Suggested vertical order (matches the About/Contact review order): salons → crossfit → yoga → massage → spa.
