-- Authorize checkout identity independently of read-only finance access.
create function public.portal_renewal_options(p_student uuid,p_lesson uuid default null)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare s public.students; l public.lessons; actor uuid:=auth.uid(); ids jsonb;
  evaluation jsonb; allowed boolean;
begin
  select * into s from public.students where id=p_student and deleted_at is null and portal_enabled;
  if s.id is null or actor is null or not public.can_view_student_finance(p_student) then
    raise exception 'FORBIDDEN';
  end if;
  allowed:=(s.user_id=actor and not s.is_minor and not exists(
    select 1 from public.linked_contacts c where c.student_id=s.id and c.is_primary_payer
  )) is true or exists (
    select 1 from public.linked_contacts c where c.student_id=s.id and c.studio_id=s.studio_id
      and c.user_id=actor and c.portal_enabled and c.can_view_finance and c.is_primary_payer
  );
  if not allowed or p_lesson is null then
    return jsonb_build_object('canPurchase',allowed,'definitionIds','[]'::jsonb);
  end if;
  if not public.can_view_student_schedule(p_student) then raise exception 'FORBIDDEN'; end if;
  select x.* into l from public.lessons x where x.id=p_lesson and x.studio_id=s.studio_id
    and exists(select 1 from public.lesson_participants lp join public.bookings b on b.id=lp.booking_id
      where lp.lesson_id=x.id and lp.student_id=s.id and lp.status in ('reserved','confirmed')
       and b.student_id=s.id and b.status='confirmed' and b.payment_policy='credits');
  if l.id is null or l.status<>'scheduled' or l.starts_at<=now() or l.service_id is null then
    return jsonb_build_object('canPurchase',true,'definitionIds','[]'::jsonb);
  end if;
  evaluation:=credit_internal.evaluate_student_lesson_credit(p_student,p_lesson,'manual');
  if evaluation->>'reasonCode'<>'no_available_credits' then
    return jsonb_build_object('canPurchase',true,'definitionIds','[]'::jsonb);
  end if;
  select coalesce(jsonb_agg(d.id order by d.session_count,d.id),'[]'::jsonb) into ids
    from public.package_definitions d where d.studio_id=s.studio_id
    and d.active and d.visibility='public' and d.direct_purchase
    and l.service_id=any(d.eligible_service_ids)
    and l.ends_at-l.starts_at=make_interval(mins=>d.session_duration_minutes)
    and (l.meeting_provider is null or l.meeting_provider=any(d.meeting_providers))
    and (d.expiration_days is null or now()+interval '24 hours'*d.expiration_days>l.starts_at)
    and exists(select 1 from public.package_billing_options b where b.definition_id=d.id
      and b.renewal_mode='one_time' and b.active and nullif(trim(b.stripe_price_id),'') is not null);
  return jsonb_build_object('canPurchase',true,'definitionIds',ids);
end $$;
revoke all on function public.portal_renewal_options(uuid,uuid) from public,anon,authenticated;
grant execute on function public.portal_renewal_options(uuid,uuid) to authenticated;
