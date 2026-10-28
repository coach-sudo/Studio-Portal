-- Full-schema disposable PostgreSQL. Outer rollback preserves all fixture history.
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
insert into auth.users(id,email) values
 ('e7600000-0000-4000-8000-000000000001','e2e-correction-coach@example.test'),
 ('e7600000-0000-4000-8000-000000000002','e2e-correction-student@example.test'),
 ('e7600000-0000-4000-8000-000000000003','e2e-correction-unrelated@example.test');
insert into public.studios(id,name,slug,timezone) values('e7600000-0000-4000-8000-000000000010','E2E correction studio','e2e-correction-studio','UTC');
insert into public.memberships(studio_id,user_id,role,display_name) values
 ('e7600000-0000-4000-8000-000000000010','e7600000-0000-4000-8000-000000000001','coach','Synthetic coach'),
 ('e7600000-0000-4000-8000-000000000010','e7600000-0000-4000-8000-000000000002','student','Synthetic learner');
insert into public.students(id,studio_id,full_name,email) values('e7600000-0000-4000-8000-000000000011','e7600000-0000-4000-8000-000000000010','E2E correction learner','e2e-correction-student@example.test');
insert into public.booking_services(id,studio_id,slug,name,category,duration_minutes,price_minor) values('e7600000-0000-4000-8000-000000000012','e7600000-0000-4000-8000-000000000010','e2e-correction','E2E correction service','private',60,6000);
insert into public.lessons(id,studio_id,student_id,topic,starts_at,ends_at,status,location_type,location_label,source_provider,created_at,price_minor,paid_minor,payment_status) values
 ('e7600000-0000-4000-8000-000000000013','e7600000-0000-4000-8000-000000000010','e7600000-0000-4000-8000-000000000011','E2E corrected history','2020-01-01T10:00Z','2020-01-01T11:00Z','completed','in_person','Synthetic','google_calendar','2020-01-02T10:00Z',6000,6000,'paid'),
 ('e7600000-0000-4000-8000-000000000014','e7600000-0000-4000-8000-000000000010','e7600000-0000-4000-8000-000000000011','E2E scheduled correction','2031-11-10T10:00Z','2031-11-10T11:00Z','scheduled','in_person','Synthetic','studio',now(),0,0,'untracked'),
 ('e7600000-0000-4000-8000-000000000015','e7600000-0000-4000-8000-000000000010','e7600000-0000-4000-8000-000000000011','E2E overlap guard','2031-11-11T10:00Z','2031-11-11T11:00Z','scheduled','in_person','Synthetic','studio',now(),0,0,'untracked');
insert into public.bookings(id,studio_id,reference,service_id,student_id,guest_name,guest_email,starts_at,ends_at,timezone,location,status,payment_policy,payment_status,total_minor,paid_minor,currency,policy_snapshot,manage_token_hash)
values('e7600000-0000-4000-8000-000000000016','e7600000-0000-4000-8000-000000000010','E2E-CORRECTION','e7600000-0000-4000-8000-000000000012','e7600000-0000-4000-8000-000000000011','E2E correction learner','e2e-correction-student@example.test','2020-01-01T10:00Z','2020-01-01T11:00Z','UTC','in_person','completed','pay_later','paid',6000,6000,'USD','{}','e2e-correction-token');
insert into public.lesson_participants(lesson_id,booking_id,student_id,display_name,email,status) values('e7600000-0000-4000-8000-000000000013','e7600000-0000-4000-8000-000000000016','e7600000-0000-4000-8000-000000000011','E2E correction learner','e2e-correction-student@example.test','attended');
insert into public.payment_entries(student_id,kind,amount_minor,currency,external_reference,reason) values('e7600000-0000-4000-8000-000000000011','payment',6000,'USD','e2e-correction-original-payment','Existing synthetic history');
insert into public.calendar_projections(lesson_id,status,external_event_id,projected_version,claim_token,claim_until,claimed_version)
values('e7600000-0000-4000-8000-000000000013','projecting','e2e-correction-external-event',1,'e7600000-0000-4000-8000-000000000017',now()+interval '5 minutes',1);
create function pg_temp.correction_value(p_lesson uuid default 'e7600000-0000-4000-8000-000000000013',p_start text default '2020-01-01T09:00:00Z',p_end text default '2020-01-01T10:00:00Z') returns jsonb language sql as $$
 select jsonb_build_object('lessonId',p_lesson,'version',(select version from public.lessons where id=p_lesson),'startsAt',p_start,'endsAt',p_end,'timezone','UTC','reason','Original date/time was mistyped');
