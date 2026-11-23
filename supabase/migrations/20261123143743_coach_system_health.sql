-- Coach diagnostics store only allowlisted observations and incident references.
create schema studio_health_internal;
revoke all on schema studio_health_internal from public, anon, authenticated, service_role;
create table studio_health_internal.checkpoints (
  studio_id uuid primary key references public.studios(id) on delete cascade,
  checked_at timestamptz,
  automatic_at timestamptz,
  automatic_attempt_at timestamptz,
  lease uuid,
  lease_until timestamptz,
  observations jsonb not null default '[]'
);
create table studio_health_internal.issues (
  studio_id uuid not null references public.studios(id) on delete cascade,
  id uuid not null default gen_random_uuid(),
  service text not null check (service in ('calendar','email','stripe','jobs','access')),
  issue_key text not null,
  evidence jsonb not null,
  first_seen timestamptz not null default now(),
  last_seen timestamptz not null default now(),
  occurrences integer not null default 1,
  resolved_at timestamptz,
  primary key (studio_id, service, issue_key),
  unique (studio_id, id)
);
create index studio_health_issues_history_idx
  on studio_health_internal.issues(studio_id, last_seen desc);
alter table studio_health_internal.checkpoints enable row level security;
alter table studio_health_internal.issues enable row level security;
revoke all on all tables in schema studio_health_internal from public, anon, authenticated, service_role;

-- Fence Gmail requests before submission. A lost response cannot be replayed by
-- either the scheduled claimant or the targeted delivery path.
alter table public.outbox_messages add column delivery_provider_started_at timestamptz;
create or replace function public.claim_booking_reminders(batch_size integer default 50)
returns setof public.outbox_messages language plpgsql security definer set search_path='' as $$
begin
  return query with claimed as (
    select id from public.outbox_messages
    where status in ('approved','queued','failed') and delivery_provider_started_at is null
      and send_at<=now() and coalesce(next_attempt_at,now())<=now()
    order by priority desc,send_at,id for update skip locked limit batch_size
  )
  update public.outbox_messages o set status='sending',attempts=attempts+1,updated_at=now()
  from claimed where o.id=claimed.id returning o.*;
end $$;

-- The scheduler replaces the latest receipt on each dispatch. Keep its last
-- verified completion even while a subsequent execution is pending or failed.
alter table worker_internal.scheduled_jobs add column last_success_at timestamptz;
update worker_internal.scheduled_jobs set last_success_at=finished_at where state='succeeded';
create function worker_internal.remember_success() returns trigger
language plpgsql set search_path='' as $$
begin
  if new.state='succeeded' then new.last_success_at=new.finished_at; end if;
  return new;
end $$;
create trigger scheduled_worker_last_success before update of state on worker_internal.scheduled_jobs
for each row execute function worker_internal.remember_success();

create index studio_health_email_evidence_idx on public.outbox_messages(studio_id, updated_at desc)
  where channel='email';
create index studio_health_stripe_evidence_idx on public.webhook_events(received_at desc)
  where provider='stripe';
create index studio_health_retry_audit_idx on public.audit_events(studio_id, entity_id, created_at desc)
  where action in ('system_health.retry_calendar','system_health.retry_email');

create function public.studio_health_due() returns setof uuid
language sql stable security definer set search_path='' set statement_timeout='4s' as $$
  select s.id from public.studios s
  left join studio_health_internal.checkpoints c on c.studio_id=s.id
  where (c.automatic_at is null or c.automatic_at < now()-interval '10 minutes')
    and (c.lease_until is null or c.lease_until < now())
  order by c.automatic_attempt_at nulls first,s.id limit 3
$$;

