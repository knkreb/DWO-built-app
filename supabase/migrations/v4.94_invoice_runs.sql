-- v4.94 — Customer invoice generation runs (docs/specs/invoice-generation-workflow.md, slice 1)
-- Additive only: one new table. Run state lives in the database so a run survives closing the app
-- and can be resumed from the desktop or the tablet. One active run at a time (partial unique index).
create table if not exists public.invoice_runs (
  id            uuid primary key default gen_random_uuid(),
  status        text not null default 'active' check (status in ('active','finished','cancelled')),
  started_by    text not null,
  started_at    timestamptz not null default now(),
  scope_type    text not null default 'all' check (scope_type in ('all','customers')),
  customer_ids  uuid[] not null default '{}',
  wo_ids        uuid[] not null default '{}',
  step          integer not null default 3,
  steps_done    integer[] not null default '{}',
  exported_at   timestamptz,
  finished_at   timestamptz,
  cancelled_at  timestamptz,
  modified_at   timestamptz not null default now(),
  modified_by   text
);

-- Only one run may be active at a time, so work orders cannot be claimed twice.
create unique index if not exists invoice_runs_one_active
  on public.invoice_runs ((status)) where status = 'active';

alter table public.invoice_runs enable row level security;

create policy invoice_runs_admin_all on public.invoice_runs
  for all to authenticated
  using (get_user_role() = 'admin')
  with check (get_user_role() = 'admin');

create trigger audit_invoice_runs after insert or update on public.invoice_runs
  for each row execute function public.audit_row_changes('started_at', '', 'id,modified_at,modified_by');
