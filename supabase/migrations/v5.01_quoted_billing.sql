-- v5.01 — Quoted work order billing (docs/specs/quoted-wo-billing.md)
-- Additive only: new columns, one default setting. No data is changed or removed.
-- form_mode stays as the billing type; quoted_invoices becomes the milestones table.

-- Work order: fixed quoted price and the per-work-order cost warning threshold
-- (cost_warn_pct: null = use the Settings default, 0 = early warning off)
alter table public.work_orders
  add column if not exists quoted_amount  numeric(12,2),
  add column if not exists cost_warn_pct  numeric(5,2);

-- Milestones (existing columns kept: description, amount, po_number, active, ...)
alter table public.quoted_invoices
  add column if not exists trigger_label       text,
  add column if not exists is_percent          boolean not null default false,
  add column if not exists percent_value       numeric(7,3),
  add column if not exists status              text not null default 'pending',
  add column if not exists sort_order          integer not null default 0,
  add column if not exists due_date            date,
  add column if not exists qbo_ref             text,
  add column if not exists ready_requested_by  text,
  add column if not exists ready_requested_at  timestamptz,
  add column if not exists ready_at            timestamptz,
  add column if not exists ready_by            text,
  add column if not exists exported_at         timestamptz,
  add column if not exists exported_by         text,
  add column if not exists exported_snapshot   jsonb,
  add column if not exists billed_at           timestamptz,
  add column if not exists billed_by           text,
  add column if not exists paid_at             timestamptz,
  add column if not exists paid_by             text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'quoted_invoices_status_check') then
    alter table public.quoted_invoices
      add constraint quoted_invoices_status_check check (status in ('pending','ready','billed','paid'));
  end if;
end $$;

create index if not exists quoted_invoices_wo_sort on public.quoted_invoices (work_order_id, sort_order);

-- Default cost warning threshold (percent of quoted amount), editable in Settings
insert into public.settings (key, value)
select 'quoted_cost_warn_default_pct', '75'
where not exists (select 1 from public.settings where key = 'quoted_cost_warn_default_pct');
