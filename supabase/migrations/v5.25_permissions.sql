-- v5.25 — Roles and Permissions, Slice 2: modules, access templates, permission grid (records only, no enforcement)
-- Spec: docs/specs/slice-2-modules-templates-grid.md
--
-- RULE FOR EVERY FUTURE MODULE: the migration that adds a module must insert its row into public.modules
-- AND a row for EVERY template in public.template_permissions (new modules default to 'none' for Field Tech
-- unless the spec says otherwise), and the module must appear in the Permissions grid.
--
-- Nothing existing references these objects. Rollback: v5.25_permissions_rollback.sql (written first).
-- Runs as one transaction. New tables only: no existing table, policy or function is changed.

begin;

-- ------------------------------------------------------------------ 5.1 tables
create table public.modules (
  key          text primary key,
  label        text not null,
  module_group text not null check (module_group in ('screen','feature','admin')),
  sort_order   int  not null,
  description  text,
  active       boolean not null default true,
  created_at   timestamptz not null default now()
);

create table public.access_templates (
  key        text primary key,                 -- same values as profiles.template
  label      text not null,
  locked     boolean not null default false,   -- locked templates cannot be edited (Admin)
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

create table public.template_permissions (
  id           uuid primary key default gen_random_uuid(),   -- id column so audit_row_changes() works
  template_key text not null references public.access_templates(key),
  module_key   text not null references public.modules(key),
  level        text not null check (level in ('none','view','edit')),
  qb_allowed   boolean not null default false,
  created_at   timestamptz not null default now(),
  modified_at  timestamptz not null default now(),
  modified_by  text not null default '',
  label        text not null default '',   -- set by trigger; read by the audit trail
  unique (template_key, module_key)
);

create table public.user_permissions (        -- one row per DIFFERENCE from the template
  id          uuid primary key default gen_random_uuid(),
  profile_id  uuid not null references public.profiles(id),
  module_key  text not null references public.modules(key),
  level       text check (level in ('none','view','edit')),   -- null = use the template's level
  qb_allowed  boolean,                                         -- null = use the template's flag
  created_at  timestamptz not null default now(),
  modified_at timestamptz not null default now(),
  modified_by text not null default '',
  label       text not null default '',   -- set by trigger; names the user in the audit trail
  unique (profile_id, module_key),
  check (level is not null or qb_allowed is not null)
);

alter table public.modules              enable row level security;
alter table public.access_templates     enable row level security;
alter table public.template_permissions enable row level security;
alter table public.user_permissions     enable row level security;

-- Supabase grants new tables to anon by default; nothing here is for logged-out visitors.
revoke all on public.modules, public.access_templates, public.template_permissions, public.user_permissions from anon, public;

-- ------------------------------------------------------------------ 5.2 rules
create policy modules_select on public.modules for select to authenticated using (true);
create policy access_templates_select on public.access_templates for select to authenticated using (true);
create policy template_permissions_select on public.template_permissions for select to authenticated using (true);
create policy user_permissions_select on public.user_permissions for select to authenticated
  using (profile_id in (select id from public.profiles where user_id = auth.uid()) or public.get_user_role() = 'admin');

create policy modules_write on public.modules for all to authenticated
  using (public.get_user_role() = 'admin') with check (public.get_user_role() = 'admin');
create policy access_templates_write on public.access_templates for all to authenticated
  using (public.get_user_role() = 'admin') with check (public.get_user_role() = 'admin');
create policy template_permissions_write on public.template_permissions for all to authenticated
  using (public.get_user_role() = 'admin') with check (public.get_user_role() = 'admin');
create policy user_permissions_write on public.user_permissions for all to authenticated
  using (public.get_user_role() = 'admin') with check (public.get_user_role() = 'admin');

-- ------------------------------------------------------------------ 5.3 triggers (label, lockout) and 5.4 functions
-- Label: what the audit trail shows ("Field Tech · vendors", "Jadyn Young · vendors")
create function public.permissions_template_label() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  NEW.label := coalesce((select label from public.access_templates where key = NEW.template_key), NEW.template_key) || ' · ' || NEW.module_key;
  return NEW;
end $$;

create function public.permissions_user_label() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  NEW.label := coalesce((select display_name from public.profiles where id = NEW.profile_id), '(unknown user)') || ' · ' || NEW.module_key;
  return NEW;
end $$;

-- Lockout: the Admin template stays full, and admin users cannot be restricted by an override
create function public.permissions_template_lock() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if TG_OP in ('UPDATE','DELETE') then
    if exists (select 1 from public.access_templates where key = OLD.template_key and locked) then
      raise exception 'The Admin template is locked.';
    end if;
  end if;
  if TG_OP in ('INSERT','UPDATE') then
    if exists (select 1 from public.access_templates where key = NEW.template_key and locked) then
      raise exception 'The Admin template is locked.';
    end if;
  end if;
  if TG_OP = 'DELETE' then return OLD; end if;
  return NEW;
end $$;

create function public.permissions_user_lock() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from public.profiles where id = NEW.profile_id and template = 'admin') then
    raise exception 'Admin users can''t be restricted.';
  end if;
  return NEW;
