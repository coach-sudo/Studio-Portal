-- One authoritative coach command. Business history is never compensated away
-- because a provider projection or notification is unavailable.
create table workspace_internal.manual_booking_receipts (
 actor_id uuid not null, key text not null, studio_id uuid not null references public.studios(id),
 request_hash text not null, result jsonb not null, created_at timestamptz not null default now(), primary key(actor_id,key)
);
create table workspace_internal.manual_booking_effects (
 id uuid primary key default gen_random_uuid(), booking_id uuid not null unique references public.bookings(id) on delete restrict,
 lesson_id uuid not null references public.lessons(id) on delete restrict, manage_token text not null,
 status text not null default 'queued' check(status in ('queued','processing','failed','completed','superseded')),
 attempts integer not null default 0, claim_token uuid, claim_until timestamptz,
 next_attempt_at timestamptz not null default now(), last_error text, created_at timestamptz not null default now()
);
alter table workspace_internal.manual_booking_receipts enable row level security;
alter table workspace_internal.manual_booking_effects enable row level security;
revoke all on workspace_internal.manual_booking_receipts,workspace_internal.manual_booking_effects from public,anon,authenticated,service_role;
create index manual_booking_effects_due on workspace_internal.manual_booking_effects(next_attempt_at,id) where status in ('queued','failed','processing');
create index manual_booking_effects_lesson on workspace_internal.manual_booking_effects(lesson_id);

create function public.manual_booking_replay(p_key text,p_value jsonb) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare prior workspace_internal.manual_booking_receipts; actor uuid:=auth.uid();
begin
 if actor is null then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 select * into prior from workspace_internal.manual_booking_receipts where actor_id=actor and key=p_key;
 if not found then return null; end if;
 if not public.is_studio_coach(prior.studio_id) then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if prior.request_hash<>encode(extensions.digest(p_value::text,'sha256'),'hex') then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
 return prior.result;
end $$;

create function public.command_create_manual_booking(p_key text,p_value jsonb,p_external_status text default 'not_checked') returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); student public.students; svc public.booking_services; pricing public.student_pricing_rules;
 b public.bookings; l public.lessons; audit_id uuid; result jsonb; prior jsonb; studio uuid;
 starts timestamptz:=(p_value->>'starts_at')::timestamptz; ends timestamptz; tz text; meeting text; token text;
 total bigint; paid bigint; upcharge bigint; coverage jsonb; reason text;
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
 if p_external_status not in ('checked','not_configured','overridden','not_checked') then raise exception 'VALIDATION_FAILED'; end if;
 if exists(select 1 from public.lessons where studio_id=studio and status in ('draft','scheduled') and starts_at<ends and ends_at>starts) then raise exception 'SLOT_UNAVAILABLE: Studio lessons cannot overlap.'; end if;
 if student.special_pricing_enabled then
  select * into pricing from public.student_pricing_rules where student_id=student.id and service_id=svc.id and active and starts_at<=starts and (ends_at is null or ends_at>=starts) order by updated_at desc,id limit 1;
 end if;
 upcharge:=coalesce((pricing.location_price_adjustments->>meeting)::bigint,(svc.location_price_adjustments->>meeting)::bigint,0);
 total:=coalesce((p_value->>'price_minor')::bigint,coalesce(pricing.price_minor,svc.price_minor)+upcharge);
 if total is null or total<0 then raise exception 'VALIDATION_FAILED: Choose a nonnegative whole-minor-unit price.'; end if;
 paid:=case when coalesce((p_value->>'mark_paid')::boolean,false) then total else 0 end;
 reason:=coalesce(nullif(trim(p_value->>'reason'),''),'Coach created a manual booking');
 token:=encode(extensions.gen_random_bytes(32),'hex');
 insert into public.bookings(studio_id,reference,service_id,student_id,guest_name,guest_email,guardian_name,guardian_email,for_minor,starts_at,ends_at,timezone,location,status,payment_policy,payment_status,total_minor,paid_minor,currency,policy_snapshot,pricing_snapshot,admin_override,manage_token_hash)
 values(studio,'SS-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,16)),svc.id,student.id,student.full_name,coalesce(student.email,student.guardian_email,''),student.guardian_name,student.guardian_email,student.is_minor,
 starts,ends,tz,meeting,'confirmed','pay_later',case when total=0 then 'not_required' else 'due' end,total,0,svc.currency,svc.policy||jsonb_build_object('policyVersion',svc.policy_version),
 jsonb_build_object('basePriceMinor',svc.price_minor,'locationUpchargeMinor',upcharge,'unitPriceMinor',total,'studentPricingRuleId',pricing.id,'adminOverride',true),
 jsonb_build_object('schedule',true,'price',p_value?'price_minor','createdByCoach',true,'externalCalendarCheck',p_external_status),encode(extensions.digest(token,'sha256'),'hex')) returning * into b;
 insert into public.lessons(studio_id,student_id,topic,starts_at,ends_at,status,location_type,location_label,service_id,meeting_provider,capacity,source_provider)
 values(studio,student.id,svc.name,starts,ends,'scheduled',case when meeting='in_person' then 'in_person' else 'virtual' end,
 case when meeting='in_person' then coalesce(nullif(p_value->>'location_label',''),'Location to be confirmed') else 'Google Meet pending' end,svc.id,meeting,1,'studio') returning * into l;
 insert into public.lesson_participants(lesson_id,booking_id,student_id,display_name,email,status)
 values(l.id,b.id,student.id,student.full_name,coalesce(student.email,student.guardian_email,''),'confirmed');
 if paid>0 then
  insert into public.payment_entries(student_id,kind,amount_minor,currency,external_reference,reason) values(student.id,'payment',paid,svc.currency,'manual:'||b.id::text,reason);
  update public.bookings set paid_minor=paid,payment_status='paid' where id=b.id returning * into b;
 end if;
 -- Coverage sees the linked booking's committed-within-command financial state.
 coverage:=public.reserve_student_upcoming_credits(student.id);
 if starts>now() then
  insert into public.calendar_projections(lesson_id,status) values(l.id,'queued');
  insert into workspace_internal.manual_booking_effects(booking_id,lesson_id,manage_token) values(b.id,l.id,token);
 end if;
 insert into public.audit_events(studio_id,actor_id,entity_type,entity_id,action,reason,correlation_id,source,after_state)
 values(studio,actor,'booking',b.id,'booking.created_by_coach',reason,p_key,'booking_admin',jsonb_build_object('booking',to_jsonb(b)-'manage_token_hash','lessonId',l.id,'externalCalendarCheck',p_external_status,'historical',starts<=now())) returning id into audit_id;
 result:=jsonb_build_object('resource',to_jsonb(b)-'manage_token_hash','lessonId',l.id,'auditEventId',audit_id,'creditCoverage',coverage,'manageUrl','/booking/'||token,'sideEffects',case when starts>now() then 'pending' else 'suppressed_historical' end);
 insert into workspace_internal.manual_booking_receipts(actor_id,key,studio_id,request_hash,result) values(actor,p_key,studio,encode(extensions.digest(p_value::text,'sha256'),'hex'),result);
 return result;
