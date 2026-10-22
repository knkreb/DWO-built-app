# Spec: Customer thresholds (NTE, CapEx) and carryover tab

Status: DRAFT from the 2026-10-21 design session with Kevin, updated the same evening with his decisions. Not yet reviewed in full by Kevin. Do not build until Kevin says "okay to build" and names the slice.

Baseline: main at v5.08. Slice 1 is built as v5.09 and slice 2 (work order NTE, Limits sheet fixes, automatic parent link) as v5.10, both on PR #10 (not yet merged). Nothing else in this spec is built.

## Why
Commercial customers limit what Kevin can do on a job: a not-to-exceed (NTE) cap on a diagnostic T&M call, an approval limit, or a dollar line that moves a job from repair and maintenance to capital expense on the customer's books. Kevin tracks this in his head today. With a second technician in the field, a job can run past a limit before anyone notices (example: a $5,500 repair trips a CapEx line). The app should warn live, and give the office a clean way to fix things after the fact.

## Decisions (Kevin, 2026-10-21)
- NTE and CapEx are separate settings. NTE caps spend; CapEx does not stop work but changes the accounting bucket. The carryover tab supports both.
- Limits are set at the customer account level only. There is no site or location layer.
- Parent accounts are derived from the QBO name, not hand-picked (see section 4).
- NTE is a default on the customer account that flows down to each work order, where it can be changed for that job. A work order keeps the NTE it was given at creation; later changes to the customer default do not change existing work orders (section 1).
- NTE dollar-type levels default to measuring spend, with direction (spent or remaining) configurable per level.

## 1. NTE (not to exceed)

### Customer (or parent) default
Settings on the customer account (Customers screen, Limits sheet; built in slice 1):
- NTE on/off switch. Off by default.
- NTE dollar amount.
- Two warning levels, each enabled independently. Each level has: type (percent of NTE, or dollar amount), direction (spent, or remaining), and value. Seeded defaults: level 1 = 75% spent, level 2 = 100% spent.

### Work order NTE (the one that is enforced)
- When a customer is assigned to a work order (new work order, or the customer is first set), the work order gets its own NTE block copied from that customer's default (or the parent's, when the customer has a parent). If the default is off, the work order starts with NTE off.
- Kevin can then change the amount, change the levels, or turn NTE off for that work order, to fit the work, location or situation. A "reset to customer default" button copies the default again.
- Copy at creation, not live follow: changing the customer's default later does not touch existing work orders. An "apply to open work orders" action on the customer lets Kevin push a changed default to open work orders on purpose. Work orders created before NTE existed have none until then.
- Applies to T&M work orders only. A quoted work order already has its quoted amount and the existing quoted-versus-actual cost warning.
- Only admin edits a work order's NTE. Techs see the indicator and receive warnings but cannot change the cap.
- Spend is measured against that work order's own billable hours and parts. Money pooled across several work orders is the PO tracker's job, not NTE's.
- Storage: one row per work order with the same NTE fields as the customer default (new table decided in slice 2). Changes go through the operational audit trail.

### Behavior
- The work order shows a running indicator: its NTE limit and how much is used. Visible every time the work order is opened.
- Crossing a level alerts the tech and the office (alerts center).
- A warning card appears on the Daily Dashboard (confirmed by Kevin 2026-10-12).

## 2. CapEx threshold
Customer-level only (not per work order). Per customer settings:
- CapEx tracking on/off (off by default).
- CapEx threshold dollar amount (the line where a job becomes capital expense for that customer).
- Two warning levels like NTE (defaults 75% and 100%), meaning "approaching the point where this must be split into more than one work order, or get approval to continue as a CapEx job."
- CapEx minimum dollar amount: some customers have a separate account used for capital billing. A work order billed to that account must meet a minimum amount; below it, flag or block (flag vs block is open).

Behavior: warns only. It never stops work. Same indicator, alerts and Daily Dashboard card pattern as NTE; reuse one warning engine and one dashboard card family, with separate settings and separate wording.

