create or replace function public.command_complete_lesson(
  lesson_id uuid, expected_version integer, reason text, idempotency_key text, correlation_id text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare target public.lessons; audit_id uuid; response jsonb;
begin
  if exists(select 1 from public.idempotency_keys where key=idempotency_key) then return (select response from public.idempotency_keys where key=idempotency_key); end if;
  select * into target from public.lessons where id=lesson_id for update;
  if target.id is null then raise exception 'LESSON_NOT_FOUND'; end if;
  if not public.is_studio_coach(target.studio_id) then raise exception 'FORBIDDEN'; end if;
  if target.version<>expected_version then raise exception 'VERSION_CONFLICT:%',target.version; end if;
  if target.status<>'scheduled' then raise exception 'INVALID_TRANSITION:%',target.status; end if;
  update public.lessons set status='completed',version=version+1,updated_at=now() where id=lesson_id returning * into target;
  if target.package_id is not null and not exists(select 1 from public.package_credit_entries where idempotency_key=idempotency_key||':credit') then
    insert into public.package_credit_entries(package_id,lesson_id,kind,quantity,reason,idempotency_key,created_by) values(target.package_id,target.id,'consumption',-1,reason,idempotency_key||':credit',(select auth.uid()));
  end if;
  insert into public.recommendations(studio_id,student_id,entity_type,entity_id,reason_code,title,explanation,evidence,urgency,due_at,suggested_action,requires_confirmation,dedupe_key)
  values(target.studio_id,target.student_id,'lesson',target.id,'lesson_note_missing','Write lesson note','The lesson is complete and no follow-up note exists.',jsonb_build_array('Lesson completed','No note created'),4,now()+interval '48 hours','open_note_editor',false,'lesson_note_missing:'||target.id)
  on conflict(dedupe_key) do update set status='open',updated_at=now();
  insert into public.calendar_projections(lesson_id,projected_version,status) values(target.id,0,'queued') on conflict(lesson_id) do update set status='queued';
  insert into public.audit_events(studio_id,actor_id,action,entity_type,entity_id,reason,correlation_id,source,before_state,after_state)
  values(target.studio_id,(select auth.uid()),'lesson.completed','lesson',target.id,reason,correlation_id,'coach_portal',jsonb_build_object('status','scheduled','version',expected_version),to_jsonb(target)) returning id into audit_id;
  response=jsonb_build_object('resource',to_jsonb(target),'auditEventId',audit_id,'queuedSideEffects',jsonb_build_array('calendar_projection'),'recommendations',jsonb_build_array('lesson_note_missing'));
  insert into public.idempotency_keys(key,actor_id,command,request_hash,response) values(idempotency_key,(select auth.uid()),'complete_lesson',encode(digest(idempotency_key||lesson_id::text,'sha256'),'hex'),response);
  return response;
end $$;

create or replace function public.command_approve_outbox(message_id uuid, expected_version integer, reason text, idempotency_key text, correlation_id text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare target public.outbox_messages; audit_id uuid; response jsonb;
begin
  if exists(select 1 from public.idempotency_keys where key=idempotency_key) then return (select response from public.idempotency_keys where key=idempotency_key); end if;
  select * into target from public.outbox_messages where id=message_id for update;
  if target.id is null then raise exception 'MESSAGE_NOT_FOUND'; end if;
  if not public.is_studio_coach(target.studio_id) then raise exception 'FORBIDDEN'; end if;
  if target.version<>expected_version then raise exception 'VERSION_CONFLICT:%',target.version; end if;
  if target.status<>'draft' then raise exception 'INVALID_TRANSITION:%',target.status; end if;
  update public.outbox_messages set status='queued',next_attempt_at=now(),version=version+1,updated_at=now() where id=message_id returning * into target;
  insert into public.audit_events(studio_id,actor_id,action,entity_type,entity_id,reason,correlation_id,source,before_state,after_state)
  values(target.studio_id,(select auth.uid()),'outbox.approved','outbox_message',target.id,reason,correlation_id,'coach_portal',jsonb_build_object('status','draft','version',expected_version),to_jsonb(target)) returning id into audit_id;
  response=jsonb_build_object('resource',to_jsonb(target),'auditEventId',audit_id,'queuedSideEffects',jsonb_build_array('message_delivery'),'recommendations','[]'::jsonb);
  insert into public.idempotency_keys(key,actor_id,command,request_hash,response) values(idempotency_key,(select auth.uid()),'approve_outbox',encode(digest(idempotency_key||message_id::text,'sha256'),'hex'),response);
  return response;
end $$;

create or replace function public.package_credit_balance(target_package uuid) returns integer language sql stable set search_path='' as $$ select coalesce(sum(quantity),0)::integer from public.package_credit_entries where package_id=target_package $$;
create or replace function public.student_payment_balance(target_student uuid) returns bigint language sql stable set search_path='' as $$ select coalesce(sum(case when kind='refund' then amount_minor else -amount_minor end),0)::bigint from public.payment_entries where student_id=target_student $$;

create or replace function public.command_transition(
  entity_type text, entity_id uuid, expected_version integer, next_status text, reason text, idempotency_key text, correlation_id text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare current_row jsonb; updated_row jsonb; studio uuid; audit_id uuid; response jsonb;
begin
  if exists(select 1 from public.idempotency_keys where key=idempotency_key) then return (select response from public.idempotency_keys where key=idempotency_key); end if;
  case entity_type
    when 'student' then
      select to_jsonb(s),s.studio_id into current_row,studio from public.students s where s.id=entity_id for update;
      if current_row is null or not public.is_studio_coach(studio) then raise exception 'FORBIDDEN_OR_NOT_FOUND'; end if;
      if (current_row->>'version')::int<>expected_version then raise exception 'VERSION_CONFLICT:%',current_row->>'version'; end if;
      if not ((current_row->>'status',next_status) in (('lead','active'),('lead','inactive'),('active','paused'),('active','alumni'),('active','inactive'),('paused','active'),('paused','alumni'),('paused','inactive'),('alumni','active'),('inactive','lead'),('inactive','active'))) then raise exception 'INVALID_TRANSITION'; end if;
      update public.students set status=next_status::public.student_status,version=version+1,updated_at=now() where id=entity_id returning to_jsonb(students.*) into updated_row;
    when 'lesson' then
      select to_jsonb(l),l.studio_id into current_row,studio from public.lessons l where l.id=entity_id for update;
      if current_row is null or not public.is_studio_coach(studio) then raise exception 'FORBIDDEN_OR_NOT_FOUND'; end if;
      if (current_row->>'version')::int<>expected_version then raise exception 'VERSION_CONFLICT:%',current_row->>'version'; end if;
      if next_status='completed' then raise exception 'USE_COMPLETE_LESSON_COMMAND'; end if;
      if not ((current_row->>'status',next_status) in (('draft','scheduled'),('draft','cancelled'),('scheduled','cancelled'),('scheduled','late_cancelled'),('scheduled','no_show'),('cancelled','scheduled'),('late_cancelled','scheduled'),('no_show','scheduled'))) then raise exception 'INVALID_TRANSITION'; end if;
      update public.lessons set status=next_status::public.lesson_status,version=version+1,updated_at=now() where id=entity_id returning to_jsonb(lessons.*) into updated_row;
      insert into public.calendar_projections(lesson_id,status) values(entity_id,'queued') on conflict(lesson_id) do update set status='queued';
    when 'note' then
      select to_jsonb(n),s.studio_id into current_row,studio from public.notes n join public.students s on s.id=n.student_id where n.id=entity_id for update of n;
      if current_row is null or not public.is_studio_coach(studio) then raise exception 'FORBIDDEN_OR_NOT_FOUND'; end if;
      if (current_row->>'version')::int<>expected_version then raise exception 'VERSION_CONFLICT:%',current_row->>'version'; end if;
      if not ((current_row->>'status',next_status) in (('draft','published'),('draft','archived'),('published','draft'),('published','archived'),('archived','draft'))) then raise exception 'INVALID_TRANSITION'; end if;
      update public.notes set status=next_status::public.content_status,published_at=case when next_status='published' then now() else published_at end,version=version+1,updated_at=now() where id=entity_id returning to_jsonb(notes.*) into updated_row;
    when 'assignment' then
      select to_jsonb(a),s.studio_id into current_row,studio from public.assignments a join public.students s on s.id=a.student_id where a.id=entity_id for update of a;
      if current_row is null or not public.can_access_student((current_row->>'student_id')::uuid) then raise exception 'FORBIDDEN_OR_NOT_FOUND'; end if;
      if (current_row->>'version')::int<>expected_version then raise exception 'VERSION_CONFLICT:%',current_row->>'version'; end if;
      if not ((current_row->>'status',next_status) in (('assigned','in_progress'),('assigned','completed'),('in_progress','completed'),('in_progress','reopened'),('completed','reopened'),('reopened','in_progress'),('reopened','completed'))) then raise exception 'INVALID_TRANSITION'; end if;
      update public.assignments set status=next_status::public.assignment_status,version=version+1,updated_at=now() where id=entity_id returning to_jsonb(assignments.*) into updated_row;
    when 'material' then
      select to_jsonb(m),m.studio_id into current_row,studio from public.materials m where m.id=entity_id for update;
      if current_row is null or not public.is_studio_coach(studio) then raise exception 'FORBIDDEN_OR_NOT_FOUND'; end if;
      if (current_row->>'version')::int<>expected_version then raise exception 'VERSION_CONFLICT:%',current_row->>'version'; end if;
      if not ((current_row->>'status',next_status) in (('active','vaulted'),('active','archived'),('vaulted','active'),('vaulted','archived'))) then raise exception 'INVALID_TRANSITION'; end if;
      update public.materials set status=next_status::public.material_status,version=version+1,updated_at=now() where id=entity_id returning to_jsonb(materials.*) into updated_row;
    when 'reader_request' then
      select to_jsonb(r),s.studio_id into current_row,studio from public.reader_requests r join public.students s on s.id=r.student_id where r.id=entity_id for update of r;
      if current_row is null or not public.can_access_student((current_row->>'student_id')::uuid) then raise exception 'FORBIDDEN_OR_NOT_FOUND'; end if;
      if (current_row->>'version')::int<>expected_version then raise exception 'VERSION_CONFLICT:%',current_row->>'version'; end if;
      update public.reader_requests set status=next_status::public.reader_request_status,version=version+1,updated_at=now() where id=entity_id returning to_jsonb(reader_requests.*) into updated_row;
    else raise exception 'UNSUPPORTED_ENTITY';
  end case;
  insert into public.audit_events(studio_id,actor_id,action,entity_type,entity_id,reason,correlation_id,source,before_state,after_state)
  values(studio,(select auth.uid()),entity_type||'.transitioned',entity_type,entity_id,reason,correlation_id,'v2_api',current_row,updated_row) returning id into audit_id;
  response=jsonb_build_object('resource',updated_row,'auditEventId',audit_id,'queuedSideEffects',case when entity_type='lesson' then jsonb_build_array('calendar_projection') else '[]'::jsonb end,'recommendations','[]'::jsonb);
  insert into public.idempotency_keys(key,actor_id,command,request_hash,response) values(idempotency_key,(select auth.uid()),entity_type||'.transition',encode(digest(idempotency_key||entity_id::text||next_status,'sha256'),'hex'),response);
  return response;
end $$;

create or replace function public.process_stripe_checkout(event_id text,event_type text,event_payload jsonb,session_id text,student_id uuid,package_id uuid,amount_minor bigint,currency text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare pkg public.packages; payment_id uuid; duplicate boolean:=false;
begin
  insert into public.webhook_events(id,provider,event_type,payload,status) values(event_id,'stripe',event_type,event_payload,'processing')
  on conflict(id) do nothing;
  if not found then return jsonb_build_object('duplicate',true,'eventId',event_id); end if;
  select * into pkg from public.packages where id=package_id and packages.student_id=process_stripe_checkout.student_id for update;
  if pkg.id is null then update public.webhook_events set status='failed',error='Package not found',processed_at=now() where id=event_id; raise exception 'PACKAGE_NOT_FOUND'; end if;
  insert into public.payment_entries(student_id,package_id,kind,amount_minor,currency,external_reference,reason)
  values(student_id,package_id,'payment',amount_minor,upper(currency),session_id,'Stripe Checkout payment')
  on conflict(external_reference) do nothing returning id into payment_id;
  if payment_id is not null then
    insert into public.package_credit_entries(package_id,kind,quantity,reason,idempotency_key)
    values(package_id,'purchase',pkg.credit_quantity,'Stripe Checkout purchase','stripe-credit:'||session_id) on conflict(idempotency_key) do nothing;
  else duplicate:=true; end if;
  update public.webhook_events set status='processed',processed_at=now() where id=event_id;
  return jsonb_build_object('duplicate',duplicate,'eventId',event_id,'paymentId',payment_id);
exception when others then
  update public.webhook_events set status='failed',error=sqlerrm,processed_at=now() where id=event_id;
  raise;
end $$;
revoke all on function public.process_stripe_checkout(text,text,jsonb,text,uuid,uuid,bigint,text) from public,anon,authenticated;
grant execute on function public.process_stripe_checkout(text,text,jsonb,text,uuid,uuid,bigint,text) to service_role;

create or replace function public.claim_outbox_messages(batch_size integer default 10) returns setof public.outbox_messages language plpgsql security definer set search_path='' as $$
begin
  return query with claimed as (
    select id from public.outbox_messages where status in ('queued','failed') and coalesce(next_attempt_at,now())<=now() order by created_at for update skip locked limit batch_size
  ) update public.outbox_messages o set status='sending',attempts=attempts+1,updated_at=now() from claimed where o.id=claimed.id returning o.*;
end $$;
revoke all on function public.claim_outbox_messages(integer) from public,anon,authenticated;
grant execute on function public.claim_outbox_messages(integer) to service_role;

create or replace function public.claim_calendar_projections(batch_size integer default 10) returns table(projection jsonb,lesson jsonb) language plpgsql security definer set search_path='' as $$
begin
  return query with claimed as (
    select p.id from public.calendar_projections p where p.status in ('queued','failed') order by p.id for update skip locked limit batch_size
  ), updated as (
    update public.calendar_projections p set status='projecting' from claimed where p.id=claimed.id returning p.*
  ) select to_jsonb(u),to_jsonb(l) from updated u join public.lessons l on l.id=u.lesson_id;
end $$;
revoke all on function public.claim_calendar_projections(integer) from public,anon,authenticated;
grant execute on function public.claim_calendar_projections(integer) to service_role;
