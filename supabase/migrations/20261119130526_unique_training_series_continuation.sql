-- Two tabs with disjoint skipped dates still cannot extend the same source twice.
create unique index recurring_series_one_active_extension
  on public.recurring_series(student_id,(recurrence_rule->>'sourceSeriesId'))
  where recurrence_rule ? 'sourceSeriesId' and status<>'cancelled';

create or replace function public.confirm_booking(target_booking uuid,target_hold uuid,amount_paid bigint,provider_reference text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare coverage jsonb; before_entries bigint; direct_applied integer; b public.bookings; service public.booking_services; student public.students; series_record public.recurring_series; lesson_id uuid; occurrence_id uuid; audit_id uuid; credit_package uuid; credit_count integer:=1; occurrence_total integer; step_size interval; next_start timestamptz; next_end timestamptz;
  fixed_starts timestamptz[];
  fixed_ends timestamptz[];
begin
  select * into b from public.bookings where id=target_booking;
  if b.id is null then raise exception 'BOOKING_NOT_FOUND'; end if;
  if b.status='confirmed' then return jsonb_build_object('bookingId',b.id,'studentId',b.student_id,'duplicate',true); end if;
  select * into service from public.booking_services where id=b.service_id;
  perform pg_advisory_xact_lock(hashtext(b.studio_id::text));
  select * into b from public.bookings where id=target_booking;
  if b.status='confirmed' then return jsonb_build_object('bookingId',b.id,'studentId',b.student_id,'duplicate',true); end if;
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
  perform 1 from public.students where id=student.id for update;
  select * into b from public.bookings where id=target_booking for update;
  if b.status='confirmed' then return jsonb_build_object('bookingId',b.id,'studentId',b.student_id,'duplicate',true); end if;
  -- Explicit fixed proposals confirm exactly the held instants. Legacy and rolling
  -- series keep their existing recurrence and credit behavior.
  if series_record.kind='fixed' and series_record.recurrence_rule ? 'proposedOccurrenceCount' then
    perform h.id from public.booking_holds h where h.id=any(b.hold_ids) order by h.id for update;
    select array_agg(h.starts_at order by h.starts_at,h.id), array_agg(h.ends_at order by h.starts_at,h.id)
      into fixed_starts,fixed_ends
      from public.booking_holds h where h.id=any(b.hold_ids) and h.studio_id=b.studio_id and h.service_id=b.service_id;
    if cardinality(fixed_starts) is distinct from series_record.occurrence_count
      or fixed_starts[1] is distinct from b.starts_at or fixed_ends[1] is distinct from b.ends_at then
      raise exception 'INVALID_TRANSITION: The held dates do not match the recurring proposal.';
    end if;
  end if;
  update public.bookings set student_id=student.id,status='confirmed',payment_status=case when payment_policy='credits' then 'paid' when amount_paid>=total_minor then 'paid' when amount_paid>0 then 'partially_paid' when payment_policy='pay_later' then 'due' else payment_status end,paid_minor=amount_paid,version=version+1,updated_at=now() where id=b.id returning * into b;
  update public.booking_holds set status='converted' where id=target_hold or id=any(b.hold_ids);
  if b.offering_id is null then
    insert into public.lessons(studio_id,student_id,topic,starts_at,ends_at,status,location_type,location_label,service_id,series_id,meeting_provider,capacity,source_provider)
    values(b.studio_id,student.id,service.name,b.starts_at,b.ends_at,'scheduled',case when b.location='in_person' then 'in_person' else 'virtual' end,case when b.location='in_person' then 'Studio' else 'Google Meet' end,b.service_id,b.series_id,b.location,1,'studio') returning id into lesson_id;
    insert into public.lesson_participants(lesson_id,booking_id,student_id,display_name,email,status) values(lesson_id,b.id,student.id,b.guest_name,b.guest_email,'confirmed');
    insert into public.calendar_projections(lesson_id,projected_version,status,conference_request_id) values(lesson_id,0,'queued',case when b.location='google_meet' then 'meet-'||lesson_id::text else null end);
    if b.series_id is not null then
      select * into series_record from public.recurring_series where id=b.series_id;
      occurrence_total=case when series_record.kind='ongoing' then 12 else coalesce(series_record.occurrence_count,6) end;
      step_size=case when series_record.cadence='biweekly' then interval '14 days' else interval '7 days' end;
      for idx in 1..occurrence_total-1 loop
        if fixed_starts is not null then
          next_start:=fixed_starts[idx+1];
          next_end:=fixed_ends[idx+1];
        else
          next_start:=((b.starts_at at time zone b.timezone)+idx*step_size) at time zone b.timezone;
          next_end:=next_start+(b.ends_at-b.starts_at);
        end if;
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
      insert into public.lesson_participants(lesson_id,booking_id,student_id,display_name,email,status) values(occurrence_id,b.id,student.id,b.guest_name,b.guest_email,'confirmed') on conflict on constraint lesson_participants_lesson_id_email_key do nothing;
    end loop;
  end if;
  select count(*) into before_entries from public.package_credit_entries e join public.packages p on p.id=e.package_id where p.student_id=student.id and e.quantity<0;
  for occurrence_id in select lp.lesson_id from public.lesson_participants lp join public.lessons l on l.id=lp.lesson_id where lp.booking_id=b.id order by l.starts_at,l.id loop
    if b.payment_policy='credits' and (series_record.kind is distinct from 'ongoing' or occurrence_id=lesson_id) then
      credit_package:=public.reserve_student_lesson_credit(occurrence_id,student.id,null,true,'Booking reservation '||b.reference);
      if credit_package is null then raise exception 'CREDIT_UNAVAILABLE: Not enough valid credits for the booked lessons.'; end if;
    elsif b.payment_policy in ('credits','pay_later') then
      perform public.reserve_student_lesson_credit(occurrence_id,student.id);
    end if;
  end loop;
  select (count(*)-before_entries)::integer into direct_applied from public.package_credit_entries e join public.packages p on p.id=e.package_id where p.student_id=student.id and e.quantity<0;
  coverage:=credit_internal.request_coverage(student.id);
  coverage:=coverage||jsonb_build_object('applied',(coverage->>'applied')::integer+direct_applied,
    'alreadyCovered',greatest(0,(coverage->>'alreadyCovered')::integer-direct_applied));
  if amount_paid>0 then insert into public.payment_entries(student_id,kind,amount_minor,currency,external_reference,reason) values(student.id,'payment',amount_paid,b.currency,provider_reference,'Booking payment '||b.reference) on conflict(external_reference) do nothing; end if;
  insert into public.audit_events(studio_id,action,entity_type,entity_id,reason,correlation_id,source,after_state)
  values(b.studio_id,'booking.confirmed','booking',b.id,'Payment or policy requirement satisfied',coalesce(provider_reference,b.reference),'booking_platform',to_jsonb(b)) returning id into audit_id;
  return jsonb_build_object('creditCoverage',coverage,'bookingId',b.id,'studentId',student.id,'lessonId',lesson_id,'auditEventId',audit_id,'duplicate',false);
end $$;