$$;
select ok(not has_function_privilege('anon','public.correct_lesson_datetime(jsonb,text)','execute'),'Anonymous cannot correct records');
select ok(not has_function_privilege('service_role','public.correct_lesson_datetime(jsonb,text)','execute'),'Background services cannot impersonate the correction command');
select ok(not has_table_privilege('authenticated','lesson_ops.datetime_corrections','insert'),'Portal roles cannot fabricate private correction authority');
set local role authenticated;
select set_config('request.jwt.claim.sub','e7600000-0000-4000-8000-000000000002',true);
select throws_ok($$select public.preview_lesson_datetime_correction(pg_temp.correction_value())$$,'42501','FORBIDDEN','Student cannot preview coach correction');
select set_config('request.jwt.claim.sub','e7600000-0000-4000-8000-000000000003',true);
select throws_ok($$select public.correct_lesson_datetime(pg_temp.correction_value(),'e2e-correction-unrelated')$$,'42501','FORBIDDEN','Unrelated identity cannot correct');
select set_config('request.jwt.claim.sub','e7600000-0000-4000-8000-000000000001',true);
select is(public.preview_lesson_datetime_correction(pg_temp.correction_value())->>'financialReviewRequired','true','Paid historical dependency is visible in preview');
select is(public.preview_lesson_datetime_correction(pg_temp.correction_value())?'dependencies',false,'Private checkout/provider dependency bodies are not returned to the UI');
select throws_ok($$select public.correct_lesson_datetime(pg_temp.correction_value(),'e2e-correction-no-review')$$,'P0001','VERSION_CONFLICT: Correction dependencies changed. Preview again.','Execution requires its actual dependency preview');
reset role;
create temporary table e2e_correction_prepared(value jsonb);
grant all on e2e_correction_prepared to authenticated;
set local role authenticated;
insert into e2e_correction_prepared select pg_temp.correction_value()||jsonb_build_object('reviewToken',public.preview_lesson_datetime_correction(pg_temp.correction_value())->>'reviewToken');
select throws_ok($$select public.correct_lesson_datetime((select value from e2e_correction_prepared),'e2e-correction-financial-ack')$$,'P0001','REVIEW_REQUIRED: Acknowledge the unchanged financial history and review requirement.','Financially linked correction requires explicit acknowledgement');
update e2e_correction_prepared set value=value||'{"financialAcknowledged":true}'::jsonb;
reset role;
create function pg_temp.reject_correction_audit() returns trigger language plpgsql as $$begin raise exception 'SYNTHETIC_CORRECTION_FAILURE';end$$;
create trigger e2e_correction_fault before insert on public.audit_events for each row when(new.correlation_id='e2e-correction-fault') execute function pg_temp.reject_correction_audit();
set local role authenticated;
select throws_ok($$select public.correct_lesson_datetime((select value from e2e_correction_prepared),'e2e-correction-fault')$$,'P0001','SYNTHETIC_CORRECTION_FAILURE','Late audit rejection rolls back lesson/booking/correction/lease changes');
reset role;
drop trigger e2e_correction_fault on public.audit_events;
select is((select starts_at from public.lessons where id='e7600000-0000-4000-8000-000000000013'),'2020-01-01T10:00Z'::timestamptz,'Failed correction leaves original time');
select is((select count(*) from lesson_ops.datetime_corrections),0::bigint,'Failed correction leaves no success receipt');
set local role authenticated;
select lives_ok($$select public.correct_lesson_datetime((select value from e2e_correction_prepared),'e2e-correction-commit')$$,'Coach corrects a historical completed occurrence');
select lives_ok($$select public.correct_lesson_datetime((select value from e2e_correction_prepared),'e2e-correction-commit')$$,'Lost response replays before version/dependency checks');
select throws_ok($$select public.correct_lesson_datetime((select value||'{"reason":"Different request"}'::jsonb from e2e_correction_prepared),'e2e-correction-commit')$$,'P0001','IDEMPOTENCY_CONFLICT','Changed payload cannot reuse correction identity');
select is(public.lesson_datetime_correction_history('e7600000-0000-4000-8000-000000000013')->>'total','1','History contains one correction after replay');
select is(public.lesson_datetime_correction_history('e7600000-0000-4000-8000-000000000013')->>'financialReviewsPending','1','Financial review hold is durable and visible');
reset role;
select is((select starts_at from public.lessons where id='e7600000-0000-4000-8000-000000000013'),'2020-01-01T09:00Z'::timestamptz,'Selected lesson gets the corrected instant');
select is((select starts_at from public.bookings where id='e7600000-0000-4000-8000-000000000016'),'2020-01-01T09:00Z'::timestamptz,'Sole linked booking stays consistent');
select is((select status::text from public.lessons where id='e7600000-0000-4000-8000-000000000013'),'completed','Attendance outcome is preserved');
select is((select status from public.lesson_participants where lesson_id='e7600000-0000-4000-8000-000000000013'),'attended','Participant attendance is preserved');
select is((select created_at from public.lessons where id='e7600000-0000-4000-8000-000000000013'),'2020-01-02T10:00Z'::timestamptz,'Original creation timestamp is preserved');
select is((select sum(amount_minor) from public.payment_entries where student_id='e7600000-0000-4000-8000-000000000011'),6000::numeric,'Financial ledger is unchanged');
select is((select paid_minor from public.bookings where id='e7600000-0000-4000-8000-000000000016'),6000::bigint,'Booking paid amount is unchanged');
select is((select status from public.calendar_projections where lesson_id='e7600000-0000-4000-8000-000000000013'),'review_required','Provider projection is held rather than falsely projected');
select is(public.calendar_claim_current((select id from public.calendar_projections where lesson_id='e7600000-0000-4000-8000-000000000013'),'e7600000-0000-4000-8000-000000000017'),false,'A stale Calendar lease cannot project the correction');
select is((select count(*) from public.outbox_messages where studio_id='e7600000-0000-4000-8000-000000000010'),0::bigint,'Correction creates no notification');
-- Use a separate transaction ID simulation by removing only the private test
-- proof, so this outer rollback test can exercise later automatic worker writes.
update lesson_ops.datetime_corrections set operation_txid=0;
select set_config('app.lesson_actor','',true);
select set_config('request.jwt.claim.sub','',true);
-- This disposable schema has no default service table grants. Grant only the
-- worker's required columns inside the outer rollback so the trigger, rather
-- than the fixture's missing grant, is actually exercised.
grant select,update(starts_at,ends_at) on public.lessons to service_role;
set local role service_role;
select throws_ok($$update public.lessons set starts_at='2020-01-01T10:00Z',ends_at='2020-01-01T11:00Z' where id='e7600000-0000-4000-8000-000000000013'$$,'P0001','REVIEW_REQUIRED: Corrected records require explicit coach review before source changes.','Automatic source cannot overwrite corrected history');
reset role;
select is(credit_internal.evaluate_student_lesson_credit('e7600000-0000-4000-8000-000000000011','e7600000-0000-4000-8000-000000000013','automatic')->>'state','review_required','Automatic credit allocation is held after correction');
set local role authenticated;
select set_config('request.jwt.claim.sub','e7600000-0000-4000-8000-000000000001',true);
select is(public.preview_lesson_datetime_correction(pg_temp.correction_value('e7600000-0000-4000-8000-000000000014','2031-11-11T10:00:00Z','2031-11-11T11:00:00Z'))->>'reasonCode','local_overlap','Existing private overlap policy remains authoritative');
reset role;
update public.lessons set invoice_payment_pending=true where id='e7600000-0000-4000-8000-000000000014';
set local role authenticated;
select is(public.preview_lesson_datetime_correction(pg_temp.correction_value('e7600000-0000-4000-8000-000000000014','2020-01-02T10:00:00Z','2020-01-02T11:00:00Z'))->>'reasonCode','checkout_in_progress','In-flight payment cannot be bypassed by correction acknowledgement');
reset role;
update public.lessons set invoice_payment_pending=false where id='e7600000-0000-4000-8000-000000000014';
set local role authenticated;
truncate e2e_correction_prepared;
insert into e2e_correction_prepared select pg_temp.correction_value(p_start=>'2020-01-01T08:00:00Z',p_end=>'2020-01-01T09:00:00Z')||jsonb_build_object('reviewToken',public.preview_lesson_datetime_correction(pg_temp.correction_value(p_start=>'2020-01-01T08:00:00Z',p_end=>'2020-01-01T09:00:00Z'))->>'reviewToken','financialAcknowledged',true);
reset role;
update public.bookings set version=version+1 where id='e7600000-0000-4000-8000-000000000016';
set local role authenticated;
select throws_ok($$select public.correct_lesson_datetime((select value from e2e_correction_prepared),'e2e-correction-stale-dependency')$$,'P0001','VERSION_CONFLICT: Correction dependencies changed. Preview again.','Changed linked booking invalidates its reviewed dependency seal');
select lives_ok($$select public.record_datetime_correction_review(jsonb_build_object('lessonId','e7600000-0000-4000-8000-000000000013','lessonVersion',(select version from public.lessons where id='e7600000-0000-4000-8000-000000000013'),'correctionId',(public.lesson_datetime_correction_history('e7600000-0000-4000-8000-000000000013')->'items'->0->>'id'),'kind','financial','note','Reviewed existing accounting; no adjustment required'),'e2e-correction-review')$$,'Coach records financial review without changing accounting');
select lives_ok($$select public.record_datetime_correction_review(jsonb_build_object('lessonId','e7600000-0000-4000-8000-000000000013','lessonVersion',(select version from public.lessons where id='e7600000-0000-4000-8000-000000000013'),'correctionId',(public.lesson_datetime_correction_history('e7600000-0000-4000-8000-000000000013')->'items'->0->>'id'),'kind','financial','note','Reviewed existing accounting; no adjustment required'),'e2e-correction-review')$$,'Lost review response replays once');
select is(public.lesson_datetime_correction_history('e7600000-0000-4000-8000-000000000013')->>'financialReviewsPending','0','Reviewed financial state is visible');
-- Future corrected record stays out of automatic allocation; other lessons keep
-- their ordinary coverage. No balancing entry is generated by a date edit.
truncate e2e_correction_prepared;
insert into e2e_correction_prepared select pg_temp.correction_value('e7600000-0000-4000-8000-000000000014','2031-11-12T10:00:00Z','2031-11-12T11:00:00Z')||jsonb_build_object('reviewToken',public.preview_lesson_datetime_correction(pg_temp.correction_value('e7600000-0000-4000-8000-000000000014','2031-11-12T10:00:00Z','2031-11-12T11:00:00Z'))->>'reviewToken');
select lives_ok($$select public.correct_lesson_datetime((select value from e2e_correction_prepared),'e2e-correction-future')$$,'Coach corrects a future occurrence without an arbitrary past/future restriction');
reset role;
insert into public.student_credit_accounts(student_id,auto_apply) values('e7600000-0000-4000-8000-000000000011',true);
insert into public.packages(id,student_id,name,auto_apply,expires_at) values('e7600000-0000-4000-8000-000000000018','e7600000-0000-4000-8000-000000000011','E2E correction credits',true,'2032-01-01T00:00:00Z');
insert into public.package_credit_entries(package_id,kind,quantity,reason,idempotency_key) values('e7600000-0000-4000-8000-000000000018','purchase',2,'E2E correction purchase','e2e-correction-purchase');
select lives_ok($$select public.reserve_student_upcoming_credits('e7600000-0000-4000-8000-000000000011')$$,'Ordinary coverage maintenance remains available');
select is((select count(*) from public.package_credit_entries where lesson_id='e7600000-0000-4000-8000-000000000014'),0::bigint,'Automatic maintenance cannot allocate a new credit to the corrected lesson');
select is((select count(*) from public.package_credit_entries where lesson_id='e7600000-0000-4000-8000-000000000015' and quantity<0),1::bigint,'Unrelated eligible lesson retains automatic coverage');
select is((select sum(amount_minor) from public.payment_entries where student_id='e7600000-0000-4000-8000-000000000011'),6000::numeric,'Correction and review never alter cash history');
select * from finish();
rollback;
