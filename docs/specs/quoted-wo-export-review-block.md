# Spec: Quoted Work Orders Bill Only From Quoted Billing

Nov 4, 2026 · @Kevin

## Problem

A quoted work order bills one milestone at a time from the Quoted billing queue (`qbExport` in `app-quoted-billing.js`). Each milestone becomes its own invoice: one header row and one quoted line carrying the milestone's description and amount, with a suffix that counts up per milestone (`-00` first, `-01` second, and so on, from the work order's `invoice_suffix_count`).

The older Export Review screen (Desktop Review, "Export N ready to Zed Axis") still accepts quoted work orders and sends them through `runExport` in `app-subforms.js`, which:

- sends every active milestone row as a quoted line in one export, whether it is pending, ready or already billed, so a customer can be billed for future or already-billed milestones;
- gives every row the same suffix (the current counter) and then bumps the counter by one, so the `-00`, `-01` sequence breaks;
- offers an "Export anyway" button that skips the review checks.

v5.22 already keeps quoted hours, parts and credits out of this export. This spec closes the rest of the gap.

## Decision

Quoted work orders can only be billed from the Quoted billing queue. The Export Review screen and `runExport` do not export them.

## Changes

**1. Export Review screen** (`app-core.js`, the row status logic near line 2508 and `renderExportReviewGrid`)

- A quoted work order is shown as blocked, with the label "Quoted: bill from Quoted billing".
- No "Export anyway" and no "Add hours / Add quote" buttons on that row. One button, "Open Quoted billing", goes to the Quoted billing queue (`qbGoToInvoicing`, the same call "Bill now" uses; confirm it exists before using it).
- The row still shows in the list and in the invoice preview, so the work order is not silently dropped from a selection.
- A mixed selection exports the T&M work orders and leaves the quoted ones out. The "Export N ready" count excludes quoted rows.

**2. `runExport`** (`app-subforms.js`), as a backstop that "Export anyway" or any other caller cannot bypass

- Quoted work orders are removed from the list before anything is built, with a toast: "Quoted work orders bill from Quoted billing" (naming the work order numbers skipped).
- If nothing is left, stop with that toast and do not build a file.
- The v5.22 filter on hours and parts becomes redundant. Comment it out with a `/* MOVED ... */` note per CLAUDE.md rather than deleting it, and record in the changelog that the quoted-row export in `runExport` (`s4`) is no longer reachable for quoted work orders.

**3. Not changed**

- `qbExport` and its suffix logic.
- The T&M invoice run in `app-invoice-gen.js` (`invIsReady` already excludes quoted work orders).
- The PO view from v5.22.

## Housekeeping (per CLAUDE.md)

`git fetch` first. Bump `APP_VERSION` from the real current version and the cache busters, add a CHANGELOG line, `node --check` on every changed JS file, commit as `v[X.XX]: ...`. Note any deviation from this spec in the changelog entry.

## Test plan

1. Select a quoted work order in Export Review: it shows blocked with "Quoted: bill from Quoted billing", no "Export anyway", and "Open Quoted billing" opens the queue.
2. Select a quoted and a T&M work order together: only the T&M one is counted and exported; the quoted one's counter and status do not change.
3. Call the export for a quoted work order only (including via "Export anyway" on an older row): no file is built and the toast appears.
4. In the Quoted billing queue, export two milestones of the same work order: they get `-00` and `-01`; the next one gets `-02`.
5. T&M export looks exactly as before.
6. Check any quoted work order that was never set up with milestones (older data): confirm it appears in the Quoted billing queue and can be billed from there. If it does not, tell Kevin before building.

## Out of scope and caveats

- Older quoted work orders with a single quoted line and no milestone setup are billed from the queue after "Set up milestones" or "Mark ready to bill". Spec step 6 checks that none are stranded.
- Counting individual milestones as billed or pending against a PO is a separate follow-up spec (see `quoted-wo-totals.md`).
- The Send Report pricing total and the $0 totals bar after editing an entry on a quoted work order are separate open items.

## Watch list: if something breaks, look here

| Symptom | Likely cause | Where to look |
| --- | --- | --- |
| A quoted work order still exports from Export Review | The block is only in the screen, not in `runExport`, or a caller passes the list another way | The quoted filter at the top of `runExport` |
| "Open Quoted billing" does nothing | `qbGoToInvoicing` missing or renamed | `app-quoted-billing.js` near `qbBillNow2` |
| A quoted work order cannot be billed from anywhere | It has no milestones or none are ready | Quoted billing panel on the work order, milestone statuses |
| Suffix numbers skip or repeat | `invoice_suffix_count` was changed by the old path before this build | `work_orders.invoice_suffix_count` against exported milestones |
