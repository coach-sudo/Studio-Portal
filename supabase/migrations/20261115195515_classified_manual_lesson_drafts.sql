create or replace function public.command_create_manual_booking(p_key text,p_value jsonb,p_external_status text default 'not_checked') returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); student public.students; svc public.booking_services; pricing public.student_pricing_rules;
 b public.bookings; l public.lessons; audit_id uuid; result jsonb; prior jsonb; studio uuid;
 starts timestamptz:=(p_value->>'starts_at')::timestamptz; ends timestamptz; tz text; meeting text; token text;
 total bigint; paid bigint; upcharge bigint; coverage jsonb; reason text;
 arrangement text:=p_value->>'billing_arrangement'; credit_payment boolean:=false;
 historical boolean; outcome text:='scheduled'; treatment text;
begin
 if actor is null then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if p_key is null or length(p_key)<8 or length(p_key)>200 then raise exception 'VALIDATION_FAILED: A stable request key is required.'; end if;
 perform pg_advisory_xact_lock(hashtextextended(actor::text||':manual:'||p_key,0));
 prior:=public.manual_booking_replay(p_key,p_value); if prior is not null then return prior; end if;
 select studio_id into studio from public.students where id=(p_value->>'student_id')::uuid and deleted_at is null;
 if studio is null or not public.is_studio_coach(studio) then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 -- Same scheduling lock as reviewed occurrence and lesson-create commands.
 perform pg_advisory_xact_lock(hashtextextended(studio::text||':calendar',0));
 select * into student from public.students where id=(p_value->>'student_id')::uuid and studio_id=studio and deleted_at is null for update;
 if not found then raise exception 'VALIDATION_FAILED: Student is unavailable.'; end if;
 select * into svc from public.booking_services where id=(p_value->>'service_id')::uuid and studio_id=studio for share;
 if not found then raise exception 'VALIDATION_FAILED: Choose a studio service.'; end if;
 ends:=starts+make_interval(mins=>svc.duration_minutes);
 meeting:=coalesce(nullif(p_value->>'location',''),svc.default_location);
 select coalesce(nullif(p_value->>'timezone',''),nullif(s.timezone,'')) into tz from public.studios s where id=studio;
 if starts is null or p_value->>'starts_at' !~ '(Z|[+-][0-9]{2}:[0-9]{2})$' or not isfinite(starts) or not isfinite(ends) or ends<=starts or not meeting=any(svc.location_options) or tz is null or not exists(select 1 from pg_timezone_names where name=tz) then raise exception 'VALIDATION_FAILED: Choose a valid time, timezone and meeting format.'; end if;
 historical:=starts<=now();
 if arrangement is not null then
  if historical or arrangement not in ('credits','pay_later','custom','credit_exception')
    or svc.duration_minutes is distinct from (p_value->>'duration_minutes')::integer
    or char_length(trim(coalesce(p_value->>'reason','')))<3 then
     raise exception 'VALIDATION_FAILED: Review the service, duration, date and billing arrangement.';
  end if;
  credit_payment:=arrangement in ('credits','credit_exception');
  if arrangement='credits' and not ('credits'=any(svc.payment_policies)) then
    raise exception 'INVALID_TRANSITION: This service does not allow prepaid credits.';
  end if;
 end if;
 if historical then
  if not coalesce((p_value->>'historical')::boolean,false) then raise exception 'VALIDATION_FAILED: Choose Record Past Lesson.'; end if;
  outcome:=coalesce(p_value->>'historical_outcome','scheduled');
  treatment:=coalesce(p_value->>'historical_financial','record_only');
  if outcome not in ('scheduled','completed','cancelled','no_show') or treatment not in ('record_only','amount_due','payment_received') then raise exception 'VALIDATION_FAILED'; end if;
  if outcome in ('completed','no_show') and not coalesce((p_value->>'attendance_confirmed')::boolean,false) then raise exception 'VALIDATION_FAILED: Explicit coach outcome confirmation is required.'; end if;
 elsif coalesce((p_value->>'historical')::boolean,false) then raise exception 'VALIDATION_FAILED: Choose a past time for historical recording.';
 end if;
 if historical and exists(select 1 from public.lessons where studio_id=studio and student_id=student.id and starts_at=starts and ends_at=ends) then raise exception 'REVIEW_REQUIRED: An existing lesson matches this historical occurrence. Open it for review instead of creating a duplicate.'; end if;
 if p_external_status not in ('checked','not_configured','overridden','not_checked') then raise exception 'VALIDATION_FAILED'; end if;
 if exists(select 1 from public.lessons where studio_id=studio and status in ('draft','scheduled') and starts_at<ends and ends_at>starts) then raise exception 'SLOT_UNAVAILABLE: Studio lessons cannot overlap.'; end if;
 if student.special_pricing_enabled then
  select * into pricing from public.student_pricing_rules where student_id=student.id and service_id=svc.id and active and starts_at<=starts and (ends_at is null or ends_at>=starts) order by updated_at desc,id limit 1;
 end if;
 upcharge:=coalesce((pricing.location_price_adjustments->>meeting)::bigint,(svc.location_price_adjustments->>meeting)::bigint,0);
 total:=case when credit_payment then 0 when historical and treatment='record_only' then 0 else coalesce((p_value->>'price_minor')::bigint,coalesce(pricing.price_minor,svc.price_minor)+upcharge) end;
 if total is null or total<0 then raise exception 'VALIDATION_FAILED: Choose a nonnegative whole-minor-unit price.'; end if;
 paid:=case when (historical and treatment='payment_received') or (not historical and coalesce((p_value->>'mark_paid')::boolean,false)) then total else 0 end;
 reason:=coalesce(nullif(trim(p_value->>'reason'),''),'Coach created a manual booking');
 token:=encode(extensions.gen_random_bytes(32),'hex');
 insert into public.bookings(studio_id,reference,service_id,student_id,guest_name,guest_email,guardian_name,guardian_email,for_minor,starts_at,ends_at,timezone,location,status,payment_policy,payment_status,total_minor,paid_minor,currency,policy_snapshot,pricing_snapshot,admin_override,manage_token_hash)
 values(studio,'SS-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,16)),svc.id,student.id,student.full_name,coalesce(student.email,student.guardian_email,''),student.guardian_name,student.guardian_email,student.is_minor,
 starts,ends,tz,meeting,case when outcome='cancelled' then 'cancelled' when outcome in ('completed','no_show') then 'completed' else 'confirmed' end,case when credit_payment then 'credits' else 'pay_later' end,
 case when total=0 then 'not_required' else 'due' end,total,0,svc.currency,svc.policy||jsonb_build_object('policyVersion',svc.policy_version),
 jsonb_build_object('basePriceMinor',svc.price_minor,'locationUpchargeMinor',upcharge,'unitPriceMinor',total,'studentPricingRuleId',pricing.id,'adminOverride',true),
 jsonb_build_object('schedule',true,'price',p_value?'price_minor','createdByCoach',true,'externalCalendarCheck',p_external_status,'billingArrangement',arrangement),encode(extensions.digest(token,'sha256'),'hex')) returning * into b;
 insert into public.lessons(studio_id,student_id,topic,starts_at,ends_at,status,location_type,location_label,service_id,meeting_provider,capacity,source_provider)
 values(studio,student.id,svc.name,starts,ends,outcome::public.lesson_status,case when meeting='in_person' then 'in_person' else 'virtual' end,
 case when meeting='in_person' then coalesce(nullif(p_value->>'location_label',''),'Location to be confirmed') else 'Google Meet pending' end,svc.id,meeting,1,'studio') returning * into l;
 insert into public.lesson_participants(lesson_id,booking_id,student_id,display_name,email,status)
 values(l.id,b.id,student.id,student.full_name,coalesce(student.email,student.guardian_email,''),case when outcome='completed' then 'attended' when outcome='no_show' then 'no_show' when outcome='cancelled' then 'cancelled' else 'confirmed' end);
 if paid>0 then
  insert into public.payment_entries(student_id,kind,amount_minor,currency,external_reference,reason) values(student.id,'payment',paid,svc.currency,'manual:'||b.id::text,reason);
  update public.bookings set paid_minor=paid,payment_status='paid' where id=b.id returning * into b;
 end if;
 -- Coverage sees the linked booking's committed-within-command financial state.
 if historical then coverage:=jsonb_build_object('historical',true,'automaticCoverage',false);
 elsif credit_payment then
  if public.reserve_student_lesson_credit(l.id,student.id,null,true,reason) is null and arrangement<>'credit_exception' then
    raise exception 'CREDIT_UNAVAILABLE: Reserve an eligible credit or select an approved uncovered exception.';
  end if;
  select * into b from public.bookings where id=b.id;
  coverage:=public.student_credit_summary(student.id);
 elsif arrangement is null then coverage:=public.reserve_student_upcoming_credits(student.id);
 else coverage:=public.student_credit_summary(student.id);
 end if;
 if starts>now() then
  insert into public.calendar_projections(lesson_id,status) values(l.id,'queued');
  insert into workspace_internal.manual_booking_effects(booking_id,lesson_id,manage_token) values(b.id,l.id,token);
 end if;
 insert into public.audit_events(studio_id,actor_id,entity_type,entity_id,action,reason,correlation_id,source,after_state)
 values(studio,actor,'booking',b.id,'booking.created_by_coach',reason,p_key,'booking_admin',jsonb_build_object('booking',to_jsonb(b)-'manage_token_hash','lessonId',l.id,'externalCalendarCheck',p_external_status,'historical',historical,'historicalOutcome',outcome,'financialTreatment',treatment,'attendanceConfirmed',coalesce((p_value->>'attendance_confirmed')::boolean,false),'recordedAt',b.created_at)) returning id into audit_id;
 result:=jsonb_build_object('resource',to_jsonb(b)-'manage_token_hash','lessonId',l.id,'auditEventId',audit_id,'creditCoverage',coverage,'manageUrl','/booking/'||token,'sideEffects',case when starts>now() then 'pending' else 'suppressed_historical' end);
 insert into workspace_internal.manual_booking_receipts(actor_id,key,studio_id,request_hash,result) values(actor,p_key,studio,encode(extensions.digest(p_value::text,'sha256'),'hex'),result);
 return result;
