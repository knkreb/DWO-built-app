# Spec — Roles and Permissions, Slice 3: Enforcement, QuickBooks Gate, Settings Split

**Target version:** v5.26 (was v5.25 before the close-anonymous-access fix took v5.24; use the next free number; `git fetch` and check `CHANGELOG.md` first) · **Requires:** slice 2 (v5.25) deployed and QC-passed · **Written:** 2026-11-08 · **Status:** awaiting Kevin's review
**Design doc:** DWO Roles and Permissions Slices 2 and 3 Build Doc (Claude Docs) · **Previous:** `docs/specs/slice-2-modules-templates-grid.md`

> Claude Code: read this whole file, and the slice 2 spec, before touching code. Do not write or deploy anything until Kevin says the exact phrase **"okay to build"**. This slice changes who can read and write production data, so work in the order in section 3 and stop for Kevin's go-ahead at each gate. Diagnose first (SQL, then code). Run `node --check` on every changed JS file. Bump `APP_VERSION` and cache busters.

---

## 1. Goal

Make the permissions real. After this slice:

- The database blocks what a user may not read or write, per module, using the slice 2 tables. Hiding a button is never the only gate.
- Nobody can read or write company data without logging in (see 2.1: today anyone can).
- The app hides screens a user has no access to and makes view-only screens read-only.
- QuickBooks-touching actions need the module's QuickBooks flag.
- Settings is split: **Admin Settings** (admin only) and **My Settings** (everyone).
- Technicians can see the NTE limit on a work order in real time.

## 2. Verified findings (2026-11-08, live database)

### 2.1 Unauthenticated access (most important)

Many tables have policies for the `public` role, which includes someone who is **not logged in**. The app's publishable key is in `app-core.js` (`SUPABASE_KEY`), so anyone who opens the app source has it. A rolled-back test as the `anon` role returned: **198 work orders, 328 hours entries, 268,765 GPS pings, 39 settings rows, 225 customers.**

Tables with `public` policies (read unless noted): `work_orders`, `hours_entries` (also **delete**), `customers`, `technicians`, `settings`, `wo_statuses`, `wo_flags`, `day_review` (read, insert, update), `location_event` (read, insert, update), `locations` (read, insert, update), `punch_event` (read, insert, update), `tech_schedule` (read, insert, update), plus `dispatch_assignments` (update). Claude Code: re-run the policy listing at build time and treat that list as the starting point, not the full answer.

The rest of the tables are authenticated-only, but several are wide open to **every logged-in user**: `tasks`, `task_assignments`, `bug_reports`, `bug_report_statuses`, `customer_contacts`, `customer_contact_roles`, `contact_role_types`, `day_breaks`, `work_orders`/`hours_entries`/`line_items`/`quoted_invoices` writes (`true`), `wo_flags`/`wo_statuses` updates, `vendor_import_history`.

### 2.2 What does not depend on the open policies (verified)

- GPS pings arrive through the `location-receiver` edge function (deployed as `smooth-function`), which writes with the **service role**. `geocode-address` also uses the service role. Closing the `public` policies does not affect either.
- `admin-users` uses the service role and checks the caller itself.

### 2.3 What does depend on anonymous reads

The **login screen** reads `company_name` and `company_logo_url` from `settings` before anyone signs in (`app-core.js` ~L220 and ~L648). **Decision 2026-11-08:** no exception. The login screen stops reading the database; it uses a copy saved on the device, or the Dynamiq mark. See `docs/specs/close-anonymous-access.md`, which ships first.

### 2.4 Settings write access

Verified as Test User: `settings` update changes 0 rows; as Test Admin 1 row. Insert and update on `settings` already require the admin template. Nobody can delete settings. This is correct and stays.

### 2.5 Other

- `get_user_role()` is used by policies on 23 tables (not the 9 listed in the slice 1 spec).
- `bug_reports` is open to every logged-in user for all operations; `sb.delete('bug_reports', …)` exists in the app (`app-core.js` ~L6214).
- The client deletes rows from `hours_entries` (`field-travel-log.js` ~L3550, ~L4498) and `dispatch_assignments` (`app-morning-brief.js` ~L632). Those deletes must keep working for the right users.
- `settings` rows `default_margin` and `rate_hour_*` are readable by every logged-in user, including technicians. Splitting sensitive settings from non-sensitive ones is out of scope; noted for Kevin.

