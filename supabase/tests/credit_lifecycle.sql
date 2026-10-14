-- Isolated full-schema lifecycle regression. Every fixture rolls back.
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
select ok(not has_function_privilege('authenticated','public.command_grant_student_credits(uuid,text,jsonb,uuid)','EXECUTE'),'Portal clients cannot grant credits');
select ok(not has_function_privilege('authenticated','public.process_credit_coverage_job(uuid)','EXECUTE'),'Portal clients cannot process worker jobs');
select ok(not has_table_privilege('authenticated','credit_internal.credit_coverage_jobs','SELECT'),'Recovery metadata is exposed only through guarded diagnostics');
select ok(not has_table_privilege('service_role','credit_internal.credit_command_receipts','SELECT'),'Service requests cannot list command receipt bodies');

insert into auth.users(id,email) values('81000000-0000-4000-8000-000000000001','e2e-lifecycle-coach@example.test');
insert into public.studios(id,name,slug) values('82000000-0000-4000-8000-000000000001','Lifecycle test studio','e2e-credit-lifecycle');
insert into public.memberships(studio_id,user_id,role,display_name) values('82000000-0000-4000-8000-000000000001','81000000-0000-4000-8000-000000000001','coach','Lifecycle coach');
insert into public.students(id,studio_id,full_name) values('83000000-0000-4000-8000-000000000001','82000000-0000-4000-8000-000000000001','Lifecycle student');
insert into public.student_credit_accounts(student_id,auto_apply) values('83000000-0000-4000-8000-000000000001',true);
insert into public.lessons(id,studio_id,student_id,topic,starts_at,ends_at,location_type,location_label) values
 ('86000000-0000-4000-8000-000000000001','82000000-0000-4000-8000-000000000001','83000000-0000-4000-8000-000000000001','First',now()+interval '1 day',now()+interval '1 day 1 hour','virtual','Meet'),
 ('86000000-0000-4000-8000-000000000002','82000000-0000-4000-8000-000000000001','83000000-0000-4000-8000-000000000001','Next',now()+interval '2 days',now()+interval '2 days 1 hour','virtual','Meet');
create temporary table lifecycle_result as select public.command_grant_student_credits(
 '83000000-0000-4000-8000-000000000001','lifecycle-grant',
 '{"quantity":1,"kind":"adjustment","reason":"Lifecycle grant"}','81000000-0000-4000-8000-000000000001') result;
select is((select result->'coverage'->>'applied' from lifecycle_result),'1','Grant immediately covers the first lesson');
select is((select result->'coverage'->>'skipped' from lifecycle_result),'1','Limited credits explain the remaining lesson');
select is((select result->'coverage'->'skipReasons'->>'no_available_credits' from lifecycle_result),'1','Skip reason is authoritative');
select is(public.command_grant_student_credits('83000000-0000-4000-8000-000000000001','lifecycle-grant',
 '{"quantity":1,"kind":"adjustment","reason":"Lifecycle grant"}','81000000-0000-4000-8000-000000000001')->>'duplicate','true','Exact replay returns the persisted result');
select is((select count(*) from public.audit_events where correlation_id='lifecycle-grant'),1::bigint,'Replay does not duplicate audit');
select throws_ok($$select public.command_grant_student_credits('83000000-0000-4000-8000-000000000001','lifecycle-grant',
 '{"quantity":2,"kind":"adjustment","reason":"Lifecycle grant"}','81000000-0000-4000-8000-000000000001')$$,'P0001','IDEMPOTENCY_CONFLICT','Changed replay is rejected');
select is(public.reserve_student_upcoming_credits('83000000-0000-4000-8000-000000000001')->>'alreadyCovered','1','Existing coverage is reported separately');
select is(public.reserve_student_upcoming_credits('83000000-0000-4000-8000-000000000001')->>'applied','0','Repeated scan has no new debits');
select is(public.command_cancel_lesson_credit('86000000-0000-4000-8000-000000000001',
 (select version from public.lessons where id='86000000-0000-4000-8000-000000000001'),false)->'creditCoverage'->'83000000-0000-4000-8000-000000000001'->>'applied','1','Cancellation immediately reuses returned credit');
select is((select payment_status from public.lessons where id='86000000-0000-4000-8000-000000000002'),'paid_by_credit','Next lesson is covered');
select is((select sum(quantity) from public.package_credit_entries where lesson_id='86000000-0000-4000-8000-000000000001'),0::bigint,'Cancelled lesson ledger nets to zero');
select is(public.command_grant_student_credits('83000000-0000-4000-8000-000000000001','lifecycle-add',
 '{"quantity":1,"kind":"adjustment","reason":"More lesson credits"}','81000000-0000-4000-8000-000000000001')->'coverage'->>'applied','0','Adding credits does not count an existing hold as applied');

insert into public.lessons(id,studio_id,student_id,topic,starts_at,ends_at,location_type,location_label) values
 ('86000000-0000-4000-8000-000000000003','82000000-0000-4000-8000-000000000001','83000000-0000-4000-8000-000000000001','Recovery',now()+interval '3 days',now()+interval '3 days 1 hour','virtual','Meet');
create function pg_temp.fail_reservation() returns trigger language plpgsql as $$begin if new.quantity<0 then raise exception 'simulated sync failure';end if;return new;end$$;
create trigger lifecycle_sync_failure after insert on public.package_credit_entries for each row execute function pg_temp.fail_reservation();
select is(public.reserve_student_upcoming_credits('83000000-0000-4000-8000-000000000001')->>'failed','1','Failed reservation is reported independently');
select is((select count(*) from public.package_credit_entries where lesson_id='86000000-0000-4000-8000-000000000003'),0::bigint,'Failed reservation rolls back its ledger writes');
select ok((select generation>completed_generation from credit_internal.credit_coverage_jobs where student_id='83000000-0000-4000-8000-000000000001'),'Failed work remains durable');
select is(public.process_credit_coverage_job('83000000-0000-4000-8000-000000000001')->>'processed','false','Backoff prevents immediate worker repeat');
drop trigger lifecycle_sync_failure on public.package_credit_entries;
update credit_internal.credit_coverage_jobs set next_attempt_at=now()-interval '1 second' where student_id='83000000-0000-4000-8000-000000000001';
select is(public.process_credit_coverage_job('83000000-0000-4000-8000-000000000001')->>'applied','1','Recovery creates one debit after the failure is removed');
select is(public.process_credit_coverage_job('83000000-0000-4000-8000-000000000001')->>'processed','false','Completed worker replay does no work');
select is((select count(*) from public.package_credit_entries where lesson_id='86000000-0000-4000-8000-000000000003' and quantity<0),1::bigint,'Recovered reservation is exactly once');
select ok((select generation=completed_generation and attempts=0 and last_error is null from credit_internal.credit_coverage_jobs where student_id='83000000-0000-4000-8000-000000000001'),'Recovery clears failure state');

select set_config('request.jwt.claim.sub','81000000-0000-4000-8000-000000000001',true);
select is(public.student_credit_coverage('83000000-0000-4000-8000-000000000001')->'maintenance'->>'pending','false','Authorized diagnostics expose completed processing');
select * from finish();
rollback;
