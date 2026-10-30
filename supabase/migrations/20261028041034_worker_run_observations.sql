-- Append-only operational evidence. No provider invocation or business-data change.
create table worker_internal.run_observations (
  sequence bigint generated always as identity primary key,
  worker text not null check (worker in ('provider-intake','booking-maintenance')),
  job_id uuid not null,
  attempt integer not null,
  event text not null check (event in ('queued','accepted','running','completed','failed','stage_started','stage_completed','stage_failed')),
  stage text,
  error_category text check (error_category in ('database','timeout','provider','configuration','internal','gmail_read_permission')),
  observed_at timestamptz not null default clock_timestamp()
);
alter table worker_internal.run_observations enable row level security;
revoke all on worker_internal.run_observations from public,anon,authenticated;
create index worker_run_observations_recent on worker_internal.run_observations(worker,sequence desc);
create index worker_run_observations_job on worker_internal.run_observations(job_id,attempt,sequence);
create index worker_run_observations_completed on worker_internal.run_observations(worker,observed_at desc) where event='completed';

create function worker_internal.observe_job() returns trigger
language plpgsql security definer set search_path='' as $$
declare event_name text;
begin
  if TG_OP='INSERT' then event_name:='queued';
  elsif new.id<>old.id then event_name:='queued';
  elsif new.state='running' and new.claim_token is distinct from old.claim_token then event_name:='running';
  elsif new.state='succeeded' and old.state<>'succeeded' then event_name:='completed';
  elsif new.state='failed' and old.state<>'failed' then event_name:='failed';
  else return new; end if;
  insert into worker_internal.run_observations(worker,job_id,attempt,event,error_category)
    values(new.worker,new.id,new.attempts,event_name,new.error_category);
  return new;
end $$;
revoke all on function worker_internal.observe_job() from public,anon,authenticated;
create trigger scheduled_job_observation after insert or update on worker_internal.scheduled_jobs
for each row execute function worker_internal.observe_job();

-- Preserve the one actual saved terminal receipt per worker with its original
-- timestamp. Earlier overwritten runs and unknown stages cannot be reconstructed.
insert into worker_internal.run_observations(worker,job_id,attempt,event,error_category,observed_at)
select worker,id,attempts,case when state='succeeded' then 'completed' else 'failed' end,error_category,finished_at
from worker_internal.scheduled_jobs where state in ('succeeded','failed') and finished_at is not null;
create function public.observe_scheduled_worker(p_worker text,p_job uuid,p_token uuid,p_event text,p_stage text default null,p_error text default null) returns boolean
language plpgsql security definer set search_path='' as $$
declare job worker_internal.scheduled_jobs;
begin
  select * into job from worker_internal.scheduled_jobs where worker=p_worker and id=p_job for update;
  if not found then return false; end if;
  if p_event='accepted' then
    if p_token is not null or p_stage is not null or p_error is not null then raise exception 'Invalid observation'; end if;
  else
    if job.state<>'running' or job.claim_token is distinct from p_token or job.claim_until<=now() then return false; end if;
    if p_event not in ('stage_started','stage_completed','stage_failed') or p_stage is null or p_stage not in (
      'claim','studios_and_stale_reviews','google_token','student_identities','calendar_processing','gmail_processing','completion',
      'lesson_bulk','lesson_change_effects','booking_holds_and_series','past_due_bookings','note_recommendations',
      'automatic_credits','package_gifts','package_auto_renewals','package_expiration','package_low_balance','notification_retention'
    ) then raise exception 'Invalid observation'; end if;
    if p_error is not null and p_event<>'stage_failed' then raise exception 'Invalid observation'; end if;
  end if;
  insert into worker_internal.run_observations(worker,job_id,attempt,event,stage,error_category)
    values(p_worker,p_job,job.attempts,p_event,p_stage,p_error);
  return true;
end $$;

-- Service-only fixed-shape read; no tokens, source payloads, counts or identities.
create function public.scheduled_worker_health() returns jsonb
language sql stable security definer set search_path='' as $$
  select coalesce(jsonb_object_agg(j.worker,jsonb_build_object(
    'jobId',j.id,'state',j.state,'attempts',j.attempts,'requestedAt',j.requested_at,
    'startedAt',j.started_at,'finishedAt',j.finished_at,'errorCategory',j.error_category,
    'leaseExpired',j.state='running' and j.claim_until<=now(),
    'acceptedAt',(select max(o.observed_at) from worker_internal.run_observations o where o.job_id=j.id and o.event='accepted'),
    'lastSuccessAt',coalesce((select max(o.observed_at) from worker_internal.run_observations o where o.worker=j.worker and o.event='completed'),case when j.state='succeeded' then j.finished_at end),
    'stages',coalesce((select jsonb_agg(jsonb_build_object('stage',s.stage,'state',s.event,'errorCategory',s.error_category,'at',s.observed_at)) from (
      select distinct on(o.stage) o.stage,o.event,o.error_category,o.observed_at from worker_internal.run_observations o
      where o.job_id=j.id and o.attempt=j.attempts and o.stage is not null order by o.stage,(o.event='stage_failed') desc,o.sequence desc
    ) s),'[]'::jsonb),
    'history',coalesce((select jsonb_agg(jsonb_build_object('jobId',h.job_id,'attempt',h.attempt,'state',h.event,'at',h.observed_at,'errorCategory',h.error_category) order by h.sequence desc) from (
      select o.* from worker_internal.run_observations o where o.worker=j.worker and o.event in ('completed','failed') order by o.sequence desc limit 10
    ) h),'[]'::jsonb)
  )),'{}'::jsonb) from worker_internal.scheduled_jobs j;
$$;
revoke all on function public.observe_scheduled_worker(text,uuid,uuid,text,text,text) from public,anon,authenticated;
revoke all on function public.scheduled_worker_health() from public,anon,authenticated;
grant execute on function public.observe_scheduled_worker(text,uuid,uuid,text,text,text) to service_role;
grant execute on function public.scheduled_worker_health() to service_role;
