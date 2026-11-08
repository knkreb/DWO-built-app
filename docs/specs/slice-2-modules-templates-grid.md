# Spec — Roles and Permissions, Slice 2: Modules, Templates, Permission Grid

**Target version:** v5.24 (check the top of `CHANGELOG.md` and `APP_VERSION` first; use the next free number) · **Base:** v5.23 (commit 1ddd56d) · **Written:** 2026-11-08 · **Status:** awaiting Kevin's review
**Design doc:** DWO Roles and Permissions Slices 2 and 3 Build Doc (Claude Docs) · **Slice 1 spec:** `docs/specs/slice-1-user-identity.md` · **Next:** `docs/specs/slice-3-enforcement-settings-split.md`

> Claude Code: read this whole file before touching code. Do not write or deploy anything until Kevin says the exact phrase **"okay to build"**. `git fetch` first. Diagnose first (SQL, then code). Run `node --check` on every changed JS file. Bump `APP_VERSION` and cache busters. Add the CHANGELOG line and the version in the commit message.

---

## 1. Goal

Record who can do what, without changing what anyone can do yet.

After this slice:

- Every app module exists as a row in a `modules` table (23 rows, all from day one).
- Access templates (Admin, Field Tech) are rows with a default level per module.
- A user can differ from their template, module by module (override rows).
- Kevin sets all of it from a Permissions screen in Settings.
- Database functions can answer "may this login do X in module Y", ready for slice 3 to enforce.

**Going live must not change anyone's access.** `profiles.template` and `get_user_role()` stay exactly as they are. Nothing reads the new tables except the Permissions screen and the test functions. Enforcement is slice 3.

## 2. Settled decisions (from the Build Doc and the 2026-11-08 review)

1. Three levels per module: `none`, `view`, `edit`. Edit covers create, update and delete together. Same on every module.
2. A separate QuickBooks flag (`qb_allowed`) on every module, even where it is always off.
3. Every module is in the table from day one, including ones no current user needs.
4. Templates by user type; a user starts from their template and can be customized away from it.
5. New tables only. No existing table changes structure. The `profiles.template` check constraint (`admin`/`field`) is NOT changed in this slice; new templates (office, external) arrive with the separate "User types and time tracking" spec.
6. The database is the source of truth. This slice only records; slice 3 enforces.
7. Admin Settings, the Permissions screen and the Users block are **not modules**. They are admin-template only (checked with `get_user_role() = 'admin'`), so there is no way to lock yourself out of the screen that fixes permissions.
8. Report an Issue and My Settings are open to every logged-in user. They are not modules.

## 3. The module list (23)

Taken from the desktop sidebar, the mobile menu, the Settings tabs and the admin-only helper functions in the code (v5.23).

| key | Label | Group | What it covers |
|---|---|---|---|
| `daily_dashboard` | Daily Dashboard | screen | The dashboard screen. Each widget on it also needs its own module (below) |
| `tasks` | Tasks | screen | Tasks screen; tasks, task_assignments, task_steps, task_templates, task_template_steps |
| `work_orders` | Work Orders | screen | Work orders, hours entries, parts/line items, dispatch assignments, statuses, flags |
| `field_travel_log` | Field Travel Log | screen | GPS day review, punches, breaks, schedules |
| `end_of_day` | End of Day | screen | End-of-day flow |
| `timecard` | Timecard | screen | Timecard screen and weekly submission |
| `truck_stock` | Truck Stock | screen | Truck stock screen |
| `customers` | Customers | screen | Customers, contacts, contact roles |
| `vendors` | Vendors | screen | Vendors, vendor invoices, vendor import/export history |
| `sites` | Sites/Locations | screen | Sites, site types, geofence and GPS dead-zone settings per site |
| `invoicing` | Customer Invoice Generation | screen | Invoice generation, invoice runs |
| `purchase_orders` | Customer Purchase Orders | screen | POs, PO-customer links, change orders, PO status buckets |
| `exports` | Exports | screen | Zed Axis export and export history |
| `feature_req_bugs` | Feature Req/Bugs | screen | The admin bug and feature board (not the Report an Issue button) |
| `carryover` | Carryover | feature | Carryover and carryover allocations |
| `quoted_billing` | Quoted Billing | feature | Quoted work-order billing, quoted invoices |
| `customer_limits` | Customer Limits and Thresholds | feature | Customer thresholds and limits |
| `wo_nte` | WO NTE | feature | Not-to-exceed limits on work orders |
| `wo_capex` | WO CapEx | feature | CapEx on work orders |
| `quote_tracking` | Quote Tracking | feature | Tracked quotes and reminders |
| `reports` | Reports | admin | Reports screen |
| `alerts` | Alerts | admin | Alerts center, bell, Alerts settings tab |
| `audit_log` | Audit Log | admin | Audit Log tab |

