-- Stemfra OS shell, Phase 1 foundation (2026-09-05). Applied live the same day.
-- Per-user shell preferences read/written through /api/user-settings
-- (routes/userSettings.js ALLOWED_FIELDS). All additive, all nullable-or-defaulted.
alter table public.user_settings
  add column if not exists shell text not null default 'classic',        -- 'classic' | 'os' (Phase 2+)
  add column if not exists wallpaper text,                               -- key from stemfra-ops src/lib/wallpapers.js
  add column if not exists sidebar_docked boolean not null default true, -- classic sidebar docked vs floating-only
  add column if not exists dock_pins jsonb not null default '[]'::jsonb, -- ordered app ids (Phase 3)
  add column if not exists app_usage jsonb not null default '{}'::jsonb, -- { appId: { n, last, hours[] } } (Phase 3)
  add column if not exists workspace_session jsonb,                      -- open windows + layout (Phase 2)
  add column if not exists desktop_layout jsonb;                         -- widget grid (Phase 5)
alter table public.user_settings
  add constraint user_settings_shell_check check (shell in ('classic','os'));
