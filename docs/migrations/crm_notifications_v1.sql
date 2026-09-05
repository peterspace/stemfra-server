-- Stemfra OS Phase 5 (2026-09-05): real notifications for staff.
-- One row per recipient. Written ONLY by SECURITY DEFINER triggers below
-- (inbound SMS, missed inbound call, lead assigned). Read/updated by the CRM
-- through the anon client (RLS own rows). Realtime-published so the bell
-- updates live.
create table if not exists public.crm_notifications (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  kind        text not null,            -- 'sms' | 'missed_call' | 'lead_assigned'
  title       text not null,
  body        text,
  route       text,                     -- CRM path to open
  entity_type text,
  entity_id   text,
  read_at     timestamptz,
  created_at  timestamptz not null default now()
);
alter table public.crm_notifications enable row level security;
drop policy if exists crm_notifications_own_select on public.crm_notifications;
create policy crm_notifications_own_select on public.crm_notifications for select to authenticated using (user_id = auth.uid());
drop policy if exists crm_notifications_own_update on public.crm_notifications;
create policy crm_notifications_own_update on public.crm_notifications for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create index if not exists crm_notifications_user_created_idx on public.crm_notifications (user_id, created_at desc);

-- Who gets a lead's notifications: its assignee, else every active staff member.
create or replace function public.crm_notify_targets(p_lead uuid)
returns setof uuid language sql security definer stable as $$
  select l.assigned_to from public.leads l where l.id = p_lead and l.assigned_to is not null
  union
  select p.id from public.profiles p
   where p.is_active = true
     and not exists (select 1 from public.leads l where l.id = p_lead and l.assigned_to is not null);
$$;

create or replace function public.crm_notify(p_user uuid, p_kind text, p_title text, p_body text, p_route text, p_entity_type text, p_entity_id text)
returns void language sql security definer as $$
  insert into public.crm_notifications (user_id, kind, title, body, route, entity_type, entity_id)
  values (p_user, p_kind, p_title, left(coalesce(p_body, ''), 200), p_route, p_entity_type, p_entity_id);
$$;

-- Display name + route for a message/call: lead first, then contact, else the number.
create or replace function public.crm_person_label(p_lead uuid, p_contact uuid, p_number text, out label text, out route text, out etype text, out eid text)
language plpgsql security definer stable as $$
begin
  if p_lead is not null then
    select coalesce(nullif(l.company_name, ''), nullif(l.contact_name, ''), p_number), '/leads/' || l.id, 'lead', l.id::text
      into label, route, etype, eid from public.leads l where l.id = p_lead;
    if found then return; end if;
  end if;
  if p_contact is not null then
    select coalesce(nullif(trim(coalesce(c.first_name, '') || ' ' || coalesce(c.last_name, '')), ''), p_number), '/contacts/' || c.id, 'contact', c.id::text
      into label, route, etype, eid from public.contacts c where c.id = p_contact;
    if found then return; end if;
  end if;
  label := coalesce(p_number, 'Unknown number'); route := '/activities/calls'; etype := null; eid := null;
end $$;

-- 1) Inbound SMS
create or replace function public.crm_notify_sms_inbound() returns trigger language plpgsql security definer as $$
declare r record; t uuid;
begin
  if new.direction <> 'inbound' then return new; end if;
  select * into r from public.crm_person_label(new.lead_id, new.contact_id, new.from_number);
  if new.lead_id is not null then
    for t in select * from public.crm_notify_targets(new.lead_id) loop
      perform public.crm_notify(t, 'sms', 'New text from ' || r.label, new.body, r.route, r.etype, r.eid);
    end loop;
  else
    for t in select id from public.profiles where is_active = true loop
      perform public.crm_notify(t, 'sms', 'New text from ' || r.label, new.body, r.route, r.etype, r.eid);
    end loop;
  end if;
  return new;
end $$;
drop trigger if exists trg_crm_notify_sms_inbound on public.sms_messages;
create trigger trg_crm_notify_sms_inbound after insert on public.sms_messages
  for each row execute function public.crm_notify_sms_inbound();

-- 2) Missed inbound call (status lands via the Twilio status callback)
create or replace function public.crm_notify_call_missed() returns trigger language plpgsql security definer as $$
declare r record; t uuid;
begin
  if new.direction <> 'inbound' or new.status not in ('no-answer', 'busy', 'missed', 'failed', 'canceled') then return new; end if;
  if tg_op = 'UPDATE' and old.status is not distinct from new.status then return new; end if;
  select * into r from public.crm_person_label(new.lead_id, new.contact_id, new.from_number);
  if new.lead_id is not null then
    for t in select * from public.crm_notify_targets(new.lead_id) loop
      perform public.crm_notify(t, 'missed_call', 'Missed call from ' || r.label, null, r.route, r.etype, r.eid);
    end loop;
  else
    for t in select id from public.profiles where is_active = true loop
      perform public.crm_notify(t, 'missed_call', 'Missed call from ' || r.label, null, r.route, r.etype, r.eid);
    end loop;
  end if;
  return new;
end $$;
drop trigger if exists trg_crm_notify_call_missed on public.calls;
create trigger trg_crm_notify_call_missed after insert or update of status on public.calls
  for each row execute function public.crm_notify_call_missed();

-- 3) Lead assigned
create or replace function public.crm_notify_lead_assigned() returns trigger language plpgsql security definer as $$
begin
  if new.assigned_to is null or new.assigned_to is not distinct from old.assigned_to then return new; end if;
  perform public.crm_notify(new.assigned_to, 'lead_assigned',
    'Lead assigned to you: ' || coalesce(nullif(new.company_name, ''), nullif(new.contact_name, ''), 'a lead'),
    null, '/leads/' || new.id, 'lead', new.id::text);
  return new;
end $$;
drop trigger if exists trg_crm_notify_lead_assigned on public.leads;
create trigger trg_crm_notify_lead_assigned after update of assigned_to on public.leads
  for each row execute function public.crm_notify_lead_assigned();

-- Realtime for the bell
do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'crm_notifications') then
    alter publication supabase_realtime add table public.crm_notifications;
  end if;
end $$;
