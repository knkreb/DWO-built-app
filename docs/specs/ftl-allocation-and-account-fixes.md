# Spec: Field Travel Log allocation and multi-account fixes

Status: SPEC ONLY, drafted 2026-10-27 from Kevin's notes of 2026-10-27. Nothing built. Needs "okay to build" with this spec named.

Baseline: v5.17, `field-travel-log.js` (read at main 011ab29). Next build would be v5.18; re-check `APP_VERSION` and the top of `CHANGELOG.md` after `git fetch` before bumping.

Scope: four Field Travel Log (FTL) fixes noticed while using the app (Fix 1, 1b, 2, 3). No schema change, no database trigger, no new table. Customers on mobile (Customers missing from the mobile menu) is deliberately NOT in this spec; it is parked on the mobile notes list in the open register.

## What the code showed (read before the decisions)
- There are two allocation surfaces on desktop. The older "Save to timecard" panel (`drOpenAllocPanel`, `#dr-alloc-panel`) is no longer reachable: `drStartAllocate` is defined twice and the later definition (~line 2863) opens the **Time & Billing modal** (`#tb-modal`, `drOpenBillingModal`). The Time & Billing modal is the "allocation window" Kevin means.
- The Time & Billing modal saves as you go: changing hours calls `tbSaveHours` (patches `hours_entries` straight away) and removing a block calls `tbRemoveBlock` (sets the entry inactive straight away). Its only exit is the X (`#tb-modal-close`, `tbCloseModal`), which re-renders the timeline. There is no button at the bottom.
- Each block in that modal already has an "Open Work Order" button (`tbOpenWorkOrder`), which closes the modal and calls `openWODetail(woId)`.
- The expanded stop tile shows the allocations as a read-only "Billing breakdown" table (customer, WO number plus T&M/Quoted badge, hours). The WO number is plain text. Nothing in the tile links to the work order.
- The mobile FTL is a separate implementation (`MDRState`, `mdrBuildAllocateSheet`). Its allocate sheet already has a full-width Save button at the bottom that saves and closes, and its tile has no breakdown table. This spec changes desktop only unless Kevin says otherwise (Open question 4).

## Fix 1: Tap an allocated work order to open it or edit just that allocation
Kevin's request: after time is allocated, expanding the stop tile should let you click the work order you allocated to, so you can edit or change the allocation. On a long work order you do not want to scroll through its entries; you may only want to adjust the one you just made.

- In the expanded tile's Billing breakdown (both the confirmed-multi-account branch and the single-location branch), the WO number becomes tappable.
- Tapping it shows a two-choice popover next to the row:
  1. **Edit this allocation**: opens the Time & Billing modal for that stop, scrolled to that block with the block highlighted, so the hours can be changed or the block removed without opening the work order. (Changing which work order a block is allocated to is Fix 1b, the Change work order button.)
  2. **Open work order**: opens the full work order (`openWODetail(woId)`), the same as the modal's existing button.
- Choosing nothing dismisses the popover; tapping elsewhere in the tile still toggles it as today.
- Implementation shape: reuse `drOpenBillingModal(idx)` and add a one-shot `TBState.focusBlock` so `tbRenderRows` scrolls to and marks the chosen block. No new editor.
- No data change. Allocation, hours entry and billing-minimum logic are not touched.

## Fix 1b: Change work order button on each allocation block (added 2026-10-27, Kevin)
Kevin's decision: mistakes will happen, so correcting an allocation to the right work order must take the least friction. Remove-and-add is not enough; add a Change work order button.