Claude Code: before seeding, grep the sidebar (`index.html` ~L558), the mobile menu (`index.html` ~L388), `renderSettings()` tab list (`app-core.js` ~L5247) and every `AppState.userRole === 'admin'` site. If you find a gated feature that fits none of the 23 rows, stop and tell Kevin; do not invent a module.

## 4. Verified state (2026-11-08)

- `profiles` has 4 rows: Kevin (admin), Jadyn (field), Test Admin (admin, no technician), Test User (field).
- `get_user_role()` returns `profiles.template` for the logged-in, active user.
- Test User was tested live (rolled-back transaction): `get_user_role()` = `field`, an update to `settings` changed 0 rows. Test Admin: 1 row. The database already blocks field users from writing settings.
- `audit_row_changes()` (v4.89) is the generic audit trigger. Read its source before attaching it to the new tables (see 5.7).

## 5. Database changes

Put them in `supabase/migrations/v5.24_permissions.sql`. Kevin runs or approves each step; do not run it from Claude Code without "okay to build". Write a rollback file `v5.24_permissions_rollback.sql` (drop the new functions, then the tables in reverse order). Nothing existing references the new objects, so the rollback is clean.

### 5.1 Tables

```sql
create table public.modules (
  key          text primary key,
  label        text not null,
  module_group text not null check (module_group in ('screen','feature','admin')),
  sort_order   int  not null,
  description  text,
  active       boolean not null default true,
  created_at   timestamptz not null default now()
);

create table public.access_templates (
  key        text primary key,                 -- same values as profiles.template
  label      text not null,
  locked     boolean not null default false,   -- locked templates cannot be edited (Admin)
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

create table public.template_permissions (
  id           uuid primary key default gen_random_uuid(),   -- id column so audit_row_changes() works
  template_key text not null references public.access_templates(key),
  module_key   text not null references public.modules(key),
  level        text not null check (level in ('none','view','edit')),
  qb_allowed   boolean not null default false,
  created_at   timestamptz not null default now(),
  modified_at  timestamptz not null default now(),
  modified_by  text not null default '',
  unique (template_key, module_key)
);

create table public.user_permissions (        -- one row per DIFFERENCE from the template
  id          uuid primary key default gen_random_uuid(),
  profile_id  uuid not null references public.profiles(id),
  module_key  text not null references public.modules(key),
  level       text check (level in ('none','view','edit')),   -- null = use the template's level
  qb_allowed  boolean,                                         -- null = use the template's flag
  created_at  timestamptz not null default now(),
  modified_at timestamptz not null default now(),
  modified_by text not null default '',
  unique (profile_id, module_key),
  check (level is not null or qb_allowed is not null)
);
```

All four tables: `enable row level security`.

### 5.2 Rules for the new tables

```sql
-- Everyone logged in can read the definitions (the app needs them in slice 3)
create policy modules_select on public.modules for select to authenticated using (true);
create policy access_templates_select on public.access_templates for select to authenticated using (true);
create policy template_permissions_select on public.template_permissions for select to authenticated using (true);
-- Overrides: your own, or everything if admin
create policy user_permissions_select on public.user_permissions for select to authenticated
  using (profile_id in (select id from public.profiles where user_id = auth.uid()) or public.get_user_role() = 'admin');
-- Writes: admin template only, on all four
create policy modules_write on public.modules for all to authenticated
  using (public.get_user_role() = 'admin') with check (public.get_user_role() = 'admin');
create policy access_templates_write on public.access_templates for all to authenticated
  using (public.get_user_role() = 'admin') with check (public.get_user_role() = 'admin');
create policy template_permissions_write on public.template_permissions for all to authenticated
  using (public.get_user_role() = 'admin') with check (public.get_user_role() = 'admin');
create policy user_permissions_write on public.user_permissions for all to authenticated
  using (public.get_user_role() = 'admin') with check (public.get_user_role() = 'admin');
```

No anonymous (`public` role) policy on any of them.

### 5.3 Lockout protections (triggers)

