# Spec — Roles and Permissions, Slice 1: User Identity

**Target version:** v4.88 · **Base:** v4.87 (commit 44bae51) · **Written:** 2026-09-27 · **Status:** awaiting Kevin's review
**Design doc:** DWO — Roles and Permissions (Claude Docs)

> Claude Code: read this whole file before touching code. Do not write or deploy anything until Kevin says the exact phrase **"okay to build"**. Diagnose first (SQL, then code). Run `node --check` on every JS file before shipping. Bump `APP_VERSION` and cache busters.

---

## 0. Repo setup (first time only, part of this build)

1. Save this file as `docs/specs/slice-1-user-identity.md`.
2. Create `CLAUDE.md` at the repo root with:

```markdown
# DWO — instructions for Claude Code

- Never build or deploy unless Kevin says the exact phrase "okay to build".
- Before building, read the spec in docs/specs/ that Kevin names. Build only what it lists; anything else goes back to Kevin.
- Diagnose first: SQL, then code. One step at a time on destructive SQL.
- New features go in their own module file, not app-core.js.
- Never hard-delete code during a refactor: comment out with /* MOVED TO [file] — v[X.XX] — date */ and a matching origin note in the receiving file.
- Run node --check on every changed JS file. Bump APP_VERSION and cache busters on every build.
- Commit message format: "v[X.XX]: [summary]". Add a line to CHANGELOG.md for every build.
- Jadyn is male.
```

3. Create `CHANGELOG.md` with a first entry for v4.88.

---

## 1. Goal

Replace the app's guess-based identity with a real login record. After this slice:

- Every login maps to exactly one `profiles` row by its permanent auth user ID — never by email or name.
- Kevin can add, deactivate, reactivate, reset password and change email for any user from Settings, with every change audited.
- Nobody is ever deleted; deactivated people can be found and restored.
- Kevin can create the QC test user through the app.

## 2. Current behavior being replaced (v4.87)

| Where | What it does now | Problem |
|---|---|---|
| `loadUserRole()` app-core.js ~L299 | Reads `user_roles` by email; no row → `'field'` | Any login gets field access |
| `resolveUserTechId()` app-morning-brief.js ~L25 | Matches email text before `@` inside a technician's name; else first technician alphabetically | `jadyneagles@` matches nobody — Jadyn is right by luck; a test login would act as Jadyn |
| `getDefaultTechId()` app-core.js ~L685 | Admin → any technician whose name contains "kevin" | Name-based guess |
| `addNewTech()` app-core.js ~L4306 | Inserts name + color only | No login, email or role |
| `deactivateTech()` app-core.js ~L4296 | Sets `active=false`; browser `confirm()` | Never fills `deleted_at`/`deleted_by`; `loadTechnicians()` loads active only, so they vanish with no way back |
| `get_user_role()` (DB function) | `SELECT role FROM user_roles WHERE email = auth.email()` | Used by RLS on 9 tables (customers, export_history, hours_types, qbo_items, settings, technicians, user_roles, vendor_invoices, vendors). Email-keyed: an email change would strip admin rights |

## 3. Database changes

All checked against the live database on 2026-09-27. Put them in `supabase/migrations/v4.88_profiles.sql`. **Kevin runs or approves each step; do not run it from Claude Code without "okay to build".**

### 3.1 New table `profiles`

```sql
create table public.profiles (
  id                   uuid primary key default gen_random_uuid(),
  user_id              uuid not null unique references auth.users(id),
  email                text not null,              -- display copy; auth.users is the source of truth
  display_name         text not null,
  template             text not null check (template in ('admin','field')),
  technician_id        uuid unique references public.technicians(id),  -- optional: office logins need none
  active               boolean not null default true,
  must_change_password boolean not null default false,
  deactivated_at       timestamptz,
  deactivated_by       text,
  created_at           timestamptz not null default now(),
  created_by           text not null default '',
  modified_at          timestamptz not null default now(),
  modified_by          text not null default ''
);
alter table public.profiles enable row level security;

-- Read: your own row, or everything if admin. No client writes — the admin-users function writes with the service role.
create policy profiles_select on public.profiles for select to authenticated
  using (user_id = auth.uid() or public.get_user_role() = 'admin');
```

Template values stay `'admin'` / `'field'` so the existing RLS policies keep working unchanged. The UI shows them as "Admin" / "Field Tech". Slice 2 turns templates into their own table.

