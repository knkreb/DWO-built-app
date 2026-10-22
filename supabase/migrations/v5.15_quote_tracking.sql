-- v5.15 — Quote tracking (slice 5a)
-- Spec: docs/specs/quote-tracking-and-quoted-carryover.md, slice 5a.
-- An explicit flag on each tracked QUOTED work order: not sent, awaiting acceptance, accepted, rejected. Expired is not
-- stored: it is "awaiting and past the expiration date", worked out by the view so it is right without a nightly job.
-- Expiration defaults to 30 days after the quote is sent; the stale warning starts 7 days before expiration (both are
-- Settings defaults, editable per quote). Alerts quote_stale / quote_expired are raised when a quote is saved and when
-- the app loads the Daily Dashboard (quote_check_all). Dates are business days in America/New_York.
-- No backfill: existing quoted work orders stay untracked until Kevin tracks them. Additive only: nothing existing changes.

-- 1. Defaults, editable in Settings.
insert into public.settings (key, value)
select 'quote_expiry_days', '30' where not exists (select 1 from public.settings where key = 'quote_expiry_days');
insert into public.settings (key, value)
select 'quote_remind_days', '7' where not exists (select 1 from public.settings where key = 'quote_remind_days');

-- Today's date for the business, so a quote does not flip to expired at 8 PM Eastern.
create or replace function public.quote_today() returns date
language sql stable as $$ select (now() at time zone 'America/New_York')::date $$;

-- 2. One row per tracked quoted work order. Admin changes it; everyone signed in can read it (the badge).
create table if not exists public.quote_tracking (
  id            uuid primary key default gen_random_uuid(),
  work_order_id uuid not null unique references public.work_orders(id),
  label         text,                                   -- work order number, for readable audit rows
  quote_state   text not null default 'not_sent' check (quote_state in ('not_sent','awaiting','accepted','rejected')),
  sent_on       date,
  expires_on    date,
  decided_on    date,
  remind_days   integer check (remind_days is null or remind_days between 0 and 365), -- null = use the Settings default
  note          text,
  created_at    timestamptz not null default now(),
  created_by    text,
  modified_at   timestamptz not null default now(),
  modified_by   text,
  active        boolean not null default true,
  check (sent_on is null or expires_on is null or expires_on >= sent_on)
);

alter table public.quote_tracking enable row level security;

create policy quote_tracking_select on public.quote_tracking
  for select to authenticated using (true);
create policy quote_tracking_insert on public.quote_tracking
  for insert to authenticated with check (get_user_role() = 'admin');
create policy quote_tracking_update on public.quote_tracking
  for update to authenticated using (get_user_role() = 'admin') with check (get_user_role() = 'admin');

create trigger trg_quote_tracking_modified before update on public.quote_tracking
  for each row execute function public.set_modified_at();
create trigger audit_quote_tracking after insert or update on public.quote_tracking
  for each row execute function public.audit_row_changes('label', '', 'id,created_at,created_by,modified_at,modified_by');

-- Only quoted work orders can be tracked.
create or replace function public.quote_tracking_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if (TG_OP = 'INSERT' or NEW.work_order_id is distinct from OLD.work_order_id)
     and not exists (select 1 from public.work_orders w where w.id = NEW.work_order_id and w.form_mode = 'quoted') then
    raise exception 'Only quoted work orders can be tracked';
  end if;
  return NEW;
end $$;
revoke all on function public.quote_tracking_guard() from public, anon, authenticated;
create trigger trg_quote_tracking_guard before insert or update on public.quote_tracking
  for each row execute function public.quote_tracking_guard();