- `template_permissions`: any insert, update or delete is refused when the template has `locked = true` (Admin). The Admin template always stays full.
- `user_permissions`: an insert or update is refused when the profile's template is `admin`. An admin user cannot be restricted by an override.
- Both raise a plain-English error the grid can show as-is: "The Admin template is locked." / "Admin users can't be restricted."

### 5.4 Functions

All `language sql`, `stable`, `security definer`, `set search_path = public`.

```sql
create function public.perm_rank(l text) returns int language sql immutable as
  $$ select case l when 'edit' then 2 when 'view' then 1 else 0 end $$;

-- Effective level for the logged-in user. Admin template is always 'edit'.
create function public.my_module_level(p_module text) returns text ...
  -- profile = active row where user_id = auth.uid(); none found -> 'none'
  -- profile.template = 'admin' -> 'edit'
  -- else coalesce(user override level, template level, 'none')

create function public.has_module(p_module text, p_min text default 'view') returns boolean ...
  -- perm_rank(my_module_level(p_module)) >= perm_rank(p_min)

create function public.has_qb(p_module text) returns boolean ...
  -- admin template -> true; else coalesce(user override qb_allowed, template qb_allowed, false)

create function public.get_my_permissions() returns table(module_key text, level text, qb_allowed boolean)
  -- one row per active module, effective values for the logged-in user
```

Slice 3 uses these in policies and in the app. In this slice they are only called by tests and by the Permissions screen's "effective access" preview.

### 5.5 Seed: modules and templates

```sql
insert into public.access_templates (key, label, locked, sort_order) values
  ('admin','Admin',true,1), ('field','Field Tech',false,2);
```

