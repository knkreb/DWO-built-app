-- v5.12 — CapEx tag, threshold warnings and capital minimum (slice 3)
-- Spec: docs/specs/customer-thresholds-and-carryover.md, section 2.
-- Customer CapEx settings already exist (customer_thresholds.capex_*, v5.09) and are read LIVE from the customer
-- (or its parent), unlike NTE they are not copied to each work order. What this adds:
--   1. work_order_capex  — the CapEx tag, set by hand by admin (one row per work order, no row = not tagged)
--   2. wo_spend          — spend per work order, counted exactly like wo_nte_status (billable hours x Settings rate,
--                          plus parts and services, minus vendor credits). wo_nte_status is left untouched.
--   3. wo_capex_status   — per T&M work order: tag, spend, threshold level (untagged only), capital minimum check
--   4. alerts            — raised by SECURITY DEFINER triggers (alerts cannot be created from the app)
-- Warns only. Nothing here blocks work. Additive only: safe to run, nothing existing changes.

-- 1. The CapEx tag. Admin sets it; everyone signed in can read it (techs see the badge).
create table if not exists public.work_order_capex (
  id            uuid primary key default gen_random_uuid(),
  work_order_id uuid not null unique references public.work_orders(id),
  label         text,                                   -- work order number, for readable audit rows
  capex_tagged  boolean not null default true,          -- false = tag removed (row kept so the audit trail stays readable)
  created_at    timestamptz not null default now(),
  created_by    text,
  modified_at   timestamptz not null default now(),
  modified_by   text,
  active        boolean not null default true
);

alter table public.work_order_capex enable row level security;

create policy work_order_capex_select on public.work_order_capex
  for select to authenticated using (true);
create policy work_order_capex_insert on public.work_order_capex
  for insert to authenticated with check (get_user_role() = 'admin');
create policy work_order_capex_update on public.work_order_capex
  for update to authenticated using (get_user_role() = 'admin') with check (get_user_role() = 'admin');

create trigger trg_work_order_capex_modified before update on public.work_order_capex
  for each row execute function public.set_modified_at();
create trigger audit_work_order_capex after insert or update on public.work_order_capex
  for each row execute function public.audit_row_changes('label', '', 'id,created_at,created_by,modified_at,modified_by');

-- 2. Spend per work order, same method as wo_nte_status.
create or replace view public.wo_spend with (security_invoker = true) as
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
)
select w.id as work_order_id,
       coalesce(h.hours_value, 0) + coalesce(p.parts_net, 0) as spent
from public.work_orders w
left join hrs h on h.work_order_id = w.id
left join parts p on p.work_order_id = w.id
where w.active;

grant select on public.wo_spend to authenticated;

