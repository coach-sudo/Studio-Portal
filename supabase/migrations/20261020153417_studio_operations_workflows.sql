-- Additive Wave 5 workflow state. No existing records or financial balances are rewritten.
create table workspace_internal.operation_receipts (
  actor_id uuid not null, key text not null, studio_id uuid not null references public.studios(id), request jsonb not null, result jsonb not null,
  created_at timestamptz not null default now(), primary key(actor_id,key)
);
create table workspace_internal.student_setups (
  student_id uuid primary key references public.students(id) on delete restrict,
  studio_id uuid not null references public.studios(id), actor_id uuid not null,
  version integer not null default 1, draft jsonb not null default '{}', review jsonb,
  results jsonb not null default '{}', updated_at timestamptz not null default now()
);
alter table workspace_internal.operation_receipts enable row level security;
alter table workspace_internal.student_setups enable row level security;
revoke all on workspace_internal.operation_receipts,workspace_internal.student_setups from public,anon,authenticated,service_role;

create function public.find_student_duplicates(p_name text,p_email text default '',p_phone text default '') returns jsonb
language sql stable security invoker set search_path='' as $$
 select coalesce(jsonb_agg(to_jsonb(x)),'[]') from (
  select id,full_name,email,phone from public.students s where deleted_at is null and public.is_studio_coach(studio_id)
   and (lower(trim(full_name))=lower(trim(p_name)) or (trim(p_email)<>'' and lower(email)=lower(trim(p_email)))
    or (length(regexp_replace(p_phone,'\D','','g'))>=7 and regexp_replace(phone,'\D','','g')=regexp_replace(p_phone,'\D','','g')))
  order by full_name,id limit 10
 )x;
$$;
revoke all on function public.find_student_duplicates(text,text,text) from public,anon;
grant execute on function public.find_student_duplicates(text,text,text) to authenticated;

