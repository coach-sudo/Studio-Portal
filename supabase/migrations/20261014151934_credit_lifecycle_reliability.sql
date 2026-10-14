-- Depends on 20261014142813_credit_coverage_diagnostics. No balances are migrated.
-- Recovery intent is explicit at command boundaries, never a recursive ledger trigger.
create table credit_internal.credit_coverage_jobs (
  student_id uuid primary key references public.students(id) on delete restrict,
  requested_version integer not null,
  completed_version integer,
  generation bigint not null default 1,
  completed_generation bigint not null default 0,
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  last_error text,
  last_result jsonb,
  updated_at timestamptz not null default now()
);
create index credit_coverage_jobs_pending on credit_internal.credit_coverage_jobs(next_attempt_at,student_id)
  where generation > completed_generation;
create table credit_internal.coverage_sweep (
  singleton boolean primary key default true check(singleton),
  cursor uuid
);
insert into credit_internal.coverage_sweep(singleton) values(true);
create table credit_internal.credit_command_receipts (
  key text primary key,
  student_id uuid not null references public.students(id),
  actor_id uuid,
  request jsonb not null,
  response jsonb not null,
  created_at timestamptz not null default now()
);
alter table credit_internal.credit_coverage_jobs enable row level security;
alter table credit_internal.coverage_sweep enable row level security;
alter table credit_internal.credit_command_receipts enable row level security;
revoke all on credit_internal.credit_coverage_jobs,credit_internal.coverage_sweep,credit_internal.credit_command_receipts from public,anon,authenticated,service_role;
-- Access is through service-only RPCs; even the worker cannot read receipt bodies.

