-- Calendar proposals keep their existing route and receipt. Each occurrence uses
-- the same classified booking command as a lesson confirmed from a private draft.
create or replace function public.command_create_lesson_once(p_value jsonb,p_key text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  actor uuid:=auth.uid(); student public.students; svc public.booking_services;
  studio uuid; old workspace_internal.operation_receipts; series uuid;
  result jsonb; created jsonb; base public.lessons; audit_id uuid; i integer;
  cadence text:=coalesce(p_value->>'recurrence','none');
  total integer:=coalesce((p_value->>'occurrenceCount')::integer,1);
  tz text:=p_value->>'timezone'; first_start timestamptz:=(p_value->>'startsAt')::timestamptz;
  first_end timestamptz:=(p_value->>'endsAt')::timestamptz;
  starts timestamptz; ends timestamptz; meeting text;
  arrangement text:=p_value->>'billingArrangement'; duration integer:=(p_value->>'durationMinutes')::integer;
  classification_reason text:=trim(p_value->>'reason'); lesson_id uuid;
begin
  select s.studio_id into studio from public.students s where s.id=(p_value->>'studentId')::uuid and s.deleted_at is null;
  if actor is null or studio is null or not public.is_studio_coach(studio) then
    raise exception 'FORBIDDEN' using errcode='42501';
  end if;
  if p_key is null or length(p_key) not between 8 and 200 then raise exception 'VALIDATION_FAILED'; end if;
  perform pg_advisory_xact_lock(hashtextextended(studio::text||':calendar',0));
  select * into old from workspace_internal.operation_receipts where actor_id=actor and key=p_key;
  if found then
    if old.request<>jsonb_build_object('command','lesson.create','payload',p_value) then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
    return old.result;
  end if;
  select * into student from public.students where id=(p_value->>'studentId')::uuid and studio_id=studio and deleted_at is null for update;
  if not found then raise exception 'FORBIDDEN' using errcode='42501'; end if;
  select * into svc from public.booking_services where id=(p_value->>'serviceId')::uuid and studio_id=studio for share;
  if svc.id is null or duration is distinct from svc.duration_minutes or first_start is null or first_end is null
    or not isfinite(first_start) or not isfinite(first_end)
    or first_end-first_start is distinct from make_interval(mins=>duration)
    or coalesce(arrangement,'') not in ('credits','pay_later','custom','credit_exception')
    or coalesce(length(classification_reason),0)<3
    or cadence not in ('none','weekly','biweekly')
    or (cadence='none' and total<>1) or (cadence<>'none' and total not between 2 and 52)
    or not exists(select 1 from pg_timezone_names where name=tz) then
    raise exception 'VALIDATION_FAILED: Choose a matching service, duration, and billing arrangement.';
  end if;
  meeting:=case p_value->>'locationType' when 'in_person' then 'in_person' when 'virtual' then 'google_meet' end;
  if meeting is null then raise exception 'VALIDATION_FAILED'; end if;
  if total>1 then
    insert into public.recurring_series(studio_id,service_id,student_id,kind,cadence,status,starts_on,occurrence_count,
      payment_policy,recurrence_rule,meeting_provider)
    values(studio,svc.id,student.id,'fixed',cadence,'active',first_start,total,
      case when arrangement in ('credits','credit_exception') then 'credits' else 'pay_later' end,
      jsonb_build_object('intervalWeeks',case when cadence='biweekly' then 2 else 1 end,
        'slots',jsonb_build_array(jsonb_build_object('weekday',extract(dow from first_start at time zone tz)::integer,
          'time',to_char(first_start at time zone tz,'HH24:MI')))),meeting) returning id into series;
  end if;
  for i in 0..total-1 loop
    starts:=((first_start at time zone tz)+make_interval(days=>i*case when cadence='biweekly' then 14 else 7 end)) at time zone tz;
    ends:=((first_end at time zone tz)+make_interval(days=>i*case when cadence='biweekly' then 14 else 7 end)) at time zone tz;
    if ends-starts is distinct from make_interval(mins=>duration) then raise exception 'VALIDATION_FAILED: Review the duration of the series around the clock change.'; end if;
    created:=public.command_create_manual_booking('calendar:'||md5(p_key)||':'||i::text,
      jsonb_build_object('student_id',student.id,'service_id',svc.id,'duration_minutes',duration,
        'starts_at',to_char(starts at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'timezone',tz,
        'location',meeting,'location_label',p_value->>'locationLabel','billing_arrangement',arrangement,'reason',classification_reason));
    lesson_id:=(created->>'lessonId')::uuid;
    update public.lessons set series_id=series,topic=coalesce(nullif(trim(p_value->>'topic'),''),svc.name)
      where id=lesson_id returning * into base;
    if series is not null then
      update public.bookings set series_id=series where id=(created->'resource'->>'id')::uuid;
    end if;
    if i=0 then result:=jsonb_build_object('lesson',to_jsonb(base)); end if;
  end loop;
  result:=result||jsonb_build_object('recurrence',jsonb_build_object('seriesId',series,'occurrenceCount',total),
    'creditCoverage',created->'creditCoverage');
  insert into public.audit_events(studio_id,actor_id,action,entity_type,entity_id,reason,correlation_id,source,after_state)
    values(studio,actor,'lesson.created','lesson',(result->'lesson'->>'id')::uuid,classification_reason,p_key,'coach_portal',result)
    returning id into audit_id;
  result:=result||jsonb_build_object('auditEventId',audit_id);
  insert into workspace_internal.operation_receipts(actor_id,key,studio_id,request,result)
    values(actor,p_key,studio,jsonb_build_object('command','lesson.create','payload',p_value),result);
  return result;
end $$;
-- Create a fresh lot from the sharing terms of an approved definition. The
-- discretionary grant selects one of its eligible services and carries no price.
create function credit_internal.issue_shared_discretionary(p_student uuid,p_action text,p_value jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  actor uuid:=auth.uid(); studio uuid; household uuid:=(p_value->>'householdId')::uuid;
  svc public.booking_services; definition public.package_definitions;
  members uuid[]; member uuid; qty integer:=(p_value->>'quantity')::integer;
  duration integer:=(p_value->>'durationMinutes')::integer;
  expires timestamptz:=(p_value->>'expiresAt')::timestamptz;
  reason_text text:=trim(p_value->>'reason'); preview jsonb;
  request_key text:='shared-discretionary:'||(p_value->>'key');
  prior credit_internal.credit_command_receipts; lot uuid; entry uuid; event_id uuid; result jsonb;
begin
  select studio_id into studio from public.students where id=p_student and deleted_at is null;
  if actor is null or studio is null or not public.is_studio_coach(studio) or not exists(
    select 1 from credit_internal.credit_households where id=household and studio_id=studio
  ) then raise exception 'FORBIDDEN' using errcode='42501'; end if;
  if p_action not in ('discretionary_preview','discretionary_apply') then raise exception 'VALIDATION_FAILED'; end if;
  if p_action='discretionary_apply' then
    if coalesce(length(p_value->>'key'),0) not between 8 and 120 then raise exception 'VALIDATION_FAILED'; end if;
    perform pg_advisory_xact_lock(hashtextextended(request_key,0));
    select * into prior from credit_internal.credit_command_receipts where key=request_key;
    if found then
      if prior.student_id<>p_student or prior.actor_id is distinct from actor or prior.request is distinct from p_value
        then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
      return prior.response;
    end if;
  end if;
  if qty is null or qty not between 1 and 100000 or duration is null or duration not between 15 and 480
    or not (p_value ? 'expiresAt') or (expires is not null and (not isfinite(expires) or expires<=now()))
    or coalesce(length(reason_text),0) not between 3 and 500
    or jsonb_typeof(p_value->'members') is distinct from 'array'
    or jsonb_typeof(p_value->'portalVisible') is distinct from 'boolean' then raise exception 'VALIDATION_FAILED'; end if;
  select array_agg(distinct x::uuid order by x::uuid) into members from jsonb_array_elements_text(p_value->'members') x;
  if coalesce(cardinality(members),0) not between 1 and 50 or array_position(members,null) is not null
    or cardinality(members)<>jsonb_array_length(p_value->'members') then raise exception 'VALIDATION_FAILED'; end if;
  perform m.student_id from credit_internal.credit_household_members m join public.students s on s.id=m.student_id
    where m.household_id=household and m.student_id=any(members) and s.studio_id=studio and s.deleted_at is null
    order by m.student_id for share of m,s;
  if (select count(*) from credit_internal.credit_household_members m join public.students s on s.id=m.student_id
      where m.household_id=household and m.student_id=any(members) and s.studio_id=studio and s.deleted_at is null)<>cardinality(members)
    then raise exception 'FORBIDDEN' using errcode='42501'; end if;
  select * into definition from public.package_definitions
    where id=(p_value->>'definitionId')::uuid and studio_id=studio and active and allow_household_credits for share;
  select * into svc from public.booking_services where id=(p_value->>'serviceId')::uuid and studio_id=studio for share;
  if definition.id is null or svc.id is null
    or not coalesce(svc.id=any(definition.eligible_service_ids),false)
    or duration is distinct from definition.session_duration_minutes then
    raise exception 'INVALID_TRANSITION: Choose a service and duration approved for this shared credit type.';
  end if;
  if definition.expiration_days is not null
    and (expires is null or expires>now()+make_interval(days=>definition.expiration_days)) then
    raise exception 'VALIDATION_FAILED: Choose an expiration within the shared credit type terms.';
  end if;
  preview:=jsonb_build_object('householdId',household,'definitionId',definition.id,'definitionVersion',definition.version,
    'serviceId',svc.id,'serviceName',svc.name,'durationMinutes',duration,'quantity',qty,
    'expiresAt',expires,'members',members,'reason',reason_text,'portalVisible',p_value->'portalVisible');
  if p_action='discretionary_preview' then return jsonb_build_object('status','preview','canApply',true,'grantPreview',preview); end if;
  if p_value->'preview' is distinct from preview then raise exception 'VERSION_CONFLICT: Review the shared grant again.'; end if;
  insert into public.packages(household_id,definition_id,name,credit_quantity,expires_at,auto_apply)
    values(household,definition.id,svc.name||' shared discretionary credits',qty,expires,true) returning id into lot;
  update credit_internal.package_credit_terms set service_ids=array[svc.id],duration_minutes=duration where package_id=lot;
  insert into credit_internal.credit_pool_members(package_id,household_id,student_id)
    select lot,household,unnest(members);
  insert into public.package_credit_entries(package_id,kind,quantity,reason,idempotency_key,created_by)
    values(lot,'adjustment',qty,reason_text,request_key,actor) returning id into entry;
  if p_value->'portalVisible'='false'::jsonb then
    insert into credit_internal.hidden_portal_credit_entries(entry_id) values(entry);
  end if;
  insert into public.audit_events(studio_id,actor_id,action,entity_type,entity_id,reason,correlation_id,source,after_state)
    values(studio,actor,'credits.shared_discretionary_grant','package',lot,reason_text,request_key,'coach_portal',
      preview||jsonb_build_object('entryId',entry)) returning id into event_id;
  foreach member in array members loop
    perform credit_internal.enqueue_coverage(member);
  end loop;
  result:=jsonb_build_object('status','completed','packageId',lot,'entryId',entry,'auditEventId',event_id);
  insert into credit_internal.credit_command_receipts(key,student_id,actor_id,request,response)
    values(request_key,p_student,actor,p_value,result);
  return result;
end $$;
revoke all on function credit_internal.issue_shared_discretionary(uuid,text,jsonb) from public,anon;
grant execute on function credit_internal.issue_shared_discretionary(uuid,text,jsonb) to authenticated;

create or replace function public.household_credit_access(p_student uuid,p_action text,p_value jsonb default '{}'::jsonb)
returns jsonb language sql security invoker set search_path='' as $$
  select case
    when p_action in ('manual_draft_list','manual_draft_save','manual_draft_confirm')
      then credit_internal.manual_lesson_draft_command(p_student,p_action,p_value)
    when p_action in ('discretionary_preview','discretionary_apply') then credit_internal.issue_shared_discretionary(p_student,p_action,p_value)
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
  p_allocated jsonb,p_package uuid,p_automatic boolean
) returns uuid language sql stable set search_path='' as $$
  select p.id
  from (select id from public.packages where student_id=p_student union all
        select package_id from credit_internal.credit_pool_members where student_id=p_student) eligible
  join public.packages p on p.id=eligible.id
  where (p_package is null or p.id=p_package)
    and credit_internal.student_may_spend_pool(p.id,p_student)
    and (not p_automatic or p.auto_apply)
    and credit_internal.package_terms_match(p.id,p_studio,p_service,p_duration) is true
    and (p.expires_at is null or p.expires_at>greatest(now(),p_start))
    and public.package_credit_balance(p.id)>coalesce((p_allocated->>p.id::text)::integer,0)
  order by p.expires_at nulls last,p.household_id is not null,p.created_at,p.id limit 1
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
    and credit_internal.package_terms_match(p.id,p_studio,p_service,p_duration) is true
    and (p.expires_at is null or p.expires_at>greatest(now(),p_start))
    and public.package_credit_balance(p.id)>coalesce((p_allocated->>p.id::text)::integer,0)
  order by p.expires_at nulls last,p.household_id is not null,p.created_at,p.id limit 1
$$;

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
    if credit_internal.package_lesson_matches(pkg.id,l.id) is not true then
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
            and credit_internal.package_lesson_matches(p.id,l.id) is true
            and (p.expires_at is null or p.expires_at > greatest(now(), l.starts_at))
            and public.package_credit_balance(p.id) - coalesce((p_allocated->>p.id::text)::integer, 0) > 0) then
          reason := 'mixed_settings_review'; state := 'review_required';
        elsif exists(select 1 from public.packages p where p.student_id=p_student
          and (p_package is null or p.id=p_package)
          and (p.expires_at is null or p.expires_at>greatest(now(),l.starts_at))
          and public.package_credit_balance(p.id)>0
          and credit_internal.package_lesson_matches(p.id,l.id) is not true) then
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

create or replace function public.command_grant_student_credits(
  p_student uuid,p_key text,p_value jsonb,p_actor uuid default null
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  s public.students; pkg public.packages; entry public.package_credit_entries; prior credit_internal.credit_command_receipts;
  quantity integer:=(p_value->>'quantity')::integer; kind public.credit_entry_kind:=(p_value->>'kind')::public.credit_entry_kind;
  lid uuid:=(p_value->>'lessonId')::uuid; reason text:=trim(p_value->>'reason'); def public.package_definitions;
  result jsonb; coverage jsonb; audit_id uuid; request jsonb:=p_value;
  custom jsonb:=p_value->'customTerms'; svc public.booking_services;
  minutes integer; expires timestamptz; batch jsonb; review jsonb; batch_result jsonb; batch_key text;
begin
  select * into s from public.students where id=p_student and deleted_at is null for update;
  if s.id is null or (p_actor is not null and not exists(select 1 from public.memberships
    where user_id=p_actor and studio_id=s.studio_id and role='coach')) then raise exception 'FORBIDDEN'; end if;
  if p_key is null or length(p_key)<3 or length(p_key)>250 or quantity is null or quantity=0
    or abs(quantity)>100000 or kind is null or kind not in ('purchase','adjustment') or reason is null or length(reason)<3 then raise exception 'VALIDATION_FAILED'; end if;
  select * into prior from credit_internal.credit_command_receipts where key=p_key;
  if prior.key is not null then
    if prior.student_id<>p_student or prior.actor_id is distinct from p_actor or prior.request<>request then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
    return prior.response||jsonb_build_object('duplicate',true);
  end if;
  if lid is not null and not exists(select 1 from public.lessons where id=lid and student_id=s.id and studio_id=s.studio_id) then raise exception 'FORBIDDEN'; end if;
  perform credit_internal.lock_upcoming(p_student);
  -- Handle a pre-upgrade provider delivery key without granting it a second time.
  select * into entry from public.package_credit_entries where idempotency_key=p_key;
  if entry.id is not null then
    select * into pkg from public.packages where id=entry.package_id and student_id=s.id;
    if pkg.id is null or entry.quantity<>quantity or entry.kind<>kind or entry.lesson_id is distinct from lid
      or (p_value->>'packageId' is not null and pkg.id<>(p_value->>'packageId')::uuid) then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
  else
    if custom is not null then
      if p_actor is null or kind<>'adjustment' or quantity<1 or lid is not null
         or p_value ? 'packageId' or p_value ? 'package'
         or jsonb_typeof(custom) is distinct from 'object' then raise exception 'VALIDATION_FAILED'; end if;
      select * into svc from public.booking_services where id=(custom->>'serviceId')::uuid and studio_id=s.studio_id;
      minutes:=(custom->>'durationMinutes')::integer;
      expires:=(custom->>'expiresAt')::timestamptz;
      if svc.id is null or minutes is null or minutes not between 15 and 480
        or expires<=now() then raise exception 'VALIDATION_FAILED: Choose a studio service, a valid duration and a future expiration.'; end if;
      if custom->>'poolId' is not null then
        select p.* into pkg from public.packages p join credit_internal.credit_households h on h.id=p.household_id
          where p.id=(custom->>'poolId')::uuid and h.studio_id=s.studio_id
            and credit_internal.student_may_spend_pool(p.id,p_student) for update of p;
        if not found then raise exception 'FORBIDDEN'; end if;
        if pkg.expires_at is distinct from expires or not exists(
          select 1 from credit_internal.package_credit_terms t where t.package_id=pkg.id
            and t.service_ids=array[svc.id] and t.duration_minutes=minutes and t.issuance_entry_id is not null
        ) then raise exception 'VALIDATION_FAILED: The grant must match the shared pool service, duration and expiration.'; end if;
        batch_key:='shared-grant:'||md5(p_key);
        batch:=jsonb_build_object('rows',jsonb_build_array(jsonb_build_object(
          'studentId',p_student,'packageId',pkg.id,'delta',quantity)),
          'reason',reason,'portalVisible',coalesce(p_value->'portalVisible','true'::jsonb));
        review:=credit_internal.bulk_package_adjustment(p_student,'bulk_package_preview',batch,batch_key,p_actor);
        if review->>'canApply' is distinct from 'true' then raise exception 'INVALID_TRANSITION: Review the shared pool before granting credits.'; end if;
        batch_result:=credit_internal.bulk_package_adjustment(p_student,'bulk_package_apply',
          batch||jsonb_build_object('preview',review->'rows'),batch_key,p_actor);
        if batch_result->>'status' is distinct from 'completed' then raise exception 'VERSION_CONFLICT: Reopen the shared pool.'; end if;
        select * into strict entry from public.package_credit_entries where id=(batch_result#>>'{receipts,0,entryId}')::uuid;
        result:=jsonb_build_object('package',to_jsonb(pkg),'entry',to_jsonb(entry),
          'auditEventId',batch_result#>>'{receipts,0,auditEventId}','duplicate',false);
        insert into credit_internal.credit_command_receipts(key,student_id,actor_id,request,response)
          values(p_key,p_student,p_actor,request,result);
        return result;
      end if;
      insert into public.packages(student_id,name,expires_at,credit_quantity,auto_apply)
        values(s.id,svc.name||' discretionary credits',expires,quantity,
          coalesce((select auto_apply from public.student_credit_accounts where student_id=s.id),false))
        returning * into pkg;
      update credit_internal.package_credit_terms set service_ids=array[svc.id],duration_minutes=minutes
        where package_id=pkg.id;
    elsif p_value->>'packageId' is not null then
      select * into pkg from public.packages where id=(p_value->>'packageId')::uuid and student_id=s.id for update;
      if pkg.id is null then raise exception 'FORBIDDEN'; end if;
    elsif p_value->'package' is not null then
      select * into def from public.package_definitions where id=(p_value->'package'->>'definitionId')::uuid and studio_id=s.studio_id;
      if def.id is null or quantity<>def.session_count or quantity<=0 then raise exception 'VALIDATION_FAILED: Package changed; review the quote.'; end if;
      insert into public.packages(student_id,definition_id,name,price_minor,currency,expires_at,stripe_price_id,credit_quantity,auto_apply)
      values(s.id,def.id,p_value->'package'->>'name',(p_value->'package'->>'priceMinor')::bigint,
        p_value->'package'->>'currency',case when def.expiration_days is null then null else now()+make_interval(days=>def.expiration_days) end,
        p_value->'package'->>'stripePriceId',quantity,coalesce((select auto_apply from public.student_credit_accounts where student_id=s.id),false)) returning * into pkg;
    else
      if quantity>0 then raise exception 'VALIDATION_FAILED: Choose a defined credit type or enter service and duration.'; end if;
      select * into pkg from public.packages where student_id=s.id and name='Studio lesson credits' and expires_at is null order by created_at,id limit 1 for update;
      if pkg.id is null then insert into public.packages(student_id,name) values(s.id,'Studio lesson credits') returning * into pkg; end if;
    end if;
    if quantity<0 and ((public.student_credit_summary(s.id)->>'needsReview')::boolean or public.package_credit_balance(pkg.id)+quantity<0) then
      raise exception 'CREDIT_UNAVAILABLE: Reserved credits cannot be removed.';
    end if;
    insert into public.package_credit_entries(package_id,lesson_id,kind,quantity,reason,idempotency_key,created_by)
      values(pkg.id,lid,kind,quantity,reason,p_key,p_actor) returning * into entry;
  end if;
  if p_actor is not null and kind='adjustment' and p_value->'portalVisible'='false'::jsonb then
    insert into credit_internal.hidden_portal_credit_entries(entry_id) values(entry.id) on conflict do nothing;
  end if;
  coverage:=credit_internal.request_coverage(s.id);
  insert into public.audit_events(studio_id,actor_id,action,entity_type,entity_id,reason,correlation_id,source,after_state)
    values(s.studio_id,p_actor,case when p_value->'package' is not null then 'package.assigned' else 'credit.granted' end,
      'credit',entry.id,reason,p_key,case when p_actor is null then 'provider' else 'coach_portal' end,
      jsonb_build_object('entry',to_jsonb(entry),'coverage',coverage)) returning id into audit_id;
  result:=jsonb_build_object('package',to_jsonb(pkg),'entry',to_jsonb(entry),'coverage',coverage,'auditEventId',audit_id,'duplicate',false);
  insert into credit_internal.credit_command_receipts(key,student_id,actor_id,request,response) values(p_key,s.id,p_actor,request,result);
  return result;
end $$;

create or replace function public.set_student_credit_total(p_student uuid,p_target integer,p_version integer,p_reason text,p_key text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare summary jsonb; delta integer; lot record; take integer;
begin
  perform 1 from public.students where id=p_student for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if exists(select 1 from public.package_credit_entries where starts_with(idempotency_key,p_key||':')) then return credit_internal.request_coverage(p_student); end if;
  insert into public.student_credit_accounts(student_id) values(p_student) on conflict do nothing;
  summary:=public.student_credit_summary(p_student);
  if (summary->>'needsReview')::boolean then raise exception 'INVALID_TRANSITION: Review legacy credit reservations before changing the total.'; end if;
  if (summary->>'version')::integer<>p_version then raise exception 'VERSION_CONFLICT: Refresh the balance before editing.'; end if;
  if p_target<0 or p_target>100000 or p_target<(summary->>'reserved')::integer or length(trim(p_reason))<3 then
    raise exception 'VALIDATION_FAILED: Total must include reserved credits and a reason.';
  end if;
  delta:=p_target-(summary->>'remaining')::integer;
  perform credit_internal.lock_upcoming(p_student);
  if delta>0 then
    raise exception 'VALIDATION_FAILED: Choose the exact package or create a typed discretionary grant to add credits.';
  elsif delta<0 then
    for lot in select p.id,public.package_credit_balance(p.id) balance from public.packages p
      where p.student_id=p_student and (p.expires_at is null or p.expires_at>now())
      order by p.expires_at desc nulls first,p.created_at desc,p.id for update
    loop
      take:=least(-delta,greatest(0,lot.balance));
      if take>0 then
        insert into public.package_credit_entries(package_id,kind,quantity,reason,idempotency_key) values(lot.id,'adjustment',-take,p_reason,p_key||':'||lot.id::text);
        delta:=delta+take;
      end if;
      exit when delta=0;
    end loop;
    if delta<>0 then raise exception 'CREDIT_UNAVAILABLE'; end if;
  end if;
  return credit_internal.request_coverage(p_student);
end $$;

create or replace function public.settle_lesson_credits(p_lesson uuid,p_use boolean,p_student uuid default null) returns void
language plpgsql security definer set search_path='' as $$
declare lot record; restored uuid; quantity integer;
begin
  if p_use then
    perform credit_internal.settle_shared_credit(p_lesson,true,p_student);
    return;
  end if;
  perform 1 from public.students where id in(select p.student_id from public.packages p join public.package_credit_entries e on e.package_id=p.id where e.lesson_id=p_lesson and (p_student is null or p.student_id=p_student)) order by id for update;
  perform p.id from public.packages p where exists(select 1 from public.package_credit_entries e
    where e.package_id=p.id and e.lesson_id=p_lesson
      and (p_student is null or coalesce(e.used_by_student_id,p.student_id)=p_student))
    order by p.id for update;
  for lot in select p.id,p.student_id,p.expires_at from public.packages p
    where p.household_id is null and (p_student is null or p.student_id=p_student) and exists(select 1 from public.package_credit_entries e where e.lesson_id=p_lesson and e.package_id=p.id)
    order by p.student_id,p.id for update
  loop
    perform 1 from public.students where id=lot.student_id for update;
    select greatest(0,-coalesce(sum(e.quantity),0))::integer into quantity from public.package_credit_entries e where e.lesson_id=p_lesson and e.package_id=lot.id;
    if quantity=0 then continue; end if;
    insert into public.package_credit_entries(package_id,lesson_id,kind,quantity,reason)
      values(lot.id,p_lesson,'release',quantity,'Credit returned after cancellation');
    if lot.expires_at is not null and lot.expires_at<=now() and exists(select 1 from credit_internal.package_credit_terms t where t.package_id=lot.id and t.duration_minutes is not null and cardinality(t.service_ids)>0) then
      insert into public.package_credit_entries(package_id,kind,quantity,reason) values(lot.id,'adjustment',-quantity,'Returned credit transferred to 30-day balance');
      insert into public.packages(student_id,name,expires_at,transferred_from_package_id) values(lot.student_id,'Returned lesson credits',now()+interval '30 days',lot.id) returning id into restored;
      insert into public.package_credit_entries(package_id,kind,quantity,reason) values(restored,'adjustment',quantity,'Cancelled lesson credit available for 30 days');
    end if;
  end loop;
  perform credit_internal.settle_shared_credit(p_lesson,false,p_student);
end $$;
-- Positive coach adjustments are issuance unless linked to an original debit.
-- Historical entries and compensating corrections retain their original evidence.
create function credit_internal.require_typed_discretionary_credit()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if not exists(select 1 from public.packages p
      left join credit_internal.package_credit_terms t on t.package_id=p.id
      left join public.package_definitions d on d.id=p.definition_id and t.package_id is null
      where p.id=new.package_id and ((t.duration_minutes>0 and cardinality(t.service_ids)>0)
        or (t.package_id is null and d.session_duration_minutes>0 and cardinality(d.eligible_service_ids)>0))) then
    raise exception 'VALIDATION_FAILED: Choose a credit lot with a verified service and duration.';
  end if;
  return new;
end $$;
revoke all on function credit_internal.require_typed_discretionary_credit() from public,anon,authenticated;
create trigger require_typed_discretionary_credit before insert on public.package_credit_entries
  for each row when (new.kind='adjustment' and new.quantity>0 and new.created_by is not null and new.reverses_entry_id is null)
  execute function credit_internal.require_typed_discretionary_credit();

create or replace function credit_internal.credit_lesson_billing_route(p_student uuid,p_lesson uuid)
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
  if coalesce(evaluation->>'reasonCode','') not in ('no_available_credits','expires_before_lesson')
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
 if not historical and arrangement is null then
  raise exception 'VALIDATION_FAILED: Choose a billing arrangement before confirming the lesson.';
 end if;
 if arrangement is not null then
  if historical or arrangement not in ('credits','pay_later','custom','credit_exception')
    or svc.duration_minutes is distinct from (p_value->>'duration_minutes')::integer
    or char_length(trim(coalesce(p_value->>'reason','')))<3 then
     raise exception 'VALIDATION_FAILED: Review the service, duration, date and billing arrangement.';
  end if;
  credit_payment:=arrangement in ('credits','credit_exception');
  if credit_payment and not ('credits'=any(svc.payment_policies)) then
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