end $$;

-- Removing an override or template row: the generic audit trigger covers insert and update only,
-- so deletes get their own small audit row (action 'delete').
create function public.audit_permission_delete() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.audit_log (table_name, record_id, action, field_name, old_value, new_value, changed_by, changed_at, context)
  values (TG_TABLE_NAME, OLD.id, 'delete', null,
          'level: ' || coalesce(OLD.level, '(template)') || '; qb_allowed: ' || coalesce(OLD.qb_allowed::text, '(template)'),
          null, coalesce(auth.email(), OLD.modified_by, 'system'), now(), OLD.label);
  return OLD;
end $$;

-- Effective access for the logged-in user (admin template is always 'edit')
create function public.perm_rank(l text) returns int
language sql immutable set search_path = public as $$
  select case l when 'edit' then 2 when 'view' then 1 else 0 end
$$;

create function public.my_module_level(p_module text) returns text
language sql stable security definer set search_path = public as $$
  select coalesce((
    select case when p.template = 'admin' then 'edit' else coalesce(up.level, tp.level, 'none') end
    from public.profiles p
    left join public.user_permissions up on up.profile_id = p.id and up.module_key = p_module
    left join public.template_permissions tp on tp.template_key = p.template and tp.module_key = p_module
    where p.user_id = auth.uid() and p.active
    limit 1
  ), 'none')
$$;

create function public.has_module(p_module text, p_min text default 'view') returns boolean
language sql stable security definer set search_path = public as $$
  select public.perm_rank(public.my_module_level(p_module)) >= public.perm_rank(p_min)
$$;

create function public.has_qb(p_module text) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((
    select case when p.template = 'admin' then true else coalesce(up.qb_allowed, tp.qb_allowed, false) end
    from public.profiles p
    left join public.user_permissions up on up.profile_id = p.id and up.module_key = p_module
    left join public.template_permissions tp on tp.template_key = p.template and tp.module_key = p_module
    where p.user_id = auth.uid() and p.active
    limit 1
  ), false)
$$;

create function public.get_my_permissions() returns table(module_key text, level text, qb_allowed boolean)
language sql stable security definer set search_path = public as $$
  select m.key, public.my_module_level(m.key), public.has_qb(m.key)
  from public.modules m
  where m.active
  order by m.sort_order
$$;

-- Logged-out visitors get nothing from these (default Supabase grants include anon)
revoke all on function public.permissions_template_label(), public.permissions_user_label(),
  public.permissions_template_lock(), public.permissions_user_lock(), public.audit_permission_delete() from public, anon, authenticated;
revoke all on function public.perm_rank(text), public.my_module_level(text), public.has_module(text, text),
  public.has_qb(text), public.get_my_permissions() from public, anon;
grant execute on function public.perm_rank(text), public.my_module_level(text), public.has_module(text, text),
  public.has_qb(text), public.get_my_permissions() to authenticated, service_role;

-- label and modified-at triggers exist before the seed so seeded rows get labels
create trigger trg_template_permissions_label before insert or update on public.template_permissions
  for each row execute function public.permissions_template_label();
create trigger trg_user_permissions_label before insert or update on public.user_permissions
  for each row execute function public.permissions_user_label();
create trigger trg_template_permissions_modified before update on public.template_permissions
  for each row execute function public.set_modified_at();
create trigger trg_user_permissions_modified before update on public.user_permissions
  for each row execute function public.set_modified_at();

-- ------------------------------------------------------------------ 5.5 seed: templates and modules
insert into public.access_templates (key, label, locked, sort_order) values
  ('admin','Admin',true,1), ('field','Field Tech',false,2);

