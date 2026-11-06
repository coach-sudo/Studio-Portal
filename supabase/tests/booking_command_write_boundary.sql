-- Disposable PostgreSQL only: supported commands retain authority; direct writes do not.
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

select ok(not has_table_privilege('authenticated','public.bookings','INSERT'),'Authenticated cannot insert fragmented bookings');
select ok(not has_table_privilege('authenticated','public.bookings','UPDATE'),'Authenticated cannot bypass financial and datetime commands');
select ok(not has_table_privilege('authenticated','public.bookings','DELETE'),'Authenticated cannot compensate away historical bookings');
select ok(not has_table_privilege('authenticated','public.bookings','TRUNCATE'),'Authenticated cannot truncate financial history');
select ok(not has_table_privilege('anon','public.bookings','INSERT,UPDATE,DELETE,TRUNCATE'),'Anonymous has no direct booking mutation privilege');
select ok(has_table_privilege('authenticated','public.bookings','SELECT'),'Portal booking read privilege remains');
select ok(not exists(select 1 from pg_policies where schemaname='public' and tablename='bookings' and policyname='bookings_coach_write'),'Obsolete direct coach mutation policy is removed');
select ok(exists(select 1 from pg_policies where schemaname='public' and tablename='bookings' and policyname='bookings_access' and cmd='SELECT'),'Existing scoped read policy remains');
select ok((select relrowsecurity from pg_class where oid='public.bookings'::regclass),'Booking RLS remains enabled');
select ok((select bool_and(has_table_privilege('service_role','public.bookings',p)) from unnest(array['SELECT','INSERT','UPDATE','DELETE']) p),'Existing service mutation authority remains');
select ok(has_function_privilege('authenticated','public.command_create_manual_booking(text,jsonb,text)','EXECUTE'),'Coach command remains callable');
select ok((select bool_and(prosecdef) from pg_proc where oid=any(array['public.command_create_manual_booking(text,jsonb,text)'::regprocedure,'public.correct_lesson_datetime(jsonb,text)'::regprocedure,'public.confirm_booking(uuid,uuid,bigint,text)'::regprocedure,'public.cancel_booking_credit(uuid,integer,boolean,boolean)'::regprocedure])),'Supported commands retain their reviewed definer boundary');

insert into auth.users(id,email) values
 ('e2900000-0000-4000-8000-000000000001','e2e-boundary-coach@example.test'),
 ('e2900000-0000-4000-8000-000000000002','e2e-boundary-student@example.test'),
 ('e2900000-0000-4000-8000-000000000003','e2e-boundary-guardian@example.test'),
 ('e2900000-0000-4000-8000-000000000004','e2e-boundary-unrelated@example.test');
insert into public.studios(id,name,slug,timezone) values('e2900000-0000-4000-8000-000000000010','E2E command boundary','e2e-command-boundary','America/New_York');
insert into public.memberships(studio_id,user_id,role,display_name) values
 ('e2900000-0000-4000-8000-000000000010','e2900000-0000-4000-8000-000000000001','coach','Boundary coach');
insert into public.students(id,studio_id,user_id,full_name,email) values
 ('e2900000-0000-4000-8000-000000000011','e2900000-0000-4000-8000-000000000010','e2900000-0000-4000-8000-000000000002','E2E boundary student','e2e-boundary-student@example.test');
insert into public.student_relationships(student_id,user_id,relationship,can_view_schedule,can_view_finance) values
 ('e2900000-0000-4000-8000-000000000011','e2900000-0000-4000-8000-000000000003','guardian',true,true);
insert into public.booking_services(id,studio_id,slug,name,category,duration_minutes,price_minor) values
 ('e2900000-0000-4000-8000-000000000012','e2900000-0000-4000-8000-000000000010','e2e-boundary','E2E boundary coaching','private',60,6000);

-- Exercise actual service DML, not only catalog privileges. This unconfirmed
-- synthetic hold has no lesson, ledger or provider side effect and is removed
-- before the canonical actor/role checks below. The outer transaction rolls back.
set local role service_role;
select lives_ok($$insert into public.bookings(id,studio_id,reference,service_id,student_id,guest_name,guest_email,starts_at,ends_at,timezone,location,status,payment_policy,payment_status,total_minor,paid_minor,currency,policy_snapshot,manage_token_hash)
 values('e2900000-0000-4000-8000-000000000022','e2900000-0000-4000-8000-000000000010','E2E-SERVICE-BOUNDARY','e2900000-0000-4000-8000-000000000012','e2900000-0000-4000-8000-000000000011','E2E service boundary','e2e-boundary-service@example.test','2031-01-16T15:00:00Z','2031-01-16T16:00:00Z','America/New_York','in_person','held','pay_later','due',6000,0,'USD','{}','e2e-boundary-service-token')$$,'Service role can create a pending booking after caller write revocation');
