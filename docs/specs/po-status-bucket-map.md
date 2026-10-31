# Spec: PO Billed/Pending Status Mapping

Oct 30, 2026 · @Kevin

## Problem

A work order marked Invoiced Outside DWO (status 15) still counts as Pending against its customer PO, never Billed. The `po_ledger` view (v4.99) counts a work order as billed only when `status = 12` (Invoiced) and counts every other status as pending, Cancelled included.

Two JS spots hardcode the same rule:

- `app-po-tracker.js` line 251: the "Pending from:" list filters `status !== 12`.
- `app-po-edit.js` line 101: the "already INVOICED" unlink warning fires only for `status === 12`.

The PO edit screen's work order table shows each work order's status badge but nothing that says whether its dollars count as billed or pending.

## Decision

The PO module gets its own status-to-bucket map. Every work order status is assigned exactly one bucket, chosen with a single-select (radio) per status:

- **Billed**: committed and invoiced; counts toward the PO's Billed amount.
- **Pending**: logged against the PO but not yet billed; counts toward Pending.
- **Not counted**: excluded from both (Cancelled).

The map lives entirely inside the PO module. Status categories (draft, active, completed, processed, cancelled) and the rest of the app are not touched. A status with no map row, such as one added later, counts as Pending until it is set.

## Defaults

Only three rows are stored (the migration seeds them); every other status has no row and counts as Pending. Only Invoiced and Invoiced Outside DWO are Billed, only Cancelled is Not counted, and everything else stays Pending, which matches how the module counts today except for Cancelled.

| # | Status | Default bucket |
| --- | --- | --- |
| 0 | Approval Request | Pending |
| 1 | Quote Request | Pending |
| 2 | Quoted | Pending |
| 3 | Parts to be Ordered | Pending |
| 4 | In Research | Pending |
| 5 | Parts Ordered | Pending |
| 6 | Work Ready | Pending |
| 7 | In Progress | Pending |
| 8 | Entry Work Needed | Pending |
| 9 | Recheck Job | Pending |
| 10 | Completed | Pending |
| 11 | Batch Invoice Process | Pending |
| 12 | Invoiced | Billed |
| 15 | Invoiced Outside DWO | Billed |
| 99 | Cancelled | Not counted |

## Changes

**1. Database** (new migration under `supabase/migrations/`, applied before the JS is deployed)

- New table `po_status_bucket` with `system_key` (text, primary key, matches wo\_statuses.system\_key) and `bucket` (`billed`, `pending` or `none`), plus modified\_at and modified\_by. Admin-only RLS, same pattern as `purchase_orders`, and the generic audit trigger so changes show in the Audit Log. Seeded with three rows only: invoiced and invoiced\_outside as billed, cancelled as none. Every other status has no row and counts as pending.
- `po_wo_breakdown` is recreated with one new column appended at the end, `bucket`: the work order's status mapped through wo\_statuses.system\_key to `po_status_bucket`, defaulting to `pending` when there is no row. Existing columns keep their order, as in v5.05.
- `po_ledger` sums `billed` where `bucket = 'billed'` and `pending` where `bucket = 'pending'`. `none` falls into neither, so Cancelled work orders no longer reduce a PO's Remaining.

**2. PO module tab** (new file `app-po-status-map.js`, plus a tab strip added to the PO panel)

The PO panel (admin-only, the same screen that lists the customer POs) gets a tab strip at the top with two tabs: Purchase Orders, which is today's list unchanged, and Status buckets. The active tab is kept in a module variable, so the panel stays on the same tab when it re-renders after a PO edit. Nothing is added to the app-wide Settings screen. One row per status from the live status list in sort order, with three radio buttons (Billed, Pending, Not counted). A change saves immediately, shows a toast, and reloads the PO ledger.

**3. Existing code**

- `app-po-tracker.js` line 251: filter on `b.bucket === 'pending'` instead of `b.status !== 12`.
- `app-po-edit.js` line 101: warn when `b.bucket === 'billed'`, with wording changed from "INVOICED" to "billed".
- Confirm during the build that the breakdown load in `poLoadAll` selects all columns so `bucket` comes through.

**4. PO edit screen**

The work order table gets a "Counts as" column showing Billed, Pending or Not counted from `b.bucket`. Not counted rows show their amount in muted text.

**5. Housekeeping** (per CLAUDE.md)

`git fetch` first, bump `APP_VERSION` from the real current version and the cache busters, add a CHANGELOG line, run `node --check` on every changed JS file, commit as `v[X.XX]: ...`. Note any deviation from this spec in the changelog entry.

## Test plan

1. Before the migration, note the outside-DWO PO's Pending and Billed amounts.
2. After the migration and reload, that PO's dollars move from Pending to Billed. Remaining does not change, because it uses billed plus pending.
3. Link a Cancelled work order that has billable lines to a PO: its amount drops out of Pending and Remaining goes up.
4. On the Status buckets tab, switch Invoiced Outside DWO to Pending, reload, and confirm the PO flips back. Set it to Billed again.
5. On the PO edit screen, each work order shows the right "Counts as" label, and unlinking an outside-DWO work order now shows the billed warning.
6. Compare the work order's total to the real invoice amount for the outside-DWO PO. If the work order has no quoted invoice row, its total can be lower than what was billed.

