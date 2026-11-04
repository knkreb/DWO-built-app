-- v5.22: a quoted work order counts only its quoted amount against a PO.
-- Before: wo_total = billable parts + billable labor + quoted lines for every work order, so a $31,000 quote
-- with $43.26 of cost showed $31,043.26. Parts and labor on a quoted work order are internal cost only.
-- Quoted (form_mode = 'quoted'): work_orders.quoted_amount, or the sum of its active quoted_invoices rows when
-- no quoted amount is set. Anything else (T&M, null): billable parts + billable labor, as before.
-- Same columns in the same order as v5.20. po_ledger is unchanged (it reads wo_total).
-- Spec: docs/specs/quoted-wo-totals.md. Counting individual milestones as billed/pending is a separate follow-up spec.

create or replace view public.po_wo_breakdown
with (security_invoker = true) as
select
  w.id as work_order_id,
  w.wo_number,
  w.purchase_order_id,
  w.status,
  case
    when w.form_mode = 'quoted' then
      coalesce(
        w.quoted_amount,
        (select sum(qi.amount) from public.quoted_invoices qi
          where qi.work_order_id = w.id and qi.active = true),
        0)
    else
      coalesce((select sum(li.sell_total) from public.line_items li
                where li.work_order_id = w.id and li.active = true and li.billable = true), 0)
      + coalesce((select sum(he.line_total) from public.hours_entries he
                  where he.work_order_id = w.id and he.active = true and he.billable = true), 0)
  end as wo_total,
  w.title,
  w.customer_id,
  coalesce(psb.bucket, 'pending') as bucket
from public.work_orders w
left join public.wo_statuses s on s.num = w.status
left join public.po_status_bucket psb on psb.system_key = s.system_key
where w.purchase_order_id is not null and w.active = true;

grant select on public.po_wo_breakdown to authenticated;
grant select on public.po_ledger to authenticated;
