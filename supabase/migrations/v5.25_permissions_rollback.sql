-- v5.25 rollback — removes everything v5.25_permissions.sql created.
-- Nothing existing references these objects, so this is a clean undo.
-- Cost: any module, template or override settings entered after go-live are lost. No other table is touched.
-- audit_log rows written about these tables are kept (they are the record).

begin;

drop table if exists public.user_permissions;
drop table if exists public.template_permissions;
drop table if exists public.access_templates;
drop table if exists public.modules;

drop function if exists public.get_my_permissions();
drop function if exists public.has_qb(text);
drop function if exists public.has_module(text, text);
drop function if exists public.my_module_level(text);
drop function if exists public.perm_rank(text);
drop function if exists public.audit_permission_delete();
drop function if exists public.permissions_user_lock();
drop function if exists public.permissions_template_lock();
drop function if exists public.permissions_user_label();
drop function if exists public.permissions_template_label();

commit;