end $$;

create table credit_internal.manual_lesson_drafts (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students(id),
  details jsonb not null,
  version integer not null default 1,
  confirmed_lesson_id uuid references public.lessons(id),
  updated_at timestamptz not null default now()
);
alter table credit_internal.manual_lesson_drafts enable row level security;
revoke all on credit_internal.manual_lesson_drafts from public,anon,authenticated,service_role;

create function credit_internal.manual_lesson_draft_command(p_student uuid,p_action text,p_value jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); studio uuid; draft credit_internal.manual_lesson_drafts;
  draft_id uuid:=(p_value->>'draftId')::uuid; draft_details jsonb:=p_value->'details'; booking jsonb;
begin
  select studio_id into studio from public.students where id=p_student and deleted_at is null;
  if studio is null or actor is null or not public.is_studio_coach(studio) then
    raise exception 'FORBIDDEN' using errcode='42501'; end if;
  if p_action='manual_draft_list' then
    return coalesce((select jsonb_agg(to_jsonb(d) order by d.updated_at desc,d.id)
      from credit_internal.manual_lesson_drafts d where d.student_id=p_student and d.confirmed_lesson_id is null),'[]');
  end if;
  if p_action is null or p_action not in ('manual_draft_save','manual_draft_confirm') then
    raise exception 'VALIDATION_FAILED'; end if;
  if draft_id is null then raise exception 'VALIDATION_FAILED'; end if;
  if p_action='manual_draft_save' then
    if jsonb_typeof(draft_details) is distinct from 'object' or char_length(draft_details::text)>5000 then
      raise exception 'VALIDATION_FAILED'; end if;
    if (p_value->>'version')::integer=0 then
      insert into credit_internal.manual_lesson_drafts(id,student_id,details) values(draft_id,p_student,draft_details)
        on conflict(id) do nothing;
      select * into draft from credit_internal.manual_lesson_drafts d where d.id=draft_id and d.student_id=p_student for update;
      if not found then raise exception 'FORBIDDEN' using errcode='42501'; end if;
      if draft.version<>1 or draft.details is distinct from draft_details or draft.confirmed_lesson_id is not null then
        raise exception 'VERSION_CONFLICT: Reopen the current draft.'; end if;
      return to_jsonb(draft);
    end if;
    update credit_internal.manual_lesson_drafts d set details=draft_details,
      version=d.version+1,updated_at=now()
      where d.id=draft_id and d.student_id=p_student and d.confirmed_lesson_id is null
        and d.version=(p_value->>'version')::integer returning * into draft;
    if not found then raise exception 'VERSION_CONFLICT: Reopen the current draft.'; end if;
    return to_jsonb(draft);
  end if;
  select * into draft from credit_internal.manual_lesson_drafts d where d.id=draft_id and d.student_id=p_student for update;
  if not found then raise exception 'FORBIDDEN' using errcode='42501'; end if;
  if draft.confirmed_lesson_id is not null then return to_jsonb(draft); end if;
  if draft.version is distinct from (p_value->>'version')::integer then
    raise exception 'VERSION_CONFLICT: Reopen the current draft.'; end if;
  if nullif(draft.details->>'service_id','') is null or nullif(draft.details->>'starts_at','') is null
      or nullif(draft.details->>'duration_minutes','') is null
      or coalesce(draft.details->>'billing_arrangement','') not in ('credits','pay_later','custom','credit_exception')
      or char_length(trim(coalesce(draft.details->>'reason','')))<3 then
    raise exception 'VALIDATION_FAILED: Choose the service, duration, time, billing arrangement and reason.'; end if;
  booking:=public.command_create_manual_booking('lesson-draft:'||draft.id::text,
    jsonb_build_object('student_id',p_student,'service_id',draft.details->>'service_id',
      'starts_at',draft.details->>'starts_at','duration_minutes',draft.details->>'duration_minutes',
      'timezone',draft.details->>'timezone','billing_arrangement',draft.details->>'billing_arrangement',
      'reason',draft.details->>'reason'),'not_checked');
  update credit_internal.manual_lesson_drafts d set confirmed_lesson_id=(booking->>'lessonId')::uuid,
    version=d.version+1,updated_at=now() where d.id=draft.id returning * into draft;
  return to_jsonb(draft);
