-- email_sends (2026-09-03): per-MESSAGE ledger for CRM-sent email (1:1 and
-- mass sends from reps' Gmail), with its own open-tracking token — distinct
-- from the per-lead outreach_track_token, which belongs to the lead-gen
-- campaign and must not be overwritten by ad-hoc rep mail. Powers the
-- Opened / Not-opened chips in the LeadDrawer Emails section.
begin;
create table if not exists public.email_sends (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid references public.leads(id) on delete cascade,
  contact_id uuid references public.contacts(id) on delete set null,
  sent_by uuid references public.profiles(id) on delete set null,
  to_email text not null,
  subject text,
  kind text not null default 'direct' check (kind in ('direct','mass')),
  track_token text unique not null,
  sent_at timestamptz not null default now(),
  opened_at timestamptz,
  last_opened_at timestamptz,
  open_count integer not null default 0
);
create index if not exists email_sends_lead_idx on public.email_sends (lead_id, sent_at desc);
alter table public.email_sends enable row level security;
drop policy if exists email_sends_staff_all on public.email_sends;
create policy email_sends_staff_all on public.email_sends
  for all to authenticated using (is_stemfra_staff()) with check (is_stemfra_staff());
commit;
