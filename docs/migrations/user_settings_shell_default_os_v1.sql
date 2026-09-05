-- Stemfra OS shell is the default for everyone (Peter 2026-09-05, after the arc was
-- pushed). Applied live the same day via the Management API.
-- 1. New rows default to the OS shell.
alter table public.user_settings alter column shell set default 'os';
-- 2. Every existing staff row moves to the OS shell (classic stays a per-user choice
--    they can switch back to in Settings → Appearance → Shell).
update public.user_settings set shell = 'os' where shell is distinct from 'os';
