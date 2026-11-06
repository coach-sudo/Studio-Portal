-- Isolated PostgreSQL only. Every synthetic identity and fault rolls back.
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
insert into auth.users(id,email) values
 ('e2920000-0000-4000-8000-000000000001','e2e-payment-coach@example.test'),
 ('e2920000-0000-4000-8000-000000000002','e2e-payment-student@example.test'),
 ('e2920000-0000-4000-8000-000000000003','e2e-payment-guardian@example.test'),
 ('e2920000-0000-4000-8000-000000000004','e2e-payment-unrelated@example.test'),
 ('e2920000-0000-4000-8000-000000000005','e2e-payment-other-coach@example.test');
insert into public.studios(id,name,slug,settings) values
 ('e2920000-0000-4000-8000-000000000010','E2E payment studio','e2e-payment','{"currency":"USD"}'),
 ('e2920000-0000-4000-8000-000000000020','E2E other studio','e2e-other-payment','{"currency":"USD"}');
insert into public.memberships(studio_id,user_id,role,display_name) values
 ('e2920000-0000-4000-8000-000000000010','e2920000-0000-4000-8000-000000000001','coach','Synthetic coach'),
 ('e2920000-0000-4000-8000-000000000020','e2920000-0000-4000-8000-000000000005','coach','Other studio coach');
insert into public.students(id,studio_id,user_id,full_name,email) values
 ('e2920000-0000-4000-8000-000000000012','e2920000-0000-4000-8000-000000000010','e2920000-0000-4000-8000-000000000002','Original payment student','e2e-payment-student@example.test');
insert into public.student_relationships(student_id,user_id,relationship,can_view_finance,can_view_schedule) values
 ('e2920000-0000-4000-8000-000000000012','e2920000-0000-4000-8000-000000000003','guardian',true,true);
insert into public.booking_services(id,studio_id,slug,name,category,duration_minutes,price_minor) values
 ('e2920000-0000-4000-8000-000000000013','e2920000-0000-4000-8000-000000000010','e2e-payment','E2E payment service','private',60,6000);
insert into public.bookings(id,studio_id,reference,service_id,student_id,guest_name,guest_email,starts_at,ends_at,timezone,location,status,payment_policy,payment_status,total_minor,paid_minor,currency,policy_snapshot,manage_token_hash)
 values('e2920000-0000-4000-8000-000000000014','e2920000-0000-4000-8000-000000000010','E2E-PAYMENT','e2920000-0000-4000-8000-000000000013','e2920000-0000-4000-8000-000000000012','Original payment student','e2e-payment-student@example.test','2031-01-15T15:00:00Z','2031-01-15T16:00:00Z','America/New_York','in_person','confirmed','pay_later','due',6000,0,'USD','{}','e2e-payment-booking');
insert into public.lessons(id,studio_id,student_id,topic,starts_at,ends_at,status,location_type,location_label,price_minor,paid_minor,payment_status,created_at) values
 ('e2920000-0000-4000-8000-000000000011','e2920000-0000-4000-8000-000000000010','e2920000-0000-4000-8000-000000000012','Synthetic unpaid lesson','2031-01-15T15:00:00Z','2031-01-15T16:00:00Z','scheduled','in_person','Original location',6000,0,'due','2020-01-01T00:00:00Z'),
 ('e2920000-0000-4000-8000-000000000015','e2920000-0000-4000-8000-000000000010','e2920000-0000-4000-8000-000000000012','Historical completed lesson','2001-01-01T15:00:00Z','2001-01-01T16:00:00Z','completed','in_person','Historical location',4000,0,'due','2001-01-01T00:00:00Z');
insert into public.lesson_participants(lesson_id,booking_id,student_id,display_name,email,status) values
 ('e2920000-0000-4000-8000-000000000011','e2920000-0000-4000-8000-000000000014','e2920000-0000-4000-8000-000000000012','Original payment student','e2e-payment-student@example.test','confirmed');
create function pg_temp.payment_value(p_amount bigint default 1000,p_lesson uuid default 'e2920000-0000-4000-8000-000000000011') returns jsonb language sql as $$
 select jsonb_build_object('lessonId',p_lesson,'version',c->'version','reviewToken',c->'reviewToken','amountMinor',p_amount,'currency',c->'currency','method','cash','reason','Synthetic cash already received') from (select public.lesson_payment_context(p_lesson) c) x;
