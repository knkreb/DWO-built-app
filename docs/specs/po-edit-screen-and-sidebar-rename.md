# Spec: Customer PO edit screen redesign + sidebar rename

Status: DRAFT — awaiting Kevin's answers to the open questions and "okay to build".

## 1. Sidebar rename
- `index.html:547` — sidebar item `#sidebar-potracker`: "Purchase Orders" -> "Customer Purchase Orders".
- OPEN: also rename the panel heading at `index.html:681`? (Settings block title at `app-core.js:5395` is left alone unless Kevin says otherwise.)

## 2. PO edit screen (`poRenderEditForm()` in `app-po-tracker.js`)
Problems today: a long checkbox list of every customer; linked work orders shown only as "WO# ($amount)" text; no way to open or unlink a work order.

### 2a. Customer picker
- Replace the checkbox list with a search box. Typing shows matching active customers; clicking one adds it.
- Selected customers show as removable chips above/below the search box.
- Same save behaviour as now (`poSyncAccounts`); at least one customer still required.

### 2b. Linked work orders table (existing POs, dollar-tracked)
- Table of every active work order with `purchase_order_id` = this PO.
- Columns (proposed — Kevin to confirm): WO#, Customer, Description, Status, Amount.
- Clicking a row opens that work order directly.
- Needs more columns from the `po_wo_breakdown` view (title/description, customer_id) -> a new migration that recreates the view with the added columns. Existing columns and `po_ledger` stay unchanged.
- The old "Pending from:" text line is replaced by this table (commented out, not deleted).

### 2c. Unlink
- Each row has an Unlink button -> confirm -> sets `work_orders.purchase_order_id = null`, then reloads PO data so Billed / Pending / Remaining at the top update.
- A work order locked to this PO (`purchase_orders.locked_work_order_id`) is not unlinked here; it keeps using the existing Untie flow (`poUntieLock`).

## Open questions
1. Table columns — confirm or change the list above.
2. Should Unlink be blocked for work orders already invoiced (status 12), since that changes the Billed amount?
3. Sidebar only, or also the panel heading?

## Files touched (proposed)
- `index.html` (label, cache busters)
- New module file for the PO edit screen pieces (per CLAUDE.md: new features not in app-core.js); `app-po-tracker.js` gets the matching origin / MOVED notes.
- New migration in `supabase/migrations/` for the view change.
- `app-core.js`: APP_VERSION bump only.
- `CHANGELOG.md`.
