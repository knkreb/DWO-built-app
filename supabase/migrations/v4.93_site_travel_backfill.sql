-- v4.93 — ONE-TIME backfill: 30 min each way on active customer sites.
-- NOT applied with the schema migration. Run only after Kevin reviews the row list and says go.
-- The audit_locations trigger will log each row (modified_by below attributes them).
update public.locations
   set travel_to_minutes = 30,
       travel_from_minutes = 30,
       modified_by = 'system: v4.93 travel default',
       modified_at = now()
 where active and location_type = 'customer';