-- 3. CapEx status per T&M (not quoted) work order. A work order appears when it is tagged, or its customer (or the
-- customer's parent) has the CapEx threshold or the capital minimum switched on.
--   level      0/1/2: threshold warning level. UNTAGGED work orders only (a tagged one is already CapEx).
--   below_min  tagged, minimum on, and spend is under the minimum.
--   min_flag   below_min AND the work order has reached Completed (status category 'completed', before invoicing).
create or replace view public.wo_capex_status with (security_invoker = true) as
with base as (
  select w.id as work_order_id, w.wo_number, w.title, w.customer_id, w.status,
         s.category as status_category,
         coalesce(cx.capex_tagged, false) as tagged,
         coalesce(t.capex_enabled and t.capex_threshold > 0, false) as thr_on,
         t.capex_threshold,
         t.capex_l1_enabled, t.capex_l1_type, t.capex_l1_direction, t.capex_l1_value,
         t.capex_l2_enabled, t.capex_l2_type, t.capex_l2_direction, t.capex_l2_value,
         coalesce(t.capex_min_enabled and t.capex_min_amount > 0, false) as min_on,
         t.capex_min_amount,
         coalesce(sp.spent, 0) as spent
  from public.work_orders w
  join public.customers c on c.id = w.customer_id
  left join public.customer_thresholds t on t.customer_id = coalesce(c.parent_customer_id, c.id) and t.active
  left join public.work_order_capex cx on cx.work_order_id = w.id and cx.active
  left join public.wo_statuses s on s.num = w.status
  left join public.wo_spend sp on sp.work_order_id = w.id
  where w.active and w.form_mode is distinct from 'quoted'
), calc as (
  select b.*,
         case when b.thr_on then
           case when b.capex_l1_type = 'percent'
                then case when b.capex_l1_direction = 'spent' then b.capex_threshold * b.capex_l1_value / 100 else b.capex_threshold * (1 - b.capex_l1_value / 100) end
                else case when b.capex_l1_direction = 'spent' then b.capex_l1_value else b.capex_threshold - b.capex_l1_value end end
         end as l1_at,
         case when b.thr_on then
           case when b.capex_l2_type = 'percent'
                then case when b.capex_l2_direction = 'spent' then b.capex_threshold * b.capex_l2_value / 100 else b.capex_threshold * (1 - b.capex_l2_value / 100) end
                else case when b.capex_l2_direction = 'spent' then b.capex_l2_value else b.capex_threshold - b.capex_l2_value end end
         end as l2_at
  from base b
  where b.tagged or b.thr_on or b.min_on
)
select c.work_order_id, c.wo_number, c.title, c.customer_id, c.status, c.status_category, c.tagged,
       round(c.spent, 2) as spent,
       case when c.thr_on then c.capex_threshold end as capex_threshold,
       case when c.thr_on then round(c.spent / c.capex_threshold * 100, 1) end as pct_used,
       round(c.l1_at, 2) as l1_at, round(c.l2_at, 2) as l2_at,
       case when c.tagged or not c.thr_on then 0
            when c.capex_l2_enabled and c.spent > 0 and c.spent >= c.l2_at then 2
            when c.capex_l1_enabled and c.spent > 0 and c.spent >= c.l1_at then 1
            else 0 end as level,
       case when c.min_on then c.capex_min_amount end as min_amount,
       (c.tagged and c.min_on and c.spent < c.capex_min_amount) as below_min,
       (c.tagged and c.min_on and c.spent < c.capex_min_amount and c.status_category = 'completed') as min_flag
from calc c;

grant select on public.wo_capex_status to authenticated;

-- 4. Alerts, once per kind per work order:
--    capex_level_1 / capex_level_2  an UNTAGGED work order reached a threshold level (split it, or tag it CapEx)
--    capex_below_min                a CapEx-tagged work order reached Completed under the capital minimum
-- Fired by any change to hours, parts, the tag, or the work order status, so every entry path is covered.
create or replace function public.wo_capex_check(p_wo uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  r record;
  cust text;
begin
  select * into r from public.wo_capex_status where work_order_id = p_wo;
  if not found then return; end if;
  select coalesce(c.display_name, c.name) into cust from public.customers c where c.id = r.customer_id;

  if r.level >= 1
     and not exists (select 1 from public.alerts where alert_type = 'capex_level_' || r.level and subject_id = p_wo) then
    insert into public.alerts (alert_type, severity, subject_table, subject_id, message, details)
    values ('capex_level_' || r.level,
            case when r.level = 2 then 'urgent' else 'warning' end,
            'work_orders', p_wo,
            'CapEx ' || case when r.level = 2 then 'threshold reached' else 'watch' end || ': ' || r.wo_number
              || coalesce(' (' || cust || ')', '') || ' is at ' || to_char(r.spent, 'FM$999,999,990.00')
              || ' of the ' || to_char(r.capex_threshold, 'FM$999,999,990.00') || ' CapEx threshold (' || r.pct_used
              || '%). Split the work, or tag it CapEx.',
            jsonb_build_object('work_order_id', p_wo, 'level', r.level, 'spent', r.spent, 'capex_threshold', r.capex_threshold));
  end if;

  if r.min_flag
     and not exists (select 1 from public.alerts where alert_type = 'capex_below_min' and subject_id = p_wo) then
    insert into public.alerts (alert_type, severity, subject_table, subject_id, message, details)
    values ('capex_below_min', 'warning', 'work_orders', p_wo,
            'Below the capital minimum: ' || r.wo_number || coalesce(' (' || cust || ')', '') || ' is tagged CapEx but is only '
              || to_char(r.spent, 'FM$999,999,990.00') || ' against a ' || to_char(r.min_amount, 'FM$999,999,990.00')
              || ' minimum. Bill it as repair and maintenance, or remove the CapEx tag.',
            jsonb_build_object('work_order_id', p_wo, 'spent', r.spent, 'min_amount', r.min_amount));
  end if;
end $$;
revoke all on function public.wo_capex_check(uuid) from public, anon, authenticated;

create or replace function public.wo_capex_after_change() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if TG_TABLE_NAME = 'work_orders' then
    perform public.wo_capex_check(NEW.id);
  elsif NEW.work_order_id is not null then
    perform public.wo_capex_check(NEW.work_order_id);
  end if;
  return NEW;
end $$;
revoke all on function public.wo_capex_after_change() from public, anon, authenticated;

create trigger trg_wo_capex_check_hours after insert or update on public.hours_entries
  for each row execute function public.wo_capex_after_change();
create trigger trg_wo_capex_check_parts after insert or update on public.line_items
  for each row execute function public.wo_capex_after_change();
create trigger trg_wo_capex_check_tag after insert or update on public.work_order_capex
  for each row execute function public.wo_capex_after_change();
create trigger trg_wo_capex_check_status after update of status on public.work_orders
  for each row when (old.status is distinct from new.status)
  execute function public.wo_capex_after_change();
