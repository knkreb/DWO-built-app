# DWO Build Handoff — v4.41
**Date:** August 18, 2026
**Prepared for:** New chat session continuation

---

## Project Overview

Field service management system for Providence Mechanical (HVAC/mechanical contracting).
Long-term goal: multi-tenant SaaS FSM platform licensable to other field service companies.

**People:**
- **Kevin Reb** — owner/admin, desktop + Android tablet (Galaxy Tab A9+)
- **Jadyn Young** — field tech (male), Android, tablet for field use

**App:** `https://dwo-app.netlify.app`
**Supabase project ID:** `yrupnxlxgubfsjmptgxm`
**Current version:** v4.41, cache busters v=82
**Source files:** `app-core.js`, `field-travel-log.js` (new module), `app-morning-brief.js`, `app-subforms.js`, `app-filters.js`, `gps-engine.js`, `index.html`, `_redirects`

---

## North Star Architecture — LOCKED IN

**Philosophy:** GPS is evidence, not the ledger. Clock in/out is the authoritative record. The system supports accurate billing without making anyone a slave to it.

### Jadyn's Experience (Simple, Real-Time, Friction-Free):
1. Clock in → Morning Brief shows today's dispatched jobs
2. Arrive at site → GPS detects location → confirm WO with one tap (dispatched WOs surface automatically)
3. Leave site → GPS captures departure → system shows time on site → confirm hours → logged automatically
4. Unplanned stop → quick prompt: dismiss or assign
5. End of Day → gap summary before clock-out → account for anything significant → submit
6. Jadyn never does billing math — system does it using GPS timestamps

### Kevin's Experience (Dispatch and Verification):
1. Morning Brief → assign Jadyn to jobs for the day
2. Review submitted days → GPS vs billed comparison surfaced automatically
3. Flag discrepancies → approve or adjust
4. Reconciliation is exception handling only — not a daily chore

### Screen Purposes (North Star):
- **Morning Brief** → dispatch and intent for the day
- **Field Travel Log** → GPS narrative ONLY — where you were, merge fragments, read-only. NO WO assignment, NO allocation, NO account selection
- **WO Screen** → GPS time suggestions at that location, bill directly from WO
- **End of Day** → gap reconciliation before clock-out, Jadyn's accountability checkpoint
- **Reconciliation (Kevin only)** → exception report, GPS vs billed comparison, approve/adjust

### Billing Rules:
- T&M → log hours against WO, GPS confirms presence, professional judgment on duration
- Quoted → log hours internally for job costing, customer billed contract amount
- Small GPS gaps (< 15 min) auto-dismissed
- Large gaps flagged for explanation before clock-out
- Minimum billing is advisory, not enforced

### Auto-allocation (future):
- One dispatched WO + GPS confirms location = auto-allocate hours, flag for review
- Ambiguous = prompt for clarification
- Never force allocation — always allow override

---

## Current State — v4.41

### What's Working:
- GPS pipeline: Traccar Client → Supabase Edge Function (smooth-function) → location_event
- Field Travel Log (desktop) — GPS timeline, stop cards, drive segments, merge tool
- Morning Brief (mobile + desktop) — dispatch assignments, tasks, clock-in suggestion
- End of Day (mobile + desktop) — on-clock/billed/gap summary, clock-out
- Work Orders — full CRUD, quoted vs T&M, status management
- Time & Billing Reconciliation — desktop billing screen
- Location Manager, Vendors, Customers, Settings panels
- Checkbox merge tool on Field Travel Log — select multiple stops, merge into one
- Multi-account stop prompt — shows WOs per account when expanded
- Login screen logo — loads from Supabase storage

### Key Changes in v4.41:
- **Pure structural refactor — no behavior changes**
- Desktop Field Travel Log (`DRState` + all `dr*` functions) extracted from `app-core.js` into `field-travel-log.js`
- Mobile Field Travel Log (`MDRState` + all `mdr*` functions) extracted from `app-core.js` into `field-travel-log.js`
- `app-core.js` reduced from 10,640 lines to 6,643 lines
- `field-travel-log.js` created at 4,025 lines
- Moved blocks in `app-core.js` replaced with `/* MOVED TO field-travel-log.js — v4.41 — Aug 18 2026 */` markers
- `field-travel-log.js` added to `index.html` load order after `app-core.js`
- Cache busters bumped from v=81 to v=82

