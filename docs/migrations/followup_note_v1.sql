-- Follow-up note (2026-09-03, Amo parity): why the follow-up exists ("owner
-- asked to call back Thursday 3pm"). Lives with the follow-up, cleared when
-- the result is logged.
alter table public.leads add column if not exists followup_note text;