end $$;
revoke all on function credit_internal.manual_lesson_draft_command(uuid,text,jsonb) from public,anon;
grant execute on function credit_internal.manual_lesson_draft_command(uuid,text,jsonb) to authenticated;

create or replace function public.household_credit_access(p_student uuid,p_action text,p_value jsonb default '{}'::jsonb)
returns jsonb language sql security invoker set search_path='' as $$
  select case
    when p_action in ('manual_draft_list','manual_draft_save','manual_draft_confirm')
      then credit_internal.manual_lesson_draft_command(p_student,p_action,p_value)
    when p_action='billing_attention' then credit_internal.credit_billing_attention(p_student)
    when p_action in ('billing_read','billing_preview','billing_apply') then credit_internal.manage_shared_pool_billing(p_student,p_action,p_value)
    when p_action in ('restore_list','restore_preview','restore_apply') then credit_internal.restore_shared_credit(p_student,p_action,p_value)
    when p_action='attention_cases' then credit_internal.credit_attention_cases(p_student)
    when p_action in ('expiration_preview','expiration_apply','expiration_history')
      then credit_internal.credit_expiration_command(p_student,p_action,p_value)
    else credit_internal.household_credit_access(p_student,p_action,p_value)
  end
$$;

create or replace function credit_internal.available_lesson_package(
  p_student uuid,p_studio uuid,p_service uuid,p_duration interval,p_start timestamptz,
  p_allocated jsonb,p_package uuid,p_automatic boolean,p_verified boolean
) returns uuid language sql stable set search_path='' as $$
  select p.id
  from (select id from public.packages where student_id=p_student union all
        select package_id from credit_internal.credit_pool_members where student_id=p_student) eligible
  join public.packages p on p.id=eligible.id
  where (p_package is null or p.id=p_package)
    and credit_internal.student_may_spend_pool(p.id,p_student)
    and (not p_automatic or p.auto_apply)
    and (case when p_verified then credit_internal.package_terms_match(p.id,p_studio,p_service,p_duration) is true
      else credit_internal.package_terms_match(p.id,p_studio,p_service,p_duration) is not false end)
    and (p.expires_at is null or p.expires_at>greatest(now(),p_start))
    and public.package_credit_balance(p.id)>coalesce((p_allocated->>p.id::text)::integer,0)
  order by p.expires_at nulls last,p.household_id is not null,p.created_at,p.id limit 1
