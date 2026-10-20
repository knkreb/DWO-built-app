# Break punches (live Start Break / End Break)

Status: scoped with Kevin 2026-10-20. Not built. Build only what this lists; anything else goes back to Kevin. Never build or deploy unless Kevin says the exact phrase "okay to build".

## Goal

A tech can punch out for a break and back in during the day. Breaks are unpaid and come off payable hours.

## Decisions (settled with Kevin)

1. Breaks are **unpaid**: break minutes are subtracted from the day's on-clock time.
2. **Unlimited breaks per day.** Lunch, a short break, an appointment: all the same thing, no break types.
3. The punch card gets a **Start Break / End Break** toggle with a running break timer, on desktop and mobile.
4. **Punch-out is blocked while a break is open.** The tech must end the break first. There is no auto-close at punch-out.
5. **Ending a break offers two choices: Now, or Enter a time.** Entering a time covers a forgotten End Break.
6. Breaks are shown, flagged and editable in these places:
   - Daily Dashboard payroll alert for an open break, in the same style as Missing Clock-out.
   - Each break as its own line in the day view, with payable time calculated net of breaks.
   - Office add, edit and delete of breaks after the fact, recorded in the audit log.
   - A visible mark on any break whose end (or start) was entered by hand rather than tapped live.

## What already exists (read before building)

- Table `day_breaks` exists, with a `break_end` that already allows null. Columns: `id`, `tech_id`, `review_date`, `break_start`, `break_end`, `created_at`, `created_by`, `modified_at`, `modified_by`. It has 0 rows as of 2026-10-20. The generic audit trigger `audit_day_breaks` (insert/update) is already on it (`supabase/migrations/v4.89_operational_audit_trail.sql`). No migration in the repo creates the table, so check the live schema before changing it.
- `dashAddBreak()` in `app-morning-brief.js` (desktop button at the punch card, also a mobile button) records a **finished** break: start and end typed together, saved with `sb.post('day_breaks', ...)`. Keep it, as the "I forgot to tap Start" path (see Add Break below).
- Breaks are subtracted from on-clock time in **one** place only: `_eodLoadQueue` in `app-morning-brief.js` (End of Day queue). The other on-clock calculations ignore breaks: `field-travel-log.js` (~lines 1551 and 3581) and `app-core.js` (~line 3452).
- Punch code: `dbDesktopPunchIn`, `dashClockOut`, `eodClockOut`, `eodConfirmClockOut` in `app-morning-brief.js`; `mdrClockIn`, `mdrClockOut`, `mdrEditPunch`, `mdrUpsertDayReview` in `field-travel-log.js`. Punches live on `day_review` (`clock_in`, `clock_out`, `*_backdated`, `*_source`).
- `day_review.payroll_minutes` exists but nothing reads or writes it. Do not start using it; compute net time live (see Net time below).

## Step 0: diagnose bug 17 first (punch card disagrees with payroll alert)

The break toggle sits on the punch card, so the card has to read punch state correctly first. Diagnose with SQL, then code, before building anything else. Report findings to Kevin.

Observed 2026-10-12: Kevin punched in on mobile; the desktop payroll alert showed Missing Clock-out for that punch, but the desktop punch card still said "Not clocked in today", even after a full reload.

Checked against the live database 2026-10-20: Kevin's admin login IS linked to a technician record (Kevin Reb), and his punches are saved under it (including the open-looking 2026-10-12 punch, 9:00 AM Eastern). So a technician mismatch is not the cause for Kevin's own login. Only the Test Admin login has no technician link.

Cause (strongly supported by the data, confirm with the 8 PM test below): the surfaces disagree about what "today" is.
- Mobile / Field Travel Log (`drTodayStr`) use the **local** date.
- Desktop Daily Dashboard (`initMorningBriefDesktop`, `dbDesktopPunchIn`, `dashClockOut`, `dashAddBreak` and others in `app-morning-brief.js`) use `new Date().toISOString().slice(0,10)`, which is the **UTC** date.
- After 8 PM Eastern (EDT; 7 PM in winter) the UTC date is already tomorrow. The punch card looks for a `day_review` row with tomorrow's date and finds none ("Not clocked in today"), while the payroll alert (`review_date < today`) sees the same open punch as an earlier day and flags Missing Clock-out. A reload does not help. This matches the report exactly.
- Evidence (2026-10-20): the 2026-10-12 punch row was created 10:31 AM Eastern, dated 10-12, and stayed open until the punch-out at 11:58 PM that night. The payroll alert only lists rows dated before the dashboard's "today", so it could only have listed a row dated 10-12 once the dashboard's "today" had become 10-13, which happens at 8 PM Eastern. So the symptom must have been seen between 8 PM and midnight. All of Kevin's punch rows since 10-01 have the correct date, so the saved data is fine; only the dashboard reading is wrong. The earlier timezone fix covered the Field Travel Log (it reads the timezone setting); the dashboards still use `toISOString()`.
- The mobile morning brief (`initMorningBrief`, line 43) reads with the same UTC date, so the phone has the same problem after 8 PM.
- To confirm: while punched in, open the desktop Daily Dashboard after 8 PM Eastern. Expect "Not clocked in today" on the card and a Missing Clock-out alert for today. Do not tap Punch In when it shows; that would create a punch for the wrong date.

