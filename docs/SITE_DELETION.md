# Site deletion & lifecycle cleanup — spec (P6.26)

_Status: ✅ BUILT 2026-06-29. Policy decided by Peter: **both** staff + owner can
delete · **90-day** grace · **block on unpaid + cancel sub** · export = v2 (deferred).
Implementation: `lib/siteDeletion.js` + `lib/siteDeletionSweeper.js` + extended
`deleteSiteCascade` (provisionSite.js, now all 26 tables) + admin/cms endpoints +
CRM Sites Active/Deleted tabs + CMS Sites delete modal. Not yet exercised against a
live site (detach/purge hit real CF/Cloudinary). This doc remains the reference for
the design + the table purge order._

## Why this needs a spec, not a quick build
Deleting a site touches **three external systems + 26 DB tables**, is irreversible,
and interacts with **active billing**. A naive "DELETE FROM sites" leaves orphaned
Cloudflare domains, Cloudinary media (ongoing storage cost), and a half-deleted
graph. We also want an "oops" window. So: **soft-delete now, hard-delete on a delay**.

## ⚠ Decisions needed from Peter (before building)
1. **Who can delete?** Staff-only (CRM) first, or owner self-serve from the CMS
   Sites page too? _(Recommend: staff-only v1; owner "request deletion" → staff
   confirm. Self-serve delete of a paid asset is high-risk.)_
2. **Grace period length** before hard purge: **30 / 60 / 90 days?** _(Recommend 90
   — matches Peter's note; gives final-invoice + export time, recoverable.)_
3. **Active billing guardrail:** block delete while a subscription is `active`/
   charges are unpaid, or allow with a "this cancels billing + forfeits the site"
   confirmation? _(Recommend: block on unpaid `billing_charges`; on delete, cancel
   the subscription + stop the cycle opener.)_
4. **Export before delete?** Offer the owner a data export (leads/customers/
   bookings CSV) at deletion time? _(Recommend: v2 — note it, don't block v1.)_

## Lifecycle model
```
live / previewing  --(delete)-->  soft-deleted (status='deleted', deleted_at set)
                                     │  hidden from CMS + CRM + public; domain detached
                                     │  (recoverable by staff during grace window)
                                     └--(grace window elapsed, sweeper)--> HARD PURGE
```
- **Soft-delete (immediate):** detach Cloudflare domains/DNS, set `sites.status='deleted'`
  + `deleted_at`/`deletion_reason`/`deletion_initiated_by`, cancel billing, audit.
  The site stops serving (detach) and disappears from all lists. Media + DB rows
  **stay** for the grace window so it's recoverable.
- **Hard purge (delayed sweeper):** delete Cloudinary media + all DB child rows +
  the `sites` row. Irreversible.

## Schema (additive)
```sql
ALTER TABLE sites ADD COLUMN deleted_at timestamptz NULL;
ALTER TABLE sites ADD COLUMN deletion_reason text NULL;
ALTER TABLE sites ADD COLUMN deletion_initiated_by uuid NULL; -- staff or owner id
-- 'deleted' value: site_status is an enum → ALTER TYPE site_status ADD VALUE 'deleted';
-- (or keep status as-is and treat deleted_at IS NOT NULL as the filter — simpler, no enum change. RECOMMENDED.)
```
**Recommendation:** use `deleted_at IS NOT NULL` as the soft-delete signal (no enum
change). Every list query (CMS `useOwnerContext` sites select, CRM `listSites`,
the templates' host-resolver `useSiteByHost`) adds `.is('deleted_at', null)`.

## External cleanup (reuse existing helpers)
1. **Cloudflare** — `detachSiteDomain(siteId)` (`lib/attachSiteDomain.js`) already
   removes `{subdomain}.stemfra.com` + the custom domain from the vertical's Pages
   project and deletes our-zone CNAMEs. Idempotent. Call on **soft-delete** (stops
   serving immediately). Sites share one Pages project per vertical → **we do NOT
   delete a CF project**, only detach domains.
2. **Cloudinary** — folder = `site.subdomain`. On **hard purge**, iterate
   `site_media` (storage_provider='cloudinary') and `cloudinary.uploader.destroy(
   storage_key, { resource_type })` (video vs image from mime), mirroring
   `uploadController.deleteMedia`. Best-effort per file (don't block on one failure).
   _Optional:_ `cloudinary.api.delete_resources_by_prefix(subdomain + '/')` +
   `delete_folder` as a faster sweep — but pre-Phase-2 assets used `sites/{uuid}/`
   so file-by-file is the safe baseline.

## DB purge order (verified 2026-06-29 — 26 site-scoped tables)
Delete children before parents. The existing `deleteSiteCascade`
(`lib/provisionSite.js`, rollback-only) covers **10** of these — **it must be
extended** (it currently misses bookings, customers, media, leads, conversations,
activity, payment accounts, and the newer commerce tables).

Order (reverse-FK):
1. `agent_conversations` · `site_activity` · `site_preview_tokens` · `site_deployments` · `site_integrations`
2. `billing_charges` → then `subscriptions` (System A) ; `site_subscriptions` (member subs) ; `site_orders` ; `site_payment_accounts`
3. `site_bookings` → `site_booking_groups` → `site_customers` ; `site_class_sessions`
4. `site_leads`
5. `site_team_service_links` → `site_availability_rules` → `site_services` → `site_service_categories` → `site_team_members` ; `site_products` ; `site_testimonials`
6. `site_sections` → `site_pages` → `site_theme_settings` → `site_media`
7. `sites` (the row itself — hard purge only)

_(Most media FKs are already `ON DELETE SET NULL`, so step 6 ordering is soft, but
keep media last so nothing references a destroyed Cloudinary asset mid-purge.)_

## Endpoints to build
- **Soft-delete (staff):** `POST /api/admin/sites/:siteId/delete { reason }`
  (`PLATFORM_ADMIN`) → guardrail check → `detachSiteDomain` → cancel subscription +
  stop cycle → set `deleted_at`/reason/by → `logSiteActivity('site_deleted')`.
- **Restore (staff):** `POST /api/admin/sites/:siteId/restore` → clear `deleted_at`
  → re-`attachSiteDomain`. Only valid during the grace window.
- **Owner request (optional):** `POST /api/cms/sites/:siteId/request-deletion`
  → flags for staff (no destructive action) — if self-serve is deferred.
- **Sweeper:** `lib/siteDeletionSweeper.js` (mirror `billingCycleSweeper.js` — a
  `setInterval` started from `index.js`): find `deleted_at < now() - INTERVAL '90 days'`,
  purge Cloudinary + DB in the order above, audit. Idempotent + best-effort.

## CMS / CRM surface
- **CRM Sites page** (`stemfra-ops/src/pages/Sites.jsx`): add a **Delete** action
  (confirm dialog naming the site + listing what's removed + the grace window) +
  a "Deleted" filter showing soft-deleted sites with a **Restore** button.
- **CMS Sites page** (`SitesPage.tsx`): per decision #1 — either a Delete action or
  a "Request deletion" link; hide `deleted_at IS NOT NULL` sites from the grid.

## Build order when greenlit
1. Schema (`deleted_at` cols) + add `.is('deleted_at', null)` to all 3 list/resolve queries.
2. Extend `deleteSiteCascade` to the full 26-table set (also fixes the latent
   rollback-orphan gap).
3. Soft-delete + restore endpoints (+ guardrail + CF detach + billing cancel + audit).
4. Sweeper (Cloudinary + hard purge after grace).
5. CRM Sites delete/restore UI; CMS surface.
6. Verify on a throwaway provisioned site end-to-end before any real use.
