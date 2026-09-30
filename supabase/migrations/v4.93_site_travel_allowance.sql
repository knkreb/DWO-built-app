-- v4.93 — Site travel allowance (docs/specs/site-visits-and-claims.md, step 1)
-- Additive only. Default 0 so vendor/personal/other/office sites are unaffected.
alter table public.locations
  add column if not exists travel_to_minutes integer not null default 0,
  add column if not exists travel_from_minutes integer not null default 0;

alter table public.locations
  add constraint locations_travel_to_minutes_range check (travel_to_minutes between 0 and 480),
  add constraint locations_travel_from_minutes_range check (travel_from_minutes between 0 and 480);