$$;
create temporary table e2e_payment_attempt(value jsonb,result jsonb);
grant all on e2e_payment_attempt to authenticated;
-- Synthetic transaction-only grant ensures a raw caller reaches the new guard.
grant update(payment_status,paid_minor,price_minor) on public.lessons to authenticated;
select ok(not has_function_privilege('anon','public.record_lesson_payment(jsonb,text)','execute'),'Anonymous cannot record financial effects');
select ok(not has_function_privilege('service_role','public.record_lesson_payment(jsonb,text)','execute'),'Receipt command requires a real coach actor');
select ok(not has_table_privilege('authenticated','lesson_ops.payment_receipts','select'),'Private replay receipts are not directly exposed');
set local role authenticated;
select set_config('request.jwt.claim.sub','e2920000-0000-4000-8000-000000000002',true);
select throws_ok($$select public.lesson_payment_context('e2920000-0000-4000-8000-000000000011')$$,'42501','FORBIDDEN','Student cannot obtain coach payment context');
select set_config('request.jwt.claim.sub','e2920000-0000-4000-8000-000000000003',true);
select throws_ok($$select public.lesson_payment_context('e2920000-0000-4000-8000-000000000011')$$,'42501','FORBIDDEN','Guardian finance visibility is not payment authority');
select set_config('request.jwt.claim.sub','e2920000-0000-4000-8000-000000000004',true);
select throws_ok($$select public.lesson_payment_context('e2920000-0000-4000-8000-000000000011')$$,'42501','FORBIDDEN','Unrelated user cannot preview accounting');
select set_config('request.jwt.claim.sub','e2920000-0000-4000-8000-000000000005',true);
select throws_ok($$select public.lesson_payment_context('e2920000-0000-4000-8000-000000000011')$$,'42501','FORBIDDEN','Coach of another studio cannot obtain payment authority');
select set_config('request.jwt.claim.sub','e2920000-0000-4000-8000-000000000001',true);
select is(public.lesson_payment_context('e2920000-0000-4000-8000-000000000011')->>'eligible','true','Coach sees the exact eligible original account');
select throws_ok($$update public.lessons set payment_status='paid',paid_minor=6000 where id='e2920000-0000-4000-8000-000000000011'$$,'P0001','REVIEW_REQUIRED: Use the authoritative payment, invoice or credit command.','Direct monetary edits cannot bypass the receipt command');
select throws_ok($$select public.record_lesson_payment(pg_temp.payment_value()||'{"priceMinor":1}'::jsonb,'e2e-reprice-held')$$,'P0001','VALIDATION_FAILED: Record a positive received amount, method, reason and reviewed lesson.','Payment receipt cannot reprice a lesson');
select throws_ok($$select public.record_lesson_payment(pg_temp.payment_value()||'{"method":"refund"}'::jsonb,'e2e-refund-held')$$,'P0001','VALIDATION_FAILED: Record a positive received amount, method, reason and reviewed lesson.','Payment receipt does not imply refunds or waivers');
select throws_ok($$select public.record_lesson_payment(pg_temp.payment_value(7000),'e2e-overpayment-held')$$,'P0001','VALIDATION_FAILED: Received amount exceeds the reviewed balance or uses a different currency.','Overpayment requires separate review');
reset role;
create function pg_temp.reject_payment() returns trigger language plpgsql as $$begin raise exception 'SYNTHETIC_PAYMENT_FAILURE';end$$;
create trigger e2e_payment_ledger_fault before insert on public.payment_entries for each row execute function pg_temp.reject_payment();
set local role authenticated;
select throws_ok($$select public.record_lesson_payment(pg_temp.payment_value(),'e2e-ledger-fault')$$,'P0001','SYNTHETIC_PAYMENT_FAILURE','Ledger failure cannot return paid success');
reset role;
drop trigger e2e_payment_ledger_fault on public.payment_entries;
select is((select paid_minor from public.lessons where id='e2920000-0000-4000-8000-000000000011'),0::bigint,'Ledger failure preserves lesson paid state');
select is((select paid_minor from public.bookings where id='e2920000-0000-4000-8000-000000000014'),0::bigint,'Ledger failure preserves booking paid state');
create trigger e2e_payment_booking_fault before update on public.bookings for each row execute function pg_temp.reject_payment();
set local role authenticated;
select throws_ok($$select public.record_lesson_payment(pg_temp.payment_value(),'e2e-booking-fault')$$,'P0001','SYNTHETIC_PAYMENT_FAILURE','Booking projection failure rolls back the payment ledger');
reset role;
drop trigger e2e_payment_booking_fault on public.bookings;
select is((select count(*) from public.payment_entries where student_id='e2920000-0000-4000-8000-000000000012'),0::bigint,'Failed booking projection leaves no ledger effect');
create trigger e2e_payment_audit_fault before insert on public.audit_events for each row when(new.action='lesson.payment_recorded') execute function pg_temp.reject_payment();
set local role authenticated;
select throws_ok($$select public.record_lesson_payment(pg_temp.payment_value(),'e2e-audit-fault')$$,'P0001','SYNTHETIC_PAYMENT_FAILURE','Late audit failure rolls back both projections and ledger');
reset role;
drop trigger e2e_payment_audit_fault on public.audit_events;
create trigger e2e_payment_receipt_fault before insert on lesson_ops.payment_receipts for each row execute function pg_temp.reject_payment();
set local role authenticated;
select throws_ok($$select public.record_lesson_payment(pg_temp.payment_value(),'e2e-receipt-fault')$$,'P0001','SYNTHETIC_PAYMENT_FAILURE','Late receipt failure cannot leave an unrecorded financial effect');
reset role;
drop trigger e2e_payment_receipt_fault on lesson_ops.payment_receipts;
select is((select count(*) from public.payment_entries where student_id='e2920000-0000-4000-8000-000000000012'),0::bigint,'All injected failures leave no payment');
select is((select count(*) from lesson_ops.payment_receipts where student_id='e2920000-0000-4000-8000-000000000012'),0::bigint,'All injected failures leave no receipt');
set local role authenticated;
insert into e2e_payment_attempt(value) select pg_temp.payment_value();
select lives_ok($$update e2e_payment_attempt set result=public.record_lesson_payment(value,'e2e-first-payment')$$,'Coach commits a partial payment atomically');
select is(public.record_lesson_payment((select value from e2e_payment_attempt),'e2e-first-payment')::text,(select result::text from e2e_payment_attempt),'Lost response returns the identical immutable receipt');
select throws_ok($$select public.record_lesson_payment((select value from e2e_payment_attempt)||'{"amountMinor":2000}'::jsonb,'e2e-first-payment')$$,'P0001','IDEMPOTENCY_CONFLICT','Changed payload reuse is rejected');
select is((select paid_minor from public.bookings where id='e2920000-0000-4000-8000-000000000014'),1000::bigint,'Booking displays only committed payment');
select is((select paid_minor from public.lessons where id='e2920000-0000-4000-8000-000000000011'),1000::bigint,'Lesson projection matches the booking and ledger');
select lives_ok($$select public.record_lesson_payment(pg_temp.payment_value(5000),'e2e-final-payment')$$,'A separate received payment settles the remaining balance');
select is(public.record_lesson_payment((select value from e2e_payment_attempt),'e2e-first-payment')::text,(select result::text from e2e_payment_attempt),'Old replay remains immutable after a later settlement');
select is((select payment_status from public.bookings where id='e2920000-0000-4000-8000-000000000014'),'paid','Paid booking is backed by committed receipts');
select is((select price_minor from public.lessons where id='e2920000-0000-4000-8000-000000000011'),6000::bigint,'Recording cash never reprices the lesson');
select is((select created_at from public.lessons where id='e2920000-0000-4000-8000-000000000011'),'2020-01-01T00:00:00Z'::timestamptz,'Original lesson creation history remains');
select lives_ok($$select public.record_lesson_payment(pg_temp.payment_value(1000,'e2920000-0000-4000-8000-000000000015'),'e2e-historical-payment')$$,'Actual historical payment does not imply attendance');
select is((select status::text from public.lessons where id='e2920000-0000-4000-8000-000000000015'),'completed','Historical attendance/outcome stays explicit and unchanged');
select set_config('request.jwt.claim.sub','e2920000-0000-4000-8000-000000000002',true);
select is((select sum(amount_minor)::bigint from public.payment_entries where student_id='e2920000-0000-4000-8000-000000000012'),7000::bigint,'Original student sees the committed accounting');
select throws_ok($$select public.record_lesson_payment((select value from e2e_payment_attempt),'e2e-first-payment')$$,'42501','FORBIDDEN','Student cannot recover or replay coach money effects');
select set_config('request.jwt.claim.sub','e2920000-0000-4000-8000-000000000003',true);
select is((select sum(amount_minor)::bigint from public.payment_entries where student_id='e2920000-0000-4000-8000-000000000012'),7000::bigint,'Finance-authorized guardian sees the same ledger');
select throws_ok($$select public.record_lesson_payment((select value from e2e_payment_attempt),'e2e-first-payment')$$,'42501','FORBIDDEN','Guardian finance visibility cannot replay a coach receipt');
select set_config('request.jwt.claim.sub','e2920000-0000-4000-8000-000000000004',true);
select throws_ok($$select public.record_lesson_payment((select value from e2e_payment_attempt),'e2e-first-payment')$$,'42501','FORBIDDEN','Unrelated user cannot replay a receipt');
select set_config('request.jwt.claim.sub','e2920000-0000-4000-8000-000000000005',true);
select throws_ok($$select public.record_lesson_payment((select value from e2e_payment_attempt),'e2e-first-payment')$$,'42501','FORBIDDEN','Another studio coach cannot recover original accounting');
reset role;
select is((select sum(amount_minor)::bigint from lesson_ops.payment_receipts where student_id='e2920000-0000-4000-8000-000000000012'),7000::bigint,'Receipts allocate each ledger effect to its original student');
select is((select count(*) from public.package_credit_entries e join public.packages p on p.id=e.package_id where p.student_id='e2920000-0000-4000-8000-000000000012'),0::bigint,'Cash recording never consumes or creates lesson credits');
select is((select count(*) from public.outbox_messages where studio_id='e2920000-0000-4000-8000-000000000010'),0::bigint,'Cash recording never invents notification delivery');
select is((select count(*) from public.calendar_projections where lesson_id in('e2920000-0000-4000-8000-000000000011','e2920000-0000-4000-8000-000000000015')),0::bigint,'Cash receipt does not project provider state');
-- Explicit unsupported cases stay held rather than inventing settlement policy.
-- A reassigned lesson must not project an original owner's receipts onto a new
-- account. These isolated privileged fixture changes simulate inconsistent history.
insert into public.students(id,studio_id,full_name) values('e2920000-0000-4000-8000-000000000042','e2920000-0000-4000-8000-000000000010','Synthetic changed lesson owner');
update public.lessons set student_id='e2920000-0000-4000-8000-000000000042' where id='e2920000-0000-4000-8000-000000000015';
set local role authenticated;
select set_config('request.jwt.claim.sub','e2920000-0000-4000-8000-000000000001',true);
select is(public.lesson_payment_context('e2920000-0000-4000-8000-000000000015')->>'reasonCode','historical_totals_review','Changed lesson owner cannot inherit original receipt allocations');
select throws_ok($$select public.record_lesson_payment(pg_temp.payment_value(1000,'e2920000-0000-4000-8000-000000000015'),'e2e-reassigned-owner-held')$$,'P0001','REVIEW_REQUIRED: historical_totals_review','Further money is held after unsupported ownership reassignment');
reset role;
select is((select sum(amount_minor)::bigint from public.payment_entries where student_id='e2920000-0000-4000-8000-000000000012'),7000::bigint,'Original ledger money stays with its original owner');
select is((select count(*) from public.payment_entries where student_id='e2920000-0000-4000-8000-000000000042'),0::bigint,'Reassigned account receives no ledger effect');
update public.lessons set student_id='e2920000-0000-4000-8000-000000000012' where id='e2920000-0000-4000-8000-000000000015';
update lesson_ops.payment_receipts set studio_id='e2920000-0000-4000-8000-000000000020' where lesson_id='e2920000-0000-4000-8000-000000000015';
set local role authenticated;
select is(public.lesson_payment_context('e2920000-0000-4000-8000-000000000015')->>'reasonCode','historical_totals_review','Prior receipt studio mismatch is held for review');
reset role;
update lesson_ops.payment_receipts set studio_id='e2920000-0000-4000-8000-000000000010' where lesson_id='e2920000-0000-4000-8000-000000000015';
select is((select count(*) from lesson_ops.payment_receipts r join public.payment_entries e on e.id=r.payment_entry_id and e.student_id=r.student_id where r.lesson_id='e2920000-0000-4000-8000-000000000015' and r.student_id='e2920000-0000-4000-8000-000000000012'),1::bigint,'Historical receipt keeps its exact original ledger identity');
update public.lessons set capacity=2 where id='e2920000-0000-4000-8000-000000000015';
set local role authenticated;
select set_config('request.jwt.claim.sub','e2920000-0000-4000-8000-000000000001',true);
select is(public.lesson_payment_context('e2920000-0000-4000-8000-000000000015')->>'reasonCode','allocation_review','Shared allocation is held');
reset role;
update public.lessons set capacity=1,invoice_payment_pending=true where id='e2920000-0000-4000-8000-000000000015';
set local role authenticated;
select is(public.lesson_payment_context('e2920000-0000-4000-8000-000000000015')->>'reasonCode','checkout_pending','Pending checkout is held');
reset role;
update public.lessons set invoice_payment_pending=false,paid_minor=99 where id='e2920000-0000-4000-8000-000000000015';
set local role authenticated;
select is(public.lesson_payment_context('e2920000-0000-4000-8000-000000000015')->>'reasonCode','historical_totals_review','Unexplained legacy totals require review');
reset role;
update public.lessons set paid_minor=1000 where id='e2920000-0000-4000-8000-000000000015';
insert into public.packages(id,student_id,name) values('e2920000-0000-4000-8000-000000000040','e2920000-0000-4000-8000-000000000012','Synthetic existing credit package');
update public.lessons set package_id='e2920000-0000-4000-8000-000000000040' where id='e2920000-0000-4000-8000-000000000015';
set local role authenticated;
select is(public.lesson_payment_context('e2920000-0000-4000-8000-000000000015')->>'reasonCode','credit_review','Existing credit attachment cannot be displaced');
reset role;
update public.lessons set package_id=null where id='e2920000-0000-4000-8000-000000000015';
insert into public.studio_invoices(id,studio_id,student_id,number,status,currency,issue_date,due_date,branding,recipient,items,total_minor)
 values('e2920000-0000-4000-8000-000000000041','e2920000-0000-4000-8000-000000000010','e2920000-0000-4000-8000-000000000012','E2E-PAYMENT-HOLD','open','USD',current_date,current_date+7,'{}','{}','[{"id":"existing","quantity":1,"unitMinor":4000,"lessonIds":["e2920000-0000-4000-8000-000000000015"]}]',4000);
