-- Depends on PR 1.1 diagnostics and PR 1.2 lifecycle recovery. No financial backfill.
-- A booking-level credit status is not proof that each linked occurrence has a
-- reservation. Cash totals on shared bookings also cannot be guessed per lesson.
create or replace function public.sync_lesson_financials_from_participant() returns trigger
language plpgsql security definer set search_path='' as $$
declare b public.bookings;
begin
  select * into b from public.bookings where id=new.booking_id;
  if b.id is null then return new; end if;
  if b.payment_policy='credits' and b.paid_minor=0 then
    update public.lessons l set payment_status='paid_by_credit',paid_minor=0,updated_at=greatest(l.updated_at,b.updated_at)
      where l.id=new.lesson_id and l.student_id=b.student_id and l.status in ('scheduled','completed')
        and exists(select 1 from public.package_credit_entries e join public.packages p on p.id=e.package_id
          where e.lesson_id=l.id and p.student_id=b.student_id group by p.student_id having sum(e.quantity)=-1);
  elsif b.payment_policy<>'credits' and not exists(select 1 from public.lesson_participants where booking_id=b.id and lesson_id<>new.lesson_id) then
    update public.lessons l set payment_status=public.lesson_payment_status_from_booking(b.payment_status),price_minor=b.total_minor,
      paid_minor=b.paid_minor,updated_at=greatest(l.updated_at,b.updated_at) where l.id=new.lesson_id and l.student_id=b.student_id;
  end if;
  return new;
end $$;

create or replace function public.sync_lesson_financials_from_booking() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if new.payment_policy='credits' and new.paid_minor=0 then
    update public.lessons l set payment_status='paid_by_credit',paid_minor=0,updated_at=greatest(l.updated_at,new.updated_at)
      where l.student_id=new.student_id and l.status in ('scheduled','completed')
        and l.id in(select lesson_id from public.lesson_participants where booking_id=new.id and status in ('reserved','confirmed','attended'))
        and exists(select 1 from public.package_credit_entries e join public.packages p on p.id=e.package_id
          where e.lesson_id=l.id and p.student_id=new.student_id group by p.student_id having sum(e.quantity)=-1);
  elsif new.payment_policy<>'credits' and (select count(distinct lesson_id) from public.lesson_participants where booking_id=new.id)<=1 then
    update public.lessons l set payment_status=public.lesson_payment_status_from_booking(new.payment_status),price_minor=new.total_minor,
      paid_minor=new.paid_minor,updated_at=greatest(l.updated_at,new.updated_at)
      where l.student_id=new.student_id and l.id in(select lesson_id from public.lesson_participants where booking_id=new.id);
  end if;
  return new;
end $$;

-- Preserve evidence of prior attempts even when successful workers reset attempts.
alter table public.calendar_projections add column claim_token uuid,add column claim_until timestamptz,
  add column claimed_version integer,add column first_attempted_at timestamptz;
update public.calendar_projections set first_attempted_at=coalesce(last_projected_at,now())
  where attempts>0 or projected_version>0 or external_event_id is not null or status in ('projecting','failed');

create or replace function public.claim_calendar_projections(batch_size integer default 10)
returns table(projection jsonb,lesson jsonb) language plpgsql security definer set search_path='' as $$
begin
  if batch_size not between 1 and 25 then raise exception 'VALIDATION_FAILED'; end if;
  return query with wanted as(select p.id from public.calendar_projections p
    where p.status in ('queued','failed','projecting') and (p.next_attempt_at is null or p.next_attempt_at<=now())
      and (p.claim_until is null or p.claim_until<=now()) order by p.next_attempt_at nulls first,p.id for update skip locked limit batch_size),
  claimed as(update public.calendar_projections p set status='projecting',claim_token=gen_random_uuid(),
    claim_until=now()+interval '5 minutes',claimed_version=l.version,attempts=p.attempts+1,
    first_attempted_at=coalesce(p.first_attempted_at,now()) from public.lessons l
    where p.id in(select id from wanted) and l.id=p.lesson_id returning p.*)
  select to_jsonb(c),to_jsonb(l) from claimed c join public.lessons l on l.id=c.lesson_id;
end $$;

revoke all on function public.claim_calendar_projections(integer) from public,anon,authenticated;
grant execute on function public.claim_calendar_projections(integer) to service_role;

create function public.calendar_claim_current(p_id uuid,p_token uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.calendar_projections p join public.lessons l on l.id=p.lesson_id
    where p.id=p_id and p.claim_token=p_token and p.claim_until>now() and p.status='projecting' and p.claimed_version=l.version);
$$;
revoke all on function public.calendar_claim_current(uuid,uuid) from public,anon,authenticated;
grant execute on function public.calendar_claim_current(uuid,uuid) to service_role;

create function public.finish_calendar_projection(p_id uuid,p_token uuid,p_result jsonb,p_failed boolean default false) returns boolean
language plpgsql security definer set search_path='' as $$
declare p public.calendar_projections;l public.lessons; current_version boolean;
begin
  -- Match the lesson -> projection order used by commands; a late worker never clears newer work.
  select * into l from public.lessons where id=(select lesson_id from public.calendar_projections where id=p_id) for update;
  select * into p from public.calendar_projections where id=p_id for update;
  if p.claim_token is distinct from p_token then return false; end if;
  current_version:=p.claimed_version=l.version and p.status='projecting';
  update public.calendar_projections set
    external_event_id=coalesce(p_result->>'id',external_event_id),external_version=coalesce(p_result->>'etag',external_version),
    status=case when not current_version then 'queued' when p_failed then 'failed' else 'projected' end,
    projected_version=case when current_version and not p_failed then l.version else projected_version end,
    last_projected_at=case when current_version and not p_failed then now() else last_projected_at end,
    last_error=case when current_version and p_failed then coalesce(p_result->>'errorCode','calendar_sync_failed') else null end,
    next_attempt_at=case when current_version and p_failed then now()+make_interval(secs=>least(3600,30*power(2,least(attempts,7))::integer)) else now() end,
    claim_token=null,claim_until=null where id=p.id;
  if current_version and not p_failed and p_result->>'joinUrl' is not null and l.status='scheduled' then
    update public.lessons set join_url=p_result->>'joinUrl',location_label='Google Meet',updated_at=now() where id=l.id;
  end if;
  return current_version and not p_failed;
