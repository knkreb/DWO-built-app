# Spec — Operational Audit Trail

**Base:** v4.88 · **Written:** 2026-09-28 · **Status:** awaiting Kevin's review

> Claude Code: read this whole file before touching code. Do not write or deploy anything until Kevin says the exact phrase **"okay to build"**. Diagnose first (SQL, then code). Run `node --check` on every JS file before shipping (or the browser-based parse check if node isn't available on the machine). Bump `APP_VERSION` and cache busters.

---

## 1. Goal

Audit every meaningful create/edit/deactivate across essentially all business tables — not just work orders/hours/line items — using one reusable trigger, and give the existing Audit Log tab (built in Slice 1) real search: free text, date range, and a module filter, so a growing log stays usable instead of just an endless scroll.

Kevin's own framing: track it all now, accept that the table will grow, decide on retention/pruning later once we've seen real growth. This spec does not address retention.

## 2. Current state (checked 2026-09-28)

Only two tables write to `audit_log` today, both **update-only**, both hand-written per-field:

| Table | Trigger | Fields tracked |
|---|---|---|
| `day_review` | `day_review_audit` | `clock_in`, `clock_out` |
| `line_items` | `line_items_audit` | `cost`, `qty`, `active` |

Everything else has a `trg_*_modified` trigger that only stamps `modified_at`/`modified_by` on the row itself — it never writes to `audit_log`. Creates and deletes aren't audited anywhere, on any table. `profiles` and `alerts` are audited separately via app-side/Edge-Function calls (Slice 1), with more readable named actions.

## 3. Table scope

Full inventory pulled 2026-09-28 (row counts as of that date):

**In scope — gets the generic trigger:**
`work_orders` (148), `hours_entries` (243), `line_items` (329), `tasks` (5), `task_assignments` (4), `task_steps` (0), `task_templates` (0), `task_template_steps` (0), `customers` (225), `customer_contacts` (8), `customer_contact_roles` (14), `vendors` (253), `technicians` (3 — tid changes already covered by Slice 1; this adds every other field), `locations` (190), `hours_types` (4), `qbo_items` (7), `quoted_invoices` (3), `wo_flags` (4), `wo_statuses` (15), `settings` (31), `contact_role_types` (5), `bug_reports` (8), `bug_report_statuses` (3), `dispatch_assignments` (1), `day_breaks` (0), `punch_event` (0), `time_entry` (0), `week_submission` (0), `tech_schedule` (0), `equipment_status_types` (0), `exit_interview_actions` (0), `exit_interview_responses` (0), `exit_interview_templates` (0), `flag_rules` (0), `time_block` (0).

**Excluded, with reasons:**
- `audit_log` — would recurse on itself.
- `profiles` — already audited with more readable named actions (`create`, `deactivate`, `tid_change`, etc.) via the Slice 1 Edge Function; a generic trigger on top would double-log every change.
- `alerts` — same reasoning; already has its own status-change trigger (`alerts_audit_status`).
- `user_roles` — retired in Slice 1; nobody should be writing to it.
- `location_event` — **214,022 rows** of raw GPS pings (lat/lng/timestamp every few seconds). Not something a person "edits" — auditing it would add 200,000+ rows for zero value.
- `export_history`, `vendor_export_history`, `vendor_import_history` — already history logs of their own; auditing a log is redundant.

## 4. One reusable trigger function

A single generic function, `audit_row_changes()`, attached to each in-scope table via `CREATE TRIGGER`, rather than one hand-written trigger per table (the old pattern doesn't scale to `work_orders`' 30+ columns for full coverage).

Key properties:
- **Works even on tables without `modified_by`/`created_by`** (e.g. `settings` has neither) — reads them dynamically via `to_jsonb(NEW) ->> 'modified_by'` rather than a static column reference, so it never fails to compile on a table missing that column. Falls back through `auth.email()` → `modified_by` → `created_by` → `'system'`.
- **Resolves a `context` label** for cross-table search: for any table with a `work_order_id` column, looks up that WO's `wo_number` at write time; for `work_orders` itself, its own `wo_number`; otherwise the table's own configured "label" column (customer name, vendor name, etc.).
- **Insert** → one summary row (`action = 'create'`), not one row per populated column.
- **Soft-delete** (`active` flips `true → false`) → one summary row (`action = 'deactivate'` / `'reactivate'`), not also a plain `active` field-change row.
- **Field edits** → one row per changed field, `action = 'update'` (generic — no per-table named actions like `status_change`/`claim`/`complete`, confirmed with Kevin as unnecessary for now).
- **jsonb blob columns** (`billing_increments`, `billed_increments`, `recurrence`) are tracked as opaque JSON text (confirmed with Kevin) — not broken into a readable description, but still searchable.

```sql
alter table public.audit_log add column context text;
create index audit_log_search_idx on audit_log using gin (
  to_tsvector('simple', coalesce(context,'') || ' ' || coalesce(old_value,'') || ' ' || coalesce(new_value,'') || ' ' || coalesce(field_name,'') || ' ' || coalesce(changed_by,''))
);

create or replace function public.audit_row_changes()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  who text := coalesce(auth.email(), to_jsonb(NEW)->>'modified_by', to_jsonb(NEW)->>'created_by', 'system');
  label_col text := TG_ARGV[0];
  wo_fk_col text := TG_ARGV[1];        -- e.g. 'work_order_id', or '' if none
  exclude_cols text[] := string_to_array(TG_ARGV[2], ',');
  ctx text;
  key text;
  old_val text; new_val text;
begin
  if TG_TABLE_NAME = 'work_orders' then
    ctx := to_jsonb(NEW) ->> 'wo_number';
  elsif wo_fk_col <> '' then
    select wo_number into ctx from work_orders where id = (to_jsonb(NEW) ->> wo_fk_col)::uuid;
  else
    ctx := to_jsonb(NEW) ->> label_col;
  end if;

  if TG_OP = 'INSERT' then
    insert into audit_log (table_name, record_id, action, field_name, old_value, new_value, changed_by, changed_at, context)
    values (TG_TABLE_NAME, NEW.id, 'create', null, null, to_jsonb(NEW) ->> label_col, who, now(), ctx);
    return NEW;
  end if;

  if OLD.active is distinct from NEW.active then
    insert into audit_log (table_name, record_id, action, field_name, old_value, new_value, changed_by, changed_at, context)
    values (TG_TABLE_NAME, NEW.id, case when NEW.active then 'reactivate' else 'deactivate' end, null, null, null, who, now(), ctx);
  end if;

  for key in select jsonb_object_keys(to_jsonb(NEW)) loop
    if key = any(exclude_cols) or key = 'active' then continue; end if;
    old_val := to_jsonb(OLD) ->> key;
    new_val := to_jsonb(NEW) ->> key;
    if old_val is distinct from new_val then
      insert into audit_log (table_name, record_id, action, field_name, old_value, new_value, changed_by, changed_at, context)
      values (TG_TABLE_NAME, NEW.id, 'update', key, old_val, new_val, who, now(), ctx);
    end if;
  end loop;
  return NEW;
end $$;
```

One `create trigger` per included table, e.g.:
```sql
create trigger audit_work_orders after insert or update on public.work_orders
  for each row execute function public.audit_row_changes('wo_number', '', 'id,created_at,created_by,modified_at,modified_by,deleted_at,deleted_by,export_count');

create trigger audit_hours_entries after insert or update on public.hours_entries
  for each row execute function public.audit_row_changes('descriptor', 'work_order_id', 'id,created_at,created_by,modified_at,modified_by,reconciled_at,reconciled_by');
```
Build step: write one `create trigger` statement per table in §3's "in scope" list, each with its own label column, WO-FK column (or `''`), and exclude list (always includes the plumbing columns: `id,created_at,created_by,modified_at,modified_by,deleted_at,deleted_by` plus any table-specific noisy columns like `export_count`, `reconciled_at/by`).

Before attaching: confirm every included table actually has an `id uuid` primary key (expected from the schema pulled 2026-09-28, but verify at build time since the trigger assumes `NEW.id` exists).

## 5. Audit Log tab: search and filters

Builds on what Slice 1 already left ready for this (its own note: "the list query is built from a filter object so who/what/date filters plug in later as UI only").

- **Free text box** — matches `context` (resolved WO/customer/vendor label), `changed_by`, `field_name`, `old_value`, `new_value` via the full-text index above. Typing a WO number, a customer name, a technician's email, or a changed value all work in the same box.
- **Date range** — From / To date pickers.
- **Module dropdown** — "All" or one specific table, labeled in plain English ("Work Orders", "Hours Entries", ...).
- **Action dropdown** — All / Create / Update / Deactivate / Reactivate.
- Same "50 per page, Load more" pagination as today, scoped to the active filters.

## 6. Out of scope

- Retention/pruning of old audit rows — explicitly deferred per Kevin; revisit once real growth is visible.
- Per-table named actions (`status_change`, `claim`, `complete`) instead of generic `update` — confirmed not needed for now.
- Turning jsonb blob fields into readable descriptions instead of opaque JSON — confirmed not needed for now.
- Any UI beyond the Settings → Audit Log tab (e.g. a "history" link from the WO detail screen) — not requested; the free-text search covers finding a WO's history for now.

## 7. QC checklist

1. Create a work order → one `create` row with `context` = its own wo_number.
2. Add an hours entry to it → one `create` row with `context` = that WO's number (proves the FK lookup works).
3. Search the Audit Log free-text box for that WO number → both rows show up.
4. Edit a setting (e.g. timezone) → one `update` row, `changed_by` correct even though `settings` has no `modified_by` column.
5. Deactivate a customer → one `deactivate` row, not also a plain `active` field row.
6. Filter by module = "Hours Entries", date range = today → only today's hours entry changes show.
7. A direct SQL edit (bypassing the app) still gets audited with the right `changed_by` from the session, or `'system'` if none.
8. Edit `work_orders.billing_increments` → one `update` row with the raw JSON in old/new value (opaque, not decoded).
9. `location_event`, `profiles`, `alerts`, `user_roles` confirmed to have no new trigger — no double-logging, no 214,000-row flood.
10. Existing Slice 1 Audit Log entries (profiles/alerts related) still display correctly alongside the new rows.
