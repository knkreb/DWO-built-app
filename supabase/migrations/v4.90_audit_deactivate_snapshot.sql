-- v4.89b — Operational Audit Trail follow-up: full snapshot on delete
-- Kevin's feedback: a deactivate (soft-delete) row showed no "before" values.
-- audit_row_changes() now captures every meaningful field's value into old_value
-- at the moment a row is deactivated, instead of an empty summary row.
-- See docs/specs/operational-audit-trail.md

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
  snapshot text;
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
    if new_active = 'false' then
      -- Deletion: capture a full snapshot of the record's meaningful field values at the moment it disappears
      snapshot := '';
      for key in select jsonb_object_keys(to_jsonb(NEW)) loop
        if key = any(exclude_cols) or key = 'active' then continue; end if;
        new_val := to_jsonb(NEW) ->> key;
        if new_val is not null and new_val <> '' then
          snapshot := snapshot || case when snapshot = '' then '' else '; ' end || key || ': ' || new_val;
        end if;
      end loop;
      insert into audit_log (table_name, record_id, action, field_name, old_value, new_value, changed_by, changed_at, context)
      values (TG_TABLE_NAME, NEW.id, 'deactivate', null, snapshot, null, who, now(), ctx);
    else
      insert into audit_log (table_name, record_id, action, field_name, old_value, new_value, changed_by, changed_at, context)
      values (TG_TABLE_NAME, NEW.id, 'reactivate', null, null, null, who, now(), ctx);
    end if;
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
