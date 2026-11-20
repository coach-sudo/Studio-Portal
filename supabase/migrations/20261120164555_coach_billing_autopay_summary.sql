-- Keep payment method data and consent details private. Coach billing only
-- needs the current authorization state for the student it is allowed to see.
create function credit_internal.coach_lesson_autopay_status(p_student uuid)
returns text language plpgsql stable security definer set search_path='' as $$
declare target_studio uuid; arrangement training_internal.lesson_autopay_mandates;
begin
  select studio_id into target_studio from public.students
    where id=p_student and deleted_at is null;
  if target_studio is null or not public.is_studio_coach(target_studio) then
    return null;
  end if;
  select * into arrangement from training_internal.lesson_autopay_mandates
    where student_id=p_student and studio_id=target_studio and
      (status in ('active','paused','cancelled') or
        (status='pending_setup' and setup_expires_at>now()))
    order by case status when 'active' then 0 when 'paused' then 0
      when 'pending_setup' then 1 else 2 end, consented_at desc, id
    limit 1;
  if not found then return 'off'; end if;
  if arrangement.status in ('active','paused') and
    (not training_internal.is_lesson_payer(arrangement.payer_id,p_student) or
     not training_internal.autopay_studio_allows(arrangement))
  then return 'needs_review'; end if;
  return arrangement.status;
end $$;
revoke all on function credit_internal.coach_lesson_autopay_status(uuid) from public,anon;
grant execute on function credit_internal.coach_lesson_autopay_status(uuid) to authenticated;

create or replace function public.student_financial_overview(p_student uuid)
returns jsonb language sql stable security invoker set search_path='' as $$
  select credit_internal.read_student_financial_overview(p_student) ||
    jsonb_strip_nulls(jsonb_build_object('autopayStatus',
      credit_internal.coach_lesson_autopay_status(p_student)));
$$;
