-- Coach-requested read-only provider previews. No canonical scheduling writes.
create schema discovery_internal;
revoke all on schema discovery_internal from public,anon,authenticated,service_role;
create table discovery_internal.scans (
 id uuid primary key default gen_random_uuid(), studio_id uuid not null references public.studios(id) on delete restrict,
 actor_id uuid not null, request_key text not null, request_hash text not null,
 range_start timestamptz not null,range_end timestamptz not null,timezone text not null,
 created_at timestamptz not null default now(),unique(actor_id,request_key),check(range_end>range_start)
);
create table discovery_internal.sources (
 scan_id uuid not null references discovery_internal.scans(id) on delete restrict,calendar_id text not null,
 label text not null,calendar_timezone text,status text not null default 'queued' check(status in ('queued','running','completed','failed')),
 page_sequence integer not null default 0,observed integer not null default 0,next_page_token text,
 claim_token uuid,claim_until timestamptz,attempts integer not null default 0,
 last_attempt_at timestamptz,last_success_at timestamptz,failure_code text,
 primary key(scan_id,calendar_id),check((claim_token is null)=(claim_until is null)),check(status<>'running' or claim_token is not null)
);
create table discovery_internal.page_receipts (
 actor_id uuid not null,request_key text not null,request_hash text not null,
 scan_id uuid not null,calendar_id text not null,page_sequence integer not null,response jsonb,
 primary key(actor_id,request_key),foreign key(scan_id,calendar_id) references discovery_internal.sources(scan_id,calendar_id) on delete restrict
);
create index discovery_page_identity on discovery_internal.page_receipts(scan_id,calendar_id,page_sequence);
create table discovery_internal.page_observations (
 id uuid primary key default gen_random_uuid(),scan_id uuid not null,calendar_id text not null,page_sequence integer not null,
 outcome text not null check(outcome in ('completed','failed')),failure_code text,response_hash text,
 request_token_hash text,next_token_hash text,observed integer not null default 0,created_at timestamptz not null default now(),
 foreign key(scan_id,calendar_id) references discovery_internal.sources(scan_id,calendar_id) on delete restrict
);
create unique index discovery_completed_page on discovery_internal.page_observations(scan_id,calendar_id,page_sequence) where outcome='completed';
create table discovery_internal.candidates (
 id uuid primary key default gen_random_uuid(),scan_id uuid not null,calendar_id text not null,event_id text not null,
 source_key text not null,etag text,summary text not null,status text not null,
 starts_at timestamptz,ends_at timestamptz,start_date date,end_date date,timezone text,
 recurring_event_id text,original_start text,reason_code text not null,observed_at timestamptz not null default now(),
 unique(scan_id,calendar_id,event_id),foreign key(scan_id,calendar_id) references discovery_internal.sources(scan_id,calendar_id) on delete restrict
);
create index discovery_candidate_page on discovery_internal.candidates(scan_id,id);
create index discovery_scans_recent on discovery_internal.scans(studio_id,created_at desc,id desc);
alter table discovery_internal.scans enable row level security;
alter table discovery_internal.sources enable row level security;
alter table discovery_internal.page_receipts enable row level security;
alter table discovery_internal.page_observations enable row level security;
alter table discovery_internal.candidates enable row level security;
revoke all on all tables in schema discovery_internal from public,anon,authenticated,service_role;

