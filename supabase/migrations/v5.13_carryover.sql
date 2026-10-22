-- v5.13 — Carryover ledger (slice 4)
-- Spec: docs/specs/customer-thresholds-and-carryover.md, section 3.
-- A carryover entry records money deliberately left off a job (e.g. P26500 priced $2,500, quoted $2,000 to stay under
-- the customer's limit: $500 carried over). Later, applications are recorded against other open work orders
-- (e.g. $250 on P26505). The app NEVER changes a work order's hours or parts: Kevin adjusts the work order himself,
-- and the ledger just records the reference. Admin only. Additive only: safe to run, nothing existing changes.
--   carryover              one row per carryover event; customer_id is the OWNER (the parent, or the customer itself)
--   carryover_allocations  one row per application against a work order
--   carryover_balance      view: each active entry with applied and remaining balance

create table if not exists public.carryover (
  id                    uuid primary key default gen_random_uuid(),
  customer_id           uuid not null references public.customers(id),   -- owner: the parent account, or the customer when it has none
  origin_work_order_id  uuid not null references public.work_orders(id), -- the job the amount was left off
  label                 text,                                            -- origin work order number, for readable audit rows
  amount                numeric not null check (amount > 0),
  note                  text,
  status                text not null default 'outstanding' check (status in ('outstanding','committed_pending','resolved')),
  created_at            timestamptz not null default now(),
  created_by            text,
  modified_at           timestamptz not null default now(),
  modified_by           text,
  active                boolean not null default true
);

create table if not exists public.carryover_allocations (
  id            uuid primary key default gen_random_uuid(),
  carryover_id  uuid not null references public.carryover(id),
  work_order_id uuid not null references public.work_orders(id),         -- the work order the amount was applied to
  label         text,                                                    -- "P26500 > P26505", for readable audit rows
  amount        numeric not null check (amount > 0),
  note          text,
  status        text not null default 'resolved' check (status in ('committed_pending','resolved')), -- committed_pending is for quoted work orders (slice 5)
  created_at    timestamptz not null default now(),
  created_by    text,
  modified_at   timestamptz not null default now(),
  modified_by   text,
  active        boolean not null default true
);

create index if not exists carryover_customer_idx on public.carryover (customer_id) where active;
create index if not exists carryover_origin_idx on public.carryover (origin_work_order_id) where active;
create index if not exists carryover_alloc_carryover_idx on public.carryover_allocations (carryover_id) where active;
create index if not exists carryover_alloc_wo_idx on public.carryover_allocations (work_order_id) where active;

alter table public.carryover enable row level security;
alter table public.carryover_allocations enable row level security;

create policy carryover_admin_all on public.carryover
  for all to authenticated using (get_user_role() = 'admin') with check (get_user_role() = 'admin');
create policy carryover_alloc_admin_all on public.carryover_allocations
  for all to authenticated using (get_user_role() = 'admin') with check (get_user_role() = 'admin');

create trigger trg_carryover_modified before update on public.carryover
  for each row execute function public.set_modified_at();
create trigger trg_carryover_alloc_modified before update on public.carryover_allocations
  for each row execute function public.set_modified_at();
create trigger audit_carryover after insert or update on public.carryover
  for each row execute function public.audit_row_changes('label', '', 'id,created_at,created_by,modified_at,modified_by');
create trigger audit_carryover_allocations after insert or update on public.carryover_allocations
  for each row execute function public.audit_row_changes('label', '', 'id,created_at,created_by,modified_at,modified_by');

-- Guards, so the rules hold no matter how a row is written.
-- Entry: must belong to an owner account (no parent); cannot be lowered below what is applied; cannot be removed
-- while it still has applications.
create or replace function public.carryover_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  applied numeric;
begin
  if (TG_OP = 'INSERT' or NEW.customer_id is distinct from OLD.customer_id)
     and not exists (select 1 from public.customers c where c.id = NEW.customer_id and c.parent_customer_id is null) then
    raise exception 'Carryover belongs to the parent account, or to a customer with no parent';
  end if;
  if TG_OP = 'UPDATE' then
    select coalesce(sum(a.amount), 0) into applied from public.carryover_allocations a where a.carryover_id = NEW.id and a.active;
    if NEW.active = false and OLD.active and applied > 0 then
      raise exception 'Remove the applications from this carryover first';
    end if;
    if NEW.active and NEW.amount < applied then
      raise exception 'The amount cannot be below what is already applied (%)', applied;
    end if;
  end if;
  return NEW;
end $$;
revoke all on function public.carryover_guard() from public, anon, authenticated;
create trigger trg_carryover_guard before insert or update on public.carryover
  for each row execute function public.carryover_guard();

-- Application: cannot exceed the entry's remaining balance, and the work order must belong to the same customer group.
-- The entry row is locked first so two applications at the same moment cannot both squeeze in.
create or replace function public.carryover_alloc_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  co public.carryover%rowtype;
  others numeric;
  wo_owner uuid;
begin
  if not NEW.active then return NEW; end if;
  select * into co from public.carryover where id = NEW.carryover_id and active for update;
  if not found then raise exception 'That carryover entry is not available'; end if;
  select coalesce(sum(a.amount), 0) into others
    from public.carryover_allocations a where a.carryover_id = NEW.carryover_id and a.active and a.id <> NEW.id;
  if others + NEW.amount > co.amount then
    raise exception 'That is more than the remaining balance (%)', co.amount - others;
  end if;
  select coalesce(c.parent_customer_id, c.id) into wo_owner
    from public.work_orders w join public.customers c on c.id = w.customer_id where w.id = NEW.work_order_id;
  if wo_owner is distinct from co.customer_id then
    raise exception 'That work order belongs to a different customer';
  end if;
  return NEW;
end $$;
revoke all on function public.carryover_alloc_guard() from public, anon, authenticated;
create trigger trg_carryover_alloc_guard before insert or update on public.carryover_allocations
  for each row execute function public.carryover_alloc_guard();

-- Status follows the balance: outstanding while anything is left, then committed_pending if any application still
-- waits on a quote (slice 5), otherwise resolved.
create or replace function public.carryover_refresh(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  co public.carryover%rowtype;
  applied numeric;
  pending boolean;
  new_status text;
begin
  select * into co from public.carryover where id = p_id;
  if not found then return; end if;
  select coalesce(sum(a.amount), 0), coalesce(bool_or(a.status = 'committed_pending'), false)
    into applied, pending from public.carryover_allocations a where a.carryover_id = p_id and a.active;
  new_status := case when applied < co.amount then 'outstanding' when pending then 'committed_pending' else 'resolved' end;
  if co.status is distinct from new_status then
    update public.carryover set status = new_status where id = p_id;
  end if;
end $$;
revoke all on function public.carryover_refresh(uuid) from public, anon, authenticated;

create or replace function public.carryover_after_change() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if TG_TABLE_NAME = 'carryover' then
    perform public.carryover_refresh(NEW.id);
  else
    perform public.carryover_refresh(NEW.carryover_id);
  end if;
  return NEW;
end $$;
revoke all on function public.carryover_after_change() from public, anon, authenticated;
create trigger trg_carryover_alloc_after after insert or update on public.carryover_allocations
  for each row execute function public.carryover_after_change();
create trigger trg_carryover_amount_after after update of amount on public.carryover
  for each row execute function public.carryover_after_change();

-- Each active entry with what has been applied and what is left.
create or replace view public.carryover_balance with (security_invoker = true) as
select c.id, c.customer_id, c.origin_work_order_id, c.label, c.amount, c.note, c.status, c.created_at, c.created_by,
       coalesce(a.applied, 0) as applied,
       c.amount - coalesce(a.applied, 0) as balance
from public.carryover c
left join (select carryover_id, sum(amount) as applied from public.carryover_allocations where active group by carryover_id) a
  on a.carryover_id = c.id
where c.active;

grant select on public.carryover_balance to authenticated;
