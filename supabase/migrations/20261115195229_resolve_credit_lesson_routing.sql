-- Resolve shortage routing from verified pool terms and booked credit policy.
-- The worker-facing result is private and carries no addresses.
create function credit_internal.credit_lesson_billing_route(p_student uuid,p_lesson uuid)
returns jsonb language plpgsql stable set search_path='' as $$
declare lesson public.lessons; evaluation jsonb; candidate uuid; candidates integer;
  contact uuid; candidate_is_shared boolean;
begin
  select l.* into lesson from public.lessons l
    join public.students s on s.id=p_student and s.studio_id=l.studio_id and s.deleted_at is null
    where l.id=p_lesson and l.status='scheduled' and l.starts_at>now() and l.service_id is not null
      and exists(select 1 from public.lesson_participants lp join public.bookings b on b.id=lp.booking_id
        where lp.lesson_id=l.id and lp.student_id=s.id and lp.status in ('confirmed','reserved')
          and b.student_id=s.id and b.studio_id=l.studio_id and b.status='confirmed' and b.payment_policy='credits');
  if not found then return jsonb_build_object('status','not_applicable'); end if;
  evaluation:=credit_internal.evaluate_student_lesson_credit(p_student,p_lesson,'manual');
  if evaluation->>'reasonCode' not in ('no_available_credits','expires_before_lesson')
    or coalesce((evaluation->>'existingReservation')::boolean,false) then
    return jsonb_build_object('status','not_applicable');
  end if;
  if exists(select 1 from credit_internal.reconciliation_cases c where c.student_id=p_student
      and c.status in ('needs_review','under_review','reopened')
      and coalesce(c.evidence->'present','true'::jsonb)='true'::jsonb) then
    return jsonb_build_object('status','disputed');
  end if;
  if exists(select 1 from public.packages p where p.student_id=p_student
      and (p.expires_at is null or p.expires_at>greatest(now(),lesson.starts_at))
      and public.package_credit_balance(p.id)>0
      and credit_internal.package_terms_match(p.id,lesson.studio_id,lesson.service_id,lesson.ends_at-lesson.starts_at) is null) then
    return jsonb_build_object('status','disputed');
  end if;

  select count(*)::integer,(array_agg(p.id order by p.id))[1],bool_or(p.household_id is not null)
    into candidates,candidate,candidate_is_shared
    from public.packages p where credit_internal.student_may_spend_pool(p.id,p_student)
      and credit_internal.package_terms_match(p.id,lesson.studio_id,lesson.service_id,lesson.ends_at-lesson.starts_at) is true
      and (p.expires_at is null or p.expires_at>greatest(now(),lesson.starts_at));
  if candidates>1 and candidate_is_shared then
    return jsonb_build_object('status','ambiguous_pool');
  end if;
  if candidates<>1 or not coalesce(candidate_is_shared,false) then candidate:=null; end if;
  contact:=credit_internal.shared_pool_billing_contact(candidate,p_student);
  return jsonb_build_object('status',case when contact is null then 'missing_recipient' else 'authorized' end,
    'packageId',candidate,'contactId',contact);
end $$;
revoke all on function credit_internal.credit_lesson_billing_route(uuid,uuid) from public,anon,authenticated;

create function credit_internal.credit_billing_attention(p_student uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare studio uuid; actor uuid:=auth.uid(); row_data record; status_text text; key_text text;
  earlier jsonb; current_state jsonb; results jsonb:='[]';
begin
  select studio_id into studio from public.students where id=p_student and deleted_at is null;
  if studio is null or actor is null or not public.is_studio_coach(studio) then
    raise exception 'FORBIDDEN' using errcode='42501';
  end if;
  for row_data in
    select distinct l.id,l.topic,l.starts_at,b.student_id
    from public.lessons l join public.lesson_participants lp on lp.lesson_id=l.id
    join public.bookings b on b.id=lp.booking_id and b.student_id=lp.student_id and b.studio_id=l.studio_id
    where l.studio_id=studio and l.status='scheduled' and l.starts_at>now()
      and b.status='confirmed' and b.payment_policy='credits'
    order by l.starts_at,l.id,b.student_id
  loop
    current_state:=credit_internal.credit_lesson_billing_route(row_data.student_id,row_data.id);
    status_text:=current_state->>'status';
    if status_text not in ('ambiguous_pool','missing_recipient') then continue; end if;
    key_text:='credit-routing:'||row_data.id::text||':'||row_data.student_id::text;
    perform pg_advisory_xact_lock(hashtextextended(key_text,0));
    select e.after_state into earlier from public.audit_events e where e.studio_id=studio
      and e.action='credits.routing_review' and e.correlation_id=key_text order by e.created_at desc,e.id desc limit 1;
    if earlier is distinct from current_state then
      insert into public.audit_events(studio_id,actor_id,action,entity_type,entity_id,reason,correlation_id,source,before_state,after_state)
      values(studio,actor,'credits.routing_review','lesson',row_data.id,'Credit reminder routing needs review',key_text,
        'coach_portal',earlier,current_state);
    end if;
    results:=results||jsonb_build_array(jsonb_build_object('lessonId',row_data.id,'studentId',row_data.student_id,
      'topic',row_data.topic,'startsAt',row_data.starts_at,'status',status_text));
  end loop;
  return results;
end $$;
revoke all on function credit_internal.credit_billing_attention(uuid) from public,anon;
grant execute on function credit_internal.credit_billing_attention(uuid) to authenticated;

create or replace function public.household_credit_access(p_student uuid,p_action text,p_value jsonb default '{}'::jsonb)
returns jsonb language sql security invoker set search_path='' as $$
  select case
    when p_action='billing_attention' then credit_internal.credit_billing_attention(p_student)
    when p_action in ('billing_read','billing_preview','billing_apply') then credit_internal.manage_shared_pool_billing(p_student,p_action,p_value)
    when p_action in ('restore_list','restore_preview','restore_apply') then credit_internal.restore_shared_credit(p_student,p_action,p_value)
    when p_action='attention_cases' then credit_internal.credit_attention_cases(p_student)
    when p_action in ('expiration_preview','expiration_apply','expiration_history')
      then credit_internal.credit_expiration_command(p_student,p_action,p_value)
    else credit_internal.household_credit_access(p_student,p_action,p_value)
  end
$$;
