# Spec: Past-day punch-out, phone Missing Clock-out alert, overnight shifts

Status: SPEC ONLY, drafted 2026-11-04 from Kevin's report of 2026-10-28, his retest of 2026-11-04 (still broken on v5.20) and his decisions of 2026-11-04. Nothing built. Needs "okay to build" with this spec named.

Baseline: v5.20, main c23c67d. `field-travel-log.js` and `app-morning-brief.js` read at that commit. Next build would be v5.21; re-check `APP_VERSION` and the end of `CHANGELOG.md` after `git fetch` before bumping.

Scope: four connected fixes. (1) Past unclosed days can be clocked out from the Field Travel Log day view with a blank time picker, which ends the loop. (2) The phone Morning Brief gets the same Missing Clock-out warning the desktop Daily Dashboard already has. (3) An overnight shift can be entered on purpose, behind a confirm prompt, and raises a warning for the admin. (4) Both punch-out windows say which day they are punching out, and today's Clock Out is fixed to always write to today. One small database migration (an alert trigger and a seeded setting); no new column, no new table; no change to `app-core.js`.

## The loop, as the code shows it

1. On mobile, an FTL day with a clock-in and no clock-out shows **End of Day →** (`mdrRenderDayBottom`, `field-travel-log.js` lines 4076-4077), on any day viewed, not only today.
2. It calls `mdrGoToEndOfDay` (`app-morning-brief.js` line 674), which opens the Exceptions Queue.
3. The queue offers **Clock Out** only on today's card (`ex.isToday && !ex.clockOut`, line 849). A past day gets the red **Unclosed** flag and a **→ FTL** button.
4. **→ FTL** (`eodGoToFTL`, line 983) opens that day's FTL view, which shows End of Day → again. Back to step 1.

Nothing in that path can write a past clock-out. The only other route is the small **Edit** button (`mdrEditPunch`, line 4583), which steps through clock-in first and pre-fills both times. Desktop is not looped because the desktop FTL has its own Clock out button (`drEditClockOut`, line 1501).

Where missed punch-outs show up today: the desktop Daily Dashboard has an orange "Payroll Alert, Missing Clock-out" box (`renderMorningBriefDesktop`, `app-morning-brief.js` lines 285-300, query at line 243). The phone Morning Brief has nothing like it. The End of Day queue flags Unclosed days on both, but only if you open it.

## Decisions (Kevin, 2026-11-04)

- A past day is clocked out from the FTL day view, where the stops and times are on screen, so the time is picked from what the log shows, not guessed. The picker opens blank (no preset). No reference line is added.
- The Exceptions Queue and the new phone alert send you to that day's FTL. Neither gets its own Clock Out button.
- Today's Clock Out keeps its pre-filled time, but its window is titled "Punch out today's shift" and it is fixed to always write to today (change 2b).
- Each punch-out window says which day it is for. Today: a regular window, "Punch out today's shift". Previous day: an amber window, "Punch out previous day", so the two look different.
- The Unclosed flag on past days with no clock-in at all is left as it is. Kevin plans scheduled days for later (a normal shift loaded for each user, for example Mon to Fri 8:00 AM to 5:00 PM, which would flag a forgotten punch-in or punch-out). That is not designed and not in this build.
- Overnight shifts are allowed through an "Overnight shift" checkbox on the picker, protected by a second confirm prompt.
- The admin gets a warning in the existing Alerts center (warn only). An approval mode is wanted later for other businesses; build only what keeps that door open.

## Changes

**1. FTL day view, bottom strip** (`mdrRenderDayBottom`, `field-travel-log.js`)

- If the viewed day (`MDRState.selectedDate`) is not today (`tzTodayStr()`), has a clock-in, and has no clock-out: the red button reads **Clock out** and calls `mdrClockOutPastDay()`. For today, the button stays **End of Day →** and behaves as now.
- Where a day's Out time is shown in the FTL day views (mobile bottom strip and timeline, desktop punch pill), add "(next day)" after the time when the clock-out falls on a later date than the day being viewed, comparing dates in the Settings timezone.

**2. New `mdrClockOutPastDay()`** (`field-travel-log.js`, next to `mdrClockOut`)

