-- v5.17 — Carryover on quoted work orders (slice 5b). Needs v5.13 (carryover) and v5.15 (quote tracking).
-- Spec: docs/specs/quote-tracking-and-quoted-carryover.md, slice 5b.
-- An application can now go on a TRACKED quoted work order while the quote is not sent, awaiting, or accepted:
--   not sent / awaiting  -> the application is committed_pending
--   accepted             -> resolved
--   rejected / expired / untracked -> refused
-- When the quote is accepted its pending applications become resolved. When it is rejected (or tracking is stopped),
-- or it expires, its pending applications are RETURNED: the row is switched off (active = false) with returned_on and
-- returned_reason, so the amount goes back on the carryover balance as outstanding. The app never reassigns it.
-- For an expired quote the balance view treats the pending applications as returned at once (no job needed);
-- quote_return_expired() (run by quote_check_all, and by any change to that quote) then writes the rows.
-- The app still never changes a work order's hours or parts. Additive except the replaced functions/view below.

alter table public.carryover_allocations add column if not exists returned_on date;
alter table public.carryover_allocations add column if not exists returned_reason text;

-- Does this application count against the carryover? Active, and not a pending application on an expired quote.
create or replace function public.carryover_alloc_live(p_active boolean, p_status text, p_wo uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(p_active, false)
     and not (p_status = 'committed_pending'
              and exists (select 1 from public.quote_tracking_status q where q.work_order_id = p_wo and q.effective_state = 'expired'))
$$;
revoke all on function public.carryover_alloc_live(boolean, text, uuid) from public, anon;
grant execute on function public.carryover_alloc_live(boolean, text, uuid) to authenticated;

-- Application guard: balance, same customer group, and now the quote rules. Status is set here, not by the app.
create or replace function public.carryover_alloc_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  co public.carryover%rowtype;
  others numeric;
  wo_owner uuid;
  wo_mode text;
  q record;
begin
  if not NEW.active then return NEW; end if;
  select * into co from public.carryover where id = NEW.carryover_id and active for update;
  if not found then raise exception 'That carryover entry is not available'; end if;
  select coalesce(sum(a.amount), 0) into others
    from public.carryover_allocations a
    where a.carryover_id = NEW.carryover_id and a.id <> NEW.id and public.carryover_alloc_live(a.active, a.status, a.work_order_id);
  if others + NEW.amount > co.amount then
    raise exception 'That is more than the remaining balance (%)', co.amount - others;
  end if;
  select coalesce(c.parent_customer_id, c.id), w.form_mode::text into wo_owner, wo_mode
    from public.work_orders w join public.customers c on c.id = w.customer_id where w.id = NEW.work_order_id;
  if wo_owner is distinct from co.customer_id then
    raise exception 'That work order belongs to a different customer';
  end if;
  if wo_mode = 'quoted' then
    select * into q from public.quote_tracking_status where work_order_id = NEW.work_order_id;
    if not found then raise exception 'Track this quote first (Track this quote on the work order), then apply the carryover'; end if;
    if q.effective_state = 'expired' then raise exception 'That quote has expired. Re-send it with new dates before applying carryover'; end if;
    if q.quote_state = 'rejected' then raise exception 'That quote was rejected. Carryover cannot go on a rejected quote'; end if;
    NEW.status := case when q.quote_state = 'accepted' then 'resolved' else 'committed_pending' end;
  else
    NEW.status := 'resolved';
  end if;
  return NEW;
end $$;

-- Entry status follows the balance (pending applications on expired quotes do not count).
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
    into applied, pending
    from public.carryover_allocations a
    where a.carryover_id = p_id and public.carryover_alloc_live(a.active, a.status, a.work_order_id);
  new_status := case when applied < co.amount then 'outstanding' when pending then 'committed_pending' else 'resolved' end;
  if co.status is distinct from new_status then
    update public.carryover set status = new_status where id = p_id;
  end if;
end $$;

-- Balance view: same columns as before; applied and status now ignore pending applications on expired quotes.
create or replace view public.carryover_balance with (security_invoker = true) as
select c.id, c.customer_id, c.origin_work_order_id, c.label, c.amount, c.note,
       case when c.amount - coalesce(a.applied, 0) > 0 then 'outstanding'
            when coalesce(a.pending, false) then 'committed_pending'
            else 'resolved' end as status,
       c.created_at, c.created_by,
       coalesce(a.applied, 0) as applied,
       c.amount - coalesce(a.applied, 0) as balance
from public.carryover c
left join (select carryover_id, sum(amount) as applied, bool_or(status = 'committed_pending') as pending
           from public.carryover_allocations
           where public.carryover_alloc_live(active, status, work_order_id)
           group by carryover_id) a on a.carryover_id = c.id
where c.active;

grant select on public.carryover_balance to authenticated;

-- Return pending applications on one work order (rows switched off, with the reason).
create or replace function public.carryover_return_pending(p_wo uuid, p_reason text, p_by text) returns void
language plpgsql security definer set search_path = public as $$
begin
  update public.carryover_allocations
     set active = false, returned_on = public.quote_today(), returned_reason = p_reason, modified_by = coalesce(p_by, modified_by)
   where work_order_id = p_wo and active and status = 'committed_pending';
end $$;
revoke all on function public.carryover_return_pending(uuid, text, text) from public, anon, authenticated;

-- Quote changes drive the applications on that work order.
create or replace function public.carryover_quote_sync() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  -- It had already run past its expiration: those pending applications are returned now, whatever else changes.
  if OLD.quote_state = 'awaiting' and OLD.expires_on is not null and OLD.expires_on < public.quote_today() then
    perform public.carryover_return_pending(NEW.work_order_id, 'Quote expired on ' || to_char(OLD.expires_on, 'FMMon FMDD, YYYY'), NEW.modified_by);
  end if;
  if NEW.quote_state = 'accepted' and OLD.quote_state is distinct from 'accepted' then
    update public.carryover_allocations set status = 'resolved', modified_by = coalesce(NEW.modified_by, modified_by)
     where work_order_id = NEW.work_order_id and active and status = 'committed_pending';
  elsif NEW.quote_state = 'rejected' and OLD.quote_state is distinct from 'rejected' then
    perform public.carryover_return_pending(NEW.work_order_id, 'Quote rejected', NEW.modified_by);
  elsif NEW.active = false and OLD.active then
    perform public.carryover_return_pending(NEW.work_order_id, 'Quote tracking stopped', NEW.modified_by);
  end if;
  return NEW;
end $$;
revoke all on function public.carryover_quote_sync() from public, anon, authenticated;
drop trigger if exists trg_carryover_quote_sync on public.quote_tracking;
create trigger trg_carryover_quote_sync after update on public.quote_tracking
  for each row execute function public.carryover_quote_sync();

-- Formalize expiries: switch off pending applications on quotes that are past their expiration.
create or replace function public.quote_return_expired() returns integer
language plpgsql security definer set search_path = public as $$
declare
  r record;
  n integer := 0;
begin
  for r in select distinct a.work_order_id, q.expires_on
             from public.carryover_allocations a
             join public.quote_tracking_status q on q.work_order_id = a.work_order_id
            where a.active and a.status = 'committed_pending' and q.effective_state = 'expired' loop
    perform public.carryover_return_pending(r.work_order_id, 'Quote expired on ' || to_char(r.expires_on, 'FMMon FMDD, YYYY'), null);
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function public.quote_return_expired() from public, anon, authenticated;

-- quote_check_all (v5.15) now also formalizes expiries. Same admin guard and return value as before.
create or replace function public.quote_check_all() returns integer
language plpgsql security definer set search_path = public as $$
declare
  w uuid;
  before_n bigint;
  after_n bigint;
begin
  if auth.uid() is not null and get_user_role() is distinct from 'admin' then
    raise exception 'Admin only';
  end if;
  perform public.quote_return_expired();
  select count(*) into before_n from public.alerts where alert_type in ('quote_stale', 'quote_expired');
  for w in select work_order_id from public.quote_tracking_status where quote_state = 'awaiting' loop
    perform public.quote_check(w);
  end loop;
  select count(*) into after_n from public.alerts where alert_type in ('quote_stale', 'quote_expired');
  return (after_n - before_n)::integer;
end $$;
revoke all on function public.quote_check_all() from public, anon;
grant execute on function public.quote_check_all() to authenticated;
