# Demo sites — vertical showcase for lead-gen outreach

**Last updated: 2026-06-28**

Live, polished example sites — one per active theme across the 4 live verticals —
that Mark's lead-gen outreach links to so a prospect can see a real site for
*their own kind of business* before they reply. All owned by a single
**"Stemfra Demos"** account so they're managed in one place.

## The owner — `mark@stemfra.com` ("Stemfra Demos")

One owner contact owns every demo site (the multi-site model: owner contact →
N companies → N sites).

| Thing | Value |
| --- | --- |
| Auth user (CMS login) | `17cb2c0b-1635-4a66-a3cb-b374eb5b8eaa` (`mark@stemfra.com`) |
| Owner contact | `2cdcfe53-0117-45da-a447-7d60ee0a6236` (`Mark — Stemfra`, type `client`) |
| Umbrella company | `5ed15d6f-6916-4071-9212-9a676e3ebdb6` (`Stemfra Demos`) |
| CMS login | `https://cms.stemfra.com` — password in `stemfra_email_service_key/mark-cms-login.txt` (local, gitignored). Change after first login. |

**CRM note:** `mark@stemfra.com` is `@stemfra.com`, so the `handle_new_user`
trigger auto-created a staff `profiles` row. It's an outreach/demo identity, NOT
a CRM staffer, so that profile is set `is_active = false` (blocks CRM entry; CMS
login is unaffected — the CMS authenticates owners via `contacts.auth_user_id`,
not `profiles`). `mark@` is also the identity the lead-gen engine sends/reads
outreach as (see the Mark service-account setup).

## The 9 demo sites

One per **active** theme. Boutique gyms is excluded (deferred indefinitely — no
seed, no Pages project). Each is `live` at `{subdomain}.stemfra.com`.

| Vertical | Theme | Brand | URL |
| --- | --- | --- | --- |
| barbershops | Manhattan | Rourke & Sloane | https://rourke-sloane.stemfra.com |
| barbershops | Classic NYC | Halsey & Crowe | https://halsey-crowe.stemfra.com |
| salons | Sorrel | Linden & Lark | https://linden-lark.stemfra.com |
| salons | Beauty House | Vesper Beauty House | https://vesper-beauty-house.stemfra.com |
| crossfit | Box | Ironclad Athletics | https://ironclad-athletics.stemfra.com |
| crossfit | Volt | Voltage Strength | https://voltage-strength.stemfra.com |
| crossfit | BlackFly | Blackfly Barbell | https://blackfly-barbell.stemfra.com |
| crossfit | 212 | 212 Strength Co. | https://212-strength-co.stemfra.com |
| yoga_pilates | Sanctuary | Wildflower Yoga + Pilates | https://wildflower-yoga-pilates.stemfra.com |

## How a demo is provisioned

`scripts/provision-demos.js` — reuses the proven libs; per spec:

1. **Company** — insert a `companies` row named after the demo brand.
2. **`provisionSite()`** (`lib/provisionSite.js`) — seed-clones the vertical's
   canonical fixture (Argyle / Maison Lune / Forge & Bell / Lila) into a new
   `previewing` site with the chosen `templateSlug` (theme) + the Stemfra Demos
   owner. Full content comes across (sections, services, team, hours,
   testimonials); only theme + name/subdomain differ.
3. **Brand rename** — the clone carries the *seed's* brand strings, so we
   find/replace them in the cloned `site_sections.content` (jsonb) and
   `site_team_members.bio`:
   - brand **name** (`Argyle & Sons` → new brand; distinctive short forms too),
   - **email domain** (`…@argyle-and-sons.com` → `…@{subdomain}.com`).
   - **NOT** touched: Cloudinary asset URLs that contain `{seed-slug}/` — those
     are real shared demo images; rewriting them would 404 the photos.
   - A residual check asserts **0** leftover seed-brand strings in display copy.
4. **`attachSiteDomain()`** (`lib/attachSiteDomain.js`) — attaches
   `{subdomain}.stemfra.com` to the vertical's Pages project (`VERTICAL_PROJECT`)
   + proxied CNAME (Universal SSL on `*.stemfra.com` serves immediately; CF's
   own custom-domain status can read `pending` for minutes — that's fine).
5. **Publish** — set `status = 'live'` (AFTER attach, which ends on `previewing`).

The browser tab title resolves from `company.name` via the `SiteHead` archetype
(`resolveSiteHead({ brand })`), so the static `index.html` `<title>` is just a
pre-hydration placeholder — the rendered title is the demo's real brand.

### Run it

```bash
cd stemfra_server
NODE_PATH=$PWD/node_modules node scripts/provision-demos.js [startIndex] [count]
```

Idempotent-ish: a spec whose company already has a site is *resumed*
(rename/attach/publish re-run, which are no-ops if already applied). To add a
new demo, append to the `DEMOS` array and re-run.

## How Mark's emails use the demos — `{{demo_link}}`

`lib/demoLinks.js` is the single source of truth:
- `FLAGSHIP` — one demo URL per vertical (the email link).
- `resolveDemoLink(slug)` — normalizes every slug form in the stack
  (`barber`/`barbershop`/`barbershops`, `salon`/`beauty_salon`/`salons`,
  `yoga`/`yoga_pilates`, `crossfit`) → the flagship URL.
- `fillOutreachLinks(text, { templateSlug })` — replaces `{{demo_link}}` (from
  the lead's `template_slug`) and `{{start_free_link}}` (→ `/pricing`).

Wired into `POST /api/leadgen/send-outreach` (`routes/leadgen.js`): the draft is
run through `fillOutreachLinks` before the Mark signature + send, so an approved
template containing `{{demo_link}}` ships the vertical-matched live demo.
Per-lead *text* fields (first_name/business_name/…) are still filled by the
drafter; full template-fill merge is the separate pending lead-gen work.

## Adding the per-vertical flagship

To change which demo a vertical's emails link to, edit `FLAGSHIP` in
`lib/demoLinks.js`. Current flagships: barber→Rourke & Sloane, salon→Linden &
Lark, crossfit→Ironclad Athletics, yoga→Wildflower.
