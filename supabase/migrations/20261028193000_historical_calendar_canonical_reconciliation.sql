-- Explicit canonical reconciliation; no attendance, financial or provider effects.
create function discovery_internal.historical_review_snapshot_core(p_candidate uuid,p_manual_historical boolean) returns jsonb
language plpgsql security definer set search_path='' as $$
declare candidate discovery_internal.candidates; scan discovery_internal.scans; head discovery_internal.source_decisions;
 imports jsonb; visible_imports jsonb; linked_lessons jsonb; stamp text; observation jsonb;
begin
 select * into candidate from discovery_internal.candidates where id=p_candidate;
 select * into scan from discovery_internal.scans where id=candidate.scan_id;
 if auth.uid() is null or scan.id is null or not public.is_studio_coach(scan.studio_id) then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if candidate.source_key is distinct from jsonb_build_array(candidate.calendar_id,candidate.event_id)::text then raise exception 'REVIEW_REQUIRED: Review the qualified source identity.';end if;
 if candidate.calendar_id='primary' then raise exception 'REVIEW_REQUIRED: Resolve the actual calendar identity.';end if;
 if p_manual_historical is not true and not ((candidate.starts_at is not null and candidate.ends_at>candidate.starts_at and candidate.ends_at<=now())
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
revoke all on function discovery_internal.historical_review_snapshot_core(uuid,boolean) from public,anon,authenticated,service_role;

create or replace function discovery_internal.historical_review_snapshot(p_candidate uuid) returns jsonb
language sql security definer set search_path='' as $$select discovery_internal.historical_review_snapshot_core(p_candidate,false)$$;
revoke all on function discovery_internal.historical_review_snapshot(uuid) from public,anon,authenticated,service_role;

create function discovery_internal.canonical_reconciliation_preview(p_candidate uuid,p_value jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare base jsonb:=discovery_internal.historical_review_snapshot_core(p_candidate,true); candidate discovery_internal.candidates;
 student public.students; target public.lessons; action text:=p_value->>'action'; starts timestamptz; ends timestamptz;
 source_count integer; interval_count integer; source_examples jsonb; interval_examples jsonb; blocked text; differs boolean; digest text;
begin
 if jsonb_typeof(p_value) is distinct from 'object' or length(p_value::text)>20000 or action is null or action not in ('link','create')
 or jsonb_typeof(p_value->'reason') is distinct from 'string' or length(trim(p_value->>'reason')) not between 3 and 500
 or (p_value ? 'acknowledgeSourceDifference' and jsonb_typeof(p_value->'acknowledgeSourceDifference')<>'boolean')
 or (p_value ? 'acknowledgeDuplicateReview' and jsonb_typeof(p_value->'acknowledgeDuplicateReview')<>'boolean')
 or exists(select 1 from jsonb_object_keys(p_value) k where k not in ('action','reason','studentId','lessonId','lessonVersion','startsAt','endsAt','timezone','topic','locationType','locationLabel','acknowledgeSourceDifference','acknowledgeDuplicateReview')) then raise exception 'VALIDATION_FAILED';end if;
 select * into candidate from discovery_internal.candidates where id=p_candidate;
 select * into student from public.students where id=(p_value->>'studentId')::uuid and studio_id=(base->>'studioId')::uuid and deleted_at is null;
 if student.id is null then raise exception 'FORBIDDEN' using errcode='42501';end if;
 if action='link' then
  if exists(select 1 from jsonb_object_keys(p_value) k where k in ('startsAt','endsAt','timezone','topic','locationType','locationLabel')) then raise exception 'VALIDATION_FAILED';end if;
  select * into target from public.lessons where id=(p_value->>'lessonId')::uuid and studio_id=student.studio_id;
  if target.id is null or not isfinite(target.starts_at) or not isfinite(target.ends_at) or target.ends_at>now() or (target.student_id is distinct from student.id and not exists(select 1 from public.lesson_participants where lesson_id=target.id and student_id=student.id)) then raise exception 'REVIEW_REQUIRED: Choose the exact historical lesson and participant.';end if;
  if target.version is distinct from (p_value->>'lessonVersion')::integer then raise exception 'VERSION_CONFLICT: Refresh the selected lesson.';end if;
  starts:=target.starts_at;ends:=target.ends_at;
 else
  if p_value ? 'lessonId' or p_value ? 'lessonVersion' or coalesce(p_value->>'startsAt','') !~ '(Z|[+-][0-9]{2}:[0-9]{2})$' or coalesce(p_value->>'endsAt','') !~ '(Z|[+-][0-9]{2}:[0-9]{2})$'
  or not exists(select 1 from pg_timezone_names where name=p_value->>'timezone') or p_value->>'timezone' in ('localtime','posixrules') or p_value->>'timezone' like 'posix/%' or p_value->>'timezone' like 'right/%'
  or jsonb_typeof(p_value->'topic') is distinct from 'string' or length(trim(p_value->>'topic')) not between 1 and 300
  or coalesce(p_value->>'locationType','') not in ('in_person','virtual') or jsonb_typeof(p_value->'locationLabel') is distinct from 'string' or length(trim(p_value->>'locationLabel')) not between 1 and 500 then raise exception 'VALIDATION_FAILED';end if;
  starts:=(p_value->>'startsAt')::timestamptz;ends:=(p_value->>'endsAt')::timestamptz;
  if not isfinite(starts) or not isfinite(ends) or ends<=starts or ends>now() then raise exception 'REVIEW_REQUIRED: Enter a finite increasing historical interval.';end if;
 end if;
 select count(*) into source_count from public.lessons l where l.studio_id=student.studio_id and
 ((l.source_provider not in ('studio','public_booking','gmail') and l.source_external_id in(candidate.event_id,candidate.source_key))
  or exists(select 1 from public.calendar_projections p where p.lesson_id=l.id and p.external_event_id=candidate.event_id));
 select coalesce(jsonb_agg(to_jsonb(x) order by x.id),'[]') into source_examples from (
  select l.id,l.version,l.status,l.starts_at,l.ends_at,l.topic from public.lessons l where l.studio_id=student.studio_id and
  ((l.source_provider not in ('studio','public_booking','gmail') and l.source_external_id in(candidate.event_id,candidate.source_key))
   or exists(select 1 from public.calendar_projections p where p.lesson_id=l.id and p.external_event_id=candidate.event_id)) order by l.id limit 2
 ) x;
 select count(*) into interval_count from public.lessons l where l.studio_id=student.studio_id and l.starts_at=starts and l.ends_at=ends
 and (l.student_id=student.id or exists(select 1 from public.lesson_participants p where p.lesson_id=l.id and p.student_id=student.id));
 select coalesce(jsonb_agg(to_jsonb(x) order by x.id),'[]') into interval_examples from (
  select l.id,l.version,l.status,l.starts_at,l.ends_at,l.topic from public.lessons l where l.studio_id=student.studio_id and l.starts_at=starts and l.ends_at=ends
  and (l.student_id=student.id or exists(select 1 from public.lesson_participants p where p.lesson_id=l.id and p.student_id=student.id)) order by l.id limit 2
 ) x;
 if base#>>'{decision,disposition}' in ('not_lesson','skipped') or exists(select 1 from jsonb_array_elements(base->'priorSignals') i where i->>'status'='ignored') then blocked:='reopen_required';
 elsif source_count>1 or (source_count=1 and (action='create' or source_examples#>>'{0,id}'<>target.id::text)) then blocked:='source_identity_requires_review';
 elsif action='create' and interval_count>0 then blocked:='existing_historical_interval';
 elsif action='create' and exists(select 1 from public.lessons l where l.studio_id=student.studio_id and l.status='scheduled' and l.offering_id is null and tstzrange(l.starts_at,l.ends_at,'[)')&&tstzrange(starts,ends,'[)')) then blocked:='private_lesson_overlap';
 elsif base#>>'{decision,lesson_id}' is not null and (action='create' or base#>>'{decision,lesson_id}'<>target.id::text) then blocked:='preserve_canonical_link';
 elsif exists(select 1 from jsonb_array_elements(base->'priorSignals') i where i->>'lessonId' is not null and (action='create' or i->>'lessonId'<>target.id::text)) then blocked:='preserve_canonical_link';
 elsif exists(select 1 from public.integration_imports i where i.studio_id=student.studio_id and i.provider='google_calendar' and i.external_id in(candidate.event_id,candidate.source_key) and i.student_id is not null and i.student_id<>student.id) then blocked:='student_identity_requires_review';
 elsif exists(select 1 from public.integration_imports i join discovery_internal.source_decisions d on d.studio_id=i.studio_id and d.event_id=candidate.event_id and d.calendar_id<>candidate.calendar_id
  where i.studio_id=student.studio_id and i.provider='google_calendar' and i.external_id=candidate.event_id) then blocked:='ambiguous_legacy_calendar';
 end if;
 differs:=candidate.status<>'active' or candidate.starts_at is distinct from starts or candidate.ends_at is distinct from ends;
 if blocked is null and differs and p_value->'acknowledgeSourceDifference' is distinct from 'true'::jsonb then blocked:='source_difference_acknowledgement_required';end if;
 if blocked is null and action='link' and interval_count>1 and p_value->'acknowledgeDuplicateReview' is distinct from 'true'::jsonb then blocked:='duplicate_review_acknowledgement_required';end if;
 digest:=encode(extensions.digest(jsonb_build_object('sourceStamp',base->>'stamp','proposal',p_value,'student',to_jsonb(student),'target',to_jsonb(target),'sourceCount',source_count,'sourceExamples',source_examples,'intervalCount',interval_count,'intervalExamples',interval_examples)::text,'sha256'),'hex');
 return (base-'stamp')||jsonb_build_object('stamp',digest,'proposal',p_value,'student',jsonb_build_object('id',student.id,'name',coalesce(student.preferred_name,student.full_name),'version',student.version),
  'target',case when target.id is not null then jsonb_build_object('id',target.id,'version',target.version,'status',target.status,'startsAt',target.starts_at,'endsAt',target.ends_at,'topic',target.topic) end,
  'startsAt',starts,'endsAt',ends,'sourceDifference',differs,'sourceMatchCount',source_count,'sourceMatchExamples',source_examples,'intervalMatchCount',interval_count,'intervalMatchExamples',interval_examples,'examplesAreComplete',source_count<=2 and interval_count<=2,'blockedReason',blocked,
  'recordedOutcome',case when action='create' then 'scheduled' else target.status::text end,'attendanceVerified',false,'financialCoverageVerified',false,'phase','preview','proposedCanonicalEffects',case when action='create' then '["historical_lesson","confirmed_participant"]'::jsonb else '[]'::jsonb end);
end $$;
revoke all on function discovery_internal.canonical_reconciliation_preview(uuid,jsonb) from public,anon,authenticated,service_role;
create function public.preview_historical_calendar_reconciliation(p_candidate uuid,p_value jsonb) returns jsonb
language sql security definer set search_path='' as $$select discovery_internal.canonical_reconciliation_preview(p_candidate,p_value)$$;
revoke all on function public.preview_historical_calendar_reconciliation(uuid,jsonb) from public,anon,service_role;
grant execute on function public.preview_historical_calendar_reconciliation(uuid,jsonb) to authenticated;

create function public.command_historical_calendar_reconciliation(p_candidate uuid,p_value jsonb,p_stamp text,p_key text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); candidate discovery_internal.candidates; scan discovery_internal.scans; student public.students; target public.lessons;
 head discovery_internal.source_decisions; prior discovery_internal.review_receipts; signal public.integration_imports;
 preview jsonb; before_head jsonb; before_lesson jsonb; imports_before jsonb; imports_after jsonb; fingerprint text;
 old_version integer:=0; audit_id uuid:=gen_random_uuid(); scoped_id uuid:=gen_random_uuid(); result jsonb; v_action text:=p_value->>'action';
 digest text:=encode(extensions.digest(jsonb_build_object('command','historical_calendar_reconciliation','candidateId',p_candidate,'value',p_value,'stamp',p_stamp)::text,'sha256'),'hex');
begin
 select * into candidate from discovery_internal.candidates where id=p_candidate;
 select * into scan from discovery_internal.scans where id=candidate.scan_id;
 if actor is null or scan.id is null or not public.is_studio_coach(scan.studio_id) then raise exception 'FORBIDDEN' using errcode='42501';end if;
 if length(coalesce(p_key,'')) not between 8 and 200 or coalesce(p_stamp,'') !~ '^[0-9a-f]{64}$' then raise exception 'VALIDATION_FAILED';end if;
 perform pg_advisory_xact_lock(hashtext(scan.studio_id::text));
 perform pg_advisory_xact_lock(hashtextextended(actor::text||':historical-review:'||p_key,0));
 select * into prior from discovery_internal.review_receipts where actor_id=actor and request_key=p_key;
 if found then if prior.request_hash<>digest or prior.studio_id<>scan.studio_id then raise exception 'IDEMPOTENCY_CONFLICT';end if;return prior.result;end if;
 select * into candidate from discovery_internal.candidates where id=p_candidate for update;
 perform pg_advisory_xact_lock(hashtextextended(jsonb_build_array(scan.studio_id,candidate.event_id)::text,0));
 perform 1 from discovery_internal.source_decisions where studio_id=scan.studio_id and event_id=candidate.event_id order by id for update;
 select * into student from public.students where id=(p_value->>'studentId')::uuid and studio_id=scan.studio_id and deleted_at is null for update;
 if student.id is null then raise exception 'FORBIDDEN' using errcode='42501';end if;
 perform 1 from public.integration_imports where studio_id=scan.studio_id and provider='google_calendar' and external_id in(candidate.source_key,candidate.event_id) order by id for update;
 perform 1 from public.lessons l where l.studio_id=scan.studio_id and
  (l.id=nullif(p_value->>'lessonId','')::uuid
   or (l.source_provider not in ('studio','public_booking','gmail') and l.source_external_id in(candidate.event_id,candidate.source_key))
   or exists(select 1 from public.calendar_projections p where p.lesson_id=l.id and p.external_event_id=candidate.event_id)
   or exists(select 1 from public.integration_imports i where i.studio_id=scan.studio_id and i.provider='google_calendar' and i.external_id in(candidate.source_key,candidate.event_id) and i.lesson_id=l.id)) order by l.id for update;
 perform 1 from public.lesson_participants p join public.lessons l on l.id=p.lesson_id where l.studio_id=scan.studio_id and l.id=nullif(p_value->>'lessonId','')::uuid order by p.id for update of p;
 perform 1 from public.calendar_projections p join public.lessons l on l.id=p.lesson_id where l.studio_id=scan.studio_id and p.external_event_id=candidate.event_id order by p.lesson_id for update of p;
 preview:=discovery_internal.canonical_reconciliation_preview(p_candidate,p_value);
 if preview->>'stamp'<>p_stamp then raise exception 'VERSION_CONFLICT: Refresh the historical reconciliation preview.';end if;
 if preview->>'blockedReason' is not null then raise exception 'REVIEW_REQUIRED: %',preview->>'blockedReason';end if;
 select * into head from discovery_internal.source_decisions where studio_id=scan.studio_id and calendar_id=candidate.calendar_id and event_id=candidate.event_id;
 if head.id is not null then before_head:=to_jsonb(head);old_version:=head.version;end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',i.id,'studentId',i.student_id,'lessonId',i.lesson_id,'status',i.status,'verifiedAt',i.verified_at,'verifiedBy',i.verified_by,'updatedAt',i.updated_at) order by i.id),'[]') into imports_before
 from public.integration_imports i where i.studio_id=scan.studio_id and i.provider='google_calendar' and i.external_id in(candidate.source_key,candidate.event_id);
 fingerprint:=encode(extensions.digest(jsonb_build_object('calendarId',candidate.calendar_id,'event',preview->'observation')::text,'sha256'),'hex');
 if head.id is null then
  insert into discovery_internal.source_decisions(studio_id,calendar_id,event_id,disposition,reviewed_hash,actor_id,reason)
   values(scan.studio_id,candidate.calendar_id,candidate.event_id,'review',fingerprint,actor,trim(p_value->>'reason')) returning * into head;
 end if;
 if v_action='create' then
  insert into public.lessons(studio_id,student_id,topic,starts_at,ends_at,status,location_type,location_label,source_provider,source_external_id,source_confidence,imported_at,price_minor,paid_minor,payment_status)
   values(scan.studio_id,student.id,trim(p_value->>'topic'),(preview->>'startsAt')::timestamptz,(preview->>'endsAt')::timestamptz,'scheduled',p_value->>'locationType',trim(p_value->>'locationLabel'),'google_calendar',candidate.source_key,1,now(),0,0,'untracked') returning * into target;
  insert into public.lesson_participants(lesson_id,student_id,display_name,email,status)
   values(target.id,student.id,coalesce(student.preferred_name,student.full_name),coalesce(student.email,''),'confirmed');
 else
  select * into target from public.lessons where id=(p_value->>'lessonId')::uuid and studio_id=scan.studio_id;
  before_lesson:=to_jsonb(target);
 end if;
 update discovery_internal.source_decisions set disposition='linked',lesson_id=target.id,lesson_ends_at=target.ends_at,reviewed_hash=fingerprint,
  actor_id=actor,reason=trim(p_value->>'reason'),version=old_version+1,decided_at=now() where id=head.id returning * into head;
 for signal in select * from public.integration_imports where studio_id=scan.studio_id and provider='google_calendar' and external_id in(candidate.source_key,candidate.event_id) order by id loop
  insert into discovery_internal.source_write_authorizations(transaction_id,decision_id,import_id,actor_id) values(txid_current(),head.id,signal.id,actor);
  update public.integration_imports set student_id=student.id,lesson_id=target.id,status='imported',confidence=1,matched_by='coach historical reconciliation',verified_at=now(),verified_by=actor,
   verification_note=trim(p_value->>'reason'),last_error=null,updated_at=clock_timestamp() where id=signal.id;
  delete from discovery_internal.source_write_authorizations where transaction_id=txid_current() and decision_id=head.id and import_id=signal.id and actor_id=actor;
 end loop;
 if not exists(select 1 from public.integration_imports where studio_id=scan.studio_id and provider='google_calendar' and external_id=candidate.source_key) then
  insert into discovery_internal.source_write_authorizations(transaction_id,decision_id,import_id,actor_id) values(txid_current(),head.id,scoped_id,actor);
  insert into public.integration_imports(id,studio_id,provider,external_id,detected_source,student_id,lesson_id,status,confidence,matched_by,payload,verified_at,verified_by,verification_note)
   values(scoped_id,scan.studio_id,'google_calendar',candidate.source_key,'google_calendar',student.id,target.id,'imported',1,'coach historical reconciliation',jsonb_build_object('observation',preview->'observation','calendarId',candidate.calendar_id,'candidateId',candidate.id),now(),actor,trim(p_value->>'reason'));
  delete from discovery_internal.source_write_authorizations where transaction_id=txid_current() and decision_id=head.id and import_id=scoped_id and actor_id=actor;
 end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',i.id,'studentId',i.student_id,'lessonId',i.lesson_id,'status',i.status,'verifiedAt',i.verified_at,'verifiedBy',i.verified_by,'updatedAt',i.updated_at) order by i.id),'[]') into imports_after
 from public.integration_imports i where i.studio_id=scan.studio_id and i.provider='google_calendar' and i.external_id in(candidate.source_key,candidate.event_id);
 insert into discovery_internal.decision_revisions(decision_id,version,actor_id,request_key,action,reason,before_state,after_state,import_before,import_after)
 values(head.id,head.version,actor,p_key,v_action,trim(p_value->>'reason'),before_head,to_jsonb(head),imports_before,imports_after);
 insert into public.audit_events(id,studio_id,actor_id,entity_type,entity_id,action,reason,correlation_id,source,before_state,after_state)
 values(audit_id,scan.studio_id,actor,'historical_calendar_decision',head.id,'discovery.historical_'||v_action,trim(p_value->>'reason'),p_key,'coach_historical_reconciliation',
  jsonb_build_object('decision',before_head,'lesson',before_lesson,'imports',imports_before),jsonb_build_object('decision',to_jsonb(head),'lesson',to_jsonb(target),'imports',imports_after,'reviewedProposal',p_value,'attendanceVerified',false,'financialCoverageVerified',false,'providerEffects','[]'::jsonb));
 result:=jsonb_build_object('resource',jsonb_build_object('candidateId',candidate.id,'decisionId',head.id,'decisionVersion',head.version,'lessonId',target.id,'lessonVersion',target.version,'studentId',student.id,
  'created',v_action='create','linked',true,'recordedOutcome',target.status,'attendanceVerified',false,'financialCoverageVerified',false),'auditEventId',audit_id,'queuedSideEffects','[]'::jsonb);
 insert into discovery_internal.review_receipts(actor_id,request_key,studio_id,request_hash,result) values(actor,p_key,scan.studio_id,digest,result);
 return result;
end $$;
revoke all on function public.command_historical_calendar_reconciliation(uuid,jsonb,text,text) from public,anon,service_role;
grant execute on function public.command_historical_calendar_reconciliation(uuid,jsonb,text,text) to authenticated;

-- Preserve the existing guarded coach merge and private proof checks.
create or replace function discovery_internal.guard_historical_calendar_import() returns trigger
language plpgsql security definer set search_path='' as $$
declare item public.integration_imports; decision discovery_internal.source_decisions;
begin
 -- Serialize new legacy/scoped source identities with canonical reconciliation.
 if tg_op='INSERT' and new.provider='google_calendar' then perform pg_advisory_xact_lock(hashtext(new.studio_id::text));end if;
 if tg_op='UPDATE' and old.provider='google_calendar' and (new.studio_id,new.provider,new.external_id) is distinct from (old.studio_id,old.provider,old.external_id)
 and exists(select 1 from discovery_internal.source_decisions d where d.studio_id=old.studio_id and (d.event_id=old.external_id or jsonb_build_array(d.calendar_id,d.event_id)::text=old.external_id)) then
  raise exception 'REVIEW_REQUIRED: A protected Calendar identity cannot be rewritten.';
 end if;
 if tg_op='DELETE' then item:=old;else item:=new;end if;
 if item.provider<>'google_calendar' then if tg_op='DELETE' then return old;else return new;end if;end if;
 -- Existing authenticated coach profile merges move lesson/participant identity
 -- before import identity. Preserve only that association change, never a
 -- source decision, payload, outcome, or lesson-link edit. Workers cannot use it.
 if tg_op='UPDATE' and new.student_id is distinct from old.student_id
 and (to_jsonb(new)-'student_id'-'updated_at')=(to_jsonb(old)-'student_id'-'updated_at')
 and public.is_studio_coach(old.studio_id)
 and exists(select 1 from public.students s where s.id=new.student_id and s.studio_id=old.studio_id)
 and (old.lesson_id is null or exists(select 1 from public.lessons l where l.id=old.lesson_id and l.studio_id=old.studio_id
  and (l.student_id=new.student_id or exists(select 1 from public.lesson_participants p where p.lesson_id=l.id and p.student_id=new.student_id)))) then return new;end if;
 for decision in select * from discovery_internal.source_decisions d where d.studio_id=item.studio_id and (d.event_id=item.external_id or jsonb_build_array(d.calendar_id,d.event_id)::text=item.external_id) loop
  if not exists(select 1 from discovery_internal.source_write_authorizations a where a.transaction_id=txid_current() and a.decision_id=decision.id and a.import_id=item.id and a.actor_id=auth.uid() and exists(select 1 from public.memberships m where m.user_id=a.actor_id and m.studio_id=decision.studio_id and m.role='coach')) then
   raise exception 'REVIEW_REQUIRED: Use the historical reconciliation command for this Calendar decision.';
  end if;
 end loop;
 if tg_op='DELETE' then return old;else return new;end if;
end $$;
revoke all on function discovery_internal.guard_historical_calendar_import() from public,anon,authenticated,service_role;

-- Explicit reopening can hold an uncertain source for review. It creates no
-- lesson and still rejects any linked future canonical lesson. Strict exclusion
-- preview and not-a-lesson/skip remain historical-only.
create or replace function public.command_historical_calendar_review(p_candidate uuid,p_payload jsonb,p_key text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); candidate discovery_internal.candidates; scan discovery_internal.scans; head discovery_internal.source_decisions;
 prior discovery_internal.review_receipts; before_head jsonb; before_import jsonb; after_import jsonb; original public.integration_imports;
 preview jsonb; fingerprint text; linked_lesson public.lessons; action text:=p_payload->>'action'; review_reason text:=trim(p_payload->>'reason'); result jsonb; audit_id uuid:=gen_random_uuid();
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
 or review_reason is null or length(review_reason) not between 3 and 500 or coalesce(p_payload->>'stamp','') !~ '^[0-9a-f]{64}$'
 or exists(select 1 from jsonb_object_keys(p_payload) k where k not in ('action','reason','stamp','legacyImportId','legacyUpdatedAt','acknowledgeUnscoped')) then raise exception 'VALIDATION_FAILED';end if;
 select * into candidate from discovery_internal.candidates where id=p_candidate for update;
 perform pg_advisory_xact_lock(hashtextextended(jsonb_build_array(scan.studio_id,candidate.event_id)::text,0));
 perform 1 from discovery_internal.source_decisions where studio_id=scan.studio_id and event_id=candidate.event_id order by id for update;
 perform 1 from public.integration_imports where studio_id=scan.studio_id and provider='google_calendar' and external_id in(candidate.source_key,candidate.event_id) order by id for update;
 perform 1 from public.lessons l where l.studio_id=scan.studio_id and (exists(select 1 from discovery_internal.source_decisions d where d.studio_id=scan.studio_id and d.calendar_id=candidate.calendar_id and d.event_id=candidate.event_id and d.lesson_id=l.id)
  or exists(select 1 from public.integration_imports i where i.studio_id=scan.studio_id and i.provider='google_calendar' and i.external_id in(candidate.source_key,candidate.event_id) and i.lesson_id=l.id)) order by l.id for update;
 preview:=case when action='reopen' then discovery_internal.historical_review_snapshot_core(p_candidate,true) else discovery_internal.historical_review_snapshot(p_candidate) end;
 if preview->>'stamp'<>p_payload->>'stamp' then raise exception 'VERSION_CONFLICT: Refresh the historical source preview.';end if;
 select * into head from discovery_internal.source_decisions where studio_id=scan.studio_id and calendar_id=candidate.calendar_id and event_id=candidate.event_id;
 before_head:=case when head.id is not null then to_jsonb(head) end;
 if head.lesson_id is not null then
  select * into linked_lesson from public.lessons where id=head.lesson_id and studio_id=scan.studio_id;
  if linked_lesson.id is null or linked_lesson.ends_at>now() then raise exception 'REVIEW_REQUIRED: Preserve the exact historical canonical lesson link.';end if;
 end if;
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
   values(scan.studio_id,candidate.calendar_id,candidate.event_id,case action when 'skip' then 'skipped' when 'reopen' then 'review' else 'not_lesson' end,fingerprint,actor,review_reason,linked_lesson.id,linked_lesson.ends_at) returning * into head;
 else
  update discovery_internal.source_decisions set disposition=case action when 'skip' then 'skipped' when 'reopen' then 'review' else 'not_lesson' end,
   version=version+1,reviewed_hash=fingerprint,actor_id=actor,reason=review_reason,decided_at=now(),
   lesson_id=coalesce(head.lesson_id,linked_lesson.id),lesson_ends_at=coalesce(linked_lesson.ends_at,head.lesson_ends_at) where id=head.id returning * into head;
 end if;
 if original.id is not null then
  insert into discovery_internal.source_write_authorizations(transaction_id,decision_id,import_id,actor_id) values(txid_current(),head.id,original.id,actor);
  update public.integration_imports set status='needs_review',updated_at=clock_timestamp() where id=original.id;
  select jsonb_build_object('id',i.id,'status',i.status,'lessonId',i.lesson_id,'updatedAt',i.updated_at) into after_import from public.integration_imports i where i.id=original.id;
  delete from discovery_internal.source_write_authorizations where transaction_id=txid_current() and decision_id=head.id and import_id=original.id and actor_id=actor;
 end if;
 insert into discovery_internal.decision_revisions(decision_id,version,actor_id,request_key,action,reason,before_state,after_state,import_before,import_after)
 values(head.id,head.version,actor,p_key,action,review_reason,before_head,to_jsonb(head),before_import,after_import);
 insert into public.audit_events(id,studio_id,actor_id,entity_type,entity_id,action,reason,correlation_id,source,before_state,after_state)
 values(audit_id,scan.studio_id,actor,'historical_calendar_decision',head.id,'discovery.historical_'||action,review_reason,p_key,'coach_historical_review',before_head,
  jsonb_build_object('decision',to_jsonb(head),'candidateId',p_candidate,'importBefore',before_import,'importAfter',after_import,'canonicalEffects','[]'::jsonb));
 result:=jsonb_build_object('resource',jsonb_build_object('candidateId',p_candidate,'decisionId',head.id,'version',head.version,'disposition',head.disposition,'lessonId',head.lesson_id,'attendanceVerified',false,'financialCoverageVerified',false),
  'auditEventId',audit_id,'queuedSideEffects','[]'::jsonb);
 insert into discovery_internal.review_receipts(actor_id,request_key,studio_id,request_hash,result) values(actor,p_key,scan.studio_id,digest,result);
 return result;
end $$;
revoke all on function public.command_historical_calendar_review(uuid,jsonb,text) from public,anon,service_role;
grant execute on function public.command_historical_calendar_review(uuid,jsonb,text) to authenticated;

create function public.preview_historical_calendar_reopening(p_candidate uuid) returns jsonb
language sql security definer set search_path='' as $$
 select discovery_internal.historical_review_snapshot_core(p_candidate,true)||jsonb_build_object('phase','reopen_preview','eligibleActions',jsonb_build_array('reopen'))
$$;
revoke all on function public.preview_historical_calendar_reopening(uuid) from public,anon,service_role;
grant execute on function public.preview_historical_calendar_reopening(uuid) to authenticated;

create function public.historical_calendar_decision_history(p_candidate uuid,p_before_version integer default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare base jsonb:=discovery_internal.historical_review_snapshot_core(p_candidate,true); head uuid:=(base#>>'{decision,id}')::uuid; items jsonb; more boolean; next_version integer; total bigint;
begin
 if p_before_version is not null and p_before_version<1 then raise exception 'VALIDATION_FAILED';end if;
 select count(*) into total from discovery_internal.decision_revisions where decision_id=head;
 with page as(select * from discovery_internal.decision_revisions where decision_id=head and (p_before_version is null or version<p_before_version) order by version desc limit 26), visible as(select * from page order by version desc limit 25)
 select coalesce(jsonb_agg(jsonb_build_object('version',version,'action',action,'reason',reason,'actorId',actor_id,'createdAt',created_at,'before',before_state,'after',after_state,'importBefore',import_before,'importAfter',import_after) order by version desc),'[]'),(select count(*)>25 from page),min(version) into items,more,next_version from visible;
 return jsonb_build_object('decision',base->'decision','items',items,'total',total,'hasMore',more,'nextBeforeVersion',case when more then next_version end);
end $$;
revoke all on function public.historical_calendar_decision_history(uuid,integer) from public,anon,service_role;
grant execute on function public.historical_calendar_decision_history(uuid,integer) to authenticated;
