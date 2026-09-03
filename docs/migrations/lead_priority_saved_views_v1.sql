-- lead_priority_saved_views_v1 — applied live 2026-09-03 (Management API).
-- 1. Monday-style lead priority (CRM drawer/modal/card chip + filter facet).
-- 2. Per-user saved pipeline views (user_settings, served by
--    routes/userSettings.js — 'saved_lead_views' added to ALLOWED_FIELDS).

alter table leads
  add column if not exists priority text
    check (priority in ('high', 'medium', 'low'));

alter table user_settings
  add column if not exists saved_lead_views jsonb not null default '[]'::jsonb;
