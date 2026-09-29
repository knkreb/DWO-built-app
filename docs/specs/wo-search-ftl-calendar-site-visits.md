# DWO Spec: Work Order Search, Field Travel Log Calendar, Site Visit History

Date: 2026-09-28
Baseline: DWO v4.87 (vanilla JS/HTML PWA, Supabase backend, Netlify hosting)
Status: #5 built (v4.91). #1, #2, #3 built (v4.92). #4 open pending Kevin's phasing decision.

## Ground rules for Claude Code
- Read the existing code before changing anything. Table names, column names, and file locations below are not confirmed. Verify them in the codebase and report anything that does not match.
- Keep changes minimal and match existing patterns and styling. Function over polish. Minimum taps in field UX (the technician uses an iPhone; Kevin uses Android and desktop).
- Validate locally before deploying. After deploy, report the commit and the new version number.
- Changes 1 to 3 and 5 are self-contained. Change 4 has a dependency (see its section). If the codebase turns out to make any change much larger than described, stop and report rather than expanding scope.

---

## Review findings (2026-09-28, before any build)

- **#1 (WO number search) and #2 (Clear filters):** confirmed buildable exactly as described. The ribbon bar is `.desktop-filter-bar` in `index.html` (title search, customer search, status/mode/flag dropdowns), all wired to `renderDesktopGrid()`/`filterDesktopGrid()` in `app-core.js`. Default view (for Clear) is title/customer empty, status "Live", mode "All Modes", flag "All WOs" — confirmed from `renderDesktopGrid()`'s own fallback values.
- **#3 (FTL monthly calendar):** confirmed Monday-start week convention (`drGetMonday()` in `field-travel-log.js`), and `drAddDays`/`drDateStr` are reusable for building a month view.
- **#4 (Site visit history):** the spec's assumption that geofencing "is NOT built yet" is wrong — it already exists. `locations.geofence_radius`, a default-radius setting, a map with drawable geofence circles (Location/Site Manager), and the existing FTL stop-detection already match GPS pings against known-site geofences to build day reviews. The GPS view likely needs less new work than assumed; needs a closer look at how much of "arrival/departure per site" is already computed via day_review's stop detection before scoping further. **Still open** — needs Kevin's phasing call (billed-time view first vs. GPS-first) before building.
- **#5 (module rename):** confirmed no "Equipment and Site" module exists anywhere in the app (no "Equipment" string in the codebase at all). The closest real thing was the **"Locations"** module. Kevin confirmed: rename to **"Sites"** (not "Site"), and do a full sweep — not just the nav label — since "Location" terminology is used extensively in the Field Travel Log GPS-stop-tagging workflow (tagging a GPS stop as a site uses the same underlying `locations` table), and leaving that inconsistent with a renamed nav item would create real UX confusion.

## 5. Rename the module label to "Sites" — DONE (v4.91)

Renamed ~35 user-facing strings across `index.html`, `app-core.js`, `field-travel-log.js`, and `app-tasks.js`:
- Navigation: hamburger item, desktop sidebar item, screen titles, desktop panel header, Settings tab label.
- Settings: "Location Manager" → "Site Manager", "Location Entity Types" → "Site Entity Types", "Tech home location" → "Tech home site", GPS/geofence settings labels ("Known location...", "Personal location...", "Unknown location...").
- The Locations/Sites module itself: all button labels, toasts, empty states, search placeholder, "Add/Edit site", nearby-sites list.
- Field Travel Log's GPS-stop-tagging workflow (mobile and desktop day review): "Save location" → "Save site", "Location name" → "Site name", "What type of location is this?" → "What type of site is this?", pending-review banner, all related toasts.
- Tasks: "Location Tasks" → "Site Tasks", "Location task" radio label → "Site task", the task form's "LOCATION" field header → "SITE".

