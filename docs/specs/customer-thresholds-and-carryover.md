# Spec: Customer thresholds (NTE, CapEx) and carryover tab

Status: DRAFT from the 2026-10-21 design session with Kevin. Not yet reviewed by Kevin. Do not build until Kevin says "okay to build" and names the slice.

Baseline: main at v5.08. Nothing in this spec is built.

## Why
Commercial customers limit what Kevin can do on a job: a not-to-exceed (NTE) cap on a diagnostic T&M call, an approval limit, or a dollar line that moves a job from repair and maintenance to capital expense on the customer's books. Kevin tracks this in his head today. With a second technician in the field, a job can run past a limit before anyone notices (example: a $5,500 repair trips a CapEx line). The app should warn live, and give the office a clean way to fix things after the fact.

## Three separate pieces
NTE and CapEx are separate settings (Kevin, 2026-10-21): NTE caps spend; CapEx does not stop work but changes the accounting bucket. The carryover tab is a third piece that supports both.

### 1. NTE (not to exceed)
Per customer settings (customer settings screen):
- NTE on/off switch. Off by default; turning it on makes the warnings live.
- NTE dollar amount.
- Two warning levels, each enabled independently (one or both). Each level has:
  - type: percent of NTE, or dollar amount
  - direction: spent, or remaining (configurable per level; decided 2026-10-21)
  - value
- Seeded defaults: level 1 = 75% spent, level 2 = 100% spent.

Behavior:
- A work order on an NTE account shows a running indicator: NTE limit and how much is used. Visible every time the work order is opened.
- Crossing a level alerts the tech and the office (alerts center).
- A warning card appears on the Daily Dashboard (confirmed by Kevin 2026-10-12).

### 2. CapEx threshold
Per customer settings:
- CapEx tracking on/off (off by default).
- CapEx threshold dollar amount (the line where a job becomes capital expense for that customer).
- Warning ladder like NTE (default 75%), meaning "approaching the point where this must be split into more than one work order, or get approval to continue as a CapEx job."
- CapEx minimum dollar amount: some customers have a separate account used for capital billing. A work order billed to that account must meet a minimum amount; below it, flag or block (flag vs block is open, see below).

Behavior: warns only. It never stops work. Same indicator, alerts and Daily Dashboard card pattern as NTE; reuse one warning engine and one dashboard card family, with separate settings and separate wording.

### 3. Carryover tab
Purpose: when a job is deliberately quoted or billed under a customer's approval limit, the shorted remainder is tracked so it can be billed on another work order instead of lost. Example: real price $2,200, approval limit $2,000, quoted at $1,950, $250 carried over. Live case: one customer with a $1,700 limit and two jobs of about $2,200 and $2,500.

New standalone table (not columns on customers), one row per carryover event:
- parent customer (so any site under that parent can absorb it)
- originating work order
- amount
- status: `outstanding`, `committed_pending` (applied to a quoted work order that is not yet approved), `resolved`
- destination work order(s) once applied; a balance can be split across more than one destination, so destination allocations are child rows (carryover_id, work_order_id, amount, status)
- snooze_until, created/edited/deleted by (multi-user attribution, same as the PO tracker)
- All changes go through the operational audit trail so there is a clear record of where each overage came from and where it went.

Applying a balance:
- From the admin view (per customer, running balance) and from inside a work order (allocate all or part of the balance to this work order).
- On a T&M work order it goes in as an ordinary additional time charge. No separately labeled "carryover" line on anything customer-facing. The internal ledger holds the link and the audit trail.
- On a quoted work order the allocation is `committed_pending` until the quote is accepted; then it becomes `resolved`.
- If the quote is rejected, or passes its expiration date, the allocation reverts to `outstanding` and resurfaces. The system never reassigns it on its own.
- Quotes need an expiration date field (confirm whether one exists on the quoted billing work from v5.01 before adding).

Reminders:
- Daily Dashboard card listing open carryover balances by customer, with amount and age. Same family as POs Needed and the NTE card.
- Contextual flag: when a customer (or any site under the same parent) has another live work order, show a prompt on that work order to consider applying the open balance.
- Snooze on each card row: one week, one month, or custom days, and "until next work order appears". Resurfaces when the snooze ends or the contextual flag fires, whichever is first.
- Low-volume customers: urgency and a resolution window are still undecided (see open items).

### 4. Parent customers (prerequisite for cross-site carryover)
- A parent record is optional. Single-site customers stay standalone with no parent.
- Model it the way QBO does: a parent account that may never be billed directly, with child site accounts carrying their own work orders and invoices. QBO lets a payment land on the parent and be allocated across children's open invoices.
- NTE, CapEx and carryover settings live at the parent when one exists, and apply to all children; a standalone customer holds its own.
- Needs diagnosis first: the customers table is not created in any migration in this repo (it predates them), so read its live columns before designing the parent link. Also check how customers sync with QBO and the Zed export so a parent does not break either.

### 5. Split work order cleanup (after the fact)
When a limit is found blown at data-entry time, the office needs a tool to take one over-limit work order and split its hours and parts lines across two or more work order numbers so each fits its limit. Mechanics not designed yet (see open items). Must write to the audit trail and keep the original work order number traceable.

## Suggested slices (each needs its own "okay to build")
1. Diagnose customers table; parent-child link; settings home for per-customer thresholds.
2. NTE: settings, work order indicator, alerts, dashboard card.
3. CapEx threshold and minimum, reusing the slice 2 engine.
4. Carryover table, admin view, apply to T&M work order.
5. Quoted work order handling, statuses, quote expiration and revert.
6. Dashboard card, contextual flag, snooze.
7. Split work order cleanup tool.

## Open items
- Exact status set for carryover allocations (proposed above; Kevin not yet confirmed).
- Dashboard card layout and what each row shows.
- Resolution window and escalation for low-volume customers with no live work order.
- Split work order tool mechanics (what moves, how numbers are assigned, PO and invoice effects).
- CapEx minimum: flag or hard block?
- Whether carryover applies to quoted work orders on NTE accounts at all.
- Where thresholds are measured: work order total, or sum across work orders on the same job or PO (not discussed).
- Kevin to confirm each customer's purchasing rules allow splitting work to stay under an approval limit. If a customer's contract or policy requires approval above a limit, structuring invoices to avoid it is a customer relationship and compliance question, not only a software one.

## Files touched (proposed)
- New module file(s) for thresholds and carryover (per CLAUDE.md, not app-core.js); `app-morning-brief.js` gets the dashboard card hook only.
- New migrations in `supabase/migrations/` (threshold settings, carryover tables, parent link).
- `index.html` (cache busters), `app-core.js` (APP_VERSION bump only), `CHANGELOG.md`.
