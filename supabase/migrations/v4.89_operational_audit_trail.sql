-- v4.89 — Operational Audit Trail
-- See docs/specs/operational-audit-trail.md

-- 4. context column + full-text search index
alter table public.audit_log add column context text;
create index audit_log_search_idx on audit_log using gin (
  to_tsvector('simple', coalesce(context,'') || ' ' || coalesce(old_value,'') || ' ' || coalesce(new_value,'') || ' ' || coalesce(field_name,'') || ' ' || coalesce(changed_by,''))
);

-- Retire the two old narrow triggers — superseded by the generic one below (avoid double-logging)
drop trigger if exists line_items_audit on public.line_items;
drop trigger if exists day_review_audit on public.day_review;
comment on function public.audit_line_items_changes() is 'RETIRED v4.89 — replaced by audit_row_changes(). Kept for rollback reference.';
comment on function public.audit_day_review_changes() is 'RETIRED v4.89 — replaced by audit_row_changes(). Kept for rollback reference.';

-- One generic trigger function for every in-scope table
create or replace function public.audit_row_changes()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  who text := coalesce(auth.email(), to_jsonb(NEW)->>'modified_by', to_jsonb(NEW)->>'created_by', 'system');
  label_col text := TG_ARGV[0];
  wo_fk_col text := TG_ARGV[1];
  exclude_cols text[] := string_to_array(TG_ARGV[2], ',');
  ctx text;
  key text;
  old_val text; new_val text;
  old_active text; new_active text;
begin
  if TG_TABLE_NAME = 'work_orders' then
    ctx := to_jsonb(NEW) ->> 'wo_number';
  elsif wo_fk_col <> '' then
    select wo_number into ctx from work_orders where id = nullif(to_jsonb(NEW) ->> wo_fk_col, '')::uuid;
  else
    ctx := to_jsonb(NEW) ->> label_col;
  end if;

  if TG_OP = 'INSERT' then
    insert into audit_log (table_name, record_id, action, field_name, old_value, new_value, changed_by, changed_at, context)
    values (TG_TABLE_NAME, NEW.id, 'create', null, null, to_jsonb(NEW) ->> label_col, who, now(), ctx);
    return NEW;
  end if;

  old_active := to_jsonb(OLD) ->> 'active';
  new_active := to_jsonb(NEW) ->> 'active';
  if old_active is not null and old_active is distinct from new_active then
    insert into audit_log (table_name, record_id, action, field_name, old_value, new_value, changed_by, changed_at, context)
    values (TG_TABLE_NAME, NEW.id, case when new_active = 'true' then 'reactivate' else 'deactivate' end, null, null, null, who, now(), ctx);
  end if;

  for key in select jsonb_object_keys(to_jsonb(NEW)) loop
    if key = any(exclude_cols) or key = 'active' then continue; end if;
    old_val := to_jsonb(OLD) ->> key;
    new_val := to_jsonb(NEW) ->> key;
    if old_val is distinct from new_val then
      insert into audit_log (table_name, record_id, action, field_name, old_value, new_value, changed_by, changed_at, context)
      values (TG_TABLE_NAME, NEW.id, 'update', key, old_val, new_val, who, now(), ctx);
    end if;
  end loop;
  return NEW;
end $$;

-- One trigger per in-scope table: audit_row_changes(label_col, work_order_fk_col_or_empty, comma_separated_excludes)
create trigger audit_work_orders after insert or update on public.work_orders
  for each row execute function public.audit_row_changes('wo_number', '', 'id,created_at,created_by,modified_at,modified_by,deleted_at,deleted_by,export_count');

create trigger audit_hours_entries after insert or update on public.hours_entries
  for each row execute function public.audit_row_changes('descriptor', 'work_order_id', 'id,created_at,created_by,modified_at,modified_by,reconciled_at,reconciled_by');

create trigger audit_line_items after insert or update on public.line_items
  for each row execute function public.audit_row_changes('descriptor', 'work_order_id', 'id,created_at,created_by,modified_at,modified_by,vendor_exported_at,vendor_exported_by');

create trigger audit_day_review after insert or update on public.day_review
  for each row execute function public.audit_row_changes('review_date', '', 'id,created_at,created_by,modified_at,modified_by,dismissed_stops,stop_flags,merged_stops,stop_locations');

create trigger audit_tasks after insert or update on public.tasks
  for each row execute function public.audit_row_changes('title', 'work_order_id', 'id,created_at,created_by,modified_at,modified_by');

create trigger audit_task_assignments after insert or update on public.task_assignments
  for each row execute function public.audit_row_changes('role', '', 'id,created_at');

create trigger audit_task_steps after insert or update on public.task_steps
  for each row execute function public.audit_row_changes('title', '', 'id,created_at,modified_at');

create trigger audit_task_templates after insert or update on public.task_templates
  for each row execute function public.audit_row_changes('title', '', 'id,created_at,modified_at,created_by,modified_by');

