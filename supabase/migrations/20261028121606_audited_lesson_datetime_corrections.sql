-- New coach-only record correction. No existing lesson or financial history changes.
create table lesson_ops.datetime_corrections (
 id uuid primary key default gen_random_uuid(),lesson_id uuid not null references public.lessons(id) on delete restrict,
 studio_id uuid not null,actor_id uuid not null,key text not null,request_hash text not null,
 original jsonb not null,corrected jsonb not null,reason text not null,timezone text not null,
 dependencies jsonb not null,financial_review_required boolean not null,provider_review_required boolean not null,
 response jsonb not null,operation_txid bigint not null default txid_current(),created_at timestamptz not null default now(),unique(actor_id,key)
);
create index datetime_corrections_lesson_history on lesson_ops.datetime_corrections(lesson_id,created_at desc,id desc);
create table lesson_ops.datetime_correction_reviews (
 id uuid primary key default gen_random_uuid(),correction_id uuid not null references lesson_ops.datetime_corrections(id) on delete restrict,
 actor_id uuid not null,key text not null,request_hash text not null,kind text not null check(kind in ('financial','provider')),
 note text not null,created_at timestamptz not null default now(),unique(actor_id,key),unique(correction_id,kind)
);
alter table lesson_ops.datetime_corrections enable row level security;
alter table lesson_ops.datetime_correction_reviews enable row level security;
revoke all on lesson_ops.datetime_corrections,lesson_ops.datetime_correction_reviews from public,anon,authenticated,service_role;

create function lesson_ops.datetime_correction_preview(p_actor uuid,p_value jsonb) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare l public.lessons; starts timestamptz; ends timestamptz; zone text:=p_value->>'timezone';
 dependencies jsonb; bookings jsonb; invoices jsonb; credits jsonb; participants jsonb; projection jsonb;
 reason text; financial boolean; provider boolean; token text;
