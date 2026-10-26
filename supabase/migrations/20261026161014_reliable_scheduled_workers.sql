-- Additive, service-only work receipts. No booking/financial history is changed.
create schema if not exists worker_internal;
revoke all on schema worker_internal from public, anon, authenticated;
create table worker_internal.scheduled_jobs (
  worker text primary key check (worker in ('provider-intake','booking-maintenance')),
  id uuid not null unique default gen_random_uuid(),
  state text not null default 'pending' check (state in ('pending','running','failed','succeeded')),
  claim_token uuid,
  claim_until timestamptz,
  attempts integer not null default 0,
  requested_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  error_category text
);
alter table worker_internal.scheduled_jobs enable row level security;
revoke all on worker_internal.scheduled_jobs from public, anon, authenticated;

create function public.enqueue_scheduled_worker(p_worker text) returns uuid
language plpgsql security definer set search_path='' as $$
declare job worker_internal.scheduled_jobs;
begin
  if p_worker not in ('provider-intake','booking-maintenance') then raise exception 'Invalid worker'; end if;
  insert into worker_internal.scheduled_jobs(worker) values(p_worker) on conflict do nothing;
  select * into job from worker_internal.scheduled_jobs where worker=p_worker for update;
  if job.state='running' and job.claim_until>now() then return null; end if;
  if job.state='succeeded' then
    update worker_internal.scheduled_jobs set id=gen_random_uuid(),state='pending',claim_token=null,
      claim_until=null,attempts=0,requested_at=now(),started_at=null,finished_at=null,error_category=null
      where worker=p_worker returning * into job;
  end if;
  return job.id;
end $$;

create function public.claim_scheduled_worker(p_worker text,p_job uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare token uuid;
begin
  -- 20 minutes exceeds Netlify's hard 15-minute background lifetime, including
  -- retry delivery slack. Never expire a lease while its original worker can run.
  update worker_internal.scheduled_jobs set state='running',claim_token=gen_random_uuid(),
    claim_until=now()+interval '20 minutes',started_at=now(),finished_at=null,attempts=attempts+1
    where worker=p_worker and id=p_job and (state in ('pending','failed') or
      (state='running' and claim_until<=now())) returning claim_token into token;
  return token;
end $$;

create function public.finish_scheduled_worker(p_worker text,p_job uuid,p_token uuid,p_error text default null) returns boolean
language plpgsql security definer set search_path='' as $$
declare affected integer;
begin
  if p_error is not null and p_error not in ('database','timeout','provider','configuration','internal') then
    raise exception 'Invalid safe error category';
  end if;
  update worker_internal.scheduled_jobs set state=case when p_error is null then 'succeeded' else 'failed' end,
    finished_at=now(),error_category=p_error,claim_token=null,claim_until=null
    where worker=p_worker and id=p_job and state='running' and claim_token=p_token and claim_until>now();
  get diagnostics affected=row_count;
  return affected=1;
end $$;

revoke all on function public.enqueue_scheduled_worker(text) from public,anon,authenticated;
revoke all on function public.claim_scheduled_worker(text,uuid) from public,anon,authenticated;
revoke all on function public.finish_scheduled_worker(text,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.enqueue_scheduled_worker(text) to service_role;
grant execute on function public.claim_scheduled_worker(text,uuid) to service_role;
grant execute on function public.finish_scheduled_worker(text,uuid,uuid,text) to service_role;
