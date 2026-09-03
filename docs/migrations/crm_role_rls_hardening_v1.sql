-- CRM role-based RLS hardening v1 (2026-09-03) — stage 2 of the role arc.
--
-- WHY (two reasons, the first urgent): the policy audit (docs/CRM_RLS_INVENTORY.md)
-- found ~25 CRM tables carrying permissive policies with qual `true` or
-- `auth.uid() IS NOT NULL` for {authenticated}/{public} — meaning ANY signed-in
-- Supabase user (every tenant owner and gym member shares this auth project)
-- could read AND write the whole CRM: leads, contacts, companies, deals, calls,
-- SMS content, and Stemfra's income/expenses/invoices. Second: sales managers
-- are being onboarded and must not reach finance/pricing/role management.
--
-- MODEL: three tiers via is_stemfra_staff() (any ACTIVE profile) and
-- has_crm_role(variadic) (active profile with one of the named roles):
--   staff-wide  -> operational CRM tables every staff role uses
--   finance     -> super_admin/admin/manager/finance
--   admin-only  -> super_admin/admin (pricing config/quotes/proposals)
-- Owner-self carve-outs preserved for the CMS: contacts self-read,
-- companies read for sites the owner controls.
--
-- Applied to the live DB via the Supabase Management API on 2026-09-03.
-- This file is the durable record; re-running is safe (drops are IF EXISTS,
-- creates are preceded by drops).

begin;

-- ─── profiles ──────────────────────────────────────────────────────────────
drop policy if exists "Users can view all profiles" on public.profiles;
drop policy if exists "profiles_select" on public.profiles;
create policy profiles_self_or_staff_select on public.profiles
  for select to authenticated using (id = auth.uid() or is_stemfra_staff());

drop policy if exists "Admins can update any profile" on public.profiles;
create policy profiles_superadmin_update on public.profiles
  for update to authenticated
  using (has_crm_role('super_admin')) with check (has_crm_role('super_admin'));
-- self-update stays ("Users can update own profile" / profiles_update), but a
-- trigger blocks self-escalation: role/is_active changes need super_admin.
create or replace function public.guard_profile_privileges()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (new.role is distinct from old.role or new.is_active is distinct from old.is_active)
     and not has_crm_role('super_admin') then
    raise exception 'Only a super admin can change roles or active status.';
  end if;
  return new;
end $$;
drop trigger if exists trg_guard_profile_privileges on public.profiles;
create trigger trg_guard_profile_privileges
  before update on public.profiles
  for each row execute function public.guard_profile_privileges();

-- ─── finance: income / expenses / invoices ─────────────────────────────────
drop policy if exists "Admin and managers can manage income" on public.income;
drop policy if exists "Admin and managers can view income" on public.income;
drop policy if exists income_all on public.income;
create policy income_finance_all on public.income
  for all to authenticated
  using (has_crm_role('super_admin','admin','manager','finance'))
  with check (has_crm_role('super_admin','admin','manager','finance'));

drop policy if exists "Admin and managers can manage expenses" on public.expenses;
drop policy if exists "Admin and managers can view expenses" on public.expenses;
drop policy if exists expenses_all on public.expenses;
create policy expenses_finance_all on public.expenses
  for all to authenticated
  using (has_crm_role('super_admin','admin','manager','finance'))
  with check (has_crm_role('super_admin','admin','manager','finance'));

drop policy if exists "Admin and managers can manage invoices" on public.invoices;
drop policy if exists "Admin and managers can view invoices" on public.invoices;
drop policy if exists invoices_all on public.invoices;
create policy invoices_finance_all on public.invoices
  for all to authenticated
  using (has_crm_role('super_admin','admin','manager','finance'))
  with check (has_crm_role('super_admin','admin','manager','finance'));

-- ─── admin-only: pricing config / quotes / proposals ───────────────────────
drop policy if exists pricing_config_all on public.pricing_config;
create policy pricing_config_admin_all on public.pricing_config
  for all to authenticated
  using (has_crm_role('super_admin','admin'))
  with check (has_crm_role('super_admin','admin'));

drop policy if exists quotes_all on public.pricing_quotes;
create policy quotes_admin_all on public.pricing_quotes
  for all to authenticated
  using (has_crm_role('super_admin','admin'))
  with check (has_crm_role('super_admin','admin'));

