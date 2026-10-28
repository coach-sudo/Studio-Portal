-- Explicit single-source historical decisions. No lesson or financial writes.
create table discovery_internal.review_receipts (
 actor_id uuid not null,request_key text not null,studio_id uuid not null references public.studios(id) on delete restrict,
 request_hash text not null,result jsonb not null,created_at timestamptz not null default now(),primary key(actor_id,request_key)
);
create table discovery_internal.decision_revisions (
 decision_id uuid not null references discovery_internal.source_decisions(id) on delete restrict,version integer not null,
 actor_id uuid not null,request_key text not null,action text not null,reason text not null,
 before_state jsonb,after_state jsonb not null,import_before jsonb,import_after jsonb,created_at timestamptz not null default now(),
 primary key(decision_id,version)
);
alter table discovery_internal.review_receipts enable row level security;
alter table discovery_internal.decision_revisions enable row level security;
revoke all on discovery_internal.review_receipts,discovery_internal.decision_revisions from public,anon,authenticated,service_role;

create function discovery_internal.historical_review_snapshot(p_candidate uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare candidate discovery_internal.candidates; scan discovery_internal.scans; head discovery_internal.source_decisions;
 imports jsonb; visible_imports jsonb; linked_lessons jsonb; stamp text; observation jsonb;
begin
 select * into candidate from discovery_internal.candidates where id=p_candidate;
 select * into scan from discovery_internal.scans where id=candidate.scan_id;
 if auth.uid() is null or scan.id is null or not public.is_studio_coach(scan.studio_id) then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if candidate.calendar_id='primary' then raise exception 'REVIEW_REQUIRED: Resolve the actual calendar identity.';end if;
 if not ((candidate.starts_at is not null and candidate.ends_at>candidate.starts_at and candidate.ends_at<=now())
  or (candidate.starts_at is null and candidate.ends_at is null and candidate.start_date is not null and candidate.end_date>candidate.start_date and candidate.end_date<=(now() at time zone scan.timezone)::date)) then
  raise exception 'REVIEW_REQUIRED: Select a confirmed historical interval before using historical review.';
 end if;
 select * into head from discovery_internal.source_decisions where studio_id=scan.studio_id and calendar_id=candidate.calendar_id and event_id=candidate.event_id;
 select coalesce(jsonb_agg(to_jsonb(i) order by i.id),'[]'),coalesce(jsonb_agg(jsonb_build_object('id',i.id,'status',i.status,'lessonId',i.lesson_id,'updatedAt',i.updated_at,'matchType',case when i.external_id=candidate.source_key then 'scoped' else 'legacy_unscoped' end) order by i.id),'[]')
 into imports,visible_imports from public.integration_imports i where i.studio_id=scan.studio_id and i.provider='google_calendar' and i.external_id in(candidate.source_key,candidate.event_id);
 -- Normalize instants exactly as the shared provider observation helper does.
 observation:=jsonb_build_object('id',candidate.event_id,'etag',candidate.etag,'status',candidate.status,
  'startsAt',to_char(candidate.starts_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
  'endsAt',to_char(candidate.ends_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
  'startDate',candidate.start_date::text,'endDate',candidate.end_date::text);
 select coalesce(jsonb_agg(to_jsonb(l) order by l.id),'[]') into linked_lessons from public.lessons l where l.studio_id=scan.studio_id and
 (l.id=head.lesson_id or exists(select 1 from jsonb_array_elements(imports) i where i->>'lesson_id'=l.id::text));
 stamp:=encode(extensions.digest(jsonb_build_object('candidate',to_jsonb(candidate),'head',to_jsonb(head),'imports',imports,'linkedLessons',linked_lessons)::text,'sha256'),'hex');
 return jsonb_build_object('candidateId',candidate.id,'studioId',scan.studio_id,'calendarId',candidate.calendar_id,'eventId',candidate.event_id,'summary',candidate.summary,
  'sourceStatus',candidate.status,'reasonCode',candidate.reason_code,'observation',observation,'decision',case when head.id is not null then to_jsonb(head) end,'priorSignals',visible_imports,
  'linkedLessons',(select coalesce(jsonb_agg(jsonb_build_object('id',l->'id','topic',l->'topic','startsAt',l->'starts_at','endsAt',l->'ends_at','status',l->'status','version',l->'version')),'[]') from jsonb_array_elements(linked_lessons) l),'stamp',stamp,
  'attendanceVerified',false,'financialCoverageVerified',false,'canonicalEffects','[]'::jsonb);
end $$;
revoke all on function discovery_internal.historical_review_snapshot(uuid) from public,anon,authenticated,service_role;
create function public.preview_historical_calendar_review(p_candidate uuid) returns jsonb
language sql security definer set search_path='' as $$select discovery_internal.historical_review_snapshot(p_candidate)$$;
revoke all on function public.preview_historical_calendar_review(uuid) from public,anon,service_role;
grant execute on function public.preview_historical_calendar_review(uuid) to authenticated;

create function public.command_historical_calendar_review(p_candidate uuid,p_payload jsonb,p_key text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); candidate discovery_internal.candidates; scan discovery_internal.scans; head discovery_internal.source_decisions;
 prior discovery_internal.review_receipts; before_head jsonb; before_import jsonb; after_import jsonb; original public.integration_imports;
 preview jsonb; fingerprint text; linked_lesson public.lessons; action text:=p_payload->>'action'; reason text:=trim(p_payload->>'reason'); result jsonb; audit_id uuid:=gen_random_uuid();
 digest text:=encode(extensions.digest(jsonb_build_object('command','historical_calendar_review','candidateId',p_candidate,'payload',p_payload)::text,'sha256'),'hex');
begin
 select * into candidate from discovery_internal.candidates where id=p_candidate;
 select * into scan from discovery_internal.scans where id=candidate.scan_id;
 -- Authorization precedes even receipt replay. Removed coaches cannot recover results.
 if actor is null or scan.id is null or not public.is_studio_coach(scan.studio_id) then raise exception 'FORBIDDEN' using errcode='42501';end if;
 if length(coalesce(p_key,'')) not between 8 and 200 then raise exception 'VALIDATION_FAILED';end if;
 perform pg_advisory_xact_lock(hashtext(scan.studio_id::text));
 perform pg_advisory_xact_lock(hashtextextended(actor::text||':historical-review:'||p_key,0));
 select * into prior from discovery_internal.review_receipts where actor_id=actor and request_key=p_key;
 if found then if prior.request_hash<>digest or prior.studio_id<>scan.studio_id then raise exception 'IDEMPOTENCY_CONFLICT';end if;return prior.result;end if;
 if jsonb_typeof(p_payload) is distinct from 'object' or length(p_payload::text)>10000 or action is null or action not in ('not_lesson','skip','reopen')
 or reason is null or length(reason) not between 3 and 500 or coalesce(p_payload->>'stamp','') !~ '^[0-9a-f]{64}$'
 or exists(select 1 from jsonb_object_keys(p_payload) k where k not in ('action','reason','stamp','legacyImportId','legacyUpdatedAt','acknowledgeUnscoped')) then raise exception 'VALIDATION_FAILED';end if;
 select * into candidate from discovery_internal.candidates where id=p_candidate for update;
 perform pg_advisory_xact_lock(hashtextextended(jsonb_build_array(scan.studio_id,candidate.event_id)::text,0));
 perform 1 from discovery_internal.source_decisions where studio_id=scan.studio_id and event_id=candidate.event_id order by id for update;
 perform 1 from public.integration_imports where studio_id=scan.studio_id and provider='google_calendar' and external_id in(candidate.source_key,candidate.event_id) order by id for update;
 perform 1 from public.lessons l where l.studio_id=scan.studio_id and (exists(select 1 from discovery_internal.source_decisions d where d.studio_id=scan.studio_id and d.calendar_id=candidate.calendar_id and d.event_id=candidate.event_id and d.lesson_id=l.id)
  or exists(select 1 from public.integration_imports i where i.studio_id=scan.studio_id and i.provider='google_calendar' and i.external_id in(candidate.source_key,candidate.event_id) and i.lesson_id=l.id)) order by l.id for update;
 preview:=discovery_internal.historical_review_snapshot(p_candidate);
 if preview->>'stamp'<>p_payload->>'stamp' then raise exception 'VERSION_CONFLICT: Refresh the historical source preview.';end if;
 select * into head from discovery_internal.source_decisions where studio_id=scan.studio_id and calendar_id=candidate.calendar_id and event_id=candidate.event_id;
 before_head:=case when head.id is not null then to_jsonb(head) end;
 if action<>'reopen' and (head.lesson_id is not null or jsonb_array_length(preview->'linkedLessons')>0) then raise exception 'REVIEW_REQUIRED: Preserve the existing canonical lesson link.';end if;
 if action='reopen' then
  if nullif(p_payload->>'legacyImportId','') is not null then
   select * into original from public.integration_imports where id=(p_payload->>'legacyImportId')::uuid and studio_id=scan.studio_id and provider='google_calendar' and external_id in(candidate.source_key,candidate.event_id);
   if original.id is null or original.status<>'ignored' or coalesce(p_payload->>'legacyUpdatedAt','') !~ '(Z|[+-][0-9]{2}:[0-9]{2})$'
    or original.updated_at is distinct from (p_payload->>'legacyUpdatedAt')::timestamptz then raise exception 'VERSION_CONFLICT: Select the exact ignored signal from the preview.';end if;
   if original.external_id=candidate.event_id and (p_payload->'acknowledgeUnscoped' is distinct from 'true'::jsonb
    or exists(select 1 from discovery_internal.source_decisions where studio_id=scan.studio_id and event_id=candidate.event_id and calendar_id<>candidate.calendar_id)) then raise exception 'REVIEW_REQUIRED: Review the ambiguous legacy Calendar identity.';end if;
   before_import:=jsonb_build_object('id',original.id,'status',original.status,'lessonId',original.lesson_id,'updatedAt',original.updated_at);
   if original.lesson_id is not null then
    select * into linked_lesson from public.lessons where id=original.lesson_id and studio_id=scan.studio_id;
    if linked_lesson.id is null or linked_lesson.ends_at>now() or (head.lesson_id is not null and head.lesson_id<>linked_lesson.id) then raise exception 'REVIEW_REQUIRED: Preserve the exact historical canonical lesson link.';end if;
   end if;
  elsif p_payload ? 'legacyUpdatedAt' or p_payload ? 'acknowledgeUnscoped' then raise exception 'VALIDATION_FAILED';
  elsif head.id is null or head.disposition='review' then raise exception 'REVIEW_REQUIRED: Choose an ignored signal or a finalized source decision to reopen.';end if;
 elsif p_payload ? 'legacyImportId' or p_payload ? 'legacyUpdatedAt' or p_payload ? 'acknowledgeUnscoped' then raise exception 'VALIDATION_FAILED';
 end if;
 fingerprint:=encode(extensions.digest(jsonb_build_object('calendarId',candidate.calendar_id,'event',preview->'observation')::text,'sha256'),'hex');
 if head.id is null then
  insert into discovery_internal.source_decisions(studio_id,calendar_id,event_id,disposition,reviewed_hash,actor_id,reason,lesson_id,lesson_ends_at)
   values(scan.studio_id,candidate.calendar_id,candidate.event_id,case action when 'skip' then 'skipped' when 'reopen' then 'review' else 'not_lesson' end,fingerprint,actor,reason,linked_lesson.id,linked_lesson.ends_at) returning * into head;
 else
  update discovery_internal.source_decisions set disposition=case action when 'skip' then 'skipped' when 'reopen' then 'review' else 'not_lesson' end,
   version=version+1,reviewed_hash=fingerprint,actor_id=actor,reason=command_historical_calendar_review.reason,decided_at=now(),
   lesson_id=coalesce(head.lesson_id,linked_lesson.id),lesson_ends_at=coalesce(head.lesson_ends_at,linked_lesson.ends_at) where id=head.id returning * into head;
 end if;
 if original.id is not null then
  insert into discovery_internal.source_write_authorizations(transaction_id,decision_id,import_id,actor_id) values(txid_current(),head.id,original.id,actor);
  update public.integration_imports set status='needs_review',updated_at=clock_timestamp() where id=original.id;
  select jsonb_build_object('id',i.id,'status',i.status,'lessonId',i.lesson_id,'updatedAt',i.updated_at) into after_import from public.integration_imports i where i.id=original.id;
  delete from discovery_internal.source_write_authorizations where transaction_id=txid_current() and decision_id=head.id and import_id=original.id and actor_id=actor;
 end if;
 insert into discovery_internal.decision_revisions(decision_id,version,actor_id,request_key,action,reason,before_state,after_state,import_before,import_after)
 values(head.id,head.version,actor,p_key,action,reason,before_head,to_jsonb(head),before_import,after_import);
 insert into public.audit_events(id,studio_id,actor_id,entity_type,entity_id,action,reason,correlation_id,source,before_state,after_state)
 values(audit_id,scan.studio_id,actor,'historical_calendar_decision',head.id,'discovery.historical_'||action,reason,p_key,'coach_historical_review',before_head,
  jsonb_build_object('decision',to_jsonb(head),'candidateId',p_candidate,'importBefore',before_import,'importAfter',after_import,'canonicalEffects','[]'::jsonb));
 result:=jsonb_build_object('resource',jsonb_build_object('candidateId',p_candidate,'decisionId',head.id,'version',head.version,'disposition',head.disposition,'lessonId',head.lesson_id,'attendanceVerified',false,'financialCoverageVerified',false),
  'auditEventId',audit_id,'queuedSideEffects','[]'::jsonb);
 insert into discovery_internal.review_receipts(actor_id,request_key,studio_id,request_hash,result) values(actor,p_key,scan.studio_id,digest,result);
 return result;
end $$;
revoke all on function public.command_historical_calendar_review(uuid,jsonb,text) from public,anon,service_role;
grant execute on function public.command_historical_calendar_review(uuid,jsonb,text) to authenticated;
