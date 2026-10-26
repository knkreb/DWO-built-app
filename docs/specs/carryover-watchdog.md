# Spec: Carryover watchdog (cancel block and "finished while pending" alert)

Status: SPEC ONLY, 2026-10-22; reviewed and all open points settled by Kevin 2026-10-26 (see Decisions 6-9 and Rules 1, 1b). Nothing built. Needs "okay to build" with this spec named.

Baseline: v5.17 (carryover on quoted work orders; migration applied to Supabase 2026-10-22). Related: `quote-tracking-and-quoted-carryover.md`, `customer-thresholds-and-carryover.md`.

## Why
Carryover tracks small favors to customers (an amount added to a work order now, owed back or caught up later). It is not a financial control. Today nothing connects a work order's own status to the carryover ledger, so an amount can be left attached to a work order that is cancelled, or stay pending on work that is already finished, with nobody noticing. Kevin wants the ledger to catch those cases so nothing falls through the cracks, without getting in the way of closing out work.

An accepted quote is the end state for an application (it is `resolved`). There is no separate "billed" step to track. The risk is in `committed_pending`.

## Decisions (Kevin, 2026-10-22)
1. **Cancel is blocked, with a prompt to return the carryover (revised 2026-10-26).** A work order cannot move into the **Cancelled category** (today only status 99, Cancelled) while a carryover amount is attached to it. Enforced in the database, not only on screen. On the work order screen the block shows a prompt; if Kevin accepts, the app returns the carryover to the customer's open balance and then cancels. See Rule 1.
2. **Finished while pending is an alert, never a block.** If a work order moves on to finished or billed while its quote is still awaiting (the application still `committed_pending`), the admin gets an alert and a Daily Dashboard line. Work is never held up. Catching up later is expected.
3. **Scope is small balances.** No dollar threshold, no approval workflow.
4. **Alert thresholds live in Settings** (time, dollars per case, cumulative dollars company-wide and per customer). Exceeding any one means a review.
5. **One-stop review modal with "close".** A modal anyone with admin rights can open at any time that lists every open carryover balance as it stands now, and lets the admin close a balance once it has been accounted for. It is the place to catch anything that crept up and was never covered. (Added 2026-10-22, evening; details confirmed by Kevin 2026-10-26.)
6. **Cancel prompt returns the carryover (2026-10-26).** Carryover stays open until the work is accepted and billed; if the work order is cancelled, the amount must come back so it can be applied elsewhere. Block first, then prompt, then auto-return and cancel on accept (Rule 1).
7. **Cancelling an origin work order (2026-10-26).** If the work order a carryover started on is cancelled, no work happened, so the favor does not exist. The carryover is closed and every downstream work order gets an alert (Rule 1b). The app only alerts; it never removes carryover from downstream work orders or changes their billing.
8. **Admin only (2026-10-26).** All watchdog alerts, the dashboard list and the open balances modal are admin only.
9. **Modal details confirmed (2026-10-26).** Close reasons are a fixed list with free text on "Other"; aging bands and age-from-creation as written; a balance with an active pending application cannot be closed.