insert into public.modules (key, label, module_group, sort_order, description) values
  ('daily_dashboard','Daily Dashboard','screen',1,'The dashboard screen. Each widget on it also needs its own module'),
  ('tasks','Tasks','screen',2,'Tasks screen; tasks, task_assignments, task_steps, task_templates, task_template_steps'),
  ('work_orders','Work Orders','screen',3,'Work orders, hours entries, parts/line items, dispatch assignments, statuses, flags'),
  ('field_travel_log','Field Travel Log','screen',4,'GPS day review, punches, breaks, schedules'),
  ('end_of_day','End of Day','screen',5,'End-of-day flow'),
  ('timecard','Timecard','screen',6,'Timecard screen and weekly submission'),
  ('truck_stock','Truck Stock','screen',7,'Truck stock screen'),
  ('customers','Customers','screen',8,'Customers, contacts, contact roles'),
  ('vendors','Vendors','screen',9,'Vendors, vendor invoices, vendor import/export history'),
  ('sites','Sites/Locations','screen',10,'Sites, site types, geofence and GPS dead-zone settings per site'),
  ('invoicing','Customer Invoice Generation','screen',11,'Invoice generation, invoice runs'),
  ('purchase_orders','Customer Purchase Orders','screen',12,'POs, PO-customer links, change orders, PO status buckets'),
  ('exports','Exports','screen',13,'Zed Axis export and export history'),
  ('feature_req_bugs','Feature Req/Bugs','screen',14,'The admin bug and feature board (not the Report an Issue button)'),
  ('carryover','Carryover','feature',15,'Carryover and carryover allocations'),
  ('quoted_billing','Quoted Billing','feature',16,'Quoted work-order billing, quoted invoices'),
  ('customer_limits','Customer Limits and Thresholds','feature',17,'Customer thresholds and limits'),
  ('wo_nte','WO NTE','feature',18,'Not-to-exceed limits on work orders'),
  ('wo_capex','WO CapEx','feature',19,'CapEx on work orders'),
  ('quote_tracking','Quote Tracking','feature',20,'Tracked quotes and reminders'),
  ('reports','Reports','admin',21,'Reports screen'),
  ('alerts','Alerts','admin',22,'Alerts center, bell, Alerts settings tab'),
  ('audit_log','Audit Log','admin',23,'Audit Log tab');

-- ------------------------------------------------------------------ 5.6 seed: template defaults (insert ... select so no module is missed)
-- Admin (locked): edit and QuickBooks flag on, all modules
insert into public.template_permissions (template_key, module_key, level, qb_allowed)
select 'admin', key, 'edit', true from public.modules;

-- Field Tech: 7 edit / 3 view / 13 none; QuickBooks flag off everywhere
insert into public.template_permissions (template_key, module_key, level, qb_allowed)
select 'field', key,
  case
    when key in ('daily_dashboard','tasks','work_orders','field_travel_log','end_of_day','timecard','truck_stock') then 'edit'
    when key in ('customers','sites','wo_nte') then 'view'
    else 'none'
  end,
  false
from public.modules;

-- lockout and audit triggers go on after the seed (the seed writes the locked Admin template once)
create trigger trg_template_permissions_lock before insert or update or delete on public.template_permissions
  for each row execute function public.permissions_template_lock();
create trigger trg_user_permissions_lock before insert or update on public.user_permissions
  for each row execute function public.permissions_user_lock();

-- ------------------------------------------------------------------ 5.7 audit
create trigger audit_template_permissions after insert or update on public.template_permissions
  for each row execute function public.audit_row_changes('label', '', 'id,created_at,modified_at,modified_by,label');
create trigger audit_user_permissions after insert or update on public.user_permissions
  for each row execute function public.audit_row_changes('label', '', 'id,created_at,modified_at,modified_by,label');
create trigger audit_template_permissions_delete after delete on public.template_permissions
  for each row execute function public.audit_permission_delete();
create trigger audit_user_permissions_delete after delete on public.user_permissions
  for each row execute function public.audit_permission_delete();

-- ------------------------------------------------------------------ checks (the whole migration rolls back if any fails)
do $chk$
declare n_mod int; n_tpl int; n_tp int; f_edit int; f_view int; f_none int; f_qb int; a_qb int;
begin
  select count(*) into n_mod from public.modules;
  select count(*) into n_tpl from public.access_templates;
  select count(*) into n_tp from public.template_permissions;
  select count(*) filter (where level='edit'), count(*) filter (where level='view'), count(*) filter (where level='none'),
         count(*) filter (where qb_allowed) into f_edit, f_view, f_none, f_qb
    from public.template_permissions where template_key = 'field';
  select count(*) into a_qb from public.template_permissions where template_key = 'admin' and level = 'edit' and qb_allowed;
  if n_mod <> 23 or n_tpl <> 2 or n_tp <> 46 or f_edit <> 7 or f_view <> 3 or f_none <> 13 or f_qb <> 0 or a_qb <> 23 then
    raise exception 'v5.25 seed check failed: modules %, templates %, template rows %, field edit/view/none %/%/%, field qb %, admin qb %',
      n_mod, n_tpl, n_tp, f_edit, f_view, f_none, f_qb, a_qb;
  end if;
end $chk$;

commit;