create function public.start_calendar_discovery(p_actor uuid,p_studio uuid,p_value jsonb,p_key text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare prior discovery_internal.scans; scan_id uuid:=gen_random_uuid(); c jsonb;
 digest text:=encode(extensions.digest(p_value::text,'sha256'),'hex'); starts timestamptz; ends timestamptz;
begin
 if p_actor is null or not exists(select 1 from public.memberships where user_id=p_actor and studio_id=p_studio and role='coach') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if p_key is null or length(p_key) not between 8 and 200 then raise exception 'VALIDATION_FAILED'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_actor::text||':discovery-start:'||p_key,0));
 select * into prior from discovery_internal.scans where actor_id=p_actor and request_key=p_key;
 if found then
  if prior.request_hash<>digest or prior.studio_id<>p_studio then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
  return jsonb_build_object('scanId',prior.id,'accepted',true,'statusAtAcceptance','queued','canonicalEffects','[]'::jsonb);
 end if;
 if jsonb_typeof(p_value) is distinct from 'object' or length(p_value::text)>100000
 or jsonb_typeof(p_value->'calendars') is distinct from 'array' or jsonb_array_length(p_value->'calendars') not between 1 and 100
 or not exists(select 1 from pg_timezone_names where name=p_value->>'timezone')
 or coalesce(p_value->>'from','') !~ '(Z|[+-][0-9]{2}:[0-9]{2})$' or coalesce(p_value->>'to','') !~ '(Z|[+-][0-9]{2}:[0-9]{2})$' then raise exception 'VALIDATION_FAILED'; end if;
 starts:=(p_value->>'from')::timestamptz; ends:=(p_value->>'to')::timestamptz;
 if not isfinite(starts) or not isfinite(ends) or ends<=starts then raise exception 'VALIDATION_FAILED'; end if;
 insert into discovery_internal.scans(id,studio_id,actor_id,request_key,request_hash,range_start,range_end,timezone) values(scan_id,p_studio,p_actor,p_key,digest,starts,ends,p_value->>'timezone');
 for c in select value from jsonb_array_elements(p_value->'calendars') loop
  if coalesce(length(c->>'id'),0) not between 1 and 1024 or length(coalesce(c->>'label',''))>1000
    or ((c->>'timezone') is not null and not exists(select 1 from pg_timezone_names where name=c->>'timezone')) then raise exception 'VALIDATION_FAILED'; end if;
  insert into discovery_internal.sources(scan_id,calendar_id,label,calendar_timezone) values(scan_id,c->>'id',coalesce(nullif(c->>'label',''),c->>'id'),c->>'timezone');
 end loop;
 insert into public.audit_events(studio_id,actor_id,entity_type,entity_id,action,reason,correlation_id,source,after_state)
 values(p_studio,p_actor,'discovery_preview',scan_id,'discovery.preview_requested','Coach requested read-only Calendar discovery',p_key,'coach_discovery',jsonb_build_object('from',starts,'to',ends,'timezone',p_value->>'timezone','selectedCalendars',jsonb_array_length(p_value->'calendars'),'canonicalEffects','[]'::jsonb));
 return jsonb_build_object('scanId',scan_id,'accepted',true,'statusAtAcceptance','queued','canonicalEffects','[]'::jsonb);
end $$;
revoke all on function public.start_calendar_discovery(uuid,uuid,jsonb,text) from public,anon,authenticated;
grant execute on function public.start_calendar_discovery(uuid,uuid,jsonb,text) to service_role;