end $$;
revoke all on function public.manual_booking_replay(text,jsonb),public.command_create_manual_booking(text,jsonb,text) from public,anon,service_role;
grant execute on function public.manual_booking_replay(text,jsonb),public.command_create_manual_booking(text,jsonb,text) to authenticated;

create function public.claim_manual_booking_effects(p_limit integer default 10) returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 if p_limit not between 1 and 25 then raise exception 'VALIDATION_FAILED'; end if;
 with wanted as(select id from workspace_internal.manual_booking_effects where status in ('queued','failed','processing') and next_attempt_at<=now() and (claim_until is null or claim_until<=now()) order by next_attempt_at,id for update skip locked limit p_limit), claimed as(
 update workspace_internal.manual_booking_effects e set status='processing',claim_token=gen_random_uuid(),claim_until=now()+interval '20 minutes',attempts=attempts+1 where e.id in(select id from wanted) returning e.*)
 select coalesce(jsonb_agg(to_jsonb(c)),'[]'::jsonb) into result from claimed c;
 return result;
end $$;
create function public.manual_booking_effect_current(p_id uuid,p_token uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from workspace_internal.manual_booking_effects e join public.bookings b on b.id=e.booking_id join public.lessons l on l.id=e.lesson_id
 where e.id=p_id and e.claim_token=p_token and e.status='processing' and e.claim_until>now() and b.status='confirmed' and l.status='scheduled' and l.starts_at=b.starts_at and l.ends_at=b.ends_at and l.starts_at>now());
$$;
create function public.finish_manual_booking_effect(p_id uuid,p_token uuid,p_failed boolean default false) returns boolean
language plpgsql security definer set search_path='' as $$
declare affected integer;
begin
 update workspace_internal.manual_booking_effects e set status=case when not public.manual_booking_effect_current(p_id,p_token) then 'superseded' when p_failed then 'failed' else 'completed' end,
 last_error=case when p_failed then 'notification_queue_failed' end,manage_token=case when not p_failed then '' else manage_token end,
 next_attempt_at=now()+interval '1 minute',claim_token=null,claim_until=null
 where id=p_id and claim_token=p_token and status='processing' and claim_until>now();
 get diagnostics affected=row_count; return affected=1;
end $$;
revoke all on function public.claim_manual_booking_effects(integer),public.manual_booking_effect_current(uuid,uuid),public.finish_manual_booking_effect(uuid,uuid,boolean) from public,anon,authenticated;
grant execute on function public.claim_manual_booking_effects(integer),public.manual_booking_effect_current(uuid,uuid),public.finish_manual_booking_effect(uuid,uuid,boolean) to service_role;