### 3.2 Seed the two real users

```sql
insert into public.profiles (user_id, email, display_name, template, technician_id, created_by, modified_by) values
  ('cfe9506b-8d75-4703-8170-313255aa64b3', 'kevin@providencemech.com', 'Kevin Reb',   'admin', '38f5a3aa-d572-4e85-b65c-70c3c8fce175', 'migration v4.88', 'migration v4.88'),
  ('3e5edc3c-145e-4977-ada1-02ca8f0ace0a', 'jadyneagles@gmail.com',    'Jadyn Young', 'field', '48812660-3a1c-4610-9665-5f8075b4bd4d', 'migration v4.88', 'migration v4.88');
```

Verify: `select * from profiles;` returns 2 rows, each with its technician linked.

### 3.3 Repoint `get_user_role()` to `profiles`

```sql
create or replace function public.get_user_role()
returns text language sql stable security definer set search_path = public as $$
  select template from public.profiles where user_id = auth.uid() and active;
$$;
```

Verify immediately while logged in as Kevin: Settings saves still work (technicians update policy uses this function). If anything breaks, the rollback is the old one-line body reading `user_roles`.

### 3.4 Retire `user_roles` (no drop)

Leave the table and its 2 rows in place, unread. Add a comment:
```sql
comment on table public.user_roles is 'RETIRED v4.88 — replaced by profiles. Drop in schema cleanup.';
```

### 3.5 Delete the unused "Test Subject" technician

It has zero references in all 12 tables that point at technicians (checked 2026-09-27). Re-run the check first, then delete — one step on its own:

```sql
-- check (all counts must be 0), then:
delete from public.technicians where id = 'a9ac864c-f096-4227-97f5-6b68bdf997e1' and name = 'Test Subject';
```

### 3.6 Audit

Reuse the existing `audit_log` table (id, table_name, record_id, action, field_name, old_value, new_value, changed_by, changed_at). Every user action writes one row with `table_name = 'profiles'`, `record_id = profiles.id`. No schema change. `audit_log` is the change history; problems that need someone's attention go in `alerts` (§3.7).

### 3.7 New table `alerts` (shared by every future warning)

```sql
create table public.alerts (
  id              uuid primary key default gen_random_uuid(),
  alert_type      text not null,          -- e.g. 'tid_changed_by_user'; slice 1b adds 'gps_unknown_tid', 'gps_silent'
  severity        text not null default 'warning' check (severity in ('info','warning','urgent')),
  subject_table   text,                   -- what it is about, e.g. 'technicians'
  subject_id      uuid,
  message         text not null,          -- ready to show as-is
  details         jsonb,                  -- e.g. {"old":"JY","new":"JY2"}
  created_at      timestamptz not null default now(),
  created_by      text not null default 'system',
  status          text not null default 'unread'
                  check (status in ('unread','acknowledged','in_progress','resolved')),
  status_note     text,                   -- optional note on the latest status change ("ordered part", "fixed phone settings")
  status_changed_at timestamptz,
  status_changed_by text
);
alter table public.alerts enable row level security;
create policy alerts_select on public.alerts for select to authenticated using (public.get_user_role() = 'admin');
create policy alerts_update on public.alerts for update to authenticated using (public.get_user_role() = 'admin');
-- No client inserts or deletes: alerts are raised by server functions (service role) only and never deleted.
create index alerts_open_idx on public.alerts (created_at desc) where status <> 'resolved';

-- Every status change is written to audit_log by the database itself, so no change can skip the history.
create or replace function public.alerts_audit_status() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status is distinct from old.status or new.status_note is distinct from old.status_note then
    new.status_changed_at := now();
    new.status_changed_by := coalesce(auth.email(), 'system');
    insert into audit_log (table_name, record_id, action, field_name, old_value, new_value, changed_by, changed_at)
    values ('alerts', new.id, 'status_change', 'status',
            old.status, new.status || coalesce(' — ' || new.status_note, ''),
            new.status_changed_by, now());
  end if;
  return new;
end $$;
create trigger alerts_audit_status before update on public.alerts
  for each row execute function public.alerts_audit_status();
```

**Statuses:** Unread (new, nobody has looked) → Acknowledged (seen, nothing needed yet) → In progress (work pending, not resolved) → Resolved (done). Any status can move to any other, including reopening a resolved alert.

