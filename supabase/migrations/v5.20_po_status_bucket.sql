-- v5.20: PO status-to-bucket map. Spec: docs/specs/po-status-bucket-map.md (Part A).
-- Each work order status counts toward a PO as billed, pending, or none (not counted). Only three rows are
-- stored; a status with no row counts as pending. Apply BEFORE deploying the v5.20 JS.

create table if not exists public.po_status_bucket (
  system_key text primary key,                 -- matches wo_statuses.system_key
  -- id exists only because audit_row_changes() writes NEW.id into audit_log.record_id (uuid).
  id uuid not null default gen_random_uuid() unique,
  bucket text not null check (bucket in ('billed', 'pending', 'none')),
  modified_at timestamptz not null default now(),
  modified_by text
);

alter table public.po_status_bucket enable row level security;

create policy po_status_bucket_admin_all on public.po_status_bucket
  for all to authenticated
  using (get_user_role() = 'admin')
  with check (get_user_role() = 'admin');

-- The views below are security_invoker, so the caller needs select on this table too.
grant select, insert, update on public.po_status_bucket to authenticated;

create trigger audit_po_status_bucket after insert or update on public.po_status_bucket
  for each row execute function public.audit_row_changes('system_key', '', 'id,modified_at,modified_by');

insert into public.po_status_bucket (system_key, bucket, modified_by) values
  ('invoiced', 'billed', 'migration v5.20'),
  ('invoiced_outside', 'billed', 'migration v5.20'),
  ('cancelled', 'none', 'migration v5.20')
on conflict (system_key) do nothing;

-- po_wo_breakdown: same columns in the same order as v5.05, plus bucket appended at the end.
-- The wo_statuses join deliberately has no "active" filter, so a deactivated status keeps its bucket.
create or replace view public.po_wo_breakdown
with (security_invoker = true) as
select
  w.id as work_order_id,
  w.wo_number,
  w.purchase_order_id,
  w.status,
  coalesce((select sum(li.sell_total) from public.line_items li
            where li.work_order_id = w.id and li.active = true and li.billable = true), 0)
  + coalesce((select sum(he.line_total) from public.hours_entries he
              where he.work_order_id = w.id and he.active = true and he.billable = true), 0)
  + coalesce((select sum(qi.amount) from public.quoted_invoices qi
              where qi.work_order_id = w.id and qi.active = true), 0) as wo_total,
  w.title,
  w.customer_id,
  coalesce(psb.bucket, 'pending') as bucket
from public.work_orders w
left join public.wo_statuses s on s.num = w.status
left join public.po_status_bucket psb on psb.system_key = s.system_key
where w.purchase_order_id is not null and w.active = true;

-- po_ledger: billed and pending follow the bucket; 'none' falls into neither.
create or replace view public.po_ledger
with (security_invoker = true) as
select
  purchase_order_id,
  coalesce(sum(wo_total) filter (where bucket = 'billed'), 0) as billed,
  coalesce(sum(wo_total) filter (where bucket = 'pending'), 0) as pending
from public.po_wo_breakdown
group by purchase_order_id;

grant select on public.po_wo_breakdown to authenticated;
grant select on public.po_ledger to authenticated;