- Opens the picker in blank mode (change 3) as an amber window titled **Punch out previous day**, showing the day's date, how long ago it was, and the technician's name, for example "Mon Nov 2, 2 days ago, Jaden". The name matters because the admin may be viewing someone else's day. Amber is the colour the app already uses for its Gap and Unreviewed badges.
- Includes an unchecked **Overnight shift (clock-out is the next day)** checkbox.
- On Confirm:
  1. Build the clock-out on the viewed day, or on the next calendar day if Overnight is checked. Advance the calendar date by one day, then apply the typed time, in the phone's time zone as clock-in does today. Do not add 24 hours, so a daylight-saving night cannot shift the time.
  2. It must be after the day's clock-in. If it is not and Overnight is unchecked, show "That time is before the clock-in. Was this an overnight shift?" and keep the picker open; nothing is saved.
  3. Reject a clock-out more than 24 hours after the clock-in.
  4. If Overnight is checked, show a second prompt: "Overnight shift. This records your clock-out at 1:30 AM Tue Nov 4, the day after the shift began. Your admin will be notified. Is this really an overnight shift?" with **No, go back** as the primary button and **Yes, overnight shift** as the secondary. Back returns to the picker; nothing is saved.
  5. Save through `mdrUpsertDayReview` (in this flow `MDRState.selectedDate` is the viewed day): `clock_out` (ISO), `clock_out_backdated = true`, `clock_out_source = 'manual'`. Toast on success, and the day view reloads.

**2b. Today's Clock Out** (`eodClockOut` and `eodConfirmClockOut`, `app-morning-brief.js` lines 858-891)

- Retitle the window **Punch out today's shift**: a regular window, not amber, showing today's date and the technician's name. The time stays pre-filled with the current time.
- Fix the wrong-day write. Before opening the window, set `MDRState.selectedDate` to `tzTodayStr()` and `MDRState.tech` to the same technician the queue loaded for (`AppState.userTechId || MDRState.tech || first technician`, as `initEndOfDay` does). `eodConfirmClockOut` then uses that date instead of whatever day the log last showed, and `mdrUpsertDayReview` writes to that technician's row. `dashClockOut` already resets the date and gets the technician fix through the same function. The window's date and name come from these same values, so the title always matches what is written.

**3. Time picker blank mode** (`drShowTimePicker`, `field-travel-log.js` line 1416)

- Add an optional fifth parameter `opts` (`{ blank: true, overnightBox: true, amber: true }`; `amber` tints the window in the app's existing amber, `#faeeda` background with `#854f0b` text). The existing four-argument callers (clock in, edit punch, desktop clock out, today's Clock Out) are untouched and stay pre-filled.
- In blank mode the hour and minute boxes are empty with a "--" placeholder, and neither AM nor PM is selected.
- `drTpConfirm` today turns an empty hour into 12, an empty minute into 0 and an unselected AM/PM into PM (lines 1463-1465). In blank mode it must instead refuse: toast "Enter the hour, minutes and AM or PM", picker stays open, no callback.

**4. Phone Missing Clock-out banner** (`initMorningBrief`, mobile Morning Brief, `app-morning-brief.js`)

- Same query as the desktop (line 243): days before today with a clock-in and no clock-out, newest first, limit 20. A technician sees only their own days; an admin sees every technician's days with names, as the desktop does.
- Same orange banner as desktop, placed under the punch card. Each row: date, technician, clock-in time, and a **Fix in FTL** link. The link sets `MDRState.tech` to the row's technician as well as `MDRState.selectedDate`, then opens that day in the mobile FTL, where the new Clock out button is.
- Hidden when there are no missing days. The desktop alert is unchanged.

**5. Exceptions Queue**: unchanged. Past cards keep **→ FTL**.

**6. Database migration** `supabase/migrations/v5.21_overnight_punch_alert.sql` (applied to the live database before the JS is deployed, as with v5.20). It follows the alert pattern in `v5.10_work_order_nte.sql`.

- Seed `settings` key `overnight_punch_policy` = `warn`, using the `insert ... where not exists` form from v5.15. There is no Settings screen toggle in this build. `approve` is reserved for the future (see below).
- New trigger function `day_review_overnight_alert()` (security definer, `search_path = public`, grants revoked as in v5.10), fired after insert or update of `clock_out` on `day_review`. When the new `clock_out` is not null and its date in the Settings timezone (`settings.timezone`, default `America/New_York`) is later than `review_date`:
  - skip if an unresolved alert already exists for this `day_review` id with the same `clock_out`;
  - otherwise insert into `alerts`: `alert_type = 'overnight_punch'`, `severity = 'warning'`, `subject_table = 'day_review'`, `subject_id = day_review.id`, a ready-to-show message ("Overnight punch: Jaden clocked out at 1:30 AM Tue Nov 4 for the shift that began Mon Nov 3. Check that it is real."), and `details` with the day_review id, tech id, review date, clock-in and clock-out.