create function public.command_create_student_once(p_value jsonb,p_key text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=(select auth.uid()); studio uuid; old workspace_internal.operation_receipts; student public.students; result jsonb;
begin
 select studio_id into studio from public.memberships where user_id=actor and role='coach' order by id limit 1;
 if studio is null then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if length(p_key)<8 or length(trim(coalesce(p_value->>'fullName','')))<2 or length(p_value::text)>20000 then raise exception 'VALIDATION_FAILED'; end if;
 perform pg_advisory_xact_lock(hashtextextended(studio::text||':student:'||lower(trim(p_value->>'fullName')),0));
 if nullif(trim(p_value->>'email'),'') is not null then perform pg_advisory_xact_lock(hashtextextended(studio::text||':student-email:'||lower(trim(p_value->>'email')),0)); end if;
 if length(regexp_replace(coalesce(p_value->>'phone',''),'\D','','g'))>=7 then perform pg_advisory_xact_lock(hashtextextended(studio::text||':student-phone:'||regexp_replace(p_value->>'phone','\D','','g'),0)); end if;
 select * into old from workspace_internal.operation_receipts where actor_id=actor and key=p_key;
 if found then if old.request<>jsonb_build_object('command','student.create','payload',p_value) then raise exception 'IDEMPOTENCY_CONFLICT'; end if; return old.result; end if;
 if coalesce(p_value->>'email','')<>'' and p_value->>'email' !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then raise exception 'VALIDATION_FAILED: Check the email.'; end if;
 if coalesce((p_value->>'allowDuplicate')::boolean,false)=false and jsonb_array_length(public.find_student_duplicates(p_value->>'fullName',p_value->>'email',p_value->>'phone'))>0 then raise exception 'DUPLICATE_STUDENT: Review possible matches before creating a distinct record.'; end if;
 insert into public.students(studio_id,full_name,email,phone,focus_area,lead_source,is_minor,guardian_name,guardian_email,status,portal_enabled)
 values(studio,trim(p_value->>'fullName'),nullif(lower(trim(p_value->>'email')),''),nullif(trim(p_value->>'phone'),''),nullif(p_value->>'focusArea',''),nullif(p_value->>'leadSource',''),coalesce((p_value->>'isMinor')::boolean,false),nullif(p_value->>'guardianName',''),nullif(lower(trim(p_value->>'guardianEmail')),''),'lead',false) returning * into student;
 insert into public.audit_events(studio_id,actor_id,action,entity_type,entity_id,reason,correlation_id,source,after_state)
 values(studio,actor,'student.created','student',student.id,'Coach added student',p_key,'coach_portal',to_jsonb(student));
 result:=jsonb_build_object('resource',to_jsonb(student),'queuedSideEffects','[]'::jsonb);
 insert into workspace_internal.operation_receipts(actor_id,key,studio_id,request,result) values(actor,p_key,studio,jsonb_build_object('command','student.create','payload',p_value),result);
 return result;
end $$;
revoke all on function public.command_create_student_once(jsonb,text) from public,anon;
grant execute on function public.command_create_student_once(jsonb,text) to authenticated;

create function public.command_create_lesson_once(p_value jsonb,p_key text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=(select auth.uid()); student public.students; old workspace_internal.operation_receipts; result jsonb; audit_id uuid; cadence text:=coalesce(p_value->>'recurrence','none'); total integer:=coalesce((p_value->>'occurrenceCount')::integer,1); i integer; proposed_start timestamptz; proposed_end timestamptz; tz text:=coalesce(p_value->>'timezone','America/New_York');
begin
 select * into student from public.students where id=(p_value->>'studentId')::uuid and deleted_at is null for update;
 if actor is null or student.id is null or not public.is_studio_coach(student.studio_id) then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 perform pg_advisory_xact_lock(hashtextextended(student.studio_id::text||':calendar',0));
 if length(p_key)<8 then raise exception 'VALIDATION_FAILED'; end if;
 select * into old from workspace_internal.operation_receipts where actor_id=actor and key=p_key;
 if found then if old.request<>jsonb_build_object('command','lesson.create','payload',p_value) then raise exception 'IDEMPOTENCY_CONFLICT'; end if; return old.result; end if;
 if cadence not in ('none','weekly','biweekly') or total<1 or total>52 or (p_value->>'endsAt')::timestamptz<=(p_value->>'startsAt')::timestamptz then raise exception 'VALIDATION_FAILED'; end if;
 for i in 0..(case when cadence='none' then 1 else total end)-1 loop
  proposed_start:=(((p_value->>'startsAt')::timestamptz at time zone tz)+make_interval(days=>i*case when cadence='biweekly' then 14 else 7 end)) at time zone tz;
  proposed_end:=(((p_value->>'endsAt')::timestamptz at time zone tz)+make_interval(days=>i*case when cadence='biweekly' then 14 else 7 end)) at time zone tz;
  if proposed_end<=proposed_start or proposed_end-proposed_start>interval '12 hours' then raise exception 'VALIDATION_FAILED'; end if;
  if exists(select 1 from public.lessons l where l.studio_id=student.studio_id and l.status='scheduled' and l.starts_at<proposed_end and l.ends_at>proposed_start) and not coalesce((p_value->>'allowConflict')::boolean,false) then raise exception 'SLOT_UNAVAILABLE'; end if;
 end loop;
 result:=public.command_create_lesson(student.studio_id,student.id,coalesce(p_value->>'topic','Private coaching'),(p_value->>'startsAt')::timestamptz,(p_value->>'endsAt')::timestamptz,
 case when p_value->>'locationType'='in_person' then 'in_person' else 'virtual' end,coalesce(p_value->>'locationLabel','Google Meet'),student.full_name,coalesce(student.email,''),cadence,total,coalesce(p_value->>'timezone','America/New_York'));
 insert into public.audit_events(studio_id,actor_id,action,entity_type,entity_id,reason,correlation_id,source,after_state)
 values(student.studio_id,actor,'lesson.created','lesson',(result->'lesson'->>'id')::uuid,'Coach scheduled lesson',p_key,'coach_portal',result) returning id into audit_id;
 result:=result||jsonb_build_object('auditEventId',audit_id);
 insert into workspace_internal.operation_receipts(actor_id,key,studio_id,request,result) values(actor,p_key,student.studio_id,jsonb_build_object('command','lesson.create','payload',p_value),result);
 return result;
end $$;
revoke all on function public.command_create_lesson_once(jsonb,text) from public,anon;
grant execute on function public.command_create_lesson_once(jsonb,text) to authenticated;

create function public.command_apply_setup_record(p_student uuid,p_kind text,p_value jsonb,p_version integer,p_key text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=(select auth.uid()); student public.students; prior public.students; contact public.linked_contacts; source_contact public.linked_contacts;
 receipt workspace_internal.operation_receipts; request jsonb:=jsonb_build_object('student',p_student,'kind',p_kind,'value',p_value); result jsonb; updates integer:=0;
begin
 select * into student from public.students where id=p_student and deleted_at is null for update;
 if student.id is null or actor is null or not public.is_studio_coach(student.studio_id) then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 select * into receipt from workspace_internal.operation_receipts where actor_id=actor and key=p_key;
 if found then if receipt.request<>request then raise exception 'IDEMPOTENCY_CONFLICT'; end if; return receipt.result; end if;
 if student.version<>p_version then raise exception 'VERSION_CONFLICT'; end if;
 prior:=student;
 if p_kind='details' then
  if length(trim(coalesce(p_value->>'fullName',student.full_name)))<2 then raise exception 'VALIDATION_FAILED'; end if;
  if coalesce(p_value->>'email','')<>'' and p_value->>'email' !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then raise exception 'VALIDATION_FAILED: Check the email.'; end if;
  if student.portal_enabled and not student.is_minor and p_value->>'isMinor'='true' then raise exception 'REVIEW_REQUIRED: Disable access and review guardian consent before changing an active account to a minor.'; end if;
  update public.students set full_name=coalesce(nullif(trim(p_value->>'fullName'),''),full_name),focus_area=coalesce(p_value->>'focusArea',focus_area),
    goals=coalesce(p_value->>'goals',goals),email=case when p_value?'email' then nullif(lower(trim(p_value->>'email')),'') else email end,phone=case when p_value?'phone' then nullif(trim(p_value->>'phone'),'') else phone end,is_minor=coalesce((p_value->>'isMinor')::boolean,is_minor),version=version+1,updated_at=now()
   where id=p_student returning * into student;
  updates:=public.sync_future_contact_details(student.id,coalesce(prior.email,''),coalesce(student.email,''),prior.full_name,student.full_name,prior.phone,student.phone,'student');
  result:=jsonb_build_object('resource',to_jsonb(student));
 elsif p_kind='access' then
  if student.user_id is null or not exists(select 1 from public.portal_accounts where student_id=p_student and account_type='student') then raise exception 'REVIEW_REQUIRED: Create the student portal account through a reviewed invitation first.'; end if;
  if p_value->>'portalEnabled'='true' and student.is_minor and (p_value->>'consentConfirmed' is distinct from 'true' or nullif(student.guardian_email,'') is null) then raise exception 'VALIDATION_FAILED: Guardian consent is required.'; end if;
  update public.students set portal_enabled=coalesce((p_value->>'portalEnabled')::boolean,false),version=version+1,updated_at=now() where id=student.id returning * into student;
  result:=jsonb_build_object('resource',to_jsonb(student));
 elsif p_kind='contact' then
  if p_value->>'portalEnabled'='true' and student.is_minor and p_value->>'consentConfirmed' is distinct from 'true' then raise exception 'VALIDATION_FAILED: Guardian consent is required before granting access.'; end if;
  if nullif(p_value->>'sourceContactId','') is not null then
   select * into source_contact from public.linked_contacts where id=(p_value->>'sourceContactId')::uuid and studio_id=student.studio_id for share;
   if not found then raise exception 'FORBIDDEN' using errcode='42501'; end if;
   if source_contact.version is distinct from (p_value->>'sourceVersion')::integer or source_contact.email is distinct from p_value->>'email' or source_contact.full_name is distinct from p_value->>'fullName' then raise exception 'VERSION_CONFLICT: Contact changed after review.'; end if;
   p_value:=p_value||jsonb_build_object('fullName',source_contact.full_name,'email',source_contact.email);
  end if;
  if length(trim(coalesce(p_value->>'fullName','')))<2 or coalesce(p_value->>'email','') !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then raise exception 'VALIDATION_FAILED: Add contact name and email.'; end if;
  select * into contact from public.linked_contacts where student_id=p_student and lower(email)=lower(trim(p_value->>'email')) for update;
  if contact.id is not null then
   -- Reusing existing information does not overwrite permissions or responsibility choices.
   result:=jsonb_build_object('resource',to_jsonb(contact),'alreadyExists',true);
  else
   if p_value->>'relationshipType' not in ('guardian','support_person','other') then raise exception 'VALIDATION_FAILED'; end if;
   if exists(select 1 from public.linked_contacts where student_id=p_student and ((is_primary_payer and p_value->>'isPrimaryPayer'='true') or (is_primary_scheduling_contact and p_value->>'isPrimarySchedulingContact'='true'))) then raise exception 'REVIEW_REQUIRED: A primary responsibility already exists.'; end if;
   insert into public.linked_contacts(studio_id,student_id,user_id,full_name,email,relationship_type,relationship_label,is_primary_payer,is_primary_scheduling_contact,receives_financial_escalations,can_view_work,can_view_schedule,can_manage_lessons,can_manage_profile,can_view_finance,can_receive_notifications,portal_enabled)
   values(student.studio_id,student.id,source_contact.user_id,trim(p_value->>'fullName'),lower(trim(p_value->>'email')),p_value->>'relationshipType',coalesce(p_value->>'relationshipLabel',''),
    coalesce((p_value->>'isPrimaryPayer')::boolean,false),coalesce((p_value->>'isPrimarySchedulingContact')::boolean,false),false,
    coalesce((p_value->>'canViewWork')::boolean,false),coalesce((p_value->>'canViewSchedule')::boolean,false),coalesce((p_value->>'canManageLessons')::boolean,false),coalesce((p_value->>'canManageProfile')::boolean,false),coalesce((p_value->>'canViewFinance')::boolean,false),coalesce((p_value->>'canReceiveNotifications')::boolean,false),coalesce((p_value->>'portalEnabled')::boolean,false)) returning * into contact;
   if contact.relationship_type='guardian' and nullif(student.guardian_email,'') is null then update public.students set guardian_name=contact.full_name,guardian_email=contact.email,version=version+1,updated_at=now() where id=student.id; end if;
   result:=jsonb_build_object('resource',to_jsonb(contact));
  end if;
 else raise exception 'VALIDATION_FAILED'; end if;
 insert into public.audit_events(studio_id,actor_id,action,entity_type,entity_id,reason,correlation_id,source,after_state)
 values(student.studio_id,actor,'student.setup_'||p_kind,case when p_kind='contact' then 'linked_contact' else 'student' end,case when p_kind='contact' then contact.id else student.id end,'Reviewed student setup',p_key,'coach_portal',result);
 select * into student from public.students where id=p_student;
 result:=result||jsonb_build_object('queuedCalendarUpdates',updates,'studentVersion',student.version);
 insert into workspace_internal.operation_receipts(actor_id,key,studio_id,request,result) values(actor,p_key,student.studio_id,request,result);
 return result;
end $$;
revoke all on function public.command_apply_setup_record(uuid,text,jsonb,integer,text) from public,anon;
grant execute on function public.command_apply_setup_record(uuid,text,jsonb,integer,text) to authenticated;

create function public.manage_student_setup(p_actor uuid,p_student uuid,p_command text,p_value jsonb,p_version integer,p_key text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare student public.students; setup workspace_internal.student_setups; action jsonb; entry jsonb; recovered jsonb; expected_student integer; review_id text; action_id text:=p_value->>'actionId';
begin
 select * into student from public.students where id=p_student and deleted_at is null for update;
 if student.id is null or not exists(select 1 from public.memberships where studio_id=student.studio_id and user_id=p_actor and role='coach') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 select * into setup from workspace_internal.student_setups where student_id=p_student for update;
 if p_command='read' then return coalesce(to_jsonb(setup),jsonb_build_object('version',0,'draft','{}'::jsonb,'results','{}'::jsonb)); end if;
 if p_command='save' then
  if coalesce(setup.version,0)<>p_version then raise exception 'VERSION_CONFLICT'; end if;
  if length(p_value::text)>100000 or jsonb_typeof(p_value->'actions') is distinct from 'array' or jsonb_array_length(p_value->'actions')>20 then raise exception 'VALIDATION_FAILED'; end if;
  if exists(select 1 from jsonb_each(coalesce(setup.results,'{}')) r where r.value->>'status'='running') then raise exception 'REVIEW_REQUIRED: Resolve the pending action before changing the draft.'; end if;
  if (select count(*) from jsonb_array_elements(p_value->'actions'))<>(select count(distinct a->>'id') from jsonb_array_elements(p_value->'actions')a) then raise exception 'VALIDATION_FAILED: Duplicate action.'; end if;
  for action in select value from jsonb_array_elements(p_value->'actions') loop
   if action->>'kind' not in ('details','contact','lesson','package','access','invitation') or (action->>'id')::uuid is null then raise exception 'VALIDATION_FAILED: Unsupported setup action.'; end if;
   if coalesce(setup.results->(action->>'id')->>'status','')='succeeded' and not (setup.draft->'actions' @> jsonb_build_array(action)) then raise exception 'REVIEW_REQUIRED: Completed actions cannot be edited.'; end if;
  end loop;
  insert into workspace_internal.student_setups(student_id,studio_id,actor_id,draft) values(p_student,student.studio_id,p_actor,p_value)
  on conflict(student_id) do update set draft=excluded.draft,review=null,version=student_setups.version+1,updated_at=now() returning * into setup;
 elsif p_command='review' then
  if setup.version is null or setup.version<>p_version then raise exception 'VERSION_CONFLICT'; end if;
  update workspace_internal.student_setups set review=jsonb_build_object('id',gen_random_uuid(),'actorId',p_actor,'studentVersion',student.version,'expiresAt',now()+interval '30 minutes','actions',coalesce(p_value->'actions',setup.draft->'actions')),updated_at=now() where student_id=p_student returning * into setup;
 elsif p_command='claim' then
  if setup.review->>'actorId' is distinct from p_actor::text or setup.review->>'id' is distinct from p_value->>'reviewId' or (setup.review->>'expiresAt')::timestamptz<=now() then raise exception 'REVIEW_EXPIRED'; end if;
  select a into action from jsonb_array_elements(setup.review->'actions')a where a->>'id'=action_id;
  if action is null then raise exception 'FORBIDDEN' using errcode='42501'; end if;
  entry:=setup.results->action_id;
  if entry->>'status'='succeeded' then return jsonb_build_object('completed',true,'entry',entry); end if;
  if entry->>'status' in ('running','failed') then
   select r.result into recovered from workspace_internal.operation_receipts r where r.actor_id=p_actor and r.key=entry->>'key' and r.studio_id=student.studio_id and
    ((r.request->>'student'=p_student::text and r.request->>'kind'=action->>'kind' and r.request->'value'=action->'payload') or (action->>'kind'='lesson' and r.request->>'command'='lesson.create' and r.request->'payload'=(action->'payload'||jsonb_build_object('studentId',p_student))));
   if recovered is null and action->>'kind'='package' then select r.response into recovered from credit_internal.credit_command_receipts r where r.key='coach-package:'||(entry->>'key') and r.actor_id=p_actor and r.student_id=p_student and r.request#>>'{package,definitionId}'=action#>>'{payload,definitionId}'; end if;
   if recovered is not null then
    update workspace_internal.student_setups set results=jsonb_set(results,array[action_id],jsonb_build_object('status','succeeded','key',entry->>'key','result',recovered,'message','Recovered the committed action receipt; no operation was repeated.')),review=null,updated_at=now() where student_id=p_student returning * into setup;
    return jsonb_build_object('completed',true,'entry',setup.results->action_id,'reviewRequired',true);
   end if;
  end if;
  if entry->>'status' in ('running','needs_review') and action->>'kind'='invitation' then raise exception 'REVIEW_REQUIRED: The previous action has an unknown outcome. Inspect the existing account before retrying.'; end if;
  if student.version<>(setup.review->>'studentVersion')::integer then raise exception 'VERSION_CONFLICT: Student changed after review.'; end if;
  update workspace_internal.student_setups set results=jsonb_set(results,array[action_id],jsonb_build_object('status','running','key',coalesce(entry->>'key',p_key),'studentVersion',student.version,'startedAt',now())) where student_id=p_student returning * into setup;
  return jsonb_build_object('action',action,'key',setup.results->action_id->>'key','studentVersion',student.version);
 elsif p_command='finish' then
  if setup.review->>'id' is distinct from p_value->>'reviewId' or setup.results->action_id->>'key' is distinct from p_key then raise exception 'FORBIDDEN' using errcode='42501'; end if;
  select a into action from jsonb_array_elements(setup.review->'actions')a where a->>'id'=action_id;
  expected_student:=coalesce((p_value#>>'{result,studentVersion}')::integer,case when action->>'kind' in ('details','contact','access','invitation') then (p_value#>>'{result,resource,version}')::integer end,(setup.results->action_id->>'studentVersion')::integer);
  update workspace_internal.student_setups set results=jsonb_set(results,array[action_id],jsonb_build_object('status',case when coalesce((p_value->>'ok')::boolean,false) then 'succeeded' when p_value->>'uncertain'='true' then 'needs_review' else 'failed' end,'result',p_value->'result','message',p_value->>'message','key',p_key,'finishedAt',now())),review=case when student.version=expected_student then jsonb_set(review,'{studentVersion}',to_jsonb(student.version)) else null end,updated_at=now() where student_id=p_student returning * into setup;
 else raise exception 'VALIDATION_FAILED'; end if;
 return to_jsonb(setup);
end $$;
revoke all on function public.manage_student_setup(uuid,uuid,text,jsonb,integer,text) from public,anon,authenticated;
grant execute on function public.manage_student_setup(uuid,uuid,text,jsonb,integer,text) to service_role;

create function public.student_setup_context(p_student uuid,p_search text default '') returns jsonb
language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('contacts',(select coalesce(jsonb_agg(to_jsonb(c)),'[]') from(select id,student_id,full_name,email,relationship_type,portal_enabled,version from public.linked_contacts where studio_id=s.studio_id and (student_id=s.id or (length(trim(p_search))>=2 and (full_name ilike '%'||left(p_search,120)||'%' or email ilike '%'||left(p_search,120)||'%'))) order by (student_id=s.id) desc,full_name,id limit 25)c),
 'lessons',(select coalesce(jsonb_agg(to_jsonb(l)),'[]') from(select id,topic,starts_at,status from public.lessons where student_id=s.id and status='scheduled' and starts_at>=now() order by starts_at,id limit 10)l),
 'packages',(select coalesce(jsonb_agg(to_jsonb(p)),'[]') from(select id,name,expires_at from public.packages where student_id=s.id order by created_at desc,id limit 10)p),
 'definitions',(select coalesce(jsonb_agg(to_jsonb(d)),'[]') from(select id,name,price_minor,currency,session_count from public.package_definitions where studio_id=s.studio_id and active order by name,id limit 100)d),
 'hasStudentAccount',exists(select 1 from public.portal_accounts where student_id=s.id and account_type='student'))
 from public.students s where s.id=p_student and public.is_studio_coach(s.studio_id) and s.deleted_at is null;
$$;
revoke all on function public.student_setup_context(uuid,text) from public,anon;
grant execute on function public.student_setup_context(uuid,text) to authenticated;

create function public.read_studio_operation(p_command text,p_value jsonb,p_key text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare receipt workspace_internal.operation_receipts;
begin
 if (select auth.uid()) is null then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 select * into receipt from workspace_internal.operation_receipts where actor_id=(select auth.uid()) and key=p_key;
 if not found then return null; end if;
 if not public.is_studio_coach(receipt.studio_id) then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if receipt.request<>jsonb_build_object('command',p_command,'payload',p_value) then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
 return receipt.result;
end $$;
revoke all on function public.read_studio_operation(text,jsonb,text) from public,anon;
grant execute on function public.read_studio_operation(text,jsonb,text) to authenticated;
