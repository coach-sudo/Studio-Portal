
-- A coach series groups lessons. Each occurrence keeps its own booking and financial
-- obligation. bookings.series_id remains reserved for aggregate booking contracts.
create function public.manual_booking_series_plan(p_value jsonb) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare
  student public.students;
  svc public.booking_services;
  cadence text:=p_value->>'recurrence';
  total integer;
  first_start timestamptz;
  first_wall timestamp;
  wall timestamp;
  starts timestamptz;
  tz text;
  dates jsonb:='[]';
begin
  select * into student from public.students
    where id=(p_value->>'student_id')::uuid and deleted_at is null;
  if auth.uid() is null or student.id is null or not public.is_studio_coach(student.studio_id) then
    raise exception 'FORBIDDEN' using errcode='42501';
  end if;
  select * into svc from public.booking_services
    where id=(p_value->>'service_id')::uuid and studio_id=student.studio_id;
  if svc.id is null or svc.category<>'private' or cadence is null
    or cadence not in ('weekly','biweekly') or not cadence=any(svc.recurrence_options) then
    raise exception 'VALIDATION_FAILED: Choose a private service that supports this repeat schedule.';
  end if;
  if (p_value->>'service_version') is distinct from svc.version::text then
    raise exception 'VERSION_CONFLICT: The booking service changed. Review its current duration and pricing before retrying.';
  end if;
  if coalesce(p_value->>'occurrence_count','') !~ '^[0-9]{1,2}$' then
    raise exception 'VALIDATION_FAILED: Choose 2 to 52 lessons, including the first.';
  end if;
  total:=(p_value->>'occurrence_count')::integer;
  if total not between 2 and 52 or coalesce((p_value->>'historical')::boolean,false)
    or coalesce((p_value->>'mark_paid')::boolean,false) then
    raise exception 'VALIDATION_FAILED: Schedule 2 to 52 future lessons without recording payments.';
  end if;
  tz:=nullif(p_value->>'timezone','');
  if tz is null or not exists(select 1 from pg_timezone_names where name=tz)
    or coalesce(p_value->>'starts_at','') !~ '(Z|[+-][0-9]{2}:[0-9]{2})$' then
    raise exception 'VALIDATION_FAILED: Choose a valid start and scheduling timezone.';
  end if;
  first_start:=(p_value->>'starts_at')::timestamptz;
  if not isfinite(first_start) or first_start<=now() then
    raise exception 'VALIDATION_FAILED: Choose a future first occurrence.';
  end if;
  first_wall:=first_start at time zone tz;
  for i in 0..total-1 loop
    wall:=first_wall+make_interval(days=>i*case when cadence='weekly' then 7 else 14 end);
    -- Honor the explicit instant selected for the first occurrence. For later
    -- occurrences PostgreSQL resolves repeated hours to standard time.
    starts:=case when i=0 then first_start else wall at time zone tz end;
    if starts at time zone tz <> wall then
      raise exception 'VALIDATION_FAILED: Occurrence % falls in a skipped daylight-saving hour. Choose another time.',i+1;
    end if;
    dates:=dates||jsonb_build_array(jsonb_build_object(
      'start',starts,'end',starts+make_interval(mins=>svc.duration_minutes)));
  end loop;
  return dates;
end $$;
revoke all on function public.manual_booking_series_plan(jsonb) from public,anon,service_role;
grant execute on function public.manual_booking_series_plan(jsonb) to authenticated;


