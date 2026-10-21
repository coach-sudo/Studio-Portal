-- Wave 6: repair supported intake attribution and make existing coach review atomic.
-- Existing lesson policies/ledgers are delegated to the occurrence command.
alter table public.lessons drop constraint lessons_source_provider_check;
alter table public.lessons add constraint lessons_source_provider_check check
 (source_provider in ('studio','public_booking','google_calendar','gmail','lessonface','wyzant','lessons_com','superprof','acuity'));
alter table public.integration_imports drop constraint integration_imports_provider_check;
alter table public.integration_imports add constraint integration_imports_provider_check check
 (provider in ('google_calendar','gmail','lessonface','wyzant','lessons_com','superprof','acuity'));

create or replace function workspace_internal.review_provider_import(p_import uuid,p_payload jsonb,p_key text)
returns jsonb language plpgsql security definer set search_path='' as $$
<<review>>
declare actor uuid:=auth.uid(); original public.integration_imports; item public.integration_imports;
 student public.students; lesson public.lessons; receipt workspace_internal.operation_receipts;
 request jsonb:=jsonb_build_object('command','provider.review','id',p_import,'payload',p_payload);
 result jsonb; audit_id uuid; ids uuid[]; target uuid; v_lesson_id uuid; candidate jsonb; change text;
 action text:=p_payload->>'action'; reviewed integer:=0; starts timestamptz; ends timestamptz; fingerprint text;