### 3.8 Alert settings (existing `settings` key/value table)

```sql
insert into public.settings (key, value) values
  ('alert_gps_silence_minutes', '60'),     -- used by slice 1b's check; editable now
  ('alert_tid_changed_enabled', 'true');
```

## 4. Server function `admin-users` (new Edge Function)

File: `supabase/functions/admin-users/index.ts`. `verify_jwt = true`. Uses `SUPABASE_SERVICE_ROLE_KEY` (available inside Edge Functions by default — never in the browser).

Every call: read the caller from the JWT, load their profile. All actions except `change_own_password` and `set_own_tid` require the caller to be an active `admin`; otherwise return 403.

| Action | Input | Does |
|---|---|---|
| `create_user` | email, display_name, template, color, temp_password, tid? , make_technician (bool) | Create auth user (`email_confirm: true`); if make_technician, insert technician (name, color, tid); insert profile with `must_change_password = true`; audit `create` |
| `reset_password` | profile_id, temp_password | Set auth password; `must_change_password = true`; audit `reset_password` (never log the password) |
| `change_email` | profile_id, new_email | Update auth email with `email_confirm: true` (no emails sent); update `profiles.email`; audit old → new |
| `set_active` | profile_id, active (bool) | Deactivate: ban auth user (`ban_duration: '876000h'`), `profiles.active=false`, fill `deactivated_at/by`, linked technician `active=false` + `deleted_at/deleted_by`. Reactivate: reverse all (`ban_duration: 'none'`, clear dates). Audit either way. Refuse to deactivate yourself |
| `change_own_password` | new_password | Any logged-in user: set own password and clear own `must_change_password` in one step; audit |
| `set_own_tid` | tid (empty = clear) | Any logged-in user with a linked technician: set, change or clear their own `tid`. Audit old → new. Raise an admin alert (§5.4) whenever the user does it. Admins edit anyone's tid in Settings (audited, no alert needed since they made it) |

Minimum password length 8. Return clear error text the UI can show as-is.

**Deployment:** Claude Code writes the function file. Kevin chooses at build time whether Claude Code deploys it with the Supabase CLI or Claude (claude.ai) deploys it through the Supabase connector.

## 5. App changes

New features go in a new file **`app-users.js`** (script tag in `index.html` after `app-core.js`). Moved code gets `MOVED TO app-users.js — v4.88 — 2026-09-xx` markers.

### 5.1 Login and identity (app-core.js login flow + app-users.js)

1. After sign-in (and on session restore), load `profiles?user_id=eq.<auth user id>`.
2. **No profile, or `active = false`** → show a "Not set up" screen: "Your login isn't set up in DWO yet. Contact Kevin." + Sign out. Nothing else loads. A banned (deactivated) user who tries to sign in gets the Supabase error; show "This account has been deactivated. Contact Kevin." instead of the raw message.
3. **`must_change_password = true`** → "Set your password" screen (new password, confirm, Save). Calls `change_own_password`. Only then continue.
4. Set `AppState.userRole = profile.template`, `AppState.userTechId = profile.technician_id`, `AppState.profile = profile`.
5. **Tracker ID prompt:** if `profile.technician_id` is set and that technician's `tid` is empty → modal "GPS tracker ID — enter the ID set in your tracking app" with Save and Later. Save calls `set_own_tid`. Later closes it; it returns next startup. (Jadyn currently has no tid, so he will see this.)
   Users can also view, change or clear their own tracker ID any time from a "My tracker ID" item in their own settings (mobile and desktop). Same function, same admin alert.
6. Replace `loadUserRole()` and `resolveUserTechId()` with the above (comment out old bodies with MOVED markers). `getDefaultTechId()`: drop the name-contains-"kevin" guess; use `AppState.userTechId` after the stored-device default.

### 5.2 Technician lists

- `loadTechnicians()` loads **all** technicians into `AppState.allTechnicians`; `AppState.technicians` stays active-only so every dropdown is unchanged.
- Anywhere a name is looked up for an existing record (hours entries, day review, timecards, reports), look up in `allTechnicians` so deactivated people still show by name.

### 5.3 Users screen (Settings → replaces the "Technicians" block; admin only)

