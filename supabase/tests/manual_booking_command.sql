-- Isolated PostgreSQL only. All fixture state and injected failures roll back.
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
insert into auth.users(id,email) values
 ('e7100000-0000-4000-8000-000000000001','e2e-manual-coach@example.test'),
 ('e7100000-0000-4000-8000-000000000002','e2e-manual-student@example.test'),
 ('e7100000-0000-4000-8000-000000000003','e2e-manual-guardian@example.test'),
 ('e7100000-0000-4000-8000-000000000004','e2e-manual-unrelated@example.test');
insert into public.studios(id,name,slug,timezone) values('e7100000-0000-4000-8000-000000000010','E2E manual booking','e2e-manual-booking','America/New_York');
insert into public.memberships(studio_id,user_id,role,display_name) values
 ('e7100000-0000-4000-8000-000000000010','e7100000-0000-4000-8000-000000000001','coach','Synthetic coach'),
 ('e7100000-0000-4000-8000-000000000010','e7100000-0000-4000-8000-000000000002','student','Synthetic learner'),
 ('e7100000-0000-4000-8000-000000000010','e7100000-0000-4000-8000-000000000003','guardian','Synthetic guardian');
insert into public.students(id,studio_id,full_name,email) values('e7100000-0000-4000-8000-000000000011','e7100000-0000-4000-8000-000000000010','E2E manual learner','e2e-manual-student@example.test');
insert into public.booking_services(id,studio_id,slug,name,category,duration_minutes,price_minor) values('e7100000-0000-4000-8000-000000000012','e7100000-0000-4000-8000-000000000010','e2e-manual','E2E synthetic coaching','private',60,6000);
create function pg_temp.manual_value(p_starts text default '2031-11-03T18:00:00Z',p_paid boolean default true) returns jsonb language sql as $$
 select jsonb_build_object('student_id','e7100000-0000-4000-8000-000000000011','service_id','e7100000-0000-4000-8000-000000000012','starts_at',p_starts,'mark_paid',p_paid,'reason','Synthetic manual regression');
$$;
select ok(not has_function_privilege('anon','public.command_create_manual_booking(text,jsonb,text)','execute'),'Anonymous cannot create manual bookings');
select ok(not has_function_privilege('authenticated','public.claim_manual_booking_effects(integer)','execute'),'Portal roles cannot claim side effects');
select ok(not has_table_privilege('authenticated','workspace_internal.manual_booking_receipts','select'),'Private replay responses are not directly readable');
set local role authenticated;
select set_config('request.jwt.claim.sub','e7100000-0000-4000-8000-000000000002',true);
select throws_ok($$select public.command_create_manual_booking('e2e-student-denied',pg_temp.manual_value())$$,'42501','FORBIDDEN','Student has no coach authority');
select set_config('request.jwt.claim.sub','e7100000-0000-4000-8000-000000000003',true);
select throws_ok($$select public.command_create_manual_booking('e2e-guardian-denied',pg_temp.manual_value())$$,'42501','FORBIDDEN','Guardian has no coach authority');
select set_config('request.jwt.claim.sub','e7100000-0000-4000-8000-000000000004',true);
select throws_ok($$select public.command_create_manual_booking('e2e-unrelated-denied',pg_temp.manual_value())$$,'42501','FORBIDDEN','Unrelated user cannot create');
select set_config('request.jwt.claim.sub','e7100000-0000-4000-8000-000000000001',true);
select lives_ok($$select public.command_create_manual_booking('e2e-manual-paid',pg_temp.manual_value(),'not_configured')$$,'Coach command commits a paid booking atomically');
select lives_ok($$select public.command_create_manual_booking('e2e-manual-paid',pg_temp.manual_value(),'checked')$$,'Lost response replay precedes fresh provider observations');
select throws_ok($$select public.command_create_manual_booking('e2e-manual-paid',pg_temp.manual_value('2031-11-03T20:00:00Z'))$$,'P0001','IDEMPOTENCY_CONFLICT','Changed request under the same key is rejected');
select is((select count(*) from public.bookings where studio_id='e7100000-0000-4000-8000-000000000010'),1::bigint,'Replay created one booking');
select is((select count(*) from public.lessons where studio_id='e7100000-0000-4000-8000-000000000010'),1::bigint,'Replay created one occurrence');
select is((select count(*) from public.lesson_participants where student_id='e7100000-0000-4000-8000-000000000011'),1::bigint,'Participant committed once');
select is((select count(*) from public.payment_entries where student_id='e7100000-0000-4000-8000-000000000011'),1::bigint,'Payment ledger committed once');
select is((select payment_status from public.bookings where studio_id='e7100000-0000-4000-8000-000000000010'),'paid','Paid status has its ledger');
select throws_ok($$select public.command_create_manual_booking('e2e-manual-overlap',pg_temp.manual_value()||'{"allow_conflict":true}'::jsonb,'overridden')$$,'P0001','SLOT_UNAVAILABLE: Studio lessons cannot overlap.','Google override cannot defeat private overlap protection');
reset role;
select is((select count(*) from workspace_internal.manual_booking_effects where booking_id in(select id from public.bookings where studio_id='e7100000-0000-4000-8000-000000000010')),1::bigint,'Notification intent committed once');
select is((select count(*) from public.calendar_projections where lesson_id in(select id from public.lessons where studio_id='e7100000-0000-4000-8000-000000000010')),1::bigint,'Calendar intent committed once');
select is((select count(*) from public.outbox_messages where studio_id='e7100000-0000-4000-8000-000000000010'),0::bigint,'Canonical command does not send or queue provider messages inline');