end $$;
revoke all on function public.finish_calendar_projection(uuid,uuid,jsonb,boolean) from public,anon,authenticated;
grant execute on function public.finish_calendar_projection(uuid,uuid,jsonb,boolean) to service_role;
create schema lesson_ops;
revoke all on schema lesson_ops from public,anon,authenticated;
create table lesson_ops.receipts (
  key text primary key, actor_id uuid, studio_id uuid not null,
  request jsonb not null,response jsonb not null,created_at timestamptz not null default now()
);
create table lesson_ops.effects (
  id uuid primary key default gen_random_uuid(), lesson_id uuid not null references public.lessons(id) on delete restrict,
  lesson_version integer not null, kind text not null check(kind in ('cancelled','rescheduled')),
  student_ids uuid[] not null,participant_ids uuid[] not null,booking_id uuid,
  snapshot jsonb not null,correlation_id text not null,
  status text not null default 'queued' check(status in ('queued','processing','failed','completed','superseded')),
  attempts integer not null default 0,next_attempt_at timestamptz not null default now(),
  claim_token uuid,claim_until timestamptz,last_error text,outbox_ids uuid[] not null default '{}',
  created_at timestamptz not null default now(),unique(lesson_id,lesson_version,kind,correlation_id)
);
create index lesson_effects_pending on lesson_ops.effects(next_attempt_at,id) where status in ('queued','failed','processing');
alter table lesson_ops.receipts enable row level security;
alter table lesson_ops.effects enable row level security;
revoke all on lesson_ops.receipts,lesson_ops.effects from public,anon,authenticated,service_role;

-- The protected fixture endpoint needs to remove private operational state before
-- deleting its named fixtures. No financial records or real lessons are changed.
create function public.cleanup_lesson_change_fixture(p_run text,p_studio uuid) returns void
language plpgsql security definer set search_path='' as $$
declare ids uuid[];
begin
  if p_run is null or p_run !~ '^e2e-[a-z0-9][a-z0-9-]{2,46}[a-z0-9]$' then raise exception 'FORBIDDEN'; end if;
  select array_agg(l.id) into ids from public.lessons l where studio_id=p_studio and starts_with(topic,p_run||' ')
    and (l.student_id is null or exists(select 1 from public.students where id=l.student_id and starts_with(full_name,p_run||' ')))
    and not exists(select 1 from public.lesson_participants lp join public.students s on s.id=lp.student_id where lp.lesson_id=l.id and not starts_with(s.full_name,p_run||' '));
  if exists(select 1 from public.outbox_messages where lesson_id=any(ids)) then raise exception 'FORBIDDEN: Remove fixture outbox first'; end if;
  delete from lesson_ops.effects where lesson_id=any(ids);
  delete from lesson_ops.receipts where studio_id=p_studio and (request->>'lessonId')::uuid=any(ids);
end $$;
revoke all on function public.cleanup_lesson_change_fixture(text,uuid) from public,anon,authenticated;
grant execute on function public.cleanup_lesson_change_fixture(text,uuid) to service_role;

-- One authoritative consequence check, reusable by upcoming bulk preview/execution.
create function lesson_ops.assess_change(
  p_lesson uuid,p_action text,p_starts_at timestamptz default null,p_class boolean default false
) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare l public.lessons; reason text; bookings jsonb; students uuid[]; credit_count bigint;
  credit_diagnostics jsonb:='{}'; evaluated_student uuid; diagnostic jsonb;
begin
  select * into l from public.lessons where id=p_lesson;
  if l.id is null then return jsonb_build_object('eligible',false,'reasonCode','lesson_unavailable'); end if;
  select coalesce(array_agg(distinct sid),'{}') into students from (
    select l.student_id sid union select student_id from public.lesson_participants
      where lesson_id=l.id and status in ('reserved','confirmed')) s where sid is not null;
  if p_action not in ('cancel','reschedule') then reason:='invalid_action';
  elsif l.status<>'scheduled' then reason:='lesson_not_scheduled';
  elsif exists(select 1 from unnest(students) sid where not exists(select 1 from public.students where id=sid and studio_id=l.studio_id)) then reason:='reconciliation_required';
  elsif (l.student_id is null or l.offering_id is not null or coalesce(l.capacity,1)>1
    or exists(select 1 from public.lesson_participants where lesson_id=l.id and status in ('reserved','confirmed') and student_id is distinct from l.student_id)) and not p_class then reason:='class_scope_required';
  elsif l.invoice_payment_pending or exists(select 1 from public.studio_invoices i cross join jsonb_array_elements(i.items) x
    where i.checkout_key is not null and x->'lessonIds' @> to_jsonb(array[l.id::text]))
    or exists(select 1 from public.bookings b join public.lesson_participants lp on lp.booking_id=b.id
      where lp.lesson_id=l.id and lp.status in ('reserved','confirmed') and b.payment_status='processing') then reason:='payment_pending';
  elsif p_action='cancel' and exists(select 1 from public.studio_invoices i cross join jsonb_array_elements(i.items) x
    where i.status not in ('draft','void') and x->'lessonIds' @> to_jsonb(array[l.id::text]) and jsonb_array_length(x->'lessonIds')>1
      and not coalesce((x->>'cancelled')::boolean,false)) then reason:='shared_invoice_review_required';
  elsif exists(select 1 from public.sync_conflicts where entity_type='lesson' and entity_id=l.id and status='open') then reason:='synchronization_review_required';
  elsif exists(select 1 from public.package_credit_entries e join public.packages p on p.id=e.package_id
    where e.lesson_id=l.id group by p.student_id having sum(e.quantity)<-1)
    or exists(select 1 from public.bookings b join public.lesson_participants lp on lp.booking_id=b.id
      where lp.lesson_id=l.id and b.payment_policy='credits' and b.paid_minor>0)
    or (l.paid_minor>0 and exists(select 1 from public.package_credit_entries where lesson_id=l.id group by package_id having sum(quantity)<0)) then reason:='reconciliation_required';
  elsif p_action='cancel' and exists(select 1 from public.bookings b join public.lesson_participants lp on lp.booking_id=b.id
    where lp.lesson_id=l.id and lp.status in ('reserved','confirmed') and b.payment_policy<>'credits'
      and (b.paid_minor>0 or b.payment_status in ('paid','partially_paid','refunded','not_required') and b.total_minor>0)
      and exists(select 1 from public.lesson_participants other where other.booking_id=b.id and other.lesson_id<>l.id)) then reason:='shared_prepaid_review_required';
  elsif p_action='reschedule' and (p_starts_at is null or p_starts_at<=now()) then reason:='invalid_time';
  elsif p_action='reschedule' and exists(select 1 from public.package_credit_entries e join public.packages p on p.id=e.package_id
    where e.lesson_id=l.id and p.expires_at<=greatest(now(),p_starts_at) group by p.id having sum(e.quantity)<0) then reason:='reserved_credit_expires';
  end if;
  for evaluated_student in select unnest(students) order by 1 loop
    diagnostic:=credit_internal.evaluate_student_lesson_credit(evaluated_student,l.id,'manual');
    credit_diagnostics:=jsonb_set(credit_diagnostics,array[evaluated_student::text],diagnostic);
    if reason is null and diagnostic->>'reasonCode'='reconciliation_required' then reason:='reconciliation_required'; end if;
  end loop;
  select coalesce(jsonb_agg(jsonb_build_object('id',b.id,'version',b.version,'shared',
    exists(select 1 from public.lesson_participants other where other.booking_id=b.id and other.lesson_id<>l.id),
    'unaffectedActive', (select count(distinct other.lesson_id) from public.lesson_participants other join public.lessons x on x.id=other.lesson_id
      where other.booking_id=b.id and other.lesson_id<>l.id and other.status in ('reserved','confirmed') and x.status='scheduled')) order by b.id),'[]')
    into bookings from public.bookings b where b.id in(select booking_id from public.lesson_participants where lesson_id=l.id and status in ('reserved','confirmed'));
  select count(*) into credit_count from (select e.package_id from public.package_credit_entries e where e.lesson_id=l.id group by e.package_id having sum(e.quantity)<0) held;
  return jsonb_build_object('eligible',reason is null,'reasonCode',reason,'lessonId',l.id,'version',l.version,
    'topic',l.topic,'startsAt',l.starts_at,'endsAt',l.ends_at,'status',l.status,'seriesId',l.series_id,
    'class',l.student_id is null or l.offering_id is not null or coalesce(l.capacity,1)>1,
    'studentIds',to_jsonb(students),'bookings',bookings,'reservedCredits',credit_count,'creditDiagnostics',credit_diagnostics,
    'calendarPending',exists(select 1 from public.calendar_projections where lesson_id=l.id and status<>'projected'),
    'notificationParticipantCount',(select count(*) from public.lesson_participants where lesson_id=l.id and status in ('reserved','confirmed')),
    'providerLinked',l.source_provider not in ('studio','public_booking'));
