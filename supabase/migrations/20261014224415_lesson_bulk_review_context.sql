-- Read-only additions for bounded coach selection and resumable batch review.
-- Existing actor ownership, studio membership, execution and privileges are retained.
create or replace function public.lesson_bulk_candidates(p_actor uuid,p_studio uuid,p_filter jsonb,p_offset integer default 0,p_limit integer default 50) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 perform lesson_ops.require_bulk_coach(p_actor,p_studio);
 if p_offset<0 or p_limit not between 1 and 100 then raise exception 'VALIDATION_FAILED'; end if;
 return jsonb_build_object('count',(select count(*) from lesson_ops.bulk_candidates(p_studio,p_filter)),
  'items',(select coalesce(jsonb_agg(to_jsonb(l)||jsonb_build_object('coachArchivedAt',(select archived_at from lesson_ops.lesson_record_state where lesson_id=l.id),'studentNames',(select coalesce(jsonb_agg(s.full_name order by s.full_name),'[]') from public.students s where s.studio_id=p_studio and (s.id=l.student_id or exists(select 1 from public.lesson_participants lp where lp.lesson_id=l.id and lp.student_id=s.id))))),'[]') from (select * from lesson_ops.bulk_candidates(p_studio,p_filter) order by starts_at,id offset p_offset limit p_limit) l),
  'offset',p_offset,'limit',p_limit);
end $$;

create or replace function public.lesson_bulk_progress(p_actor uuid,p_job uuid,p_offset integer default 0,p_limit integer default 50) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare j lesson_ops.lesson_bulk_jobs;counts jsonb;pending integer;sync_pending integer;
begin
 select * into j from lesson_ops.lesson_bulk_jobs where id=p_job;
 if j.id is null or j.actor_id<>p_actor then raise exception 'FORBIDDEN'; end if;
 perform lesson_ops.require_bulk_coach(p_actor,j.studio_id);
 if p_offset<0 or p_limit not between 1 and 100 then raise exception 'VALIDATION_FAILED'; end if;
 select jsonb_build_object('total',count(*),'eligible',count(*) filter(where status<>'blocked'),'blocked',count(*) filter(where status='blocked'),
  'succeeded',count(*) filter(where status='succeeded'),'skipped',count(*) filter(where status in ('skipped','blocked')),
  'conflicted',count(*) filter(where status='conflicted'),'failed',count(*) filter(where status='failed'),
  'pending',count(*) filter(where status in ('pending','processing')),'waiting',count(*) filter(where status='pending'),'processing',count(*) filter(where status='processing')) into counts from lesson_ops.lesson_bulk_items where job_id=j.id;
 select count(*) into sync_pending from lesson_ops.lesson_bulk_items i where i.job_id=j.id and i.status='succeeded' and j.operation='cancel' and
  (exists(select 1 from public.calendar_projections where lesson_id=i.lesson_id and status<>'projected') or
   exists(select 1 from lesson_ops.effects where id in(select value::uuid from jsonb_array_elements_text(i.result->'changeEffectIds')) and status not in ('completed','superseded')) or
   exists(select 1 from lesson_ops.effects e join public.outbox_messages o on o.id=any(e.outbox_ids)
    where e.id in(select value::uuid from jsonb_array_elements_text(i.result->'changeEffectIds')) and o.status not in ('sent','cancelled')));
 pending:=(counts->>'pending')::integer;
 return jsonb_build_object('jobId',j.id,'operation',j.operation,'scope',coalesce(j.request->>'scope','selected'),'filter',j.request->'filter',
  'reviewContext',jsonb_build_object('reviewToken',j.review_token,'reason',j.request->>'reason','selectionMode',coalesce(j.request->>'selectionMode','ids'),'wholeClass',coalesce((j.request->>'wholeClass')::boolean,false),'useCredit',coalesce((j.request->>'useCredit')::boolean,false),'studentContextId',j.request->>'studentContextId','stopsFutureGeneration',j.operation='cancel' and coalesce(j.request->>'scope','selected') in ('future','series')),'expiresAt',j.expires_at,'state',case when j.state='reviewed' then 'reviewed' when pending>0 then 'running' when (counts->>'failed')::integer>0 then 'needs_attention' else 'completed' end,
  'counts',counts||jsonb_build_object('synchronizationPending',sync_pending),
  'items',(select coalesce(jsonb_agg(jsonb_build_object('id',i.id,'lessonId',i.lesson_id,'version',i.lesson_version,'status',i.status,
     'studentNames',(select coalesce(jsonb_agg(s.full_name order by s.full_name),'[]') from public.students s where s.studio_id=j.studio_id and s.id in(select value::uuid from jsonb_array_elements_text(coalesce(i.assessment->'studentIds','[]')))),'assessment',i.assessment,'reasonCode',i.reason_code,'result',i.result,'attempts',i.attempts,'retryable',i.status='failed','nextRetryAt',case when i.status='failed' and i.attempts<5 then i.next_attempt_at end) order by i.ordinal),'[]')
    from (select * from lesson_ops.lesson_bulk_items where job_id=j.id order by ordinal offset p_offset limit p_limit) i),
  'offset',p_offset,'limit',p_limit);
end $$;

revoke all on function public.lesson_bulk_candidates(uuid,uuid,jsonb,integer,integer), public.lesson_bulk_progress(uuid,uuid,integer,integer) from public,anon,authenticated;
grant execute on function public.lesson_bulk_candidates(uuid,uuid,jsonb,integer,integer), public.lesson_bulk_progress(uuid,uuid,integer,integer) to service_role;