Insert the 23 modules from section 3 (key, label, group, sort_order in the table's order, description).

### 5.6 Seed: template defaults

**Admin (locked):** `edit` and `qb_allowed = true` on all 23.

**Field Tech** (settled 2026-11-08; QuickBooks flag off on all 23):

| Level | Modules |
|---|---|
| edit | `daily_dashboard`, `tasks`, `work_orders`, `field_travel_log`, `end_of_day`, `timecard`, `truck_stock` |
| view | `customers`, `sites`, `wo_nte` |
| none | `vendors`, `invoicing`, `purchase_orders`, `exports`, `feature_req_bugs`, `carryover`, `quoted_billing`, `customer_limits`, `wo_capex`, `quote_tracking`, `reports`, `alerts`, `audit_log` |

Reasons Kevin gave: invoice generation is an admin and desktop job; sites are view-only for techs (changes need admin approval); techs must see NTE on a work order in real time. Technicians have **no** customer-create right for now (customers is view only); a request-and-approve queue is a separate later spec that will cover customers, sites and equipment together.

Seed with `insert ... select` from `modules` so a typo cannot leave a module without a row. After seeding, assert: 23 rows per template, Field Tech counts 7 edit / 3 view / 13 none.

**Rule for every future module:** the migration that adds it must insert a row for every template. Put this sentence at the top of the migration file.

### 5.7 Audit

Attach the generic trigger to `template_permissions` and `user_permissions` so every change to access is in the Audit Log. **Read `audit_row_changes()` in `v4.89_operational_audit_trail.sql` first**: it takes `(label_col, work_order_fk_col, excludes)` and expects an `id` column (both tables have one). Use `module_key` as the label column and exclude `created_at,modified_at,modified_by`. If the Audit Log module filter has a fixed list of table names, add the two new tables (module label "Permissions"). Do not audit `modules` or `access_templates`: they change only by migration.

### 5.8 No seed for users

Nobody gets an override row at go-live. Kevin and Jadyn simply follow their templates. Because enforcement is off, nothing changes for them.

## 6. App changes

New file **`app-permissions.js`** (script tag after `app-users.js`). Slice 3 adds the runtime helpers to the same file. No code moves out of existing files in this slice, except the Settings tab list gets one entry.

### 6.1 Permissions tab (Settings, admin only)

Add `{id:'permissions', label:'Permissions'}` to the admin-only tabs in `renderSettings()` (next to Alerts and Audit Log). Desktop layout. A banner at the top: **"Permissions are recorded here but not enforced until v5.25. Nothing below changes what anyone can do yet."** (slice 3 removes the banner.)

**Section A: Templates.** One table. Rows = the 23 modules, grouped Screens / Features / Admin. Columns = Admin (locked, shown greyed with a lock) and Field Tech. Each Field Tech cell: a level dropdown (None / View / Edit) and a QuickBooks checkbox. Changes save on change with a toast; a failed save reverts the control and shows the error text.

**Section B: Users.** A grid: users down the side (name, template), modules across (same grouping, horizontally scrollable, first column sticky). Each cell shows the user's **effective** level (`—`, `View`, `Edit`) and a small `QB` mark when the flag is on. A cell that differs from the template is highlighted. Click a cell → small popover:

- Level: None / View / Edit / **Use template default**
- QuickBooks: Yes / No / **Use template default**

"Use template default" deletes the override row (or nulls just that field). If both fields end up null, the row is deleted. Admin-template users show every cell locked and greyed.

Under the grid: "N users differ from their template" with a list of the differences (user, module, template value → their value). "Show inactive users" toggle, off by default.

Below both sections: a read-only line "Admin Settings, this screen and the Users block are admin-only for everyone and are not modules."

### 6.2 Do not do in this slice

- No change to what any screen shows or any button does.
- No change to `loadUserRole`, `AppState.userRole` or `profiles.template`.
- No new template creation in the UI.
- No change to existing RLS policies.

## 7. QC checks

Claude runs the database checks as each login inside a transaction that always rolls back (`set local role authenticated` plus `set_config('request.jwt.claims', …)` with the user's id and email; raise an exception at the end to return the result). Kevin's OK is needed for any write that is not rolled back. Test Admin user id `fafd3ed9-5a85-4bab-b786-b89f88253566`, Test User `361b0e5c-3d10-4f56-9122-df9fff96bc96`.

1. After the migration: 23 modules, 2 templates, 46 template_permissions rows. Field Tech: 7 edit, 3 view, 13 none; QuickBooks flag true on 0 Field Tech rows and 23 Admin rows.
2. As Test User: `get_my_permissions()` returns 23 rows matching Field Tech. `has_module('vendors')` false, `has_module('customers')` true, `has_module('customers','edit')` false, `has_module('wo_nte')` true, `has_module('invoicing')` false.
3. As Test Admin: all 23 `edit`, `has_qb('exports')` true.
4. As Test User: insert into `template_permissions` and `user_permissions` is refused; update of a template row changes 0 rows; reading `user_permissions` returns only their own rows.
5. As Test Admin: set an override on Test User (`vendors` → `view`); then as Test User `my_module_level('vendors')` = `view`; delete the override → `none` again. (This one is a real write on a test login; needs Kevin's OK; clean up after.)
6. Locked template: as Test Admin, update an Admin template row → refused with the lock message. Insert an override for Kevin or Test Admin → refused.
7. Audit: checks 5 and 6 each leave the expected `audit_log` rows (override add, change, remove) and the refused ones leave none.
8. Permissions tab: visible to Kevin and Test Admin; not visible to Test User or Jadyn; Test User cannot reach it by calling the render function (the data reads return nothing for others' rows and the tab is not rendered).
9. Grid behavior: change a Field Tech cell, reload, value persists; override cell highlights; "Use template default" clears it; "N users differ" count is right.
10. Nothing else changed: Kevin, Jadyn, Test Admin and Test User each log in; sidebar items, mobile menu and Settings tabs are identical to v5.23 (apart from the new Permissions tab for admins). Settings saves still work for admins and are still blocked for Test User.
11. `select count(*) from information_schema.table_privileges where grantee in ('anon','public') and table_name in ('modules','access_templates','template_permissions','user_permissions')` = 0 for write privileges, and an anonymous read of each returns 0 rows.
12. Rollback file runs clean on a branch database (or is reviewed by Kevin if no branch is available).

## 8. Out of scope

- Enforcement: RLS swap, hiding screens, QuickBooks gate, Settings split (slice 3).
- Creating new templates or user types (separate "User types and time tracking" spec). The `profiles.template` check constraint stays.
- Row-level scoping ("only your own records"). Levels are per module.
- Request-and-approve queue for customer, site and equipment changes (own spec, later).
- Dropping the retired `user_roles` table (schema cleanup).

## 9. Decisions log

- 2026-11-07: Build Doc created; access model and tables settled.
- 2026-11-08: Module list approved as proposed (23).
- 2026-11-08: Field Tech template approved with changes: Customer Invoice Generation none; Sites/Locations view only; WO NTE view.
- 2026-11-08: Technicians get no customer-create right for now; approval queue deferred to its own spec.
- 2026-11-08 (Claude): admin template locked and admin users cannot be restricted by overrides, so no one can lock themselves out of the Permissions screen. Added for Kevin's review.
- 2026-11-08 (Claude): `id` column added to both permission tables so the existing audit trigger works unchanged.
