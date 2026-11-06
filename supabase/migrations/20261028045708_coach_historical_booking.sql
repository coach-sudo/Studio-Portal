-- Additive replacement of the new command; no existing history is rewritten.
create or replace function public.command_create_manual_booking(p_key text,p_value jsonb,p_external_status text default 'not_checked') returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); student public.students; svc public.booking_services; pricing public.student_pricing_rules;
 b public.bookings; l public.lessons; audit_id uuid; result jsonb; prior jsonb; studio uuid;
 starts timestamptz:=(p_value->>'starts_at')::timestamptz; ends timestamptz; tz text; meeting text; token text;
 total bigint; paid bigint; upcharge bigint; coverage jsonb; reason text;
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
 if historical then coverage:=jsonb_build_object('historical',true,'automaticCoverage',false); else coverage:=public.reserve_student_upcoming_credits(student.id); end if;
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
