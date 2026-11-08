# Spec — Close Anonymous Access (logged-out data exposure)

**Target version:** next free number after v5.23 (check `CHANGELOG.md` and `APP_VERSION` first). **Ships before roles slice 2**; slice 2 and slice 3 then take the next numbers. · **Written:** 2026-11-08 · **Status:** awaiting Kevin's review
**Related:** `docs/specs/slice-3-enforcement-settings-split.md` (section 2 has the findings; its step B is replaced by this spec)

> Claude Code: read this whole file before touching code. Do not write or deploy anything until Kevin says the exact phrase **"okay to build"**. Run the preflight in `CLAUDE.md` first (this spec needs database write approval, a deploy, and Kevin signing in for one screen check). Diagnose first (SQL, then code). Run `node --check` on every changed JS file. Bump `APP_VERSION` and cache busters.

---

## 1. Goal

Nobody who is not logged in can read or write any company data. Nobody without an active DWO profile can either, even if they manage to create a login. This is a security fix only. It does **not** add roles or modules (that is slices 2 and 3), and it changes nothing a real user can do.

## 2. Verified findings (2026-11-08, live database)

1. A test as the `anon` role (no login, only the publishable key that is in `app-core.js`) returned: 198 work orders, 328 hours entries, 268,765 GPS pings, 225 customers, 39 settings rows.
2. 26 policies are granted to the `public` role, which includes logged-out visitors **and** logged-in users:

| Table | Public policies |
|---|---|
| `customers`, `work_orders`, `technicians`, `settings`, `wo_flags`, `wo_statuses`, `hours_types`, `qbo_items`, `vendors` | SELECT |
| `hours_entries` | SELECT and **DELETE** |
| `day_review`, `location_event`, `locations`, `punch_event`, `tech_schedule` | SELECT, INSERT, UPDATE |

3. For `day_review`, `location_event`, `locations`, `punch_event`, `tech_schedule` the public policies are the **only** policies. Dropping them without replacements would lock out every logged-in user and break the app. For `hours_entries` DELETE it is the only delete policy (Field Travel Log deletes hours entries, `field-travel-log.js` ~L3550 and ~L4498). For `hours_types`, `qbo_items` and `vendors` SELECT, check whether a separate authenticated SELECT policy exists; if not, the same applies.
4. `auth.users` has 4 rows, all with a `profiles` row. No stray accounts today.
5. Whether anyone can **sign up** for a login is a Supabase dashboard setting that could not be read from here. If sign-up is open, a stranger could become a "logged-in user" and many tables allow `true` to any logged-in user. Section 5 closes that path in the database whatever the dashboard says.
6. The GPS receiver (`location-receiver`, deployed as `smooth-function`) and `geocode-address` write with the **service role**, which ignores these policies. They keep working. `admin-users` also uses the service role.
7. The **login screen** reads `company_name` and `company_logo_url` from `settings` before anyone signs in (`app-core.js` ~L216 to L232 and ~L645 to L655). That is the only logged-out read the app depends on, and section 6 removes it.
8. The logo file is in Storage bucket `company-assets`, which is **public**. Printed reports use the logo URL (`app-reports.js` ~L194). Leave the bucket alone.

## 3. Decisions (Kevin, 2026-11-08)

- Fix the logged-out exposure now, ahead of the roles slices.
- No exception for the login screen. Company name and logo are kept on the device and used by the login screen; the **Dynamiq mark is the default** when nothing is saved. The login screen stops calling the database.

## 4. Database changes

Files: `supabase/migrations/v<next>_close_anonymous_access.sql`, plus `v<next>_policies_before.sql` (an export of every current policy, taken first) and `v<next>_close_anonymous_access_rollback.sql` (re-creates the exported policies). Kevin approves each step; do not run it without "okay to build".

### 4.1 Diagnose first

1. Export all current policies from `pg_policies` to the "before" file.
2. Run this and keep the result (it is the worklist for 4.2):

