# DWO Spec: Customer Invoice Generation Workflow

Date: 2026-10-04 (revised after Kevin's review answers)
Status: DRAFT for Kevin's review. Do not build until Kevin says "okay to build".
Related: Customer Invoice Generation module (sidebar), Zed Axis export, Field Travel Log day_review gate, Work Orders module, Daily Dashboard.
Code reviewed: repo knkreb/DWO-built-app at v4.93.

## 1. Goal and scope

Move invoice generation into DWO as a guided, resumable workflow that makes sure nothing is skipped without a warning: review stale work orders, check that data is current, coalesce time and materials, review line items, export, and positively confirm the export. The work order is the single source of truth.

**In scope for this build: the Zed Axis path only.** The direct-to-QBO connection has not been built yet, so Zed Axis stays the export until the QBO module is done. Sections 9 and 10 hold the QBO, PDF archive, Microsoft Graph and customer email design as FUTURE work. They are not part of this build and stay on the open register.

Existing code to reuse, not rebuild: `showExportReview` and `exportReviewOverride` (app-core.js) for the per-work-order readiness review and override, and `runExport` (app-subforms.js) for building the Zed Axis file.

**Customization rule (applies to the whole build):** nothing in this build may depend on a status number, status name, flag display name, or color, since all of those are editable in Settings. Statuses are found by `system_key` or category, flags by `system_key` (and their matching `flag_<system_key>` columns), never by what they are called. If a status a role depends on has been retired or is missing, show a clear setup warning instead of failing silently or breaking.

## 2. Status model

Chain: `10-Completed` -> `11-Batch Invoice Process` (key `batch_invoice`) -> `12-Invoiced`.

- Statuses are DATA, not code: they live in the `wo_statuses` table (num, name, color, category, system_key, mobile, sort_order) and are editable in Settings. The numbers 10, 11, 12 in this spec are today's labels only. The build must find statuses by CATEGORY (draft, active, completed, processed, cancelled) or by `system_key` (existing code already uses `batch_invoice` and `invoiced`), never by number.
- Kevin is retiring unused statuses recycled from the old program. Retiring must leave one status for each role this workflow relies on. Verified in the live `wo_statuses` table (all 15 rows active, every row has a `system_key`): ready to bill = `completed` (category completed); in-run = `batch_invoice`; done = `invoiced`; `invoiced_outside` (Invoiced Outside DWO); `cancelled`; and the multi-bill return target = `in_progress`. The other active-category keys are `entry_work_needed` and `recheck_job`; draft keys are `approval_request`, `quote_request`, `quoted`, `parts_to_order`, `in_research`, `parts_ordered`, `work_ready`. The in-progress review uses the active CATEGORY, so it follows whichever active statuses remain.
- Note from the live database (checked 2026-10-04): 37 work orders were in `batch_invoice`. Kevin is clearing these himself before the build, so the new batch counter should start near zero.
- Hardcoded numbers found in v4.93 that must be replaced with lookups: the multi-bill return to status 7 (app-subforms.js `runExport`), the Truck Stock work order created with status 10 (app-core.js), and the name-to-number map in the DWO Excel import (`statusMap` in app-subforms.js). Renumbering or retiring statuses would break these.
- Starting a run moves all in-scope work orders from 10 to 11 immediately. (Today the move to 11 happens only at export; this changes it to run start.)
- 11 is transitional and in-flight, NOT final. The work order is not yet committed as invoiced.
- While in 11, the work order is locked so that EVERYONE ELSE cannot edit or change it while invoicing is in progress. The person running the invoice generation can still edit it. Status 11 is already hidden from mobile. The run records who started it (section 4), and edits to work orders in 11 are blocked for any other user.
- Scope selection takes status 10 only, excluding 11 and 12, which prevents duplicate invoicing.
- **Zed Axis has no feedback loop.** Nothing comes back from the export. So moving 11 to 12 requires a positive acceptance step (section 7).
- Verified in v4.93: Zed export already moves non-multi-bill work orders to the `batch_invoice` status and records `exported_at`/`exported_by`.

### Batch status counter

- Admin-visible counter of how many work orders are in 11, plus the dollar amount they represent, so a sizable stuck batch is obvious. Simple count and dollar total only; no separate split.
- Purpose: if a run is interrupted or an export is never accepted, it shows up the next day.
- Where it appears: in the top ribbon of the invoice workflow, next to the progress bar that shows how far through the process Kevin is. (Not on the Daily Dashboard unless added later.) The separate "unprocessed dollar total since the last run" stays on the workflow entry screen (step 1).

## 3. Workflow steps

A persistent progress bar sits at the top of every workflow screen (section 4).

1. **Trigger** customer invoice generation. Show the last run date/time and the unprocessed dollar total (section 5).
2. **In-progress review screen (first screen).** Lists every work order in the ACTIVE (live) category, oldest to newest, so the longest-stale surface first. A working screen, not a passive warning: Kevin can edit a work order or change its status to Completed right there. Purpose: catch jobs actually finished but never moved to completed, and cover bulk desk cleanup of field entries.
   - Useful extra: a per-customer listing showing active and completed work orders together.
3. **Pick scope**: all completed work ready to bill, or specific customer(s). Scope work orders move to 11 at this point.
4. **Vendor invoices: last imported.** Show the date vendor invoices were last imported, and how many days ago. No "stale" label or threshold; Kevin judges from the date. Offer a shortcut to the import screen.
5. **Billable time: last updated.** Show the date billable time was last updated, and how many days ago. Same rule: report the date, no automatic judgment. Offer a shortcut to the time screens.
6. **Days accepted: accepted through.** Show the last date through which days are accepted in the Field Travel Log `day_review.sync_status` gate (pending -> submitted -> syncing -> ready -> accepted / kicked_back, 15-minute grace window for late GPS pings), and the days worked that are not yet accepted. `submitted` does not count as accepted.
   - Steps 4 to 6 are information only: they report "last date X happened" and never block or prompt. Kevin decides whether the gaps are acceptable. The oldest of these dates feeds the safe-to-invoice cutoff in section 5.
7. **Coalesce time and materials per job** into invoices. Default: one work order = one invoice. A quoted job may intentionally split into several invoices (for example a parts invoice, then a final invoice after installation).
8. **Line-item review** (step by step, before export): all line items, inline-editable with quick tab-through fields like the work order screen, able to add or adjust lines. Edits WRITE BACK to the originating work order, never living only on the export.
9. **Export** with the Zed Axis button, now included in this workflow (section 8).
10. **Accept** the export (section 7).
11. **Finish the run**: save the last-run timestamp when the export step completes. Acceptance may follow later; the run stays open, and the dashboard reminder (3d) keeps showing, until every work order in it is accepted or returned.

## 3a. Exception flags and dropping work orders from a run

- Exception flags are WARNINGS only. They never block a run.
- Kevin can DROP a work order from the current run when information is missing (for example no PO yet), on the scope and review screens. A work order dropped BEFORE export leaves the run and returns to 10-Completed.
- Dropping after export is not possible to recall from Zed Axis (no feedback loop). That case is handled by the acceptance step: anything not accepted stays in 11 and shows in the counter until resolved by hand.
- Warnings are visible on the work order row.

## 3b. Exception flag model

Current state (verified v4.93): four flags stored as columns on `work_orders` (`flag_needs_paperwork`, `flag_needs_parts`, `flag_needs_review`, `flag_needs_po`), each with a `_note` column. Settings can rename, recolor, toggle and deactivate flags but not add. "Blocks Export" is saved but never read. The export review hardcodes its own blocks (unresolved customer, PO required and missing, quoted with no amount, no entries). The `flag_rules` table is unused.

Decisions:

- **Logic-linked flags** are computed from the data and shown automatically as warnings: PO missing, unresolved customer, no entries, no hours, no parts, no quoted amount. The current hardcoded blocks become warnings with the drop/override action.
- **Manual flags** stay: Needs Parts, Needs Entry Work.
- **"Needs Review" is replaced by the catch-all "Hold - Other (explain)"** for one-offs. It requires a comment explaining what is holding the work order up, and that reason is visible on the work order banner, the grid row, and the invoice workflow rows (not only a hover tooltip).
- **Code impact (checked in v4.93):** the unique identifier is the key `needs_review` (column `flag_needs_review`, note column `flag_needs_review_note`). Keep the key and column unchanged, so existing flagged work orders keep their data. The rename changes the DISPLAY name, which comes from `wo_flags.name` (editable in Settings), plus the places that hardcode the old label: the fallback flag lists in app-core.js (`loadWoFlags` and the other `_fd`/`_ef` fallbacks) and the "Review" option in the flag filter in index.html. The live-flagged lists in app-filters.js already include `flag_needs_review`, so they keep working.
- **New behavior needed:** `setWOFlag` (app-core.js) currently asks for an optional note in a browser prompt. For this flag, replace that with a required text input, and block setting the flag until a reason is entered.
- Verified in the live database: `flag_needs_review` and `flag_needs_review_note` exist on `work_orders` (as do the matching columns for the other three flags), and the `wo_flags` row `needs_review` is active. `blocks_export` is ticked on three flags in `wo_flags` but is never enforced. `flag_rules` has 0 rows.
- Remove the unused "Blocks Export" setting. The unused `flag_rules` table is not needed.

## 3c. Daily dashboard reminder: work orders missing a PO

Goal: chase POs ahead of time instead of finding them missing at invoice time.

- On the admin Daily Dashboard, list work orders that are in the active or completed category, belong to a customer marked "PO required", and have an empty PO field. Oldest first, with days waiting. Confirmed by Kevin: only the active and completed categories are reviewed. Draft, processed (11, 12, 15) and cancelled are excluded.
- Enter the PO right from the list, reusing the existing inline PO entry on the work order screen.
- "A PO is live" currently means only that the PO number field on the work order is populated.
- Customers whose "PO required" attribute is not set yet: prompt right there to set it to Required or Not required.
- The larger PO tracker module (balances, warnings, closing) is separate and NOT part of this spec; a spec for it still needs to be written.

## 3d. Daily dashboard reminder: invoice run not finished

- On the admin Daily Dashboard, show a reminder whenever an invoice run is unfinished, so an interrupted or unverified run is not forgotten.
- Two cases, worded differently: (a) a run interrupted before export ("Invoice run started [date], stopped at step X"), and (b) a run exported but not fully accepted ("Invoice export from [date] still has N work orders awaiting acceptance").
- Show the run's start date, current step, number of work orders, and their dollar total, with a link that opens the workflow at the right place (resume, or the acceptance checklist).
- The reminder disappears when the run is finished or cancelled.

## 4. Progress bar and resume

- Persistent progress bar at the top at all times showing the active stage (for example "evaluating completed work orders", then "importing vendor invoices up to current", and so on).
- Doubles as a resume point: after an interruption, reopening the workflow returns Kevin to the correct step with a clear message of where he is and what the next step is.
- **Run state is saved in the database** (a new table, for example `invoice_runs`, created by a migration), not in browser storage, so it survives closing the app and works from the desktop or the tablet.
- It records: who started the run and when, the scope (all customers or specific ones), the work orders in the run, which steps are done, whether the export happened, and whether acceptance is complete.
- **One active run at a time.** A second run cannot start until the first is finished or cancelled, so work orders cannot be claimed twice.
- **On reopening the workflow** with an unfinished run, show a summary such as "Run started Oct 3, 2:15 PM, at step 4 of 11, 12 work orders" with two choices: Resume (go back to that step) or Cancel run (work orders not yet exported return from 11 to Completed; exported ones stay in 11 until accepted).
- A run counts as unfinished until every work order in it is accepted or returned.

## 5. Last-run date and cutoff logic

- Save and display "last customer invoice generation date/time" at the end of each completed run.
- **Safe-to-invoice cutoff** = the OLDEST of: vendor invoices last-imported date, billable time last-updated date, last run date. Anything touched after that line needs a look. Example: vendor invoices imported through two weeks ago and time current means the cutoff is two weeks ago.
- Anything changed since the last run date (time entries, vendor invoices, work orders) should be considered for readiness.
- **Unprocessed dollar total**: dollar value of unprocessed/unbilled work accumulated since the last run (for example "$20,000 not yet processed"), on the workflow entry screen and/or dashboard.

## 6. UI notes

- Work order review screens in this workflow reuse the look and layout of the existing Work Orders module.
- EXCLUDE the Work Orders top summary ribbon (days-open counts, dollar amounts, completed totals, exception flag counts) from the invoice workflow screens. The filter/search bar is a different element and is not what is removed.

## 7. Zed Axis export and positive acceptance

- Zed Axis export is a one-way Excel file. Once exported, DWO gets no confirmation, no error, no rollback. Anything wrong after export is fixed by hand in QBO/Zed Axis.
- Because of that, the review screen (step 8) and the warnings in 3a are the last chance to catch problems, and a POSITIVE ACCEPTANCE step is required at the end of every Zed export.
- **Acceptance happens AFTER Kevin has verified the invoices made it all the way through QBO**, not at the moment of export. Work orders stay in 11 until then and show in the batch counter and dollar total.
- The acceptance screen works as a checklist: each exported work order with its WO number, customer and amount, so Kevin can tick them off against QBO. Accept all, or accept only the ticked ones. Anything not ticked stays in 11.
- Accepting a normal work order moves it from 11 to 12-Invoiced. (Kevin wrote "12-completed"; read here as 12-Invoiced.)
- **Multi-bill work orders:** at acceptance, prompt to return the work order to the in-progress status (today 7; use a configured status, not a hardcoded number) instead of 12-Invoiced, and increase its billing-suffix count at that point. (Today `runExport` does this at export time, setting status 7, incrementing `invoice_suffix_count`, and clearing `exported_at`/`exported_by`; under this spec that happens at acceptance.)
- Acceptance is available from the workflow and from the list of work orders in 11. It replaces the earlier idea of a separate bulk "move to 12" action.
- Zed-path PDF archiving and customer delivery stay manual for now.

## 8. Zed Axis button placement

Keep the Zed Axis export button on the Work Orders screen for now. ALSO include it in the new workflow as the export step. Removing it from the Work Orders screen is a later decision.

## 9. Multi-bill work orders (unresolved)

- Today, a `multi_bill` work order, after export, goes back to status 7 (In Progress) with its billing-suffix count incremented and export fields cleared (app-subforms.js `runExport`).
- Kevin: not fully solved yet; the multi-bill structure must be worked out in the work order program first. No change in this build.
- Decided for this build: multi-bill work orders go through the run like any other and sit in 11 until verified. At acceptance they return to 7-In Progress (section 7). They therefore appear on the in-progress review screen only after verification, not during a run.

## 10. FUTURE work (not in this build; keep on the open register)

- **QBO connection**: Intuit developer app, authorization, production approval. Not built yet.
- **Direct-to-QBO export**: mapping built into app code (which DWO fields go to which QBO fields/objects, no spreadsheet). The create-invoice call is synchronous, returning success (with QBO internal `Id` and customer-facing `DocNumber`, two separate fields) or an error. On success, 11 moves to 12 automatically; on failure, the work order rolls back per work order. Optional unofficial deep link `https://qbo.intuit.com/app/invoice?txnId={id}` (fragile).
- **PDF archive**: after QBO success, fetch the invoice PDF via QBO's documented endpoint and store it in Supabase linked to the work order and customer, for later invoice history and service research.
- **Microsoft Graph delivery**: send from Kevin's own M365 domain (not QBO's send function, which routes through Intuit's servers), from a Supabase Edge Function, with the PDF attached. Kevin is new to Graph, so setup needs a walkthrough.
  - Bulk delivery across many customers in one run.
  - Per-customer preference on the customer record: one bundled email with multiple PDFs, or an individual email per invoice.
  - Bundled email HTML body summarizes each invoice: invoice number, dollar amount, brief work order description.
  - Delivery log with a timestamp per send; Kevin CC'd on every invoice email (global setting).
- **Customer email addresses**: which recipients get invoices, stored on the customer record.
- **Retry/recovery** if the PDF fetch or Graph send fails after the invoice exists.

## 11. Open items and questions

1. The full multi-bill structure (section 9) still needs to be designed in the work order program first. Resolved for this build: multi-bill work orders are verified at acceptance and returned to 7.
2. RESOLVED: acceptance happens after verification in QBO (section 7).
3. RESOLVED: PO reminder covers active and completed categories only (section 3c).
4. RESOLVED: the batch counter and its dollar total go in the workflow's top ribbon next to the progress bar (section 2).
5. RESOLVED: the lock stops everyone else from editing work orders in 11 while invoicing is in progress; the person running it can still edit (section 2).
6. RESOLVED: run state saved in the database, one active run at a time, resume or cancel on reopening (section 4).
7. RESOLVED: the `flag_needs_review_note` column exists (verified in the live database).
8. Coordinate Kevin's status retirement with the build: keep a status for each role in section 2 (keys now confirmed), and replace the three hardcoded status numbers listed there with `system_key` lookups.
11. RESOLVED: Kevin is clearing the 37 work orders in `batch_invoice` himself before the build.
9. Timing of removing the Zed button from the Work Orders screen: Kevin will handle this himself.
10. Reminder: write the separate spec for the PO tracker module (not part of this build).

## 11a. Code structure

- The invoice generation workflow goes in its OWN new module file (suggested name `app-invoice-gen.js`, loaded from index.html like the other `app-*.js` files), per the CLAUDE.md rule that new features do not go in `app-core.js`. It holds the screens, progress bar, resume state, review and acceptance logic.
- Today the Customer Invoice Generation panel is only a launcher (`initInvoicingPanel` in app-core.js, host element `invoicing-panel-body` in index.html) with two cards: Time & Billing Reconciliation and Invoices & Import. Both stay. The new workflow becomes an entry on that panel. If `initInvoicingPanel` moves into the new module, comment out the old copy with the MOVED TO note required by CLAUDE.md; do not hard-delete.
- Small edits in existing files are still needed and should be kept minimal: the flag changes (`setWOFlag`, flag fallbacks in app-core.js, the filter option in index.html), replacing the three hardcoded status numbers (app-subforms.js, app-core.js), the dashboard PO reminder (desktop Daily Dashboard in app-morning-brief.js), and calling the new module from the Zed export (`runExport`/`showExportReview`).
- Follow the rest of CLAUDE.md: run `node --check` on every changed JS file, bump APP_VERSION and cache busters, add a CHANGELOG.md line, and use the commit format `v[X.XX]: [summary]`.

## 12. Handoff

Per the design-to-build process: Kevin reviews this spec, says "okay to build", then the spec goes into the repo (knkreb/DWO-built-app) for Claude Code. Suggested slices: (1) in-progress review, status chain, batch counter and dollar total; (2) progress bar/resume, staleness checks, last-run timestamp; (3) flag changes and the dashboard PO reminder; (4) Zed export acceptance. Kevin picks the pilot.
