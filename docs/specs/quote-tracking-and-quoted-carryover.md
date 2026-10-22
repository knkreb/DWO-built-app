# Spec: Quote tracking, and carryover on quoted work orders

Status: DRAFT from the 2026-10-22 design talk with Kevin. Not yet reviewed in full by Kevin. Do not build until Kevin says "okay to build" and names the slice (5a or 5b).

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

## Open items
- Does carryover go on quoted work orders for customers with an NTE at all? Assumed yes here (Kevin's own example, P26500 quoted at $2,000 under an NTE, is the origin side); confirm before 5b.
- A daily database check needs a scheduled job. Check that the Supabase project can run one (pg_cron) before building the alerts; if not, alerts are raised when the dashboard loads and the card and badges still work.
- Who may mark an outcome: admin only, as written. Say if a tech should be able to.
- Customers' own quote or approval rules are Kevin's to manage (see the purchasing-rules note in the carryover spec).

## Files touched (proposed)
- 5a: new `app-quote-tracking.js` (work order block, dashboard card hook), migration `v5.xx_quote_tracking.sql` (table, view, settings defaults, alert check), small hooks in `app-core.js` and `app-morning-brief.js`, settings fields.
- 5b: `app-carryover.js` (quoted targets, pending labels), migration changing the application guards and balance view.
- Per build: `index.html` cache busters, `app-core.js` version, `CHANGELOG.md`.
