# Spec: Mobile punch-out loop (past days cannot be clocked out)

Status: SPEC ONLY, drafted 2026-11-04 from Kevin's report of 2026-10-28 and his retest of 2026-11-04 (still broken on v5.20). Nothing built. Needs "okay to build" with this spec named.

Baseline: v5.20, main c23c67d. `field-travel-log.js` and `app-morning-brief.js` read at that commit. Next build would be v5.21; re-check `APP_VERSION` and the end of `CHANGELOG.md` after `git fetch` before bumping.

Scope: give past, unclosed days a way to be clocked out from the Exceptions Queue, using a time picker with no preset time. No schema change, no database trigger, no new table, no change to `app-core.js`.

## The loop, as the code shows it

1. On mobile, a day in the Field Travel Log (FTL) that has a clock-in and no clock-out shows an **End of Day →** button (`mdrRenderDayBottom`, `field-travel-log.js` lines 4076-4077). It appears for any day being viewed, not only today.
2. The button calls `mdrGoToEndOfDay` (`app-morning-brief.js` line 674), which opens the Exceptions Queue.
3. The queue offers **Clock Out** only on today's card: `if (ex.isToday && !ex.clockOut)` (`app-morning-brief.js` line 849). A past day gets the red **Unclosed** flag and a single **→ FTL** button.
4. **→ FTL** (`eodGoToFTL`, line 983) sets `MDRState.selectedDate` to that day and opens the FTL day view, which shows the same End of Day → button. Back to step 1.

Nothing in that path can write a clock-out for a past day. The only other route is the small **Edit** button beside the punch row (`mdrEditPunch`, line 4583), which makes you step through clock-in first and pre-fills both times.

Desktop is not looped because the desktop FTL has its own Clock out button (`drEditClockOut`, line 1501). The queue function is shared, so the change below also reaches the desktop queue (Open question 3).

## Decision (Kevin, 2026-10-28): clock-out picker with no preset

A pre-filled time (the current time, or the clock-in time) lets a tired tap-through record a wrong clock-out on a past day. For a past day the person must say when they actually left, so the picker opens empty.

## Changes

**1. Exceptions Queue card** (`_eodRenderQueue`, `app-morning-brief.js`)

- On a card that is **not** today, has a clock-in, and has no clock-out, add a red **Clock Out** button beside **→ FTL**, same style as today's button. The data is already on the card object (`ex.clockIn`, `ex.clockOut`, `ex.date`).
- A past day with no clock-in does not get the button (nothing to close).
- Today's card is unchanged.

**2. New function `eodClockOutPast(dateStr)`** (`app-morning-brief.js`, next to `eodClockOut`)

- Opens the time picker (change 3) titled with that day's date, for example "Clock out, Mon Nov 2", with a blank start.
- On confirm: build the time on **that card's date** (`dateStr`), not on `MDRState.selectedDate`.
- Reject a time at or before that day's clock-in, with a toast naming the clock-in time; nothing is saved and the picker closes (the person taps Clock Out again).
- Write the day's `day_review` row for the queue's technician (the same tech `initEndOfDay` loaded) and `review_date = dateStr`: `clock_out` (ISO), `clock_out_backdated = true`, `clock_out_source = 'manual'`, `modified_by`, `modified_at`. Look the row up by tech and date and patch it by id, the way `dbDesktopPunchIn` does, with the refresh in the success callback. Do not use `mdrUpsertDayReview`, which keys on `MDRState.selectedDate`.
- On success: toast ("Clocked out Mon Nov 2 at 5:15 PM"), then reload the queue (`initEndOfDay` on mobile, `initEndOfDayDesktop` on desktop). On failure: toast "Could not save clock-out" and leave the day unclosed.

**3. Time picker blank mode** (`drShowTimePicker`, `field-travel-log.js` line 1416)

- Add an optional fifth parameter `blank`. Existing four-argument callers (clock in, edit punch, desktop clock out) are untouched and stay pre-filled.
- In blank mode the hour and minute boxes are empty with a "--" placeholder, and neither AM nor PM is selected.
- `drTpConfirm` today turns an empty hour into 12, an empty minute into 0, and an unselected AM/PM into PM (lines 1463-1465). In blank mode it must instead refuse: toast "Enter the hour, minutes and AM or PM", keep the picker open, call nothing.

## Acceptance checks

1. A past day with a clock-in and no clock-out shows **Unclosed** plus **Clock Out** and **→ FTL** on its queue card.
2. Tapping **Clock Out** opens the picker with the day's date in the title, empty hour and minute, and neither AM nor PM selected.
3. Confirm with an empty hour, an empty minute or no AM/PM: toast, picker stays open, nothing saved.
4. A time at or before the clock-in: toast, nothing saved.
5. A valid time saves `clock_out` on that day's row only, with `clock_out_backdated = true` and `clock_out_source = 'manual'`. Other days and today's row are unchanged.
6. The card's **Unclosed** flag clears and its On Clock hours now show. Other flags (Unreviewed, Gap) stay as they were.
7. Opening that day through **→ FTL** shows the Out time and no **End of Day →** button. No loop.
8. Cancel leaves the day unclosed.
9. Today's card behaves exactly as before.
10. Clock in, Edit punch and the desktop FTL Clock out still open pre-filled.
11. Desktop queue: the new button works the same way, and the desktop FTL is unaffected.
12. `node --check` passes on both changed files. Version bump, cache busters, CHANGELOG line, commit message `v5.21: ...`.

Test on a real day that needs closing (the loop reproduction). A wrong test entry can be corrected with the **Edit** button on mobile, or cleared with Clear in the desktop FTL clock-out picker (`drEditClockOut` allows Clear once a punch exists).

## Out of scope

- Today's Clock Out (still pre-filled with the current time; Open question 2).
- The End of Day → button on a past day in the FTL (Open question 4).
- Overnight shifts: the picker accepts times on the card's own date only.
- Break punches, day review status, submit and kickback logic.

## Open questions for Kevin

1. **Overnight:** is same-date-only acceptable? No part of the app handles a shift that ends after midnight today, so this spec does not either.
2. **Today's card:** keep the pre-filled picker (recommended, the current time is usually right for today), or make it blank too?
3. **Desktop queue:** it shares this code, so it gets the new button. OK, or mobile only?
4. **End of Day → on a past day:** leave it going to the queue (recommended, smaller change), or open the picker directly?

## Found while reading, not in this spec (needs Kevin's decision)

- **Today's Clock Out can write to the wrong day.** `eodConfirmClockOut` (`app-morning-brief.js` line 885) uses `MDRState.selectedDate || tzTodayStr()` as the date, and `mdrUpsertDayReview` also keys on `MDRState.selectedDate`. After **→ FTL** on a past card, `MDRState.selectedDate` is that past day. If the person then goes back to the queue and taps today's **Clock Out**, the time may be written to the past day's row instead of today's. Only `dashClockOut` resets the date to today first. Found by reading the code, not reproduced. A fix is one line (set the date to today before opening the picker), but it is outside this spec.
- The Unclosed flag is also raised for a past day with no clock-in at all (`!r.clock_out`, line 740). Harmless here because those days get no Clock Out button.
