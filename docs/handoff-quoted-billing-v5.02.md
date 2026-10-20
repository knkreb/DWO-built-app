# Handoff: Quoted work order billing (v5.01 + v5.02), 2026-10-19

Read this first in a new session. Read CLAUDE.md too: **never build or deploy unless Kevin says the exact phrase "okay to build"**, and build only what the spec lists.

## State

- `main` = `24057a7` on GitHub (v5.01 + v5.02 on top of v5.00). Merged and pushed 2026-10-19; Netlify deploy not confirmed from here.
- Spec: `docs/specs/quoted-wo-billing.md` (approved). Claude doc "DWO Spec — Quoted Work Order Billing (Multi-Bill)" (https://claude.ai/code/artifact/90a87157-9b76-4c99-b94b-9292546e0fd8) has a "Build decisions" section appended; the spec file is the source of truth.
- Code: `app-quoted-billing.js` (milestones, form table, status flow, queue, export, accept, dashboard card, completion question, warnings in `QB_RULES`), `app-wo-status-field.js` (Status field on the WO form). Small hooks in `app-core.js`, `app-invoice-gen.js`, `app-morning-brief.js`, `index.html`.
- Schema (additive, applied to the live DB 2026-10-19): `work_orders.quoted_amount`, `cost_warn_pct`; `quoted_invoices` extended into milestones; setting `quoted_cost_warn_default_pct` = 75. Migration file `supabase/migrations/v5.01_quoted_billing.sql` (applied under the name `v4_99_quoted_billing` before renumbering). `v5.01_quoted_billing_convert.sql` was NOT run, by decision (only live work orders matter).

## What Kevin has confirmed working (tested by him in Firefox against the live database)

Milestones table in the WO attributes form, the final-row remainder, the new "Milestone & invoice line description" label, the Status field on New/Edit. Everything else was checked only with scripted tests and a stubbed database (see "Not yet verified live").

## Open items (none started)

1. **PO Tracker ledger vs Quoted partial billing.** The views `po_wo_breakdown` / `po_ledger` (v4.99 PO Tracker) count a work order as billed only when `status = 12` and sum ALL active `quoted_invoices` rows. A Quoted job with some milestones billed still shows as pending there until the final milestone is accepted (then the WO moves to Invoiced). Needs a decision: make the ledger count billed milestones per row. Changing the views is a schema change; one step at a time.
2. **Quote vs PO amount comparison (deferred in the spec, now possible).** The PO Tracker exists (`purchase_orders`, `po_change_orders`, `work_orders.purchase_order_id`, `po_type` standing vs dollar-tracked). Rule agreed: only for dollar-tracked POs; a standing PO never warns; a shared tracked PO compares the sum of linked Quoted work orders against the authorized amount (original + change orders). Warn only, never block. Add as one more rule in `QB_RULES`.
3. **Old quoted-line editor still reachable.** Export Review's "Add quote" (`exportReviewFix` -> `openQuotedList`, app-subforms.js) and the mobile quoted-list screen can still add/edit `quoted_invoices` rows without the milestone rules (final-row remainder, no over-allocation). Route them to the new form or retire them.
4. **T&M Zed export can still include Quoted work orders.** `invIsReady` now excludes Quoted work orders from the T&M run, but selecting a Quoted work order on the Work Orders screen and using `runExport` still exports every quoted line, which could double-bill milestones already billed through the Quoted queue. Guard or exclude.
5. **Zed Axis workbook for quoted export is unverified.** `qbExport` builds the same sheets as `runExport` with only "QBWO Form" and "Quoted Invoice Form" populated (one invoice per milestone, next billing suffix). Kevin has not opened one in Zed Axis. Compare against a normal export before relying on it.
6. **Not yet verified live** (scripted/stub checks only): Bill now after the v5.02 fix, the Quoted billing queue, export, acceptance (and final milestone -> work order Invoiced), return to ready, the dashboard Quoted Billing card with Fix links, the "Have we arrived at ...?" banner, field-user "request ready".
7. **Prompt differs slightly from the spec.** Spec asked for Bill now / Add to queue / Later; built Bill now / Leave in queue (no T&M run to join).
8. **"Have we arrived at ...?" memory is per browser** (localStorage: asked-today and snooze date), not per user across devices.
9. **"Okay to invoice" chip appears on every Completed T&M row** in the grid; may be noisy. Decide whether to show it only for Quoted.
10. **Cost rollup labor basis** is hours x internal rate (no labor cost rate exists). The panel says so; replace if a labor cost rate is added.
11. **Mobile** shows only Billing Type and Quoted Amount (by design). Milestones are office/admin, desktop.

## Housekeeping for Kevin

- **Test data still live:** `P26435 "Test work order"` (Quoted, $1,000, 2 milestones, status 6, active). `P26434` was already deactivated (soft, audited). Ask Kevin before deactivating P26435. `P26433 "RTU Controller boards"` is a real work order Kevin has since set up ($7,690, 1 milestone); do not touch.
- Untracked in the repo folder, not committed: `.claude/` (local test server: `serve.ps1`, `launch.json`) and `CHANGELOG-Kevin2020.md` (not mine). One old `git stash` (quoted-billing-wip) is redundant and can be dropped.

## Working notes (things that bit us)

- **Always `git fetch` first.** The local checkout was stale for days: GitHub `main` had the PO Tracker (v4.99) and v5.00 built elsewhere, which collided with this build's version number and conflicted in 4 files. Build numbers: main is at 5.02; next is 5.03.
- **No Node/Python on this machine.** `node --check` isn't available. Syntax-check by serving the folder on localhost and compiling each file with `new Function(text)` in the browser pane, or run the app locally with `.claude/serve.ps1` (PowerShell static server on port 8080; start it with the script path in quotes because the path has spaces).
- **Local testing writes to the live Supabase** (`SUPABASE_URL` is hard-coded in `app-core.js`); a separate test branch or project is not set up. Use throwaway work orders and clean up.
- **No git identity is configured.** Commits used `-c user.name="Kevin Reb" -c user.email=krebtech@gmail.com` per command.
- Work orders are deactivated, not deleted (`active=false`); audited by the generic trigger (`audit_log`, searchable by WO number in Settings -> Audit Log).
- Statuses are found by `system_key`/category, never by number or name (customization rule from the invoice-generation spec).
