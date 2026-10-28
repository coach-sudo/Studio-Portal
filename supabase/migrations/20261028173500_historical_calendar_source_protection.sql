-- Historical reconciliation prerequisite. No source is bound automatically.
create table discovery_internal.source_decisions (
 id uuid primary key default gen_random_uuid(),studio_id uuid not null references public.studios(id) on delete restrict,
 calendar_id text not null,event_id text not null,disposition text not null check(disposition in ('linked','not_lesson','skipped','review')),
 lesson_id uuid references public.lessons(id) on delete restrict,lesson_ends_at timestamptz,
 reviewed_hash text not null check(reviewed_hash ~ '^[0-9a-f]{64}$'),actor_id uuid not null,reason text not null,
 version integer not null default 1 check(version>0),decided_at timestamptz not null default now(),
 unique(studio_id,calendar_id,event_id),check(length(calendar_id) between 1 and 1024 and calendar_id<>'primary'),
 check(length(event_id) between 1 and 1024),check(length(trim(reason)) between 3 and 500),
 check((lesson_id is null)=(lesson_ends_at is null)),check(lesson_id is null or lesson_ends_at<=decided_at),
 check(disposition<>'linked' or lesson_id is not null)
);
create index historical_calendar_raw_identity on discovery_internal.source_decisions(studio_id,event_id);
create index historical_calendar_link on discovery_internal.source_decisions(lesson_id) where lesson_id is not null;
create table discovery_internal.source_observations (
 id uuid primary key default gen_random_uuid(),decision_id uuid not null references discovery_internal.source_decisions(id) on delete restrict,
 calendar_id text not null,observation_hash text not null,observation jsonb not null,
 ambiguous boolean not null,changed boolean not null,observed_at timestamptz not null default now(),
 unique(decision_id,calendar_id,observation_hash)
);
create index historical_source_observation_cursor on discovery_internal.source_observations(decision_id,observed_at desc,id desc);
-- The subsequent authenticated reconciliation command must bind its exact
-- import mutation to this transaction. There is no public writer in this step.
create table discovery_internal.source_write_authorizations (
 transaction_id bigint not null,decision_id uuid not null references discovery_internal.source_decisions(id) on delete restrict,
 import_id uuid not null,actor_id uuid not null,primary key(transaction_id,decision_id,import_id)
);
alter table discovery_internal.source_decisions enable row level security;
alter table discovery_internal.source_observations enable row level security;
alter table discovery_internal.source_write_authorizations enable row level security;
revoke all on discovery_internal.source_decisions,discovery_internal.source_observations,discovery_internal.source_write_authorizations from public,anon,authenticated,service_role;

create function discovery_internal.guard_source_decision() returns trigger
language plpgsql security definer set search_path='' as $$
declare lesson public.lessons;
begin
 if tg_op='UPDATE' and (new.id,new.studio_id,new.calendar_id,new.event_id) is distinct from (old.id,old.studio_id,old.calendar_id,old.event_id) then raise exception 'REVIEW_REQUIRED: Source identity is immutable.'; end if;
 perform pg_advisory_xact_lock(hashtext(new.studio_id::text));
 perform pg_advisory_xact_lock(hashtextextended(jsonb_build_array(new.studio_id,new.event_id)::text,0));
 if not exists(select 1 from public.memberships where user_id=new.actor_id and studio_id=new.studio_id and role='coach') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if new.lesson_id is not null then
  select * into lesson from public.lessons where id=new.lesson_id and studio_id=new.studio_id for update;
  if lesson.id is null or lesson.ends_at is distinct from new.lesson_ends_at or lesson.ends_at>new.decided_at then raise exception 'REVIEW_REQUIRED: Select the exact historical lesson.'; end if;
  if exists(select 1 from public.lessons l where l.studio_id=new.studio_id and l.id<>new.lesson_id and l.source_provider not in ('studio','public_booking','gmail') and l.source_external_id in(new.event_id,jsonb_build_array(new.calendar_id,new.event_id)::text)) then
   raise exception 'REVIEW_REQUIRED: Review the existing source record before linking another lesson.';
  end if;
 end if;
 return new;
end $$;
revoke all on function discovery_internal.guard_source_decision() from public,anon,authenticated,service_role;
create trigger historical_source_decision_guard before insert or update on discovery_internal.source_decisions for each row execute function discovery_internal.guard_source_decision();

