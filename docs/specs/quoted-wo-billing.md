# DWO Spec: Quoted Work Order Billing (Milestones)

Date: 2026-10-19
Status: APPROVED by Kevin ("okay to build", 2026-10-19).
Source: Claude doc "DWO Spec — Quoted Work Order Billing (Multi-Bill)", revised by the Q&A decisions below.
Related: invoice-generation-workflow.md (T&M run, Zed export, acceptance), Work Orders module, Daily Dashboard.

## 1. Goal

T&M work orders bill once, at completion. Quoted work orders bill a fixed price that may be split into several bills (milestones). Quoted billing runs in its own lightweight workflow focused on cashflow.

## 2. Data model (reuse what exists)

- `work_orders.form_mode` ('quoted' | 'time_materials') IS the billing type. UI label: "Billing Type". No new billing_type column.
- NEW column `work_orders.quoted_amount` (numeric). NEW column `work_orders.cost_warn_pct` (numeric, null = use Settings default).
- `quoted_invoices` is extended into the milestones table. New columns: `trigger` (text label), `is_percent` (bool), `percent_value` (numeric), `status` (pending | ready | billed | paid), `sort_order` (int), `due_date` (date, optional), `qbo_ref` (text, future), `ready_requested_by` / `ready_requested_at`, `exported_at`, `exported_by`, `exported_snapshot` (jsonb: amount, description, suffix, date, by), `paid_by`, `paid_at`.
- Settings: default cost warning percent = 75.
- Existing Quoted work orders (very few): one-time conversion. Quoted amount = sum of current active lines; lines become milestones (exported -> billed, otherwise pending). List shown to Kevin before anything is written.
- `multi_bill` is unused in data; it is retired as a user-facing setting (code kept, commented per CLAUDE.md where replaced).
- Migrations run one step at a time.

## 3. Work order attributes

- Billing Type selectable at start, office or mobile. Mobile shows only type and quoted amount.
- Selecting Quoted reveals Quoted Amount, Cost warning % and the Milestones table (desktop/office/admin only). T&M entry (hours, parts) stays available on every work order.
- Changing type mid-stream never deletes or blocks anything; warnings below cover gaps.

## 4. Milestones table

One row per bill event; any number of rows. Columns: description, trigger (label only), amount (flat $ default, percent toggle per row), status, optional due date, QBO reference (future).

- The FINAL row is never typed: it auto-calculates as quoted amount minus all earlier rows, read-only, always a positive number.
- Earlier rows can never total the full quote or more; the entry is refused with a message. Lowering the quoted amount below the earlier rows' total is blocked until rows are adjusted.
- Billed milestones lock their amount. The final row absorbs quote increases.
- Live running total beside the table: allocated and remaining.
- Change order after the final milestone is billed: add a new milestone for the added amount.

## 5. Milestone status flow

Pending -> Ready to bill -> Billed -> Paid.

- Pending -> Ready to bill: manual, via an on-screen prompt on the row ("Mark ready to bill", confirm showing name and amount). Immediately followed by the billing prompt (section 6). A field user's "yes" is only a request: the row stays Pending with "ready? requested by [name]" until office confirms.
- Ready to bill -> Billed: automatic when the invoice is accepted in the workflow.
- Billed -> Paid: manual, records who and when, flagged as unverified until QBO is connected.
- One step back by hand is allowed, except Billed cannot go back once exported.

## 6. "Okay to invoice" indicator and prompts

- Computed (not stored). T&M: on when status category is completed. Quoted: on when at least one milestone is Ready to bill; shows "n of m ready". Shown on the work order banner, grid row and workflow rows.
- Work order status never bounces. A Quoted work order moves to Invoiced once, when the final milestone is accepted.
- Billing prompt after Ready to bill (office/admin): Bill now / Add to queue / Later.
- Completion question: on any update to a Quoted work order, each user is asked once per day per work order: "Have we arrived at [next pending milestone]?" Yes / Not yet. "Not yet" holds until that user's next day; per-milestone "ask again on [date]" supported.

## 7. Quoted billing workflow (separate from the T&M run)

- Own lightweight flow and queue of Ready-to-bill milestones. Skips T&M checks (in-progress review, vendor import date, billable time date, days accepted, cutoff).
- Steps: confirm milestone -> review invoice line (warnings visible) -> export -> accept.
- One at a time by default; a "Bill several together" action ticks multiple milestones (any work orders) into one export with one acceptance checklist.
- Does not block or join a T&M run (the one-active-run rule applies to T&M only). A work order already locked in the T&M run cannot be billed here.
- Batch counter and dashboard reminder include unaccepted quoted exports.

## 8. Invoice and export

Quoted invoices carry only the milestone description and amount as billed at that moment, no hours/parts, no running totals. Each milestone invoice takes the next billing suffix. At export a snapshot is stored on the milestone. Billed means exported and accepted by Kevin, not confirmed by QBO.

## 9. Cost tracking

Hours and parts run in the background on Quoted work orders. Attributes screen shows actual cost vs quoted amount ("You are at 82% of your quote"). Warning appears once cost passes the work order's own threshold (default 75% from Settings, per-work-order override or off); at 100%+ it states the overrun and always shows. Labor cost rate to be verified in code; the rollup labels its basis.

## 10. Warnings (computed, never block a run; work order + admin dashboard, with link to fix)

1. Quoted with no quoted amount or milestones (and days in that state).
2. Billing mode changed mid-stream (T&M entries exist).
3. Milestones do not total the quote (safety check).
4. Cost has passed the warning threshold / overrun.

Rules live in one list (key, message, fix link) so more can be added without touching screens.

## 11. Deferred / future

- PO amount comparison: needs the PO module with PO records. PO types: standing (number only, no dollars) and tracked (authorized amount), set on the PO record. Compare tracked POs only; shared tracked PO = sum of linked Quoted work orders vs authorized amount.
- Quoting module hand-off, QBO bidirectional connection (Paid verification).
- Automatic trigger-driven status.

## 12. Code structure

New module file `app-quoted-billing.js`, loaded from index.html. Small edits elsewhere: attributes screen hooks, dashboard warnings, indicator in banner/grid. Follow CLAUDE.md (node --check, APP_VERSION and cache busters, CHANGELOG line, commit `v[X.XX]: summary`).