create function public.claim_calendar_discovery_page(p_actor uuid,p_scan uuid,p_calendar text,p_sequence integer,p_key text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare scan discovery_internal.scans; src discovery_internal.sources; prior discovery_internal.page_receipts; observation discovery_internal.page_observations; result jsonb;
 digest text:=encode(extensions.digest(jsonb_build_array(p_scan,p_calendar,p_sequence)::text,'sha256'),'hex'); token uuid:=gen_random_uuid();
begin
 select * into scan from discovery_internal.scans where id=p_scan;
 if p_actor is null or scan.id is null or not exists(select 1 from public.memberships where user_id=p_actor and studio_id=scan.studio_id and role='coach') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if p_key is null or length(p_key) not between 8 and 200 or p_sequence is null or p_sequence<0 then raise exception 'VALIDATION_FAILED'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_actor::text||':discovery-page:'||p_key,0));
 select * into prior from discovery_internal.page_receipts where actor_id=p_actor and request_key=p_key;
 if found and prior.request_hash<>digest then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
 if prior.response is not null then return jsonb_build_object('replay',true,'result',prior.response); end if;
 select * into src from discovery_internal.sources where scan_id=p_scan and calendar_id=p_calendar for update;
 if src.scan_id is null then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if p_sequence<src.page_sequence then
  select * into observation from discovery_internal.page_observations where scan_id=p_scan and calendar_id=p_calendar and page_sequence=p_sequence and outcome='completed';
  if observation.id is null then raise exception 'VERSION_CONFLICT'; end if;
  result:=jsonb_build_object('scanId',p_scan,'calendarId',p_calendar,'pageSequence',p_sequence,'observed',observation.observed,'checkpointCommitted',true);
  insert into discovery_internal.page_receipts(actor_id,request_key,request_hash,scan_id,calendar_id,page_sequence,response) values(p_actor,p_key,digest,p_scan,p_calendar,p_sequence,result) on conflict(actor_id,request_key) do update set response=excluded.response;
  return jsonb_build_object('replay',true,'result',result);
 end if;
 if src.status='completed' or p_sequence<>src.page_sequence then raise exception 'VERSION_CONFLICT'; end if;
 if src.claim_until>now() then raise exception 'DISCOVERY_RUNNING'; end if;
 insert into discovery_internal.page_receipts(actor_id,request_key,request_hash,scan_id,calendar_id,page_sequence) values(p_actor,p_key,digest,p_scan,p_calendar,p_sequence) on conflict(actor_id,request_key) do nothing;
 update discovery_internal.sources set claim_token=token,claim_until=now()+interval '2 minutes',status='running',last_attempt_at=now(),attempts=attempts+1 where scan_id=p_scan and calendar_id=p_calendar;
 return jsonb_build_object('replay',false,'claimToken',token,'scanId',p_scan,'calendarId',p_calendar,'pageSequence',p_sequence,'from',scan.range_start,'to',scan.range_end,'calendarTimezone',src.calendar_timezone,'pageToken',src.next_page_token);
end $$;
revoke all on function public.claim_calendar_discovery_page(uuid,uuid,text,integer,text) from public,anon,authenticated;
grant execute on function public.claim_calendar_discovery_page(uuid,uuid,text,integer,text) to service_role;