- **Filter:** Active (default) · Inactive · All.
- **Row:** color dot, name, email, template (Admin / Field Tech), tracker ID (inline edit as today), status. "No tracker ID" badge when a linked technician has none.
- **Inactive rows:** greyed, "Deactivated [date] by [name]", Reactivate button.
- **Row actions:** Reset password · Change email · Deactivate. Each opens an in-app confirm panel (no browser `confirm()`/`alert()`), e.g. Deactivate: "Deactivate Jadyn Young? He can't sign in and is removed from dropdowns. All history is kept. You can reactivate any time."
- **Add user panel:** Full name, Email, Template (Admin / Field Tech), Color, Tracker ID (optional), Temp password, "Tracked field worker" checkbox (default on for Field Tech). Calls `create_user`. Show the temp password once on success so Kevin can hand it over.
- Color keeps saving straight to `technicians` as today (admin RLS). Tracker ID edits by an admin also save straight to `technicians`, and write an `audit_log` row (old → new).
- `addNewTech()` and `deactivateTech()` are commented out with MOVED markers.

### 5.4 Admin alert for tracker ID changes

GPS pings are matched to a person only by their **current** `tid` (field-travel-log.js, day review, morning brief). A changed or cleared tid means new pings stop matching and past GPS days look empty under the new ID — so Kevin must know right away.

- Any user-made tid change or clear writes an `audit_log` row **and** raises an alert (`alert_type = 'tid_changed_by_user'`, subject = the technician): "Jadyn Young changed tracker ID from JY to JY2 on [date/time]" (or "cleared" / "set"). Skipped if `alert_tid_changed_enabled` is off.
- The Users screen row shows a "Tracker ID changed" badge while that alert is open.
- No email or push in this slice (push notifications are a separate queued item).

### 5.5 Alerts center (admin only; new file `app-alerts.js`)

- **Header bell** with a count of **Unread** alerts (bold dot when any are In progress). Tap → Alerts panel.
- **Alerts card** at the top of the Daily Dashboard: Unread and In progress counts, top few items, "View all".
- **Alerts panel:** newest first. Filter: **Open** (default — Unread, Acknowledged, In progress) · Unread · In progress · Resolved · All. Each row shows severity color, message, when raised, status chip, and last status change ("In progress — Kevin, Sep 28").
- **Row actions:** Acknowledge · Mark in progress (optional note) · Resolve (optional note) · Reopen (on resolved). Status changes go straight to the `alerts` row; the database trigger writes the audit line.
- **History:** tapping a row expands its full history from `audit_log` (`table_name = 'alerts'`, that `record_id`): every status change with who, when and note.
- **Bulk:** "Acknowledge all unread". No bulk resolve (each resolve is a deliberate act).
- Refresh on app start, on returning to the Dashboard, and every 5 minutes while open.
- Built generic: rendering depends only on `message` and `severity`, so later alert types need no UI work.

### 5.6 Settings → "Alerts" tab (admin only)

- **No GPS alert after __ minutes** — number, default 60, saves to `alert_gps_silence_minutes`. Label notes: "Takes effect when GPS monitoring (slice 1b) ships."
- **Alert me when a user changes their own tracker ID** — on/off, `alert_tid_changed_enabled`.
- Built as a list so later alert types add a row here.

### 5.7 Settings → "Audit Log" tab (admin only, read-only)

Plain list now; search and filters come later without rework.

- Newest first, 50 per page, "Load more". Columns: when · who · what (table + record name where known) · action · field · old → new.
- No edit or delete anywhere.
- **Finding (2026-09-27):** `audit_log` has RLS on but **zero policies**, so the app can neither read nor write it today — the day-review history in field-travel-log (~L1457) silently comes back empty. The 35 existing rows were written by something with elevated rights. Add:
  ```sql
  create policy audit_log_select on public.audit_log for select to authenticated
    using (public.get_user_role() = 'admin');
  create policy audit_log_insert on public.audit_log for insert to authenticated
    with check (changed_by = auth.email());
  -- deliberately no update or delete policy: entries are permanent
  ```
  The `admin-users` function and the alerts trigger write with elevated rights and are unaffected.
- **Foundation for search later:**
  - Indexes: `create index audit_log_changed_at_idx on audit_log (changed_at desc); create index audit_log_changed_by_idx on audit_log (changed_by, changed_at desc); create index audit_log_record_idx on audit_log (table_name, record_id, changed_at desc);`
  - One shared helper for every audit write in the app and the `admin-users` function, with a fixed list of `action` names (`create`, `update`, `deactivate`, `reactivate`, `email_change`, `reset_password`, `tid_change`, `tid_change_by_user`, `status_change`) and `changed_by` always the login email. Consistent values are what make filtering work later.
  - The list query is built from a filter object (empty for now) so who / what / date filters plug in later as UI only.

