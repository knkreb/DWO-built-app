-- v5.10 — Work order NTE (slice 2)
-- Spec: docs/specs/customer-thresholds-and-carryover.md, section 1.
-- Diagnosed 2026-10-21: hours_entries.line_total is NOT reliable (79 rows null, 80 more zero with hours), so
-- spend is computed the way the work order screen does it: billable hours x the rate from Settings for the hours
-- type, plus parts and services, minus vendor credits. Alerts cannot be created from the app (the alerts table only
-- allows read and update), so a SECURITY DEFINER trigger raises them. Additive only.

-- 1. One NTE row per work order, same fields as the customer default (customer_thresholds). No row = no NTE.
create table if not exists public.work_order_limits (
  id                uuid primary key default gen_random_uuid(),
  work_order_id     uuid not null unique references public.work_orders(id),
  label             text,                                   -- work order number, for readable audit rows
  source            text not null default 'customer_default' check (source in ('customer_default','manual')),
  nte_enabled       boolean not null default true,
  nte_amount        numeric,
  nte_l1_enabled    boolean not null default true,
  nte_l1_type       text    not null default 'percent' check (nte_l1_type in ('percent','dollar')),
  nte_l1_direction  text    not null default 'spent'   check (nte_l1_direction in ('spent','remaining')),
  nte_l1_value      numeric not null default 75  check (nte_l1_value > 0),
  nte_l2_enabled    boolean not null default true,
  nte_l2_type       text    not null default 'percent' check (nte_l2_type in ('percent','dollar')),
  nte_l2_direction  text    not null default 'spent'   check (nte_l2_direction in ('spent','remaining')),
  nte_l2_value      numeric not null default 100 check (nte_l2_value > 0),
  created_at        timestamptz not null default now(),
  created_by        text,
  modified_at       timestamptz not null default now(),
  modified_by       text,
  active            boolean not null default true,
  check (not nte_enabled or nte_amount > 0)
);

alter table public.work_order_limits enable row level security;

-- Everyone signed in can read (techs see the indicator); only admin changes the cap.
create policy work_order_limits_select on public.work_order_limits
  for select to authenticated using (true);
create policy work_order_limits_insert on public.work_order_limits
  for insert to authenticated with check (get_user_role() = 'admin');
create policy work_order_limits_update on public.work_order_limits
  for update to authenticated using (get_user_role() = 'admin') with check (get_user_role() = 'admin');

create trigger trg_work_order_limits_modified before update on public.work_order_limits
  for each row execute function public.set_modified_at();
create trigger audit_work_order_limits after insert or update on public.work_order_limits
  for each row execute function public.audit_row_changes('label', '', 'id,created_at,created_by,modified_at,modified_by');

-- 2. Copy at creation: when a T&M work order gets its customer (new work order, or customer first set), copy the
-- default from the customer's parent (or the customer itself) when that default is on. Later changes to the
-- customer default never touch existing work orders. Covers every creation path (app, import, timecard).
create or replace function public.wo_nte_copy_default() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  owner_id uuid;
  t public.customer_thresholds%rowtype;
begin
  if NEW.customer_id is null or NEW.form_mode is distinct from 'time_materials' then return NEW; end if;
  if TG_OP = 'UPDATE' and OLD.customer_id is not null then return NEW; end if;
  if exists (select 1 from public.work_order_limits where work_order_id = NEW.id) then return NEW; end if;
  select coalesce(c.parent_customer_id, c.id) into owner_id from public.customers c where c.id = NEW.customer_id;
  select * into t from public.customer_thresholds
    where customer_id = owner_id and active and nte_enabled and nte_amount > 0;
  if not found then return NEW; end if;
  insert into public.work_order_limits (work_order_id, label, source, nte_enabled, nte_amount,
      nte_l1_enabled, nte_l1_type, nte_l1_direction, nte_l1_value,
      nte_l2_enabled, nte_l2_type, nte_l2_direction, nte_l2_value, created_by, modified_by)
  values (NEW.id, NEW.wo_number, 'customer_default', true, t.nte_amount,
      t.nte_l1_enabled, t.nte_l1_type, t.nte_l1_direction, t.nte_l1_value,
      t.nte_l2_enabled, t.nte_l2_type, t.nte_l2_direction, t.nte_l2_value,
      coalesce(auth.email(), 'system'), coalesce(auth.email(), 'system'));
  return NEW;
end $$;
revoke all on function public.wo_nte_copy_default() from public, anon, authenticated;

create trigger trg_wo_nte_copy_insert after insert on public.work_orders
  for each row execute function public.wo_nte_copy_default();
create trigger trg_wo_nte_copy_customer after update of customer_id on public.work_orders
  for each row execute function public.wo_nte_copy_default();

