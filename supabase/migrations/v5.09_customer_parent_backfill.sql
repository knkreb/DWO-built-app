-- v5.09 — OPTIONAL one-time backfill of customers.parent_customer_id from QBO "Parent:Child" names
-- Spec: docs/specs/customer-thresholds-and-carryover.md (slice 1)
-- NOT run automatically. Kevin reviews STEP 1 first; STEP 2 only if the preview looks right.
-- Diagnosed 2026-10-21: 96 active customers have a colon in their name; the parent half matches an
-- active customer row for almost all of them. Parent = everything before the LAST colon, matched on exact
-- name, CASE-INSENSITIVE (as applied 2026-10-21: 94 sites under 20 parents). Only rows with exactly one matching active parent, and no parent set yet, are touched.
-- Not matched (left alone, set by hand on the Customers screen): names whose parent row is missing or
-- misspelled (e.g. a misspelled parent name; the iHeartmedia case difference now matches) and names containing "(deleted)".

-- STEP 1: preview (read-only). Review every row.
select c.name as child, p.name as proposed_parent
from public.customers c
join public.customers p
  on p.active and lower(p.name) = lower(regexp_replace(c.name, ':[^:]*$', ''))
where c.active
  and position(':' in c.name) > 0
  and c.parent_customer_id is null
  and c.name not ilike '%(deleted)%'
  and p.id <> c.id
  and (select count(*) from public.customers p2
       where p2.active and lower(p2.name) = lower(regexp_replace(c.name, ':[^:]*$', ''))) = 1
order by p.name, c.name;

-- STEP 2: apply (uncomment and run only after reviewing STEP 1).
-- update public.customers c
-- set parent_customer_id = p.id, modified_by = 'v5.09 backfill'
-- from public.customers p
-- where p.active and lower(p.name) = lower(regexp_replace(c.name, ':[^:]*$', ''))
--   and c.active
--   and position(':' in c.name) > 0
--   and c.parent_customer_id is null
--   and c.name not ilike '%(deleted)%'
--   and p.id <> c.id
--   and (select count(*) from public.customers p2
--        where p2.active and lower(p2.name) = lower(regexp_replace(c.name, ':[^:]*$', ''))) = 1;