## 3. Build order and gates

One version, five steps, in this order. Each database step has its own migration file and its own rollback file. **Before step A, export every current policy definition to `supabase/migrations/v5.26_policies_before.sql`** (from `pg_policies`) so rollback is exact.

| Step | What | Gate before the next step |
|---|---|---|
| A | App runtime (`can()`, hide/show) with enforcement still off in the database | Kevin, Jadyn, Test Admin, Test User log in; sidebar and menus match the Field Tech template; nothing broke for admin |
| B | Anonymous access (4.4) | **Already done by `docs/specs/close-anonymous-access.md`, which ships before slice 2.** Here: only re-verify (4.4 step 3) |
| C | Module policies (4.2 and 4.3) | QC checks 1–12 pass as Test Admin and Test User |
| D | QuickBooks gate (6) | QC checks 13–15 |
| E | Settings split and My Settings (7) | QC checks 16–20 |

Kevin reviews the result after steps B and C before the next step starts. If anything breaks for Jadyn's real work, roll back that step only.

## 4. Database changes

### 4.1 Helpers

Slice 2 provides `has_module(module, min_level)`, `has_qb(module)`, `my_module_level(module)` and `get_my_permissions()`. No new helper tables.

### 4.2 Policy pattern

For each table, replace its policies with:

| Command | Rule |
|---|---|
| SELECT | `has_module(<module>, 'view')` |
| INSERT / UPDATE | `has_module(<module>, 'edit')` |
| DELETE | `has_module(<module>, 'edit')` **only if the client deletes from that table**; otherwise `false` (nobody deletes) as today |

All policies `to authenticated`. No `public`/`anon` policy remains on any table except the one in 4.4. Admin-template users pass every check because `has_module` returns true for them.

**Claude Code: diagnose first.** For each table below, grep the client (`sb.delete`, `sb.patch`, `sb.post`, `sb.get`) to confirm which commands it actually uses and which screens touch it. Where a screen a Field Tech can open reads or writes a table mapped to a module the template denies, stop and list it for Kevin rather than loosening a policy. Expected such cases are in section 4.5.

### 4.3 Table to module map

| Module | Tables (read at `view`, write at `edit`) |
|---|---|
| `work_orders` | `work_orders`, `hours_entries` (delete allowed), `line_items`, `dispatch_assignments` (delete allowed) |
| `quoted_billing` | `quoted_invoices` writes; **select** also allowed with `work_orders` view (the work order screen shows quoted totals) |
| `wo_nte` | `work_order_limits` |
| `wo_capex` | `work_order_capex` |
| `field_travel_log` | `day_review`, `day_breaks`, `punch_event`, `tech_schedule`, `location_event` (select; insert from client none, edge function only; update at `edit` if the client updates it) |
| `timecard` | `time_entry`, `time_block`, `week_submission` |
| `tasks` | `tasks`, `task_assignments`, `task_steps`, `task_templates`, `task_template_steps` |
| `customers` | `customers`, `customer_contacts`, `customer_contact_roles`, `contact_role_types` |
| `customer_limits` | `customer_thresholds` |
| `vendors` | `vendors`, `vendor_invoices`, `vendor_import_history`, `vendor_export_history` |
| `sites` | `locations` (INSERT also allowed with `field_travel_log` edit, see 4.5 item 1), `location_entity_types` |
| `invoicing` | `invoice_runs` |
| `purchase_orders` | `purchase_orders`, `purchase_order_customers`, `po_change_orders`, `po_status_bucket` |
| `exports` | `export_history` (insert also needs the QuickBooks flag, see 6) |
| `carryover` | `carryover`, `carryover_allocations` |
| `quote_tracking` | `quote_tracking` |
| `alerts` | `alerts` (as today, via the module instead of the template) |
| `audit_log` | `audit_log` select; insert stays "own email" as today |
| `feature_req_bugs` | `bug_reports`, `bug_report_statuses` — **special rule below** |

**Reference tables every logged-in user can read, written by the admin template only** (they feed screens everywhere): `wo_statuses`, `wo_flags`, `hours_types`, `qbo_items`, `technicians`, `settings` (read rule in 4.4), `profiles` (unchanged). Write policy: `get_user_role() = 'admin'` as today (these are Admin Settings screens). `wo_statuses` and `wo_flags` currently allow any logged-in user to update; change to admin template.