-- 3. Status per tracked quote, with days left and the effective state (awaiting, stale, expired, or the stored state).
create or replace view public.quote_tracking_status with (security_invoker = true) as
with base as (
  select q.work_order_id, w.wo_number, w.title, w.customer_id, w.status, w.quoted_amount,
         q.quote_state, q.sent_on, q.expires_on, q.decided_on, q.remind_days, q.note,
         coalesce(q.remind_days, (select nullif(s.value, '')::integer from public.settings s where s.key = 'quote_remind_days'), 7) as remind_days_eff,
         case when q.quote_state = 'awaiting' and q.expires_on is not null then q.expires_on - public.quote_today() end as days_left
  from public.quote_tracking q
  join public.work_orders w on w.id = q.work_order_id
  where q.active and w.active
)
select b.*,
       case when b.days_left is not null and b.days_left < 0 then 'expired'
            when b.days_left is not null and b.days_left <= b.remind_days_eff then 'stale'
            else b.quote_state end as effective_state
from base b;

grant select on public.quote_tracking_status to authenticated;

-- 4. Alerts, once per quote and expiration date: quote_stale (entered the reminder window), quote_expired.
create or replace function public.quote_check(p_wo uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  r record;
  cust text;
  kind text;
begin
  select * into r from public.quote_tracking_status where work_order_id = p_wo;
  if not found or r.effective_state not in ('stale', 'expired') then return; end if;
  kind := 'quote_' || r.effective_state;
  if exists (select 1 from public.alerts where alert_type = kind and subject_id = p_wo and details ->> 'expires_on' = r.expires_on::text) then return; end if;
  select coalesce(c.display_name, c.name) into cust from public.customers c where c.id = r.customer_id;
  insert into public.alerts (alert_type, severity, subject_table, subject_id, message, details)
  values (kind,
          case when r.effective_state = 'expired' then 'urgent' else 'warning' end,
          'work_orders', p_wo,
          case when r.effective_state = 'expired'
               then 'Quote expired: ' || r.wo_number || coalesce(' (' || cust || ')', '') || ' expired on ' || to_char(r.expires_on, 'FMMon FMDD, YYYY')
                    || '. Mark it accepted or rejected, or re-send it with new dates.'
               else 'Quote going stale: ' || r.wo_number || coalesce(' (' || cust || ')', '') || ' expires ' || to_char(r.expires_on, 'FMMon FMDD, YYYY')
                    || ' (' || r.days_left || case when r.days_left = 1 then ' day' else ' days' end || ' left)'
                    || coalesce(', quoted ' || to_char(r.quoted_amount, 'FM$999,999,990.00'), '') || '. Follow up with the customer.' end,
          jsonb_build_object('work_order_id', p_wo, 'expires_on', r.expires_on, 'days_left', r.days_left));
end $$;
revoke all on function public.quote_check(uuid) from public, anon, authenticated;

create or replace function public.quote_after_change() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public.quote_check(NEW.work_order_id);
  return NEW;
end $$;
revoke all on function public.quote_after_change() from public, anon, authenticated;
create trigger trg_quote_tracking_check after insert or update on public.quote_tracking
  for each row execute function public.quote_after_change();

-- Dates passing is not a data change, so the app calls this when the Daily Dashboard loads (admin), and a daily
-- scheduled job can call it too (see the optional block below). Returns how many new alerts it raised.
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
  select count(*) into before_n from public.alerts where alert_type in ('quote_stale', 'quote_expired');
  for w in select work_order_id from public.quote_tracking_status where quote_state = 'awaiting' loop
    perform public.quote_check(w);
  end loop;
  select count(*) into after_n from public.alerts where alert_type in ('quote_stale', 'quote_expired');
  return (after_n - before_n)::integer;
end $$;
revoke all on function public.quote_check_all() from public, anon;
grant execute on function public.quote_check_all() to authenticated;

-- OPTIONAL, NOT RUN: raise the alerts every day even when nobody opens the dashboard. Needs the pg_cron extension
-- (Supabase: Database > Extensions). Enable it only when Kevin says so.
-- create extension if not exists pg_cron;
-- select cron.schedule('quote-check-daily', '0 12 * * *', $$select public.quote_check_all()$$);
