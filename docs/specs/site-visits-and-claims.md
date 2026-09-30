# DWO Spec: Site Visits, Claims, Travel Allowance (replaces section 4 of wo-search-ftl-calendar-site-visits.md)

Status: DRAFT for Kevin's review (2026-09-30). Nothing here is approved to build.

## Why this exists
Investigation (read-only, 2026-09-30) found:
- GPS stops are not stored. `gps-engine.js` recomputes them in the browser from `location_event` pings each time a day is opened.
- Only `day_review.stop_locations` ({arrivedAt: site id}) persists, and only for tagged stops. Arrival/departure times are never saved.
- Nothing links a stop to billed hours. `hours_entries` carries `location_id`, `tech_id`, `entry_date` only. `gps_hours`, `day_review_id`, `stop_type` are unused (null on all 231 entries).
- Nothing prevents the same stop or the same time being claimed twice. Kevin has observed double-claims.
- The original "visit history" view (billed-time report) shows only what is already billed. The useful purpose is finding on-site time NOT yet claimed, and preventing double-claims.

## Billing rules (agreed with Kevin)
1. **Allowance lives on the site** (`locations`, shown as "Sites"): `travel_to_minutes` and `travel_from_minutes` (two fields; total is their sum; UI may accept one number and split it evenly, both editable). **Default is 30 minutes each way (60 round trip) for customer sites, existing and new; adjust per site as needed.** Non-customer sites (vendor, personal, other, office) stay at 0. Changes are audited.
2. **On-site time is shared** between customers at the same site; their on-site portions cannot add up to more than the visit's on-site minutes.
3. **Travel allowance is per customer.** Each customer billed at a shared site can take the full allowance; one customer taking it does not reduce another's.
4. **Travel allowance choice per claim:** Full / To only / From only / None / Custom minutes (Custom requires a reason). Default: a customer's first claim on a visit suggests Full; later claims by the same customer on the same visit suggest None (several WOs, same customer, same site, same visit = no double-billed travel). Tech may override with a reason.
5. **Minimum billing is per work order** (existing setting `billing_minimum_hours`, default 2). If a WO's billed total (on-site + travel) is under the minimum, a top-up brings it to the minimum. Today this is advisory only; the top-up becomes a suggested, tech-confirmed amount. No cross-WO / same-site-shared-minimum logic: handled by Kevin's team manually for now.
6. **One hours line per WO.** Customers see a single combined hours line. No separate travel line and no travel hours type. The QBO export and invoices are unchanged.
7. **The breakdown is kept internally** on each hours entry (on-site minutes, travel allowance minutes, minimum top-up minutes, travel choice, override reason) so the guard works and a line can be explained. `hours_entries` is already audited.
8. **Claim limit** for a customer on a visit = max(on-site share + chosen travel allowance, WO minimum shortfall top-up). Claims above it are blocked or require an override with a reason.
9. **Day-level billed vs tracked check is informational only** (allowances can legitimately push billed time above tracked time). Payroll still uses actual tracked time.

## Suppliers
- A stop at a site with `location_type = 'vendor'` AND `billable_default = true` is a supplier visit. The tech is prompted: "Add this time to a work order?"
- A vendor site with `billable_default = false` (for example the Post Office) never prompts.
- Supplier sites are NOT constrained by customer: any active WO may be chosen. Customer sites remain constrained to the customers at that site.
- ASSUMPTION, confirm: supplier visits bill actual time with no travel allowance.
- **Data clean-up (Kevin, 2026-09-30):** some non-suppliers are coded as vendor today, notably the five gas stations (Wawa Middletown, WaWa Milford, WaWa North Dover, Wawa Rt 10, WaWa Seaford), which are also billable by default. Kevin will re-code these and any others to a non-vendor type himself, so they stop prompting. The billable-by-default check above is the safety net in the meantime.
- Before re-coding, check what uses `locations.vendor_id`: WaWa Milford, North Dover and Seaford are linked to vendor records, and changing the type must not break that link. `location_entity_types` currently holds only customer, vendor and personal; sites also use "other" and "office".