- Each block in the Time & Billing modal gets a **Change work order** button beside the existing Open Work Order button.
- Tapping it opens the same pickers used by "Add work order" (`tbRenderCustList` / `tbRenderWOList`, or the vendor list on vendor stops), in a "change" mode (`TBState.changeBlockIdx`). To keep taps low, it opens straight on the **work order list for the block's current customer** (the usual mistake is the wrong job for the right customer), with the back arrow going to the customer list for a different customer. The current work order is shown in the list marked "current".
- Choosing a work order **moves** the allocation; it does not create a second one. Hours, hours type, paid and billable are kept. The block shows the new customer, work order number and T&M/Quoted badge, and a toast confirms ("Moved 1.50h from P26001 to P26002").
- Data change, on that one existing `hours_entries` row only: `work_order_id`, `descriptor` (new WO number, tech and title, same format as Add work order) and `modified_by` / `modified_at`. No row is created or deleted. Rows are updated by entry id (see below), never by work order + date.
- **Entry id on the allocation (required by this fix).** Allocations today do not carry their `hours_entries` id, which is why `tbSaveHours` and `tbRemoveBlock` find rows by work order + tech + date. This build adds `entryId` to each allocation (set from the saved row in `tbSelectWO` and from the entry in `drRebuildAllocationsFromEntries`) and uses it for Change work order, hours edits and remove. That also closes the existing risk in "Blast radius and risks" for those three actions.
- Target list shows live work orders only (as Add work order does today). The back arrow cancels the change and returns to the blocks with nothing altered.
- Not allowed when the **current** work order is in the Processed category (Batch Invoice Process and later; decision 5): the button shows a short message ("This work order has gone to invoicing; adjust it from the work order") and changes nothing. The same check applies to the hours edit and Remove on such a block only if Kevin asks; this spec does not change those.
- "New work order" in the list works as it does for Add work order and, in change mode, moves the allocation to the newly created work order.

## Fix 2: Save & Close button on the allocation window
Kevin's request: the allocation window only has an X at the top right; add a Save & Close button at the bottom that returns to the FTL.