```sql
select p.tablename, p.cmd, p.policyname, p.roles::text
from pg_policies p
where p.schemaname = 'public' and (p.roles::text like '%public%' or p.roles::text like '%anon%')
order by 1, 2;
```

3. For each (table, command) in that list, check whether an `authenticated` policy covers the same command. Mark the ones that do not.
4. Check the API logs for the last 7 days for requests to `/rest/v1/` made without a user token (anon). Anything other than the login-screen settings read means some other client uses the open policies; stop and tell Kevin before dropping anything it needs.

### 4.2 Replace, then drop

For every (table, command) marked in 4.1 as covered **only** by a public policy, first create a logged-in-user replacement with the same command, using the safe condition from section 5:

```sql
create policy <table>_<cmd>_authed on public.<table> for <cmd> to authenticated
  using (public.get_user_role() is not null)           -- SELECT, UPDATE, DELETE
  -- with check (public.get_user_role() is not null)   -- INSERT, UPDATE
;
```

Expected set (confirm with 4.1): `day_review` I/S/U, `location_event` I/S/U, `locations` I/S/U, `punch_event` I/S/U, `tech_schedule` I/S/U, `hours_entries` DELETE, plus `hours_types`, `qbo_items`, `vendors` SELECT if missing. Keep `location_event` INSERT even though the edge function uses the service role, until the API-log check (4.1 step 4) shows nothing else inserts as a user.

Only after the replacements exist, drop all 26 public policies. Do it in one transaction. Then re-run the 4.1 query: it must return no rows.

### 4.3 Verify as each kind of caller (rolled-back transactions)

Use `do $$ ... raise exception 'RESULT ...' $$` so nothing is saved.

- As `anon`: count rows in **every** table in `public`. Every count must be 0, `settings` included. (Loop over `pg_tables` and raise one message listing any table with rows.)
- As Test User (`361b0e5c-3d10-4f56-9122-df9fff96bc96`) and Test Admin (`fafd3ed9-5a85-4bab-b786-b89f88253566`): counts of `work_orders`, `hours_entries`, `customers`, `settings`, `day_review`, `locations` match the pre-change numbers (198, 328, 225, 39, and the current day_review and locations counts).
- As a user with **no profile**: the same counts return 0 (see section 5). Test with a made-up `sub` UUID in the claims.

## 5. Defense for stray logins: "has an active profile"

`public.get_user_role()` already returns `null` for any login without an active `profiles` row. So `get_user_role() is not null` means "a real, active DWO user".

1. Every policy created in 4.2 uses it (above).
2. Also change every **existing** authenticated policy whose condition is plain `true` (or `with check (true)`) to `get_user_role() is not null`. Build the list with:

```sql
select tablename, policyname, cmd
from pg_policies
where schemaname = 'public' and roles::text like '%authenticated%'
  and (coalesce(qual,'') = 'true' or coalesce(with_check,'') = 'true');
```

   Expected to include `tasks`, `task_assignments`, `bug_reports`, `bug_report_statuses`, `customer_contacts`, `customer_contact_roles`, `contact_role_types`, `day_breaks`, `dispatch_assignments`, `work_orders`, `hours_entries`, `line_items`, `quoted_invoices`, `customers`/`technicians`/`settings` SELECT, `wo_flags`/`wo_statuses`, `vendor_import_history`. Policies that already use `get_user_role()` or `false` stay as they are. Do it per policy with `alter policy`, so names and commands do not change.
3. All four existing logins have an active profile, so no one loses access. Verify in 4.3.
4. This is a stopgap, not the final rule: slice 3 replaces these conditions with per-module checks.

**Kevin, outside the code:** in the Supabase dashboard, Authentication, turn **off** "Allow new users to sign up" (users are created only through the admin screen), and confirm "Anonymous sign-ins" is off. Claude cannot see these switches. With section 5 in place a stranger gets nothing even if they are on, but turning them off removes the path.

## 6. Login screen: saved on the device, Dynamiq as the default