## Out of scope and caveats

- Status categories, invoice generation, Zed Axis export and the work order status flow are unchanged.
- Draft statuses stay Pending, as they are today. Any status can be switched in Settings later without a code change.
- The PO lifecycle statuses (created, in progress, completed, cancelled) and their rules are unchanged.
- The live status table in Supabase can differ from the fallback list in `app-core.js`. The Status buckets tab reads the live table, not the fallback. Removing the fallback list from app-core.js is Part B of this build.
- This spec is not yet in `docs/specs/` in the repo. Copy it there before the build, since Claude Code reads specs only from that folder.

## Part B: Retire the status fallback list

The hardcoded `STATUSES_FALLBACK` list in `app-core.js` (line 10) is stale: Parts Ordered and Work Ready are `active` in the live `wo_statuses` table but `draft` in the fallback. It only applies when Supabase fails to load and there is no local cache, and in that case it would show out-of-date statuses. Statuses already load from `wo_statuses` and are cached locally.

- Comment out the 15 status rows with a `/* MOVED ... */` note per CLAUDE.md, and keep `var STATUSES_FALLBACK = [];` so the declaration stays.
- Do not remove the declaration. Seven lines reference it (30, 691, 696, 701, 1176, 2266, 5372 in `getStatus`, `getStatusByKey`, `loadStatuses`, the status-change dropdown, the status filter options and the Settings status table) and would throw a ReferenceError if the status list were ever empty.
- No other code changes. The duplicate `getStatus` definition (lines 29 and 695) is left alone.
- Behaviour change: with a failed load and no cache, status lists are empty and names show as plain numbers, instead of showing the old hardcoded list.

**Test:** with statuses loaded normally, the status-change dropdown, the status filter, the Settings status table and the status badges on the work order grid all look exactly as before.

One build covers both parts: one version bump and one CHANGELOG entry that lists Part A and Part B separately.

## Watch list: if something breaks, look here

A cheat sheet of what this build changed and what could go wrong later. Add a row whenever a build or a bug fix finds a new one.

| Part | Symptom | Likely cause | Where to look |
| --- | --- | --- | --- |
| A | PO totals show zero for every PO, or the PO panel errors | The new `po_status_bucket` table is missing a policy or a select grant. The views run as the caller (`security_invoker`), so the table needs its own access rules. | RLS policy and grants on `po_status_bucket`, in the migration file |
| A | "Counts as" column is blank and the "Pending from:" list is empty | The JS was deployed before the migration, so the rows have no `bucket` column | Apply the migration, then reload. Check `po_wo_breakdown` has a `bucket` column |
| A | Migration fails with a view column error | `po_wo_breakdown` was recreated with columns reordered. New columns must go at the end, as in v5.05. | The `create or replace view` statement |
| A | A PO suddenly flips back to Pending | A status's `system_key` was changed or removed in Settings, so it no longer matches its bucket row and falls back to Pending | `wo_statuses.system_key` against `po_status_bucket.system_key` |
| A | A work order that was billed disappears from the PO | The view joins `wo_statuses` with an `active` filter and the status was deactivated. The join should not filter on `active`. | The view's join to `wo_statuses` |
| A | A PO's Remaining went up | Expected: Cancelled work orders no longer count against the PO | The work order's status and the Status buckets tab |
| A | A billed amount changes after the invoice went out | Billed is calculated live from line items, hours and quoted invoices. It is not a frozen snapshot, so edits to a billed work order's lines change the PO. | `line_items`, `hours_entries`, `quoted_invoices` for that work order |
| A | A billed amount is lower than the real invoice | The work order has no `quoted_invoices` row or is missing lines. A quoted work order with no lines totals $0. | `po_wo_breakdown.wo_total` against the invoice |
| A | Status buckets tab is missing | `app-po-status-map.js` did not load, often a missing script tag or an old cache buster | `index.html` script tag and the cache buster version |
| A | Tab strip jumps back to Purchase Orders | The active tab lives in a module variable, so a full page reload resets it. After a PO edit it should stay. | The panel re-render path in `renderPOPanel` |
| B | Status names show as plain numbers and the dropdowns are empty | The Supabase load failed and there is no local cache, so the fallback is now empty | `loadStatuses()` and the `wo_statuses` request in the browser network tab |
| B | ReferenceError mentioning `STATUSES_FALLBACK` | The declaration was removed instead of kept as an empty array | Line 10 of `app-core.js` should be `var STATUSES_FALLBACK = [];` |
| B | Status badge shows the wrong name or colour | `getStatus` is defined twice (lines 29 and 695) and the later one wins | Both definitions in `app-core.js` |
