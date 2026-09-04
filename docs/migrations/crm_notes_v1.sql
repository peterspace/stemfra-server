-- Stemfra OS Phase 4 (2026-09-05): the Notes tool. One private sticky note per
-- staff member per record (or a general note: entity_type='general', entity_id='').
-- Written directly by the CRM through the anon client; RLS = own rows only.
create table if not exists public.crm_notes (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  entity_type text not null,              -- 'lead' | 'contact' | 'company' | 'deal' | 'site' | 'general'
  entity_id   text not null default '',   -- record id ('' for general)
  body        text not null default '',
  updated_at  timestamptz not null default now(),
  created_at  timestamptz not null default now(),
  unique (user_id, entity_type, entity_id)
);
alter table public.crm_notes enable row level security;
drop policy if exists crm_notes_own on public.crm_notes;
create policy crm_notes_own on public.crm_notes
  for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create index if not exists crm_notes_user_entity_idx on public.crm_notes (user_id, entity_type, entity_id);