**`bug_reports` special rule.** Report an Issue is open to everyone. INSERT: any logged-in user. SELECT: the reporter's own reports (their `tech_id`), or `has_module('feature_req_bugs','view')`. UPDATE and DELETE: `has_module('feature_req_bugs','edit')`. `bug_report_statuses`: select all logged-in, write at `edit`. (The reporter seeing status and resolution notes is a separate design, noted in the Inbox; this rule only stops users reading each other's reports.)

**Tables not in the list** (`user_roles` retired, `profiles`, `modules`, `access_templates`, `template_permissions`, `user_permissions`, `equipment_status_types`, `exit_interview_*`, anything added since v5.23): leave their policies as they are, list them in the migration as a comment, and tell Kevin which of them still have `true` or `public` policies so he can decide.

### 4.4 Anonymous access

Done earlier by `docs/specs/close-anonymous-access.md` (ships before slice 2): no table has a `public`/`anon` policy and the login screen no longer reads the database. In this slice, only:

1. Re-run the policy listing and confirm no `public`/`anon` policy came back.
2. The interim "any logged-in user" policies that spec created are the ones slice 3 replaces in 4.2 and 4.3.
3. Re-verify with rolled-back `anon` queries: `select count(*)` returns 0 on **every** table, `settings` included. There is no exception.

### 4.5 Expected cross-module dependencies (decide with Kevin, do not guess)

These are places where the Field Tech template and the current screens may collide. Diagnose each; the spec's default is in bold.

1. **Stop tagging in Field Travel Log (decided 2026-11-08).** Techs can tag a stop as a new site; an admin reviews it afterward. Verified: tagging posts a new row to `locations` directly (`field-travel-log.js` ~L1953 and ~L3735), so today there is no review. Build:
   - Policy: `locations` INSERT allowed with `has_module('field_travel_log','edit')` or `has_module('sites','edit')`. UPDATE and DELETE need `sites` edit. The tech's tag works at once, so their day is not blocked.
   - A database trigger on `locations` insert: when the creator is not an admin-template user, raise an `alerts` row (`alert_type = 'site_tagged_for_review'`, severity `info`, subject = the new site, message "[tech] tagged a new site: [name]. Review it."). It uses the existing Alerts center and its Unread → Acknowledged → In progress → Resolved flow; Kevin resolves it after checking name, address and radius. Raise it from a `security definer` trigger (the alerts table takes no client inserts).
   - Diagnose first: if tagging also PATCHes `locations` right after the insert (names, radius), list every field it sets. Those updates must be allowed for the creator on rows they just created, or the tag step must send everything in the insert.
   - A true approve/reject queue (pending state, reject removes the site) is the later queue spec that also covers customers and equipment. Alerts is the interim review.
2. **Quoted work orders.** The work order screen for a quoted WO reads quoted billing data. **Allow select on `quoted_invoices` with `work_orders` view** (4.3), keep writes at `quoted_billing` edit.
3. **Customer limit warnings** shown on a work order (`app-customer-limits.js`) read `customer_thresholds` and NTE rows. **Techs see NTE (view). Customer limit warnings stay admin-only** unless Kevin says otherwise; the work order must not error when it cannot read thresholds.
4. **Daily Dashboard widgets.** Each widget loads only if the user has its module (6.4). A tech's dashboard simply shows fewer cards.
5. **Reports** has no table of its own; it reads tables gated by other modules. Field Tech has `reports` = none, so the screen is hidden; the database gate is the underlying tables.

### 4.6 Rollback

`v5.26_rls_rollback.sql` restores `v5.26_policies_before.sql`. Test it on a database branch before the production run, or have Kevin review it line by line if no branch is available.

## 5. App changes

All new runtime code goes in **`app-permissions.js`** (created in slice 2). Old bodies are commented out with `/* MOVED TO app-permissions.js — v5.25 — 2026-11-xx */` markers; never deleted.

### 5.1 Loading permissions