create trigger audit_task_template_steps after insert or update on public.task_template_steps
  for each row execute function public.audit_row_changes('title', '', 'id,created_at');

create trigger audit_customers after insert or update on public.customers
  for each row execute function public.audit_row_changes('display_name', '', 'id,created_at,created_by,modified_at,modified_by,deleted_at,deleted_by,synced_at');

create trigger audit_customer_contacts after insert or update on public.customer_contacts
  for each row execute function public.audit_row_changes('name', '', 'id,created_at,modified_at,created_by,modified_by');

create trigger audit_customer_contact_roles after insert or update on public.customer_contact_roles
  for each row execute function public.audit_row_changes('', '', 'id');

create trigger audit_vendors after insert or update on public.vendors
  for each row execute function public.audit_row_changes('name', '', 'id,created_at,created_by,modified_at,modified_by,deleted_at,deleted_by');

create trigger audit_technicians after insert or update on public.technicians
  for each row execute function public.audit_row_changes('name', '', 'id,created_at,created_by,modified_at,modified_by,deleted_at,deleted_by,tid');

create trigger audit_locations after insert or update on public.locations
  for each row execute function public.audit_row_changes('name', '', 'id,created_at,created_by,modified_at,modified_by,deleted_at,deleted_by,geocoded_at,geocoded_by,reviewed_at,reviewed_by');

create trigger audit_hours_types after insert or update on public.hours_types
  for each row execute function public.audit_row_changes('name', '', 'id,created_at,created_by,modified_at,modified_by');

create trigger audit_qbo_items after insert or update on public.qbo_items
  for each row execute function public.audit_row_changes('name', '', 'id,created_at,created_by,modified_at,modified_by');

create trigger audit_quoted_invoices after insert or update on public.quoted_invoices
  for each row execute function public.audit_row_changes('description', 'work_order_id', 'id,created_at,created_by,modified_at,modified_by,deleted_at,deleted_by');

create trigger audit_wo_flags after insert or update on public.wo_flags
  for each row execute function public.audit_row_changes('name', '', 'id');

create trigger audit_wo_statuses after insert or update on public.wo_statuses
  for each row execute function public.audit_row_changes('name', '', 'id');

create trigger audit_settings after insert or update on public.settings
  for each row execute function public.audit_row_changes('key', '', 'id,created_at,modified_at');

create trigger audit_contact_role_types after insert or update on public.contact_role_types
  for each row execute function public.audit_row_changes('name', '', 'id,created_at,modified_at');

create trigger audit_bug_reports after insert or update on public.bug_reports
  for each row execute function public.audit_row_changes('description', '', 'id,created_at,modified_at,modified_by');

create trigger audit_bug_report_statuses after insert or update on public.bug_report_statuses
  for each row execute function public.audit_row_changes('name', '', 'id,created_at');

create trigger audit_dispatch_assignments after insert or update on public.dispatch_assignments
  for each row execute function public.audit_row_changes('status', 'work_order_id', 'id,created_at,modified_at,created_by,modified_by');

create trigger audit_day_breaks after insert or update on public.day_breaks
  for each row execute function public.audit_row_changes('review_date', '', 'id,created_at,created_by,modified_at,modified_by');

create trigger audit_punch_event after insert or update on public.punch_event
  for each row execute function public.audit_row_changes('punch_date', '', 'id,created_at,created_by,modified_at,modified_by');

create trigger audit_time_entry after insert or update on public.time_entry
  for each row execute function public.audit_row_changes('date', '', 'id,created_at,created_by,modified_at,modified_by');

create trigger audit_week_submission after insert or update on public.week_submission
  for each row execute function public.audit_row_changes('week_start', '', 'id,created_at');

create trigger audit_tech_schedule after insert or update on public.tech_schedule
  for each row execute function public.audit_row_changes('day_of_week', '', 'id,created_at,modified_at');

create trigger audit_equipment_status_types after insert or update on public.equipment_status_types
  for each row execute function public.audit_row_changes('label', '', 'id,created_at,modified_at');

create trigger audit_exit_interview_actions after insert or update on public.exit_interview_actions
  for each row execute function public.audit_row_changes('action_type', '', 'id,created_at');

create trigger audit_exit_interview_responses after insert or update on public.exit_interview_responses
  for each row execute function public.audit_row_changes('question_text', 'work_order_id', 'id,created_at');

create trigger audit_exit_interview_templates after insert or update on public.exit_interview_templates
  for each row execute function public.audit_row_changes('question', '', 'id,created_at,modified_at');

create trigger audit_flag_rules after insert or update on public.flag_rules
  for each row execute function public.audit_row_changes('name', '', 'id');

create trigger audit_time_block after insert or update on public.time_block
  for each row execute function public.audit_row_changes('stop_type', '', 'id,created_at');