### Key Fixes in v4.38-v4.40 (carried forward):
- `AppState.userTechId` set once at login via `resolveUserTechId()` — authoritative tech identity
- `MDRState.tech` now uses `AppState.userTechId` as primary source everywhere
- Allocation save (`mdrSaveAllocations`) fixed — was using `DRState.tech` (wrong state object)
- Morning Brief dispatch save fixed — was failing with wrong tech ID
- Multi-account prompt now renders in correct branch (unresolved stops)
- Merge duration fixed — uses sum of stop durations, not wall clock
- "Merged" badge on collapsed stop cards
- "Undo merge" visible on unresolved multi-account merged stops
- WO number increments only on successful save, not on form open
- Login logo fixed — img element moved outside login-logo-mark div

---

## Pending Build Items — Priority Order

### NEXT BUILD — Field Travel Log Redesign (Major):
**Now lives in `field-travel-log.js` — all changes go there**

**Remove from Field Travel Log:**
- Multi-account "Select account" prompt
- WO assignment/picker
- Allocation panel
- All billing-related prompts

**Keep on Field Travel Log:**
- GPS stop cards (chronological, show all including merged secondaries)
- Drive segments
- Merge tool (checkbox select, merge button)
- "Mark not billable" for personal stops
- Clock in/out display
- "Merged" badge on grouped stops
- Undo merge