Fix (if confirmed): one shared "today in local time" helper used by every punch, break and dashboard query. `new Date().toISOString().slice(0,10)` must not be used to mean today anywhere punch or break dates are read or written (11 places in `app-morning-brief.js` at last count; list them in the diagnosis). Breaks use `review_date` too, so the same helper applies to `day_breaks`.

Separate and still true: a login with no technician record (Test Admin today, or any future office or external user) has no punch record to attach to. That is handled by the user types work (see the User types spec), not here.

## Schema (additive only)

Migration file `supabase/migrations/v[X.XX]_break_punches.sql`. One step at a time; show Kevin the SQL before applying.

- `day_breaks.break_start_backdated boolean default false`
- `day_breaks.break_end_backdated boolean default false`
- `day_breaks.source text default 'live'` (values: `live`, `manual_entry`, `office`)
- `day_breaks.active boolean not null default true`. Delete is a soft delete (`active=false`), so the existing audit trigger records it. Every existing read of `day_breaks` (the `_eodLoadQueue` query is one) must filter `active=eq.true`.
- Partial unique index so a tech can have only one open break per day: unique on `(tech_id, review_date)` where `break_end is null and active`.

## Behavior

**Punch card states** (desktop Daily Dashboard card, and the mobile equivalent):

| State | Shows |
|---|---|
| Not clocked in | Punch In |
| Clocked in | Clocked in since [time], Start Break, Add Break, Punch Out |
| On break | On break since [time] with a running timer, End Break. Punch Out is hidden or disabled with the note "End your break to punch out" |
| Clocked out | Existing behavior |

**Start Break** records `break_start = now`, `break_end = null`, `source = 'live'`. One tap, no time picker. Only available while clocked in with no open break.

**End Break** asks Now or Enter a time.
- Now: `break_end = now`.
- Enter a time: time picker, saves `break_end_backdated = true`. Validation: end must be after start and not in the future.

**Punch-out guard.** Block clock-out while the tech has an open break on that day. This must cover **every** clock-out entry point: `dashClockOut`, `eodClockOut` and `eodConfirmClockOut`, `mdrClockOut`, and the clock-out edit in `mdrEditPunch` and the Field Travel Log desktop punch controls (`field-travel-log.js` ~1474-1482). Office edits that would set a clock-out while a break is open must make the office resolve the break first.

**Add Break (existing button).** Keep it for the forgotten-Start case. Save with `source = 'manual_entry'` and both backdated flags true. Reject overlap with another active break for the same tech and day.

**Break rules.** A break must fall inside that day's clock-in and clock-out (when a clock-out exists). Breaks for one tech and day may not overlap.

## Net time (single source of truth)

Add one helper in the new module, for example `netOnClockMin(dayReview, breaks, now)`: on-clock minutes (clock_in to clock_out, or to now for today's open day) minus the sum of closed break minutes minus the elapsed time of today's open break. Replace the on-clock calculations in `_eodLoadQueue`, `field-travel-log.js` (~1551, ~3581) and `app-core.js` (~3452) with it so every screen agrees. Billing-percentage and gap figures that use on-clock time then become net of breaks, matching what the End of Day queue already does.

## Alerts and display

- **Daily Dashboard payroll alert, open break:** flag any open break on a previous day, same style as Missing Clock-out, with a Fix in FTL link. Today's open break shows on the punch card with its timer and is not an alert.
- **Day view (Field Travel Log day header and day summary):** list each break as its own line (start, end, minutes, a mark when backdated) and show payable time net of breaks.
- **Office add / edit / delete (admin, desktop, Field Travel Log day view):** add a break, edit start and end, delete (soft). Edits set `source = 'office'` and `modified_by`/`modified_at`. All of it appears in the Audit Log; confirm the audit rows resolve a readable context for `day_breaks`.

## Not in this spec

- Break types, paid breaks, a break allowance or minimum, auto-deducted lunch.
- Mobile office editing (office edits are desktop).
- Any change to payroll export, `payroll_minutes`, or GPS stop logic.

## Open questions for Kevin before building

1. (Answered 2026-10-20) Kevin tracks his own time and has a technician record. Users with no technician record are covered by the separate user types spec.
2. (Answered 2026-10-20) No alert for long breaks. An open break today shows only on the punch card with its timer; the payroll alert covers open breaks on previous days only.

## Suggested build slices (one at a time, Kevin says "okay to build" for each)

1. Step 0: diagnose and fix bug 17 (shared tech-id function).
2. Schema migration (additive), then `app-breaks.js` with the net-time helper and the wiring into the four on-clock calculations.
3. Punch card states and Start / End Break on desktop and mobile, plus the punch-out guard at every entry point.
4. Payroll alert for open breaks on previous days, and the day-view break lines.
5. Office add / edit / delete in the Field Travel Log day view.

## Test plan

Use the Test User (field tech linked to a technician) and the Test Admin (no technician link). No GPS data needed. Check: start, end now, end with an entered time, punch-out blocked then allowed, two breaks in a day, overlap rejected, net time on the End of Day queue and the day view, previous-day open break shows on the dashboard alert, office edit and soft delete appear in the Audit Log, and the card and alert agree on mobile and desktop.
