# Spec: Field Travel Log allocation and multi-account fixes

Status: SPEC ONLY, drafted 2026-10-27 from Kevin's notes of 2026-10-27. Nothing built. Needs "okay to build" with this spec named.

Baseline: v5.17, `field-travel-log.js` (read at main 011ab29). Next build would be v5.18; re-check `APP_VERSION` and the top of `CHANGELOG.md` after `git fetch` before bumping.

Scope: three Field Travel Log (FTL) fixes noticed while using the app. No schema change, no database trigger, no new table. Customers on mobile (Customers missing from the mobile menu) is deliberately NOT in this spec; it is parked on the mobile notes list in the open register.

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
  1. **Edit this allocation**: opens the Time & Billing modal for that stop, scrolled to that block with the block highlighted, so the hours can be changed or the block removed without opening the work order. (Changing which work order a block is allocated to = remove the block and use the existing "Add work order"; see Open question 2.)
  2. **Open work order**: opens the full work order (`openWODetail(woId)`), the same as the modal's existing button.
- Choosing nothing dismisses the popover; tapping elsewhere in the tile still toggles it as today.
- Implementation shape: reuse `drOpenBillingModal(idx)` and add a one-shot `TBState.focusBlock` so `tbRenderRows` scrolls to and marks the chosen block. No new editor.
- No data change. Allocation, hours entry and billing-minimum logic are not touched.

## Fix 2: Save & Close button on the allocation window
Kevin's request: the allocation window only has an X at the top right; add a Save & Close button at the bottom that returns to the FTL.

- Add a full-width **Save & Close** button in a footer at the bottom of the Time & Billing modal (`#tb-modal`), always visible (not scrolled out of view on a long list).
- Because the modal already saves each change as it is made, the button does not need a new save path. On tap it: (a) blurs the focused field first so a half-typed hours value fires its `onchange` save, (b) then runs `tbCloseModal()` (which re-renders the timeline).
- The X stays.
- Recommendation on Cancel (Kevin's open question): **no separate Cancel button.** Changes are already saved when made, so a Cancel would suggest it undoes them and it would not. If an undo is ever wanted, that is a different feature.
- The unreachable older panel (`#dr-alloc-panel`, "Save to timecard") is left alone; do not delete it (CLAUDE.md: comment out, never hard-delete). Whether to retire it is a cleanup for later.

## Fix 3: "None of these" does nothing on a multi-account stop
Kevin's report: at a site with several accounts, when none of the suggested accounts is right, tapping "None of these" does nothing.

- Cause (confirmed in code): in the multi-account unresolved branch (~lines 1185-1210) the "None of these" button calls `drStartIdentify(origIdx)`, which sets `DRState.identifyIdx` and re-renders. But only the single-account branch (~line 1181) checks `DRState.identifyIdx` and shows `drRenderIdentifyForm`. The multi-account branch never checks it, so it re-renders the same checkbox panel.
- Fix: in the multi-account branch, if `DRState.identifyIdx === origIdx`, render `drRenderIdentifyForm(origIdx)`; otherwise render the checkbox panel as now.
- Add a **Back to accounts** link on the identify form when it was reached from the multi-account panel, so a mis-tap does not strand the stop. Clears `DRState.identifyIdx` and re-renders.
- The identify form itself and `drSaveIdentify` are unchanged. After a successful save the stop has a location, so it leaves the unresolved branch as it does for single-account stops. Verify this on a real multi-account stop.

## Decisions needed from Kevin (open questions)
1. **Cancel button:** confirm no separate Cancel on the allocation window (recommended, see Fix 2).
2. **Changing the work order on an allocation:** is "remove the block and add the right one" enough, or do you want a "Change work order" action on the block itself? (Recommended: enough for now.)
3. **"None of these" result:** the identify form saves a **new site** (it does today for single-account stops). At an address that already has several accounts, that adds one more location at the same address, so the next visit shows one more candidate. Acceptable, or should "None of these" offer to pick another existing customer's location first? (Recommended: acceptable for now; the form already lets you search customers.)
4. **Mobile:** this spec changes desktop only. Does the mobile FTL need the same three fixes? The mobile tile has no breakdown or work-order link, and the multi-account panel was not checked on mobile. If yes, say so and it becomes a second slice after a read of the `mdr` code.

## Blast radius and risks
- Low to medium. One module, no schema, no triggers, no change to saved data shape.
- Fix 3 is render-only in one branch.
- Fixes 1 and 2 sit next to allocation edits, which feed billing hours and invoicing, so they get one targeted regression test (below).
- **Existing risk, not fixed here:** `tbSaveHours` and `tbRemoveBlock` find the `hours_entries` row by work order + tech + date only, not by location. If the same work order is allocated at two stops on one day, editing one block can patch the other stop's entry. Fix 1 makes single-block editing easier, so this is more likely to be hit. Recommended: Kevin decides whether to include a location match in this build or schedule it separately (it changes which row is patched, so it needs its own test).

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

Multi-account (Fix 3):
11. Multi-account unresolved stop: "None of these" shows the identify form (type, then search or name), not the checkbox panel again.
12. "Back to accounts" returns to the checkboxes with the account list intact.
13. Complete the identify form: the stop resolves to the new site, leaves the unresolved state, and the day's totals are unchanged.
14. Confirm / "Mark not billable" / "Undo merge" on a multi-account stop still behave as before, including on a merged stop.
15. A single-account unresolved stop's "Identify this stop" still works.

General:
16. `node --check` passes on every changed JS file; `APP_VERSION` and cache busters bumped; CHANGELOG line added; commit message `v5.18: ...`.
17. Tested on desktop (Kevin) before deploy. If mobile is added later (Open question 4), also on Jadyn's iPhone.

## QC gate
Per the QC framework rule, a full gate is not recommended here (no trigger, no schema, one module). Recommended: acceptance checks 4, 5 and 10 are the gate; the rest are quick visual checks.

## Out of scope
- Customers missing from the mobile menu (parked on the mobile notes list).
- Retiring the unreachable `#dr-alloc-panel`.
- Any change to how hours entries are matched or billed beyond what Open risk describes, unless Kevin decides it is in.