begin
 select * into l from public.lessons where id=(p_value->>'lessonId')::uuid;
 if p_actor is null or l.id is null or not exists(select 1 from public.memberships where user_id=p_actor and studio_id=l.studio_id and role='coach') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if (p_value->>'version')::integer is distinct from l.version then raise exception 'VERSION_CONFLICT'; end if;
 if jsonb_typeof(p_value) is distinct from 'object' or length(p_value::text)>10000 or zone is null or not exists(select 1 from pg_timezone_names where name=zone)
 or coalesce(p_value->>'startsAt','') !~ '(Z|[+-][0-9]{2}:[0-9]{2})$' or coalesce(p_value->>'endsAt','') !~ '(Z|[+-][0-9]{2}:[0-9]{2})$' then raise exception 'VALIDATION_FAILED: Explicit instant and timezone are required.'; end if;
 starts:=(p_value->>'startsAt')::timestamptz; ends:=(p_value->>'endsAt')::timestamptz;
 if not isfinite(starts) or not isfinite(ends) or ends<=starts or (starts=l.starts_at and ends=l.ends_at) then raise exception 'VALIDATION_FAILED: Choose a different valid datetime.'; end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',b.id,'version',b.version,'startsAt',b.starts_at,'endsAt',b.ends_at,'paidMinor',b.paid_minor,'totalMinor',b.total_minor,'paymentStatus',b.payment_status,'shared',exists(select 1 from public.lesson_participants p where p.booking_id=b.id and p.lesson_id<>l.id)) order by b.id),'[]') into bookings
 from public.bookings b where b.id in(select booking_id from public.lesson_participants where lesson_id=l.id);
 select coalesce(jsonb_agg(jsonb_build_object('id',i.id,'version',i.version,'checkout',i.checkout_key,'status',i.status,'items',i.items) order by i.id),'[]') into invoices
 from public.studio_invoices i where exists(select 1 from jsonb_array_elements(i.items) item where item->'lessonIds' @> to_jsonb(array[l.id::text]));
 select coalesce(jsonb_agg(jsonb_build_object('id',e.id,'packageId',e.package_id,'quantity',e.quantity,'expiresAt',p.expires_at) order by e.id),'[]') into credits
 from public.package_credit_entries e join public.packages p on p.id=e.package_id where e.lesson_id=l.id;
 select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'studentId',p.student_id,'bookingId',p.booking_id,'status',p.status) order by p.id),'[]') into participants from public.lesson_participants p where p.lesson_id=l.id;
 select jsonb_build_object('id',p.id,'status',p.status,'externalId',p.external_event_id,'externalVersion',p.external_version,'projectedVersion',p.projected_version,'claimUntil',p.claim_until) into projection from public.calendar_projections p where p.lesson_id=l.id;
 if exists(select 1 from public.bookings b where b.id in(select booking_id from public.lesson_participants where lesson_id=l.id) and b.studio_id<>l.studio_id)
 or exists(select 1 from public.studio_invoices i where i.studio_id<>l.studio_id and exists(select 1 from jsonb_array_elements(i.items) item where item->'lessonIds' @> to_jsonb(array[l.id::text]))) then reason:='linked_record_ownership_review';
 elsif l.invoice_payment_pending or exists(select 1 from jsonb_array_elements(bookings) b where b->>'paymentStatus'='processing') or exists(select 1 from jsonb_array_elements(invoices) i where i->>'checkout' is not null) then reason:='checkout_in_progress';
 elsif exists(select 1 from jsonb_array_elements(bookings) b where not (b->>'shared')::boolean and ((b->>'startsAt')::timestamptz<>l.starts_at or (b->>'endsAt')::timestamptz<>l.ends_at)) then reason:='booking_datetime_reconciliation';
 elsif l.status='scheduled' and l.offering_id is null and exists(select 1 from public.lessons x where x.id<>l.id and x.studio_id=l.studio_id and x.status='scheduled' and x.offering_id is null and tstzrange(x.starts_at,x.ends_at,'[)') && tstzrange(starts,ends,'[)')) then reason:='local_overlap';
 end if;
 financial:=jsonb_array_length(invoices)>0 or jsonb_array_length(credits)>0 or l.paid_minor>0 or coalesce(l.price_minor,0)>0
  or exists(select 1 from jsonb_array_elements(bookings) b where (b->>'totalMinor')::bigint>0 or (b->>'paidMinor')::bigint>0);
 provider:=projection is not null or l.source_provider not in ('studio','public_booking');
 dependencies:=jsonb_build_object('bookings',bookings,'invoices',invoices,'credits',credits,'participants',participants,'projection',projection,'seriesId',l.series_id,'status',l.status,'createdAt',l.created_at,'priceMinor',l.price_minor,'paidMinor',l.paid_minor,'paymentStatus',l.payment_status);
 token:=encode(extensions.digest(jsonb_build_object('actor',p_actor,'lessonId',l.id,'version',l.version,'startsAt',starts,'endsAt',ends,'timezone',zone,'dependencies',dependencies,'reason',reason)::text,'sha256'),'hex');
 return jsonb_build_object('lessonId',l.id,'version',l.version,'originalStartsAt',l.starts_at,'originalEndsAt',l.ends_at,'startsAt',starts,'endsAt',ends,'timezone',zone,'status',l.status,
  'eligible',reason is null,'reasonCode',reason,'financialReviewRequired',financial,'providerReviewRequired',coalesce(provider,false),'automaticCoverageHeld',true,'completedInFuture',l.status='completed' and starts>now(),
  'bookingCount',jsonb_array_length(bookings),'invoiceCount',jsonb_array_length(invoices),'creditEntryCount',jsonb_array_length(credits),'participantCount',jsonb_array_length(participants),'sharedBooking',exists(select 1 from jsonb_array_elements(bookings) b where (b->>'shared')::boolean),'dependencies',dependencies,'reviewToken',token);
end $$;
revoke all on function lesson_ops.datetime_correction_preview(uuid,jsonb) from public,anon,authenticated,service_role;
create function public.preview_lesson_datetime_correction(p_value jsonb) returns jsonb
language sql stable security definer set search_path='' as $$select lesson_ops.datetime_correction_preview(auth.uid(),p_value)-'dependencies'$$;
revoke all on function public.preview_lesson_datetime_correction(jsonb) from public,anon,service_role;
grant execute on function public.preview_lesson_datetime_correction(jsonb) to authenticated;

