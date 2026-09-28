-- v4.88 — Roles and Permissions, Slice 1: User Identity
-- See docs/specs/slice-1-user-identity.md

-- 3.1 New table profiles
create table public.profiles (
  id                   uuid primary key default gen_random_uuid(),
  user_id              uuid not null unique references auth.users(id),
  email                text not null,              -- display copy; auth.users is the source of truth
  display_name         text not null,
  template             text not null check (template in ('admin','field')),
  technician_id        uuid unique references public.technicians(id),  -- optional: office logins need none
  active               boolean not null default true,
  must_change_password boolean not null default false,
  deactivated_at       timestamptz,
  deactivated_by       text,
  created_at           timestamptz not null default now(),
  created_by           text not null default '',
  modified_at          timestamptz not null default now(),
  modified_by          text not null default ''
);
alter table public.profiles enable row level security;

-- Read: your own row, or everything if admin. No client writes — the admin-users function writes with the service role.
create policy profiles_select on public.profiles for select to authenticated
  using (user_id = auth.uid() or public.get_user_role() = 'admin');

-- 3.2 Seed the two real users
insert into public.profiles (user_id, email, display_name, template, technician_id, created_by, modified_by) values
  ('cfe9506b-8d75-4703-8170-313255aa64b3', 'kevin@providencemech.com', 'Kevin Reb',   'admin', '38f5a3aa-d572-4e85-b65c-70c3c8fce175', 'migration v4.88', 'migration v4.88'),
  ('3e5edc3c-145e-4977-ada1-02ca8f0ace0a', 'jadyneagles@gmail.com',    'Jadyn Young', 'field', '48812660-3a1c-4610-9665-5f8075b4bd4d', 'migration v4.88', 'migration v4.88');

-- 3.3 Repoint get_user_role() to profiles
create or replace function public.get_user_role()
returns text language sql stable security definer set search_path = public as $$
  select template from public.profiles where user_id = auth.uid() and active;
$$;

-- 3.4 Retire user_roles (no drop)
comment on table public.user_roles is 'RETIRED v4.88 — replaced by profiles. Drop in schema cleanup.';

-- 3.6/3.7 New table alerts (shared by every future warning)
create table public.alerts (
  id              uuid primary key default gen_random_uuid(),
  alert_type      text not null,          -- e.g. 'tid_changed_by_user'; slice 1b adds 'gps_unknown_tid', 'gps_silent'
  severity        text not null default 'warning' check (severity in ('info','warning','urgent')),
  subject_table   text,                   -- what it is about, e.g. 'technicians'
  subject_id      uuid,
  message         text not null,          -- ready to show as-is
  details         jsonb,                  -- e.g. {"old":"JY","new":"JY2"}
  created_at      timestamptz not null default now(),
  created_by      text not null default 'system',
  status          text not null default 'unread'
                  check (status in ('unread','acknowledged','in_progress','resolved')),
  status_note     text,                   -- optional note on the latest status change ("ordered part", "fixed phone settings")
  status_changed_at timestamptz,
  status_changed_by text
);
alter table public.alerts enable row level security;
create policy alerts_select on public.alerts for select to authenticated using (public.get_user_role() = 'admin');
create policy alerts_update on public.alerts for update to authenticated using (public.get_user_role() = 'admin');
-- No client inserts or deletes: alerts are raised by server functions (service role) only and never deleted.
create index alerts_open_idx on public.alerts (created_at desc) where status <> 'resolved';

-- Every status change is written to audit_log by the database itself, so no change can skip the history.
create or replace function public.alerts_audit_status() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status is distinct from old.status or new.status_note is distinct from old.status_note then
    new.status_changed_at := now();
    new.status_changed_by := coalesce(auth.email(), 'system');
    insert into audit_log (table_name, record_id, action, field_name, old_value, new_value, changed_by, changed_at)
    values ('alerts', new.id, 'status_change', 'status',
            old.status, new.status || coalesce(' — ' || new.status_note, ''),
            new.status_changed_by, now());
  end if;
  return new;
end $$;
create trigger alerts_audit_status before update on public.alerts
  for each row execute function public.alerts_audit_status();

-- 3.8 Alert settings (existing settings key/value table)
insert into public.settings (key, value) values
  ('alert_gps_silence_minutes', '60'),     -- used by slice 1b's check; editable now
  ('alert_tid_changed_enabled', 'true');

-- 5.7 Audit Log RLS (finding 2026-09-27: RLS on, zero policies)
create policy audit_log_select on public.audit_log for select to authenticated
  using (public.get_user_role() = 'admin');
create policy audit_log_insert on public.audit_log for insert to authenticated
  with check (changed_by = auth.email());
-- deliberately no update or delete policy: entries are permanent

-- 5.7 Foundation for search later
create index audit_log_changed_at_idx on audit_log (changed_at desc);
create index audit_log_changed_by_idx on audit_log (changed_by, changed_at desc);
create index audit_log_record_idx on audit_log (table_name, record_id, changed_at desc);

-- 3.5 Delete the unused "Test Subject" technician
-- Checked 2026-09-27: zero references across all 14 technician-referencing columns
-- (bug_reports, day_breaks, day_review, dispatch_assignments, exit_interview_responses,
--  hours_entries, punch_event, task_assignments, task_steps.completed_by, tasks.completed_by,
--  tasks.claimed_by, tech_schedule, time_entry, week_submission). Run as its own step.
delete from public.technicians where id = 'a9ac864c-f096-4227-97f5-6b68bdf997e1' and name = 'Test Subject';