1. After the profile loads (slice 1 flow), call `get_my_permissions()` once; store in `AppState.perms = { module_key: { level, qb } }`.
2. Cache a copy in `localStorage` for faster startup and offline display only. It is refreshed every start. The database is the gate; a stale cache can show a button the database then refuses, and the refusal must show a clear message (5.5).
3. **Fail closed:** if the call fails and there is no cache, show the same screen as "Not set up" with "Couldn't load your access. Check your connection and try again." Nothing else loads. A stale cache is used when offline.
4. Helpers: `can(module, 'view'|'edit')`, `canQB(module)`, `isAdminTemplate()` (= `AppState.userRole === 'admin'`). Unknown module → false.

### 5.2 Hide and show

- **Desktop sidebar** (`index.html` ~L558): each item carries its module; hide when level is `none`. Same for the **mobile menu** (~L388) and the Dashboard widgets.
- **Direct navigation guard:** `desktopNav()` and `hamburgerNav()` refuse a screen the user has no access to ("You don't have access to that screen") instead of relying on the missing menu item.
- **View level = read-only.** On a screen at `view`, hide or disable add, edit, delete and save controls. Each module file replaces its own admin helper with `can(<module>,'edit')`.
- Settings entry: see section 7.

### 5.3 Replacing the existing admin checks

There are about 45 uses of `AppState.userRole === 'admin'` and four helper functions. Two kinds:

**Module gates → replace with `can()`:**

| Today | Becomes |
|---|---|
| `coAdmin()` (app-carryover.js) | `can('carryover','edit')`; view for read-only display |
| `clIsAdmin()` (app-customer-limits.js) | `can('customer_limits','edit')` |
| `qbIsAdmin()` (app-quoted-billing.js) | `can('quoted_billing','edit')` |
| `wonIsAdmin()` (app-wo-nte.js) | split: `can('wo_nte','edit')` for every edit/apply/reset action; `can('wo_nte','view')` to show NTE status (section 8) |
| app-reports.js `isAdmin` | `can('reports','view')` |
| app-alerts.js (6 uses), bell, hamburger Alerts | `can('alerts','view')` |
| Audit Log tab | `can('audit_log','view')` |
| Nav items `sidebar-potracker`, `sidebar-bugreports` (app-core.js ~L2252) | `can('purchase_orders','view')`, `can('feature_req_bugs','view')` |
| Dashboard cards in app-morning-brief.js: invoice run reminder, PO reminders, quoted billing, NTE dashboard, CapEx dashboard, quotes, bug reports | `invoicing`, `purchase_orders`, `quoted_billing`, `wo_nte` (view), `wo_capex`, `quote_tracking`, `feature_req_bugs` |

**Within-module admin actions → keep as the admin template (`isAdminTemplate()`), but list them in the changelog.** These are finer than module level and are future granularity, not part of this slice: editing work order details, moving a completed/processed/cancelled work order back (`allowedTransitions`, `app-wo-status-field.js`), the "Ready to export" banner, accepting a day review and manual clock edits in `field-travel-log.js` (~L1579, L1602, L1704, L3817), the morning-brief "open punches for all techs" query, the mobile/desktop toggle button.

### 5.4 Device mode

Kevin: Customer Invoice Generation is "an admin and desktop job". Permissions do not know about device mode. The Field Tech template has `invoicing` = none, so techs never see it. Do not add a desktop-only rule here; if an office user with `invoicing` edit opens the app on a phone, the screen follows the existing mobile menu rules.

### 5.5 Database refusal messages

When the database refuses a write (row count 0 or a policy error), show "You don't have permission to do that" and log nothing sensitive. Review `sb.post/patch/delete` handlers: PATCH returns 0 rows with no error under row-level security, so a successful HTTP response with an empty result must be treated as a refusal where the app expects one row back.

## 6. QuickBooks gate

"App access no longer equals authorization to touch QuickBooks." The flag per module is `has_qb(module)` in the database and `canQB(module)` in the app.

1. **Today's QuickBooks-touching action** is the Zed Axis export: `confirmExport()` / `runExport()` (`app-core.js` ~L2614, ~L5926), the Exports screen and `export_history`.
   - App: the export buttons and the "Export N ready to Zed Axis" action require `canQB('exports')`.
   - Database: `export_history` insert requires `has_module('exports','edit') and has_qb('exports')`.