**Deliberately left unchanged** (internal identifiers, table/column names, and generic English usage distinct from the Sites entity):
- Every internal identifier: `locations` table name, `location_id`/`location_type` columns, `LocState`/`DRState.locations` variables, function names like `renderLocationsPanel`/`locDeleteLocation`/`openLocationDetail`, screen/element ids like `screen-mobile-locations`, `desktop-panel-locations`, `sidebar-locations`, `loc-*` ids. Per the spec's own rule: label change only, no schema change, no internal renames.
- The task's internal `task_type` value `'location'` (data value, not display text).
- Three strings that use "location" in the generic English sense of "your current GPS position," not as the Sites entity: "Use my location" (button), "Getting your location..." (toast), and "Location captured — save to apply" (toast) — all on the "auto-fill coordinates from device GPS" button when adding/editing a site. Renaming these to "site" would be nonsensical ("Use my site" doesn't mean "use my current position"). Flagged for Kevin in case he wants these changed too for total consistency, but left as-is since they describe a different concept.

No schema changes, no data restructure, no internal identifier renames — matches the original spec's requirement.

---

## 1. Work order screen: search by work order number — DONE (v4.92)

**What:** Add a search field for work order number to the ribbon bar on the work order screen, alongside the other searchable attributes.

**Requirements**
- Partial match. Typing "1042" finds every work order whose number contains 1042 (for example 1042 and 21042).
- Sits in the ribbon bar with the existing search fields, using the same look and behavior as them.
- Works together with the other filters (all active filters combine).
- Filters as you type, in line with how the existing search fields behave.

**Acceptance**
- Entering a partial number narrows the list to matching work orders only.
- Clearing the field restores the list to whatever the other active filters produce.

---

## 2. Work order screen: "Clear filters" button — DONE (v4.92)

**What:** Add a "Clear filters" button to the same ribbon bar.

**Requirements**
- One tap resets every ribbon filter and search field, including the new WO number search, back to the default view of live work orders.
- "Default view" means exactly what the screen shows on a fresh load today (confirmed: title/customer empty, status "Live", mode "All Modes", flag "All WOs").

**Acceptance**
- After applying several filters and a WO number search, one tap returns the screen to the same state as a fresh load.

---

## 3. Field Travel Log (FTL): expandable monthly calendar — DONE (v4.92, desktop only)

**What:** Keep the current weekly display and add an expandable monthly calendar for faster navigation.

**Requirements**
- Keep the existing weekly display and its back/forward paging unchanged.
- Add an expandable monthly calendar (collapsed by default, expands on tap) above the weekly display.
- Tapping any day in the monthly calendar jumps the weekly display to the week containing that day.
- The monthly calendar should show which week is currently displayed and allow moving between months.
- Monday-start week convention confirmed (`drGetMonday()`); match it.

**Acceptance**
- From any week, the user can reach a week several months away in two or three taps instead of repeated paging.
- Selecting a day updates the weekly display to the correct week, and existing paging still works from there.

---

## 4. Site visit history ("when was I here")

**What:** On the Sites module, add a visit history for each site so the user can see in one place the dates people were on site, for example "Sept: 3, 4, 6, 9, 11, 15".

**Two sources, one selector**
- **GPS on-site:** arrival and departure at the site's location.
- **Billed time:** dates on which time was billed to that site.
- A selector switches between the two views.

**Scope and filters**
- Covers everyone in the company who is being tracked, not only Kevin.
- Filters: show all, show by tech, drill into a single tech.
- Searchable date range.
- Each visit is tagged with the tech.

**Display**
- Dates grouped by month, shown as a compact line, with older months collapsed beneath.
- Each date is tappable and opens the detail for that day (the work order or time entry behind it).
- Lives in the Sites module as a "Visit history" section.

**Dependency and phasing — revised per review findings above**
- **Billed time view:** buildable now from existing data (`hours_entries.location_id` already links time entries to sites).
- **GPS view:** geofencing infrastructure already exists (contrary to the original assumption) — needs investigation into how much of "arrival/departure per site" the existing day_review stop-detection already computes, before scoping as new work.
- **Open decision for Kevin:** confirm phasing (billed-time view first, GPS availability TBD) or say if GPS must come first.

---

## Order of work suggested
1. ~~Change 5 (label)~~ — done.
2. Changes 1, 2, 3 (small and independent).
3. Change 4, billed time view and selector (after Kevin confirms phasing).
4. Change 4, GPS view (after investigating existing stop-detection data).

## After deploy (Claude Code reports back)
- Commit hash and new version number.
- Any place where the code did not match the assumptions in this spec.
- Anything left undone and why.
