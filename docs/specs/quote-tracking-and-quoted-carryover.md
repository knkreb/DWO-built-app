# Spec: Quote tracking, and carryover on quoted work orders

Status: Slice 5a BUILT and live as v5.15 (migration applied 2026-10-22). Slice 5b BUILT as v5.17 (migration `v5.17_carryover_quoted.sql` written, not yet applied; pending Kevin's go-ahead and test).

Baseline: main at v5.12; PR #12 carries v5.13 (carryover ledger) and v5.14 (edit applications), not yet merged. Related: `customer-thresholds-and-carryover.md` (section 3), `quoted-wo-billing.md`.

## Why
Quotes go stale with nobody noticing, and the app only knows a quote's progress through the work order status (Approval Request, Quote Request, Quoted, then work stages). There is no quote date, expiration date, or accepted / rejected flag; "accepted" in the quoted billing code means an invoice milestone accepted in QBO. Kevin wants a definite flag on a quote saying where it stands, with an expiration and a warning before it goes stale. Carryover applied to a quoted work order (slice 5b) depends on knowing the outcome.

## Decisions (Kevin, 2026-10-22)
- A definite, explicit quote flag (not inferred from the work order status).
- States: not sent, awaiting acceptance, accepted, rejected, expired.
- Expiration defaults to 30 days after the quote is sent; editable on each quote.
- The stale warning starts 7 days before expiration; the 7 is the default and is changeable (a setting, and a field per quote).

## Slice 5a: quote tracking

### Data
New table `quote_tracking`, one row per tracked quoted work order (`work_order_id` unique): `quote_state` (`not_sent`, `awaiting`, `accepted`, `rejected`), `sent_on`, `expires_on`, `decided_on`, `remind_days` (null = use the setting), `note`, created / modified / by, `active`. Expired is not stored: it is "awaiting and past `expires_on`", worked out in the view `quote_tracking_status` so it is correct without a nightly job. Settings keys: `quote_expiry_days` (default 30) and `quote_remind_days` (default 7), in Settings with the other defaults.

### Behavior
- Quoted work orders only (billing type quoted). Admin sets and changes everything; everyone signed in can read the flag.
- "Track this quote" creates the row (state not sent). **No backfill:** existing quoted work orders stay untracked until Kevin tracks them, so old quotes do not flood the dashboard.
- "Mark sent": state awaiting, `sent_on` today, `expires_on` = sent date + the default days (both dates editable).
- "Accepted" / "Rejected": state and `decided_on` (default today, editable) and an optional note. Re-sending a rejected or expired quote sets it back to awaiting with new dates.
- Stale: awaiting and within the reminder days of `expires_on` (amber); past `expires_on` shows Expired (red).
- Work order screen: a quote badge block (state, sent, expires, days left) with the buttons above. Same place as the NTE and CapEx blocks.
- Daily Dashboard: a "Quotes" card (admin) listing awaiting quotes by days left, stale in amber and expired in red, with customer, amount and an Open button.
- Alerts (once each per quote): `quote_stale` when it enters the reminder window, `quote_expired` when it passes `expires_on`. Dates passing is not a data change, so these come from a daily database check. The dashboard card and badge do not depend on it.
- Everything audited like the other tables.

## Slice 5b: carryover on quoted work orders (needs 5a)
- Quoted work orders become valid places to record a carryover application when the quote state is not sent, awaiting or accepted (not rejected or expired).
- On a not sent or awaiting quote the application is `committed_pending` (the carryover entry shows committed pending when nothing else is outstanding). On an accepted quote it is `resolved`.
- Quote becomes accepted: its `committed_pending` applications become `resolved`.
- Quote rejected or expired: its `committed_pending` applications are returned: the amount goes back on the carryover balance and shows as outstanding again, with a note of why. **The app never reassigns it on its own.** For expiry the balance views treat an application on an expired quote as returned straight away; the daily check then marks the rows returned and writes the audit trail.
- The Record application form and the Ledger show a "pending quote" label on these applications; the work order block shows them under the quote.
- As before, the app never changes a work order's hours or parts; this is the ledger only.

## Slice 5b as built (v5.17)
- A quoted work order can take an application only if its quote is **tracked** and not rejected or expired. Not sent / awaiting: the application is `committed_pending`; accepted: `resolved`. The database sets this (the app cannot choose it); untracked, rejected and expired quotes are refused with a plain message.
- Accepting a quote turns its pending applications into resolved. Rejecting a quote (or stopping its tracking) **returns** its pending applications: the row is switched off with `returned_on` and `returned_reason`, the amount goes back on the balance, and the ledger and the work order show a "Returned ... (Quote rejected)" line. Nothing is reassigned.
- Expired: the balance view stops counting pending applications on an expired quote at once, and the ledger shows them as "returned, quote expired". `quote_return_expired()` (run by `quote_check_all`, i.e. when the admin opens the Daily Dashboard) and any edit of that quote then write the returned rows, so a re-sent quote does not bring them back.
- Applications already resolved on an accepted quote stay resolved if the quote is later changed.
- Carryover on quoted work orders is allowed for NTE customers too (assumed; Kevin's P26500 example is the origin side).

## Open items
- Does carryover go on quoted work orders for customers with an NTE at all? Assumed yes here (Kevin's own example, P26500 quoted at $2,000 under an NTE, is the origin side); confirm before 5b.
- Alerts as built (5a): raised on save and when the admin opens the Daily Dashboard. pg_cron is available but not installed; a daily job is written in the migration, commented out, and needs Kevin's OK to enable.
- Who may mark an outcome: admin only, as written. Say if a tech should be able to.
- Customers' own quote or approval rules are Kevin's to manage (see the purchasing-rules note in the carryover spec).

## Files touched (proposed)
- 5a: new `app-quote-tracking.js` (work order block, dashboard card hook), migration `v5.xx_quote_tracking.sql` (table, view, settings defaults, alert check), small hooks in `app-core.js` and `app-morning-brief.js`, settings fields.
- 5b: `app-carryover.js` (quoted targets, pending labels), migration changing the application guards and balance view.
- Per build: `index.html` cache busters, `app-core.js` version, `CHANGELOG.md`.
