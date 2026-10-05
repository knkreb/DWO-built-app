# DWO Spec — PO Tracker Module
Date: 2026-10-05
Status: DRAFT — awaiting Kevin's review. Build only on explicit "okay to build."

## 1. Purpose
Track customer-issued purchase orders (POs) against DWO work orders so billing never exceeds what a customer has authorized, with visibility into what's already billed and what's pending (logged but not yet billed) against each PO.

## 2. PO Types
Each PO record has a **type**, set at creation:

1. **Dollar-tracked PO** — has an original authorized amount. Tracks billed + pending against it. Closes when fully utilized (see §6).
2. **Standing/Time-based PO** — no dollar amount. Covers a period (e.g. annual, per-visit). Tracks an optional **expiration date** instead of a dollar cap. Closes manually or at/near expiration, not by amount billed.

A third category, **reference-only PO numbers** (e.g. a customer-issued tracking number with no accounting meaning), is explicitly **out of scope for this module** — it remains a free-text field on the work order, same as today. No tracking, no record created.

## 3. Core PO Record
Every PO is tracked by a **unique internal ID**, not by PO number. The customer-given PO number is just a field — it is **not unique** in the system. This allows the same customer-issued number to be split across multiple independent PO records when needed (see §4.3).

Fields on a dollar-tracked PO:
- Unique ID (system-generated)
- PO number (as given by customer; not unique)
- Description (required — disambiguates when PO numbers repeat)
- Customer
- Account(s) assignment (see §4)
- Original amount
- Change orders (see §5) → current amount = original ± change orders
- Billed (sum of actual billed draws)
- Pending (live, sum of unbilled T&M/materials logged on linked, non-completed work orders)
- Remaining $ = current amount − (billed + pending)
- Remaining % = remaining $ ÷ current amount
- Warning threshold ($ or % remaining — configurable per PO)
- Lifecycle status (see §6)
- Locked work order, if any (see §7)
- Change order / audit history (see §5)

Fields on a standing/time-based PO:
- Unique ID, PO number, Description, Customer, Account(s) — same as above
- No dollar fields
- Expiration date (optional)
- Expiration warning lead time (configurable per PO; see §8)
- Lifecycle status (see §6) — no dollar-driven closure

