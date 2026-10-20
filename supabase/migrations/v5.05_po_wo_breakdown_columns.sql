-- v5.05: add work order title and customer to po_wo_breakdown for the Customer PO edit screen's
-- work orders table. New columns are appended at the end so existing columns (and po_ledger, which
-- selects from this view) are unchanged.
create or replace view public.po_wo_breakdown
with (security_invoker = true) as
select
  w.id as work_order_id,
  w.wo_number,
  w.purchase_order_id,
  w.status,
  coalesce((select sum(li.sell_total) from public.line_items li
            where li.work_order_id = w.id and li.active = true and li.billable = true), 0)
  + coalesce((select sum(he.line_total) from public.hours_entries he
              where he.work_order_id = w.id and he.active = true and he.billable = true), 0)
  + coalesce((select sum(qi.amount) from public.quoted_invoices qi
              where qi.work_order_id = w.id and qi.active = true), 0) as wo_total,
  w.title,
  w.customer_id
from public.work_orders w
where w.purchase_order_id is not null and w.active = true;