**Show all stop cards including merged secondaries** (don't suppress them):
- Merged badge on all cards in a merge group
- Drive segments remain accurate
- Field Travel Log = honest GPS narrative

**Move to Reconciliation/WO screen:**
- Account selection
- WO assignment
- Hours allocation

### Dispatch-Aware WO Picker:
- Dispatched WOs for that location/tech float to top of picker
- Everything else secondary/searchable
- Reduces overwhelming picker problem (e.g. 12 WOs at Sussex Academy)

### GPS Time Panel on WO Detail Screen:
- Bottom of WO detail shows GPS stops at that location
- Unallocated stops show "Bill this time to WO" button
- Bill directly from WO screen without going to reconciliation

### Jadyn Mobile Experience Redesign:
- Arrive at site → one tap to confirm WO
- Leave site → system shows time on site → confirm → logged
- End of Day → gap summary → clock out
- No billing math, no allocation complexity

### Merge Display Fix (Field Travel Log):
- Secondary merged stops should show (not be suppressed)
- All stops in merge group get "Merged" badge
- Drive segments between merged stops show correctly

### Morning Brief — Dispatch-Aware:
- When Jadyn arrives at location, surface only his dispatched WOs for that location
- Auto-suggest based on dispatch assignment + GPS match

### Parked (Future):
- Save/Close standard (X = discard, Save & Return = commit)
- RBAC/roles system (Owner, Admin, Dispatcher, Tech, Viewer) with per-user overrides
- Auto-allocation engine (dispatch + GPS = auto hours entry)
- Vendor invoice import fix
- Schema audit before Phase 2
- Phase 2: Clean FSM platform, fresh Supabase, multi-tenant from day one

---

## Standing Rules

- **Never build unless Kevin explicitly says go**
- **Always bump APP_VERSION and cache busters**
- **Always run `node --check` before shipping**
- **Jadyn is male**
- **Hold the build = stop immediately**
- **Array.isArray guards required on all JSONB array parsing**
- **merged_stops defaults to [] not {}**
- **Diagnose before building — SQL first, code second**
- **One step at a time on destructive SQL**
- **New features go in own module files — not app-core.js**
- **app-core.js is for core infrastructure only**
- **Modularization pattern: gps-engine.js, app-morning-brief.js, field-travel-log.js — follow this**
- **Comment-out pattern: moved code gets `/* MOVED TO x.js — vX.XX — date */` marker in app-core.js**
- **Matching note at top of receiving function in new module file**
- **One module extracted per build — move then test before changing behavior**

---

## Key Technical Details

### State Objects:
- `AppState.userTechId` — set once at login via `resolveUserTechId()` in `app-morning-brief.js` — AUTHORITATIVE tech identity
- `DRState` — desktop Field Travel Log state — lives in `field-travel-log.js`
- `MDRState` — mobile/tablet Field Travel Log state — lives in `field-travel-log.js`
- **DRState and MDRState must NEVER cross** — recurring bug source
- `AppState.userTechId` is primary source for tech ID everywhere — never use `drGetDefaultTech()` in mobile context

### GPS Architecture:
- Traccar Client on Android (Kevin + Jadyn)
- Traccar settings: Distance=0, Angle=0, Frequency=60s, Stationary heartbeat=60s, Stop detection=OFF
- Supabase Edge Function: `smooth-function` (display: location-receiver)
- Day boundary: 04:00 UTC (midnight Eastern)
- GPS ping queries need `&limit=10000`
- `longitude` column is `lng` not `lon`
- `timestamp` must be quoted in SQL (PostgreSQL reserved word)

### Merge Data Structure (day_review.merged_stops):
```json
[{
  "primaryArrivedAt": "2026-08-17T14:58:08+00:00",
  "mergedSegments": [
    {"arrivedAt": "...", "leftAt": "...", "durationMin": 75},
    {"arrivedAt": "...", "leftAt": "...", "durationMin": 38}
  ],
  "originalDurationMin": 119,
  "totalDurationMin": 232,
  "mergedAt": "2026-08-18T08:03:22.012Z"
}]
```
- `totalDurationMin` = sum of all stop durations (correct)
- `originalDurationMin` = primary stop's raw GPS duration before merge
- Never use wall clock calculation (arrivedAt to leftAt of last segment) — includes drive gaps

### Supabase Patterns:
- `timestamp` must be quoted in SQL
- Longitude column is `lng` not `lon`
- Day boundary: `timestamp >= 'YYYY-MM-DDT04:00:00Z' AND timestamp < '[next day]T04:00:00Z'`
- GPS ping queries need `&limit=10000`
- RLS enabled on all app tables
- `spatial_ref_sys` RLS false positive — safe to run: `REVOKE ALL ON spatial_ref_sys FROM anon, authenticated;`

### Key Supabase IDs:
- Kevin tech_id: `38f5a3aa-d572-4e85-b65c-70c3c8fce175`
- Jadyn tech_id: `48812660-3a1c-4610-9665-5f8075b4bd4d`
- Kevin Traccar tid: `KM`
- Regular hours_type_id: `ab7a1c43-88ad-490a-940f-ba291943ad5c`

### Geofence Notes:
- Auntie Anne's Dover Mall — DELETED (was causing false stop splits at Dover Mall)
- Dover Mall has 3 overlapping 350m geofences (Capital Expense, Service Contract R&M, Simon Properties) — by design, multi-account site
- GPS dead zone toggle available per location in Location Manager

### File Load Order (index.html):
```html
<script src="gps-engine.js?v=1"></script>
<script src="app-morning-brief.js?v=82"></script>
<script src="app-core.js?v=82"></script>
<script src="field-travel-log.js?v=82"></script>
<script src="app-subforms.js?v=82"></script>
<script src="app-filters.js?v=82"></script>
```

### Module Structure:
- `gps-engine.js` — GPS stop detection engine (extracted pre-v4.40)
- `app-morning-brief.js` — Morning Brief, End of Day, resolveUserTechId()
- `app-core.js` — core app infrastructure, WO screens, Vendors, Customers, Settings, Timecard
- `field-travel-log.js` — Desktop + Mobile Field Travel Log (DRState, MDRState, all dr*/mdr* functions) — **extracted v4.41**
- `app-subforms.js` — WO detail subforms (hours, parts, etc.)
- `app-filters.js` — WO list filters

### Dead Code Still in app-core.js (cleanup pass pending):
- `drFlushStop()` — orphaned helper, only called from old commented-out drDetectStops
- `drMatchLocation()` — same, orphaned
- `drHaversineMeters()` — redundant, gps-engine.js already exposes `window.drHaversineMeters`
- Old `drDetectStops` block — already wrapped in `/* DEPRECATED — moved to gps-engine.js — 2026-08-07 */`
- These will be swept up in next cleanup pass — do not delete mid-refactor

---

## WO Status Reference
| num | name | notes |
|-----|------|-------|
| 7 | In Progress | active work |
| 10 | Completed | export queue, NOT locked |
| 11 | Batch Invoice Process | LOCKED |
| 12 | Invoiced | LOCKED |
| 15 | Invoiced Outside DWO | manual QBO entries |
| 99 | Cancelled | LOCKED |

---

## Billing Data Needing Attention
- Aug 10 Dover Mall stops — manually inserted 2.4h to P26102 ✓
- Aug 17 Hillandale Farms merge — manually corrected to totalDurationMin=232 ✓
- Aug 11: 3.5h billed P26370 Surgery area warm ✓
- Aug 12: 2.0h billed P26371 Poolpak inspection ✓
- P26123 CHEER Controls — $9,010 final draw pending completion
- Two missing vendor invoices: 19525244-00 ($597.46) and 19720515-00 ($319.30)

---

## Phase 2 Notes (Future — Do Not Build Yet)
- Fresh Supabase project, multi-tenant from day one (`company_id` on all tables)
- Clean modular frontend — DWO is the working reference implementation
- RBAC with role templates + per-user permission overrides
- Schema audit before Phase 2 begins
- Migration = frontend swap, not data migration (Supabase backend is already final product's data layer)
- Supabase is correct platform for multi-tenancy (single DB + company_id + RLS)

---

## Build Change Log

### v4.41 — Aug 18 2026
**Type:** Structural refactor — pure move, no behavior changes
**Files changed:** `app-core.js`, `index.html`
**Files created:** `field-travel-log.js`
**Cache busters:** v=81 → v=82

**What moved:**
- Desktop Field Travel Log extracted from `app-core.js` lines 6132–9056 → `field-travel-log.js`
  - `DRState` object
  - All `dr*` functions: timezone helpers, week/day nav, stop detection wiring, timeline render, merge tool, identify stop, tag overlay, Time & Billing modal, map, day actions
- Mobile Field Travel Log extracted from `app-core.js` lines 9552–10640 → `field-travel-log.js`
  - `MDRState` object
  - All `mdr*` functions: day/week view, stop tagging, allocations, clock in/out, day submission, week summary

**What stayed in app-core.js:**
- All core infrastructure (AppState, sb, login, data loading, caching, realtime)
- WO list, WO detail, Export Review
- Time & Billing Reconciliation
- Vendors, Customers, Location Manager, Settings
- Timecard (lines 9057–9551 — between DR and MDR blocks)

**Markers left in app-core.js:**
- Line ~6133: `/* MOVED TO field-travel-log.js — v4.41 — Aug 18 2026 — Desktop FTL */`
- Line ~6637: `/* MOVED TO field-travel-log.js — v4.41 — Aug 18 2026 — Mobile FTL */`

**Why:** Modularization — app-core.js was 10,640 lines. Extracting FTL to its own module reduces it to 6,643 lines and sets up the FTL redesign (North Star architecture) to happen cleanly in field-travel-log.js without touching core infrastructure.

**Risk:** Low — pure copy/move. If anything breaks it's a load order or missing dependency issue, not a logic change. Restore by reverting to v4.40 files.

---

### v4.40 — Aug 18 2026 (baseline for this session)
**Type:** Bug fixes, state management
- `AppState.userTechId` authoritative via `resolveUserTechId()` at login
- `MDRState.tech` uses `AppState.userTechId` as primary source
- Allocation save fixed (was using wrong state object `DRState.tech`)
- Morning Brief dispatch save fixed
- Multi-account prompt renders in correct branch
- Merge duration uses sum of stop durations (not wall clock)
- "Merged" badge on collapsed stop cards
- "Undo merge" on unresolved multi-account merged stops
- WO counter increments on save only, not on form open
- Login logo fixed

### v4.38-v4.39 — (prior session)
- Extracted Morning Brief and End of Day into `app-morning-brief.js`
- `resolveUserTechId()` implemented — called once at login
- Fixed `DRState` vs `MDRState` state object crossing (root cause of multiple bugs)
- Auntie Anne's Dover Mall geofence deleted (was causing false stop splits)
- Traccar Client motion detection diagnosis — Distance/Angle filtering identified as GPS gap cause

### Pre-v4.38
- `gps-engine.js` extracted from `app-core.js` — speed-based stop detection
- Old `drDetectStops` commented out in `app-core.js` with `/* DEPRECATED — moved to gps-engine.js — 2026-08-07 */`
- Real work orders, vendor invoices, geocoded customer locations imported
- GPS pings live in `location_event`

### v4.42 — Aug 18 2026
**Type:** Bug fixes — merge logic
**Files changed:** `field-travel-log.js`, `app-core.js` (version bump only), `index.html` (cache busters)
**Cache busters:** v=82 → v=83

**Fix 1 — Merge bar never appeared when checkboxes checked**
- Function: `drToggleMergeSelect()` in `field-travel-log.js`
- Problem: Was looking for DOM element `id="dr-merge-selected-btn"` which doesn't exist. Merge bar is baked into timeline HTML and only shows/hides based on `mergeCount` at render time.
- Fix: Replaced dead button lookup with `drRenderTimeline()` call so merge bar appears/disappears correctly on each checkbox change.
- Before:
```javascript
var btn = document.getElementById('dr-merge-selected-btn');
if (btn) {
  btn.style.display = DRState.mergeSelected.length >= 2 ? 'inline-block' : 'none';
  btn.textContent = 'Merge ' + DRState.mergeSelected.length + ' stops';
}
```
- After:
```javascript
drRenderTimeline();
```

**Fix 2 — tbMergeStops wall clock duration bug**
- Function: `tbMergeStops()` in `field-travel-log.js`
- Problem: Was calculating total duration as wall clock from first arrival to last departure — includes drive time between stops.
- Fix: Sum individual `durationMin` values instead.
- Before:
```javascript
var totalMin = Math.round((new Date(lastStop.leftAt) - new Date(primary.arrivedAt)) / 60000);
```
- After:
```javascript
var totalMin = indices.reduce(function(sum, idx){ return sum + (stops[idx] ? stops[idx].durationMin : 0); }, 0);
```

**Fix 3 — tbMergeStops missing totalDurationMin in saved record**
- Function: `tbMergeStops()` in `field-travel-log.js`
- Problem: Merge record saved to `day_review.merged_stops` was missing `totalDurationMin`. On reload, restoration logic fell back to `originalDurationMin + segTotal` recalculation which could be inconsistent.
- Fix: Added `totalDurationMin: totalMin` to merge record.
- Before:
```javascript
var mergeRecord = {
  primaryArrivedAt: primary.arrivedAt,
  mergedSegments: [...],
  originalDurationMin: ...,
  mergedAt: new Date().toISOString()
};
```
- After:
```javascript
var mergeRecord = {
  primaryArrivedAt: primary.arrivedAt,
  mergedSegments: [...],
  originalDurationMin: ...,
  totalDurationMin: totalMin,
  mergedAt: new Date().toISOString()
};
```

**Note — downstream impact:**
`tbMergeStops` feeds `day_review.merged_stops` in Supabase → which feeds `drRenderTimeline()` on reload → which feeds the Reconciliation screen. Fix here corrects the number all the way through the chain.

**Technical debt noted — future refactor:**
Merge duration logic exists in two separate functions:
- `drMergeStops()` — FTL checkbox merge path — already correct (sums durationMin)
- `tbMergeStops()` — Time & Billing modal merge path — fixed in this build

These should be consolidated into one shared function so a fix in one place covers both paths. Queued for future cleanup pass.

### v4.43 — Aug 18 2026
**Type:** Bug fix — FTL merged stop display
**Files changed:** `field-travel-log.js`, `app-core.js` (version bump only), `index.html` (cache busters)
**Cache busters:** v=83 → v=84

**Fix — FTL stop card time range wrong on merged stops**
- Function: merge restoration block inside `drRenderTimeline()` in `field-travel-log.js`
- Problem: After merge restoration, `durationMin` was correctly updated to the merged total but `leftAt` on the primary stop was never extended to the last merged segment's end time. So the stop card header showed the primary segment's original end time (e.g. 1:57 PM) while `durationMin` correctly showed 1h 18m — a visible contradiction.
- The reconciliation screen (`drRenderBillingCol` in `app-core.js`) already extended `leftAt` correctly. FTL was missing the same logic.
- Fix: Added `leftAt` extension to FTL merge restoration to match reconciliation screen behavior.

- Before (FTL restoration — durationMin only):
```javascript
if (primaryStop) {
  if (m.totalDurationMin) {
    primaryStop.durationMin = m.totalDurationMin;
  } else {
    var segTotal = ...
    primaryStop.durationMin = m.originalDurationMin + segTotal;
  }
  // leftAt never updated — bug
}
```
- After (FTL restoration — durationMin + leftAt):
```javascript
if (primaryStop) {
  if (m.totalDurationMin) {
    primaryStop.durationMin = m.totalDurationMin;
  } else {
    var segTotal = ...
    primaryStop.durationMin = m.originalDurationMin + segTotal;
  }
  // Extend leftAt to last merged segment — matches reconciliation screen behavior
  var lastSeg = (m.mergedSegments||[]).reduce(function(latest, seg) {
    return (!latest || new Date(seg.leftAt) > new Date(latest.leftAt)) ? seg : latest;
  }, null);
  if (lastSeg && new Date(lastSeg.leftAt) > new Date(primaryStop.leftAt)) {
    primaryStop.leftAt = lastSeg.leftAt;
  }
}
```

**Note:** The reconciliation screen GPS column (1.30h for Dover Mall) is correct — it shows summed GPS stop durations, not wall clock. The 1:47–4:11 PM time range in the recon screen is display only (`leftAt` extended for context). These two numbers will not match and that is expected behavior — GPS time is on-site time, not total elapsed time at the location.

### v4.44 — Aug 18 2026
**Type:** Architectural decision — elapsed time replaces GPS durationMin everywhere in display and billing
**Files changed:** `field-travel-log.js`, `app-core.js`, `index.html` (cache busters)
**Cache busters:** v=84 → v=85

**Decision:** GPS `durationMin` is internal engine data only. All user-facing time values now use elapsed wall clock time (arrivedAt to leftAt). GPS fragmentation is invisible to users. If you were on site, you were on site — the elapsed window is the real number.

**New helper function added to field-travel-log.js:**
```javascript
// drElapsedMin — elapsed wall clock time for a stop (arrivedAt to leftAt)
// This is the authoritative time value for display and billing throughout the app.
// GPS durationMin is internal engine data only — never shown to users.
function drElapsedMin(stop) {
  if (!stop || !stop.arrivedAt || !stop.leftAt) return 0;
  return Math.round((new Date(stop.leftAt) - new Date(stop.arrivedAt)) / 60000);
}
```

**All changes — field-travel-log.js:**
- Stop card duration display → `drElapsedMin(stop)`
- Under/over billed comparison threshold → `drElapsedMin(stop)`
- Bottom strip "GPS total" label → "Elapsed", value → `drElapsedMin(stop)`
- Mobile summary strip "GPS time" label → "Elapsed", value → `drElapsedMin(stop)`
- Mobile paid/billed totals → `drElapsedMin(stop)`
- T&B modal `TBState.gpsMin` pre-fill → `drElapsedMin(stop)`
- T&B modal segment display and total → `drElapsedMin(stop)`
- Alloc panel "GPS:" label → "Elapsed:"
- Mobile alloc sheet "GPS:" label → "Elapsed:"
- Mobile tag sheet stop time display → `drElapsedMin(stop)`
- Map marker popup duration → `drElapsedMin(stop)`
- Hours pre-fill in `tbSelectWO` → `drElapsedMin(stop)`
- Hours remaining prompt text → "elapsed time"
- Identify panel stop time display → `drElapsedMin(stop)`
- `drAllocUpdateRemaining` remaining calc → `drElapsedMin(stop)`

**All changes — app-core.js:**
- Reconciliation screen totalGPSMin → sum of elapsed per stop
- Reconciliation "GPS time" summary label → "Elapsed"
- Reconciliation "GPS" column header (both table instances) → "Elapsed"
- `gpsH` in both stop forEach loops → elapsed wall clock calculation
- `reconcileCreateEntry` hours pre-fill → elapsed, label "GPS:" → "Elapsed:"
- `drBillingCreate` hours pre-fill → elapsed, label "GPS:" → "Elapsed:"

**What did NOT change:**
- `durationMin` on stop objects — still set by gps-engine.js, still used for merge record storage and internal engine logic
- `merged_stops` JSONB structure — `originalDurationMin`, `totalDurationMin`, `mergedSegments[].durationMin` unchanged
- Merge detection logic — still uses durationMin thresholds internally
- GPS engine (gps-engine.js) — unchanged

**Why Dover Mall showed 1.30h instead of 2.40h (the bug that drove this):**
GPS engine captured 78 minutes of stationary ping time across 6 fragments at Dover Mall. But Kevin was on site from 1:47–4:11 PM = 2.40h elapsed. GPS fragmentation from signal gaps, phone in pocket, and rooftop interference caused the discrepancy. Elapsed time is the correct billing basis.

### v4.45 — Aug 18 2026
**Type:** Feature — multi-account stop checkbox selector on FTL
**Files changed:** `field-travel-log.js`, `app-core.js` (version bump only), `index.html` (cache busters)
**Cache busters:** v=85 → v=86

**What changed:**
Multi-account stop expanded body replaced — old WO picker (overwhelming, wrong place) → simple checkbox list of account names. FTL now only asks "where were you?" not "what did you bill?"

**New UI flow — multi-account unresolved stop:**
1. Stop card expands → shows "Which accounts did you work at this location?"
2. All accounts pre-checked (most common case)
3. Uncheck any accounts not worked at
4. Hit Confirm → badge turns green "Confirmed", stop name shows "Account A + Account B"
5. Change button reopens the picker

**New stop states:**
- `isMultiAccount` — multiple geofence matches, not yet confirmed
- `isConfirmedMulti` — accounts confirmed, `stop.confirmedAccounts` array populated

**New stop object properties:**
- `stop.confirmedAccounts` — array of matched location objects (set on confirm or restore)
- `stop.location` — still set to `confirmedAccounts[0]` for backward compatibility

**Data model — `day_review.stop_locations`:**
- Single account: value stays as string `"loc-id-123"` (backward compatible)
- Multi-account confirmed: value saved as array `["loc-id-123", "loc-id-456"]`
- Restoration code handles both formats

**New functions:**
- `drConfirmStopAccounts(idx)` — reads checkboxes, saves array to Supabase, sets `stop.confirmedAccounts`
- `drClearStopAccounts(idx)` — clears confirmation, returns stop to unresolved state, removes from `stop_locations`

**Removed from FTL:**
- WO picker per account (overwhelming at sites with many open WOs)
- "Account only" button
- "Start new work order for this account" inline link
- Per-WO select rows

**What did NOT change:**
- Single account stops — unchanged, no prompt needed
- Unknown stops — identify flow unchanged
- `drSelectStopLocation()` — still used for single account legacy saves
- Merge/unmerge — unchanged
- All elapsed time math — unchanged

**Future:** Reconciliation screen and WO screen will use `confirmedAccounts` array to surface elapsed time context per account. Acceptance gate (v4.46) will check confirmed accounts as "addressed" stops.

### v4.46 — Aug 19 2026
**Type:** Bug fix + Feature
**Files changed:** `field-travel-log.js`, `app-core.js`, `index.html`
**Cache busters:** v=86 → v=87

**Fix 1 — Merged stop elapsed time (drElapsedMin)**
- Function: `drElapsedMin()` in `field-travel-log.js`
- Problem: Wall clock elapsed (leftAt - arrivedAt) on merged stops included gaps between segments — e.g. a lunch break at another location was being counted as billable time at the merged site
- Fix: `drElapsedMin` now checks for a merge record first. If found, uses `totalDurationMin` (sum of actual segment durations). Falls back to wall clock for non-merged stops.
- Rule: 10am-11am + 4pm-4:30pm = 1.5h billed, not 6.5h wall clock
- Same fix applied to reconciliation screen via `rcElapsedMin()` helper inside `renderReconcileBody()` — mirrors `drElapsedMin` exactly, must stay in sync

**Fix 2 — Manual coordinate entry in Location Manager**
- Function: `locRenderEditPanel()` and `locSaveEdit()` in `app-core.js`
- Problem: No way to manually enter coordinates when geocoding fails or address is unresolvable
- New fields added to edit form: Lat, Lng number inputs (pre-filled if coords exist)
- New button: "Use my location" — calls `navigator.geolocation.getCurrentPosition()`, fills lat/lng fields. Useful when standing at the site.
- Helper text: "or paste coordinates from Google Maps (right-click a spot → copy coords)"
- On save: if lat/lng fields are filled, saves coordinates directly and sets `geocode_status = 'office_verified'`. Skips geocoding entirely.
- New function: `locUseMyLocation()` — browser GPS capture

**Also fixed — geocode-address Edge Function (Supabase, not a JS file):**
- Added `GOOGLE_GEOCODING_API_KEY` secret to Supabase Vault
- Redeployed Edge Function with `location_id` support — now writes lat/lng back to `locations` table (previously only wrote to `customers`)
- Geocoding API confirmed enabled in Google Cloud Console

**Note — technical debt:**
`drElapsedMin` (field-travel-log.js) and `rcElapsedMin` (app-core.js) are two implementations of the same logic. Should be consolidated when field-travel-log.js functions are accessible from app-core.js context, or when reconciliation screen moves to its own module.

### v4.47 — Aug 19 2026
**Type:** GPS engine fix — accuracy-relative geofence matching
**Files changed:** `gps-engine.js` (v1.0 → v1.1), `app-core.js` (version bump), `index.html` (cache busters)
**Cache busters:** v=87 → v=88, gps-engine v=1 → v=2

**Root cause diagnosed from Aug 19 Sussex Academy data:**
GPS pings with accuracy 12-14m showed solid position on site. Occasional pings with accuracy 16-35m drifted 30-40m off true position — just outside the 100m geofence — triggering false exits and re-entries. One ping at 18:54 had accuracy=859m. Result: one continuous 2-hour visit fragmented into 5-8 minute stops with "drive" segments between them.

**Fix 1 — Accuracy-relative geofence matching (getMatchingLoc + getAllMatchesAt):**
If a ping's reported accuracy is worse than the geofence radius, that ping cannot reliably determine inside/outside status for that location. Skip it for geofence matching.
- Rule: `if (pingAcc > geofenceRadius) skip this location`
- Example: 200m geofence, ping accuracy=859m → skip. 200m geofence, ping accuracy=13m → match normally.
- Applied to both `getMatchingLoc` (single best match) and `getAllMatchesAt` (multi-account)

**Fix 2 — Hold window through inaccurate pings:**
When inside a known geofence window and a ping fails the accuracy check (can't match any location), don't treat it as a departure. Extend the window instead.
- Prevents false exits caused by temporarily inaccurate pings
- Window stays open, time extends to that ping's timestamp

**Fix 3 — Speed sanity filter:**
After accuracy filtering, remove any ping that implies speed > 120 mph from the previous ping. These are cellular/wifi position jumps, not real movement.
- Catches the dramatic position jumps visible on the map (Georgetown town center, then back to Sussex Academy)
- Applied as a second pass after the global accuracy threshold filter

**Effect on historical data:**
GPS engine runs at render time — re-processes raw pings each time a day loads. Deploy this fix and reload any affected day to get clean stop detection automatically. No SQL needed for future days.

**Manual merge records cleared (SQL — run before testing):**
```sql
UPDATE day_review
SET merged_stops = '[]'
WHERE review_date >= (CURRENT_DATE - INTERVAL '21 days')
AND tech_id = '38f5a3aa-d572-4e85-b65c-70c3c8fce175';
```
Clears manual merges from last 3 weeks so fixed engine re-processes cleanly. Note: deliberate merges (Hillandale Farms Aug 17) will need to be redone if still needed.

### v4.48 — Aug 20 2026
**Type:** GPS engine fix — two-condition departure rule
**Files changed:** `gps-engine.js` (v1.1 → v1.2), `app-core.js` (version bump), `index.html` (cache busters)
**Cache busters:** v=88 → v=89, gps-engine v=2 → v=3

**Root cause:** Sussex Academy Aquatics has a metal roof. Inside the building GPS signal is lost and the phone falls back to cell tower positioning, producing pings with accuracy 25-59m that wander 50-200m from true position — occasionally landing outside the 200m geofence. These false exits were fragmenting one continuous visit into 5-10 minute stop cards.

**The two-condition departure rule (v1.2):**
To confirm a departure from a known location, BOTH must be true:
1. **Good accuracy** — ping.acc <= DEPARTURE_ACC_THRESHOLD (default 25m)
2. **Actually moving** — speed > walking threshold (5 mph)

If either condition fails — stay on site:
- Poor accuracy + outside geofence = metal roof / signal loss → stay
- Good accuracy + stationary outside geofence = brief GPS wander → stay
- Good accuracy + moving outside geofence = real departure → close stop

**New setting:** `gps_departure_accuracy_threshold` — defaults to 25m. Can be adjusted in Settings → GPS if needed. Lower = stricter (fewer false stays), higher = more tolerant (fewer false departures).

**Validated against Aug 19 data:**
- On-site good pings: accuracy 4-17m → departure check active
- Metal roof drift pings: accuracy 25-59m → departure ignored, window held open
- Real departure at 20:02: accuracy 6m + speed 14 m/s → both conditions met, stop closed correctly

**Note:** `gps_departure_accuracy_threshold` setting key should be added to the Settings screen GPS tab for admin adjustment. Currently defaults to 25m via code fallback. Queued for next Settings build pass.

### v4.49 — Aug 20 2026
**Type:** GPS engine rebuild — simplified consecutive departure rule
**Files changed:** `gps-engine.js` (v1.2 → v1.3), `app-core.js` (version bump), `index.html` (cache busters)
**Cache busters:** v=89 → v=90, gps-engine v=3 → v=4

**Philosophy shift:** Stop trying to calculate departure from speed and accuracy math. Match physical reality instead:
- Arrival → good accuracy (outside, just drove in, clear sky)
- On site → accuracy degrades (inside metal building, signal blocked)
- Departure → accuracy improves (outside again, clear sky)

**New rule — consecutive good-accuracy departure:**
Require DEPARTURE_CONSEC_REQUIRED (default 3) consecutive pings with accuracy ≤ DEPARTURE_ACC_THRESHOLD (default 25m) all outside the geofence before closing a stop.

- Poor accuracy outside → noise/building interference → reset counter, stay on site
- 1-2 good accuracy outside → brief wander or single bad position → stay on site
- 3+ consecutive good accuracy outside → real departure → close stop

**State variable added:** `consecutiveOutsideCount` — reset to 0 on any inside ping or poor-accuracy outside ping, incremented on each good-accuracy outside ping.

**Settings keys (both defaulted in code, adjustable in Settings GPS tab — queued):**
- `gps_departure_consecutive` — default 3
- `gps_departure_accuracy_threshold` — default 25m

**Why v1.2 wasn't enough:** The two-condition rule (good accuracy + moving) still failed because calculated speed from position drift looked like real movement. Consecutive pings is a simpler and more reliable signal.