## 4. Account Assignment
- A PO is assigned to one or more DWO customer accounts at creation, via a searchable checkbox picker (DWO accounts are flat — no QBO parent/sub-account hierarchy currently, since QBO subcustomers aren't working reliably).
- **Single shared pool model:** if a PO is checked for multiple accounts, there is one shared dollar pool — not split or allocated per account. Any linked work order under any checked account draws against the same total.
- The account split for QBO billing purposes (R&M vs. Capital) happens at the billing/invoice event, not in the PO module — Kevin decides the account per billing event.
- **If a true split is needed** (rare — one customer instance to date), the workaround is to create **two separate PO records with the same customer-given PO number**, each assigned to a different account, each with its own amount and description (e.g. "4471 — R&M" / "4471 — Capital"). These are fully independent PO records; nothing links them beyond the shared number.
- Billed/pending ledger entries should carry which account they were billed against, so the PO detail/picker can optionally show a billed-by-account breakdown even under the shared-pool model (informational, not enforced).

## 5. Change Orders
- A PO's amount is never edited directly — it is adjusted via **change orders**, unlimited in number.
- "Add Change Order": description + dollar amount (positive or negative). Applies immediately to the PO's running total — no approval/pending state.
- Change orders can be **edited or deleted** after entry. Edits and deletes are themselves logged — nothing is silently overwritten or removed from history.
- Change order history (description, $ amount, date, entered/edited/deleted by) is visible **on the PO detail screen itself**, not only in a separate audit log.
- Current PO amount = original amount + sum of all active change orders.

## 6. Lifecycle Status
Statuses: **Created → In Progress → Completed → Cancelled**

- **Created** — PO set up, not yet used on any work order.
- **In Progress** — actively being drawn against (pending or billed amounts exist, or a locked work order is attached).
- **Completed** — dollar PO: fully billed (remaining $ = $0) and confirmed. Standing PO: manually marked done (e.g. at period end).
- **Cancelled** — PO voided/abandoned.

**Closing rule:** A dollar-tracked PO is considered ready to close when it has been **fully billed** — this is independent of the linked work order's own status (a work order can be "Completed" in DWO while PO dollars remain unspent, or still open after the PO itself is exhausted). Final closure is confirmed within the **Customer Invoice Generation** workflow, where the actual billing against the PO occurs — not as a standalone action inside the PO module.

PO amount changes (via change orders) are tracked separately from lifecycle status — a PO can be reduced via change order without changing its status.

## 7. Locking to a Work Order
- A dollar-tracked PO can optionally be **locked** to one specific work order at creation (typically a quoted job where the PO is meant for that job only).
- The PO module should support **creating the work order directly from within the PO module** at lock time, rather than requiring a separate screen switch.
- Lock is strictly **one-to-one**: a locked PO can only ever be tied to the single work order it was locked to.
- While locked and tied, the work order **cannot be deleted or cancelled**. To delete/cancel it, the PO must first be **untied** — a deliberate, explicit step.
- A locked PO and an unlocked PO can legitimately share the same customer-given PO number as separate records (e.g. a $5,000 locked PO for a quoted job and a $4,000 unlocked T&M PO, same number, different records) — this falls out naturally from the unique-ID model in §3.

## 8. Expiration (Standing POs)
- Standing POs may optionally carry an **expiration date**.
- Each PO has its own **configurable warning lead time** (e.g. 30 days before expiration), overridable per PO.
- A **system-wide default** (lead time, and default dollar PO warning threshold too) lives in **Settings** and pre-fills new POs. A *customer-specific* default validity window is deferred — see §11.

## 9. PO Picker / Table View
Columns, shown when selecting or reviewing POs (e.g. from the work order screen):

For **dollar-tracked POs**:
| PO # | Description | Original/Current Amount | Pending (live, w/ linked WOs) | Billed | Remaining $ | Remaining % | Status |

For **standing POs**, the dollar/pending/billed/remaining columns are replaced with:
| PO # | Description | "Standing PO" | Expiration Date (if set) | Status |

- Pending amounts should be traceable to the specific work order(s) driving them (not just a lump sum).
- Warning threshold (dollar PO) fires off **billed + pending** vs. current amount — not billed alone — so the warning surfaces before invoicing catches up to actual work performed.
- Rows nearing/over threshold should be visually flagged.
- Crossing threshold (dollar or expiration) also surfaces as a **warning on the admin dashboard** — not just in the PO module/picker. Never blocks time entry.

## 10. Work Order PO Field — Picker vs. Free Text
The PO field on the work order screen has a **toggle between two modes**:
- **Free text** — type anything (covers the reference-only/no-tracking case, §2).
- **Picker** — select an existing tracked PO from the PO module.

Once a tracked PO is selected via the picker, the field **cannot be free-text edited** — it stays locked to the selected record unless the toggle is switched back to free text (which clears the picker selection). This prevents a tracked PO from being silently altered into an untracked string.

## 11. Settings (new, system-wide)
PO module gets its own section in Settings:
- Default expiration warning lead time (standing POs)
- Default dollar/percentage warning threshold (dollar-tracked POs)
These pre-fill new POs and are overridable per PO.

## 12. Resolved (2026-10-05 follow-up)
- **Locked work order creation (§7):** happens inside the PO module itself — a checkbox ("Lock this work order to this PO") on the PO create/edit screen ties it to a work order created in the same flow. No separate screen/modal.
- **Change order attribution (§5):** build for **multi-user attribution now** (who entered/edited/deleted), even though only Kevin has access today — avoids retrofitting once roles/permissions expand. Jadyn confirmed **not** to have PO module access at this time.
- **Customer-specific PO validity defaults:** deferred to later (§13). System-wide defaults in Settings (§11) cover this build.

## 13. Explicitly Out of Scope (for this build)
- Reference-only/free-text PO numbers with no dollar tracking (stays as-is on the work order).
- Per-account dollar allocation within a single PO record (rejected in favor of the two-record workaround, §4).
- Any QBO sync to populate the account picker — picker draws from DWO's existing flat account list.
- Jadyn/field-tech access to the PO module (admin-only).
- Customer-record-level default PO validity window (deferred — system-wide default in Settings covers this build instead).