2. **Honest limit:** the export file is generated in the browser from data the user can already view. The database cannot stop someone with view access from reading that data; the flag controls the recorded export and any server-side QuickBooks call. Say this in the changelog.
3. **Any future direct-to-QuickBooks Edge Function** must call `has_qb(<module>)` for the caller before using QuickBooks credentials (use the caller's JWT, not the service role, for that check). Add a one-paragraph comment to `CLAUDE.md` saying so.
4. Modules that will use the flag later (`customers` create-in-QBO, `invoicing`, `vendors`, `quoted_billing`) need no code now; their flags exist from slice 2.

## 7. Settings split

### 7.1 Admin Settings

- Rename "Settings" to **Admin Settings** in the sidebar, the mobile menu and the page header. Admin template only; non-admins do not see the entry and `desktopNav('settings')` refuses them (5.2).
- All current tabs stay: General, Work Orders, Billing, Sites, GPS, Data, System, plus Alerts, Audit Log and Permissions (each also gated by its own module for the last three).
- Database enforcement already exists for writes (2.4). With 4.4, non-admins also lose anonymous reads. Logged-in reads of `settings` stay open because the whole app needs them (rates, thresholds, defaults).

### 7.2 My Settings (everyone, no module)

New entry in the sidebar and mobile menu, available to every active user:

| Item | Where stored | Notes |
|---|---|---|
| Default technician | this device (`dwo_default_tech`, as today) | Field Techs default to their own technician; admins can pick |
| Font size | this device (`dwo_font_size`, as today) | |
| **Barcode scanner formats** | **this device** (`dwo_barcode_formats`) | Kevin, 2026-11-08: device level, not company wide |
| My tracker ID | existing My Tracker ID flow (slice 1) | Link to it; no change |

Defaults and fallback for barcode formats: the device value if set, else the company value in `settings.barcode_formats`, else `CODE_128`. The company row stays in the database as the fallback default, but its editor leaves Admin Settings → System (comment out with a MOVED marker). Scanner code (`app-core.js` ~L5785 and ~L5852) reads through one function `getBarcodeFormats()` instead of `AppState.settings.barcode_formats`. `saveBarcodeFormat()` writes to the device store.

Confirmed by Kevin 2026-11-08: font size (and default technician, same storage today) stay **per device** in browser storage, not in the database. No new table.

## 8. NTE visible to technicians

Kevin, 2026-11-08: a tech must see in real time whether a work order is over its NTE limit, instead of waiting for billing.

- Field Tech has `wo_nte` = view.
- On the work order detail (mobile and desktop), for any user with `wo_nte` view, show a compact line using the **existing NTE calculation** in `app-wo-nte.js` (`woNteDraw`, `woNteRefresh`, `woNteBadgeSlot`): limit, amount used, remaining, and a red "Over by $X" state. Reuse; do not write a second calculation.
- It updates when hours or parts are added or changed, without leaving the screen.
- Edit/apply/reset controls require `wo_nte` edit and stay hidden for view.
- If the work order has no NTE, show nothing.
- Diagnose first: confirm that `work_order_limits` and the rate data the calculation needs are readable at `view` for a Field Tech (the calculation may read `hours_types`/`qbo_items`, which are in the all-users reference list). If it needs a table the template denies, stop and tell Kevin.

## 9. QC checks

Run as **Test Admin** and **Test User**. Database checks run in rolled-back transactions as each login (`set local role authenticated` + `set_config('request.jwt.claims', …)`); real writes only with Kevin's OK, on the Office Test Customer and a test work order. Claude cannot type passwords; Kevin signs in once in the built-in browser pane for any screen check.

**Step B (anonymous)**
1. As `anon`: row count is 0 on every table, `settings` included. (Set up by `close-anonymous-access.md`; re-verify here.)
2. The login screen shows the saved logo on a device that has signed in before, and the Dynamiq mark on a device that has not.
3. A GPS ping sent to the location receiver still lands in `location_event`.
3a. A Field Tech tags a new site in Field Travel Log: the site is created, and one `site_tagged_for_review` alert appears for the admin. A Field Tech cannot edit or delete an existing site.

**Step C (modules)**

| Check | Test Admin | Test User |
|---|---|---|
| Write company settings (logo, billing) | Allowed | Blocked, 0 rows |
| See Admin Settings, Users block, Permissions tab | Visible | Hidden, direct navigation refused |
| Change default technician, font size, barcode formats in My Settings | Allowed | Allowed |
| Permission grid opens and saves | Yes | Not reachable; writes to permission tables refused |
| Module with level `none` (e.g. `vendors`) | Visible | Hidden; `select` on `vendors` returns 0 rows |
| Module at `view` (e.g. `customers`) | Edit | Can read; insert/update refused; Add/Edit controls hidden |
| Module at `edit` (e.g. `work_orders`) | Edit | Can add hours and parts; edit-details and status moves back still admin-only |
| `bug_reports` | Sees all | Can submit; sees only their own; cannot change status |
| Sidebar and mobile menu smoke test | All items | Only Field Tech items, each opens without an error |

4. Per-user override: grant Test User `vendors` = `view` in the grid; Vendors appears, read-only, and the database allows the read; remove the override; it disappears again. (Real write on a test login.)
5. Jadyn's daily flow on his phone (Kevin): work orders, hours, parts, Field Travel Log, End of Day, Timecard, Truck Stock all still work. No new "no access" messages in normal use.
6. A GPS day review submits and loads for a Field Tech.
7. Deleting an hours entry from the Field Travel Log and from a work order still works for a Field Tech.
8. Quoted work order opens for a Field Tech without errors; customer-limit warnings are simply absent.
9. Dashboard for Test User shows only cards the template allows.
10. Inactive user: a deactivated login gets nothing (existing behavior still holds).
11. Anonymous or logged-out requests to any table return nothing (re-run the 4.4 check after step C).
12. Policy review: `select tablename, policyname, roles from pg_policies where schemaname='public'` shows no `public`/`anon` role except `settings_login_branding`, and no remaining `using (true)` write policy on a table in the 4.3 map.

**Step D (QuickBooks)**

13. Test Admin: Export to Zed Axis works and writes `export_history`.
14. Test User: export buttons are not shown; a direct insert into `export_history` is refused.
15. Admin users cannot be restricted, so test the flag on Test User: grant `exports` = `edit` with QuickBooks off → the export is refused with the permission message; turn QuickBooks on → allowed. (Real writes on a test login; clean up after.)

**Step E (Settings split)**

16. Sidebar and mobile menu show "Admin Settings" for admins only and "My Settings" for everyone.
17. Barcode formats set on one device do not change another device; a device with nothing set uses the company value, then Code 128.
18. Scanner still scans Code 128 invoices after the change.
19. Admin Settings → System no longer shows Barcode Scanner Formats.
20. NTE: a work order with a limit shows the limit line for Test User; adding hours past the limit turns it red without leaving the screen; Test User cannot open the NTE edit sheet.

## 10. Out of scope

- Request-and-approve queue for customer, site and equipment changes (own spec, later).
- Reporter-visible status and resolution for bug reports (logged in the Inbox, needs its own design).
- Row-level scoping (only your own records), per-field permissions, splitting sensitive settings (`default_margin`, rates) from the rest.
- New templates and user types; the `profiles.template` check constraint stays.
- Dropping `user_roles`.
- Device-mode (desktop only) rules.
- Moving default technician and font size into the database.

## 11. Decisions log

- 2026-11-08: Module list (23) and Field Tech template approved (see slice 2).
- 2026-11-08: Customer Invoice Generation is none for Field Tech.
- 2026-11-08: Sites/Locations view only for techs; changes need admin (queue is a later spec; until then techs cannot change sites).
- 2026-11-08: WO NTE visible to techs in real time (view).
- 2026-11-08: Technicians have no customer-create right for now; queue deferred.
- 2026-11-08: Barcode formats are per device, with the company value as fallback.
- 2026-11-08 (Claude): anonymous access to company data found. Kevin: fix it now. Moved into its own earlier spec, `close-anonymous-access.md`.
- 2026-11-08: no exception for the login screen. Company name and logo are saved on the device and the Dynamiq mark is the default; the database serves nothing to logged-out visitors.
- 2026-11-08: font size per device. Default technician per device (same storage; Claude kept it with font size).
- 2026-11-08: techs can tag a new site in Field Travel Log; an admin reviews it (interim: alert in the Alerts center, true approval queue later).
- 2026-11-08 (Claude): QuickBooks flag limit stated honestly (file is made in the browser).