## 3. Carryover tab
Purpose: when a job is deliberately quoted or billed under a customer's approval limit, the shorted remainder is tracked so it can be billed on another work order instead of lost. Example: real price $2,200, approval limit $2,000, quoted at $1,950, $250 carried over. Live case: one customer with a $1,700 limit and two jobs of about $2,200 and $2,500.

New standalone table (not columns on customers), one row per carryover event:
- parent customer (so any account under that parent can absorb it)
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
- Contextual flag: when a customer (or any account under the same parent) has another live work order, show a prompt on that work order to consider applying the open balance.
- Snooze on each card row: one week, one month, or custom days, and "until next work order appears". Resurfaces when the snooze ends or the contextual flag fires, whichever is first.
- Low-volume customers: urgency and a resolution window are still undecided (see open items).

## 4. Parent accounts
- A parent is a regular customer account. A child is any customer whose QBO name has a colon: "Sussex Academy:Aquatics" is a child of "Sussex Academy". Parent = everything before the last colon, matched on exact name ignoring upper and lower case.
- The link is stored in `customers.parent_customer_id` (a self-referencing foreign key that already existed). It is fixed from the name, not hand-picked: the Limits sheet shows it read-only, and adding or renaming a customer re-links it automatically from the colon.
- A parent record is optional; a customer with no colon and no children is standalone. One level only (verified: no name has more than one colon).
- Applied to the live data 2026-10-21: 94 child accounts under 20 parents. Two old "(deleted)" names have no parent record and stay unlinked.
- Parents stay ordinary customer accounts and remain selectable on work orders (6 work orders sit directly on parent accounts today). Limits for a child come from its parent when it has one; a standalone customer holds its own.
- Model on QBO: a payment can be received against a parent and allocated across its children's open invoices.
- The PO tracker treats customers flat; it does not read the parent link.

## 5. Split work order cleanup (after the fact)
When a limit is found blown at data-entry time, the office needs a tool to take one over-limit work order and split its hours and parts lines across two or more work order numbers so each fits its limit. Mechanics not designed yet (see open items). Must write to the audit trail and keep the original work order number traceable.

## Slices (each needs its own "okay to build")
1. Parent link and limits settings home. BUILT as v5.09 (PR #10), migration applied, parent link applied to the data. Pending follow-up batch Kevin approved to hold: Limits sheet layout (section titles as headers with the checkbox inline, compact one-line rows, sheet capped at about 620px wide, opening from the top of the screen), parent shown read-only, automatic parent link on new or renamed customers, backfill script synced to the case-insensitive match that was applied.
2. NTE: work order NTE table and copy-at-creation, work order editor and reset, "apply to open work orders", indicator, alerts, dashboard card.
3. CapEx threshold and minimum, reusing the slice 2 engine.
4. Carryover table, admin view, apply to T&M work order.
5. Quoted work order handling, statuses, quote expiration and revert.
6. Dashboard card, contextual flag, snooze.
7. Split work order cleanup tool.

## Open items
- Exact status set for carryover allocations (proposed above; Kevin not yet confirmed).
- Dashboard card layout and what each row shows.
- Resolution window and escalation for low-volume customers with no live work order to flag against.
- Split work order tool mechanics (what moves, how numbers are assigned, PO and invoice effects).
- CapEx minimum: flag or hard block?
- Work order NTE: when the customer on an existing work order is changed, re-copy the new customer's default, or ask first? And should raising a work order's NTE ask for a reason?
- Whether carryover applies to quoted work orders on NTE accounts at all.
- Where thresholds are measured for CapEx: work order total, or the sum across work orders on the same job (not discussed).
- Kevin to confirm each customer's purchasing rules allow splitting work to stay under an approval limit. If a customer's contract or policy requires approval above a limit, structuring invoices to avoid it is a customer relationship and compliance question, not only a software one.

## Files touched (proposed)
- New module file(s) for thresholds and carryover (per CLAUDE.md, not app-core.js); `app-morning-brief.js` gets the dashboard card hook only.
- New migrations in `supabase/migrations/` (work order NTE, carryover tables).
- `index.html` (cache busters), `app-core.js` (APP_VERSION bump only), `CHANGELOG.md`.
