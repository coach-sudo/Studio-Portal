begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
select ok(not has_schema_privilege('anon','worker_internal','usage'),'Worker schema hidden from anonymous users');
select ok(not has_schema_privilege('authenticated','worker_internal','usage'),'Worker schema hidden from portal roles');
select ok(not has_function_privilege('authenticated','public.enqueue_scheduled_worker(text)','execute'),'Portal cannot enqueue privileged workers');
select ok(not has_function_privilege('anon','public.claim_scheduled_worker(text,uuid)','execute'),'Anonymous cannot claim workers');
select ok(not has_function_privilege('authenticated','public.finish_scheduled_worker(text,uuid,uuid,text)','execute'),'Portal cannot forge completion');
select ok(has_function_privilege('service_role','public.enqueue_scheduled_worker(text)','execute'),'Service may enqueue');
select ok((select relrowsecurity from pg_class where oid='worker_internal.scheduled_jobs'::regclass),'Private receipts also enable RLS');
select throws_ok($$select public.enqueue_scheduled_worker('unexpected')$$,'P0001','Invalid worker','Unknown worker rejected');
select ok(not has_function_privilege('anon','public.scheduled_worker_health()','execute'),'Anonymous cannot read operational history');
select ok(not has_function_privilege('authenticated','public.observe_scheduled_worker(text,uuid,uuid,text,text,text)','execute'),'Portal cannot forge stage observations');
select ok((select relrowsecurity from pg_class where oid='worker_internal.run_observations'::regclass),'Observations have RLS');
select public.enqueue_scheduled_worker('provider-intake') as observation_job \gset
select public.claim_scheduled_worker('provider-intake', :'observation_job') as observation_token \gset
select ok(public.observe_scheduled_worker('provider-intake', :'observation_job', :'observation_token','stage_completed','calendar_processing'),'Current claim records Calendar result');
select ok(public.observe_scheduled_worker('provider-intake', :'observation_job', :'observation_token','stage_failed','gmail_processing','gmail_read_permission'),'Gmail failure is retained independently');
select ok(not public.observe_scheduled_worker('provider-intake', :'observation_job', gen_random_uuid(),'stage_completed','gmail_processing'),'Stale claim cannot forge stage success');
select ok(public.finish_scheduled_worker('provider-intake', :'observation_job', :'observation_token','provider'),'Partial run remains failed');
select is(jsonb_array_length(public.scheduled_worker_health()->'provider-intake'->'stages'),2,'Both source stages remain visible');
select public.claim_scheduled_worker('provider-intake', :'observation_job') as retry_observation_token \gset
select ok(public.finish_scheduled_worker('provider-intake', :'observation_job', :'retry_observation_token'),'Retry completes');
do $$ begin perform public.enqueue_scheduled_worker('provider-intake'); end $$;
select ok(public.scheduled_worker_health()->'provider-intake'->>'lastSuccessAt' is not null,'Next schedule preserves the successful completed run');
select ok(jsonb_array_length(public.scheduled_worker_health()->'provider-intake'->'history')>=2,'History retains failure and recovery');
-- An earlier Calendar guard failure must not overwrite later Gmail success.
select (public.scheduled_worker_health()->'provider-intake'->>'jobId')::uuid as partial_job \gset
set local role service_role;
select public.claim_scheduled_worker('provider-intake', :'partial_job') as partial_token \gset
select ok(public.observe_scheduled_worker('provider-intake', :'partial_job', :'partial_token','stage_failed','calendar_processing','database'),'Service records the real Calendar database hold');
select ok(public.observe_scheduled_worker('provider-intake', :'partial_job', :'partial_token','stage_completed','gmail_processing'),'Later successful Gmail completion is distinct');
select ok(public.observe_scheduled_worker('provider-intake', :'partial_job', :'partial_token','stage_failed','completion','database'),'Aggregate failure belongs to completion');
select ok(public.finish_scheduled_worker('provider-intake', :'partial_job', :'partial_token','database'),'Actual failure category survives fenced completion');
select is((select s->>'state' from jsonb_array_elements(public.scheduled_worker_health()->'provider-intake'->'stages') s where s->>'stage'='calendar_processing'),'stage_failed','Health retains the failed Calendar outcome');
select is((select s->>'state' from jsonb_array_elements(public.scheduled_worker_health()->'provider-intake'->'stages') s where s->>'stage'='gmail_processing'),'stage_completed','Health does not invent a failed Gmail outcome');
select is(public.scheduled_worker_health()->'provider-intake'->>'state','failed','Successful later stage does not certify the whole import');
select is(public.scheduled_worker_health()->'provider-intake'->>'errorCategory','database','Review/constraint hold is not mislabeled as a provider outage');
select ok(public.scheduled_worker_health()->'provider-intake'->>'lastSuccessAt' is not null,'Partial failure preserves the previous completed run');
reset role;
select * from finish();
rollback;
