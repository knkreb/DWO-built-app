# Handoff: PO status bucket map (v5.20), 2026-10-31

Read this first in a new session. Read CLAUDE.md too: **never build or deploy unless Kevin says the exact phrase "okay to build"**, and build only what the spec lists.

## State

- Branch `claude/eloquent-cannon-mbce03`, PR [knkreb/DWO-built-app#17](https://github.com/knkreb/DWO-built-app/pull/17) into `main`. Not merged at the time of writing; check `main` and `APP_VERSION` in `app-core.js` before building anything (this build is 5.20).
- Spec: `docs/specs/po-status-bucket-map.md` (Part A PO billed/pending map, Part B retire the status fallback). One build, one version, one CHANGELOG entry.
- Migration `supabase/migrations/v5.20_po_status_bucket.sql` is **already applied to the live database** (2026-10-31). Nothing to run.

## What shipped

- **Part A:** table `po_status_bucket` (`system_key` primary key, `bucket` billed/pending/none; seeded `invoiced` and `invoiced_outside` billed, `cancelled` none; every other status has no row and counts as Pending). `po_wo_breakdown` has `bucket` as its last column. `po_ledger` sums billed and pending by bucket. New `app-po-status-map.js` owns the PO panel tab strip and the Status buckets tab. `app-po-edit.js` has the "Counts as" column and the billed unlink warning.
- **Part B:** `STATUSES_FALLBACK` rows in `app-core.js` commented out; `var STATUSES_FALLBACK = [];` kept (seven references still use it).

## Deviations from the spec

1. `po_status_bucket` has an extra `id uuid` column (unique). `audit_row_changes()` writes `NEW.id` into `audit_log.record_id` (uuid), so the audit trigger would fail without it. `system_key` is still the primary key.
2. The `app-po-tracker.js` line 251 change (`b.status !== 12` to `b.bucket === 'pending'`) was not made: that "Pending from:" block was already commented out in v5.05. If the spec is reused, drop that line from it.

## What was verified

- Live SQL after applying: PO 173171 (one Invoiced Outside DWO work order) moved $15,610.00 from Pending to Billed; PO 163114 unchanged at $21,819.54 pending. Seeded map and column order confirmed.
- `node --check` on `app-core.js`, `app-po-tracker.js`, `app-po-edit.js`, `app-po-status-map.js`. Save logic of the new module checked in node with a stubbed `sb`.
- Kevin reports it looks okay from his own testing of the deployed app (no detail recorded here).

## Not verified

- Spec test step 3 (a Cancelled work order with billable lines linked to a PO drops out of Pending and Remaining goes up): no live PO has one yet.
- Spec test steps 4 to 6 (flip Invoiced Outside DWO to Pending and back, "Counts as" labels, billed unlink warning, work order total against the real invoice) were not run by Claude.
- The JS has not been run by Claude in a browser or against live Supabase.

## Watch list

The spec's own watch list (end of `docs/specs/po-status-bucket-map.md`) applies. Most likely first suspects: missing grant or policy on `po_status_bucket` (PO totals all zero), a status's `system_key` changed in Settings (PO flips back to Pending), script cache buster (`app-po-status-map.js?v=1`) if the Status buckets tab is missing.

## Open items (outside this spec, not started)

1. **Quoted partial billing vs the ledger.** `po_wo_breakdown.wo_total` still adds all active `quoted_invoices` rows, whatever their milestone state; v5.20 only changed which bucket a work order falls in. This is open item 1 in `docs/handoff-quoted-billing-v5.02.md` and v5.20 does not resolve it.
2. **No status change guard.** Deactivating a status or changing its `system_key` in Settings silently drops it to Pending on POs. A warning in Settings would prevent this; not specced.