create function public.finish_calendar_discovery_page(p_scan uuid,p_calendar text,p_sequence integer,p_claim uuid,p_value jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare src discovery_internal.sources; row jsonb; result jsonb; next_token text:=nullif(p_value->>'nextPageToken','');
 fingerprint text:=encode(extensions.digest(p_value::text,'sha256'),'hex'); last_page discovery_internal.page_observations;
begin
 select * into src from discovery_internal.sources where scan_id=p_scan and calendar_id=p_calendar for update;
 if src.scan_id is null then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if p_sequence<src.page_sequence then
  select * into last_page from discovery_internal.page_observations where scan_id=p_scan and calendar_id=p_calendar and page_sequence=p_sequence and outcome='completed';
  if last_page.response_hash is distinct from fingerprint then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
  return jsonb_build_object('scanId',p_scan,'calendarId',p_calendar,'pageSequence',p_sequence,'observed',last_page.observed,'checkpointCommitted',true);
 end if;
 if p_claim is null or src.claim_token is distinct from p_claim or src.claim_until<=now() or src.page_sequence<>p_sequence then raise exception 'STALE_DISCOVERY_CLAIM'; end if;
 if jsonb_typeof(p_value) is distinct from 'object' or length(p_value::text)>2000000 or jsonb_typeof(p_value->'items') is distinct from 'array' or jsonb_array_length(p_value->'items')>250 or length(coalesce(next_token,''))>10000 then raise exception 'VALIDATION_FAILED'; end if;
 if next_token is not null and (next_token=src.next_page_token or exists(select 1 from discovery_internal.page_observations where scan_id=p_scan and calendar_id=p_calendar and outcome='completed' and request_token_hash=encode(extensions.digest(next_token,'sha256'),'hex'))) then raise exception 'INVALID_DISCOVERY_PAGINATION'; end if;
 for row in select value from jsonb_array_elements(p_value->'items') loop
  if coalesce(length(row->>'id'),0) not between 1 and 1024 or length(coalesce(row->>'summary',''))>1000 or row->>'status' not in ('active','cancelled') or row->>'reasonCode' not in ('event_detected','date_only_requires_time','invalid_time_requires_review','cancelled_source_requires_review') then raise exception 'VALIDATION_FAILED'; end if;
  insert into discovery_internal.candidates(scan_id,calendar_id,event_id,source_key,etag,summary,status,starts_at,ends_at,start_date,end_date,timezone,recurring_event_id,original_start,reason_code)
   values(p_scan,p_calendar,row->>'id',jsonb_build_array(p_calendar,row->>'id')::text,row->>'etag',coalesce(row->>'summary','Calendar event'),row->>'status',nullif(row->>'startsAt','')::timestamptz,nullif(row->>'endsAt','')::timestamptz,nullif(row->>'startDate','')::date,nullif(row->>'endDate','')::date,row->>'timezone',row->>'recurringEventId',row->>'originalStart',row->>'reasonCode')
   on conflict(scan_id,calendar_id,event_id) do update set etag=excluded.etag,summary=excluded.summary,status=excluded.status,starts_at=excluded.starts_at,ends_at=excluded.ends_at,start_date=excluded.start_date,end_date=excluded.end_date,timezone=excluded.timezone,recurring_event_id=excluded.recurring_event_id,original_start=excluded.original_start,reason_code=excluded.reason_code,observed_at=now();
 end loop;
 insert into discovery_internal.page_observations(scan_id,calendar_id,page_sequence,outcome,response_hash,request_token_hash,next_token_hash,observed)
 values(p_scan,p_calendar,p_sequence,'completed',fingerprint,case when src.next_page_token is not null then encode(extensions.digest(src.next_page_token,'sha256'),'hex') end,case when next_token is not null then encode(extensions.digest(next_token,'sha256'),'hex') end,jsonb_array_length(p_value->'items'));
 update discovery_internal.sources set page_sequence=page_sequence+1,observed=observed+jsonb_array_length(p_value->'items'),next_page_token=next_token,status=case when next_token is null then 'completed' else 'queued' end,claim_token=null,claim_until=null,last_success_at=now(),failure_code=null where scan_id=p_scan and calendar_id=p_calendar;
 result:=jsonb_build_object('scanId',p_scan,'calendarId',p_calendar,'pageSequence',p_sequence,'observed',jsonb_array_length(p_value->'items'),'checkpointCommitted',true);
 update discovery_internal.page_receipts set response=result where scan_id=p_scan and calendar_id=p_calendar and page_sequence=p_sequence;
 return result;
end $$;
revoke all on function public.finish_calendar_discovery_page(uuid,text,integer,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.finish_calendar_discovery_page(uuid,text,integer,uuid,jsonb) to service_role;

create function public.fail_calendar_discovery_page(p_scan uuid,p_calendar text,p_claim uuid,p_code text) returns boolean
language plpgsql security definer set search_path='' as $$
declare src discovery_internal.sources;
begin
 if p_code is null or p_code not in ('access_denied','rate_limited','provider_unavailable','invalid_payload','invalid_pagination','checkpoint_unconfirmed') then raise exception 'VALIDATION_FAILED'; end if;
 select * into src from discovery_internal.sources where scan_id=p_scan and calendar_id=p_calendar for update;
 if src.scan_id is null or p_claim is null or src.claim_token is distinct from p_claim or src.claim_until<=now() then return false; end if;
 insert into discovery_internal.page_observations(scan_id,calendar_id,page_sequence,outcome,failure_code) values(p_scan,p_calendar,src.page_sequence,'failed',p_code);
 update discovery_internal.sources set status='failed',failure_code=p_code,claim_token=null,claim_until=null where scan_id=p_scan and calendar_id=p_calendar;
 return true;
end $$;
revoke all on function public.fail_calendar_discovery_page(uuid,text,uuid,text) from public,anon,authenticated;
grant execute on function public.fail_calendar_discovery_page(uuid,text,uuid,text) to service_role;

create function public.calendar_discovery_progress(p_scan uuid,p_cursor uuid default null) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare scan discovery_internal.scans; sources jsonb; items jsonb; more boolean; next_cursor uuid; state text;
begin
 select * into scan from discovery_internal.scans where id=p_scan;
 if scan.id is null or not public.is_studio_coach(scan.studio_id) then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 select jsonb_agg(jsonb_build_object('calendarId',calendar_id,'label',label,'calendarTimezone',calendar_timezone,'status',case when status='running' and claim_until<=now() then 'retry_required' else status end,'pageSequence',page_sequence,'observed',observed,'attempts',attempts,'lastAttemptAt',last_attempt_at,'lastSuccessAt',last_success_at,'failureCode',failure_code) order by calendar_id),
 case when bool_and(status='completed') then 'completed' when bool_or(status='failed' or (status='running' and claim_until<=now())) then case when bool_and(status='failed' or (status='running' and claim_until<=now())) then 'failed' else 'partial' end when bool_or(status='running' and claim_until>now()) then 'running' else 'queued' end into sources,state from discovery_internal.sources where scan_id=p_scan;
 with page as(select * from discovery_internal.candidates where scan_id=p_scan and (p_cursor is null or id>p_cursor) order by id limit 26),visible as(select * from page order by id limit 25)
 select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'calendarId',c.calendar_id,'eventId',c.event_id,'sourceKey',c.source_key,'summary',c.summary,'sourceStatus',c.status,'startsAt',c.starts_at,'endsAt',c.ends_at,'startDate',c.start_date,'endDate',c.end_date,'timezone',c.timezone,'recurringEventId',c.recurring_event_id,'originalStart',c.original_start,'reasonCode',c.reason_code,
  'possiblePriorSignals',(select coalesce(jsonb_agg(jsonb_build_object('id',i.id,'status',i.status,'lessonId',i.lesson_id,'matchType',case when i.external_id=c.source_key then 'scoped' else 'legacy_unscoped' end)),'[]') from public.integration_imports i where i.studio_id=scan.studio_id and i.provider='google_calendar' and i.external_id in(c.event_id,c.source_key)),
  'possibleLessonCount',(select count(*) from public.lessons l where l.studio_id=scan.studio_id and ((l.source_provider='google_calendar' and l.source_external_id in(c.event_id,c.source_key)) or (l.starts_at=c.starts_at and l.ends_at=c.ends_at)))
 ) order by c.id),'[]'),(select count(*)>25 from page),(select id from visible order by id desc limit 1) into items,more,next_cursor from visible c;
 return jsonb_build_object('scanId',scan.id,'from',scan.range_start,'to',scan.range_end,'timezone',scan.timezone,'status',state,'sources',coalesce(sources,'[]'),'items',items,'total',(select count(*) from discovery_internal.candidates where scan_id=p_scan),'hasMore',more,'nextCursor',case when more then next_cursor end,'canonicalEffects','[]'::jsonb,'attendanceVerified',false);