create function pg_temp.reject_manual_write() returns trigger language plpgsql as $$ begin raise exception 'SYNTHETIC_MANUAL_FAILURE'; end $$;
create trigger e2e_manual_payment_fault before insert on public.payment_entries for each row when(new.student_id='e7100000-0000-4000-8000-000000000011') execute function pg_temp.reject_manual_write();
set local role authenticated;
select throws_ok($$select public.command_create_manual_booking('e2e-manual-ledger-failure',pg_temp.manual_value('2031-11-04T18:00:00Z'))$$,'P0001','SYNTHETIC_MANUAL_FAILURE','Payment insert rejection rolls back canonical transaction');
select is((select count(*) from public.bookings where studio_id='e7100000-0000-4000-8000-000000000010'),1::bigint,'Payment failure leaves no falsely paid booking');
reset role;
drop trigger e2e_manual_payment_fault on public.payment_entries;
create trigger e2e_manual_audit_fault before insert on public.audit_events for each row when(new.correlation_id='e2e-manual-audit-failure') execute function pg_temp.reject_manual_write();
set local role authenticated;
select throws_ok($$select public.command_create_manual_booking('e2e-manual-audit-failure',pg_temp.manual_value('2031-11-04T18:00:00Z'))$$,'P0001','SYNTHETIC_MANUAL_FAILURE','Late audit failure rolls back ledger, booking, participant and intents');
reset role;
drop trigger e2e_manual_audit_fault on public.audit_events;
select is((select count(*) from workspace_internal.manual_booking_receipts where studio_id='e7100000-0000-4000-8000-000000000010'),1::bigint,'Failed transaction never leaves a success receipt');
select is((select count(*) from public.payment_entries where student_id='e7100000-0000-4000-8000-000000000011'),1::bigint,'Late fault leaves no extra ledger entry');
create trigger e2e_manual_intent_fault before insert on workspace_internal.manual_booking_effects for each row execute function pg_temp.reject_manual_write();
set local role authenticated;
select throws_ok($$select public.command_create_manual_booking('e2e-manual-intent-failure',pg_temp.manual_value('2031-11-04T18:00:00Z'))$$,'P0001','SYNTHETIC_MANUAL_FAILURE','Missing durable notification intent aborts the transaction');
reset role;
drop trigger e2e_manual_intent_fault on workspace_internal.manual_booking_effects;
select is((select count(*) from public.lessons where studio_id='e7100000-0000-4000-8000-000000000010'),1::bigint,'All failed intermediate writes leave no orphan occurrence');
set local role authenticated;
select lives_ok($$select public.command_create_manual_booking('e2e-manual-intent-failure',pg_temp.manual_value('2031-11-04T18:00:00Z'))$$,'Same failed request key recovers after the fault is removed');
select lives_ok($$select public.command_create_manual_booking('e2e-manual-historical',pg_temp.manual_value('2020-11-03T18:00:00Z',false)||'{"historical":true,"historical_outcome":"scheduled","historical_financial":"record_only"}'::jsonb)$$,'Database coach authority supports an explicitly scheduled historical record');
select throws_ok($$select public.command_create_manual_booking('e2e-history-unconfirmed',pg_temp.manual_value('2020-11-04T18:00:00Z',false)||'{"historical":true,"historical_outcome":"completed"}'::jsonb)$$,'P0001','VALIDATION_FAILED: Explicit coach outcome confirmation is required.','Time alone cannot prove attendance');
select lives_ok($$select public.command_create_manual_booking('e2e-history-completed',pg_temp.manual_value('2020-11-04T18:00:00Z',false)||'{"historical":true,"historical_outcome":"completed","attendance_confirmed":true,"historical_financial":"record_only"}'::jsonb)$$,'Coach explicitly records completion without financial effects');
select lives_ok($$select public.command_create_manual_booking('e2e-history-cancelled',pg_temp.manual_value('2020-11-05T18:00:00Z',false)||'{"historical":true,"historical_outcome":"cancelled","historical_financial":"record_only"}'::jsonb)$$,'Coach explicitly records cancellation');
select lives_ok($$select public.command_create_manual_booking('e2e-history-no-show',pg_temp.manual_value('2020-11-06T18:00:00Z',false)||'{"historical":true,"historical_outcome":"no_show","attendance_confirmed":true,"historical_financial":"record_only"}'::jsonb)$$,'Coach explicitly records no-show');
select throws_ok($$select public.command_create_manual_booking('e2e-history-duplicate',pg_temp.manual_value('2020-11-04T18:00:00Z',false)||'{"historical":true,"historical_outcome":"completed","attendance_confirmed":true,"historical_financial":"record_only"}'::jsonb)$$,'P0001','REVIEW_REQUIRED: An existing lesson matches this historical occurrence. Open it for review instead of creating a duplicate.','Different command key cannot duplicate completed history');
reset role;
select is((select status::text from public.lessons where student_id='e7100000-0000-4000-8000-000000000011' and starts_at='2020-11-03T18:00:00Z'),'scheduled','Past time does not imply attendance');
select is((select count(*) from workspace_internal.manual_booking_effects where lesson_id in(select id from public.lessons where starts_at='2020-11-03T18:00:00Z')),0::bigint,'Historical command creates no notification intent');
select is((select count(*) from public.payment_entries where student_id='e7100000-0000-4000-8000-000000000011'),2::bigint,'Record-only history adds no payment');
select is((select created_at from public.lessons where student_id='e7100000-0000-4000-8000-000000000011' and starts_at='2020-11-03T18:00:00Z'),now(),'Recorded-at timestamp remains distinct from historical occurrence time');
select is((select sum(total_minor) from public.bookings where studio_id='e7100000-0000-4000-8000-000000000010' and starts_at<'2021-01-01T00:00:00Z'),0::numeric,'Record-only history creates no amount due');
set local role authenticated;
select lives_ok($$select public.command_create_manual_booking('e2e-history-due',pg_temp.manual_value('2020-11-07T18:00:00Z',false)||'{"historical":true,"historical_financial":"amount_due"}'::jsonb)$$,'Historical amount due requires an explicit treatment');
select lives_ok($$select public.command_create_manual_booking('e2e-history-paid',pg_temp.manual_value('2020-11-08T18:00:00Z',false)||'{"historical":true,"historical_financial":"payment_received"}'::jsonb)$$,'Historical received payment is recorded explicitly');
select lives_ok($$select public.command_create_manual_booking('e2e-history-paid',pg_temp.manual_value('2020-11-08T18:00:00Z',false)||'{"historical":true,"historical_financial":"payment_received"}'::jsonb)$$,'Historical payment replay is stable');
reset role;
select is((select payment_status from public.bookings where studio_id='e7100000-0000-4000-8000-000000000010' and starts_at='2020-11-07T18:00:00Z'),'due','Explicit amount due is not falsely paid');
select is((select payment_status from public.bookings where studio_id='e7100000-0000-4000-8000-000000000010' and starts_at='2020-11-08T18:00:00Z'),'paid','Explicit historical payment has a committed ledger');
select is((select count(*) from public.payment_entries where student_id='e7100000-0000-4000-8000-000000000011'),3::bigint,'Historical paid replay appends one payment');
select is((select count(*) from public.calendar_projections where lesson_id in(select id from public.lessons where student_id='e7100000-0000-4000-8000-000000000011' and starts_at<'2021-01-01T00:00:00Z')),0::bigint,'No historical outcome projects into Calendar');
select is((select count(*) from workspace_internal.manual_booking_effects where lesson_id in(select id from public.lessons where student_id='e7100000-0000-4000-8000-000000000011' and starts_at<'2021-01-01T00:00:00Z')),0::bigint,'No historical treatment creates a notification intent');
select * from finish();
rollback;