## Rule 1: block cancel while an amount is attached
- Trigger on `work_orders` (before update of `status`): if the new status is in the Cancelled category (looked up in `wo_statuses.category`, never by status number, per the app's customization rule) and the work order has any **active** row in `carryover_allocations` (pending or resolved), raise a plain message and refuse the change, for example: "This work order has carryover on it ($200.00). Remove or return it first, then cancel."
- **Work order screen (revised 2026-10-26):** when the admin sets the status to Cancelled and the work order has carryover on it, the app first shows a prompt, for example: "This work order has $200.00 of carryover. Return it to the customer's open balance and cancel?" Accept: the app switches off the active applications (returned, with reason "work order cancelled"; the amount goes back on the balance, like removing it with the v5.14 tools) and then cancels. Decline: nothing changes.
- **Everywhere else** (bulk edits, direct updates): the database refuses the change with the plain message above, because there is no prompt. The admin returns the carryover first, then cancels.
- Applies to every path, because the block lives in the database. Scope is any active application, pending or resolved (confirmed 2026-10-26).
- The screen shows the database message as is, in the same inline error place the status change already uses, when the prompt is not used.
- Rows already switched off (returned or removed) do not block.

## Rule 1b: cancelling the origin work order of a carryover (added 2026-10-26)
- The **origin** work order is the one the carryover entry started on. If it is cancelled, the favor was never earned, so the entry should not stay on the customer's open balance.
- On the work order screen, a prompt: "Cancelling this also cancels $200.00 of carryover that started on it. Continue?" Accept: the carryover entry is closed with reason "origin work order cancelled" and the cancel goes through. This is not blocked.
- **Downstream:** every work order with an application against that entry gets an alert, and a line on the Daily Dashboard "Carryover to follow up" list, saying the carryover on it no longer exists. Admin only. The app only alerts; it does not remove carryover from those work orders or change hours, parts or amounts. The admin adjusts the billing.
- The alert clears when the admin dismisses it or the downstream application is returned or removed.
- Expected to be rare.

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
- **Age** is days since the carryover entry was created. Bands: Current is 0 to 29 days, 30 is 30 to 59, 60 is 60 to 89, 90+ is 90 and over (confirmed 2026-10-26).
- **Alerts are set in Settings, and a threshold being exceeded means "review".** Four Settings fields, each optional (blank = that alert is off, no built-in numbers): **days open** (a case older than this), **dollars per case** (one open balance over this), **cumulative dollars, company-wide** (total open across all carryover over this), and **cumulative dollars, per customer** (total open for any one customer over this). When any one is exceeded the admin gets a single alert and the Daily Dashboard shows a "Carryover review due" prompt with the band totals and the cases that tripped it. Each case alerts once per threshold, and each cumulative alert (company-wide, and each customer separately) once each time its total crosses the line, so nothing repeats daily. The prompt clears once the modal has been opened and the flagged cases reviewed (closed or looked at), and comes back only when a threshold is crossed again. Alerts go to the admin only.
- **Case ledger:** each carryover case opens to its own ledger: the origin (date, amount, note) and every application made against it, with date, work order, amount, status (pending, resolved, returned, removed), the quote state where it applies, who entered it, and the note. A running balance runs down the side. This is the audit view: it shows what was charged off to which work order and the notes that it was taken care of.
- **Ready to close prompt:** cases with a zero balance and nothing pending (fully applied and resolved) are grouped at the top as "Ready to close". The prompt reads like "These have a zero balance. Okay to close?", with a Close button per case and a "Close all ready" button. Nothing closes by itself; the admin confirms. A case that is zero only because an amount is still pending is not listed as ready.
- **Manual audit stays available:** the Ready group is a shortcut, not a replacement. Every open case can still be opened and reviewed one by one, and closed cases can be shown (toggle) with their full ledger. Cases that look off are flagged on the line: pending on a finished work order, a returned amount, or sitting in the 60 or 90+ band.
- **Close:** a Close button per line. It asks for a reason from a fixed list: "covered on a later job", "written off", "billed elsewhere", or "other"; choosing "other" shows a free-text field that must be filled in (confirmed 2026-10-26). It records who and when. A closed balance leaves the open list and no longer counts as owed. Nothing on any work order changes.
- **Closing is reversible:** closed entries can be shown with a toggle and reopened, with the audit trail keeping the history.
- **Blocked while committed:** an entry with an active pending application cannot be closed until that application is resolved or returned, so closing never hides an amount still committed to a work order.
- Data: closed state on `carryover` (`closed_on`, `closed_by`, `closed_reason`; the balance view excludes closed entries). Audited like the other carryover tables.

## What does not change
- Rejecting a quote, stopping tracking, and expiry still return pending applications (v5.17). Accepting still resolves them.
- The app still never changes a work order's hours or parts, and never reassigns a returned amount.
- Resolved applications stay resolved if the work order later finishes.

## Files touched (proposed)
- Migration `v5.xx_carryover_watchdog.sql`: the cancel-block trigger on `work_orders`, the alert check (extend `quote_check_all` or a sibling function it calls), alert type. Pre-check first; applied only on Kevin's explicit go-ahead.
- `app-carryover.js`: "Carryover to follow up" list for the Daily Dashboard, the open balances review modal with Close, and the cancel prompts on the work order screen (Rules 1 and 1b).
- The migration also adds the alert type `carryover_origin_cancelled` (Rule 1b) and the origin-cancel handling that closes the entry with reason "origin work order cancelled".
- The same migration adds the closed columns on `carryover` and updates the `carryover_balance` view, adds the alert types (`carryover_age`, `carryover_amount`, `carryover_total`, `carryover_customer_total`), and adds the Settings keys (`carryover_alert_days`, `carryover_alert_case_dollars`, `carryover_alert_total_dollars`, `carryover_alert_customer_dollars`), all blank (off) until set, with fields in Settings next to the quote ones.
- Per build: `index.html` cache busters, `app-core.js` version, `CHANGELOG.md`.

## Open items
- **Finished / billed:** settled 2026-10-22. By category, not status: Completed and Processed count as finished; Cancelled is the category the cancel block uses. Categories in `wo_statuses` today: draft (0-4), active (5-9), completed (10), processed (11, 12, 15), cancelled (99).
- **Cancel block scope:** settled 2026-10-26. Any active application, pending or resolved, blocks; the screen prompts to return the carryover and cancel (Rule 1).
- **Origin side:** settled 2026-10-26. Cancelling an origin work order closes the carryover and alerts downstream work orders (Rule 1b).
- **Who sees the alert:** settled 2026-10-26. Admin only.
- **Close reasons:** settled 2026-10-26. A zero-balance close from the Ready group fills the reason in itself ("Fully applied"), so closing a batch needs no typing. A manual close of a case with a balance uses the fixed list, with free text on "other".
- **Aging bands:** settled 2026-10-26. 0-29, 30-59, 60-89, 90+, counted from when the entry was created.
- **Alert thresholds:** Kevin sets the numbers in Settings (days, dollars per case, cumulative company-wide, cumulative per customer). Settled 2026-10-22: the cumulative alert covers both company-wide and per customer.
- **Close while committed:** settled 2026-10-26. Not allowed while an application is still pending.