select is((select guest_name from public.bookings where id='e2900000-0000-4000-8000-000000000022'),'E2E service boundary','Service role can read the inserted booking');
select lives_ok($$update public.bookings set guest_name='E2E service boundary updated' where id='e2900000-0000-4000-8000-000000000022'$$,'Service role can update a pending booking');
select is((select guest_name from public.bookings where id='e2900000-0000-4000-8000-000000000022'),'E2E service boundary updated','Service update affected the intended synthetic row');
select lives_ok($$delete from public.bookings where id='e2900000-0000-4000-8000-000000000022'$$,'Service role can remove its unconfirmed synthetic hold');
select is((select count(*) from public.bookings where id='e2900000-0000-4000-8000-000000000022'),0::bigint,'Synthetic service DML leaves no extra booking');
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub','e2900000-0000-4000-8000-000000000001',true);
select throws_ok($$insert into public.bookings default values$$,'42501','permission denied for table bookings','Direct coach insert is denied before fragmented records can appear');
select lives_ok($$select public.command_create_manual_booking('e2e-boundary-paid','{"student_id":"e2900000-0000-4000-8000-000000000011","service_id":"e2900000-0000-4000-8000-000000000012","starts_at":"2031-01-15T15:00:00Z","mark_paid":true,"reason":"Synthetic command boundary"}'::jsonb,'not_configured')$$,'Atomic coach paid booking still commits under the reduced caller grant');
select throws_ok($$update public.bookings set paid_minor=999999,payment_status='paid' where studio_id='e2900000-0000-4000-8000-000000000010'$$,'42501','permission denied for table bookings','Direct coach financial mutation is denied');
select throws_ok($$delete from public.bookings where studio_id='e2900000-0000-4000-8000-000000000010'$$,'42501','permission denied for table bookings','Direct coach deletion cannot bypass canonical history');
select is((select count(*) from public.bookings where studio_id='e2900000-0000-4000-8000-000000000010'),1::bigint,'Coach can read the committed booking');
select is((select paid_minor from public.bookings where studio_id='e2900000-0000-4000-8000-000000000010'),6000::bigint,'Rejected direct mutation leaves the committed paid amount');
select set_config('request.jwt.claim.sub','e2900000-0000-4000-8000-000000000002',true);
select is((select count(*) from public.bookings where studio_id='e2900000-0000-4000-8000-000000000010'),1::bigint,'Original student can still read the committed booking');
select is((select count(*) from public.lessons where studio_id='e2900000-0000-4000-8000-000000000010'),1::bigint,'Original student sees the linked lesson');
select is((select count(*) from public.payment_entries where student_id='e2900000-0000-4000-8000-000000000011'),1::bigint,'Original student sees the single committed ledger entry');
select set_config('request.jwt.claim.sub','e2900000-0000-4000-8000-000000000003',true);
select is((select count(*) from public.bookings where studio_id='e2900000-0000-4000-8000-000000000010'),1::bigint,'Authorized guardian retains booking access');
select is((select count(*) from public.payment_entries where student_id='e2900000-0000-4000-8000-000000000011'),1::bigint,'Authorized guardian retains financial access');
select set_config('request.jwt.claim.sub','e2900000-0000-4000-8000-000000000004',true);
select is((select count(*) from public.bookings where studio_id='e2900000-0000-4000-8000-000000000010'),0::bigint,'Unrelated user cannot read the booking');
select is((select count(*) from public.payment_entries where student_id='e2900000-0000-4000-8000-000000000011'),0::bigint,'Unrelated user cannot read its financial effect');
reset role;
select is((select count(*) from public.lesson_participants where student_id='e2900000-0000-4000-8000-000000000011'),1::bigint,'Participant remains attached to the original student');
select is((select count(*) from public.calendar_projections where lesson_id in(select id from public.lessons where studio_id='e2900000-0000-4000-8000-000000000010')),1::bigint,'Calendar projection intent remains independently queued');
select is((select count(*) from workspace_internal.manual_booking_receipts where studio_id='e2900000-0000-4000-8000-000000000010'),1::bigint,'Canonical replay receipt remains durable');
select * from finish();
rollback;
