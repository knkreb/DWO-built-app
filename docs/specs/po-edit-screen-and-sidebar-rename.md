# Spec: Customer PO edit screen redesign + sidebar rename

Status: Kevin answered the open questions (below). Awaiting "okay to build".

## 1. Rename to "Customer Purchase Orders" everywhere
Kevin: use the full name in all places to avoid confusion. Labels to change:
- `index.html:547` — sidebar item `#sidebar-potracker`.
- `index.html:681` — panel heading.
- `app-core.js:5395` — Settings block title "Purchase Orders" -> "Customer Purchase Orders".
- `app-po-tracker.js:145` — empty state "No purchase orders yet." -> "No customer purchase orders yet."
- Not changed: `app-subforms.js:593` (an import column header read from a file, not a label) and the HTML comment at `index.html:678`.
- Old text commented out per CLAUDE.md where in JS.

## 2. PO edit screen (`poRenderEditForm()` in `app-po-tracker.js`)
Problems today: a long checkbox list of every customer; linked work orders shown only as "WO# ($amount)" text; no way to open or unlink a work order.

### 2a. Customer picker
- Replace the checkbox list with a search box. Typing shows matching active customers; clicking one adds it.
- Selected customers show as removable chips above/below the search box.
- Same save behaviour as now (`poSyncAccounts`); at least one customer still required.

### 2b. Linked work orders table (existing POs, dollar-tracked)
- Table of every active work order with `purchase_order_id` = this PO.
- Columns (confirmed by Kevin): WO#, Customer, Description, Status, Amount.
- Clicking a row opens that work order directly.
- Needs more columns from the `po_wo_breakdown` view (title/description, customer_id) -> a new migration that recreates the view with the added columns. Existing columns and `po_ledger` stay unchanged.
- The old "Pending from:" text line is replaced by this table (commented out, not deleted).

### 2c. Unlink
- Each row has an Unlink button -> confirm -> sets `work_orders.purchase_order_id = null`, then reloads PO data so Billed / Pending / Remaining at the top update.
- Invoiced work orders (status 12) are not blocked; Unlink shows a stronger warning first (the Billed amount will drop and that invoiced work will no longer count against this PO). Kevin: "invoiced should be warned right now".
- A work order locked to this PO (`purchase_orders.locked_work_order_id`) is not unlinked here; it keeps using the existing Untie flow (`poUntieLock`).

## Decisions (Kevin)
1. Columns confirmed.
2. Invoiced work orders: warn, do not block.
3. Rename in all places.

## Files touched (proposed)
- `index.html` (label, cache busters)
- New module file for the PO edit screen pieces (per CLAUDE.md: new features not in app-core.js); `app-po-tracker.js` gets the matching origin / MOVED notes.
- New migration in `supabase/migrations/` for the view change.
- `app-core.js`: APP_VERSION bump only.
- `CHANGELOG.md`.