- Add a full-width **Save & Close** button in a footer at the bottom of the Time & Billing modal (`#tb-modal`), always visible (not scrolled out of view on a long list).
- Because the modal already saves each change as it is made, the button does not need a new save path. On tap it: (a) blurs the focused field first so a half-typed hours value fires its `onchange` save, (b) then runs `tbCloseModal()` (which re-renders the timeline).
- The X stays.
- Recommendation on Cancel (Kevin's open question): **no separate Cancel button.** Changes are already saved when made, so a Cancel would suggest it undoes them and it would not. If an undo is ever wanted, that is a different feature.
- The unreachable older panel (`#dr-alloc-panel`, "Save to timecard") is left alone; do not delete it (CLAUDE.md: comment out, never hard-delete). Whether to retire it is a cleanup for later.

## Fix 3: "None of these" does nothing on a multi-account stop (revised 2026-10-27, Kevin)
Kevin's report: at a site with several accounts, when none of the suggested accounts is right, tapping "None of these" does nothing. Kevin's direction: the right answer may be a closer neighboring site that is already in the Sites/Locations database but did not show up as a match; let him select it, and still allow creating a new one.

- Cause (confirmed in code): in the multi-account unresolved branch (~lines 1185-1210) the "None of these" button calls `drStartIdentify(origIdx)`, which sets `DRState.identifyIdx` and re-renders. Only the single-account branch (~line 1181) checks `DRState.identifyIdx` and shows the form, so the multi-account branch re-renders the same checkboxes.
- Why a neighbor can be missed: a stop only matches sites whose own geofence (default 100 m, per-site `geofence_radius`) contains the stop. A site just outside its radius, or with slightly off coordinates, is never offered.
- New behavior: "None of these" opens a **Nearby sites** step in the same place as the checkboxes:
  1. **Nearby list:** active sites from `DRState.locations` not already offered as matches, nearest first by straight-line distance from the stop (`drHaversineMeters`), each with its name, customer and distance (e.g. "140 m"). The list covers sites within the association radius (3 x `geofence_radius_default`, 300 m today), because that is the radius the app uses to re-attach saved time entries to a stop after a reload (`drRebuildAllocationsFromEntries`). Do not offer sites beyond it in this list.
  2. **Search box:** finds any active site by name or customer. A result farther than the association radius is shown greyed with "Too far from this stop (N m) to assign; create a new site instead", and cannot be selected (otherwise its saved time would not re-attach after a reload).
  3. Tapping a site **assigns it to the stop**: `stop.location` and `stop.confirmedAccounts` are set to that site (billable default from the site, as `drSelectStopLocation` does), and the choice is saved to the day review the same way the existing picker saves it (`day_review.stop_locations[arrivedAt] = locationId`). No new site row is created and nothing about the site changes.
  4. **Create a new site** button at the bottom opens the existing identify form (`drRenderIdentifyForm` / `drSaveIdentify`), unchanged: it saves a new pending site at the stop's coordinates.
  5. **Back to accounts** returns to the checkboxes with the list intact.
- **Reload fix required by this:** `drProcessAndRender` (~line 572) only restores a saved stop location when the stop still has two or more geofence matches. A neighbor chosen outside the geofence has none, so the choice would vanish on reload. Change the restore so a saved id is resolved against all of `DRState.locations` when the stop has no resolved location, keeping the existing logic for stops with matches unchanged. A saved id whose site is no longer active leaves the stop unresolved, as today.
- Also applies to **Identify this stop** (stops with no match at all): the same Nearby sites step comes first, with Create a new site below it, so near-miss sites are not duplicated. See Open question 6.
- Out of scope: widening a site's geofence or correcting its coordinates when a near miss shows it is off. Note it to Kevin in the reply if a site looks wrong while testing.

## Decisions needed from Kevin (open questions)
1. **Cancel button: SETTLED 2026-10-27 (Kevin).** No separate Cancel. Kevin's goal is a clearer, more logical way out than the X, which Save & Close gives (see Fix 2).
2. **Changing the work order on an allocation: SETTLED 2026-10-27 (Kevin).** Add a Change work order button on each block (Fix 1b), not remove-and-add.
3. **"None of these" result: SETTLED 2026-10-27 (Kevin).** Offer nearby existing sites to select first, and still allow creating a new one (Fix 3).
4. **Mobile (still open):** this spec changes desktop only. Does the mobile FTL need the same three fixes? The mobile tile has no breakdown or work-order link, and the multi-account panel was not checked on mobile. If yes, say so and it becomes a second slice after a read of the `mdr` code.

5. **Invoiced source work order: SETTLED 2026-10-27 (Kevin).** Blocked. Kevin's rule: from Batch Invoice Process (11) onward the work order has effectively gone to QuickBooks, so time cannot be moved off it. Implemented by status category (Processed: today 11, 12, 15), never by status number, so a status added later to that category is covered. Completed (10) is still movable.

6. **Identify this stop (new):** should the same Nearby sites step also come first for stops with no match at all, so near-miss sites are picked instead of duplicated? Recommended: yes, one shared step; small extra work.

## Blast radius and risks
- Low to medium. One module, no schema, no triggers, no change to saved data shape.
- Fix 3 is no longer render-only: it assigns an existing site to a stop and changes how a saved stop location is restored on load (`drProcessAndRender`). It writes only `day_review.stop_locations`, the same field the existing account picker already writes. It touches which site a stop belongs to, which feeds the billing breakdown, so it gets its own regression checks (11-18).
- Fixes 1 and 2 sit next to allocation edits, which feed billing hours and invoicing, so they get one targeted regression test (below).
- **Existing risk, now handled in this build (recommended, Kevin to confirm):** `tbSaveHours` and `tbRemoveBlock` find the `hours_entries` row by work order + tech + date only, not by location. If the same work order is allocated at two stops on one day, editing one block can patch the other stop's entry. Fix 1b needs the exact row, so allocations carry `entryId` and all three block actions (hours, remove, change work order) use it. That changes which row is patched in existing actions, so check 10 and C6 test it.
- **Billing side effects to confirm while building:** moving time between a T&M and a quoted work order changes how it bills (the tile's mixed-mode warning already covers display). Check whether the quoted-billing, NTE and carryover modules (`app-quoted-billing.js`, `app-wo-nte.js`, `app-carryover.js`) read `hours_entries` live or cache totals; if any cache, Change work order must trigger their refresh. If one does and the refresh is not simple, stop and report to Kevin before shipping.

## Acceptance checks
Allocation (Fixes 1 and 2):
1. Expand an allocated stop: each WO number in the Billing breakdown is tappable; tapping shows exactly two choices.
2. "Open work order" opens the full work order for that allocation.
3. "Edit this allocation" opens Time & Billing with that block in view and highlighted, the other blocks unchanged.
4. Change hours on that block and close: the tile breakdown, the GPS-versus-allocated warning, the "(min Nh)" note and the timecard all match the new hours; total allocated equals the sum of blocks.
5. Remove a block and close: the entry is inactive on the timecard and the tile updates.
6. The footer Save & Close is visible on a stop with many blocks without scrolling the list.
7. Type a hours value and tap Save & Close without leaving the field first: the value is saved.
8. The X still closes the window as before.
9. A stop with both T&M and quoted allocations still shows the mixed-mode warning and correct badges.
10. Same work order allocated at two stops on one day: record what editing one block does to the other (see the existing risk). Do not ship a change here without Kevin's decision.

Change work order (Fix 1b):
- C1. Block shows Change work order; tapping opens the WO list for that block's customer with the current WO marked; back arrow goes to the customer list; back from the list leaves the block unchanged.
- C2. Pick another WO of the same customer: the block, the tile breakdown, the timecard and the hours entry all show the new WO; hours, hours type, paid, billable are unchanged; no second row is created.
- C3. Pick a WO of a different customer: customer name and badge update to the new customer.
- C4. T&M to quoted and quoted to T&M moves: badge and tile mixed-mode warning correct; the quoted-billing, NTE and carryover figures on both work orders match the new allocation (or are refreshed).
- C5. Vendor stop: the vendor list is used; a move works.
- C6. Same WO allocated at two stops on one day: change or edit one block and confirm the other stop's entry is untouched.
- C7. Current WO in Batch Invoice Process (11), Invoiced (12) or Invoiced Outside DWO (15): Change work order shows the message and changes nothing; at Completed (10) it still works.
- C8. Reload the FTL after a move: the allocation rebuilds on the new WO (entry id present), and editing it again still hits the right row.
- C9. "New work order" from the list in change mode moves the allocation to the new WO.

Multi-account and nearby sites (Fix 3):
11. Multi-account unresolved stop: "None of these" shows the Nearby sites step, not the checkboxes again.
12. The nearby list excludes the sites already offered as matches, is sorted nearest first, shows distances, and only includes sites within the association radius.
13. Pick a nearby site: the stop resolves to it, the tile and billing breakdown use it, and a toast confirms. No new site row is created (check the Sites screen).
14. Reload the day: the chosen site is still on the stop, and any time already allocated to it re-attaches to that stop.
15. Search finds a site by name; a result farther than the association radius is greyed and cannot be selected.
16. Create a new site from the step: the identify form and save behave as before (pending site at the stop's coordinates) and the stop resolves.
17. Back to accounts returns to the checkboxes with the account list intact; Confirm, Mark not billable and Undo merge still work, including on a merged stop.
18. Stops that already resolve by geofence (single match, or multi-account confirmed from the checkboxes) restore after reload exactly as before.
19. "Identify this stop" on a no-match stop shows the Nearby sites step first (if Open question 6 is approved) and still reaches the identify form.

General:
20. `node --check` passes on every changed JS file; `APP_VERSION` and cache busters bumped; CHANGELOG line added; commit message `v5.18: ...`.
21. Tested on desktop (Kevin) before deploy. If mobile is added later (Open question 4), also on Jadyn's iPhone.

## QC gate
Per the QC framework rule, a full gate is not recommended here (no trigger, no schema, one module). Recommended: acceptance checks 4, 5 and 10 are the gate; the rest are quick visual checks.

## Out of scope
- Customers missing from the mobile menu (parked on the mobile notes list).
- Retiring the unreachable `#dr-alloc-panel`.
- Any change to how hours are billed. Matching blocks to their `hours_entries` rows by entry id is in scope (Fix 1b).