-- A pending reviewed correction cannot be silently overwritten by source intake,
-- an old worker or a different command. Only a new private, transaction-bound
-- correction record permits that exact date change before review is resolved.
create function lesson_ops.guard_datetime_correction() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if (new.starts_at,new.ends_at,new.status) is distinct from (old.starts_at,old.ends_at,old.status)
 and exists(select 1 from lesson_ops.datetime_corrections c where c.lesson_id=old.id)
 and not exists(select 1 from public.memberships m where m.studio_id=old.studio_id and m.role='coach' and m.user_id=nullif(current_setting('app.lesson_actor',true),'')::uuid)
 and not ((new.starts_at,new.ends_at) is not distinct from (old.starts_at,old.ends_at) and public.is_studio_coach(old.studio_id))
 and not exists(select 1 from lesson_ops.datetime_corrections c where c.lesson_id=old.id and c.operation_txid=txid_current() and (c.corrected->>'startsAt')::timestamptz=new.starts_at and (c.corrected->>'endsAt')::timestamptz=new.ends_at and c.corrected->>'status'=new.status::text) then
  raise exception 'REVIEW_REQUIRED: Corrected records require explicit coach review before source changes.';
 end if;
 return new;
end $$;
revoke all on function lesson_ops.guard_datetime_correction() from public,anon,authenticated,service_role;
create trigger guard_datetime_correction before update of starts_at,ends_at,status on public.lessons for each row execute function lesson_ops.guard_datetime_correction();

create function public.correct_lesson_datetime(p_value jsonb,p_key text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); l public.lessons; prior lesson_ops.datetime_corrections; preview jsonb;
 request_hash text:=encode(extensions.digest(p_value::text,'sha256'),'hex'); correction uuid:=gen_random_uuid(); result jsonb; audit_id uuid:=gen_random_uuid(); reason text:=trim(p_value->>'reason');
begin
 if actor is null then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if p_key is null or length(p_key) not between 8 and 200 or reason is null or length(reason)<3 then raise exception 'VALIDATION_FAILED: A stable identity and correction reason are required.'; end if;
 perform pg_advisory_xact_lock(hashtextextended(actor::text||':datetime-correction:'||p_key,0));
 select * into prior from lesson_ops.datetime_corrections where actor_id=actor and key=p_key;
 if found then
  if not public.is_studio_coach(prior.studio_id) then raise exception 'FORBIDDEN' using errcode='42501'; end if;
  if prior.request_hash<>request_hash then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
  return prior.response;
 end if;
 select * into l from public.lessons where id=(p_value->>'lessonId')::uuid;
 if l.id is null or not public.is_studio_coach(l.studio_id) then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 perform pg_advisory_xact_lock(hashtext(l.studio_id::text));
 perform pg_advisory_xact_lock(hashtextextended(l.studio_id::text||':calendar',0));
 perform 1 from public.students where id in(select l.student_id union select student_id from public.lesson_participants where lesson_id=l.id union select i.student_id from public.studio_invoices i where exists(select 1 from jsonb_array_elements(i.items) item where item->'lessonIds' @> to_jsonb(array[l.id::text]))) order by id for update;
 select * into l from public.lessons where id=l.id for update;
 perform 1 from public.bookings where id in(select booking_id from public.lesson_participants where lesson_id=l.id) order by id for update;
 perform 1 from public.studio_invoices i where exists(select 1 from jsonb_array_elements(i.items) item where item->'lessonIds' @> to_jsonb(array[l.id::text])) order by i.id for update;
 preview:=lesson_ops.datetime_correction_preview(actor,p_value);
 if not (preview->>'eligible')::boolean then raise exception 'REVIEW_REQUIRED: %',preview->>'reasonCode'; end if;
 if preview->>'reviewToken' is distinct from p_value->>'reviewToken' then raise exception 'VERSION_CONFLICT: Correction dependencies changed. Preview again.'; end if;
 if (preview->>'financialReviewRequired')::boolean and not coalesce((p_value->>'financialAcknowledged')::boolean,false) then raise exception 'REVIEW_REQUIRED: Acknowledge the unchanged financial history and review requirement.'; end if;
 if (preview->>'completedInFuture')::boolean and not coalesce((p_value->>'outcomeAcknowledged')::boolean,false) then raise exception 'REVIEW_REQUIRED: Explicitly preserve the completed outcome at this future date.'; end if;
 result:=jsonb_build_object('correctionId',correction,'lessonId',l.id,'auditEventId',audit_id,'financialReviewRequired',preview->'financialReviewRequired','providerReviewRequired',preview->'providerReviewRequired','automaticCoverageHeld',true,'queuedSideEffects','[]'::jsonb);
 insert into lesson_ops.datetime_corrections(id,lesson_id,studio_id,actor_id,key,request_hash,original,corrected,reason,timezone,dependencies,financial_review_required,provider_review_required,response)
 values(correction,l.id,l.studio_id,actor,p_key,request_hash,jsonb_build_object('startsAt',l.starts_at,'endsAt',l.ends_at,'status',l.status,'createdAt',l.created_at),jsonb_build_object('startsAt',p_value->>'startsAt','endsAt',p_value->>'endsAt','status',l.status),reason,p_value->>'timezone',preview->'dependencies',(preview->>'financialReviewRequired')::boolean,(preview->>'providerReviewRequired')::boolean,result);
 update public.lessons set starts_at=(p_value->>'startsAt')::timestamptz,ends_at=(p_value->>'endsAt')::timestamptz,version=version+1,updated_at=now() where id=l.id;
 update public.bookings b set starts_at=(p_value->>'startsAt')::timestamptz,ends_at=(p_value->>'endsAt')::timestamptz,timezone=p_value->>'timezone',version=version+1,updated_at=now()
 where b.id in(select booking_id from public.lesson_participants where lesson_id=l.id) and not exists(select 1 from public.lesson_participants p where p.booking_id=b.id and p.lesson_id<>l.id);
 update public.calendar_projections set status='review_required',claim_token=null,claim_until=null,claimed_version=null,last_error='Coach datetime correction: provider unchanged; review required.' where lesson_id=l.id;
 insert into public.audit_events(id,studio_id,actor_id,entity_type,entity_id,action,reason,correlation_id,source,before_state,after_state)
 values(audit_id,l.studio_id,actor,'lesson',l.id,'lesson.datetime_corrected',reason,p_key,'coach_correction',jsonb_build_object('startsAt',l.starts_at,'endsAt',l.ends_at,'status',l.status,'createdAt',l.created_at),jsonb_build_object('correctionId',correction,'startsAt',p_value->>'startsAt','endsAt',p_value->>'endsAt','status',l.status,'financialReviewRequired',preview->'financialReviewRequired','providerReviewRequired',preview->'providerReviewRequired'));
 return result;
