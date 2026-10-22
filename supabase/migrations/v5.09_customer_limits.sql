-- v5.09 — Customer limits, slice 1 (settings home only; no warnings fire yet)
-- Spec: docs/specs/customer-thresholds-and-carryover.md (slice 1)
-- Diagnosed 2026-10-21: customers.parent_customer_id (uuid, self-referencing FK) ALREADY EXISTS but is unused
-- (0 rows set, no code reads it), so this migration does not touch customers. It adds one table holding
-- each customer's NTE and CapEx settings. The row belongs to the "owner" customer: the parent when a
-- customer has one, otherwise the customer itself. Admin-only, like the PO tracker.
-- Additive only: safe to run, nothing existing changes.

create table if not exists public.customer_thresholds (
  id                     uuid primary key default gen_random_uuid(),
  customer_id            uuid not null unique references public.customers(id),
  label                  text,                                   -- customer name snapshot, for readable audit rows

  -- NTE (not to exceed): caps spend; warns and alerts
  nte_enabled            boolean not null default false,
  nte_amount             numeric check (nte_amount is null or nte_amount > 0),
  nte_l1_enabled         boolean not null default true,
  nte_l1_type            text    not null default 'percent' check (nte_l1_type in ('percent','dollar')),
  nte_l1_direction       text    not null default 'spent'   check (nte_l1_direction in ('spent','remaining')),
  nte_l1_value           numeric not null default 75  check (nte_l1_value > 0),
  nte_l2_enabled         boolean not null default true,
  nte_l2_type            text    not null default 'percent' check (nte_l2_type in ('percent','dollar')),
  nte_l2_direction       text    not null default 'spent'   check (nte_l2_direction in ('spent','remaining')),
  nte_l2_value           numeric not null default 100 check (nte_l2_value > 0),

  -- CapEx: never stops work; warns that the job is nearing the line where it must be split or approved
  capex_enabled          boolean not null default false,
  capex_threshold        numeric check (capex_threshold is null or capex_threshold > 0),
  capex_l1_enabled       boolean not null default true,
  capex_l1_type          text    not null default 'percent' check (capex_l1_type in ('percent','dollar')),
  capex_l1_direction     text    not null default 'spent'   check (capex_l1_direction in ('spent','remaining')),
  capex_l1_value         numeric not null default 75  check (capex_l1_value > 0),
  capex_l2_enabled       boolean not null default true,
  capex_l2_type          text    not null default 'percent' check (capex_l2_type in ('percent','dollar')),
  capex_l2_direction     text    not null default 'spent'   check (capex_l2_direction in ('spent','remaining')),
  capex_l2_value         numeric not null default 100 check (capex_l2_value > 0),
  capex_min_enabled      boolean not null default false,        -- minimum amount to bill to the capital account
  capex_min_amount       numeric check (capex_min_amount is null or capex_min_amount > 0),

  created_at             timestamptz not null default now(),
  created_by             text,
  modified_at            timestamptz not null default now(),
  modified_by            text,
  active                 boolean not null default true
);

alter table public.customer_thresholds enable row level security;

create policy customer_thresholds_admin_all on public.customer_thresholds
  for all to authenticated
  using (get_user_role() = 'admin')
  with check (get_user_role() = 'admin');

create trigger trg_customer_thresholds_modified before update on public.customer_thresholds
  for each row execute function public.set_modified_at();

create trigger audit_customer_thresholds after insert or update on public.customer_thresholds
  for each row execute function public.audit_row_changes('label', '', 'id,created_at,created_by,modified_at,modified_by');
