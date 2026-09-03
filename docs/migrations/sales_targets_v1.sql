-- Sales targets + won attribution (role arc stage 4c, 2026-09-03).
-- sales_targets: one row per rep per month (revenue + won-count targets),
-- read by all staff (leaderboard visibility), written by
-- super_admin/admin/manager. leads.won_at stamps WHEN a lead was won so
-- monthly performance is honest (updated_at moves on any edit); existing won
-- leads backfilled from updated_at.
begin;

create table if not exists public.sales_targets (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  month date not null,
  target_revenue numeric not null default 0,
  target_won integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (profile_id, month)
);
alter table public.sales_targets enable row level security;
drop policy if exists sales_targets_staff_read on public.sales_targets;
create policy sales_targets_staff_read on public.sales_targets
  for select to authenticated using (is_stemfra_staff());
drop policy if exists sales_targets_mgr_write on public.sales_targets;
create policy sales_targets_mgr_write on public.sales_targets
  for all to authenticated
  using (has_crm_role('super_admin','admin','manager'))
  with check (has_crm_role('super_admin','admin','manager'));

alter table public.leads add column if not exists won_at timestamptz;
update public.leads set won_at = updated_at where stage = 'won' and won_at is null;

commit;