end $$;
revoke all on function public.correct_lesson_datetime(jsonb,text) from public,anon,service_role;
grant execute on function public.correct_lesson_datetime(jsonb,text) to authenticated;

create function public.lesson_datetime_correction_history(p_lesson uuid,p_cursor jsonb default null) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare studio uuid; rows jsonb; more boolean; next_cursor jsonb;
begin
 select studio_id into studio from public.lessons where id=p_lesson;
 if studio is null or not public.is_studio_coach(studio) then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 with page as(select c.* from lesson_ops.datetime_corrections c where c.lesson_id=p_lesson and (p_cursor is null or (c.created_at,c.id)<((p_cursor->>'createdAt')::timestamptz,(p_cursor->>'id')::uuid)) order by c.created_at desc,c.id desc limit 11),
 visible as(select * from page order by created_at desc,id desc limit 10)
 select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'recordedAt',c.created_at,'original',c.original,'corrected',c.corrected,'reason',c.reason,'timezone',c.timezone,'financialReviewRequired',c.financial_review_required and not exists(select 1 from lesson_ops.datetime_correction_reviews r where r.correction_id=c.id and r.kind='financial'),'providerReviewRequired',c.provider_review_required and not exists(select 1 from lesson_ops.datetime_correction_reviews r where r.correction_id=c.id and r.kind='provider'),'automaticCoverageHeld',true) order by c.created_at desc,c.id desc),'[]'),
  (select count(*)>10 from page),
  (select jsonb_build_object('createdAt',created_at,'id',id) from visible order by created_at,id limit 1)
 into rows,more,next_cursor from visible c;
 return jsonb_build_object('items',rows,'hasMore',more,'nextCursor',case when more then next_cursor end,'lessonVersion',(select version from public.lessons where id=p_lesson),'total',(select count(*) from lesson_ops.datetime_corrections where lesson_id=p_lesson),
  'financialReviewsPending',(select count(*) from lesson_ops.datetime_corrections c where c.lesson_id=p_lesson and c.financial_review_required and not exists(select 1 from lesson_ops.datetime_correction_reviews r where r.correction_id=c.id and r.kind='financial')),
  'providerReviewsPending',(select count(*) from lesson_ops.datetime_corrections c where c.lesson_id=p_lesson and c.provider_review_required and not exists(select 1 from lesson_ops.datetime_correction_reviews r where r.correction_id=c.id and r.kind='provider')));
end $$;
revoke all on function public.lesson_datetime_correction_history(uuid,jsonb) from public,anon,service_role;
grant execute on function public.lesson_datetime_correction_history(uuid,jsonb) to authenticated;