create function workspace_internal.create_manual_booking_occurrence(studio uuid, actor uuid,p_key text,p_value jsonb,p_external_status text,p_series uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare student public.students; svc public.booking_services; pricing public.student_pricing_rules;
 b public.bookings; l public.lessons; audit_id uuid; result jsonb;
 starts timestamptz:=(p_value->>'starts_at')::timestamptz; ends timestamptz; tz text; meeting text; token text;
 total bigint; paid bigint; upcharge bigint; coverage jsonb; reason text;
 historical boolean; outcome text:='scheduled'; treatment text;
begin
 select * into student from public.students where id=(p_value->>'student_id')::uuid and studio_id=studio and deleted_at is null for update;
 if not found then raise exception 'VALIDATION_FAILED: Student is unavailable.'; end if;
 select * into svc from public.booking_services where id=(p_value->>'service_id')::uuid and studio_id=studio for share;
 if not found then raise exception 'VALIDATION_FAILED: Choose a studio service.'; end if;
 ends:=starts+make_interval(mins=>svc.duration_minutes);
 meeting:=coalesce(nullif(p_value->>'location',''),svc.default_location);
 select coalesce(nullif(p_value->>'timezone',''),nullif(s.timezone,'')) into tz from public.studios s where id=studio;
 if starts is null or p_value->>'starts_at' !~ '(Z|[+-][0-9]{2}:[0-9]{2})$' or not isfinite(starts) or not isfinite(ends) or ends<=starts or not meeting=any(svc.location_options) or tz is null or not exists(select 1 from pg_timezone_names where name=tz) then raise exception 'VALIDATION_FAILED: Choose a valid time, timezone and meeting format.'; end if;
 historical:=starts<=now();
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
 total:=case when historical and treatment='record_only' then 0 else coalesce((p_value->>'price_minor')::bigint,coalesce(pricing.price_minor,svc.price_minor)+upcharge) end;
 if total is null or total<0 then raise exception 'VALIDATION_FAILED: Choose a nonnegative whole-minor-unit price.'; end if;
 paid:=case when (historical and treatment='payment_received') or (not historical and coalesce((p_value->>'mark_paid')::boolean,false)) then total else 0 end;
 reason:=coalesce(nullif(trim(p_value->>'reason'),''),'Coach created a manual booking');
 token:=encode(extensions.gen_random_bytes(32),'hex');
 insert into public.bookings(studio_id,reference,service_id,student_id,guest_name,guest_email,guardian_name,guardian_email,for_minor,starts_at,ends_at,timezone,location,status,payment_policy,payment_status,total_minor,paid_minor,currency,policy_snapshot,pricing_snapshot,admin_override,manage_token_hash)
 values(studio,'SS-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,16)),svc.id,student.id,student.full_name,coalesce(student.email,student.guardian_email,''),student.guardian_name,student.guardian_email,student.is_minor,
 starts,ends,tz,meeting,case when outcome='cancelled' then 'cancelled' when outcome in ('completed','no_show') then 'completed' else 'confirmed' end,'pay_later',case when total=0 then 'not_required' else 'due' end,total,0,svc.currency,svc.policy||jsonb_build_object('policyVersion',svc.policy_version),
 jsonb_build_object('basePriceMinor',svc.price_minor,'locationUpchargeMinor',upcharge,'unitPriceMinor',total,'studentPricingRuleId',pricing.id,'adminOverride',true),
 jsonb_build_object('schedule',true,'price',p_value?'price_minor','createdByCoach',true,'externalCalendarCheck',p_external_status),encode(extensions.digest(token,'sha256'),'hex')) returning * into b;
 insert into public.lessons(studio_id,student_id,topic,starts_at,ends_at,status,location_type,location_label,service_id,meeting_provider,capacity,source_provider,series_id)
 values(studio,student.id,svc.name,starts,ends,outcome::public.lesson_status,case when meeting='in_person' then 'in_person' else 'virtual' end,
 case when meeting='in_person' then coalesce(nullif(p_value->>'location_label',''),'Location to be confirmed') else 'Google Meet pending' end,svc.id,meeting,1,'studio',p_series) returning * into l;
 insert into public.lesson_participants(lesson_id,booking_id,student_id,display_name,email,status)
 values(l.id,b.id,student.id,student.full_name,coalesce(student.email,student.guardian_email,''),case when outcome='completed' then 'attended' when outcome='no_show' then 'no_show' when outcome='cancelled' then 'cancelled' else 'confirmed' end);
 if paid>0 then
  insert into public.payment_entries(student_id,kind,amount_minor,currency,external_reference,reason) values(student.id,'payment',paid,svc.currency,'manual:'||b.id::text,reason);
  update public.bookings set paid_minor=paid,payment_status='paid' where id=b.id returning * into b;
 end if;
 -- Coverage sees the linked booking's committed-within-command financial state.
 if historical then coverage:=jsonb_build_object('historical',true,'automaticCoverage',false); else coverage:=public.reserve_student_upcoming_credits(student.id); end if;
 if starts>now() then
  insert into public.calendar_projections(lesson_id,status) values(l.id,'queued');
  insert into workspace_internal.manual_booking_effects(booking_id,lesson_id,manage_token) values(b.id,l.id,token);
 end if;
 insert into public.audit_events(studio_id,actor_id,entity_type,entity_id,action,reason,correlation_id,source,after_state)
 values(studio,actor,'booking',b.id,'booking.created_by_coach',reason,p_key,'booking_admin',jsonb_build_object('booking',to_jsonb(b)-'manage_token_hash','lessonId',l.id,'externalCalendarCheck',p_external_status,'historical',historical,'historicalOutcome',outcome,'financialTreatment',treatment,'attendanceConfirmed',coalesce((p_value->>'attendance_confirmed')::boolean,false),'recordedAt',b.created_at)) returning id into audit_id;
 result:=jsonb_build_object('resource',to_jsonb(b)-'manage_token_hash','lessonId',l.id,'auditEventId',audit_id,'creditCoverage',coverage,'manageUrl','/booking/'||token,'sideEffects',case when starts>now() then 'pending' else 'suppressed_historical' end);
 return result;
end $$;

revoke all on function workspace_internal.create_manual_booking_occurrence(uuid,uuid,text,jsonb,text,uuid) from public,anon,authenticated,service_role;

create or replace function public.command_create_manual_booking(
  p_key text,p_value jsonb,p_external_status text default 'not_checked'
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  actor uuid:=auth.uid();
  studio uuid;
  student_id uuid:=(p_value->>'student_id')::uuid;
  svc public.booking_services;
  prior jsonb;
  result jsonb;
  created jsonb;
  dates jsonb;
  occurrence jsonb;
  identities jsonb:='[]';
  series uuid;
  cadence text:=p_value->>'recurrence';
  tz text:=p_value->>'timezone';
  ordinal integer:=0;
begin
  if actor is null then raise exception 'FORBIDDEN' using errcode='42501'; end if;
  if p_key is null or length(p_key)<8 or length(p_key)>200 then
    raise exception 'VALIDATION_FAILED: A stable request key is required.';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(actor::text||':manual:'||p_key,0));
  prior:=public.manual_booking_replay(p_key,p_value);
  if prior is not null then return prior; end if;
  select studio_id into studio from public.students where id=student_id and deleted_at is null;
  if studio is null or not public.is_studio_coach(studio) then
    raise exception 'FORBIDDEN' using errcode='42501';
  end if;
  -- Serialize against public holds/confirmation and reviewed occurrence changes.
  -- Match the legacy lesson creator's student-before-calendar lock order.
  perform pg_advisory_xact_lock(hashtext(studio::text));
  perform 1 from public.students where id=student_id and studio_id=studio and deleted_at is null for update;
  if not found then raise exception 'FORBIDDEN' using errcode='42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended(studio::text||':calendar',0));

  if cadence is null or cadence='none' then
    result:=workspace_internal.create_manual_booking_occurrence(studio,actor,p_key,p_value,p_external_status,null);
  else
    select * into svc from public.booking_services
      where id=(p_value->>'service_id')::uuid and studio_id=studio for share;
    dates:=public.manual_booking_series_plan(p_value);
    if exists (
      select 1 from jsonb_array_elements(dates) d
      join public.booking_holds h on h.studio_id=studio and h.offering_id is null
        and h.status='active' and h.expires_at>now()
        and h.starts_at<(d->>'end')::timestamptz and h.ends_at>(d->>'start')::timestamptz
    ) then
      raise exception 'SLOT_UNAVAILABLE: A booking is holding one of these times. Review the dates and retry.';
    end if;
    insert into public.recurring_series(studio_id,service_id,student_id,kind,cadence,starts_on,ends_on,
      occurrence_count,payment_policy,recurrence_rule,meeting_provider)
    values(studio,svc.id,student_id,'fixed',cadence,(dates->0->>'start')::timestamptz,
      (dates->-1->>'end')::timestamptz,jsonb_array_length(dates),'pay_later',
      jsonb_build_object('bookingMode','per_occurrence','intervalWeeks',case when cadence='weekly' then 1 else 2 end,
        'slots',jsonb_build_array(jsonb_build_object(
          'weekday',extract(dow from ((dates->0->>'start')::timestamptz at time zone tz)),
          'time',to_char((dates->0->>'start')::timestamptz at time zone tz,'HH24:MI')))),
      coalesce(nullif(p_value->>'location',''),svc.default_location))
    returning id into series;
    for occurrence in select value from jsonb_array_elements(dates) loop
      ordinal:=ordinal+1;
      begin
        created:=workspace_internal.create_manual_booking_occurrence(
          studio,actor,p_key,p_value||jsonb_build_object('starts_at',occurrence->>'start'),
          p_external_status,series);
      exception when raise_exception then
        if sqlerrm like 'SLOT_UNAVAILABLE:%' then
          raise exception 'SLOT_UNAVAILABLE: Occurrence % (%) overlaps a studio lesson. No lessons were scheduled.',
            ordinal,to_char((occurrence->>'start')::timestamptz at time zone tz,'YYYY-MM-DD HH24:MI');
        end if;
        raise;
      end;
      if ordinal=1 then result:=created; end if;
      identities:=identities||jsonb_build_array(jsonb_build_object(
        'bookingId',created->'resource'->'id','lessonId',created->'lessonId','startsAt',occurrence->'start'));
    end loop;
    result:=result||jsonb_build_object('seriesId',series,'occurrences',identities);
  end if;
  insert into workspace_internal.manual_booking_receipts(actor_id,key,studio_id,request_hash,result)
    values(actor,p_key,studio,encode(extensions.digest(p_value::text,'sha256'),'hex'),result);
  return result;
end $$;


-- Keep invoice-free and recorded payment eligibility for verified per-occurrence bookings.
create or replace function lesson_ops.payment_context(p_actor uuid,p_lesson uuid,p_direct boolean,p_attempt uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare l public.lessons; b public.bookings; participant public.lesson_participants; reason text; money_currency text; count_participants bigint; paid bigint; result jsonb;
begin
 select * into l from public.lessons where id=p_lesson;
  if p_actor is null or l.id is null or
   (not p_direct and not exists(select 1 from public.memberships where user_id=p_actor and studio_id=l.studio_id and role='coach')) or
   (p_direct and p_attempt is null and not training_internal.is_lesson_payer(p_actor,l.student_id)) or
   (p_direct and p_attempt is not null and l.direct_checkout_id is distinct from p_attempt)
 then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 select count(*) into count_participants from public.lesson_participants where lesson_id=l.id;
 if count_participants=1 then select * into participant from public.lesson_participants where lesson_id=l.id; end if;
 if participant.booking_id is not null then select * into b from public.bookings where id=participant.booking_id; end if;
 select coalesce(sum(r.amount_minor),0) into paid from lesson_ops.payment_receipts r join public.payment_entries e on e.id=r.payment_entry_id and e.student_id=r.student_id and e.kind='payment' and e.amount_minor=r.amount_minor and e.currency=r.currency where r.lesson_id=l.id;
 select coalesce(nullif(b.currency,''),nullif(s.settings->>'currency','')) into money_currency from public.studios s where s.id=l.studio_id;
 if not exists(select 1 from public.students where id=l.student_id and studio_id=l.studio_id and deleted_at is null) then reason:='student_unavailable';
 elsif l.invoice_id is not null or exists(select 1 from public.studio_invoices i where i.status<>'void' and exists(select 1 from jsonb_array_elements(i.items) item where item->'lessonIds' @> to_jsonb(array[l.id::text]))) then reason:='use_invoice';
 elsif l.invoice_payment_pending and p_attempt is null then reason:='checkout_pending';
  elsif p_direct and (l.source_provider is distinct from 'studio' or l.payment_needs_review or l.service_id is null) then reason:='price_or_status_review';
 elsif l.status not in ('scheduled','completed') then reason:='outcome_review';
 elsif coalesce(l.capacity,1)>1 or l.offering_id is not null or (l.series_id is not null and not (
   b.id is not null and b.series_id is null and b.service_id=l.service_id
   and b.admin_override->'createdByCoach' is not distinct from 'true'::jsonb
   and exists(select 1 from public.recurring_series s where s.id=l.series_id
     and s.studio_id=l.studio_id and s.student_id=l.student_id and s.service_id=l.service_id
     and s.kind='fixed' and s.recurrence_rule->>'bookingMode'='per_occurrence')
 )) or count_participants>1 or (count_participants=1 and participant.student_id is distinct from l.student_id) then reason:='allocation_review';
 elsif l.package_id is not null or exists(select 1 from public.package_credit_entries where lesson_id=l.id) then reason:='credit_review';
 elsif p_direct and p_attempt is null and exists(
   select 1 from credit_internal.package_beneficiaries member join public.packages p on p.id=member.package_id
   where credit_internal.package_covers_student(p.id,p.student_id,l.student_id)
     and credit_internal.package_matches_issued_terms(p.id,l.service_id,l.ends_at-l.starts_at) is true
     and (p.expires_at is null or p.expires_at>greatest(now(),l.starts_at))
     and public.package_credit_balance(p.id)>0
 ) and ((credit_internal.evaluate_student_lesson_credit(l.student_id,l.id,'automatic')->>'eligible')::boolean
   or credit_internal.evaluate_student_lesson_credit(l.student_id,l.id,'manual')->>'state'='review_required')
 then reason:='credit_review';
 elsif exists(select 1 from lesson_ops.datetime_corrections c where c.lesson_id=l.id and c.financial_review_required and not exists(select 1 from lesson_ops.datetime_correction_reviews r where r.correction_id=c.id and r.kind='financial')) then reason:='correction_review';
 elsif b.id is not null and (b.studio_id<>l.studio_id or b.student_id is distinct from l.student_id or b.series_id is not null or b.offering_id is not null or b.status not in ('confirmed','completed') or exists(select 1 from public.lesson_participants where booking_id=b.id and lesson_id<>l.id)) then reason:='allocation_review';
 elsif b.id is not null and (b.payment_policy<>'pay_later' or b.stripe_checkout_session_id is not null or b.stripe_subscription_id is not null or b.payment_status in ('processing','refunded','past_due','failed')) then reason:='provider_review';
 elsif p_direct and b.id is not null and (
   b.admin_override->'createdByCoach' is distinct from 'true'::jsonb
   or b.service_id is distinct from l.service_id
   or b.auto_charge_balance or b.payment_status not in ('due','partially_paid')
   or participant.status not in ('confirmed','attended')) then reason:='provider_review';
 elsif p_direct and not exists(select 1 from public.booking_services svc where svc.id=l.service_id
   and svc.studio_id=l.studio_id and svc.currency=money_currency) then reason:='price_or_status_review';
 elsif money_currency is null or money_currency!~'^[A-Z]{3}$' then reason:='currency_review';
 elsif l.price_minor is null or l.price_minor<=0 or l.price_minor>9007199254740991 or l.payment_status not in ('due','partially_paid') then reason:='price_or_status_review';
 elsif exists(select 1 from lesson_ops.payment_receipts r left join public.payment_entries e on e.id=r.payment_entry_id and e.student_id=r.student_id and e.kind='payment' and e.amount_minor=r.amount_minor and e.currency=r.currency where r.lesson_id=l.id and (e.id is null or r.student_id<>l.student_id or r.studio_id<>l.studio_id or r.currency is distinct from money_currency)) then reason:='historical_totals_review';
 elsif coalesce(l.paid_minor,0)<>paid or (b.id is not null and (b.paid_minor<>paid or b.total_minor is distinct from l.price_minor)) then reason:='historical_totals_review';
 elsif paid>=l.price_minor then reason:='no_balance';
 end if;
 result:=jsonb_build_object('lessonId',l.id,'version',l.version,'studentId',l.student_id,'participantId',participant.id,'bookingId',b.id,'bookingVersion',b.version,'currency',money_currency,'priceMinor',l.price_minor,'paidMinor',coalesce(l.paid_minor,0),'remainingMinor',greatest(0,coalesce(l.price_minor,0)-coalesce(l.paid_minor,0)),'eligible',reason is null,'reasonCode',reason);
 return result||jsonb_build_object('reviewToken',encode(extensions.digest(jsonb_build_object('actor',p_actor,'context',result)::text,'sha256'),'hex'));
end $$;