drop policy if exists proposals_all on public.proposals;
create policy proposals_admin_all on public.proposals
  for all to authenticated
  using (has_crm_role('super_admin','admin'))
  with check (has_crm_role('super_admin','admin'));

-- ─── pricing reference reads -> staff ──────────────────────────────────────
drop policy if exists ai_modules_read on public.pricing_ai_modules;
create policy ai_modules_staff_read on public.pricing_ai_modules for select to authenticated using (is_stemfra_staff());
drop policy if exists pricing_countries_read on public.pricing_countries;
create policy pricing_countries_staff_read on public.pricing_countries for select to authenticated using (is_stemfra_staff());
drop policy if exists infra_services_read on public.pricing_infrastructure_services;
create policy infra_services_staff_read on public.pricing_infrastructure_services for select to authenticated using (is_stemfra_staff());
drop policy if exists maintenance_tiers_read on public.pricing_maintenance_tiers;
create policy maintenance_tiers_staff_read on public.pricing_maintenance_tiers for select to authenticated using (is_stemfra_staff());
drop policy if exists rate_card_entries_read on public.pricing_rate_card_entries;
create policy rate_card_entries_staff_read on public.pricing_rate_card_entries for select to authenticated using (is_stemfra_staff());
drop policy if exists rate_cards_read on public.pricing_rate_cards;
create policy rate_cards_staff_read on public.pricing_rate_cards for select to authenticated using (is_stemfra_staff());
drop policy if exists pricing_roles_read on public.pricing_roles;
create policy pricing_roles_staff_read on public.pricing_roles for select to authenticated using (is_stemfra_staff());
drop policy if exists settings_read on public.pricing_settings;
create policy pricing_settings_staff_read on public.pricing_settings for select to authenticated using (is_stemfra_staff());
drop policy if exists proposal_defaults_read on public.proposal_defaults;
create policy proposal_defaults_staff_read on public.proposal_defaults for select to authenticated using (is_stemfra_staff());

-- ─── contacts: staff-wide + CMS owner self-read ────────────────────────────
drop policy if exists "Authenticated users can view contacts" on public.contacts;
drop policy if exists "Authenticated users can insert contacts" on public.contacts;
drop policy if exists "Authenticated users can update contacts" on public.contacts;
drop policy if exists "Authenticated users can delete contacts" on public.contacts;
drop policy if exists contacts_all on public.contacts;
create policy contacts_staff_all on public.contacts
  for all to authenticated using (is_stemfra_staff()) with check (is_stemfra_staff());
-- CMS owner-context reads the owner's OWN contact row (queries.ts).
create policy contacts_self_read on public.contacts
  for select to authenticated using (auth_user_id = auth.uid());

-- ─── companies: staff-wide + owner read for their sites' companies ─────────
drop policy if exists "Authenticated users can view companies" on public.companies;
drop policy if exists "Authenticated users can insert companies" on public.companies;
drop policy if exists "Authenticated users can update companies" on public.companies;
drop policy if exists "Authenticated users can delete companies" on public.companies;
drop policy if exists companies_all on public.companies;
create policy companies_staff_all on public.companies
  for all to authenticated using (is_stemfra_staff()) with check (is_stemfra_staff());
-- CMS owner-context joins company:companies(name) on the owner's sites
-- (any status, incl. previewing — companies_public_name only covers anon+live).
create policy companies_owner_read on public.companies
  for select to authenticated using (
    exists (
      select 1 from public.sites s
      where s.company_id = companies.id
        and s.id in (select user_owned_site_ids())
    )
  );

-- ─── staff-wide operational tables ─────────────────────────────────────────
drop policy if exists "Authenticated users can view leads" on public.leads;
drop policy if exists "Authenticated users can insert leads" on public.leads;
drop policy if exists "Authenticated users can update leads" on public.leads;
drop policy if exists "Authenticated users can delete leads" on public.leads;
drop policy if exists leads_all on public.leads;
create policy leads_staff_all on public.leads
  for all to authenticated using (is_stemfra_staff()) with check (is_stemfra_staff());

drop policy if exists "Authenticated users can view deals" on public.deals;
drop policy if exists "Authenticated users can insert deals" on public.deals;
drop policy if exists "Authenticated users can update deals" on public.deals;
drop policy if exists "Authenticated users can delete deals" on public.deals;
drop policy if exists deals_all on public.deals;
create policy deals_staff_all on public.deals
  for all to authenticated using (is_stemfra_staff()) with check (is_stemfra_staff());