begin
 if actor is null then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 select * into original from public.integration_imports where id=p_import;
 if original.id is null or not public.is_studio_coach(original.studio_id) then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 -- Same studio serialization as occurrence commands; actor/key fence for replay.
 perform pg_advisory_xact_lock(hashtext(original.studio_id::text));
 perform pg_advisory_xact_lock(hashtext(actor::text||p_key));
 select * into receipt from workspace_internal.operation_receipts where actor_id=actor and key=p_key;
 if found then if receipt.request<>request then raise exception 'IDEMPOTENCY_CONFLICT'; end if; return receipt.result; end if;
 if jsonb_typeof(p_payload) is distinct from 'object' or action is null or action not in ('existing','create','ignore') or length(coalesce(p_key,''))<8 or length(p_payload::text)>40000 then raise exception 'VALIDATION_FAILED'; end if;
 if coalesce((p_payload->>'applySimilar')::boolean,false) then
  if jsonb_typeof(p_payload->'reviewRows') is distinct from 'array' or jsonb_array_length(p_payload->'reviewRows')>100 then raise exception 'REVIEW_REQUIRED: Review at most 100 exact signals.'; end if;
  select array_agg((r->>'id')::uuid order by r->>'id') into ids from jsonb_array_elements(p_payload->'reviewRows') r;
 else ids:=array[p_import]; end if;
 if ids is null or not p_import=any(ids) then raise exception 'VALIDATION_FAILED'; end if;
 perform 1 from public.integration_imports where id=any(ids) order by id for update;
 if (select count(*) from public.integration_imports where id=any(ids) and studio_id=original.studio_id)<>cardinality(ids) then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 fingerprint:=coalesce(original.payload->>'summary',original.payload#>>'{headers,subject}',original.payload->>'snippet',original.external_id);
 for item in select * from public.integration_imports where id=any(ids) order by id loop
  if item.status<>'needs_review' then raise exception 'VERSION_CONFLICT: This signal has already been reviewed. Refresh Today.'; end if;
  if item.detected_source<>original.detected_source or coalesce(item.payload->>'summary',item.payload#>>'{headers,subject}',item.payload->>'snippet',item.external_id)<>fingerprint then raise exception 'REVIEW_REQUIRED: Signal group changed.'; end if;
  if exists(select 1 from jsonb_array_elements(coalesce(p_payload->'reviewRows','[]')) r where r->>'id'=item.id::text and (r->>'updatedAt')::timestamptz<>item.updated_at) then raise exception 'VERSION_CONFLICT: Signal changed since review.'; end if;
 end loop;
 if action<>'ignore' then
  target:=nullif(p_payload->>'studentId','')::uuid;
  if action='create' then
   if length(trim(coalesce(p_payload->>'fullName','')))<2 then raise exception 'VALIDATION_FAILED: Enter the student name.'; end if;
   if coalesce(original.payload->>'changeType','confirmation')<>'confirmation' then raise exception 'REVIEW_REQUIRED: Link this change to an existing lesson.'; end if;
   insert into public.students(studio_id,full_name,email,status,portal_enabled,lead_source)
    values(original.studio_id,trim(p_payload->>'fullName'),nullif(lower(trim(p_payload->>'email')),''),'lead',false,original.detected_source) returning id into target;
  end if;
  select * into student from public.students where id=target and studio_id=original.studio_id and deleted_at is null for update;
  if student.id is null then raise exception 'FORBIDDEN' using errcode='42501'; end if;
  if nullif(p_payload->>'mergeStudentId','') is not null and (p_payload->>'mergeStudentId')::uuid<>target then
   perform public.merge_studio_students(target,(p_payload->>'mergeStudentId')::uuid);
  end if;
 end if;
 for item in select * from public.integration_imports where id=any(ids) order by id loop
  v_lesson_id:=item.lesson_id; candidate:=coalesce(item.payload->'candidate',jsonb_build_object('startsAt',item.payload#>>'{start,dateTime}','endsAt',item.payload#>>'{end,dateTime}','topic',item.payload->>'summary','joinUrl',item.payload->>'hangoutLink','locationLabel',item.payload->>'location')); change:=coalesce(item.payload->>'changeType','confirmation');
  if action<>'ignore' then
   if change in ('reschedule','cancellation') then
    if cardinality(ids)<>1 then raise exception 'REVIEW_REQUIRED: Review lesson changes individually.'; end if;
    v_lesson_id:=coalesce(nullif(p_payload->>'lessonId','')::uuid,item.lesson_id);
    select * into lesson from public.lessons where id=v_lesson_id and studio_id=original.studio_id and student_id=target for update;
    if lesson.id is null then raise exception 'REVIEW_REQUIRED: Choose the exact existing lesson.'; end if;
    if (p_payload->>'lessonVersion')::integer is distinct from lesson.version then raise exception 'VERSION_CONFLICT: Refresh the selected lesson.'; end if;
    perform set_config('app.lesson_actor',actor::text,true);
    perform public.command_change_lesson_state(lesson.id,lesson.version,case when change='cancellation' then 'cancel' else 'reschedule' end,
     case when change='reschedule' then (candidate->>'startsAt')::timestamptz else null end,
     case when change='reschedule' then (candidate->>'endsAt')::timestamptz else null end,true);
   else
    if v_lesson_id is not null then
     select * into lesson from public.lessons where id=v_lesson_id and studio_id=original.studio_id for update;
     -- Relinking only untouched single-student provider records; never rewrite class history.
     if lesson.id is null or lesson.offering_id is not null or exists(select 1 from public.lesson_participants where lesson_participants.lesson_id=lesson.id and (booking_id is not null or student_id is distinct from lesson.student_id)) then raise exception 'REVIEW_REQUIRED: Open the shared lesson workspace.'; end if;
     if lesson.student_id is distinct from target then raise exception 'REVIEW_REQUIRED: Merge or review the existing student association first.'; end if;
    else
     starts:=(candidate->>'startsAt')::timestamptz; ends:=(candidate->>'endsAt')::timestamptz;
     if nullif(candidate->>'joinUrl','') is not null and candidate->>'joinUrl' !~ '^https://' then raise exception 'VALIDATION_FAILED: Provider link must use HTTPS.'; end if;
     if starts is null or ends is null or ends<=starts then raise exception 'REVIEW_REQUIRED: Open the lesson calendar to confirm its time.'; end if;
     select * into lesson from public.lessons l where l.studio_id=original.studio_id and l.student_id=target and l.starts_at=starts and l.ends_at=ends and l.status not in ('cancelled','late_cancelled') order by id limit 1 for update;
     v_lesson_id:=lesson.id;
     if v_lesson_id is null then
      insert into public.lessons(studio_id,student_id,topic,starts_at,ends_at,status,location_type,location_label,join_url,meeting_provider,source_provider,source_external_id,source_confidence,imported_at)
       values(original.studio_id,target,coalesce(candidate->>'topic',initcap(item.detected_source)||' lesson'),starts,ends,(case when ends<now() then 'completed' else 'scheduled' end)::public.lesson_status,
        case when nullif(candidate->>'joinUrl','') is not null then 'virtual' else 'in_person' end,coalesce(candidate->>'locationLabel','Provider booking'),nullif(candidate->>'joinUrl',''),
        case when candidate->>'joinUrl' like 'https://meet.google.com/%' then 'google_meet' when nullif(candidate->>'joinUrl','') is null then 'in_person' else null end,item.detected_source,item.external_id,1,now()) returning id into v_lesson_id;
      insert into public.lesson_participants(lesson_id,student_id,display_name,email,status) values(v_lesson_id,target,coalesce(student.preferred_name,student.full_name),coalesce(student.email,''),'confirmed');
      if ends>now() then insert into public.calendar_projections(lesson_id,status) values(v_lesson_id,'queued') on conflict(lesson_id) do nothing; end if;
     end if;
    end if;
   end if;
  end if;
  update public.integration_imports set student_id=case when action='ignore' then student_id else target end,lesson_id=v_lesson_id,
   status=case when action='ignore' then 'ignored' else 'imported' end,confidence=1,matched_by='coach review',verified_at=now(),verified_by=actor,
   verification_note=coalesce(nullif(p_payload->>'note',''),'Coach reviewed provider signal'),last_error=null,updated_at=now() where id=item.id;
  reviewed:=reviewed+1;
 end loop;
 if action<>'ignore' then perform public.reserve_student_upcoming_credits(target); end if;
 insert into public.audit_events(studio_id,actor_id,action,entity_type,entity_id,reason,correlation_id,source,before_state,after_state)
  values(original.studio_id,actor,'integration_import.'||case when action='ignore' then 'ignored' else 'confirmed' end,'integration_import',original.id,
   coalesce(nullif(p_payload->>'note',''),'Coach reviewed provider signal'),p_key,'coach_portal',to_jsonb(original),jsonb_build_object('ids',ids,'studentId',target)) returning id into audit_id;
 result:=jsonb_build_object('resource',jsonb_build_object('reviewed',reviewed,'studentId',target),'auditEventId',audit_id,'queuedSideEffects','[]'::jsonb);
 insert into workspace_internal.operation_receipts(actor_id,key,studio_id,request,result) values(actor,p_key,original.studio_id,request,result);
 return result;
end $$;
revoke all on function workspace_internal.review_provider_import(uuid,jsonb,text) from public,anon,service_role;
grant usage on schema workspace_internal to authenticated;
grant execute on function workspace_internal.review_provider_import(uuid,jsonb,text) to authenticated;
create or replace function public.command_review_provider_import(p_import uuid,p_payload jsonb,p_key text) returns jsonb
language sql security invoker set search_path='' as $$ select workspace_internal.review_provider_import(p_import,p_payload,p_key) $$;
revoke all on function public.command_review_provider_import(uuid,jsonb,text) from public,anon,service_role;
grant execute on function public.command_review_provider_import(uuid,jsonb,text) to authenticated;
