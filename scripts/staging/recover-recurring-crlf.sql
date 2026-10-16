-- Authorized staging-only recovery; not a repository migration.
-- Execute with an explicit project-ref guard for lrxrivfqjpkvygozphoz.
-- Proven against the pinned first 35 migrations in PostgreSQL 17.
begin;
set local lock_timeout = '3s';
set local statement_timeout = '15s';
do $recovery$
declare
 target oid;
 before_row jsonb;
 after_row jsonb;
 ddl text;
 normalized text;
begin
 if (select count(*) from supabase_migrations.schema_migrations) <> 35 or
    (select encode(sha256(convert_to(string_agg(version || ':' || name,E'\n' order by version),'UTF8')),'hex') from supabase_migrations.schema_migrations) <> 'b3d4e7eaa773c8c163853d094d1802607b7a6629118fdbce2d3981f2992ae393' then
   raise exception 'RECOVERY_REFUSED: expected exact verified 35-migration staging prefix';
 end if;
 if (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='command_make_lesson_recurring') <> 1 then
   raise exception 'RECOVERY_REFUSED: unexpected overload count';
 end if;
 target := to_regprocedure('public.command_make_lesson_recurring(uuid,integer,text,integer,text)');
 if target is null then raise exception 'RECOVERY_REFUSED: signature missing';end if;
 select to_jsonb(p),pg_get_functiondef(p.oid) into strict before_row,ddl from pg_proc p where oid=target;
 if before_row->>'proowner' <> (select oid::text from pg_roles where rolname='postgres') or
    before_row->'proacl' is distinct from '["postgres=X/postgres","service_role=X/postgres"]'::jsonb or
    before_row->'proconfig' is distinct from '["search_path=public, pg_temp"]'::jsonb or
    before_row->>'prosecdef' <> 'true' then
   raise exception 'RECOVERY_REFUSED: unexpected ownership, ACL or configuration';
 end if;
 normalized := replace(ddl,E'\r\n',E'\n');
 if encode(sha256(convert_to(normalized,'UTF8')),'hex') <> '67563f49127d6aaec3c6eb97447a5b54d290b8e8232b234331294cbaac57adfe' then
   raise exception 'RECOVERY_REFUSED: normalized definition differs from pinned PostgreSQL 17 replay';
 end if;
 if ddl = normalized then return;end if;
 if encode(sha256(convert_to(ddl,'UTF8')),'hex') <> 'd0681ba4709e1cc6fc7c96e338f98e6f2b41e16a2b7f16eb7f3d4d81223b74bc' then
   raise exception 'RECOVERY_REFUSED: raw definition differs from inspected staging function';
 end if;
 -- Reassert the already-verified setting using supported owner DDL. This
 -- acquires the target function's write lock without system-catalog privileges.
 -- Recheck the complete row after waiting; any intervening change rolls back.
 alter function public.command_make_lesson_recurring(uuid,integer,text,integer,text)
   set search_path = public, pg_temp;
 select to_jsonb(p),pg_get_functiondef(p.oid) into strict after_row,ddl from pg_proc p where oid=target;
 if after_row is distinct from before_row or
    encode(sha256(convert_to(ddl,'UTF8')),'hex') <> 'd0681ba4709e1cc6fc7c96e338f98e6f2b41e16a2b7f16eb7f3d4d81223b74bc' or
    (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='command_make_lesson_recurring') <> 1 then
   raise exception 'RECOVERY_REFUSED: concurrent function change';
 end if;
 execute normalized;
 select to_jsonb(p) into strict after_row from pg_proc p where oid=target;
 if (before_row - 'prosrc') is distinct from (after_row - 'prosrc') or
    after_row->>'prosrc' is distinct from replace(before_row->>'prosrc',E'\r\n',E'\n') or
    pg_get_functiondef(target) is distinct from normalized then
   raise exception 'RECOVERY_REFUSED: unexpected catalog or business SQL change';
 end if;
end
$recovery$;
commit;