## Data model (proposed)
- `locations`: add `travel_to_minutes int`, `travel_from_minutes int`. One-time backfill sets both to 30 on existing active customer sites (about 123 today; list the rows and get Kevin's go-ahead before running). New sites created as customer type are pre-filled 30/30 by the Sites UI (not a database default, so vendor/personal/other rows are not affected). Everything else is 0.
- New `site_visits`: id, tech_id, location_id, arrived_at, departed_at (null = in progress), onsite_minutes, source, dismissed/merged state, timestamps. Unique on (tech_id, arrived_at). Audited via the existing generic trigger.
- `hours_entries`: add `site_visit_id`, `onsite_minutes`, `travel_minutes`, `topup_minutes`, `travel_choice`, `travel_override_reason`. A visit is "unbilled" when no active hours entry references it.
- Existing `hours_entries` without a visit link (all 231 today) are left as they are; no automatic back-linking.

## How visits get written
Option A first: when a day is opened or saved in the Field Travel Log, the existing stop detection output is upserted into `site_visits` (idempotent on tech_id + arrived_at; updates times only, never clears claims). Merged stops become one visit; dismissed stops are flagged. Today's in-progress stop is written open. A "Process days" button backfills July 2 to today with the same engine. Option B (scheduled server job) only if unreviewed days prove to be a problem; the table would not change.

## Prerequisite: GPS stop quality (resolved by site radius; engine work optional)
Visit rows are only as good as stop detection, so this was checked before scoping.

**Evidence (Aug 28, 5:30 to 7:30pm Eastern, Delaware City, offline replay 2026-09-30):**
- The tech was at William Bubby Sadlerfield Baseball Field (a personal site, 100 m geofence) for about 2 hours 6 minutes (arrive about 5:28pm, leave about 7:34pm, from good fixes within 10 m).
- The replay ran the real gps-engine.js v1.8 over that day's pings and reproduced the on-screen result exactly: Ball Field 10 min, Ball Field 6 min, and an untagged Unknown stop of 38 min, with fake "drives" between them.
- Causes found: (1) the 350 m RF cap dropped 75 of 131 pings (57%), leaving long holes; (2) from about 6:30 to 7:28pm the phone reported one stuck coordinate 211 m from the site pin at accuracy 100, just outside the 100 m geofence, so the engine called it a departure and then an Unknown stop; (3) position-derived fake movement was minor (8 of 55 consecutive pairs).
- Changing only the ball field radius and rerunning the same engine: 100 m gave 10 + 6 + 38 min unknown; 250 m gave 17 + 71 min; **350 m gave one stop of 124 min**; 500 m and 700 m gave one stop of 125 to 126 min.
- Caveat: the replay used 10 of 178 sites and one day. False matches from a larger radius on other days were not tested.

**Decision (Kevin, 2026-09-30):** only a few sites really cause this, and Kevin has already extended those sites' radii. So the fix is data, not code: no gps-engine change is required to start.

**Working rule:** a site whose GPS is degraded (metal roof, RF interference, dead zone) gets a larger geofence radius and, where useful, the existing "GPS dead zone" checkbox and note in the Sites manager. That checkbox is informational only today; nothing in the engine reads it.

**Optional engine work (gps-engine v1.9), only if needed:** build it only if, after the radius changes, other days still fragment. Candidates, in priority order: (a) merge consecutive stops at the same site with no good-fix movement between them; (b) compute movement from good-accuracy fixes only; (c) let the dead-zone flag widen matching and require good-fix evidence to depart; (d) noise-tolerant clustering for unknown stops. Any engine change must be replayed against Aug 28 plus at least three other days (a clean-signal day, a multi-stop day, a day that already fragments) and compared with v1.8 before shipping.

**Monitoring:** the Visit history screen should make fragmentation visible (several short visits at one site within a couple of hours, or an untagged unknown stop next to a known site) so a problem site can be spotted and its radius fixed. Possible later: a scan over July to September to list such sites.

**Manual site creation:** confirm the Sites manager can drop a pin and create a site without a detected stop (today a site is created by tagging a detected stop). Add it if missing.

## Screens
- **Sites > Visit history:** per site, by month, compact date line, filter all / tech / single tech, date range, each visit tagged with tech and Claimed / Unclaimed. Tap a date for the visit and the WO entries behind it. Toggle to show billed-only.
- **Claim from a visit:** pick WO(s), on-site share, travel allowance choice, minimum top-up suggestion; saves one combined hours entry per WO.
- **Field Travel Log allocation** uses the same claim rules so both paths are guarded.

## Suggested phasing
1. GPS stop quality: radius changes on problem sites (done by Kevin, data only). Engine v1.9 only if other days still fragment (see Prerequisite).
2. `locations` allowance fields + Sites settings UI.
3. `site_visits` table + writer + backfill.
4. Claim rules and guard in the allocation flow (this is what stops double-claims).
5. Visit history screen with unclaimed filter.
6. Supplier visit prompts.

## Open items
- Confirm: supplier visits have no travel allowance.
- Review the 3 same-site-same-day multi-entry cases found (Georgetown Allen Ctr: Jul 24, Sep 8, Sep 22) and any specific double-claim Kevin remembers, using recomputed stops.
- Only one tracked tech (`tid`) exists in `location_event` so far; multi-tech behavior untested.
- Mobile FTL and desktop FTL both need the claim rules.

---

## Step 1 change list (draft for Kevin's review, 2026-09-30; not approved to build)
Version would be v4.93. Nothing below has been done.

**Database** (new file `supabase/migrations/v4.93_site_travel_allowance.sql`)
1. `alter table locations add column travel_to_minutes int not null default 0, add column travel_from_minutes int not null default 0;` (default 0 so vendor/personal/other rows are unaffected).
2. One-time backfill, run separately after Kevin sees the row list: `update locations set travel_to_minutes=30, travel_from_minutes=30, modified_by='system: v4.93 travel default' where active and location_type='customer';` (123 rows today; the existing `audit_locations` trigger will log all of them).
3. No trigger or RLS change needed: `audit_locations` already covers the table.

**New file `app-sites-travel.js`** (all new logic lives here)
4. `locTravelRowHtml(loc)`: the read/edit row shown on the site detail screen: "Travel allowance [30] to / [30] from = 60 min total".
5. `locSaveTravel(id, field, val)`: PATCH one field (0 to 480 whole minutes), update `LocState.locations`, toast "Travel allowance saved". Same pattern as `locSaveGeofence`.
6. `locTravelEditFieldsHtml(loc, isNew)` and `locTravelTypeChange()`: the two inputs for the Add/Edit panel. A new customer-type site pre-fills 30/30; switching type to a non-customer type sets 0/0 unless the user already typed a value.
7. `locTravelPayload()`: reads the two inputs for `locSaveEdit`.

**`app-core.js`** (small hooks only; no code moved or deleted)
8. `locRenderDetail` (about line 6572): one line calling `locTravelRowHtml(loc)` after the Geofence row.
9. `locRenderEditPanel` (about line 6852): one line inserting `locTravelEditFieldsHtml(...)` after the Geofence block.
10. `locEditTypeChange` (line 6903): one line calling `locTravelTypeChange()`.
11. `locSaveEdit` (about line 6998): merge `locTravelPayload()` into `payload`.
12. `APP_VERSION` 4.92 to 4.93 (line 3).

**`index.html`**
13. Add `<script src="app-sites-travel.js?v=1"></script>` after app-core.js; bump `app-core.js?v=134` to `?v=135`.

**Other**
14. `CHANGELOG.md` entry for v4.93. `node --check` on app-core.js and app-sites-travel.js. Commit "v4.93: site travel allowance fields".

**Things found while reading the code (not part of step 1 unless Kevin says so)**
- The Edit panel offers types customer, vendor, personal, fuel, lunch, other, but `locSaveEdit` (line 6986) saves anything other than customer/vendor/personal as `personal`. So choosing "fuel" or "lunch" actually stores `personal`. That is fine for re-coding the Wawas away from vendor (non-vendor, non-billable once the checkbox is cleared), but the stored type will read "personal", not "fuel".
- Sites can already be created without a detected stop: Add site, then type coordinates or "Use my location". I did not find a click-on-map add.
- New columns come through automatically: sites load with `select=*`.