create function public.studio_health_claim(p_studio uuid, p_automatic boolean) returns uuid
language sql security definer set search_path='' as $$
  insert into studio_health_internal.checkpoints(studio_id,lease,lease_until,automatic_attempt_at)
  values(p_studio,gen_random_uuid(),now()+interval '45 seconds',case when p_automatic then now() end)
  on conflict(studio_id) do update set lease=excluded.lease,lease_until=excluded.lease_until,
    automatic_attempt_at=coalesce(excluded.automatic_attempt_at,checkpoints.automatic_attempt_at)
  where (checkpoints.lease_until is null or checkpoints.lease_until<now())
    and (checkpoints.checked_at is null or checkpoints.checked_at<now()-interval '30 seconds'
      or (p_automatic and (checkpoints.automatic_at is null or checkpoints.automatic_at<now()-interval '10 minutes')))
  returning lease
$$;

create function public.studio_health_studio_slug(p_studio uuid) returns text
language sql stable security definer set search_path='' as $$
  select slug from public.studios where id=p_studio
$$;

create function public.studio_health_evidence(p_studio uuid,p_service text,p_owner boolean) returns jsonb
language plpgsql stable security definer set search_path='' set statement_timeout='3s' as $$
declare recent timestamptz; problems jsonb:='[]'; pending integer:=0; completed boolean:=true; job record;
begin
  if p_service='calendar' then
    select max(p.last_projected_at) into recent from public.calendar_projections p
      join public.lessons l on l.id=p.lesson_id where l.studio_id=p_studio;
    select coalesce(jsonb_agg(to_jsonb(x)),'[]') into problems from (
      select 'projection:'||p.id as key,p.id as "recordId",p.id::text as "sourceReference",p.lesson_id as "lessonId",s.id as "studentId",
        case when l.series_id is not null then 'recurring_occurrence' else 'lesson' end as scope,
        case when p.status='review_required' or p.last_error in ('synchronization_review_required',
          'calendar_series_requires_review','calendar_event_missing_requires_review')
          or exists(select 1 from public.sync_conflicts c where c.studio_id=p_studio and c.entity_type='lesson'
            and c.entity_id=l.id and c.status='open') then 'calendar_review'
          when p.last_error ~ '^calendar_(lookup|write|delete)_429$' then 'calendar_throttled'
          when p.last_error='calendar_authorization' then 'calendar_authorization'
          when p.last_error ~ '^calendar_(lookup|write|delete)_(401|403)$' then 'calendar_permission'
          when p.last_error='calendar_timeout' then 'calendar_timeout'
          when p.status='projecting' and p.claim_until<=now() then 'calendar_stalled'
          else 'calendar_sync' end as category,
        case when p.status='projecting' and p.claim_until>now() then 'running'
          when p.status='queued' then 'queued' else 'open' end as phase,
        (p.status='failed' and (p.claim_until is null or p.claim_until<=now()) and
          p.last_error ~ '^calendar_(sync_failed|timeout|(lookup|write|delete)_(408|409|412|429|5[0-9]{2}))$' and
          not exists(select 1 from public.sync_conflicts c where c.studio_id=p_studio and c.entity_type='lesson'
            and c.entity_id=l.id and c.status='open')) as retryable,
        p.attempts, p.first_attempted_at as "sourceAt", p.last_projected_at as "lastSuccessAt",
        case when l.status in ('cancelled','late_cancelled') then 'cancellation'
          when p.external_event_id is not null then 'update' else 'creation' end as operation
      from public.calendar_projections p join public.lessons l on l.id=p.lesson_id
      left join public.students s on s.id=l.student_id and s.studio_id=p_studio
      where l.studio_id=p_studio and
        (p.status in ('failed','review_required') or
          (p.status in ('projecting','queued') and p.last_error is not null) or
          (p.status='projecting' and p.claim_until<=now()) or
          (p.status='queued' and p.next_attempt_at<now()-interval '20 minutes'))
      order by p.id limit 41
    ) x;
    select count(*) into pending from (
      select 1 from public.calendar_projections p join public.lessons l on l.id=p.lesson_id
      where l.studio_id=p_studio and p.status in ('queued','projecting') limit 41
    ) q;
  elsif p_service='email' then
    select updated_at into recent from public.outbox_messages
      where studio_id=p_studio and channel='email' and status='sent' order by updated_at desc limit 1;
    select coalesce(jsonb_agg(to_jsonb(x)),'[]') into problems from (
      select 'delivery:'||m.id as key,m.id as "recordId",l.id as "lessonId",s.id as "studentId",b.id as "bookingId",
        m.id as "deliveryId",case when m.correlation_id ~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
          then m.correlation_id else m.id::text end as "sourceReference",i.id as "invoiceId",
        case when m.campaign_id is null and
          (m.event_key in ('invoice.issued','booking.confirmed.student','booking.cancelled.student','booking.rescheduled.student')
            or m.recipient_intent in ('lesson_confirmation','schedule_change','cancellation','account_access','payment_failed'))
          then 'transactional' else 'other' end as scope,
        case when m.status='cancelled' then 'email_recipient'
          when m.delivery_provider_started_at is not null then 'email_ambiguous'
          when m.last_error='delivery_preflight_failed' then 'email_preflight'
          else 'email_failed' end as category,
        case when m.status='sending' and m.updated_at>now()-interval '15 minutes' then 'running'
          when m.status='queued' then 'queued' else 'open' end as phase,
        (m.status='failed' and m.last_error='delivery_preflight_failed'
          and m.delivery_provider_started_at is null and not exists(select 1 from public.delivery_attempts a
            where a.outbox_message_id=m.id and a.succeeded)) as retryable,
        m.attempts,m.updated_at as "sourceAt",'delivery'::text as operation
      from public.outbox_messages m
      left join public.lessons l on l.id=m.lesson_id and l.studio_id=p_studio
      left join public.students s on s.id=m.student_id and s.studio_id=p_studio
      left join public.bookings b on b.id=m.booking_id and b.studio_id=p_studio
      left join public.studio_invoices i on i.studio_id=p_studio and i.id::text=m.entity_snapshot->>'invoiceId'
      where m.studio_id=p_studio and m.channel='email' and
        (m.status='failed' or (m.status='sending' and (m.last_error='delivery_preflight_failed'
            or m.updated_at<now()-interval '15 minutes'))
          or (m.status='queued' and (m.last_error='delivery_preflight_failed'
            or (m.send_at<now()-interval '20 minutes' and coalesce(m.next_attempt_at,m.send_at)<now()-interval '20 minutes')))
          or (m.status='cancelled' and m.updated_at>now()-interval '30 days' and m.suppression_reason in
            ('recipient_permission_changed','recipient_no_longer_eligible','recipient_invalid','invoice_changed')))
      order by m.updated_at desc,m.id limit 41
    ) x;
    select count(*) into pending from (
      select 1 from public.outbox_messages where studio_id=p_studio and channel='email'
        and status in ('queued','sending','approved') and send_at<=now() limit 41
    ) q;
  elsif p_service='stripe' then
    -- Signed events are global. Attribute only through an exact local record
    -- referenced in the signed event, never from an unowned payload or a name.
    with events as (
      select w.id,w.status,w.event_type,w.received_at,w.processed_at,
        w.payload#>>'{data,object,payment_status}' as payment_status,
        coalesce(w.payload#>'{data,object,parent,subscription_details,metadata}','{}') ||
          coalesce(w.payload#>'{data,object,metadata}',w.payload->'metadata','{}') as metadata
      from public.webhook_events w
      where w.provider='stripe' and w.received_at>now()-interval '30 days'
        and w.event_type in ('checkout.session.completed','checkout.session.async_payment_succeeded',
          'invoice.paid','invoice.payment_failed','payment_intent.succeeded','payment_intent.payment_failed')
    ), attributed as (
      select e.*,i.id as invoice_id,b.id as booking_id,t.lesson_id,t.state as autopay_state
      from events e
      left join public.studio_invoices i on i.id=case when e.metadata->>'studio_invoice_id'
        ~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' then (e.metadata->>'studio_invoice_id')::uuid end
        and i.studio_id=p_studio
      left join public.bookings b on b.id=case when e.metadata->>'booking_id'
        ~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' then (e.metadata->>'booking_id')::uuid end
        and b.studio_id=p_studio
      left join training_internal.lesson_autopay_attempts t on t.id=case when e.metadata->>'training_autopay_attempt'
        ~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' then (e.metadata->>'training_autopay_attempt')::uuid end
        and exists(select 1 from public.lessons l where l.id=t.lesson_id and l.studio_id=p_studio)
      where i.id is not null or b.id is not null or t.id is not null
    ), failures as (
      select 'webhook:'||e.id as key,e.invoice_id as "invoiceId",e.booking_id as "bookingId",e.lesson_id as "lessonId",
        case when e.id ~ '^evt_[a-zA-Z0-9]{1,50}$' then e.id end as "sourceReference",
        'stripe_processing' as category,'open' as phase,e.received_at as "sourceAt",'webhook' as operation
      from attributed e where e.status='failed' or (e.status in ('received','processing') and e.received_at<now()-interval '15 minutes')
      union all
      select 'dedicated-payment:'||a.id,l.invoice_id,null,l.id,a.id::text,
        'stripe_payment_failed','open',a.updated_at,'scheduled_payment'
      from training_internal.lesson_autopay_attempts a join public.lessons l on l.id=a.lesson_id
      where l.studio_id=p_studio and a.state='failed' and a.updated_at>now()-interval '30 days'
      order by "sourceAt" desc limit 41
    )
    select (select max(processed_at) from attributed where status='processed' and
      ((event_type in ('checkout.session.completed','checkout.session.async_payment_succeeded') and payment_status='paid')
        or (event_type='invoice.paid' and booking_id is not null)
        or (event_type='payment_intent.succeeded' and autopay_state='succeeded'))),
      (select coalesce(jsonb_agg(to_jsonb(f)),'[]') from failures f) into recent,problems;
  elsif p_service='jobs' then
    if p_owner then
      select * into job from worker_internal.scheduled_jobs where worker='booking-maintenance';
      if found then
        recent:=job.last_success_at;
        problems:=jsonb_build_array(jsonb_build_object(
          'key','maintenance','category',
          case when job.state='failed' then 'job_failed'
            when job.requested_at<now()-interval '20 minutes' and (job.last_success_at is null or
              job.last_success_at<now()-interval '20 minutes') then 'job_stalled' else 'job_observed' end,
          'phase','open','operation','booking_maintenance','recordId',job.id,'sourceReference',job.id,
          'sourceAt',coalesce(job.started_at,job.requested_at),'attempts',job.attempts,
          'errorCategory',case when job.error_category in ('database','timeout','provider','configuration','internal')
            then job.error_category end));
      end if;
    end if;
  elsif p_service='access' then
    if exists(select 1 from public.memberships where studio_id=p_studio and role='coach') then recent:=now(); end if;
  else
    raise exception 'VALIDATION_FAILED';
  end if;
  completed:=jsonb_array_length(problems)<=40;
  return jsonb_build_object('lastSuccessAt',recent,'problems',problems,'complete',completed,'pending',pending);
end $$;

create function public.studio_health_finish(
  p_studio uuid,p_lease uuid,p_automatic boolean,p_results jsonb
) returns boolean language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
  update studio_health_internal.checkpoints
    set checked_at=now(),automatic_at=case when p_automatic then now() else automatic_at end,
      lease=null,lease_until=null,observations=p_results
    where studio_id=p_studio and lease=p_lease and lease_until>now();
  if not found then return false; end if;

  for result in select * from jsonb_array_elements(p_results) loop
    insert into studio_health_internal.issues(studio_id,service,issue_key,evidence)
    select p_studio,result->>'service',e->>'key',e
    from jsonb_array_elements(result->'problems') e
    on conflict(studio_id,service,issue_key) do update set
      evidence=excluded.evidence,
      last_seen=case when issues.resolved_at is not null or
        (excluded.evidence->>'phase'='open' and (
           issues.evidence->>'phase' is distinct from 'open' or
           excluded.evidence->'attempts' is distinct from issues.evidence->'attempts' or
           excluded.evidence->'category' is distinct from issues.evidence->'category'))
        then now() else issues.last_seen end,
      occurrences=issues.occurrences+case when issues.resolved_at is not null or
        (excluded.evidence->>'phase'='open' and (
          issues.evidence->>'phase' is distinct from 'open' or
          excluded.evidence->'attempts' is distinct from issues.evidence->'attempts' or
          excluded.evidence->'category' is distinct from issues.evidence->'category'))
        then 1 else 0 end,
      resolved_at=null;

    if result->>'complete'='true' then
      update studio_health_internal.issues h set resolved_at=now(),
        evidence=h.evidence || jsonb_build_object('resolution',case
          when h.service='calendar' and h.issue_key like 'projection:%' and exists(
            select 1 from public.calendar_projections p join public.lessons l on l.id=p.lesson_id
            where l.studio_id=p_studio and p.id::text=h.evidence->>'recordId' and p.status='projected')
          then 'confirmed'
          when h.service='email' and exists(
            select 1 from public.outbox_messages m where m.studio_id=p_studio
              and m.id::text=h.evidence->>'recordId' and m.status='sent')
          then 'confirmed'
          when h.service='stripe' and h.issue_key like 'webhook:%' and exists(
            select 1 from public.webhook_events w where w.id=substr(h.issue_key,9) and w.status='processed')
          then 'confirmed'
          when h.service='jobs' and result->>'state'='healthy' then 'confirmed'
          when h.service='calendar' and h.issue_key='google-access'
            and result#>>'{probe,result}'='accessible' then 'confirmed'
          else 'cleared' end)
      where h.studio_id=p_studio and h.service=result->>'service' and h.resolved_at is null
        and not exists(select 1 from jsonb_array_elements(result->'problems') e where e->>'key'=h.issue_key)
        and not (coalesce(result->'preserve','[]') ? h.issue_key);
    end if;
  end loop;
  delete from studio_health_internal.issues where studio_id=p_studio
    and resolved_at<now()-interval '90 days';
  return true;
end $$;

create function public.studio_health_read(p_studio uuid,p_issue uuid default null) returns jsonb
language sql stable security definer set search_path='' set statement_timeout='3s' as $$
  select jsonb_build_object(
    'checkedAt',c.checked_at,'automaticAt',c.automatic_at,'checking',coalesce(c.lease_until>now(),false),
    'observations',coalesce((select jsonb_agg(x-'problems'-'preserve') from jsonb_array_elements(c.observations) x),'[]'),
    'issues',coalesce((select jsonb_agg(v) from (
      select h.evidence-'key'-'recordId' || jsonb_build_object(
        'id',h.id,'service',h.service,'firstSeen',h.first_seen,'lastSeen',h.last_seen,
        'occurrences',h.occurrences,'resolvedAt',h.resolved_at,
        'recovery',(select coalesce(jsonb_agg(to_jsonb(a)),'[]') from (
          select created_at as "at",correlation_id as "correlationId",'queued' as result from public.audit_events
          where studio_id=p_studio and entity_id=h.id and action in ('system_health.retry_calendar','system_health.retry_email')
          order by created_at desc limit 5
        ) a)
      ) v
      from studio_health_internal.issues h
      where h.studio_id=p_studio and (p_issue is null or h.id=p_issue)
      order by (h.resolved_at is null) desc,(h.evidence->>'severity'='high') desc,h.last_seen desc,h.id limit 60
    ) q),'[]')
  )
  from (select p_studio as id) s left join studio_health_internal.checkpoints c on c.studio_id=s.id
$$;

create function public.studio_health_retry(
  p_studio uuid,p_actor uuid,p_issue uuid,p_correlation uuid,p_service text
) returns text language plpgsql security definer set search_path='' as $$
declare h studio_health_internal.issues; target uuid; changed uuid; locked_lesson uuid; checking boolean;
begin
  if not exists(select 1 from public.memberships where studio_id=p_studio and user_id=p_actor and role='coach')
    then raise exception 'FORBIDDEN'; end if;
  select lease_until>now() into checking from studio_health_internal.checkpoints where studio_id=p_studio for update;
  if checking then return 'check_in_progress'; end if;
  if (select count(*) from public.audit_events where studio_id=p_studio
    and action in ('system_health.retry_calendar','system_health.retry_email')
    and created_at>now()-interval '15 minutes')>=10 then return 'retry_limit'; end if;
  select * into h from studio_health_internal.issues where studio_id=p_studio and id=p_issue for update;
  if not found or h.service<>p_service then return 'not_eligible'; end if;
  if h.resolved_at is not null then return 'already_resolved'; end if;
  if exists(select 1 from public.audit_events where studio_id=p_studio and entity_id=p_issue
    and action in ('system_health.retry_calendar','system_health.retry_email')
    and created_at>now()-interval '15 minutes') then return 'recent_retry'; end if;
  target:=(h.evidence->>'recordId')::uuid;
  if p_service='calendar' then
    -- Match the established lesson -> projection lock order. The worker owns the
    -- external event identity, claimed lesson version and conflict checks.
    select l.id into locked_lesson from public.lessons l
    join public.calendar_projections p on p.lesson_id=l.id
    where p.id=target and l.studio_id=p_studio for update of l;
    update public.calendar_projections p set status='queued',next_attempt_at=now()
      where p.id=target and p.lesson_id=locked_lesson and p.status='failed'
        and (p.claim_until is null or p.claim_until<=now())
        and p.last_error ~ '^calendar_(sync_failed|timeout|(lookup|write|delete)_(408|409|412|429|5[0-9]{2}))$'
        and not exists(select 1 from public.sync_conflicts c where c.studio_id=p_studio
          and c.entity_type='lesson' and c.entity_id=p.lesson_id and c.status='open')
      returning p.id into changed;
    if changed is null and exists(select 1 from public.calendar_projections p where p.id=target
      and p.lesson_id=locked_lesson and p.status='projected') then return 'already_resolved'; end if;
  elsif p_service='email' then
    update public.outbox_messages m set status='queued',next_attempt_at=now(),updated_at=now()
      where m.id=target and m.studio_id=p_studio and m.channel='email' and m.status='failed'
        and m.last_error='delivery_preflight_failed' and m.delivery_provider_started_at is null
        and m.campaign_id is null and (m.event_key in ('invoice.issued','booking.confirmed.student','booking.cancelled.student','booking.rescheduled.student')
          or m.recipient_intent in ('lesson_confirmation','schedule_change','cancellation','account_access','payment_failed'))
        and not exists(select 1 from public.delivery_attempts d where d.outbox_message_id=m.id and d.succeeded)
      returning m.id into changed;
    if changed is null and exists(select 1 from public.outbox_messages where id=target
      and studio_id=p_studio and status='sent') then return 'already_resolved'; end if;
  else
    return 'not_eligible';
  end if;
  if changed is null then return 'not_eligible'; end if;
  insert into public.audit_events(studio_id,actor_id,action,entity_id,entity_type,reason,correlation_id,source)
  values(p_studio,p_actor,'system_health.retry_'||p_service,p_issue,'system_health_issue',
    'Coach queued one eligible recovery',p_correlation::text,'coach');
  update studio_health_internal.issues set evidence=jsonb_set(evidence,'{phase}','"queued"')
    where studio_id=p_studio and id=p_issue;
  return 'queued';
end $$;

revoke all on function public.studio_health_due(),public.studio_health_claim(uuid,boolean),public.studio_health_studio_slug(uuid),
  public.studio_health_evidence(uuid,text,boolean),public.studio_health_finish(uuid,uuid,boolean,jsonb),
  public.studio_health_read(uuid,uuid),public.studio_health_retry(uuid,uuid,uuid,uuid,text)
  from public, anon, authenticated;
grant execute on function public.studio_health_due(),public.studio_health_claim(uuid,boolean),public.studio_health_studio_slug(uuid),
  public.studio_health_evidence(uuid,text,boolean),public.studio_health_finish(uuid,uuid,boolean,jsonb),
  public.studio_health_read(uuid,uuid),public.studio_health_retry(uuid,uuid,uuid,uuid,text)
  to service_role;
