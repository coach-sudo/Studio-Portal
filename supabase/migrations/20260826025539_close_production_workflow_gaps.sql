-- Close production workflow gaps found during the end-to-end audit.
-- All authoritative multi-table mutations are transaction-bound in Postgres.

create or replace function public.command_complete_lesson(
  lesson_id uuid, expected_version integer, reason text, idempotency_key text, correlation_id text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare target public.lessons; audit_id uuid; response jsonb;
begin
  if exists(select 1 from public.idempotency_keys k where k.key=command_complete_lesson.idempotency_key) then
    return (select k.response from public.idempotency_keys k where k.key=command_complete_lesson.idempotency_key);
  end if;
  select * into target from public.lessons where id=lesson_id for update;
  if target.id is null then raise exception 'LESSON_NOT_FOUND'; end if;
  if not public.is_studio_coach(target.studio_id) then raise exception 'FORBIDDEN'; end if;
  if target.version<>expected_version then raise exception 'VERSION_CONFLICT:%',target.version; end if;
  if target.status<>'scheduled' then raise exception 'INVALID_TRANSITION:%',target.status; end if;
  update public.lessons set status='completed',version=version+1,updated_at=now() where id=lesson_id returning * into target;
  -- A booking reservation or an explicit "use credit" action is already a debit.
  -- Only consume here when no negative ledger entry exists for this lesson.
  if target.package_id is not null and not exists(
    select 1 from public.package_credit_entries e
    where e.lesson_id=target.id and e.quantity < 0
  ) then
    insert into public.package_credit_entries(package_id,lesson_id,kind,quantity,reason,idempotency_key,created_by)
    values(target.package_id,target.id,'consumption',-1,reason,command_complete_lesson.idempotency_key||':credit',(select auth.uid()));
  end if;
  insert into public.recommendations(studio_id,student_id,entity_type,entity_id,reason_code,title,explanation,evidence,urgency,due_at,suggested_action,requires_confirmation,dedupe_key)
  values(target.studio_id,target.student_id,'lesson',target.id,'lesson_note_missing','Write lesson note','The lesson is complete and no follow-up note exists.',jsonb_build_array('Lesson completed','No note created'),4,now()+interval '48 hours','open_note_editor',false,'lesson_note_missing:'||target.id)
  on conflict(dedupe_key) do update set status='open',updated_at=now();
  insert into public.calendar_projections(lesson_id,projected_version,status)
  values(target.id,0,'queued') on conflict(lesson_id) do update set status='queued',last_error=null;
  insert into public.audit_events(studio_id,actor_id,action,entity_type,entity_id,reason,correlation_id,source,before_state,after_state)
  values(target.studio_id,(select auth.uid()),'lesson.completed','lesson',target.id,reason,correlation_id,'coach_portal',jsonb_build_object('status','scheduled','version',expected_version),to_jsonb(target)) returning id into audit_id;
  response=jsonb_build_object('resource',to_jsonb(target),'auditEventId',audit_id,'queuedSideEffects',jsonb_build_array('calendar_projection'),'recommendations',jsonb_build_array('lesson_note_missing'));
  insert into public.idempotency_keys(key,actor_id,command,request_hash,response)
  values(command_complete_lesson.idempotency_key,(select auth.uid()),'complete_lesson',encode(digest(command_complete_lesson.idempotency_key||lesson_id::text,'sha256'),'hex'),response);
  return response;
end $$;
revoke all on function public.command_complete_lesson(uuid,integer,text,text,text) from public,anon;
grant execute on function public.command_complete_lesson(uuid,integer,text,text,text) to authenticated;

create or replace function public.finalize_booking_cancellation(
  target_booking uuid,
  expected_version integer,
  target_status text,
  refund_reference text,
  refund_amount bigint,
  correlation_id text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  b public.bookings;
  updated_booking public.bookings;
  lesson_ids uuid[] := '{}';
  settlement text;
  next_payment_status text;
begin
  if target_status not in ('cancelled','late_cancelled') then raise exception 'VALIDATION_FAILED'; end if;
  select * into b from public.bookings where id=target_booking for update;
  if b.id is null then raise exception 'BOOKING_NOT_FOUND'; end if;
  if b.status in ('cancelled','late_cancelled') then
    return jsonb_build_object('booking',to_jsonb(b),'lessonIds','[]'::jsonb,'duplicate',true);
  end if;
  if b.status<>'confirmed' then raise exception 'INVALID_TRANSITION:%',b.status; end if;
  if b.version<>expected_version then raise exception 'VERSION_CONFLICT:%',b.version; end if;

  select coalesce(array_agg(distinct p.lesson_id),'{}'::uuid[]) into lesson_ids
  from public.lesson_participants p where p.booking_id=b.id;

  update public.lessons set status=target_status::public.lesson_status,version=version+1,updated_at=now()
  where id=any(lesson_ids) and status not in ('cancelled','late_cancelled');
  update public.lesson_participants set status='cancelled'
  where booking_id=b.id and status<>'cancelled';
  insert into public.calendar_projections(lesson_id,status,last_error)
  select unnest(lesson_ids),'queued',null
  on conflict(lesson_id) do update set status='queued',last_error=null;

  if b.offering_id is not null then
    update public.service_offerings
    set enrolled=greatest(0,enrolled-1),version=version+1,updated_at=now()
    where id=b.offering_id;
  end if;

  settlement:=coalesce(b.policy_snapshot->>'settlement','original_payment');
  next_payment_status:=b.payment_status;
  if target_status='cancelled' and b.payment_policy='credits' then
    insert into public.package_credit_entries(package_id,lesson_id,kind,quantity,reason,idempotency_key)
    select e.package_id,e.lesson_id,'release',abs(e.quantity),'Booking cancellation '||b.reference,
           'booking-credit-release:'||b.id::text||':'||e.id::text
    from public.package_credit_entries e
    where e.idempotency_key='booking-credit:'||b.id::text and e.quantity<0
    on conflict(idempotency_key) do nothing;
    next_payment_status:='refunded';
  elsif target_status='cancelled' and settlement='studio_credit' and b.paid_minor>0 and b.student_id is not null then
    insert into public.payment_entries(student_id,kind,amount_minor,currency,external_reference,reason)
    values(b.student_id,'refund',b.paid_minor,b.currency,'studio-credit:'||b.id::text,'Studio account credit for '||b.reference)
    on conflict(external_reference) do nothing;
    next_payment_status:='refunded';
  elsif target_status='cancelled' and settlement='original_payment' and refund_reference is not null and coalesce(refund_amount,0)>0 and b.student_id is not null then
    insert into public.payment_entries(student_id,kind,amount_minor,currency,external_reference,reason)
    values(b.student_id,'refund',refund_amount,b.currency,refund_reference,'Booking cancellation '||b.reference)
    on conflict(external_reference) do nothing;
    next_payment_status:='refunded';
  end if;

  update public.bookings
  set status=target_status,payment_status=next_payment_status,version=version+1,updated_at=now()
  where id=b.id and version=expected_version returning * into updated_booking;
  if updated_booking.id is null then raise exception 'VERSION_CONFLICT'; end if;

  insert into public.audit_events(studio_id,action,entity_type,entity_id,reason,correlation_id,source,before_state,after_state)
  values(b.studio_id,'booking.cancelled','booking',b.id,
    case when target_status='late_cancelled' then 'Late cancellation' else 'Permitted cancellation' end,
    correlation_id,'booking_platform',to_jsonb(b),to_jsonb(updated_booking));
  return jsonb_build_object('booking',to_jsonb(updated_booking),'lessonIds',to_jsonb(lesson_ids),'duplicate',false);
end $$;
revoke all on function public.finalize_booking_cancellation(uuid,integer,text,text,bigint,text) from public,anon,authenticated;
grant execute on function public.finalize_booking_cancellation(uuid,integer,text,text,bigint,text) to service_role;

create or replace function public.finalize_subscription_termination(
  subscription_id text,cutoff timestamptz,installments_complete boolean
) returns jsonb language plpgsql security definer set search_path='' as $$
declare series_record public.recurring_series; booking_record public.bookings; lesson_ids uuid[]:='{}';
begin
  select * into series_record from public.recurring_series where stripe_subscription_id=subscription_id for update;
  if series_record.id is null then
    select * into booking_record from public.bookings where stripe_subscription_id=subscription_id for update;
    if booking_record.series_id is not null then select * into series_record from public.recurring_series where id=booking_record.series_id for update; end if;
  else
    select * into booking_record from public.bookings where series_id=series_record.id order by created_at limit 1 for update;
  end if;
  if series_record.id is null and booking_record.id is null then return jsonb_build_object('ignored',true,'lessonIds','[]'::jsonb); end if;
  if installments_complete then
    if series_record.id is not null then update public.recurring_series set status='completed',version=version+1,updated_at=now() where id=series_record.id; end if;
    if booking_record.id is not null then update public.bookings set payment_status='paid',status='confirmed',updated_at=now() where id=booking_record.id; end if;
    return jsonb_build_object('completed',true,'lessonIds','[]'::jsonb);
  end if;
  if series_record.id is not null then
    update public.recurring_series set status='cancelled',version=version+1,updated_at=now() where id=series_record.id;
    select coalesce(array_agg(id),'{}'::uuid[]) into lesson_ids from public.lessons
    where series_id=series_record.id and status='scheduled' and starts_at>=coalesce(cutoff,now());
  end if;
  update public.lessons set status='cancelled',version=version+1,updated_at=now() where id=any(lesson_ids);
  update public.lesson_participants set status='cancelled' where lesson_id=any(lesson_ids);
  insert into public.calendar_projections(lesson_id,status,last_error)
  select unnest(lesson_ids),'queued',null on conflict(lesson_id) do update set status='queued',last_error=null;
  if booking_record.id is not null then update public.bookings set status='cancelled',updated_at=now() where id=booking_record.id; end if;
  return jsonb_build_object('completed',false,'lessonIds',to_jsonb(lesson_ids));
end $$;
revoke all on function public.finalize_subscription_termination(text,timestamptz,boolean) from public,anon,authenticated;
grant execute on function public.finalize_subscription_termination(text,timestamptz,boolean) to service_role;

create or replace function public.expire_delinquent_booking(target_booking uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare b public.bookings; lesson_ids uuid[]:='{}';
begin
  select * into b from public.bookings where id=target_booking for update;
  if b.id is null then raise exception 'BOOKING_NOT_FOUND'; end if;
  if b.payment_status<>'past_due' or b.updated_at>now()-interval '7 days' then return jsonb_build_object('ignored',true,'lessonIds','[]'::jsonb); end if;
  select coalesce(array_agg(distinct l.id),'{}'::uuid[]) into lesson_ids
  from public.lessons l left join public.lesson_participants p on p.lesson_id=l.id
  where l.status='scheduled' and l.starts_at>=now() and (l.series_id=b.series_id or p.booking_id=b.id);
  update public.lessons set status='cancelled',version=version+1,updated_at=now() where id=any(lesson_ids);
  update public.lesson_participants set status='cancelled' where booking_id=b.id or lesson_id=any(lesson_ids);
  insert into public.calendar_projections(lesson_id,status,last_error)
  select unnest(lesson_ids),'queued',null on conflict(lesson_id) do update set status='queued',last_error=null;
  if b.series_id is not null then update public.recurring_series set status='cancelled',version=version+1,updated_at=now() where id=b.series_id; end if;
  if b.offering_id is not null then update public.service_offerings set enrolled=greatest(0,enrolled-1),version=version+1,updated_at=now() where id=b.offering_id; end if;
  update public.bookings set status='cancelled',version=version+1,updated_at=now() where id=b.id;
  return jsonb_build_object('ignored',false,'lessonIds',to_jsonb(lesson_ids));
end $$;
revoke all on function public.expire_delinquent_booking(uuid) from public,anon,authenticated;
grant execute on function public.expire_delinquent_booking(uuid) to service_role;

create or replace function public.command_create_lesson(
  target_studio uuid,target_student uuid,topic text,starts_at timestamptz,ends_at timestamptz,
  location_type text,location_label text,student_name text,student_email text,
  recurrence text,occurrence_count integer,timezone text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare created public.lessons; recurring_result jsonb;
begin
  if ends_at<=starts_at or location_type not in ('virtual','in_person') then raise exception 'VALIDATION_FAILED'; end if;
  if not exists(select 1 from public.students s where s.id=target_student and s.studio_id=target_studio and s.deleted_at is null) then raise exception 'STUDENT_NOT_FOUND'; end if;
  insert into public.lessons(studio_id,student_id,topic,starts_at,ends_at,status,location_type,location_label,meeting_provider,source_provider)
  values(target_studio,target_student,coalesce(nullif(trim(topic),''),'Private coaching'),starts_at,ends_at,'scheduled',location_type,
    coalesce(nullif(trim(location_label),''),case when location_type='in_person' then 'In person' else 'Google Meet' end),
    case when location_type='in_person' then 'in_person' else 'google_meet' end,'studio') returning * into created;
  insert into public.lesson_participants(lesson_id,student_id,display_name,email,status)
  values(created.id,target_student,coalesce(nullif(trim(student_name),''),'Student'),coalesce(trim(student_email),''),'confirmed');
  insert into public.calendar_projections(lesson_id,status) values(created.id,'queued');
  if recurrence in ('weekly','biweekly') and occurrence_count>1 then
    recurring_result:=public.command_make_lesson_recurring(created.id,created.version,recurrence,occurrence_count,timezone);
    select * into created from public.lessons where id=created.id;
  end if;
  return jsonb_build_object('lesson',to_jsonb(created),'recurrence',coalesce(recurring_result,'{}'::jsonb));
end $$;
revoke all on function public.command_create_lesson(uuid,uuid,text,timestamptz,timestamptz,text,text,text,text,text,integer,text) from public,anon,authenticated;
grant execute on function public.command_create_lesson(uuid,uuid,text,timestamptz,timestamptz,text,text,text,text,text,integer,text) to service_role;

create or replace function public.command_remove_student(
  target_student uuid,expected_version integer,removed_by uuid
) returns jsonb language plpgsql security definer set search_path='' as $$
declare student public.students; removed_at timestamptz:=now(); lesson_ids uuid[]:='{}';
begin
  select * into student from public.students where id=target_student and deleted_at is null for update;
  if student.id is null then raise exception 'STUDENT_NOT_FOUND'; end if;
  if student.version<>expected_version then raise exception 'VERSION_CONFLICT:%',student.version; end if;
  select coalesce(array_agg(distinct l.id),'{}'::uuid[]) into lesson_ids
  from public.lessons l left join public.lesson_participants p on p.lesson_id=l.id
  where (l.student_id=student.id or p.student_id=student.id) and l.status='scheduled' and l.starts_at>=removed_at;
  update public.lessons set status='cancelled',version=version+1,updated_at=removed_at where id=any(lesson_ids);
  update public.lesson_participants set status='cancelled' where student_id=student.id and lesson_id=any(lesson_ids);
  insert into public.calendar_projections(lesson_id,status,last_error)
  select unnest(lesson_ids),'queued',null on conflict(lesson_id) do update set status='queued',last_error=null;
  update public.recurring_series set status='cancelled',version=version+1,updated_at=removed_at
  where student_id=student.id and status in ('active','paused','cancel_at_period_end');
  delete from public.student_relationships where student_id=student.id;
  update public.students set deleted_at=removed_at,deleted_by=removed_by,status='inactive',portal_enabled=false,
    portal_username=null,user_id=null,version=version+1,updated_at=removed_at where id=student.id;
  return jsonb_build_object('id',student.id,'removedAt',removed_at,'cancelledLessons',cardinality(lesson_ids),'lessonIds',to_jsonb(lesson_ids));
end $$;
revoke all on function public.command_remove_student(uuid,integer,uuid) from public,anon,authenticated;
grant execute on function public.command_remove_student(uuid,integer,uuid) to service_role;

create or replace function public.command_update_lesson_details(
  target_lesson uuid,expected_version integer,next_topic text,next_location_type text,next_location_label text,next_join_url text
) returns public.lessons language plpgsql security definer set search_path='' as $$
declare current_lesson public.lessons; updated_lesson public.lessons;
begin
  select * into current_lesson from public.lessons where id=target_lesson for update;
  if current_lesson.id is null or not public.is_studio_coach(current_lesson.studio_id) then raise exception 'FORBIDDEN'; end if;
  if current_lesson.version<>expected_version then raise exception 'VERSION_CONFLICT:%',current_lesson.version; end if;
  if next_location_type not in ('virtual','in_person') then raise exception 'VALIDATION_FAILED'; end if;
  update public.lessons set
    topic=coalesce(nullif(trim(next_topic),''),topic),
    location_type=next_location_type,
    location_label=coalesce(nullif(trim(next_location_label),''),case when next_location_type='in_person' then 'In person' else 'Google Meet' end),
    join_url=nullif(trim(coalesce(next_join_url,'')),''),
    meeting_provider=case when next_location_type='in_person' then 'in_person' else 'google_meet' end,
    version=version+1,updated_at=now()
  where id=current_lesson.id returning * into updated_lesson;
  insert into public.calendar_projections(lesson_id,status,last_error)
  values(updated_lesson.id,'queued',null) on conflict(lesson_id) do update set status='queued',last_error=null;
  return updated_lesson;
end $$;
revoke all on function public.command_update_lesson_details(uuid,integer,text,text,text,text) from public,anon;
grant execute on function public.command_update_lesson_details(uuid,integer,text,text,text,text) to authenticated;

create or replace function public.command_apply_lesson_credit(
  target_lesson uuid,requested_package uuid,entry_reason text,entry_idempotency_key text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare lesson public.lessons; package_record public.packages; entry public.package_credit_entries; booking_ids uuid[]:='{}';
begin
  select * into lesson from public.lessons where id=target_lesson for update;
  if lesson.id is null then raise exception 'LESSON_NOT_FOUND'; end if;
  if lesson.student_id is null or lesson.status in ('cancelled','late_cancelled') then raise exception 'INVALID_TRANSITION'; end if;
  if exists(select 1 from public.package_credit_entries e where e.lesson_id=lesson.id and e.quantity<0) then raise exception 'INVALID_TRANSITION: This lesson is already paid by credit.'; end if;
  select p.* into package_record from public.packages p
  where p.student_id=lesson.student_id and (requested_package is null or p.id=requested_package)
    and (p.expires_at is null or p.expires_at>now()) and public.package_credit_balance(p.id)>0
  order by p.expires_at nulls last,p.created_at limit 1 for update;
  if package_record.id is null then raise exception 'CREDIT_UNAVAILABLE'; end if;
  insert into public.package_credit_entries(package_id,lesson_id,kind,quantity,reason,idempotency_key)
  values(package_record.id,lesson.id,'consumption',-1,entry_reason,entry_idempotency_key)
  on conflict(idempotency_key) do update set idempotency_key=excluded.idempotency_key returning * into entry;
  update public.lessons set package_id=package_record.id,version=version+1,updated_at=now() where id=lesson.id returning * into lesson;
  insert into public.payment_entries(student_id,package_id,kind,amount_minor,currency,external_reference,reason)
  values(lesson.student_id,package_record.id,'adjustment',0,'USD','credit:'||lesson.id::text,'Paid by lesson credit: '||lesson.topic)
  on conflict(external_reference) do nothing;
  select coalesce(array_agg(distinct booking_id),'{}'::uuid[]) into booking_ids from public.lesson_participants where lesson_id=lesson.id and booking_id is not null;
  update public.bookings set payment_status='paid',paid_minor=0,updated_at=now() where id=any(booking_ids);
  return jsonb_build_object('entry',to_jsonb(entry),'lesson',to_jsonb(lesson),'bookingIds',to_jsonb(booking_ids));
end $$;
revoke all on function public.command_apply_lesson_credit(uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.command_apply_lesson_credit(uuid,uuid,text,text) to service_role;

create or replace function public.confirm_booking(target_booking uuid,target_hold uuid,amount_paid bigint,provider_reference text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare b public.bookings; service public.booking_services; student public.students; series_record public.recurring_series; lesson_id uuid; occurrence_id uuid; audit_id uuid; credit_package uuid; credit_count integer:=1; occurrence_total integer; idx integer; step_size interval; next_start timestamptz; next_end timestamptz;
begin
  select * into b from public.bookings where id=target_booking for update;
  if b.id is null then raise exception 'BOOKING_NOT_FOUND'; end if;
  if b.status='confirmed' then return jsonb_build_object('bookingId',b.id,'studentId',b.student_id,'duplicate',true); end if;
  select * into service from public.booking_services where id=b.service_id;
  perform pg_advisory_xact_lock(hashtext(b.studio_id::text));
  if b.offering_id is null and exists(select 1 from public.lessons l where l.studio_id=b.studio_id and l.status='scheduled' and tstzrange(l.starts_at,l.ends_at,'[)') && tstzrange(b.starts_at-make_interval(mins=>service.buffer_before_minutes),b.ends_at+make_interval(mins=>service.buffer_after_minutes),'[)')) then raise exception 'SLOT_UNAVAILABLE'; end if;
  if b.student_id is not null then
    select * into student from public.students where id=b.student_id and studio_id=b.studio_id and deleted_at is null;
  end if;
  if student.id is null then
    select * into student
    from public.students s
    where s.studio_id=b.studio_id and s.deleted_at is null and (
      (nullif(trim(b.guest_email),'') is not null and lower(s.email)=lower(b.guest_email))
      or (
        regexp_replace(lower(trim(s.full_name)),'\s+',' ','g')=regexp_replace(lower(trim(b.guest_name)),'\s+',' ','g')
        and (
          (nullif(trim(b.guardian_email),'') is not null and lower(s.guardian_email)=lower(b.guardian_email))
          or (nullif(trim(b.guest_email),'') is not null and lower(s.guardian_email)=lower(b.guest_email))
          or (nullif(trim(b.guardian_email),'') is not null and lower(s.email)=lower(b.guardian_email))
        )
      )
    )
    order by case when lower(s.email)=lower(b.guest_email) then 0 else 1 end,s.created_at limit 1;
  end if;
  if student.id is null then
    insert into public.students(studio_id,full_name,email,status,is_minor,guardian_name,guardian_email,portal_enabled)
    values(b.studio_id,b.guest_name,lower(b.guest_email),'lead',b.for_minor,b.guardian_name,b.guardian_email,true) returning * into student;
  else
    update public.students set
      guardian_name=coalesce(nullif(guardian_name,''),nullif(b.guardian_name,'')),
      guardian_email=coalesce(nullif(guardian_email,''),nullif(lower(b.guardian_email),'')),
      updated_at=now()
    where id=student.id returning * into student;
  end if;
  if b.series_id is not null then select * into series_record from public.recurring_series where id=b.series_id; credit_count=case when series_record.kind='ongoing' then 1 else coalesce(series_record.occurrence_count,1) end; end if;
  if b.payment_policy='credits' then select p.id into credit_package from public.packages p where p.student_id=student.id and public.package_credit_balance(p.id)>=credit_count order by p.expires_at nulls last limit 1 for update; if credit_package is null then raise exception 'CREDIT_UNAVAILABLE'; end if; end if;
  update public.bookings set student_id=student.id,status='confirmed',payment_status=case when payment_policy='credits' then 'paid' when amount_paid>=total_minor then 'paid' when amount_paid>0 then 'partially_paid' when payment_policy='pay_later' then 'due' else payment_status end,paid_minor=amount_paid,version=version+1,updated_at=now() where id=b.id returning * into b;
  update public.booking_holds set status='converted' where id=target_hold or id=any(b.hold_ids);
  if b.offering_id is null then
    insert into public.lessons(studio_id,student_id,topic,starts_at,ends_at,status,location_type,location_label,service_id,series_id,meeting_provider,capacity,source_provider)
    values(b.studio_id,student.id,service.name,b.starts_at,b.ends_at,'scheduled',case when b.location='in_person' then 'in_person' else 'virtual' end,case when b.location='in_person' then 'Studio' else 'Google Meet' end,b.service_id,b.series_id,b.location,1,'studio') returning id into lesson_id;
    insert into public.lesson_participants(lesson_id,booking_id,student_id,display_name,email,status) values(lesson_id,b.id,student.id,b.guest_name,b.guest_email,'confirmed');
    insert into public.calendar_projections(lesson_id,projected_version,status,conference_request_id) values(lesson_id,0,'queued',case when b.location='google_meet' then 'meet-'||lesson_id::text else null end);
    if credit_package is not null then update public.lessons set package_id=credit_package where id=lesson_id; insert into public.package_credit_entries(package_id,lesson_id,kind,quantity,reason,idempotency_key) values(credit_package,lesson_id,'reservation',-credit_count,'Booking reservation '||b.reference,'booking-credit:'||b.id::text); end if;
    if b.series_id is not null then
      select * into series_record from public.recurring_series where id=b.series_id;
      occurrence_total=case when series_record.kind='ongoing' then 12 else coalesce(series_record.occurrence_count,6) end;
      step_size=case when series_record.cadence='biweekly' then interval '14 days' else interval '7 days' end;
      for idx in 1..occurrence_total-1 loop
        next_start=((b.starts_at at time zone b.timezone)+idx*step_size) at time zone b.timezone;
        next_end=next_start+(b.ends_at-b.starts_at);
        if exists(select 1 from public.lessons l where l.studio_id=b.studio_id and l.status='scheduled' and tstzrange(l.starts_at,l.ends_at,'[)') && tstzrange(next_start-make_interval(mins=>service.buffer_before_minutes),next_end+make_interval(mins=>service.buffer_after_minutes),'[)')) then raise exception 'SLOT_UNAVAILABLE'; end if;
        insert into public.lessons(studio_id,student_id,topic,starts_at,ends_at,status,location_type,location_label,service_id,series_id,meeting_provider,capacity,source_provider)
        values(b.studio_id,student.id,service.name,next_start,next_end,'scheduled',case when b.location='in_person' then 'in_person' else 'virtual' end,case when b.location='in_person' then 'Studio' else 'Google Meet' end,b.service_id,b.series_id,b.location,1,'studio') returning id into occurrence_id;
        insert into public.lesson_participants(lesson_id,booking_id,student_id,display_name,email,status) values(occurrence_id,b.id,student.id,b.guest_name,b.guest_email,'confirmed');
        insert into public.calendar_projections(lesson_id,projected_version,status,conference_request_id) values(occurrence_id,0,'queued',case when b.location='google_meet' then 'meet-'||occurrence_id::text else null end);
      end loop;
    end if;
  else
    update public.service_offerings set enrolled=enrolled+1,version=version+1,updated_at=now() where id=b.offering_id and enrolled<capacity returning lesson_ids[1] into lesson_id;
    if lesson_id is null then raise exception 'OFFERING_FULL'; end if;
    foreach occurrence_id in array (select lesson_ids from public.service_offerings where id=b.offering_id) loop
      insert into public.lesson_participants(lesson_id,booking_id,student_id,display_name,email,status) values(occurrence_id,b.id,student.id,b.guest_name,b.guest_email,'confirmed') on conflict(lesson_id,email) do nothing;
    end loop;
  end if;
  if amount_paid>0 then insert into public.payment_entries(student_id,kind,amount_minor,currency,external_reference,reason) values(student.id,'payment',amount_paid,b.currency,provider_reference,'Booking payment '||b.reference) on conflict(external_reference) do nothing; end if;
  insert into public.audit_events(studio_id,action,entity_type,entity_id,reason,correlation_id,source,after_state)
  values(b.studio_id,'booking.confirmed','booking',b.id,'Payment or policy requirement satisfied',coalesce(provider_reference,b.reference),'booking_platform',to_jsonb(b)) returning id into audit_id;
  return jsonb_build_object('bookingId',b.id,'studentId',student.id,'lessonId',lesson_id,'auditEventId',audit_id,'duplicate',false);
end $$;
revoke all on function public.confirm_booking(uuid,uuid,bigint,text) from public,anon,authenticated;
grant execute on function public.confirm_booking(uuid,uuid,bigint,text) to service_role;

-- Repair legacy rows without a participant projection before enforcing the
-- participant-aware coach/student workflows.
insert into public.lesson_participants(lesson_id,student_id,display_name,email,status)
select l.id,s.id,s.full_name,coalesce(s.email,s.guardian_email,''),
  case when l.status='cancelled' then 'cancelled' else 'confirmed' end
from public.lessons l join public.students s on s.id=l.student_id
where not exists(select 1 from public.lesson_participants p where p.lesson_id=l.id and p.student_id=s.id)
on conflict(lesson_id,email) do nothing;

-- Reader requests were removed from the product. Preserve the historical row
-- privately for auditability while removing it from the exposed API schema.
create schema if not exists private;
revoke all on schema private from public,anon,authenticated;
grant usage on schema private to service_role;
alter table public.reader_requests set schema private;
revoke all on private.reader_requests from public,anon,authenticated;

-- An updated object must remain in the same authorized studio/student path.
drop policy if exists material_objects_update on storage.objects;
create policy material_objects_update on storage.objects for update to authenticated
using(
  bucket_id='studio-materials' and array_length(storage.foldername(name),1)>=2 and (
    public.is_studio_coach(((storage.foldername(name))[1])::uuid)
    or public.can_access_student(((storage.foldername(name))[2])::uuid)
  )
)
with check(
  bucket_id='studio-materials' and array_length(storage.foldername(name),1)>=2 and (
    public.is_studio_coach(((storage.foldername(name))[1])::uuid)
    or public.can_access_student(((storage.foldername(name))[2])::uuid)
  )
);

create index if not exists lesson_participants_booking_idx on public.lesson_participants(booking_id);
create index if not exists package_credit_entries_lesson_idx on public.package_credit_entries(lesson_id);
create index if not exists calendar_projections_status_idx on public.calendar_projections(status,next_attempt_at);