New code goes in **`app-branding.js`** (script tag after `app-core.js`). Old bodies in `app-core.js` are commented out with `/* MOVED TO app-branding.js — v<next> — 2026-11-xx */` markers.

**Device storage keys:** `dwo_company_name`, `dwo_company_logo_data` (the image as a data URL), `dwo_company_logo_src` (the URL it was taken from).

1. **Login screen** (`app-core.js` ~L216 to L232 and ~L645 to L655): stop fetching `settings`. Show the saved logo and name if present; otherwise show the Dynamiq mark (`brand/dynamiq-mark-white.svg`) and the name "Dynamiq". No network request to the database before sign-in.
2. **After sign-in** (where `AppState.settings` loads, ~L516 and ~L539): store `company_name`. If `company_logo_url` differs from `dwo_company_logo_src`, fetch the image once, convert it to a data URL, and store it. Scale it down on a canvas to at most 400 px wide first so it stays small in browser storage. Any failure leaves the current saved logo (or the default) in place and shows nothing to the user.
3. **Logo upload** (`app-core.js` ~L4500): after a successful upload, refresh the device copy immediately.
4. **Sign-out** keeps the saved branding. That is the point: the next login screen on this device shows the company logo.
5. First sign-in on a new device, or after clearing browser data, shows the Dynamiq mark until the user has signed in once. That is intended.
6. Everything else that uses `company_logo_url` after login is unchanged (header, Settings, reports use the URL).

## 7. Order of work

1. Preflight (database write, deploy, one screen check with Kevin).
2. Diagnose (4.1). Stop if the API-log check finds another anonymous client.
3. Ship the app change (section 6) **first**, so no device depends on the anonymous settings read.
4. Run the database change (4.2, section 5), then verify (4.3).
5. QC.

Step 3 before step 4 matters: devices that have not yet loaded the new app would otherwise show a broken login screen. Check that the new version is live (version number on the login page or in the header) before step 4.

## 8. QC checks

1. As `anon`: 0 rows in every table in `public` (counts per table). Also try one insert and one delete as `anon` on `hours_entries` inside the rolled-back transaction: both refused.
2. As a made-up user with no profile: 0 rows everywhere.
3. Test Admin and Test User: counts unchanged; Test User still cannot write `settings` (0 rows updated); Test Admin can.
4. Login screen on a device that has signed in before (Kevin): shows the Providence logo and name, with no request to `/rest/v1/settings` (check the network log).
5. Login screen in a private window (first sign-in): shows the Dynamiq mark and name; after signing in and signing out, shows the Providence logo.
6. Change the company logo in Settings: the next login screen on that device shows the new one.
7. Kevin and Jadyn's normal day: sign in, work orders, hours, parts, Field Travel Log (including deleting an hours entry), End of Day, Timecard, punches, tech schedule. No new errors.
8. Tag a new site in Field Travel Log: still works.
9. Send a GPS ping to the location receiver: a new `location_event` row appears. Run an address lookup (`geocode-address`): still returns coordinates.
10. Policy listing: no policy with `public` or `anon` roles; no authenticated policy whose condition is plain `true`.
11. Reload Kevin's iPhone/desktop app after the deploy: no stale-cache login errors.

## 9. Out of scope

- Roles, modules, per-module rules (slices 2 and 3 replace the section 5 stopgap).
- Making the `company-assets` bucket private (printed reports use the logo URL; a later option would use signed URLs).
- Row-level scoping and splitting sensitive settings (default margin, rates) from the rest.
- Anything the API-log check finds that needs its own fix: report it to Kevin.

## 10. Decisions log

- 2026-11-08: Exposure found by testing as `anon`; reported to Kevin.
- 2026-11-08 (Kevin): fix now; company name and logo saved on the device, Dynamiq as the default; no exception.
- 2026-11-08 (Claude): five tables had only public policies, so replacements go in before the drops.
- 2026-11-08 (Claude): added the "has an active profile" condition to every logged-in policy so a stray sign-up gets nothing.
- 2026-11-08 (Claude): logo bucket left public because printed reports use the URL.