drop policy if exists "Authenticated users can view activity" on public.activity_feed;
drop policy if exists "Authenticated users can insert activity" on public.activity_feed;
drop policy if exists activity_feed_all on public.activity_feed;
create policy activity_feed_staff_all on public.activity_feed
  for all to authenticated using (is_stemfra_staff()) with check (is_stemfra_staff());

drop policy if exists calls_all on public.calls;
create policy calls_staff_all on public.calls
  for all to authenticated using (is_stemfra_staff()) with check (is_stemfra_staff());

drop policy if exists sms_messages_all on public.sms_messages;
create policy sms_messages_staff_all on public.sms_messages
  for all to authenticated using (is_stemfra_staff()) with check (is_stemfra_staff());

drop policy if exists "Authenticated users can view activities" on public.contact_activities;
drop policy if exists "Authenticated users can insert activities" on public.contact_activities;
drop policy if exists "Authenticated users can delete activities" on public.contact_activities;
create policy contact_activities_staff_all on public.contact_activities
  for all to authenticated using (is_stemfra_staff()) with check (is_stemfra_staff());

drop policy if exists "Authenticated users can view lead history" on public.lead_stage_history;
drop policy if exists "Authenticated users can insert lead history" on public.lead_stage_history;
create policy lead_stage_history_staff_all on public.lead_stage_history
  for all to authenticated using (is_stemfra_staff()) with check (is_stemfra_staff());

drop policy if exists "Authenticated users can view projects" on public.projects;
drop policy if exists "Authenticated users can insert projects" on public.projects;
drop policy if exists "Authenticated users can update projects" on public.projects;
drop policy if exists "Authenticated users can delete projects" on public.projects;
drop policy if exists projects_all on public.projects;
create policy projects_staff_all on public.projects
  for all to authenticated using (is_stemfra_staff()) with check (is_stemfra_staff());

drop policy if exists "Authenticated users can view tasks" on public.tasks;
drop policy if exists "Authenticated users can insert tasks" on public.tasks;
drop policy if exists "Authenticated users can update tasks" on public.tasks;
drop policy if exists "Authenticated users can delete tasks" on public.tasks;
drop policy if exists tasks_all on public.tasks;
create policy tasks_staff_all on public.tasks
  for all to authenticated using (is_stemfra_staff()) with check (is_stemfra_staff());

drop policy if exists "Authenticated users can view milestones" on public.milestones;
drop policy if exists "Authenticated users can manage milestones" on public.milestones;
drop policy if exists milestones_all on public.milestones;
create policy milestones_staff_all on public.milestones
  for all to authenticated using (is_stemfra_staff()) with check (is_stemfra_staff());

drop policy if exists "Authenticated users can view project members" on public.project_members;
drop policy if exists "Authenticated users can manage project members" on public.project_members;
create policy project_members_staff_all on public.project_members
  for all to authenticated using (is_stemfra_staff()) with check (is_stemfra_staff());

drop policy if exists "Authenticated users can view waitlist" on public.waitlist;
drop policy if exists "Authenticated users can insert waitlist" on public.waitlist;
drop policy if exists "Authenticated users can update waitlist" on public.waitlist;
drop policy if exists "Authenticated users can delete waitlist" on public.waitlist;
drop policy if exists waitlist_all on public.waitlist;
create policy waitlist_staff_all on public.waitlist
  for all to authenticated using (is_stemfra_staff()) with check (is_stemfra_staff());

drop policy if exists "Authenticated can read all articles" on public.articles;
drop policy if exists "Authenticated can insert articles" on public.articles;
drop policy if exists "Authenticated can update articles" on public.articles;
drop policy if exists "Authenticated can delete articles" on public.articles;
create policy articles_staff_all on public.articles
  for all to authenticated using (is_stemfra_staff()) with check (is_stemfra_staff());

drop policy if exists user_presence_read_all on public.user_presence;
create policy user_presence_staff_read on public.user_presence
  for select to authenticated using (is_stemfra_staff());

-- ─── sales_manager role (Peter, 2026-09-03: sales + tenant support + marketing;
--     NOT finance, NOT pricing, NOT role management) ─────────────────────────
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check
  check (role in ('super_admin','admin','manager','member','sales','finance','support','sales_manager'));

commit;