-- 3. Live status per work order with an NTE: spend, the spend at which each level is reached, and the level now.
create or replace view public.wo_nte_status with (security_invoker = true) as
with hrs as (
  select he.work_order_id,
         sum(he.hours * coalesce((select nullif(s.value, '')::numeric from public.settings s where s.key = ht.internal_rate_key), 0)) as hours_value
  from public.hours_entries he
  left join public.hours_types ht on ht.id = he.hours_type_id
  where he.active and he.billable
  group by he.work_order_id
), parts as (
  select li.work_order_id,
         coalesce(sum(li.sell_total) filter (where li.transaction_type is distinct from 'vendor_credit'), 0)
         - coalesce(sum(li.sell_total) filter (where li.transaction_type = 'vendor_credit'), 0) as parts_net
  from public.line_items li
  where li.active
  group by li.work_order_id
), calc as (
  select l.work_order_id, l.nte_amount, l.source,
         l.nte_l1_enabled, l.nte_l2_enabled,
         coalesce(h.hours_value, 0) + coalesce(p.parts_net, 0) as spent,
         case when l.nte_l1_type = 'percent'
              then case when l.nte_l1_direction = 'spent' then l.nte_amount * l.nte_l1_value / 100 else l.nte_amount * (1 - l.nte_l1_value / 100) end
              else case when l.nte_l1_direction = 'spent' then l.nte_l1_value else l.nte_amount - l.nte_l1_value end end as l1_at,
         case when l.nte_l2_type = 'percent'
              then case when l.nte_l2_direction = 'spent' then l.nte_amount * l.nte_l2_value / 100 else l.nte_amount * (1 - l.nte_l2_value / 100) end
              else case when l.nte_l2_direction = 'spent' then l.nte_l2_value else l.nte_amount - l.nte_l2_value end end as l2_at
  from public.work_order_limits l
  left join hrs h on h.work_order_id = l.work_order_id
  left join parts p on p.work_order_id = l.work_order_id
  where l.active and l.nte_enabled
)
select c.work_order_id, w.wo_number, w.title, w.customer_id, w.status, c.source,
       c.nte_amount, round(c.spent, 2) as spent,
       round(c.nte_amount - c.spent, 2) as remaining,
       round(c.spent / c.nte_amount * 100, 1) as pct_used,
       round(c.l1_at, 2) as l1_at, round(c.l2_at, 2) as l2_at,
       case when c.nte_l2_enabled and c.spent > 0 and c.spent >= c.l2_at then 2
            when c.nte_l1_enabled and c.spent > 0 and c.spent >= c.l1_at then 1
            else 0 end as level
from calc c
join public.work_orders w on w.id = c.work_order_id and w.active;

grant select on public.wo_nte_status to authenticated;

-- 4. Raise an alert (once per level per work order) when a work order reaches a level. Fired by any change to
-- hours, parts, or the NTE itself, so every entry path is covered.
create or replace function public.wo_nte_check(p_wo uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  r record;
  cust text;
begin
  select * into r from public.wo_nte_status where work_order_id = p_wo;
  if not found or r.level = 0 then return; end if;
  if exists (select 1 from public.alerts where alert_type = 'nte_level_' || r.level and subject_id = p_wo) then return; end if;
  select coalesce(c.display_name, c.name) into cust from public.customers c where c.id = r.customer_id;
  insert into public.alerts (alert_type, severity, subject_table, subject_id, message, details)
  values ('nte_level_' || r.level,
          case when r.level = 2 then 'urgent' else 'warning' end,
          'work_orders', p_wo,
          'NTE ' || case when r.level = 2 then 'limit reached' else 'warning' end || ': ' || r.wo_number
            || coalesce(' (' || cust || ')', '') || ' is at ' || to_char(r.spent, 'FM$999,999,990.00')
            || ' of ' || to_char(r.nte_amount, 'FM$999,999,990.00') || ' NTE (' || r.pct_used || '%).',
          jsonb_build_object('work_order_id', p_wo, 'level', r.level, 'spent', r.spent, 'nte_amount', r.nte_amount));
end $$;
revoke all on function public.wo_nte_check(uuid) from public, anon, authenticated;

create or replace function public.wo_nte_after_change() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if TG_TABLE_NAME = 'work_order_limits' then
    perform public.wo_nte_check(NEW.work_order_id);
  elsif NEW.work_order_id is not null then
    perform public.wo_nte_check(NEW.work_order_id);
  end if;
  return NEW;
end $$;
revoke all on function public.wo_nte_after_change() from public, anon, authenticated;

create trigger trg_wo_nte_check_hours after insert or update on public.hours_entries
  for each row execute function public.wo_nte_after_change();
create trigger trg_wo_nte_check_parts after insert or update on public.line_items
  for each row execute function public.wo_nte_after_change();
create trigger trg_wo_nte_check_limits after insert or update on public.work_order_limits
  for each row execute function public.wo_nte_after_change();