end $$;
revoke all on function public.calendar_discovery_progress(uuid,uuid) from public,anon,service_role;
grant execute on function public.calendar_discovery_progress(uuid,uuid) to authenticated;

create function public.list_calendar_discoveries(p_studio uuid,p_cursor jsonb default null) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare items jsonb; more boolean; next_cursor jsonb;
begin
 if not public.is_studio_coach(p_studio) then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 with page as(select * from discovery_internal.scans where studio_id=p_studio and (p_cursor is null or (created_at,id)<((p_cursor->>'createdAt')::timestamptz,(p_cursor->>'id')::uuid)) order by created_at desc,id desc limit 26),visible as(select * from page order by created_at desc,id desc limit 25)
 select coalesce(jsonb_agg(jsonb_build_object('scanId',s.id,'from',s.range_start,'to',s.range_end,'timezone',s.timezone,'createdAt',s.created_at,'calendarCount',(select count(*) from discovery_internal.sources where scan_id=s.id),'candidateCount',(select count(*) from discovery_internal.candidates where scan_id=s.id)) order by s.created_at desc,s.id desc),'[]'),(select count(*)>25 from page),(select jsonb_build_object('createdAt',created_at,'id',id) from visible order by created_at,id limit 1) into items,more,next_cursor from visible s;
 return jsonb_build_object('items',items,'total',(select count(*) from discovery_internal.scans where studio_id=p_studio),'hasMore',more,'nextCursor',case when more then next_cursor end);
end $$;
revoke all on function public.list_calendar_discoveries(uuid,jsonb) from public,anon,service_role;
grant execute on function public.list_calendar_discoveries(uuid,jsonb) to authenticated;
