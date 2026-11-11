-- v5.24 close_anonymous_access (spec: docs/specs/close-anonymous-access.md, sections 4.2 and 5)
-- One DO block = one statement, so it is all-or-nothing. Rollback: v5.24_close_anonymous_access_rollback.sql.
-- Before state: v5.24_policies_before.sql. Table copies taken first in schema "backup" (suffix _20261111).
--
-- 1. REPLACE: for every table and command whose ONLY policy is a public/anon one, create a logged-in-user policy first.
--    Expected: day_review, location_event, locations, punch_event, tech_schedule (insert, select, update) and hours_entries (delete) = 16.
-- 2. TIGHTEN: every logged-in policy whose condition is plain true now requires an active DWO profile (47 policies).
-- 3. DROP: every policy granted to the public or anon role (26 policies).
-- "(select public.get_user_role()) is not null" means "a real, active DWO user" (same meaning as the spec's
-- "public.get_user_role() is not null"; the select form is evaluated once per query, which is faster on large tables).
do $mig$
declare
  r record;
  cond constant text := '(select public.get_user_role()) is not null';
begin
  for r in
    select distinct p.tablename, p.cmd
    from pg_policies p
    where p.schemaname = 'public'
      and (p.roles::text like '%public%' or p.roles::text like '%anon%')
      and not exists (
        select 1 from pg_policies a
        where a.schemaname = 'public' and a.tablename = p.tablename
          and (a.cmd = p.cmd or a.cmd = 'ALL') and a.roles::text like '%authenticated%')
  loop
    execute format('create policy %I on public.%I as permissive for %s to authenticated%s%s',
      r.tablename || '_' || lower(r.cmd) || '_authed', r.tablename, lower(r.cmd),
      case when r.cmd in ('SELECT','UPDATE','DELETE') then ' using (' || cond || ')' else '' end,
      case when r.cmd in ('INSERT','UPDATE') then ' with check (' || cond || ')' else '' end);
  end loop;

  for r in
    select tablename, policyname, qual, with_check
    from pg_policies
    where schemaname = 'public' and roles::text like '%authenticated%'
      and (coalesce(qual,'') = 'true' or coalesce(with_check,'') = 'true')
  loop
    execute format('alter policy %I on public.%I%s%s', r.policyname, r.tablename,
      case when r.qual = 'true' then ' using (' || cond || ')' else '' end,
      case when r.with_check = 'true' then ' with check (' || cond || ')' else '' end);
  end loop;

  for r in
    select tablename, policyname
    from pg_policies
    where schemaname = 'public' and (roles::text like '%public%' or roles::text like '%anon%')
  loop
    execute format('drop policy %I on public.%I', r.policyname, r.tablename);
  end loop;
end
$mig$;