end $$;
revoke all on function lesson_ops.assess_change(uuid,text,timestamptz,boolean) from public,anon,authenticated;

create function public.preview_lesson_occurrence_change(p_actor uuid,p_value jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare anchor public.lessons; scope text:=coalesce(p_value->>'scope','occurrence'); action text:=p_value->>'action';
  ids uuid[]; l public.lessons; rows jsonb:='[]'; assessment jsonb; seal text; shift interval; zone text; next_start timestamptz;
  class_scope boolean:=coalesce((p_value->>'wholeClass')::boolean,false); student_context uuid:=(p_value->>'studentContextId')::uuid;
begin
  select * into anchor from public.lessons where id=(p_value->>'lessonId')::uuid;
  if anchor.id is null or not exists(select 1 from public.memberships where user_id=p_actor and studio_id=anchor.studio_id and role='coach') then raise exception 'FORBIDDEN'; end if;
  if action not in ('cancel','reschedule') or scope not in ('occurrence','selected','future','series') or (class_scope and student_context is not null) then raise exception 'VALIDATION_FAILED'; end if;
  if student_context is not null and not exists(select 1 from public.students where id=student_context and studio_id=anchor.studio_id and deleted_at is null) then raise exception 'FORBIDDEN'; end if;
  if scope='occurrence' then ids:=array[anchor.id];
  elsif scope='selected' then
    select array_agg(distinct value::uuid order by value::uuid) into ids from jsonb_array_elements_text(p_value->'selectedIds');
  elsif anchor.series_id is not null then
    select array_agg(id order by id) into ids from public.lessons where series_id=anchor.series_id and studio_id=anchor.studio_id
      and (scope='series' or starts_at>=greatest(now(),anchor.starts_at));
  else raise exception 'VALIDATION_FAILED: This lesson has no series.'; end if;
  if coalesce(array_length(ids,1),0) not between 1 and 100 then raise exception 'VALIDATION_FAILED: Review 1-100 occurrences per interactive change.'; end if;
  if not anchor.id=any(ids) or exists(select 1 from unnest(ids) wanted where not exists(select 1 from public.lessons where id=wanted and studio_id=anchor.studio_id)) then raise exception 'FORBIDDEN'; end if;
  select coalesce(timezone,'America/New_York') into zone from public.studios where id=anchor.studio_id;
  if action='reschedule' then
    if p_value->>'startsAt' is null or p_value->>'endsAt' is null or (p_value->>'endsAt')::timestamptz<=(p_value->>'startsAt')::timestamptz then raise exception 'VALIDATION_FAILED'; end if;
    if scope<>'occurrence' and (p_value->>'endsAt')::timestamptz-(p_value->>'startsAt')::timestamptz<>anchor.ends_at-anchor.starts_at then raise exception 'VALIDATION_FAILED: Series changes preserve each occurrence duration.'; end if;
    shift:=((p_value->>'startsAt')::timestamptz at time zone zone)-(anchor.starts_at at time zone zone);
  end if;
  for l in select * from public.lessons where id=any(ids) order by starts_at,id loop
    next_start:=case when action='reschedule' then ((l.starts_at at time zone zone)+shift) at time zone zone end;
    assessment:=lesson_ops.assess_change(l.id,action,next_start,class_scope);
    if student_context is not null and l.student_id is distinct from student_context then
      assessment:=assessment||jsonb_build_object('eligible',false,'reasonCode','class_scope_required');
    end if;
    rows:=rows||jsonb_build_array(assessment||jsonb_build_object('newStartsAt',next_start,'newEndsAt',
      case when action='reschedule' then case when scope='occurrence' then (p_value->>'endsAt')::timestamptz else next_start+(l.ends_at-l.starts_at) end end,
      'dependencyFingerprint',encode(extensions.digest(jsonb_build_object(
        'assessment',assessment,'invoices',(select jsonb_agg(jsonb_build_object('id',i.id,'version',i.version,'items',i.items,'checkout',i.checkout_key) order by i.id)
          from public.studio_invoices i where exists(select 1 from jsonb_array_elements(i.items) x where x->'lessonIds' @> to_jsonb(array[l.id::text]))),
        'participants',(select jsonb_agg(to_jsonb(lp) order by lp.id) from public.lesson_participants lp where lp.lesson_id=l.id),
        'ledger',(select jsonb_agg(to_jsonb(e) order by e.id) from public.package_credit_entries e where e.lesson_id=l.id))::text,'sha256'),'hex')));
  end loop;
  seal:=encode(extensions.digest(jsonb_build_object('actor',p_actor,'request',p_value-'reviewToken','rows',rows)::text,'sha256'),'hex');
  return jsonb_build_object('lessonId',anchor.id,'scope',scope,'action',action,'items',rows,'count',array_length(ids,1),
    'reviewToken',seal,'stopsFutureGeneration',action='cancel' and scope in ('future','series'),
    'creditPolicy',case when coalesce((p_value->>'useCredit')::boolean,false) then 'retain' else 'return' end);
end $$;
revoke all on function public.preview_lesson_occurrence_change(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.preview_lesson_occurrence_change(uuid,jsonb) to service_role;

create function public.execute_lesson_occurrence_change(p_actor uuid,p_key text,p_value jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare preview jsonb; anchor public.lessons; scope text:=coalesce(p_value->>'scope','occurrence'); item jsonb; results jsonb:='[]';
  prior lesson_ops.receipts; result jsonb; ids uuid[]; sid uuid; affected_students uuid[];
begin
  select * into anchor from public.lessons where id=(p_value->>'lessonId')::uuid;
  if anchor.id is null or not exists(select 1 from public.memberships where user_id=p_actor and studio_id=anchor.studio_id and role='coach') then raise exception 'FORBIDDEN'; end if;
  if p_key is null or length(p_key)<8 or length(p_key)>200 or coalesce(length(trim(p_value->>'reason')),0)<3 then raise exception 'VALIDATION_FAILED'; end if;
  -- Scheduling serialization precedes student/lesson/lot locks, matching booking confirmation.
  perform pg_advisory_xact_lock(hashtext(anchor.studio_id::text));
  select * into prior from lesson_ops.receipts where key='reviewed:'||p_key;
  if prior.key is not null then
    if prior.actor_id is distinct from p_actor or prior.studio_id<>anchor.studio_id or prior.request<>p_value then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
    return prior.response||jsonb_build_object('duplicate',true);
  end if;
  preview:=public.preview_lesson_occurrence_change(p_actor,p_value);
  select array_agg((value->>'lessonId')::uuid) into ids from jsonb_array_elements(preview->'items');
  perform 1 from public.students where studio_id=anchor.studio_id and id in (
    select student_id from public.lessons where id=any(ids) union select student_id from public.lesson_participants where lesson_id=any(ids)) order by id for update;
  for sid in select id from public.students where studio_id=anchor.studio_id and id in (
    select student_id from public.lessons where id=any(ids) union select student_id from public.lesson_participants where lesson_id=any(ids)) order by id loop
    perform credit_internal.lock_upcoming(sid);
  end loop;
  perform 1 from public.lessons where id=any(ids) order by starts_at,id for update;
  perform 1 from public.bookings where id in(select booking_id from public.lesson_participants where lesson_id=any(ids)) order by id for update;
  preview:=public.preview_lesson_occurrence_change(p_actor,p_value);
  if p_value->>'reviewToken' is null or p_value->>'reviewToken'<>preview->>'reviewToken' then raise exception 'VERSION_CONFLICT: Review changed occurrences again.'; end if;
  if exists(select 1 from jsonb_array_elements(preview->'items') x where not (x->>'eligible')::boolean) then raise exception 'REVIEW_REQUIRED: One or more occurrences require review.'; end if;
  select coalesce(array_agg(distinct s.value::uuid order by s.value::uuid),'{}') into affected_students
    from jsonb_array_elements(preview->'items') e cross join lateral jsonb_array_elements_text(e.value->'studentIds') s;
  perform set_config('app.lesson_actor',p_actor::text,true);
  perform set_config('app.lesson_reason',p_value->>'reason',true);
  perform set_config('app.lesson_class',coalesce(p_value->>'wholeClass','false'),true);
  perform set_config('app.lesson_stop_generation',preview->>'stopsFutureGeneration',true);
  perform set_config('app.use_credit',coalesce(p_value->>'useCredit','false'),true);
  perform set_config('app.lesson_defer_coverage','true',true);
  for item in select value from jsonb_array_elements(preview->'items') loop
    result:=public.command_change_lesson_state((item->>'lessonId')::uuid,(item->>'version')::integer,p_value->>'action',
      (item->>'newStartsAt')::timestamptz,(item->>'newEndsAt')::timestamptz,true);
    results:=results||jsonb_build_array(result);
  end loop;
  perform set_config('app.lesson_defer_coverage','false',true);
  for sid in select unnest(affected_students) order by 1 loop
    results:=results||jsonb_build_array(jsonb_build_object('studentId',sid,'creditCoverage',credit_internal.request_coverage(sid)));
  end loop;
  if (preview->>'stopsFutureGeneration')::boolean then
    update public.recurring_series set status='cancelled',updated_at=now() where id=anchor.series_id;
    insert into public.audit_events(studio_id,actor_id,action,entity_type,entity_id,reason,correlation_id,source,after_state)
      values(anchor.studio_id,p_actor,'series.generation_stopped','recurring_series',anchor.series_id,p_value->>'reason',p_key,'coach_portal',preview);
  end if;
  result:=jsonb_build_object('review',preview,'results',results,'duplicate',false,'synchronizationPending',true);
  insert into lesson_ops.receipts(key,actor_id,studio_id,request,response) values('reviewed:'||p_key,p_actor,anchor.studio_id,p_value,result);
  return result;
end $$;
revoke all on function public.execute_lesson_occurrence_change(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.execute_lesson_occurrence_change(uuid,text,jsonb) to service_role;

create function public.lesson_change_replay(p_actor uuid,p_key text,p_value jsonb) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare prior lesson_ops.receipts;
begin
  select * into prior from lesson_ops.receipts where key='reviewed:'||p_key;
  if prior.key is null then return null; end if;
  if prior.actor_id is distinct from p_actor or not exists(select 1 from public.memberships where user_id=p_actor and studio_id=prior.studio_id and role='coach') then raise exception 'FORBIDDEN'; end if;
  if prior.request-'reviewToken'<>p_value-'reviewToken' or (p_value?'reviewToken' and prior.request->>'reviewToken'<>p_value->>'reviewToken') then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
  return prior.response||jsonb_build_object('duplicate',true);
end $$;
revoke all on function public.lesson_change_replay(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.lesson_change_replay(uuid,text,jsonb) to service_role;

create function public.claim_lesson_change_effects(p_limit integer default 10,p_lesson uuid default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare jobs jsonb;
begin
  if p_limit not between 1 and 25 then raise exception 'VALIDATION_FAILED'; end if;
  with wanted as(select id from lesson_ops.effects where (p_lesson is null or lesson_id=p_lesson)
    and status in ('queued','failed','processing') and next_attempt_at<=now() and (claim_until is null or claim_until<=now())
    order by next_attempt_at,id for update skip locked limit p_limit), claimed as(
    update lesson_ops.effects e set status='processing',claim_token=gen_random_uuid(),claim_until=now()+interval '5 minutes',attempts=attempts+1
    where e.id in(select id from wanted) returning e.*)
  select coalesce(jsonb_agg(to_jsonb(claimed)),'[]') into jobs from claimed;
  return jsonb_build_object('effects',jobs,'tracked',p_lesson is null or exists(select 1 from lesson_ops.effects where lesson_id=p_lesson));
end $$;
revoke all on function public.claim_lesson_change_effects(integer,uuid) from public,anon,authenticated;
grant execute on function public.claim_lesson_change_effects(integer,uuid) to service_role;

create function public.finish_lesson_change_effect(p_id uuid,p_token uuid,p_outbox uuid[],p_failed boolean default false) returns boolean
language plpgsql security definer set search_path='' as $$
declare e lesson_ops.effects; l public.lessons;
begin
  select * into e from lesson_ops.effects where id=p_id for update;
  if e.claim_token is distinct from p_token or e.status<>'processing' then return false; end if;
  select * into l from public.lessons where id=e.lesson_id;
  update lesson_ops.effects set
    status=case when not lesson_ops.effect_current(e) then 'superseded' when p_failed then 'failed' else 'completed' end,
    last_error=case when p_failed then 'notification_queue_failed' else null end,
    outbox_ids=coalesce(p_outbox,'{}'),claim_token=null,claim_until=null,
    next_attempt_at=case when p_failed then now()+make_interval(secs=>least(3600,30*power(2,least(attempts,7))::integer)) else now() end where id=p_id;
  return true;
end $$;
revoke all on function public.finish_lesson_change_effect(uuid,uuid,uuid[],boolean) from public,anon,authenticated;
grant execute on function public.finish_lesson_change_effect(uuid,uuid,uuid[],boolean) to service_role;

create function lesson_ops.effect_current(e lesson_ops.effects) returns boolean
language sql stable security definer set search_path='' as $$
  select case when e.kind='cancelled' and e.booking_id is not null then
    exists(select 1 from public.bookings b where b.id=e.booking_id and b.status in ('cancelled','late_cancelled'))
    and not exists(select 1 from unnest(e.participant_ids) pid where not exists(select 1 from public.lesson_participants lp
      where lp.id=pid and lp.lesson_id=e.lesson_id and lp.booking_id=e.booking_id and lp.status='cancelled'))
  else exists(select 1 from public.lessons l where l.id=e.lesson_id and l.starts_at=(e.snapshot->>'startsAt')::timestamptz
    and l.ends_at=(e.snapshot->>'endsAt')::timestamptz and l.status::text=e.snapshot->>'status') end;
$$;
revoke all on function lesson_ops.effect_current(lesson_ops.effects) from public,anon,authenticated;

create function public.lesson_change_effect_current(p_id uuid,p_token uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from lesson_ops.effects e where e.id=p_id and e.claim_token=p_token and e.status='processing' and lesson_ops.effect_current(e));
$$;
revoke all on function public.lesson_change_effect_current(uuid,uuid) from public,anon,authenticated;
grant execute on function public.lesson_change_effect_current(uuid,uuid) to service_role;

create function lesson_ops.require_change(p_lesson uuid,p_action text,p_starts_at timestamptz,p_class boolean) returns void
language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
  result:=lesson_ops.assess_change(p_lesson,p_action,p_starts_at,p_class);
  if not (result->>'eligible')::boolean then
    if result->>'reasonCode'='reserved_credit_expires' then raise exception 'REVIEW_REQUIRED: The reserved credit expires before that date. Return the credit and review coverage first.'; end if;
    raise exception 'REVIEW_REQUIRED: %',result->>'reasonCode';
  end if;
end $$;
revoke all on function lesson_ops.require_change(uuid,text,timestamptz,boolean) from public,anon,authenticated;

create function lesson_ops.queue_effect(p_lesson uuid,p_kind text,p_students uuid[],p_participants uuid[],p_booking uuid,p_correlation text) returns uuid
language plpgsql security definer set search_path='' as $$
declare l public.lessons; effect uuid;
begin
  select * into l from public.lessons where id=p_lesson;
  insert into lesson_ops.effects(lesson_id,lesson_version,kind,student_ids,participant_ids,booking_id,snapshot,correlation_id)
    values(l.id,l.version,p_kind,p_students,p_participants,p_booking,
      jsonb_build_object('startsAt',l.starts_at,'endsAt',l.ends_at,'status',l.status),p_correlation)
    on conflict(lesson_id,lesson_version,kind,correlation_id) do update set correlation_id=excluded.correlation_id returning id into effect;
  return effect;
end $$;
revoke all on function lesson_ops.queue_effect(uuid,text,uuid[],uuid[],uuid,text) from public,anon,authenticated;

-- Existing low-level command stays the occurrence mutation boundary for coaches/imports.
create or replace function public.command_change_lesson_state(
  p_lesson_id uuid,p_expected_version integer,p_action text,p_starts_at timestamptz default null,
  p_ends_at timestamptz default null,p_queue_calendar boolean default true
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  before_lesson public.lessons; changed public.lessons; audit_id uuid; effect_id uuid;
  students uuid[]; participants uuid[]; booking_ids uuid[]; coverage jsonb; result jsonb; settlement_student uuid;
  actor uuid:=nullif(current_setting('app.lesson_actor',true),'')::uuid;
  whole_class boolean:=coalesce(nullif(current_setting('app.lesson_class',true),''),'false')::boolean;
  use_credit boolean:=coalesce(nullif(current_setting('app.use_credit',true),''),'false')::boolean;
  occurrence_key text:='occurrence:'||p_lesson_id::text||':'||p_expected_version::text||':'||p_action;
  request jsonb:=jsonb_build_object('lessonId',p_lesson_id,'version',p_expected_version,'action',p_action,
    'startsAt',p_starts_at,'endsAt',p_ends_at,'calendar',p_queue_calendar,'useCredit',use_credit,'wholeClass',whole_class);
  receipt lesson_ops.receipts;
begin
  select * into before_lesson from public.lessons where id=p_lesson_id;
  if before_lesson.id is null then raise exception 'NOT_FOUND'; end if;
  perform pg_advisory_xact_lock(hashtext(before_lesson.studio_id::text));
  perform 1 from public.students where studio_id=before_lesson.studio_id and id in (
    select student_id from public.lessons where id=p_lesson_id union select student_id from public.lesson_participants where lesson_id=p_lesson_id)
    order by id for update;
  -- Take the complete upcoming set before lot locks in credit return/recovery.
  perform 1 from public.lessons where id=p_lesson_id for update;
  select * into receipt from lesson_ops.receipts where receipts.key=occurrence_key;
  if receipt.key is not null then
    if receipt.request<>request or receipt.actor_id is distinct from actor then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
    return receipt.response||jsonb_build_object('duplicate',true);
  end if;
  select * into before_lesson from public.lessons where id=p_lesson_id;
  if before_lesson.version<>p_expected_version then raise exception 'VERSION_CONFLICT'; end if;
  if p_action='reschedule' and (p_starts_at is null or p_ends_at is null or p_ends_at<=p_starts_at) then raise exception 'VALIDATION_FAILED'; end if;
  perform lesson_ops.require_change(p_lesson_id,p_action,p_starts_at,whole_class);
  select coalesce(array_agg(id order by id),'{}'),coalesce(array_agg(distinct student_id) filter(where student_id is not null),'{}'),
    coalesce(array_agg(distinct booking_id) filter(where booking_id is not null),'{}')
    into participants,students,booking_ids from public.lesson_participants where lesson_id=p_lesson_id and status in ('reserved','confirmed');
  if before_lesson.student_id is not null and not before_lesson.student_id=any(students) then students:=array_append(students,before_lesson.student_id); end if;
  perform credit_internal.lock_upcoming(sid) from unnest(students) sid;
  perform 1 from public.bookings where id=any(booking_ids) order by id for update;
  -- Recheck after all financial boundaries are locked, including checkout JSON links.
  perform lesson_ops.require_change(p_lesson_id,p_action,p_starts_at,whole_class);
  if p_action='reschedule' then
    update public.lessons set starts_at=p_starts_at,ends_at=p_ends_at,version=version+1,updated_at=now() where id=p_lesson_id;
    -- A shared booking retains its contract dates and payment history.
    update public.bookings set starts_at=p_starts_at,ends_at=p_ends_at,reschedule_count=reschedule_count+1,version=version+1,updated_at=now()
      where id=any(booking_ids) and not exists(select 1 from public.lesson_participants lp where lp.booking_id=bookings.id and lp.lesson_id<>p_lesson_id);
  elsif p_action='cancel' then
    update public.lessons set status='cancelled',version=version+1,updated_at=now() where id=p_lesson_id;
    update public.lesson_participants set status='cancelled' where id=any(participants);
    for settlement_student in select unnest(students) order by 1 loop
      perform public.cancel_invoice_lesson(p_lesson_id,settlement_student,false,use_credit);
      perform public.settle_lesson_credits(p_lesson_id,use_credit,settlement_student);
    end loop;
    update public.lessons set package_id=case when use_credit then package_id else null end,
      payment_status=case when before_lesson.payment_status='paid_by_credit' then case when use_credit then 'paid_by_credit' else 'refunded' end else payment_status end where id=p_lesson_id;
    -- Only a booking without another active occurrence changes lifecycle state.
    update public.bookings b set status='cancelled',version=b.version+1,updated_at=now()
      where b.id=any(booking_ids) and b.status='confirmed' and not exists(select 1 from public.lesson_participants lp join public.lessons l on l.id=lp.lesson_id
        where lp.booking_id=b.id and lp.status in ('reserved','confirmed') and l.status='scheduled')
        and (current_setting('app.lesson_stop_generation',true)='true' or not exists(select 1 from public.recurring_series s
          where s.id=b.series_id and s.kind='ongoing' and s.status='active'));
  else raise exception 'VALIDATION_FAILED'; end if;
  update public.outbox_messages set status='cancelled',suppression_reason=case when p_action='cancel' then 'lesson_cancelled' else 'lesson_rescheduled' end,updated_at=now()
    where lesson_id=p_lesson_id and event_key in ('booking.reminder.student','lesson.rescheduled.student','lesson.rescheduled.coach')
      and status in ('draft','approved','queued','failed');
  if p_queue_calendar then
    insert into public.calendar_projections(lesson_id,status,last_error,next_attempt_at) values(p_lesson_id,'queued',null,now())
      on conflict(lesson_id) do update set status='queued',last_error=null,next_attempt_at=now();
  end if;
  if current_setting('app.lesson_defer_coverage',true)='true' then
    perform credit_internal.enqueue_coverage(sid) from unnest(students) sid;
  else
    coverage:='{}';
    for settlement_student in select unnest(students) order by 1 loop
      coverage:=jsonb_set(coverage,array[settlement_student::text],credit_internal.request_coverage(settlement_student));
    end loop;
  end if;
  select * into changed from public.lessons where id=p_lesson_id;
  effect_id:=lesson_ops.queue_effect(p_lesson_id,case when p_action='cancel' then 'cancelled' else 'rescheduled' end,students,participants,null,occurrence_key);
  insert into public.audit_events(studio_id,actor_id,action,entity_type,entity_id,reason,correlation_id,source,before_state,after_state)
    values(changed.studio_id,actor,'lesson.'||case when p_action='cancel' then 'cancelled' else 'rescheduled' end,'lesson',changed.id,
      coalesce(nullif(current_setting('app.lesson_reason',true),''),'Occurrence change'),occurrence_key,case when actor is null then 'provider_intake' else 'coach_portal' end,
      to_jsonb(before_lesson),to_jsonb(changed)) returning id into audit_id;
  result:=jsonb_build_object('lesson',to_jsonb(changed),'action',p_action,'bookingId',booking_ids[1],'creditCoverage',coverage,
    'auditEventId',audit_id,'changeEffectIds',jsonb_build_array(effect_id),'duplicate',false);
  insert into lesson_ops.receipts(key,actor_id,studio_id,request,response) values(occurrence_key,actor,changed.studio_id,request,result);
  return result;
end $$;


create or replace function public.finalize_booking_cancellation(
  target_booking uuid,
  expected_version integer,
  target_status text,
  refund_reference text,
  refund_amount bigint,
  correlation_id text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  b public.bookings;
  updated_booking public.bookings;
  lesson_ids uuid[] := '{}'::uuid[];
  settlement text;
  next_payment_status text;
  lid uuid; coverage jsonb;
  invoice_return bigint:=0; returned bigint; effect_ids jsonb:='[]'; effect uuid; participant_ids uuid[]; old_students uuid[];
begin
  if target_status not in ('cancelled','late_cancelled') then raise exception 'VALIDATION_FAILED'; end if;
  perform pg_advisory_xact_lock(hashtext((select studio_id::text from public.bookings where id=target_booking)));
  perform 1 from public.students where id=(select student_id from public.bookings where id=target_booking) for update;
  perform credit_internal.lock_upcoming((select student_id from public.bookings where id=target_booking));
  select * into b from public.bookings where id=target_booking for update;
  if b.id is null then raise exception 'BOOKING_NOT_FOUND'; end if;
  if b.status in ('cancelled','late_cancelled') then
    return jsonb_build_object('booking',to_jsonb(b),'lessonIds','[]'::jsonb,'duplicate',true);
  end if;
  if b.status<>'confirmed' then raise exception 'INVALID_TRANSITION:%',b.status; end if;
  if b.version<>expected_version then raise exception 'VERSION_CONFLICT:%',b.version; end if;
  if b.payment_policy='credits' and b.paid_minor>0 then raise exception 'REVIEW_REQUIRED: reconciliation_required'; end if;

  select coalesce(array_agg(distinct p.lesson_id),'{}'::uuid[]) into lesson_ids
  from public.lesson_participants p where p.booking_id=b.id;

  if b.payment_policy<>'credits' and b.paid_minor>0 and exists(select 1 from public.lessons where id=any(lesson_ids) and status<>'scheduled') then
    raise exception 'REVIEW_REQUIRED: shared_prepaid_history_review_required';
  end if;
  select coalesce(array_agg(distinct lp.lesson_id),'{}') into lesson_ids from public.lesson_participants lp join public.lessons l on l.id=lp.lesson_id
    where lp.booking_id=b.id and lp.status in ('reserved','confirmed') and l.status='scheduled';
  if array_length(lesson_ids,1) is null then raise exception 'REVIEW_REQUIRED: no_upcoming_occurrences'; end if;
  perform 1 from public.lessons where id=any(lesson_ids) order by starts_at,id for update;
  if exists(select 1 from public.lessons where id=any(lesson_ids) and invoice_payment_pending)
    or exists(select 1 from public.studio_invoices i cross join jsonb_array_elements(i.items) x where i.checkout_key is not null and i.student_id=b.student_id and x->'lessonIds' ?| array(select unnest(lesson_ids)::text))
    or b.payment_status='processing' then raise exception 'REVIEW_REQUIRED: payment_pending'; end if;
  if exists(select 1 from public.studio_invoices i cross join jsonb_array_elements(i.items) x
    where i.student_id=b.student_id and i.status not in ('draft','void') and x->'lessonIds' ?| array(select unnest(lesson_ids)::text)
      and exists(select 1 from jsonb_array_elements_text(x->'lessonIds') ref where not ref::uuid=any(lesson_ids))
      and not coalesce((x->>'cancelled')::boolean,false)) then raise exception 'REVIEW_REQUIRED: shared_invoice_review_required'; end if;
  -- Shared classes stay scheduled; their version changes because the attendee roster changes.
  update public.lessons l set version=l.version+1,updated_at=now() where l.id=any(lesson_ids) and
    exists(select 1 from public.lesson_participants lp where lp.lesson_id=l.id and lp.booking_id is distinct from b.id and lp.status in ('reserved','confirmed'));
  update public.lessons l set status=target_status::public.lesson_status,version=l.version+1,updated_at=now()
  where l.id=any(lesson_ids) and l.status not in ('cancelled','late_cancelled')
    and not exists(select 1 from public.lesson_participants lp where lp.lesson_id=l.id and lp.booking_id is distinct from b.id and lp.status in ('reserved','confirmed'));
  update public.lesson_participants set status='cancelled'
  where booking_id=b.id and lesson_id=any(lesson_ids) and status in ('reserved','confirmed');
  insert into public.calendar_projections(lesson_id,status,last_error)
  select unnest(lesson_ids),'queued',null
  on conflict(lesson_id) do update set status='queued',last_error=null;

  if b.offering_id is not null then
    update public.service_offerings
    set enrolled=greatest(0,enrolled-1),version=version+1,updated_at=now()
    where id=b.offering_id;
  end if;

  settlement:=case when current_setting('app.student_cancel',true)='true' then 'studio_credit' else coalesce(b.policy_snapshot->>'settlement','original_payment') end;
  next_payment_status:=b.payment_status;
  for lid in select unnest(lesson_ids) loop
    returned:=public.cancel_invoice_lesson(lid,b.student_id,current_setting('app.student_cancel',true)='true',target_status='late_cancelled' or coalesce(nullif(current_setting('app.use_credit',true),''),'false')::boolean);
    invoice_return:=invoice_return+returned;
    perform public.settle_lesson_credits(lid,target_status='late_cancelled' or coalesce(nullif(current_setting('app.use_credit',true),''),'false')::boolean,b.student_id);
  end loop;
  if target_status='cancelled' and b.payment_policy='credits' and not coalesce(nullif(current_setting('app.use_credit',true),''),'false')::boolean then
    next_payment_status:='refunded';
  elsif target_status='cancelled' and settlement='studio_credit' and b.paid_minor>invoice_return and b.student_id is not null then
    insert into public.payment_entries(student_id,kind,amount_minor,currency,external_reference,reason,account_credit)
    values(b.student_id,'refund',greatest(0,b.paid_minor-invoice_return),b.currency,'studio-credit:'||b.id::text,'Studio account credit for '||b.reference,true)
    on conflict(external_reference) do nothing;
    next_payment_status:='refunded';
  elsif target_status='cancelled' and settlement='original_payment' and refund_reference is not null and coalesce(refund_amount,0)>0 and b.student_id is not null then
    insert into public.payment_entries(student_id,kind,amount_minor,currency,external_reference,reason)
    values(b.student_id,'refund',refund_amount,b.currency,refund_reference,'Booking cancellation '||b.reference)
    on conflict(external_reference) do nothing;
    next_payment_status:='refunded';
  end if;

  update public.bookings
  set status=target_status,payment_status=next_payment_status,version=version+1,updated_at=now()
  where id=b.id and version=expected_version returning * into updated_booking;
  if updated_booking.id is null then raise exception 'VERSION_CONFLICT'; end if;

  insert into public.audit_events(studio_id,action,entity_type,entity_id,reason,correlation_id,source,before_state,after_state)
  values(b.studio_id,'booking.cancelled','booking',b.id,
    case when target_status='late_cancelled' then 'Late cancellation' else 'Permitted cancellation' end,
    correlation_id,'booking_platform',to_jsonb(b),to_jsonb(updated_booking));
  update public.outbox_messages set status='cancelled',suppression_reason='participation_cancelled',updated_at=now()
    where lesson_id=any(lesson_ids) and (booking_id=b.id or (booking_id is null and student_id=b.student_id))
      and event_key in ('booking.reminder.student','lesson.rescheduled.student') and status in ('draft','approved','queued','failed');
  if b.student_id is not null then coverage:=credit_internal.request_coverage(b.student_id); end if;
  for lid in select unnest(lesson_ids) loop
    select coalesce(array_agg(id),'{}') into participant_ids from public.lesson_participants where booking_id=b.id and lesson_id=lid;
    old_students:=case when b.student_id is null then '{}'::uuid[] else array[b.student_id] end;
    effect:=lesson_ops.queue_effect(lid,'cancelled',old_students,participant_ids,b.id,'booking-cancel:'||b.id::text||':'||expected_version::text);
    effect_ids:=effect_ids||jsonb_build_array(effect);
  end loop;
  return jsonb_build_object('changeEffectIds',effect_ids,'creditCoverage',coverage,'booking',to_jsonb(updated_booking),'lessonIds',to_jsonb(lesson_ids),'duplicate',false);
end $$;


create or replace function public.reschedule_booking_occurrences(
  target_booking uuid,expected_version integer,next_start timestamptz,next_end timestamptz,change_scope text default 'occurrence'
) returns public.bookings language plpgsql security definer set search_path='' as $$
declare b public.bookings; service public.booking_services; shift interval; target_ids uuid[];
  target_lesson record; updated public.bookings; sid uuid; changed jsonb;
begin
  if change_scope not in ('occurrence','series') or next_start is null or next_end is null or next_end<=next_start then raise exception 'VALIDATION_FAILED'; end if;
  select * into b from public.bookings where id=target_booking;
  if b.id is null then raise exception 'BOOKING_NOT_FOUND'; end if;
  -- Booking confirmation also takes this studio scheduling lock before student locks.
  perform pg_advisory_xact_lock(hashtext(b.studio_id::text));
  perform 1 from public.students where id in (
    select student_id from public.lesson_participants where lesson_id in(select lesson_id from public.lesson_participants where booking_id=b.id)
    union select b.student_id) order by id for update;
  select * into b from public.bookings where id=target_booking for update;
  if b.version<>expected_version then raise exception 'VERSION_CONFLICT'; end if;
  if b.status<>'confirmed' then raise exception 'INVALID_TRANSITION'; end if;
  if b.reschedule_count>=cast(b.policy_snapshot->>'rescheduleLimit' as integer) then raise exception 'RESCHEDULE_LIMIT_REACHED'; end if;
  select * into service from public.booking_services where id=b.service_id;

  select array_agg(id order by starts_at,id) into target_ids from public.lessons
    where id in(select lesson_id from public.lesson_participants where booking_id=b.id) and status='scheduled';
  if change_scope='occurrence' then target_ids:=target_ids[1:1]; end if;
  shift:=next_start-(select starts_at from public.lessons where id=target_ids[1]);
  if coalesce(array_length(target_ids,1),0)=0 then raise exception 'INVALID_TRANSITION'; end if;
  perform 1 from public.lessons where id=any(target_ids) order by starts_at,id for update;
  for target_lesson in select * from public.lessons where id=any(target_ids) order by starts_at,id loop
    if target_lesson.invoice_payment_pending then raise exception 'INVALID_TRANSITION: Check or cancel the pending online invoice payment first.'; end if;
    if exists(select 1 from public.package_credit_entries e join public.packages p on p.id=e.package_id
      where e.lesson_id=target_lesson.id and p.expires_at<=target_lesson.starts_at+shift group by p.id having sum(e.quantity)<0) then
      raise exception 'VALIDATION_FAILED: The reserved credit expires before that date. Return the credit and review coverage first.';
    end if;
    if exists(select 1 from public.lessons l where l.studio_id=b.studio_id and l.status='scheduled' and not(l.id=any(target_ids))
      and tstzrange(l.starts_at,l.ends_at,'[)') && tstzrange((target_lesson.starts_at+shift)-make_interval(mins=>service.buffer_before_minutes),
        (target_lesson.ends_at+shift)+make_interval(mins=>service.buffer_after_minutes),'[)')) then raise exception 'SLOT_UNAVAILABLE'; end if;
  end loop;
  perform set_config('app.lesson_defer_coverage','true',true);
  for target_lesson in select * from public.lessons where id=any(target_ids) order by starts_at,id loop
    changed:=public.command_change_lesson_state(target_lesson.id,target_lesson.version,'reschedule',target_lesson.starts_at+shift,target_lesson.ends_at+shift,true);
  end loop;
  perform set_config('app.lesson_defer_coverage','false',true);
  for sid in select distinct student_id from public.lesson_participants where lesson_id=any(target_ids) and student_id is not null and status in ('reserved','confirmed') order by student_id loop perform credit_internal.request_coverage(sid); end loop;
  -- Contract dates change only for an explicitly requested whole-booking series shift.
  if change_scope='series' and exists(select 1 from public.bookings where id=b.id and version=b.version) then
    update public.bookings set starts_at=next_start,ends_at=next_end,reschedule_count=reschedule_count+1,version=version+1,updated_at=now() where id=b.id;
  end if;
  if change_scope='occurrence' then update public.bookings set reschedule_count=reschedule_count+1,version=version+1,updated_at=now() where id=b.id and version=b.version; end if;
  select * into updated from public.bookings where id=b.id;
  insert into public.audit_events(studio_id,action,entity_type,entity_id,reason,correlation_id,source,before_state,after_state)
    values(b.studio_id,'booking.rescheduled','booking',b.id,'Permitted self-service reschedule','booking-reschedule:'||b.id::text||':'||expected_version::text,'booking_platform',to_jsonb(b),to_jsonb(updated));
  return updated;
end $$;

create or replace function public.extend_ongoing_series() returns integer language plpgsql security definer set search_path='' as $$
declare row_data record; last_start timestamptz; next_start timestamptz; next_end timestamptz; step_size interval; lesson_id uuid; created integer:=0;
begin
  for row_data in select s.id,s.kind,s.cadence,s.studio_id,s.service_id,b.id booking_id,b.student_id,b.guest_name,b.guest_email,b.location,b.timezone,b.starts_at booking_start,b.ends_at booking_end,svc.name service_name from public.recurring_series s join public.bookings b on b.series_id=s.id join public.booking_services svc on svc.id=s.service_id where s.kind='ongoing' and s.status='active' and b.status='confirmed' and b.payment_status<>'past_due' order by b.student_id,s.id loop
    perform pg_advisory_xact_lock(hashtext(row_data.studio_id::text));
    perform 1 from public.recurring_series where id=row_data.id for update;
    if not exists(select 1 from public.recurring_series s join public.bookings b on b.series_id=s.id where s.id=row_data.id and s.status='active' and b.id=row_data.booking_id and b.status='confirmed') then continue; end if;
    perform 1 from public.students where id=row_data.student_id for update;
    perform pg_advisory_xact_lock(hashtext(row_data.id::text));
    select max(starts_at) into last_start from public.lessons where series_id=row_data.id;
    last_start=coalesce(last_start,row_data.booking_start);
    step_size=case when row_data.cadence='biweekly' then interval '14 days' else interval '7 days' end;
    while last_start<now()+interval '12 weeks' loop
      next_start=((last_start at time zone row_data.timezone)+step_size) at time zone row_data.timezone; next_end=next_start+(row_data.booking_end-row_data.booking_start);
      if not exists(select 1 from public.lessons where series_id=row_data.id and starts_at=next_start) then
        insert into public.lessons(studio_id,student_id,topic,starts_at,ends_at,status,location_type,location_label,service_id,series_id,meeting_provider,capacity)
        values(row_data.studio_id,row_data.student_id,row_data.service_name,next_start,next_end,'scheduled',case when row_data.location='in_person' then 'in_person' else 'virtual' end,case when row_data.location='in_person' then 'Studio' else 'Google Meet' end,row_data.service_id,row_data.id,row_data.location,1) returning id into lesson_id;
        insert into public.lesson_participants(lesson_id,booking_id,student_id,display_name,email,status) values(lesson_id,row_data.booking_id,row_data.student_id,row_data.guest_name,row_data.guest_email,'confirmed');
        insert into public.calendar_projections(lesson_id,status,conference_request_id) values(lesson_id,'queued',case when row_data.location='google_meet' then 'meet-'||lesson_id::text else null end); created=created+1;
      end if;
      last_start=next_start;
    end loop;
    if row_data.student_id is not null then perform credit_internal.request_coverage(row_data.student_id); end if;
  end loop;
  return created;
end $$;

create or replace function public.cancel_booking_credit(p_booking uuid,p_version integer,p_use boolean default false,p_student_action boolean default false) returns jsonb
language plpgsql security definer set search_path='' as $$
declare b public.bookings; late boolean;
begin
  select * into b from public.bookings where id=p_booking;
  if b.id is null then raise exception 'NOT_FOUND'; end if;
  perform pg_advisory_xact_lock(hashtext(b.studio_id::text));
  perform credit_internal.lock_upcoming(b.student_id);
  perform 1 from public.students where id=b.student_id for update;
  select * into b from public.bookings where id=p_booking for update;
  if exists(select 1 from public.studio_invoices i cross join jsonb_array_elements(i.items) x
    where i.student_id=b.student_id and i.checkout_key is not null and x->'lessonIds' ?| array(select lesson_id::text from public.lesson_participants where booking_id=b.id)) then
    raise exception 'INVALID_TRANSITION: Check or cancel the pending online invoice payment first.';
  end if;
  late:=p_student_action and b.starts_at-now()<make_interval(hours=>coalesce((b.policy_snapshot->>'cancellationWindowHours')::integer,0));
  perform set_config('app.student_cancel',p_student_action::text,true);
  perform set_config('app.use_credit',(p_use or late)::text,true);
  return public.finalize_booking_cancellation(b.id,p_version,case when late then 'late_cancelled' else 'cancelled' end,null,0,'cancel-credit:'||b.id::text||':'||p_version::text);
end $$;
