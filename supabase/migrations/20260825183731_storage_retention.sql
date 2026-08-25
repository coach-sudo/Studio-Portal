-- Keep authoritative studio records indefinitely while pruning only transient,
-- reconstructable operational data. Both functions are service-role only.

create or replace function public.studio_storage_health()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  top_tables jsonb;
  storage_bytes bigint;
  storage_objects bigint;
  cleanup_candidates jsonb;
begin
  select coalesce(jsonb_agg(to_jsonb(s)), '[]'::jsonb)
    into top_tables
  from (
    select c.relname as name,
           pg_total_relation_size(c.oid) as bytes,
           coalesce(st.n_live_tup, 0)::bigint as rows
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    left join pg_catalog.pg_stat_user_tables st on st.relid = c.oid
    where c.relkind = 'r' and n.nspname = 'public'
    order by pg_total_relation_size(c.oid) desc
    limit 8
  ) s;

  select coalesce(sum(coalesce((metadata->>'size')::bigint, 0)), 0), count(*)
    into storage_bytes, storage_objects
  from storage.objects;

  select jsonb_build_object(
    'expiredRateLimits', (select count(*) from public.public_endpoint_rate_limits where window_ends_at < now() - interval '1 day'),
    'expiredIdempotencyKeys', (select count(*) from public.idempotency_keys where expires_at < now()),
    'oldBookingHolds', (select count(*) from public.booking_holds where status in ('expired','converted') and created_at < now() - interval '30 days'),
    'processedWebhooks', (select count(*) from public.webhook_events where status = 'processed' and processed_at < now() - interval '90 days'),
    'successfulDeliveryAttempts', (select count(*) from public.delivery_attempts where succeeded and created_at < now() - interval '180 days'),
    'resolvedRecommendations', (select count(*) from public.recommendations where status in ('resolved','dismissed') and updated_at < now() - interval '180 days'),
    'resolvedSyncConflicts', (select count(*) from public.sync_conflicts where status <> 'open' and resolved_at < now() - interval '180 days'),
    'ignoredImports', (select count(*) from public.integration_imports where status = 'ignored' and updated_at < now() - interval '180 days'),
    'importPayloadsToCompact', (select count(*) from public.integration_imports where status = 'imported' and updated_at < now() - interval '180 days' and (payload->>'archived') is distinct from 'true')
  ) into cleanup_candidates;

  return jsonb_build_object(
    'databaseBytes', pg_database_size(current_database()),
    'storageBytes', storage_bytes,
    'storageObjects', storage_objects,
    'largestTables', top_tables,
    'cleanupCandidates', cleanup_candidates,
    'measuredAt', now()
  );
end;
$$;

create or replace function public.cleanup_transient_studio_data()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  affected bigint;
  result jsonb := '{}'::jsonb;
begin
  delete from public.public_endpoint_rate_limits where window_ends_at < now() - interval '1 day';
  get diagnostics affected = row_count;
  result := result || jsonb_build_object('expiredRateLimits', affected);

  delete from public.idempotency_keys where expires_at < now();
  get diagnostics affected = row_count;
  result := result || jsonb_build_object('expiredIdempotencyKeys', affected);

  delete from public.booking_holds where status in ('expired','converted') and created_at < now() - interval '30 days';
  get diagnostics affected = row_count;
  result := result || jsonb_build_object('oldBookingHolds', affected);

  delete from public.webhook_events where status = 'processed' and processed_at < now() - interval '90 days';
  get diagnostics affected = row_count;
  result := result || jsonb_build_object('processedWebhooks', affected);

  delete from public.delivery_attempts where succeeded and created_at < now() - interval '180 days';
  get diagnostics affected = row_count;
  result := result || jsonb_build_object('successfulDeliveryAttempts', affected);

  delete from public.recommendations where status in ('resolved','dismissed') and updated_at < now() - interval '180 days';
  get diagnostics affected = row_count;
  result := result || jsonb_build_object('resolvedRecommendations', affected);

  delete from public.sync_conflicts where status <> 'open' and resolved_at < now() - interval '180 days';
  get diagnostics affected = row_count;
  result := result || jsonb_build_object('resolvedSyncConflicts', affected);

  delete from public.integration_imports where status = 'ignored' and updated_at < now() - interval '180 days';
  get diagnostics affected = row_count;
  result := result || jsonb_build_object('ignoredImports', affected);

  update public.integration_imports
     set payload = jsonb_strip_nulls(jsonb_build_object(
       'archived', true,
       'summary', payload->'summary',
       'source', detected_source
     ))
   where status = 'imported'
     and updated_at < now() - interval '180 days'
     and (payload->>'archived') is distinct from 'true';
  get diagnostics affected = row_count;
  result := result || jsonb_build_object('compactedImportPayloads', affected);

  return result || jsonb_build_object('completedAt', now());
end;
$$;

revoke all on function public.studio_storage_health() from public, anon, authenticated;
grant execute on function public.studio_storage_health() to service_role;
revoke all on function public.cleanup_transient_studio_data() from public, anon, authenticated;
grant execute on function public.cleanup_transient_studio_data() to service_role;