create function public.record_datetime_correction_review(p_value jsonb,p_key text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); c lesson_ops.datetime_corrections; prior lesson_ops.datetime_correction_reviews; review_id uuid;
 digest text:=encode(extensions.digest(p_value::text,'sha256'),'hex'); review_kind text:=p_value->>'kind'; note text:=trim(p_value->>'note');
begin
 select * into c from lesson_ops.datetime_corrections where id=(p_value->>'correctionId')::uuid;
 if c.id is null or c.lesson_id is distinct from (p_value->>'lessonId')::uuid or actor is null or not public.is_studio_coach(c.studio_id) then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if p_key is null or length(p_key) not between 8 and 200 or review_kind is null or review_kind not in ('financial','provider') or note is null or length(note)<3 or length(note)>2000 then raise exception 'VALIDATION_FAILED'; end if;
 perform pg_advisory_xact_lock(hashtextextended(actor::text||':correction-review:'||p_key,0));
 select * into prior from lesson_ops.datetime_correction_reviews where actor_id=actor and key=p_key;
 if found then
  if prior.request_hash<>digest then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
  return jsonb_build_object('reviewId',prior.id,'correctionId',prior.correction_id,'kind',prior.kind);
 end if;
 perform 1 from public.lessons where id=c.lesson_id and version=(p_value->>'lessonVersion')::integer for update;
 if not found then raise exception 'VERSION_CONFLICT'; end if;
 if exists(select 1 from lesson_ops.datetime_correction_reviews where correction_id=c.id and datetime_correction_reviews.kind=review_kind) then raise exception 'VERSION_CONFLICT: This review is already recorded.'; end if;
 insert into lesson_ops.datetime_correction_reviews(correction_id,actor_id,key,request_hash,kind,note) values(c.id,actor,p_key,digest,review_kind,note) returning id into review_id;
 insert into public.audit_events(studio_id,actor_id,entity_type,entity_id,action,reason,correlation_id,source,after_state)
 values(c.studio_id,actor,'lesson',c.lesson_id,'lesson.datetime_correction_reviewed',note,p_key,'coach_correction',jsonb_build_object('correctionId',c.id,'reviewKind',review_kind,'reviewId',review_id,'accountingUnchanged',true,'providerDeliveryVerified',false,'automaticCoverageHeld',true));
 return jsonb_build_object('reviewId',review_id,'correctionId',c.id,'kind',review_kind);
end $$;
revoke all on function public.record_datetime_correction_review(jsonb,text) from public,anon,service_role;
grant execute on function public.record_datetime_correction_review(jsonb,text) to authenticated;


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
      where e.lesson_id = l.id and p.student_id = p_student
      group by e.package_id having sum(e.quantity) < 0) t;

  -- A date correction preserves accounting. Only an explicit manual credit
  -- command may allocate coverage to a corrected record afterward.
  if p_mode<>'manual' and exists(select 1 from lesson_ops.datetime_corrections c where c.lesson_id=l.id) then
    return jsonb_build_object('state','review_required','reasonCode','reconciliation_required','eligible',false,'existingReservation',reservation_count>0);
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
    where p.student_id=p_student and e.lesson_id=l.id group by e.lesson_id having sum(e.quantity)>0) then
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
        select p.* into pkg from public.packages p
          where p.student_id = p_student
            and (p_package is null or p.id = p_package)
            and (p_mode <> 'automatic' or coalesce(enabled, p.auto_apply))
            and (p.expires_at is null or p.expires_at > greatest(now(), l.starts_at))
            and public.package_credit_balance(p.id) - coalesce((p_allocated->>p.id::text)::integer, 0) > 0
          order by p.expires_at nulls last, p.created_at, p.id limit 1;
        if pkg.id is not null then
          return jsonb_build_object('state', 'eligible_unreserved', 'reasonCode', 'eligible',
            'eligible', true, 'packageId', pkg.id, 'expiresAt', pkg.expires_at);
        end if;
        if p_mode = 'automatic' and enabled is null and exists(
          select 1 from public.packages p where p.student_id = p_student and not p.auto_apply
            and (p_package is null or p.id = p_package)
            and (p.expires_at is null or p.expires_at > greatest(now(), l.starts_at))
            and public.package_credit_balance(p.id) - coalesce((p_allocated->>p.id::text)::integer, 0) > 0) then
          reason := 'mixed_settings_review'; state := 'review_required';
        elsif exists(select 1 from public.packages p where p.student_id = p_student
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
