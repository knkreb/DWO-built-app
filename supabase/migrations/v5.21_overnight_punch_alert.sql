-- v5.21 — Overnight punch alert (warn only)
-- Spec: docs/specs/mobile-punch-out-loop.md, change 6.
-- Raises one warning in the Alerts center when a clock-out lands on a later calendar date (Settings timezone)
-- than the day_review's review_date. Alerts cannot be created from the app (the alerts table only allows read and
-- update), so a SECURITY DEFINER trigger raises it, the same pattern as v5.10_work_order_nte.sql.
-- Additive only: no new table, no new column. Apply to the live database BEFORE the v5.21 JS is deployed.

-- 1. Policy setting. 'warn' is the only mode in this build; 'approve' is reserved for a later approval mode
-- (day_review.overnight_status, Approve/Reject on the alert). Nothing reads this value yet.
insert into public.settings (key, value)
select 'overnight_punch_policy', 'warn' where not exists (select 1 from public.settings where key = 'overnight_punch_policy');

-- 2. Alert trigger. Fires after an insert, or an update that sets clock_out, on day_review.
-- Same-day clock-outs raise nothing. An unresolved alert for the same day_review id and the same clock_out time
-- is not repeated; a different overnight time raises a new one.
create or replace function public.day_review_overnight_alert() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  tz         text;
  co         timestamptz;
  ci         timestamptz;
  out_date   date;
  tech_name  text;
  co_iso     text;
begin
  if NEW.clock_out is null then return NEW; end if;

  select nullif(s.value, '') into tz from public.settings s where s.key = 'timezone';
  tz := coalesce(tz, 'America/New_York');

  co := NEW.clock_out::timestamptz;
  ci := NEW.clock_in::timestamptz;
  out_date := (co at time zone tz)::date;
  if out_date <= NEW.review_date::date then return NEW; end if;

  co_iso := to_char(co at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"');

  if exists (select 1 from public.alerts a
             where a.alert_type = 'overnight_punch'
               and a.subject_id = NEW.id
               and a.status <> 'resolved'
               and a.details ->> 'clock_out' = co_iso) then
    return NEW;
  end if;

  select t.name into tech_name from public.technicians t where t.id = NEW.tech_id;

  insert into public.alerts (alert_type, severity, subject_table, subject_id, message, details)
  values ('overnight_punch',
          'warning',
          'day_review',
          NEW.id,
          'Overnight punch: ' || coalesce(tech_name, 'A technician')
            || ' clocked out at ' || to_char(co at time zone tz, 'FMHH12:MI AM Dy Mon FMDD')
            || ' for the shift that began ' || to_char(NEW.review_date::date, 'Dy Mon FMDD')
            || '. Check that it is real.',
          jsonb_build_object(
            'day_review_id', NEW.id,
            'tech_id',       NEW.tech_id,
            'review_date',   NEW.review_date,
            'clock_in',      case when ci is null then null else to_char(ci at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') end,
            'clock_out',     co_iso));
  return NEW;
end $$;
revoke all on function public.day_review_overnight_alert() from public, anon, authenticated;

drop trigger if exists trg_day_review_overnight_alert on public.day_review;
create trigger trg_day_review_overnight_alert after insert or update of clock_out on public.day_review
  for each row execute function public.day_review_overnight_alert();