$$;
revoke all on function credit_internal.available_lesson_package(uuid,uuid,uuid,interval,timestamptz,jsonb,uuid,boolean,boolean) from public,anon,authenticated;

create or replace function credit_internal.evaluate_student_lesson_credit(
  p_student uuid, p_lesson uuid, p_mode text default 'automatic',
  p_allocated jsonb default '{}'::jsonb, p_package uuid default null,
  p_needs_review boolean default null
) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  l public.lessons;
  pkg public.packages;
  enabled boolean;
  reason text;
  state text := 'ineligible';
  reservation_count integer;
  reserved_package uuid;
begin
  if p_mode not in ('automatic', 'enable_preview', 'manual')
     or jsonb_typeof(p_allocated) is distinct from 'object' then
    raise exception 'VALIDATION_FAILED: Invalid coverage evaluation mode.' using errcode = '22023';
  end if;
  select x.* into l from public.lessons x join public.students s on s.id = p_student
    where x.id = p_lesson and x.studio_id = s.studio_id
      and (x.student_id = p_student or exists(
        select 1 from public.lesson_participants lp where lp.lesson_id = x.id
          and lp.student_id = p_student and lp.status in ('reserved', 'confirmed')));
  if l.id is null then
    return jsonb_build_object('state', 'ineligible', 'reasonCode', 'lesson_ineligible', 'eligible', false);
  end if;
  select coalesce(sum(t.qty), 0)::integer, (array_agg(t.package_id order by t.package_id))[1]
    into reservation_count, reserved_package
    from (select e.package_id, greatest(0, -sum(e.quantity))::integer qty
      from public.package_credit_entries e join public.packages p on p.id = e.package_id
      where e.lesson_id = l.id and coalesce(e.used_by_student_id,p.student_id) = p_student
      group by e.package_id having sum(e.quantity) < 0) t;

  -- A date correction preserves accounting. Only an explicit manual credit
  -- command may allocate coverage to a corrected record afterward.
  if p_mode<>'manual' and exists(select 1 from lesson_ops.datetime_corrections c where c.lesson_id=l.id) then
    return jsonb_build_object('state','review_required','reasonCode','reconciliation_required','eligible',false,'existingReservation',reservation_count>0);
  end if;
  if exists(select 1 from public.lesson_participants lp join public.bookings b on b.id=lp.booking_id
        where lp.lesson_id=l.id and lp.student_id=p_student and b.student_id=p_student
          and b.admin_override->>'billingArrangement' in ('pay_later','custom')) then
    return jsonb_build_object('state','ineligible','reasonCode','lesson_ineligible','eligible',false);
  end if;
  if l.status <> 'scheduled' and not (p_mode = 'manual' and l.status = 'completed') then
    reason := 'lesson_ineligible';
  elsif exists(select 1 from public.studio_invoices i cross join jsonb_array_elements(i.items) x
    where i.student_id = p_student and i.checkout_key is not null
      and x->'lessonIds' @> to_jsonb(array[l.id::text])) then
    reason := 'payment_pending';
    if reservation_count > 0 then state := 'review_required'; end if;
  elsif reservation_count > 1 then
    select * into pkg from public.packages where id = reserved_package;
    return jsonb_build_object('state', 'review_required', 'reasonCode', 'reconciliation_required',
      'eligible', false, 'existingReservation', true, 'packageId', pkg.id, 'expiresAt', pkg.expires_at);
  elsif reservation_count = 1 then
    select * into pkg from public.packages where id = reserved_package;
    if credit_internal.package_lesson_matches(pkg.id,l.id) is false then
      return jsonb_build_object('state','review_required','reasonCode','reconciliation_required',
        'eligible',false,'existingReservation',true,'packageId',pkg.id,'expiresAt',pkg.expires_at);
    end if;
    if l.status = 'scheduled' and pkg.expires_at <= greatest(now(), l.starts_at) then
      return jsonb_build_object('state', 'review_required', 'reasonCode', 'expires_before_lesson',
        'eligible', false, 'existingReservation', true, 'packageId', pkg.id, 'expiresAt', pkg.expires_at);
    end if;
    if (l.student_id = p_student and (l.paid_minor > 0 or l.payment_status in ('paid', 'partially_paid', 'waived', 'refunded')))
       or exists(select 1 from public.lesson_participants lp join public.bookings b on b.id = lp.booking_id
         where lp.lesson_id = l.id and b.student_id = p_student and b.payment_policy <> 'credits'
           and b.payment_status in ('paid', 'partially_paid', 'processing')) then
      return jsonb_build_object('state', 'review_required', 'reasonCode', 'reconciliation_required',
        'eligible', false, 'existingReservation', true, 'packageId', pkg.id, 'expiresAt', pkg.expires_at);
    end if;
    return jsonb_build_object('state', 'covered', 'reasonCode', 'already_reserved',
      'eligible', false, 'existingReservation', true, 'packageId', pkg.id, 'expiresAt', pkg.expires_at);
  elsif coalesce(p_needs_review, (public.student_credit_summary(p_student)->>'needsReview')::boolean) then
    reason := 'reconciliation_required'; state := 'review_required';
  elsif exists(select 1 from public.package_credit_entries e join public.packages p on p.id=e.package_id
    where coalesce(e.used_by_student_id,p.student_id)=p_student and e.lesson_id=l.id group by e.lesson_id having sum(e.quantity)>0) then
    reason := 'reconciliation_required'; state := 'review_required';
  elsif l.student_id = p_student and l.payment_status = 'partially_paid' then
    reason := 'partially_paid';
  elsif l.student_id = p_student and (l.payment_status = 'paid' or l.paid_minor > 0) then
    reason := 'cash_paid';
  elsif l.student_id = p_student and l.payment_status in ('waived', 'refunded') then
    reason := 'lesson_ineligible';
  else
    select case when b.payment_status = 'processing' then 'payment_pending'
        when b.payment_status = 'partially_paid' then 'partially_paid' else 'cash_paid' end
      into reason from public.lesson_participants lp join public.bookings b on b.id = lp.booking_id
      where lp.lesson_id = l.id and b.student_id = p_student and b.payment_policy <> 'credits'
        and b.payment_status in ('paid', 'partially_paid', 'processing')
      order by case b.payment_status when 'processing' then 0 when 'partially_paid' then 1 else 2 end, b.id
      limit 1;
    if reason is null then
      select case when exists(select 1 from public.student_credit_accounts where student_id=p_student)
        then (select auto_apply from public.student_credit_accounts where student_id=p_student) else false end into enabled;
      if p_mode <> 'manual' and l.source_provider is not null and l.source_provider not in ('studio','public_booking') then
        reason := 'reconciliation_required'; state := 'review_required';
      elsif p_mode = 'automatic' and enabled is null then
        reason := 'mixed_settings_review'; state := 'review_required';
      elsif p_mode = 'automatic' and enabled = false then
        reason := 'auto_disabled';
      else
        select p.* into pkg from public.packages p where p.id=credit_internal.available_lesson_package(
          p_student,l.studio_id,l.service_id,l.ends_at-l.starts_at,l.starts_at,p_allocated,p_package,
          p_mode='automatic' and enabled is distinct from true,
          exists(select 1 from public.lesson_participants lp join public.bookings b on b.id=lp.booking_id
            where lp.lesson_id=l.id and lp.student_id=p_student and b.student_id=p_student
              and b.admin_override->>'billingArrangement' in ('credits','credit_exception')));
        if pkg.id is not null then
          return jsonb_build_object('state', 'eligible_unreserved', 'reasonCode', 'eligible',
            'eligible', true, 'packageId', pkg.id, 'expiresAt', pkg.expires_at);
        end if;
        if p_mode = 'automatic' and enabled is null and exists(
          select 1 from public.packages p where credit_internal.student_may_spend_pool(p.id,p_student) and not p.auto_apply
            and (p_package is null or p.id = p_package)
            and credit_internal.package_lesson_matches(p.id,l.id) is not false
            and (p.expires_at is null or p.expires_at > greatest(now(), l.starts_at))
            and public.package_credit_balance(p.id) - coalesce((p_allocated->>p.id::text)::integer, 0) > 0) then
          reason := 'mixed_settings_review'; state := 'review_required';
        elsif exists(select 1 from public.packages p where p.student_id=p_student
          and (p_package is null or p.id=p_package)
          and (p.expires_at is null or p.expires_at>greatest(now(),l.starts_at))
          and public.package_credit_balance(p.id)>0
          and credit_internal.package_lesson_matches(p.id,l.id) is false) then
          reason := 'reconciliation_required'; state := 'review_required';
        elsif exists(select 1 from public.packages p where credit_internal.student_may_spend_pool(p.id,p_student)
          and (p_package is null or p.id = p_package)
          and (p_mode <> 'automatic' or coalesce(enabled, p.auto_apply))
          and p.expires_at > now() and p.expires_at <= l.starts_at
          and public.package_credit_balance(p.id) - coalesce((p_allocated->>p.id::text)::integer, 0) > 0) then
          reason := 'expires_before_lesson';
        else
          reason := 'no_available_credits';
        end if;
      end if;
    end if;
  end if;
  return jsonb_build_object('state', state, 'reasonCode', reason, 'eligible', false);
end;
$$;