create function credit_internal.enqueue_coverage(p_student uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
  insert into credit_internal.credit_coverage_jobs(student_id,requested_version)
  select s.id,coalesce(a.version,1) from public.students s
    left join public.student_credit_accounts a on a.student_id=s.id
    where s.id=p_student and s.deleted_at is null
  on conflict(student_id) do update set
    requested_version=excluded.requested_version,generation=credit_coverage_jobs.generation+1,
    next_attempt_at=now(),updated_at=now();
end $$;
revoke all on function credit_internal.enqueue_coverage(uuid) from public,anon,authenticated;

create function credit_internal.lock_upcoming(p_student uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
  perform 1 from public.lessons x join public.students s on s.id=p_student and s.studio_id=x.studio_id
    where x.status='scheduled' and x.starts_at>=now() and
      (x.student_id=p_student or exists(select 1 from public.lesson_participants lp
        where lp.lesson_id=x.id and lp.student_id=p_student and lp.status in ('reserved','confirmed')))
    order by x.starts_at,x.id for update of x;
end $$;
revoke all on function credit_internal.lock_upcoming(uuid) from public,anon,authenticated;

-- The student lock serializes grants and reservations. Count actual ledger inserts,
-- rather than UUID returns (which also describe pre-existing reservations).
create function credit_internal.apply_upcoming(p_student uuid,p_manual boolean default false) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  l record; evaluation jsonb; pkg uuid; before_entries bigint; inserted integer;
  applied integer:=0; covered integer:=0; skipped integer:=0; failed integer:=0;
  reasons jsonb:='{}'; errors jsonb:='{}'; code text; needs_review boolean;
begin
  perform 1 from public.students where id=p_student and deleted_at is null for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  needs_review:=(public.student_credit_summary(p_student)->>'needsReview')::boolean;
  -- Lock the complete relevant set in chronological order before taking lot locks.
  perform credit_internal.lock_upcoming(p_student);
  for l in select x.id from public.lessons x join public.students s on s.id=p_student and s.studio_id=x.studio_id
    where x.status='scheduled' and x.starts_at>=now() and
      (x.student_id=p_student or exists(select 1 from public.lesson_participants lp
        where lp.lesson_id=x.id and lp.student_id=p_student and lp.status in ('reserved','confirmed')))
    order by x.starts_at,x.id
  loop
    begin
      evaluation:=credit_internal.evaluate_student_lesson_credit(p_student,l.id,
        case when p_manual then 'manual' else 'automatic' end,'{}',null,needs_review);
      if evaluation->>'state'='covered' then covered:=covered+1;
      elsif coalesce((evaluation->>'eligible')::boolean,false) then
        select count(*) into before_entries from public.package_credit_entries e
          join public.packages p on p.id=e.package_id where p.student_id=p_student and e.lesson_id=l.id and e.quantity<0;
        pkg:=public.reserve_student_lesson_credit(l.id,p_student,null,p_manual);
        select (count(*)-before_entries)::integer into inserted from public.package_credit_entries e
          join public.packages p on p.id=e.package_id where p.student_id=p_student and e.lesson_id=l.id and e.quantity<0;
        if inserted>0 then applied:=applied+inserted;
        elsif pkg is not null then covered:=covered+1;
        else
          evaluation:=credit_internal.evaluate_student_lesson_credit(p_student,l.id,
            case when p_manual then 'manual' else 'automatic' end);
          code:=evaluation->>'reasonCode'; skipped:=skipped+1;
          reasons:=jsonb_set(reasons,array[code],to_jsonb(coalesce((reasons->>code)::integer,0)+1));
        end if;
      else
        code:=evaluation->>'reasonCode'; skipped:=skipped+1;
        reasons:=jsonb_set(reasons,array[code],to_jsonb(coalesce((reasons->>code)::integer,0)+1));
      end if;
    exception
      when serialization_failure or deadlock_detected then raise;
      when others then
        -- The failed lesson's ledger/invoice writes roll back together. Store codes only.
        failed:=failed+1;
        errors:=jsonb_set(errors,array[sqlstate],to_jsonb(coalesce((errors->>sqlstate)::integer,0)+1));
    end;
  end loop;
  return public.student_credit_summary(p_student)||jsonb_build_object(
    'applied',applied,'alreadyCovered',covered,'skipped',skipped,'failed',failed,
    'skipReasons',reasons,'failureCodes',errors,'autoApplyPending',failed>0);
end $$;
revoke all on function credit_internal.apply_upcoming(uuid,boolean) from public,anon,authenticated;

create function credit_internal.request_coverage(p_student uuid,p_manual boolean default false) returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb; failed boolean; version_now integer;
begin
  perform 1 from public.students where id=p_student and deleted_at is null for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  perform credit_internal.enqueue_coverage(p_student);
  begin
    result:=credit_internal.apply_upcoming(p_student,p_manual);
  exception
    when others then
      -- A grant and its recovery intent survive a coverage failure, never a partial debit.
      result:=public.student_credit_summary(p_student)||jsonb_build_object('applied',0,'alreadyCovered',0,
        'skipped',0,'failed',1,'skipReasons','{}'::jsonb,'failureCodes',jsonb_build_object(sqlstate,1),'autoApplyPending',true);
  end;
  failed:=(result->>'failed')::integer>0;
  select version into version_now from public.student_credit_accounts where student_id=p_student;
  update credit_internal.credit_coverage_jobs set
    requested_version=coalesce(version_now,1),
    completed_version=case when failed then completed_version else coalesce(version_now,1) end,
    completed_generation=case when failed then completed_generation else generation end,
    attempts=case when failed then attempts+1 else 0 end,
    next_attempt_at=case when failed then now()+make_interval(secs=>least(3600,30*power(2,least(attempts,7))::integer)) else now() end,
    last_error=case when failed then 'coverage_failed' else null end,last_result=result,updated_at=now()
    where student_id=p_student;
  return result;
end $$;
revoke all on function credit_internal.request_coverage(uuid,boolean) from public,anon,authenticated;

create or replace function public.reserve_student_upcoming_credits(p_student uuid) returns jsonb
language sql security definer set search_path='' as $$
  select credit_internal.request_coverage(p_student);
$$;
revoke all on function public.reserve_student_upcoming_credits(uuid) from public,anon,authenticated;
grant execute on function public.reserve_student_upcoming_credits(uuid) to service_role;

-- Bounded, durable keyset sweep. Failed jobs keep their backoff; new events may wake them.
create function public.credit_coverage_work(p_limit integer default 25) returns jsonb
language plpgsql security definer set search_path='' as $$
declare last_id uuid; ids uuid[]; sid uuid;
begin
  if p_limit not between 1 and 100 then raise exception 'VALIDATION_FAILED'; end if;
  select cursor into last_id from credit_internal.coverage_sweep where singleton for update;
  select array_agg(x.student_id order by x.student_id) into ids from (
    select a.student_id from public.student_credit_accounts a join public.students s on s.id=a.student_id
    where a.auto_apply=true and s.deleted_at is null and (last_id is null or a.student_id>last_id)
    order by a.student_id limit p_limit) x;
  if ids is null then
    update credit_internal.coverage_sweep set cursor=null where singleton;
  else
    foreach sid in array ids loop
      if not exists(select 1 from credit_internal.credit_coverage_jobs where student_id=sid and generation>completed_generation) then
        perform credit_internal.enqueue_coverage(sid);
      end if;
    end loop;
    update credit_internal.coverage_sweep set cursor=ids[array_length(ids,1)] where singleton;
  end if;
  return coalesce((select jsonb_agg(x.student_id) from (
    select j.student_id from credit_internal.credit_coverage_jobs j join public.students s on s.id=j.student_id
    where j.generation>j.completed_generation and j.next_attempt_at<=now() and s.deleted_at is null
    order by j.next_attempt_at,j.student_id limit p_limit) x),'[]'::jsonb);
end $$;
revoke all on function public.credit_coverage_work(integer) from public,anon,authenticated;
grant execute on function public.credit_coverage_work(integer) to service_role;

create function public.process_credit_coverage_job(p_student uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare job credit_internal.credit_coverage_jobs;
begin
  perform 1 from public.students where id=p_student and deleted_at is null for update;
  if not found then return jsonb_build_object('processed',false); end if;
  select * into job from credit_internal.credit_coverage_jobs where student_id=p_student for update;
  if job.student_id is null or job.generation<=job.completed_generation or job.next_attempt_at>now() then
    return jsonb_build_object('processed',false);
  end if;
  return credit_internal.request_coverage(p_student)||jsonb_build_object('processed',true);
end $$;
revoke all on function public.process_credit_coverage_job(uuid) from public,anon,authenticated;
grant execute on function public.process_credit_coverage_job(uuid) to service_role;

create function public.defer_credit_coverage_job(p_student uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
  perform 1 from public.students where id=p_student for update;
  update credit_internal.credit_coverage_jobs set attempts=attempts+1,last_error='worker_unavailable',
    next_attempt_at=now()+make_interval(secs=>least(3600,30*power(2,least(attempts,7))::integer)),updated_at=now()
    where student_id=p_student and generation>completed_generation and next_attempt_at<=now();
end $$;
revoke all on function public.defer_credit_coverage_job(uuid) from public,anon,authenticated;
grant execute on function public.defer_credit_coverage_job(uuid) to service_role;

create function credit_internal.cover_lesson_students(p_lesson uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare sid uuid; results jsonb:='{}'; studio uuid;
begin
  select studio_id into studio from public.lessons where id=p_lesson;
  for sid in select s.id from public.students s where s.studio_id=studio and s.deleted_at is null and s.id in (
    select student_id from public.lessons where id=p_lesson union
    select student_id from public.lesson_participants where lesson_id=p_lesson)
    order by s.id
  loop
    results:=jsonb_set(results,array[sid::text],credit_internal.request_coverage(sid));
  end loop;
  return results;
end $$;
revoke all on function credit_internal.cover_lesson_students(uuid) from public,anon,authenticated;

create function public.command_grant_student_credits(
  p_student uuid,p_key text,p_value jsonb,p_actor uuid default null
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  s public.students; pkg public.packages; entry public.package_credit_entries; prior credit_internal.credit_command_receipts;
  quantity integer:=(p_value->>'quantity')::integer; kind public.credit_entry_kind:=(p_value->>'kind')::public.credit_entry_kind;
  lid uuid:=(p_value->>'lessonId')::uuid; reason text:=trim(p_value->>'reason'); def public.package_definitions;
  result jsonb; coverage jsonb; audit_id uuid; request jsonb:=p_value;
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
    if p_value->>'packageId' is not null then
      select * into pkg from public.packages where id=(p_value->>'packageId')::uuid and student_id=s.id for update;
      if pkg.id is null then raise exception 'FORBIDDEN'; end if;
    elsif p_value->'package' is not null then
      select * into def from public.package_definitions where id=(p_value->'package'->>'definitionId')::uuid and studio_id=s.studio_id and active;
      if def.id is null or quantity<>def.session_count or quantity<=0 then raise exception 'VALIDATION_FAILED: Package changed; review the quote.'; end if;
      insert into public.packages(student_id,definition_id,name,price_minor,currency,expires_at,stripe_price_id,credit_quantity,auto_apply)
      values(s.id,def.id,p_value->'package'->>'name',(p_value->'package'->>'priceMinor')::bigint,
        p_value->'package'->>'currency',case when def.expiration_days is null then null else now()+make_interval(days=>def.expiration_days) end,
        p_value->'package'->>'stripePriceId',quantity,coalesce((select auto_apply from public.student_credit_accounts where student_id=s.id),false)) returning * into pkg;
    else
      select * into pkg from public.packages where student_id=s.id and name='Studio lesson credits' and expires_at is null order by created_at,id limit 1 for update;
      if pkg.id is null then insert into public.packages(student_id,name) values(s.id,'Studio lesson credits') returning * into pkg; end if;
    end if;
    if quantity<0 and ((public.student_credit_summary(s.id)->>'needsReview')::boolean or public.package_credit_balance(pkg.id)+quantity<0) then
      raise exception 'CREDIT_UNAVAILABLE: Reserved credits cannot be removed.';
    end if;
    insert into public.package_credit_entries(package_id,lesson_id,kind,quantity,reason,idempotency_key,created_by)
      values(pkg.id,lid,kind,quantity,reason,p_key,p_actor) returning * into entry;
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
revoke all on function public.command_grant_student_credits(uuid,text,jsonb,uuid) from public,anon,authenticated;
grant execute on function public.command_grant_student_credits(uuid,text,jsonb,uuid) to service_role;

-- Stable replay results and audit evidence commit with coach settings changes.
create function public.command_student_credit_settings(
  p_student uuid,p_command text,p_value jsonb,p_version integer,p_key text,p_actor uuid
) returns jsonb language plpgsql security definer set search_path='' as $$
declare s public.students; prior credit_internal.credit_command_receipts; result jsonb; audit_id uuid;
  request jsonb:=jsonb_build_object('command',p_command,'value',p_value,'version',p_version);
begin
  select * into s from public.students where id=p_student and deleted_at is null for update;
  if s.id is null or p_actor is null or not exists(select 1 from public.memberships
    where user_id=p_actor and studio_id=s.studio_id and role='coach') then raise exception 'FORBIDDEN'; end if;
  if p_key is null or length(p_key)<3 or length(p_key)>250 then raise exception 'VALIDATION_FAILED'; end if;
  select * into prior from credit_internal.credit_command_receipts where key=p_key;
  if prior.key is not null then
    if prior.student_id<>p_student or prior.actor_id is distinct from p_actor or prior.request<>request then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
    return prior.response||jsonb_build_object('duplicate',true);
  end if;
  if p_command='set_total' then
    result:=public.set_student_credit_total(p_student,(p_value->>'total')::integer,p_version,p_value->>'reason','credit-total:'||p_key);
  elsif p_command='set_auto' then
    if jsonb_typeof(p_value->'enabled') is distinct from 'boolean' then raise exception 'VALIDATION_FAILED'; end if;
    result:=public.set_student_credit_auto(p_student,(p_value->>'enabled')::boolean,p_version);
  elsif p_command='apply_upcoming' then
    if coalesce((select version from public.student_credit_accounts where student_id=p_student),1)<>p_version then raise exception 'VERSION_CONFLICT'; end if;
    if (select auto_apply from public.student_credit_accounts where student_id=p_student) is distinct from true then
      raise exception 'INVALID_TRANSITION: Review and enable automatic credit use first.';
    end if;
    -- Applying again never changes the preference. Manual per-lesson use remains separate.
    result:=credit_internal.request_coverage(p_student);
  else raise exception 'VALIDATION_FAILED'; end if;
  insert into public.audit_events(studio_id,actor_id,action,entity_type,entity_id,reason,correlation_id,source,after_state)
    values(s.studio_id,p_actor,'credits.'||p_command,'student',s.id,coalesce(p_value->>'reason','Coach reviewed credit coverage'),p_key,'coach_portal',result)
    returning id into audit_id;
  result:=result||jsonb_build_object('auditEventId',audit_id);
  insert into credit_internal.credit_command_receipts(key,student_id,actor_id,request,response) values(p_key,s.id,p_actor,request,result);
  return result;
end $$;
revoke all on function public.command_student_credit_settings(uuid,text,jsonb,integer,text,uuid) from public,anon,authenticated;
grant execute on function public.command_student_credit_settings(uuid,text,jsonb,integer,text,uuid) to service_role;


-- Mixed legacy preferences and uncertain external payment policy require coach review.
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
      if p_mode <> 'manual' and l.source_provider is not null and l.source_provider <> 'studio' then
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


create or replace function public.set_student_credit_auto(p_student uuid,p_enabled boolean,p_version integer) returns jsonb
language plpgsql security definer set search_path='' as $$
declare coverage jsonb;
begin
  perform 1 from public.students where id=p_student for update;
  insert into public.student_credit_accounts(student_id) values(p_student) on conflict do nothing;
  if p_enabled and (public.student_credit_summary(p_student)->>'needsReview')::boolean then raise exception 'INVALID_TRANSITION: Review legacy credit reservations before enabling automatic use.'; end if;
  update public.student_credit_accounts set auto_apply=p_enabled,version=version+1,updated_at=now() where student_id=p_student and version=p_version;
  if not found then raise exception 'VERSION_CONFLICT'; end if;
  update public.packages set auto_apply=p_enabled where student_id=p_student;
  coverage:=credit_internal.request_coverage(p_student);
  return coverage;
end $$;


create or replace function public.set_student_credit_total(p_student uuid,p_target integer,p_version integer,p_reason text,p_key text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare summary jsonb; delta integer; pkg uuid; lot record; take integer;
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
    select id into pkg from public.packages where student_id=p_student and name='Studio lesson credits' and expires_at is null order by created_at,id limit 1;
    if pkg is null then insert into public.packages(student_id,name) values(p_student,'Studio lesson credits') returning id into pkg; end if;
    insert into public.package_credit_entries(package_id,kind,quantity,reason,idempotency_key) values(pkg,'adjustment',delta,p_reason,p_key||':add');
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


create or replace function public.command_make_lesson_recurring(
  p_lesson_id uuid,
  p_expected_version integer,
  p_cadence text,
  p_occurrence_count integer,
  p_timezone text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  base public.lessons%rowtype;
  created_series public.recurring_series%rowtype;
  created_lesson public.lessons%rowtype;
  interval_days integer;
  i integer;
  local_start timestamp;
  local_end timestamp;
  coverage jsonb;
begin
  if p_cadence not in ('weekly', 'biweekly') or p_occurrence_count < 2 or p_occurrence_count > 52 then
    raise exception 'VALIDATION_FAILED: Choose weekly or biweekly and 2–52 occurrences.';
  end if;

  perform 1 from public.students where id in (
    select student_id from public.lessons where id=p_lesson_id union
    select student_id from public.lesson_participants where lesson_id=p_lesson_id) order by id for update;
  select * into base from public.lessons where id = p_lesson_id for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if base.version <> p_expected_version then raise exception 'VERSION_CONFLICT:%', p_expected_version; end if;
  if base.status <> 'scheduled' then raise exception 'INVALID_TRANSITION: Only scheduled lessons can become recurring.'; end if;
  if base.series_id is not null then raise exception 'INVALID_TRANSITION: This lesson already belongs to a series.'; end if;

  interval_days := case when p_cadence = 'biweekly' then 14 else 7 end;
  insert into public.recurring_series (
    studio_id, service_id, student_id, kind, cadence, status, starts_on,
    occurrence_count, payment_policy, recurrence_rule, meeting_provider
  ) values (
    base.studio_id, base.service_id, base.student_id, 'fixed', p_cadence, 'active', base.starts_at,
    p_occurrence_count, 'pay_later',
    jsonb_build_object('intervalWeeks', case when p_cadence = 'biweekly' then 2 else 1 end,
      'slots', jsonb_build_array(jsonb_build_object('weekday', extract(dow from base.starts_at at time zone p_timezone)::integer,
      'time', to_char(base.starts_at at time zone p_timezone, 'HH24:MI')))),
    base.meeting_provider
  ) returning * into created_series;

  update public.lessons
  set series_id = created_series.id, version = version + 1, updated_at = now()
  where id = base.id;
  insert into public.calendar_projections (lesson_id, status)
  values (base.id, 'queued') on conflict (lesson_id) do update set status = 'queued', last_error = null;

  local_start := base.starts_at at time zone p_timezone;
  local_end := base.ends_at at time zone p_timezone;
  for i in 1..p_occurrence_count - 1 loop
    insert into public.lessons (
      studio_id, student_id, topic, starts_at, ends_at, status, location_type, location_label,
      join_url, package_id, service_id, series_id, meeting_provider, capacity, source_provider
    ) values (
      base.studio_id, base.student_id, base.topic,
      (local_start + make_interval(days => interval_days * i)) at time zone p_timezone,
      (local_end + make_interval(days => interval_days * i)) at time zone p_timezone,
      'scheduled', base.location_type, base.location_label, null, base.package_id,
      base.service_id, created_series.id, base.meeting_provider, base.capacity, 'studio'
    ) returning * into created_lesson;

    insert into public.lesson_participants (lesson_id, booking_id, student_id, display_name, email, status)
      select created_lesson.id, null, student_id, display_name, email, status
      from public.lesson_participants where lesson_id = base.id;
    insert into public.calendar_projections (lesson_id, status) values (created_lesson.id, 'queued');
  end loop;

  coverage:=credit_internal.cover_lesson_students(base.id);
  return jsonb_build_object('seriesId', created_series.id, 'occurrenceCount', p_occurrence_count,'creditCoverage',coverage);
end;
$$;


create or replace function public.command_change_lesson_state(
  p_lesson_id uuid,
  p_expected_version integer,
  p_action text,
  p_starts_at timestamptz default null,
  p_ends_at timestamptz default null,
  p_queue_calendar boolean default true
) returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  current_lesson public.lessons%rowtype;
  changed_lesson public.lessons%rowtype;
  linked_booking_id uuid;
  debit record;
  coverage jsonb;
begin
  if p_action not in ('reschedule','cancel') then
    raise exception 'VALIDATION_FAILED: Unsupported lesson change';
  end if;

  perform 1 from public.students where id in(select student_id from public.lesson_participants where lesson_id=p_lesson_id union select student_id from public.lessons where id=p_lesson_id) order by id for update;
  select * into current_lesson
  from public.lessons
  where id=p_lesson_id
  for update;

  if not found then raise exception 'NOT_FOUND'; end if;
  if current_lesson.version <> p_expected_version then
    raise exception 'VERSION_CONFLICT:%', p_expected_version;
  end if;

  select booking_id into linked_booking_id
  from public.lesson_participants
  where lesson_id=p_lesson_id and booking_id is not null
  order by created_at
  limit 1;

  if current_lesson.invoice_payment_pending then raise exception 'INVALID_TRANSITION: Check or cancel the pending online invoice payment first.'; end if;
  if p_action='reschedule' then
    if current_lesson.status <> 'scheduled' then
      raise exception 'VALIDATION_FAILED: Only scheduled lessons can be rescheduled';
    end if;
    if p_starts_at is null or p_ends_at is null or p_ends_at <= p_starts_at then
      raise exception 'VALIDATION_FAILED: A valid lesson time is required';
    end if;
    if exists(select 1 from public.package_credit_entries e join public.packages p on p.id=e.package_id where e.lesson_id=p_lesson_id and p.expires_at<=p_starts_at group by p.id having sum(e.quantity)<0) then
      raise exception 'VALIDATION_FAILED: The reserved credit expires before that date. Return the credit and review coverage first.';
    end if;
    update public.lessons
      set starts_at=p_starts_at,ends_at=p_ends_at,version=version+1,updated_at=now()
      where id=p_lesson_id
      returning * into changed_lesson;
    if linked_booking_id is not null then
      update public.bookings
      set starts_at=p_starts_at,ends_at=p_ends_at,reschedule_count=reschedule_count+1,
          version=version+1,updated_at=now()
      where id=linked_booking_id;
    end if;
  else
    if current_lesson.status<>'scheduled' then raise exception 'INVALID_TRANSITION'; end if;
    update public.lessons
      set status='cancelled',version=version+1,updated_at=now()
      where id=p_lesson_id
      returning * into changed_lesson;
    update public.lesson_participants set status='cancelled'
      where lesson_id=p_lesson_id and status in ('reserved','confirmed');
    if linked_booking_id is not null then
      update public.bookings
      set status='cancelled',version=version+1,updated_at=now()
      where id in (select booking_id from public.lesson_participants where lesson_id=p_lesson_id) and status not in ('cancelled','late_cancelled','completed');
    end if;
    perform public.cancel_invoice_lesson(p_lesson_id,null,false,coalesce(nullif(current_setting('app.use_credit',true),''),'false')::boolean);
    perform public.settle_lesson_credits(p_lesson_id,coalesce(nullif(current_setting('app.use_credit',true),''),'false')::boolean);
    update public.lessons set package_id=case when current_setting('app.use_credit',true)='true' then package_id else null end,
      payment_status=case when current_lesson.payment_status='paid_by_credit' then case when current_setting('app.use_credit',true)='true' then 'paid_by_credit' else 'refunded' end else payment_status end where id=p_lesson_id;
    select * into changed_lesson from public.lessons where id=p_lesson_id;
  end if;

  update public.outbox_messages
    set status='cancelled',updated_at=now()
    where status in ('draft','approved','queued','failed')
      and event_key='booking.reminder.student'
      and (lesson_id=p_lesson_id or booking_id=linked_booking_id);

  if p_queue_calendar then
    insert into public.calendar_projections(lesson_id,status,last_error,next_attempt_at)
    values(p_lesson_id,'queued',null,now())
    on conflict(lesson_id) do update
      set status='queued',last_error=null,next_attempt_at=now(),attempts=0;
  end if;

  coverage:=credit_internal.cover_lesson_students(p_lesson_id);
  select * into changed_lesson from public.lessons where id=p_lesson_id;
  return jsonb_build_object(
    'creditCoverage',coverage,
    'lesson',to_jsonb(changed_lesson),
    'bookingId',linked_booking_id,
    'action',p_action
  );
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
  invoice_return bigint:=0; returned bigint;
begin
  if target_status not in ('cancelled','late_cancelled') then raise exception 'VALIDATION_FAILED'; end if;
  perform 1 from public.students where id=(select student_id from public.bookings where id=target_booking) for update;
  select * into b from public.bookings where id=target_booking for update;
  if b.id is null then raise exception 'BOOKING_NOT_FOUND'; end if;
  if b.status in ('cancelled','late_cancelled') then
    return jsonb_build_object('booking',to_jsonb(b),'lessonIds','[]'::jsonb,'duplicate',true);
  end if;
  if b.status<>'confirmed' then raise exception 'INVALID_TRANSITION:%',b.status; end if;
  if b.version<>expected_version then raise exception 'VERSION_CONFLICT:%',b.version; end if;

  select coalesce(array_agg(distinct p.lesson_id),'{}'::uuid[]) into lesson_ids
  from public.lesson_participants p where p.booking_id=b.id;

  update public.lessons l set status=target_status::public.lesson_status,version=l.version+1,updated_at=now()
  where l.id=any(lesson_ids) and l.status not in ('cancelled','late_cancelled')
    and not exists(select 1 from public.lesson_participants lp where lp.lesson_id=l.id and lp.booking_id<>b.id and lp.status in ('reserved','confirmed'));
  update public.lesson_participants set status='cancelled'
  where booking_id=b.id and status<>'cancelled';
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
  if b.student_id is not null then coverage:=credit_internal.request_coverage(b.student_id); end if;
  return jsonb_build_object('creditCoverage',coverage,'booking',to_jsonb(updated_booking),'lessonIds',to_jsonb(lesson_ids),'duplicate',false);
end $$;


create or replace function public.command_complete_lesson(
  lesson_id uuid, expected_version integer, reason text, idempotency_key text, correlation_id text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare target public.lessons; audit_id uuid; response jsonb;
begin
  if exists(select 1 from public.idempotency_keys k where k.key=command_complete_lesson.idempotency_key) then
    return (select k.response from public.idempotency_keys k where k.key=command_complete_lesson.idempotency_key);
  end if;
  perform 1 from public.students where id in(select l.student_id from public.lessons l where l.id=command_complete_lesson.lesson_id union select lp.student_id from public.lesson_participants lp where lp.lesson_id=command_complete_lesson.lesson_id) order by id for update;
  select * into target from public.lessons where id=lesson_id for update;
  if target.id is null then raise exception 'LESSON_NOT_FOUND'; end if;
  if not public.is_studio_coach(target.studio_id) then raise exception 'FORBIDDEN'; end if;
  if target.version<>expected_version then raise exception 'VERSION_CONFLICT:%',target.version; end if;
  if target.status<>'scheduled' then raise exception 'INVALID_TRANSITION:%',target.status; end if;
  update public.lessons set status='completed',version=version+1,updated_at=now() where id=lesson_id returning * into target;
  -- A booking reservation or an explicit "use credit" action is already a debit.
  -- Only consume here when no negative ledger entry exists for this lesson.
  if target.package_id is not null and not exists(
    select 1 from public.package_credit_entries e
    where e.lesson_id=target.id group by e.package_id having sum(e.quantity)<0
  ) then
    if public.reserve_student_lesson_credit(target.id,target.student_id,target.package_id,true,reason) is null then raise exception 'CREDIT_UNAVAILABLE'; end if;
  end if;
  insert into public.recommendations(studio_id,student_id,entity_type,entity_id,reason_code,title,explanation,evidence,urgency,due_at,suggested_action,requires_confirmation,dedupe_key)
  values(target.studio_id,target.student_id,'lesson',target.id,'lesson_note_missing','Write lesson note','The lesson is complete and no follow-up note exists.',jsonb_build_array('Lesson completed','No note created'),4,now()+interval '48 hours','open_note_editor',false,'lesson_note_missing:'||target.id)
  on conflict(dedupe_key) do update set status='open',updated_at=now();
  insert into public.calendar_projections(lesson_id,projected_version,status)
  values(target.id,0,'queued') on conflict on constraint calendar_projections_lesson_id_key do update set status='queued',last_error=null;
  insert into public.audit_events(studio_id,actor_id,action,entity_type,entity_id,reason,correlation_id,source,before_state,after_state)
  values(target.studio_id,(select auth.uid()),'lesson.completed','lesson',target.id,reason,correlation_id,'coach_portal',jsonb_build_object('status','scheduled','version',expected_version),to_jsonb(target)) returning id into audit_id;
  response=jsonb_build_object('creditCoverage',credit_internal.cover_lesson_students(target.id),'resource',to_jsonb(target),'auditEventId',audit_id,'queuedSideEffects',jsonb_build_array('calendar_projection'),'recommendations',jsonb_build_array('lesson_note_missing'));
  insert into public.idempotency_keys(key,actor_id,command,request_hash,response)
  values(command_complete_lesson.idempotency_key,(select auth.uid()),'complete_lesson',encode(extensions.digest(command_complete_lesson.idempotency_key||lesson_id::text,'sha256'),'hex'),response);
  return response;
end $$;


create or replace function public.command_create_lesson(
  target_studio uuid,target_student uuid,topic text,starts_at timestamptz,ends_at timestamptz,
  location_type text,location_label text,student_name text,student_email text,
  recurrence text,occurrence_count integer,timezone text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare created public.lessons; recurring_result jsonb; coverage jsonb;
begin
  if ends_at<=starts_at or location_type not in ('virtual','in_person') then raise exception 'VALIDATION_FAILED'; end if;
  if not exists(select 1 from public.students s where s.id=target_student and s.studio_id=target_studio and s.deleted_at is null) then raise exception 'STUDENT_NOT_FOUND'; end if;
  perform 1 from public.students where id=target_student for update;
  insert into public.lessons(studio_id,student_id,topic,starts_at,ends_at,status,location_type,location_label,meeting_provider,source_provider)
  values(target_studio,target_student,coalesce(nullif(trim(topic),''),'Private coaching'),starts_at,ends_at,'scheduled',location_type,
    coalesce(nullif(trim(location_label),''),case when location_type='in_person' then 'In person' else 'Google Meet' end),
    case when location_type='in_person' then 'in_person' else 'google_meet' end,'studio') returning * into created;
  insert into public.lesson_participants(lesson_id,student_id,display_name,email,status)
  values(created.id,target_student,coalesce(nullif(trim(student_name),''),'Student'),coalesce(trim(student_email),''),'confirmed');
  insert into public.calendar_projections(lesson_id,status) values(created.id,'queued');
  if recurrence in ('weekly','biweekly') and occurrence_count>1 then
    recurring_result:=public.command_make_lesson_recurring(created.id,created.version,recurrence,occurrence_count,timezone);
    select * into created from public.lessons where id=created.id;
  end if;
  if recurring_result is not null then coverage:=recurring_result->'creditCoverage'->target_student::text;
  else coverage:=public.reserve_student_upcoming_credits(target_student); end if;
  select * into created from public.lessons where id=created.id;
  return jsonb_build_object('creditCoverage',coverage,'lesson',to_jsonb(created),'recurrence',coalesce(recurring_result,'{}'::jsonb));
end $$;


create or replace function public.claim_package_gift(
  target_gift uuid,
  target_student uuid,
  apply_automatically boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  gift public.package_gifts;
  definition public.package_definitions;
  created_package public.packages;
  paid_price bigint;
  paid_currency text;
  coverage jsonb;
begin
  perform 1 from public.students where id=target_student and deleted_at is null for update;
  if not found then raise exception 'STUDENT_NOT_FOUND'; end if;
  select * into gift
  from public.package_gifts
  where id = target_gift
  for update;

  if not found then raise exception 'GIFT_NOT_FOUND'; end if;
  if not exists(select 1 from public.students where id=target_student and studio_id=gift.studio_id and deleted_at is null) then raise exception 'FORBIDDEN'; end if;
  if gift.status = 'claimed' then
    if gift.claimed_student_id <> target_student then
      raise exception 'GIFT_ALREADY_CLAIMED';
    end if;
    return jsonb_build_object('packageId', gift.package_id, 'duplicate', true);
  end if;
  if gift.status not in ('purchased', 'delivered')
     or gift.expires_at <= now()
     or (gift.deliver_at is not null and gift.deliver_at > now()) then
    raise exception 'GIFT_NOT_AVAILABLE';
  end if;

  select * into definition
  from public.package_definitions
  where id = gift.definition_id;

  -- Signed webhook receipts retain the quote even when the catalog changes before delivery.
  select
    coalesce((payload #>> '{data,object,metadata,package_price_minor}')::bigint,
             (payload #>> '{data,object,amount_total}')::bigint),
    upper(coalesce(payload #>> '{data,object,metadata,package_currency}',
                   payload #>> '{data,object,currency}'))
  into paid_price, paid_currency
  from public.webhook_events
  where provider = 'stripe'
    and event_type in ('checkout.session.completed', 'checkout.session.async_payment_succeeded')
    and payload #>> '{data,object,metadata,package_gift_id}' = gift.id::text
    and payload #>> '{data,object,id}' = gift.stripe_checkout_session_id
    and payload #>> '{data,object,payment_status}' = 'paid'
  limit 1;

  insert into public.packages (
    student_id,
    name,
    price_minor,
    currency,
    expires_at,
    credit_quantity,
    definition_id,
    auto_apply
  )
  values (
    target_student,
    'Gift · ' || definition.name,
    coalesce(paid_price, definition.price_minor),
    coalesce(paid_currency, definition.currency),
    case
      when definition.expiration_days is null then null
      else now() + make_interval(days => definition.expiration_days)
    end,
    definition.session_count,
    definition.id,
    apply_automatically
  )
  returning * into created_package;

  insert into public.package_credit_entries (
    package_id,
    kind,
    quantity,
    reason,
    idempotency_key
  )
  values (
    created_package.id,
    'purchase',
    definition.session_count,
    'Package gift',
    'package-gift:' || gift.id::text || ':delivery'
  );

  update public.package_gifts
  set package_id = created_package.id,
      claimed_student_id = target_student,
      status = 'claimed',
      updated_at = now()
  where id = gift.id;

  coverage:=credit_internal.request_coverage(target_student);
  return jsonb_build_object('packageId', created_package.id, 'duplicate', false,'creditCoverage',coverage);
end
$$;


create or replace function public.process_stripe_checkout(event_id text,event_type text,event_payload jsonb,session_id text,student_id uuid,package_id uuid,amount_minor bigint,currency text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare coverage jsonb; pkg public.packages; payment_id uuid; duplicate boolean:=false; prior_status text;
begin
  perform 1 from public.students where id=student_id and deleted_at is null for update;
  if not found then raise exception 'STUDENT_NOT_FOUND'; end if;
  perform credit_internal.lock_upcoming(student_id);
  select status into prior_status from public.webhook_events where id=event_id for update;
  if prior_status='processed' then return jsonb_build_object('duplicate',true,'eventId',event_id); end if;
  insert into public.webhook_events(id,provider,event_type,payload,status) values(event_id,'stripe',event_type,event_payload,'processing')
  on conflict(id) do update set event_type=excluded.event_type,payload=excluded.payload,status='processing',error=null,processed_at=null;
  select * into pkg from public.packages where id=package_id and packages.student_id=process_stripe_checkout.student_id for update;
  if pkg.id is null then update public.webhook_events set status='failed',error='Package not found',processed_at=now() where id=event_id; raise exception 'PACKAGE_NOT_FOUND'; end if;
  insert into public.payment_entries(student_id,package_id,kind,amount_minor,currency,external_reference,reason)
  values(student_id,package_id,'payment',amount_minor,upper(currency),session_id,'Stripe Checkout payment')
  on conflict(external_reference) do nothing returning id into payment_id;
  if payment_id is not null then
    insert into public.package_credit_entries(package_id,kind,quantity,reason,idempotency_key)
    values(package_id,'purchase',pkg.credit_quantity,'Stripe Checkout purchase','stripe-credit:'||session_id) on conflict(idempotency_key) do nothing;
  else duplicate:=true; end if;
  coverage:=credit_internal.request_coverage(student_id);
  update public.webhook_events set status='processed',processed_at=now(),error=null where id=event_id;
  return jsonb_build_object('creditCoverage',coverage,'duplicate',duplicate,'eventId',event_id,'paymentId',payment_id);
exception when others then update public.webhook_events set status='failed',error=sqlerrm,processed_at=now() where id=event_id; raise;
end $$;


create or replace function credit_internal.read_student_credit_coverage(
  p_student uuid, p_page integer, p_page_size integer, p_preview_enable boolean
) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  summary jsonb;
  l record;
  result jsonb;
  items jsonb := '[]'::jsonb;
  allocated jsonb := '{}'::jsonb;
  total integer := 0;
  covered integer := 0;
  eligible integer := 0;
  uncovered integer := 0;
  review_required integer := 0;
  selected_package text;
  lessons_visible boolean;
begin
  perform credit_internal.require_student_finance(p_student);
  if p_page is null or p_page < 1 or p_page > 1000000
     or p_page_size is null or p_page_size < 1 or p_page_size > 100
     or p_preview_enable is null then
    raise exception 'VALIDATION_FAILED: Coverage page size must be 1-100.' using errcode = '22023';
  end if;
  summary := public.student_credit_summary(p_student);
  lessons_visible := current_setting('role', true) = 'service_role' or public.can_view_student_schedule(p_student);
  if lessons_visible then
    for l in select x.id, x.topic, x.starts_at, x.ends_at, x.version from public.lessons x
      join public.students s on s.id = p_student and s.studio_id = x.studio_id
      where x.status = 'scheduled' and x.starts_at >= now()
        and (x.student_id = p_student or exists(select 1 from public.lesson_participants lp
          where lp.lesson_id = x.id and lp.student_id = p_student and lp.status in ('reserved', 'confirmed')))
      order by x.starts_at, x.id
    loop
      result := credit_internal.evaluate_student_lesson_credit(p_student, l.id,
        case when p_preview_enable then 'enable_preview' else 'automatic' end, allocated, null,
        (summary->>'needsReview')::boolean);
      total := total + 1;
      if result->>'state' = 'covered' then covered := covered + 1;
      elsif (result->>'eligible')::boolean then
        eligible := eligible + 1;
        selected_package := result->>'packageId';
        allocated := jsonb_set(allocated, array[selected_package],
          to_jsonb(coalesce((allocated->>selected_package)::integer, 0) + 1));
      else
        uncovered := uncovered + 1;
        if result->>'state' = 'review_required' then review_required := review_required + 1; end if;
      end if;
      if total > (p_page::bigint - 1) * p_page_size and total <= p_page::bigint * p_page_size then
        items := items || jsonb_build_array(result || jsonb_build_object(
          'lessonId', l.id, 'topic', l.topic, 'startsAt', l.starts_at, 'endsAt', l.ends_at, 'version', l.version));
      end if;
    end loop;
  end if;
  return jsonb_build_object('studentId', p_student, 'evaluatedAt', now(),
    'summary', summary - 'lots',
    'maintenance', (select jsonb_build_object('pending',generation>completed_generation,
      'requestedVersion',requested_version,'completedVersion',completed_version,'attempts',attempts,
      'lastError',last_error,'updatedAt',updated_at) from credit_internal.credit_coverage_jobs where student_id=p_student), 'previewEnable', p_preview_enable,
    'settingReasonCode', case when summary->'autoApply' = 'null'::jsonb then 'mixed_settings_review' end,
    'lessonsVisible', lessons_visible, 'items', items,
    'page', p_page, 'pageSize', p_page_size, 'total', case when lessons_visible then total end,
    'hasMore', lessons_visible and total > p_page::bigint * p_page_size,
    'counts', case when lessons_visible then jsonb_build_object('covered', covered,
      'eligible', eligible, 'uncovered', uncovered, 'reviewRequired', review_required) end);
end;
$$;


create or replace function public.confirm_booking(target_booking uuid,target_hold uuid,amount_paid bigint,provider_reference text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare coverage jsonb; before_entries bigint; direct_applied integer; b public.bookings; service public.booking_services; student public.students; series_record public.recurring_series; lesson_id uuid; occurrence_id uuid; audit_id uuid; credit_package uuid; credit_count integer:=1; occurrence_total integer; step_size interval; next_start timestamptz; next_end timestamptz;
begin
  select * into b from public.bookings where id=target_booking;
  if b.id is null then raise exception 'BOOKING_NOT_FOUND'; end if;
  if b.status='confirmed' then return jsonb_build_object('bookingId',b.id,'studentId',b.student_id,'duplicate',true); end if;
  select * into service from public.booking_services where id=b.service_id;
  perform pg_advisory_xact_lock(hashtext(b.studio_id::text));
  select * into b from public.bookings where id=target_booking;
  if b.status='confirmed' then return jsonb_build_object('bookingId',b.id,'studentId',b.student_id,'duplicate',true); end if;
  if b.offering_id is null and exists(select 1 from public.lessons l where l.studio_id=b.studio_id and l.status='scheduled' and tstzrange(l.starts_at,l.ends_at,'[)') && tstzrange(b.starts_at-make_interval(mins=>service.buffer_before_minutes),b.ends_at+make_interval(mins=>service.buffer_after_minutes),'[)')) then raise exception 'SLOT_UNAVAILABLE'; end if;
  if b.student_id is not null then
    select * into student from public.students where id=b.student_id and studio_id=b.studio_id and deleted_at is null;
  end if;
  if student.id is null then
    select * into student
    from public.students s
    where s.studio_id=b.studio_id and s.deleted_at is null and (
      (nullif(trim(b.guest_email),'') is not null and lower(s.email)=lower(b.guest_email))
      or (
        regexp_replace(lower(trim(s.full_name)),'\s+',' ','g')=regexp_replace(lower(trim(b.guest_name)),'\s+',' ','g')
        and (
          (nullif(trim(b.guardian_email),'') is not null and lower(s.guardian_email)=lower(b.guardian_email))
          or (nullif(trim(b.guest_email),'') is not null and lower(s.guardian_email)=lower(b.guest_email))
          or (nullif(trim(b.guardian_email),'') is not null and lower(s.email)=lower(b.guardian_email))
        )
      )
    )
    order by case when lower(s.email)=lower(b.guest_email) then 0 else 1 end,s.created_at limit 1;
  end if;
  if student.id is null then
    insert into public.students(studio_id,full_name,email,status,is_minor,guardian_name,guardian_email,portal_enabled)
    values(b.studio_id,b.guest_name,lower(b.guest_email),'lead',b.for_minor,b.guardian_name,b.guardian_email,true) returning * into student;
  else
    update public.students set
      guardian_name=coalesce(nullif(guardian_name,''),nullif(b.guardian_name,'')),
      guardian_email=coalesce(nullif(guardian_email,''),nullif(lower(b.guardian_email),'')),
      updated_at=now()
    where id=student.id returning * into student;
  end if;
  if b.series_id is not null then select * into series_record from public.recurring_series where id=b.series_id; credit_count=case when series_record.kind='ongoing' then 1 else coalesce(series_record.occurrence_count,1) end; end if;
  perform 1 from public.students where id=student.id for update;
  select * into b from public.bookings where id=target_booking for update;
  if b.status='confirmed' then return jsonb_build_object('bookingId',b.id,'studentId',b.student_id,'duplicate',true); end if;
  update public.bookings set student_id=student.id,status='confirmed',payment_status=case when payment_policy='credits' then 'paid' when amount_paid>=total_minor then 'paid' when amount_paid>0 then 'partially_paid' when payment_policy='pay_later' then 'due' else payment_status end,paid_minor=amount_paid,version=version+1,updated_at=now() where id=b.id returning * into b;
  update public.booking_holds set status='converted' where id=target_hold or id=any(b.hold_ids);
  if b.offering_id is null then
    insert into public.lessons(studio_id,student_id,topic,starts_at,ends_at,status,location_type,location_label,service_id,series_id,meeting_provider,capacity,source_provider)
    values(b.studio_id,student.id,service.name,b.starts_at,b.ends_at,'scheduled',case when b.location='in_person' then 'in_person' else 'virtual' end,case when b.location='in_person' then 'Studio' else 'Google Meet' end,b.service_id,b.series_id,b.location,1,'studio') returning id into lesson_id;
    insert into public.lesson_participants(lesson_id,booking_id,student_id,display_name,email,status) values(lesson_id,b.id,student.id,b.guest_name,b.guest_email,'confirmed');
    insert into public.calendar_projections(lesson_id,projected_version,status,conference_request_id) values(lesson_id,0,'queued',case when b.location='google_meet' then 'meet-'||lesson_id::text else null end);
    if b.series_id is not null then
      select * into series_record from public.recurring_series where id=b.series_id;
      occurrence_total=case when series_record.kind='ongoing' then 12 else coalesce(series_record.occurrence_count,6) end;
      step_size=case when series_record.cadence='biweekly' then interval '14 days' else interval '7 days' end;
      for idx in 1..occurrence_total-1 loop
        next_start=((b.starts_at at time zone b.timezone)+idx*step_size) at time zone b.timezone;
        next_end=next_start+(b.ends_at-b.starts_at);
        if exists(select 1 from public.lessons l where l.studio_id=b.studio_id and l.status='scheduled' and tstzrange(l.starts_at,l.ends_at,'[)') && tstzrange(next_start-make_interval(mins=>service.buffer_before_minutes),next_end+make_interval(mins=>service.buffer_after_minutes),'[)')) then raise exception 'SLOT_UNAVAILABLE'; end if;
        insert into public.lessons(studio_id,student_id,topic,starts_at,ends_at,status,location_type,location_label,service_id,series_id,meeting_provider,capacity,source_provider)
        values(b.studio_id,student.id,service.name,next_start,next_end,'scheduled',case when b.location='in_person' then 'in_person' else 'virtual' end,case when b.location='in_person' then 'Studio' else 'Google Meet' end,b.service_id,b.series_id,b.location,1,'studio') returning id into occurrence_id;
      insert into public.lesson_participants(lesson_id,booking_id,student_id,display_name,email,status) values(occurrence_id,b.id,student.id,b.guest_name,b.guest_email,'confirmed');
        insert into public.calendar_projections(lesson_id,projected_version,status,conference_request_id) values(occurrence_id,0,'queued',case when b.location='google_meet' then 'meet-'||occurrence_id::text else null end);
      end loop;
    end if;
  else
    update public.service_offerings set enrolled=enrolled+1,version=version+1,updated_at=now() where id=b.offering_id and enrolled<capacity returning lesson_ids[1] into lesson_id;
    if lesson_id is null then raise exception 'OFFERING_FULL'; end if;
    foreach occurrence_id in array (select lesson_ids from public.service_offerings where id=b.offering_id) loop
      insert into public.lesson_participants(lesson_id,booking_id,student_id,display_name,email,status) values(occurrence_id,b.id,student.id,b.guest_name,b.guest_email,'confirmed') on conflict on constraint lesson_participants_lesson_id_email_key do nothing;
    end loop;
  end if;
  select count(*) into before_entries from public.package_credit_entries e join public.packages p on p.id=e.package_id where p.student_id=student.id and e.quantity<0;
  for occurrence_id in select lp.lesson_id from public.lesson_participants lp join public.lessons l on l.id=lp.lesson_id where lp.booking_id=b.id order by l.starts_at,l.id loop
    if b.payment_policy='credits' and (series_record.kind is distinct from 'ongoing' or occurrence_id=lesson_id) then
      credit_package:=public.reserve_student_lesson_credit(occurrence_id,student.id,null,true,'Booking reservation '||b.reference);
      if credit_package is null then raise exception 'CREDIT_UNAVAILABLE: Not enough valid credits for the booked lessons.'; end if;
    elsif b.payment_policy in ('credits','pay_later') then
      perform public.reserve_student_lesson_credit(occurrence_id,student.id);
    end if;
  end loop;
  select (count(*)-before_entries)::integer into direct_applied from public.package_credit_entries e join public.packages p on p.id=e.package_id where p.student_id=student.id and e.quantity<0;
  coverage:=credit_internal.request_coverage(student.id);
  coverage:=coverage||jsonb_build_object('applied',(coverage->>'applied')::integer+direct_applied,
    'alreadyCovered',greatest(0,(coverage->>'alreadyCovered')::integer-direct_applied));
  if amount_paid>0 then insert into public.payment_entries(student_id,kind,amount_minor,currency,external_reference,reason) values(student.id,'payment',amount_paid,b.currency,provider_reference,'Booking payment '||b.reference) on conflict(external_reference) do nothing; end if;
  insert into public.audit_events(studio_id,action,entity_type,entity_id,reason,correlation_id,source,after_state)
  values(b.studio_id,'booking.confirmed','booking',b.id,'Payment or policy requirement satisfied',coalesce(provider_reference,b.reference),'booking_platform',to_jsonb(b)) returning id into audit_id;
  return jsonb_build_object('creditCoverage',coverage,'bookingId',b.id,'studentId',student.id,'lessonId',lesson_id,'auditEventId',audit_id,'duplicate',false);
end $$;


create or replace function public.extend_ongoing_series() returns integer language plpgsql security definer set search_path='' as $$
declare row_data record; last_start timestamptz; next_start timestamptz; next_end timestamptz; step_size interval; lesson_id uuid; created integer:=0;
begin
  for row_data in select s.id,s.kind,s.cadence,s.studio_id,s.service_id,b.id booking_id,b.student_id,b.guest_name,b.guest_email,b.location,b.timezone,b.starts_at booking_start,b.ends_at booking_end,svc.name service_name from public.recurring_series s join public.bookings b on b.series_id=s.id join public.booking_services svc on svc.id=s.service_id where s.kind='ongoing' and s.status='active' and b.status='confirmed' and b.payment_status<>'past_due' order by b.student_id,s.id loop
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


create or replace function public.settle_studio_invoice(p_invoice uuid,p_amount bigint,p_method text,p_reference text,p_version integer default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare coverage jsonb; inv public.studio_invoices; item jsonb; new_items jsonb:='[]'; allocations jsonb:='[]'; remainder bigint:=p_amount; take bigint; line_due bigint; pkg uuid; def public.package_definitions; lid uuid; balance bigint;
begin
  select * into inv from public.studio_invoices where id=p_invoice;
  if inv.id is null then raise exception 'NOT_FOUND'; end if;
  perform 1 from public.students where id=inv.student_id for update;
  select * into inv from public.studio_invoices where id=p_invoice for update;
  if exists(select 1 from public.invoice_settlements where reference=p_reference and invoice_id=p_invoice) then return to_jsonb(inv); end if;
  if inv.status not in ('open','partially_paid') or p_amount<=0 or p_amount>inv.total_minor-inv.paid_minor-inv.credit_minor-inv.waived_minor then raise exception 'VALIDATION_FAILED: Payment exceeds outstanding balance or invoice is not payable.'; end if;
  if inv.checkout_key is not null and (p_method<>'stripe' or current_setting('app.invoice_checkout_key',true) is distinct from inv.checkout_key) then raise exception 'INVALID_TRANSITION: An online payment is pending. Check or cancel it first.'; end if;
  if p_version is not null and inv.version<>p_version then raise exception 'VERSION_CONFLICT'; end if;
  if p_method='account_credit' then
    select coalesce(sum(case when kind='refund' then amount_minor else -amount_minor end),0) into balance from public.payment_entries where student_id=inv.student_id and currency=inv.currency and account_credit;
    if p_amount>balance then raise exception 'CREDIT_UNAVAILABLE'; end if;
  elsif p_method not in ('stripe','cash','bank') then raise exception 'VALIDATION_FAILED'; end if;
  for item in select value from jsonb_array_elements(inv.items) loop
    line_due:=(item->>'quantity')::bigint*(item->>'unitMinor')::bigint-coalesce((item->>'creditMinor')::bigint,0)-coalesce((item->>'paidMinor')::bigint,0)-coalesce((item->>'waivedMinor')::bigint,0);
    take:=least(remainder,line_due);
    if take>0 then
      item:=jsonb_set(item,'{paidMinor}',to_jsonb(coalesce((item->>'paidMinor')::bigint,0)+take));
      allocations:=allocations||jsonb_build_array(jsonb_build_object('lineId',item->>'id','amountMinor',take));
      remainder:=remainder-take;
      if item->>'kind'='package' and take=line_due and item->>'packageId' is null then
        select * into def from public.package_definitions where id=(item->>'referenceId')::uuid and studio_id=inv.studio_id;
        if def.id is null then raise exception 'NOT_FOUND: Package definition'; end if;
        insert into public.packages(student_id,definition_id,name,price_minor,currency,expires_at,credit_quantity,auto_apply)
          values(inv.student_id,def.id,item->>'description',(item->>'quantity')::integer*(item->>'unitMinor')::bigint,inv.currency,
            case when item->>'expirationDays' is null then null else now()+make_interval(days=>(item->>'expirationDays')::integer) end,
            coalesce((item->>'creditQuantity')::integer,(item->>'quantity')::integer*def.session_count),coalesce((select auto_apply from public.student_credit_accounts where student_id=inv.student_id),false)) returning id into pkg;
        insert into public.package_credit_entries(package_id,kind,quantity,reason,idempotency_key) values(pkg,'purchase',coalesce((item->>'creditQuantity')::integer,(item->>'quantity')::integer*def.session_count),'Invoice '||inv.number,'invoice-package:'||inv.id::text||':'||(item->>'id'));
        item:=jsonb_set(item,'{packageId}',to_jsonb(pkg::text));
      elsif item->>'kind'='service' then
        for lid in select value::uuid from jsonb_array_elements_text(coalesce(item->'lessonIds','[]')) loop
          update public.lessons set paid_minor=least(coalesce(price_minor,(item->>'unitMinor')::bigint),coalesce(paid_minor,0)+take/greatest(1,jsonb_array_length(item->'lessonIds'))),
          payment_status=case when take=line_due then 'paid' else 'partially_paid' end,version=version+1,updated_at=now()
          where id=lid and student_id=inv.student_id;
          update public.bookings b set paid_minor=(select coalesce(sum(l.paid_minor),0) from public.lessons l join public.lesson_participants lp on lp.lesson_id=l.id where lp.booking_id=b.id),
            payment_status=case when not exists(select 1 from public.lessons l join public.lesson_participants lp on lp.lesson_id=l.id where lp.booking_id=b.id and l.payment_status not in ('paid','paid_by_credit','waived')) then 'paid' else 'partially_paid' end,version=b.version+1,updated_at=now()
            where b.student_id=inv.student_id and b.id in(select booking_id from public.lesson_participants where lesson_id=lid and student_id=inv.student_id);
        end loop;
      end if;
    end if;
    new_items:=new_items||jsonb_build_array(item);
  end loop;
  insert into public.invoice_settlements(invoice_id,amount_minor,method,reference,allocations) values(inv.id,p_amount,p_method,p_reference,allocations);
  -- Dollar credit is spent as an adjustment; externally received payments remain in the existing ledger.
  insert into public.payment_entries(student_id,kind,amount_minor,currency,external_reference,reason,account_credit)
    values(inv.student_id,case when p_method='account_credit' then 'adjustment'::public.payment_entry_kind else 'payment'::public.payment_entry_kind end,p_amount,inv.currency,p_reference,'Invoice '||inv.number||' · '||p_method,p_method='account_credit');
  update public.studio_invoices set items=new_items,paid_minor=paid_minor+p_amount,
    status=case when paid_minor+p_amount+credit_minor+waived_minor=total_minor then 'paid' else 'partially_paid' end,
    version=version+1,updated_at=now() where id=inv.id returning * into inv;
  coverage:=public.reserve_student_upcoming_credits(inv.student_id);
  return (select to_jsonb(i) from public.studio_invoices i where i.id=inv.id)||jsonb_build_object('creditCoverage',coverage);
end $$;


create or replace function public.void_studio_invoice(p_invoice uuid,p_version integer) returns jsonb
language plpgsql security definer set search_path='' as $$
declare inv public.studio_invoices; item jsonb; lid uuid;
begin
  select * into inv from public.studio_invoices where id=p_invoice;
  if inv.id is null then raise exception 'NOT_FOUND'; end if;
  perform 1 from public.students where id=inv.student_id for update;
  select * into inv from public.studio_invoices where id=p_invoice for update;
  if inv.version<>p_version then raise exception 'VERSION_CONFLICT'; end if;
  if inv.paid_minor>0 or inv.credit_minor>0 then raise exception 'INVALID_TRANSITION'; end if;
  if inv.checkout_key is not null then raise exception 'INVALID_TRANSITION: An online payment is pending.'; end if;
  for item in select value from jsonb_array_elements(inv.items) loop
    for lid in select value::uuid from jsonb_array_elements_text(item->'lessonIds') loop
      update public.lessons set invoice_id=null,price_minor=(item->'originalLesson'->>'priceMinor')::bigint,payment_status=coalesce(item->'originalLesson'->>'paymentStatus','untracked'),service_id=(item->'originalLesson'->>'serviceId')::uuid,version=version+1,updated_at=now()
      where id=lid and invoice_id=inv.id and student_id=inv.student_id and paid_minor=0 and payment_status in ('due','waived');
    end loop;
  end loop;
  update public.studio_invoices set status='void',version=version+1,updated_at=now() where id=inv.id returning * into inv;
  return to_jsonb(inv)||jsonb_build_object('creditCoverage',credit_internal.request_coverage(inv.student_id));
end $$;

-- Existing protected E2E cleanup removes its ledger/lessons before deleting owners.
-- This narrow service-only hook removes private state for those empty fixtures only.
create function public.cleanup_credit_coverage_fixture(p_student uuid,p_run text) returns void
language plpgsql security definer set search_path='' as $$
begin
  if p_run !~ '^e2e-[a-z0-9][a-z0-9-]{2,46}[a-z0-9]$' or p_run is null then raise exception 'FORBIDDEN'; end if;
  perform 1 from public.students where id=p_student and starts_with(full_name,p_run||' ') for update;
  if not found then
    if exists(select 1 from public.students where id=p_student) then raise exception 'FORBIDDEN'; end if;
    return;
  end if;
  if exists(select 1 from public.packages where student_id=p_student)
    or exists(select 1 from public.lessons where student_id=p_student)
    or exists(select 1 from public.lesson_participants where student_id=p_student)
    or exists(select 1 from public.payment_entries where student_id=p_student)
    or exists(select 1 from public.studio_invoices where student_id=p_student) then raise exception 'FORBIDDEN'; end if;
  delete from credit_internal.credit_command_receipts where student_id=p_student;
  delete from credit_internal.credit_coverage_jobs where student_id=p_student;
end $$;
revoke all on function public.cleanup_credit_coverage_fixture(uuid,text) from public,anon,authenticated;
grant execute on function public.cleanup_credit_coverage_fixture(uuid,text) to service_role;
