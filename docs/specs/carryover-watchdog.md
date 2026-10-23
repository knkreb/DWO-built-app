# Spec: Carryover watchdog (cancel block and "finished while pending" alert)

Status: SPEC ONLY, 2026-10-22. Nothing built. Needs Kevin's review, then "okay to build" with this spec named.

Baseline: v5.17 (carryover on quoted work orders; migration applied to Supabase 2026-10-22). Related: `quote-tracking-and-quoted-carryover.md`, `customer-thresholds-and-carryover.md`.

## Why
Carryover tracks small favors to customers (an amount added to a work order now, owed back or caught up later). It is not a financial control. Today nothing connects a work order's own status to the carryover ledger, so an amount can be left attached to a work order that is cancelled, or stay pending on work that is already finished, with nobody noticing. Kevin wants the ledger to catch those cases so nothing falls through the cracks, without getting in the way of closing out work.

An accepted quote is the end state for an application (it is `resolved`). There is no separate "billed" step to track. The risk is in `committed_pending`.

## Decisions (Kevin, 2026-10-22)
1. **Cancel is blocked.** A work order cannot move into the **Cancelled category** (today only status 99, Cancelled) while a carryover amount is attached to it. Enforced in the database, not only on screen.
2. **Finished while pending is an alert, never a block.** If a work order moves on to finished or billed while its quote is still awaiting (the application still `committed_pending`), the admin gets an alert and a Daily Dashboard line. Work is never held up. Catching up later is expected.
3. **Scope is small balances.** No dollar threshold, no approval workflow.
4. **Alert thresholds live in Settings** (time, dollars per case, cumulative dollars company-wide and per customer). Exceeding any one means a review.
5. **One-stop review modal with "close".** A modal anyone with admin rights can open at any time that lists every open carryover balance as it stands now, and lets the admin close a balance once it has been accounted for. It is the place to catch anything that crept up and was never covered. (Added 2026-10-22, evening; details below are a first draft for Kevin to confirm.)

