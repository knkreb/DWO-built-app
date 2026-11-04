# Spec: Quoted Work Orders Hold the Quoted Price

Nov 4, 2026 · @Kevin

## Problem

When a work order is quoted, the quoted amount should be the billed amount. Parts and labor entered on it are internal cost tracking only. Today they are added on top.

Example: a $1,000 quote with $50 in parts and $250 in labor shows $1,300 on the Customer PO screen.

Two places add them up without checking the billing type (`form_mode`):

- **Part A, the PO screen.** The `po_wo_breakdown` view (v5.20 migration) sets each work order's `wo_total` to billable parts + billable labor + quoted lines, for every work order. That `wo_total` feeds the "Work orders on this PO" amounts, "Pending from:", and the PO's Pending and Remaining in `po_ledger`.
- **Part B, the Zed Axis export.** `runExport` in `app-subforms.js` writes hours rows, parts rows and billing lines for quoted work orders as well as the quoted rows, so the import can bill the customer for both.

Converting T&M to Quoted (`saveWO`) only changes `form_mode`; entries are left alone. That is correct and does not change.

## Decision

- A quoted work order counts and bills only its quoted lines.
- A T&M work order counts and bills only its hours and parts.
- Parts and labor on a quoted work order stay in the app as cost (the Quoted billing panel already uses them for the cost-to-quote warning). They are never added to a billed or pending amount.

## Part A: PO view (SQL, one step)

New migration `supabase/migrations/v[X.XX]_po_wo_breakdown_quoted.sql`:

- `create or replace view public.po_wo_breakdown` with the same columns in the same order as v5.20 (`work_order_id, wo_number, purchase_order_id, status, wo_total, title, customer_id, bucket`). Only the `wo_total` expression changes.
- `wo_total` when `w.form_mode = 'quoted'` = the work order's quoted amount (`work_orders.quoted_amount`); if that is not set, the sum of its active `quoted_invoices.amount` rows. Otherwise (T&M) billable `line_items.sell_total` + billable `hours_entries.line_total`, as today.
- A quoted work order is still billed or pending as a whole, by its status bucket, exactly as today. Counting individual milestones as billed or pending is a separate follow-up spec (see Out of scope).
- `po_ledger` is unchanged; it reads `wo_total`.
- Behavior change: a T&M work order that still has leftover quoted lines no longer counts them.
- No app JS changes expected. If the live view differs from the v5.20 file, stop and tell Kevin before applying.
- Diagnose first (CLAUDE.md): read the live view definition and the PO's numbers before the change, then one step at a time.

## Part B: Zed Axis export (JS)

In `runExport` (`app-subforms.js`), for work orders where `form_mode === 'quoted'`:

Decided 2026-11-04: parts, time and the like must never appear on a quoted invoice; they are internal reference only. So for a quoted work order the export leaves out:

- hours rows (`s2`),
- parts and service rows (`s3`),
- the vendor-credit marker row (`s5`),
- hours and parts rows in the billing lines sheet (`s6`).

What stays for a quoted work order: its header row (`s1`) and its quoted rows (`s4`). T&M work orders export exactly as today, including truck stock.

## Housekeeping (per CLAUDE.md)

`git fetch` first. Bump `APP_VERSION` from the real current version and the cache busters, add a CHANGELOG line (Part A and Part B listed separately), `node --check` on `app-subforms.js`, commit as `v[X.XX]: ...`. Note any deviation from this spec in the changelog entry.

## Test plan

1. Create a T&M work order on a PO with $50 parts and $250 labor. Note the PO's Pending.
2. Convert it to Quoted with a $1,000 quote and milestones. PO screen row shows $1,000; PO Pending moves by the difference, not by $1,300.
3. Add more parts and hours to the quoted work order. The PO amount does not change.
4. Convert a quoted work order back to T&M. The row shows hours + parts only.
5. Export a quoted work order and a T&M work order together. Quoted work order's customer billing total is the quote only; T&M is unchanged.
6. P26462 (Capital Expense Account) on PO 163114: its amount matches its quote.

## Out of scope and caveats

- The Send Report pricing report (`app-reports.js`) totals labor + materials for any work order, so a quoted job shows only the cost. Flagged for Kevin; not part of this build.
- After editing an entry on a quoted work order, the live totals bar shows $0 (`app-core.js` line 1944) while the main calculation uses the milestone total. Flagged; not part of this build.
- **Follow-up spec, decided 2026-11-04:** milestones count per row against the PO. Billed and paid milestones count as billed; pending and ready milestones (including exported, awaiting acceptance) count as pending; a quoted work order with no milestones counts its quoted amount as pending. This changes how `po_ledger` splits one work order across billed and pending, and the "Counts as" column and unlink warning on the PO edit screen. It is the open item in `docs/handoff-quoted-billing-v5.02.md` (item 1). Not part of this build.
- This spec is not yet in `docs/specs/` in the repo. Copy it there before the build, since Claude Code reads specs only from that folder.

## Watch list: if something breaks, look here

| Part | Symptom | Likely cause | Where to look |
| --- | --- | --- | --- |
| A | Migration fails with a view column error | `po_wo_breakdown` columns reordered or renamed | The `create or replace view` statement against v5.20 |
| A | A quoted work order shows $0 on the PO | It has no quoted amount and no active `quoted_invoices` rows | `work_orders.quoted_amount` and `quoted_invoices` for that work order |
| A | A PO total drops after the change | Quoted work orders were counted at cost plus quote before; now quote only | Compare to the work order's quote |
| B | Customer billed for the quote and the parts | A quoted work order's hours or parts rows still reach `s2`, `s3` or `s6` | The `form_mode === 'quoted'` check in each `runExport` loop |
| B | A quoted job's cost is missing in the export | By design: quoted hours and parts are no longer exported. Cost stays in the app (Quoted billing panel). | Quoted billing panel in the work order |