## 6. QC checks (run after deploy, before anything else ships)

1. Kevin logs in: lands as admin, own name/technician, Settings saves still work (RLS via new `get_user_role()`).
2. Jadyn logs in on iPhone: lands as field, correct technician, sees tracker ID prompt.
3. Kevin creates the QC test user (Field Tech, tracked worker) → logs in with temp password in a private window → forced to set a new password → lands as field with its own technician, **not Jadyn's**.
4. Change the test user's email → log in with the new email → same profile, same history.
5. Reset the test user's password → forced change again at next login.
6. Deactivate the test user → can't sign in, friendly message; gone from dropdowns; appears under Inactive with date and "by Kevin"; `technicians.deleted_at/by` filled.
7. Reactivate → can sign in; back in dropdowns.
8. An existing work order / time entry for a deactivated person still shows their name.
9. A login with no profile sees "Not set up" and nothing else.
10. Field user calling `create_user` directly gets 403.
11. `audit_log` has one row per action above, no passwords in it.
12. `select count(*) from technicians where name='Test Subject'` = 0.
13. Test user changes its own tracker ID → bell shows 1 Unread, Dashboard card shows old → new; the tid change audit row is written.
13a. Walk that alert through Acknowledge → In progress (note "checking phone") → Resolved (note "fixed") → Reopen: bell and filters update at each step; the expanded history shows 4 entries with "Kevin", times and notes; `audit_log` has 4 matching `alerts` rows.
13b. A direct SQL update of an alert's status (as admin) still writes an `audit_log` row (trigger works).
14. Test user clears its own tracker ID → alert says "cleared"; startup prompt returns for the test user.
15. Kevin changes a tracker ID in Settings → audit row written, no alert raised.
16. Turn off "Alert me when a user changes their own tracker ID" → repeat 13 → no alert, audit row still written.
17. Set "No GPS alert after" to 45 → `settings` row reads 45 after reload.
18. Test user (field) cannot see the bell, the Alerts panel, the Alerts tab or the Audit Log tab, and a direct read of `alerts` returns nothing.
19. Audit Log tab shows every action from checks 3–16, newest first, with who / old → new filled; "Load more" pages past 50; the existing 35 day-review entries still show.
20. No way in the app to edit or delete an audit entry; a direct update or delete as admin through the app's API is refused.
21. Field Travel Log's day-review history now shows its entries for Kevin (it was empty before the new policy).
22. A field user can write an audit row only under their own email and cannot read the log.

## 7. Out of scope (later slices)

- Modules table, template defaults, per-user overrides, permission grid (Slice 2)
- App hide/show by permission, new RLS policies, QuickBooks export gate (Slice 3)
- Email invites (needs an outside email service)
- Dropping `user_roles` (schema cleanup)
- Mobile layout for the Users screen (desktop Settings only)

- **Slice 1b (next spec):** tag every GPS ping with its technician on arrival so history survives ID changes; backfill existing pings (all 212,653 are tracker KM); "unknown tracker ID" and "no GPS while clocked in" alerts using `alert_gps_silence_minutes`
- Removing the hard-coded `'KM'` fallback in app-morning-brief.js L50 — note for the code audit

## 8. Decisions from review (2026-09-27)

1. The user answers the tracker ID prompt on their own device, and can enter, change or clear it any time. Admins have the same rights for everyone.
2. Any tracker ID change or clear made by a user alerts the admin in-app until acknowledged, so GPS tracking can be kept straight.
3. One shared Alerts center (bell, Dashboard card, panel) backed by an `alerts` table, rather than a banner per problem. Alerts move through Unread → Acknowledged → In progress (work pending) → Resolved, can be reopened, are never deleted, and every status change is audited with who, when and an optional note.
4. Settings gets an "Alerts" tab; "no GPS" defaults to 60 minutes and is configurable there.
5. GPS history across ID changes is handled in slice 1b by tagging pings with the technician on arrival.
6. Audit Log tab ships now as a read-only list; search and filters come later on the foundation laid here (indexes, fixed action names, filter-ready query).
7. Jadyn's GPS isn't set up yet (no pings is expected); set it up after slice 1b.