## Rule 1: block cancel while an amount is attached
- Trigger on `work_orders` (before update of `status`): if the new status is in the Cancelled category (looked up in `wo_statuses.category`, never by status number, per the app's customization rule) and the work order has any **active** row in `carryover_allocations` (pending or resolved), raise a plain message and refuse the change, for example: "This work order has carryover on it ($200.00). Remove or return it first, then cancel."
- The admin clears it with the existing edit / remove application tools (v5.14), then cancels. Removing switches the row off, so the amount goes back on the balance.
- Applies to every path (work order screen, bulk edits, direct updates), because it lives in the database.
- The screen shows the database message as is, in the same inline error place the status change already uses, so the person knows what to do.
- Rows already switched off (returned or removed) do not block.

## Rule 2: alert when the work order finishes with a pending application
- A "finished" work order is one whose status is in the **Completed** or **Processed** category (looked up in `wo_statuses.category`, never by status number or name). Today that is Completed (10), Batch Invoice Process (11), Invoiced (12) and Invoiced Outside DWO (15); a status Kevin adds later to either category is covered automatically.
- Condition: the work order has an active `committed_pending` application and its quote is still `not_sent` or `awaiting`.
- New alert type `carryover_pending_finished`, raised once per application. It clears itself (is no longer listed) when the application is resolved, returned, or removed.
- Raised by the existing daily check (`quote_check_all`, run when the admin opens the Daily Dashboard) and on save of the work order status, like the quote alerts. No separate job.
- Daily Dashboard: one list, "Carryover to follow up", admin only. Each line: work order, customer, amount, quote state, days since the work order finished, with an Open button. Alert only; nothing is changed automatically.

## Rule 3: open balances review modal (draft)
- **Open** means any carryover entry that is `outstanding` or `committed_pending` and not closed. Applied-and-resolved entries are not listed.
- **Opens from** a button on the Daily Dashboard card ("Carryover to follow up") and from the carryover Ledger. Admin only.
- **Real time** means current when it opens: it reads the live `carryover_balance` view every time, with a Refresh button. No background polling.
- **Layout: aging bands, oldest first.** The modal is a vertical stack of four bands, **90+ days**, **60**, **30** and **Current**, like a receivables aging. Each band header shows the number of cases, the total dollars still open, and the oldest age. Each band expands to list what is still live in it, grouped by customer with a subtotal. Each line: origin work order, original amount, applied, balance, age in days, and where the committed part sits (work order, its quote state). A flag shows on any line the watchdog is raising (pending on a finished work order). The "Ready to close" group (zero balance) sits above the bands.
- **Settings shortcut:** the modal header shows the current alert thresholds in one line (for example "Alerts at 60 days, $500 per case, $2,000 per customer, $5,000 total"; "off" for any left blank) with a **Change** link. The link goes straight to those four Settings fields, scrolled into view, and Back returns to the modal, so changing a threshold is one click instead of a trip through the Settings screens. Admin only, like the thresholds themselves.
- **Age** is days since the carryover entry was created. Bands: Current is 0 to 29 days, 30 is 30 to 59, 60 is 60 to 89, 90+ is 90 and over (boundaries to confirm).
- **Alerts are set in Settings, and a threshold being exceeded means "review".** Four Settings fields, each optional (blank = that alert is off, no built-in numbers): **days open** (a case older than this), **dollars per case** (one open balance over this), **cumulative dollars, company-wide** (total open across all carryover over this), and **cumulative dollars, per customer** (total open for any one customer over this). When any one is exceeded the admin gets a single alert and the Daily Dashboard shows a "Carryover review due" prompt with the band totals and the cases that tripped it. Each case alerts once per threshold, and each cumulative alert (company-wide, and each customer separately) once each time its total crosses the line, so nothing repeats daily. The prompt clears once the modal has been opened and the flagged cases reviewed (closed or looked at), and comes back only when a threshold is crossed again. Alerts go to the admin only.
- **Case ledger:** each carryover case opens to its own ledger: the origin (date, amount, note) and every application made against it, with date, work order, amount, status (pending, resolved, returned, removed), the quote state where it applies, who entered it, and the note. A running balance runs down the side. This is the audit view: it shows what was charged off to which work order and the notes that it was taken care of.
- **Ready to close prompt:** cases with a zero balance and nothing pending (fully applied and resolved) are grouped at the top as "Ready to close". The prompt reads like "These have a zero balance. Okay to close?", with a Close button per case and a "Close all ready" button. Nothing closes by itself; the admin confirms. A case that is zero only because an amount is still pending is not listed as ready.
- **Manual audit stays available:** the Ready group is a shortcut, not a replacement. Every open case can still be opened and reviewed one by one, and closed cases can be shown (toggle) with their full ledger. Cases that look off are flagged on the line: pending on a finished work order, a returned amount, or sitting in the 60 or 90+ band.
- **Close:** a Close button per line. It asks for a short reason (required: for example "covered on a later job", "written off") and records who and when. A closed balance leaves the open list and no longer counts as owed. Nothing on any work order changes.
- **Closing is reversible:** closed entries can be shown with a toggle and reopened, with the audit trail keeping the history.
- **Blocked while committed:** an entry with an active pending application cannot be closed until that application is resolved or returned, so closing never hides an amount still committed to a work order.
- Data: closed state on `carryover` (`closed_on`, `closed_by`, `closed_reason`; the balance view excludes closed entries). Audited like the other carryover tables.

## What does not change
- Rejecting a quote, stopping tracking, and expiry still return pending applications (v5.17). Accepting still resolves them.
- The app still never changes a work order's hours or parts, and never reassigns a returned amount.
- Resolved applications stay resolved if the work order later finishes.

## Files touched (proposed)
- Migration `v5.xx_carryover_watchdog.sql`: the cancel-block trigger on `work_orders`, the alert check (extend `quote_check_all` or a sibling function it calls), alert type. Pre-check first; applied only on Kevin's explicit go-ahead.
- `app-carryover.js`: "Carryover to follow up" list for the Daily Dashboard, and the open balances review modal with Close.
- The same migration adds the closed columns on `carryover` and updates the `carryover_balance` view, adds the alert types (`carryover_age`, `carryover_amount`, `carryover_total`, `carryover_customer_total`), and adds the Settings keys (`carryover_alert_days`, `carryover_alert_case_dollars`, `carryover_alert_total_dollars`, `carryover_alert_customer_dollars`), all blank (off) until set, with fields in Settings next to the quote ones.
- Per build: `index.html` cache busters, `app-core.js` version, `CHANGELOG.md`.

## Open items
- **Finished / billed:** settled 2026-10-22. By category, not status: Completed and Processed count as finished; Cancelled is the category the cancel block uses. Categories in `wo_statuses` today: draft (0-4), active (5-9), completed (10), processed (11, 12, 15), cancelled (99).
- **Cancel block scope:** written as any active application, pending or resolved. Confirm "pending only" is not wanted.
- **Origin side:** a work order that is the *origin* of a carryover entry (the one the amount came from) and is cancelled is not covered here. Say if it should be.
- **Who sees the alert:** admin only, as written.
- **Close reasons:** a zero-balance close from the Ready group fills the reason in itself ("Fully applied"), so closing a batch needs no typing. A manual close of a case with a balance needs a reason: free text, or a short fixed list (covered on a later job, written off, billed elsewhere, other)? Confirm.
- **Aging bands:** confirm the band boundaries (0-29, 30-59, 60-89, 90+) and that age counts from when the entry was created.
- **Alert thresholds:** Kevin sets the numbers in Settings (days, dollars per case, cumulative company-wide, cumulative per customer). Settled 2026-10-22: the cumulative alert covers both company-wide and per customer.
- **Close while committed:** written as not allowed. Confirm.
