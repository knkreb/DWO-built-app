-- v5.01 — NOT RUN, by decision (Kevin, 2026-10-19): only live work orders matter, and the only live Quoted
-- work order (P26433) has no lines to convert. The other three are closed (cancelled / invoiced outside DWO).
-- Kept for reference in case closed Quoted work orders ever need milestones.
-- One-time conversion of EXISTING Quoted work orders to milestones.
-- Run ONLY after v5.01_quoted_billing.sql, and only after Kevin has reviewed the preview (step 1).
-- Live check on 2026-10-19 found 4 Quoted work orders: P25188 (Cancelled, 1 line), P26112 and P26123
-- (Invoiced Outside DWO, 1 line each) and P26433 (Quoted draft, no lines -> shows the setup warning).

-- Step 1: PREVIEW (read-only). Run this alone and review.
select w.wo_number, w.status, s.category,
       count(q.id) filter (where q.active) as lines,
       coalesce(sum(q.amount) filter (where q.active), 0) as will_become_quoted_amount
from public.work_orders w
left join public.wo_statuses s on s.num = w.status
left join public.quoted_invoices q on q.work_order_id = w.id
where w.form_mode = 'quoted'
group by w.wo_number, w.status, s.category
order by w.wo_number;

-- Step 2: CONVERT (run after the preview is approved).
-- quoted_amount = sum of active lines; lines are numbered by creation order;
-- lines on work orders already processed (invoiced) become 'billed', all others 'pending'.
-- with seq as (
--   select id, work_order_id, row_number() over (partition by work_order_id order by created_at) as rn
--   from public.quoted_invoices where active
-- )
-- update public.quoted_invoices q
--    set sort_order = seq.rn,
--        status = case when exists (
--                   select 1 from public.work_orders w join public.wo_statuses s on s.num = w.status
--                   where w.id = q.work_order_id and s.category = 'processed') then 'billed' else 'pending' end
--   from seq where seq.id = q.id;
--
-- update public.work_orders w
--    set quoted_amount = t.total
--   from (select work_order_id, sum(amount) as total from public.quoted_invoices where active group by work_order_id) t
--  where t.work_order_id = w.id and w.form_mode = 'quoted';