set local role authenticated;
select is(public.lesson_payment_context('e2920000-0000-4000-8000-000000000015')->>'reasonCode','use_invoice','Existing invoice allocation uses its authoritative journey');
reset role;
select is((select sum(amount_minor)::bigint from public.payment_entries where student_id='e2920000-0000-4000-8000-000000000012'),7000::bigint,'Unsupported review cases do not change money');
delete from public.memberships where user_id='e2920000-0000-4000-8000-000000000001';
set local role authenticated;
select set_config('request.jwt.claim.sub','e2920000-0000-4000-8000-000000000001',true);
select throws_ok($$select public.record_lesson_payment((select value from e2e_payment_attempt),'e2e-first-payment')$$,'42501','FORBIDDEN','Revoked coach cannot recover a previous receipt');
reset role;
insert into public.memberships(studio_id,user_id,role,display_name) values('e2920000-0000-4000-8000-000000000010','e2920000-0000-4000-8000-000000000001','coach','Restored synthetic coach');
set local role authenticated;
select is(public.record_lesson_payment((select value from e2e_payment_attempt),'e2e-first-payment')::text,(select result::text from e2e_payment_attempt),'Restored coach recovers the exact original immutable receipt');
reset role;
select is((select count(*) from lesson_ops.payment_receipts where student_id='e2920000-0000-4000-8000-000000000012'),3::bigint,'Revoked then restored recovery never adds a second financial effect');
select * from finish();
rollback;