- A same-day clock-out raises nothing. An admin's own overnight punch raises an alert too; warn-only mode has no auto-approve.
- During the build, check whether the Alerts panel can open a `day_review` subject. If it cannot, the message carries the details and no link is built; anything more goes back to Kevin.

**7. Future approval mode (not built).** A setting value `approve`, a new `day_review.overnight_status` column (pending, approved), Approve and Reject on the same alert, and the existing **Accept day** button blocked while pending. Nothing in this build blocks that: the alert already holds the `day_review` id and the policy setting already exists.

## Acceptance checks

1. A past day with a clock-in and no clock-out shows a red **Clock out** in the FTL day view. Today's day still shows **End of Day →**.
2. The picker is an amber window titled "Punch out previous day", showing the date, how long ago and the technician's name, with empty hour and minute, neither AM nor PM selected, and Overnight unchecked.
3. Confirm with an empty hour, empty minute or no AM/PM: toast, picker stays open, nothing saved.
4. A normal time after the clock-in saves on that day only (`clock_out_backdated = true`, `clock_out_source = 'manual'`). The day view shows the Out time, the Unclosed flag clears in the queue, and no alert is raised.
5. A time before the clock-in with Overnight unchecked: the "Was this an overnight shift?" message, nothing saved.
6. Overnight checked: the second prompt appears. **No, go back** returns to the picker with nothing saved. **Yes** saves the clock-out on the next calendar day, and the Out time shows "(next day)".
7. A saved overnight punch raises one warning in the Alerts center (bell and Dashboard card) naming the technician, day and time. Saving the same time again raises no second alert; a different overnight time raises a new one.
8. A same-day clock-out raises no alert. A clock-out more than 24 hours after the clock-in is rejected.
9. Across the daylight-saving change on Sun Nov 1 2026, an overnight punch lands on the right next-day time. Test with a time outside the repeated 1 to 2 AM hour.
10. The phone banner shows a technician only their own missing days and shows an admin everyone's with names. **Fix in FTL** opens that day for that technician, and the banner is gone when nothing is missing.
11. The desktop Daily Dashboard alert and the Exceptions Queue behave as before.
12. Clock in, Edit punch, the desktop FTL Clock out and today's Clock Out still open pre-filled.
13. Today's Clock Out opens a regular (not amber) window titled "Punch out today's shift" with today's date and the right name.
14. Wrong-day regression: open a past day in the FTL, go back to End of Day, tap today's Clock Out. The clock-out lands on today's row and the past day is unchanged. As admin, view another technician's day first, then clock yourself out: it lands on your own row.
15. `node --check` passes on every changed JS file. Version bump, cache busters, CHANGELOG line, commit `v5.21: ...`. The migration is applied first.

Test on a real day that needs closing, and use a day you can correct afterward: a wrong test entry can be fixed with **Edit** on mobile, or cleared with Clear in the desktop FTL clock-out picker. An overnight test will raise a real alert; mark it Resolved.

## Out of scope

- Approval mode and a Settings toggle for it (change 7 describes how it would be added).
- The Exceptions Queue (it keeps its → FTL buttons), break punches, day review status, submit and kickback logic. Today's Clock Out changes only in its title and the wrong-day fix (change 2b); its pre-filled time stays.
- Scheduled days (a normal shift loaded per user that flags forgotten punches): planned later, not designed here.
- Overtime and payroll calculations. Overtime appears on the phone week summary, but this spec does not change it. Under warn-only, an overnight punch counts toward totals as soon as it is saved, and the admin corrects it if the warning shows it was a mistake.
- Desktop clock-out and **Edit** remain same-day only. Overnight punches are entered through the new picker; correcting one from the desktop is not covered.

## Found while reading, decided by Kevin 2026-11-04

- **Today's Clock Out can write to the wrong day. Decision: fix it in this build (change 2b).** `eodConfirmClockOut` (`app-morning-brief.js` line 885) uses `MDRState.selectedDate || tzTodayStr()` as the date, and `mdrUpsertDayReview` keys on `MDRState.selectedDate`. After **→ FTL** on a past card, `MDRState.selectedDate` is that past day. If the person then goes back to the queue and taps today's **Clock Out**, the time may be written to the past day's row instead of today's. Only `dashClockOut` resets the date to today first. Found by reading the code, not reproduced. The same stale value also decides which technician's row is written, so the fix sets both the date and the technician (change 2b).
- The Unclosed flag is also raised for a past day with no clock-in at all (`!r.clock_out`, line 740). Harmless here, because those days never get a Clock out button. Decision: leave it as it is for now (see Decisions).