create function public.observe_protected_calendar_sources(p_studio uuid,p_calendar text,p_events jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare event jsonb; decision discovery_internal.source_decisions; result jsonb:='[]'; fingerprint text; exact_source boolean; matched boolean;
begin
 if p_studio is null or p_calendar is null or length(p_calendar) not between 1 and 1024 or p_calendar='primary' or jsonb_typeof(p_events) is distinct from 'array' or jsonb_array_length(p_events)>250 or length(p_events::text)>400000 then raise exception 'VALIDATION_FAILED'; end if;
 if exists(select 1 from jsonb_array_elements(p_events) e where jsonb_typeof(e) is distinct from 'object' or jsonb_typeof(e->'id') is distinct from 'string' or coalesce(length(e->>'id'),0) not between 1 and 1024)
 or (select count(*) from jsonb_array_elements(p_events))<>(select count(distinct e->>'id') from jsonb_array_elements(p_events) e) then raise exception 'VALIDATION_FAILED'; end if;
 -- The same studio lock must be used by the later reconciliation writer.
 perform pg_advisory_xact_lock(hashtext(p_studio::text));
 for event in select value from jsonb_array_elements(p_events) loop
  if exists(select 1 from jsonb_object_keys(event) k where k not in ('id','etag','status','startsAt','endsAt','startDate','endDate')) or length(event::text)>10000 then raise exception 'VALIDATION_FAILED'; end if;
  if exists(select 1 from jsonb_each(event) pair where pair.key<>'id' and (jsonb_typeof(pair.value) not in ('string','null') or length(pair.value::text)>1100)) or coalesce(event->>'status','') not in ('active','cancelled') then raise exception 'VALIDATION_FAILED'; end if;
  fingerprint:=encode(extensions.digest(jsonb_build_object('calendarId',p_calendar,'event',event)::text,'sha256'),'hex');
  matched:=false;
  for decision in select d.* from discovery_internal.source_decisions d where d.studio_id=p_studio and d.event_id=event->>'id'
   and (d.calendar_id=p_calendar or not exists(select 1 from discovery_internal.source_decisions exact where exact.studio_id=p_studio and exact.event_id=event->>'id' and exact.calendar_id=p_calendar)) order by d.calendar_id loop
   matched:=true;exact_source:=decision.calendar_id=p_calendar;
   insert into discovery_internal.source_observations(decision_id,calendar_id,observation_hash,observation,ambiguous,changed)
   values(decision.id,p_calendar,fingerprint,event,not exact_source,fingerprint<>decision.reviewed_hash)
   on conflict(decision_id,calendar_id,observation_hash) do nothing;
   result:=result||jsonb_build_array(jsonb_build_object('eventId',event->>'id','state',case when exact_source then 'protected' else 'ambiguous' end,'decisionId',decision.id,'lessonId',decision.lesson_id,'disposition',decision.disposition,'changed',fingerprint<>decision.reviewed_hash));
  end loop;
  if not matched then result:=result||jsonb_build_array(jsonb_build_object('eventId',event->>'id','state','unprotected')); end if;
 end loop;
 return result;
end $$;
revoke all on function public.observe_protected_calendar_sources(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.observe_protected_calendar_sources(uuid,text,jsonb) to service_role;

create function discovery_internal.guard_historical_calendar_lesson() returns trigger
language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid();
begin
 if (tg_op='INSERT' or (new.source_provider,new.source_external_id) is distinct from (old.source_provider,old.source_external_id))
 and new.source_provider not in ('studio','public_booking','gmail') and new.source_external_id is not null then
  perform pg_advisory_xact_lock(hashtext(new.studio_id::text));
  perform pg_advisory_xact_lock(hashtextextended(jsonb_build_array(new.studio_id,new.source_external_id)::text,0));
 end if;
 if (tg_op='INSERT' or (new.source_provider,new.source_external_id) is distinct from (old.source_provider,old.source_external_id))
 and new.source_provider not in ('studio','public_booking','gmail') and exists(select 1 from discovery_internal.source_decisions d where d.studio_id=new.studio_id and d.event_id=new.source_external_id) then
  raise exception 'REVIEW_REQUIRED: This Calendar identity has a protected historical decision.';
 end if;
 if tg_op='UPDATE' and (new.studio_id,new.student_id,new.starts_at,new.ends_at,new.status,new.offering_id,new.source_provider,new.source_external_id)
 is distinct from (old.studio_id,old.student_id,old.starts_at,old.ends_at,old.status,old.offering_id,old.source_provider,old.source_external_id)
 and exists(select 1 from discovery_internal.source_decisions d where d.lesson_id=old.id) then
  if new.studio_id is distinct from old.studio_id then raise exception 'REVIEW_REQUIRED: Protected history must retain its studio identity.'; end if;
  -- Existing service-only occurrence commands validate the actor before setting
  -- this context. An ordinary provider worker has no coach authority.
  actor:=coalesce(actor,nullif(current_setting('app.lesson_actor',true),'')::uuid);
  if actor is null or not exists(select 1 from public.memberships where user_id=actor and studio_id=old.studio_id and role='coach') then
   -- Preserve the existing service-only, authorized booking cancellation path
   -- if a coach later corrects historical scheduling into the future. Its
   -- finalizer owns the financial/checkout and participant checks; this marker
   -- never permits provider rescheduling, completion or identity changes.
   if current_setting('role',true)='service_role' and current_setting('app.student_cancel',true)='true'
   and old.status='scheduled' and new.status in ('cancelled','late_cancelled')
   and (new.student_id,new.starts_at,new.ends_at,new.offering_id,new.source_provider,new.source_external_id)
    is not distinct from (old.student_id,old.starts_at,old.ends_at,old.offering_id,old.source_provider,old.source_external_id)
   and exists(select 1 from public.lesson_participants lp join public.bookings b on b.id=lp.booking_id
    where lp.lesson_id=old.id and lp.status in ('reserved','confirmed') and b.status='confirmed' and b.studio_id=old.studio_id and b.student_id=lp.student_id) then return new;end if;
   raise exception 'REVIEW_REQUIRED: Review the protected historical lesson before changing its schedule or outcome.';
  end if;
 end if;
 return new;
end $$;
revoke all on function discovery_internal.guard_historical_calendar_lesson() from public,anon,authenticated,service_role;
create trigger historical_calendar_source_guard before insert or update on public.lessons for each row execute function discovery_internal.guard_historical_calendar_lesson();

create function discovery_internal.guard_historical_calendar_import() returns trigger
language plpgsql security definer set search_path='' as $$
declare item public.integration_imports; decision discovery_internal.source_decisions;
begin
 if tg_op='UPDATE' and old.provider='google_calendar' and (new.studio_id,new.provider,new.external_id) is distinct from (old.studio_id,old.provider,old.external_id)
 and exists(select 1 from discovery_internal.source_decisions d where d.studio_id=old.studio_id and (d.event_id=old.external_id or jsonb_build_array(d.calendar_id,d.event_id)::text=old.external_id)) then
  raise exception 'REVIEW_REQUIRED: A protected Calendar identity cannot be rewritten.';
 end if;
 if tg_op='DELETE' then item:=old;else item:=new;end if;
 if item.provider<>'google_calendar' then if tg_op='DELETE' then return old;else return new;end if;end if;
 for decision in select * from discovery_internal.source_decisions d where d.studio_id=item.studio_id and (d.event_id=item.external_id or jsonb_build_array(d.calendar_id,d.event_id)::text=item.external_id) loop
  if not exists(select 1 from discovery_internal.source_write_authorizations a where a.transaction_id=txid_current() and a.decision_id=decision.id and a.import_id=item.id and a.actor_id=auth.uid() and exists(select 1 from public.memberships m where m.user_id=a.actor_id and m.studio_id=decision.studio_id and m.role='coach')) then
   raise exception 'REVIEW_REQUIRED: Use the historical reconciliation command for this Calendar decision.';
  end if;
 end loop;
 if tg_op='DELETE' then return old;else return new;end if;
end $$;
revoke all on function discovery_internal.guard_historical_calendar_import() from public,anon,authenticated,service_role;
create trigger historical_calendar_import_guard before insert or update or delete on public.integration_imports for each row execute function discovery_internal.guard_historical_calendar_import();

create function discovery_internal.protected_calendar_import(p_studio uuid,p_provider text,p_external text) returns boolean
language sql stable security definer set search_path='' as $$
 select p_provider='google_calendar' and exists(select 1 from discovery_internal.source_decisions d where d.studio_id=p_studio and (d.event_id=p_external or jsonb_build_array(d.calendar_id,d.event_id)::text=p_external))
$$;
revoke all on function discovery_internal.protected_calendar_import(uuid,text,text) from public,anon,authenticated,service_role;

-- Preserve existing retention policies. Only explicitly protected Calendar
-- decisions are excluded, both from the diagnostic count and the mutation.
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
    'ignoredImports', (select count(*) from public.integration_imports where status = 'ignored' and updated_at < now() - interval '180 days' and not discovery_internal.protected_calendar_import(studio_id,provider,external_id)),
    'importPayloadsToCompact', (select count(*) from public.integration_imports where status = 'imported' and updated_at < now() - interval '180 days' and (payload->>'archived') is distinct from 'true' and not discovery_internal.protected_calendar_import(studio_id,provider,external_id))
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

  delete from public.integration_imports where status = 'ignored' and updated_at < now() - interval '180 days' and not discovery_internal.protected_calendar_import(studio_id,provider,external_id);
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
     and (payload->>'archived') is distinct from 'true' and not discovery_internal.protected_calendar_import(studio_id,provider,external_id);
  get diagnostics affected = row_count;
  result := result || jsonb_build_object('compactedImportPayloads', affected);

  return result || jsonb_build_object('completedAt', now());
end;
$$;

revoke all on function public.studio_storage_health() from public, anon, authenticated;
grant execute on function public.studio_storage_health() to service_role;
revoke all on function public.cleanup_transient_studio_data() from public, anon, authenticated;
grant execute on function public.cleanup_transient_studio_data() to service_role;
