-- v4.99 — PO Tracker Module
-- Spec: docs/specs/dwo-spec-2026-10-05-po-tracker.md
-- Three new tables (purchase_orders, purchase_order_customers, po_change_orders), one new column on
-- work_orders (purchase_order_id, for the picker-mode link — free text keeps using the existing po_number
-- column), and two views that compute live billed/pending totals per PO from existing billing data
-- (quoted_invoices for quoted jobs, line_items + hours_entries for T&M, gated on work_orders.status = 12
-- "Invoiced" per the 2026-10-04 status-numbering decision). Admin-only throughout — Jadyn has no PO access.

create table if not exists public.purchase_orders (
  id                       uuid primary key default gen_random_uuid(),
  po_number                text not null,
  description               text not null,
  po_type                  text not null check (po_type in ('dollar','standing')),
  original_amount          numeric,                         -- dollar type only
  status                   text not null default 'created' check (status in ('created','in_progress','completed','cancelled')),
  warning_mode             text check (warning_mode in ('dollar','percent')),   -- dollar type
  warning_value            numeric,                          -- dollar type: $ remaining or % consumed, per warning_mode
  expiration_date          date,                             -- standing type
  expiration_warning_days  integer,                          -- standing type: lead time before expiration_date
  locked                   boolean not null default false,
  locked_work_order_id     uuid references public.work_orders(id),
  created_at               timestamptz not null default now(),
  created_by               text,
  modified_at              timestamptz not null default now(),
  modified_by              text,
  active                   boolean not null default true
);

create index if not exists purchase_orders_po_number_idx on public.purchase_orders (po_number);

-- Account assignment: which DWO customer records (flat — no QBO parent/sub hierarchy) a PO can draw
-- against. Many-to-many so the rare multi-account PO (single shared pool) is supported directly.
create table if not exists public.purchase_order_customers (
  id                 uuid primary key default gen_random_uuid(),
  purchase_order_id  uuid not null references public.purchase_orders(id) on delete cascade,
  customer_id        uuid not null references public.customers(id),
  created_at         timestamptz not null default now(),
  unique (purchase_order_id, customer_id)
);

-- Unlimited, editable/deletable change orders. Deletion is a soft-delete (active=false) so it's
-- captured by the generic audit trigger as a 'deactivate' event, same convention as the rest of the app.
create table if not exists public.po_change_orders (
  id                 uuid primary key default gen_random_uuid(),
  purchase_order_id  uuid not null references public.purchase_orders(id) on delete cascade,
  description        text not null,
  amount             numeric not null,
  created_at         timestamptz not null default now(),
  created_by         text,
  modified_at        timestamptz not null default now(),
  modified_by        text,
  active             boolean not null default true
);

-- Work order → tracked PO link (picker mode). Free-text mode keeps using work_orders.po_number alone
-- and leaves this null. Many work orders may point at the same PO; locking is enforced in the app
-- (setWOStatus / delete guards) against purchase_orders.locked_work_order_id, not a DB constraint,
-- since a locked PO's own record is what carries the one-to-one intent.
alter table public.work_orders add column if not exists purchase_order_id uuid references public.purchase_orders(id);
create index if not exists work_orders_purchase_order_id_idx on public.work_orders (purchase_order_id);

alter table public.purchase_orders enable row level security;
alter table public.purchase_order_customers enable row level security;
alter table public.po_change_orders enable row level security;

create policy purchase_orders_admin_all on public.purchase_orders
  for all to authenticated
  using (get_user_role() = 'admin')
  with check (get_user_role() = 'admin');

create policy purchase_order_customers_admin_all on public.purchase_order_customers
  for all to authenticated
  using (get_user_role() = 'admin')
  with check (get_user_role() = 'admin');

create policy po_change_orders_admin_all on public.po_change_orders
  for all to authenticated
  using (get_user_role() = 'admin')
  with check (get_user_role() = 'admin');

create trigger audit_purchase_orders after insert or update on public.purchase_orders
  for each row execute function public.audit_row_changes('description', '', 'id,created_at,created_by,modified_at,modified_by');

create trigger audit_po_change_orders after insert or update on public.po_change_orders
  for each row execute function public.audit_row_changes('description', '', 'id,created_at,created_by,modified_at,modified_by');

-- Live per-PO billed/pending totals. security_invoker so RLS on the underlying tables still applies.
-- "Billed" = quoted_invoices (quoted jobs) + T&M line items/hours once the work order has reached
-- status 12 (Invoiced). "Pending" = the same T&M sources while the work order hasn't reached 12 yet —
-- i.e. logged and tracked against the PO, but not yet actually billed out.
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
              where qi.work_order_id = w.id and qi.active = true), 0) as wo_total
from public.work_orders w
where w.purchase_order_id is not null and w.active = true;

create or replace view public.po_ledger
with (security_invoker = true) as
select
  purchase_order_id,
  coalesce(sum(wo_total) filter (where status = 12), 0) as billed,
  coalesce(sum(wo_total) filter (where status <> 12), 0) as pending
from public.po_wo_breakdown
group by purchase_order_id;

grant select on public.po_wo_breakdown to authenticated;
grant select on public.po_ledger to authenticated;

-- Seed system-wide PO defaults (Settings → Billing) so saveSetting()'s patch-only update has a row to
-- find on first use, same as every other settings key in the app.
insert into public.settings (key, value) values
  ('po_default_warning_mode', 'percent'),
  ('po_default_warning_value', '20'),
  ('po_default_expiration_warning_days', '30')
on conflict (key) do nothing;
