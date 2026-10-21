-- Cross-signal review preserves existing financial and operational identities.
-- Local PostgreSQL only; all fixtures and reservations roll back.
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
insert into auth.users(id,email) values('e6900000-0000-4000-8000-000000000011','e2e-calendar-replay@example.test');
insert into public.studios(id,name,slug) values('e6900000-0000-4000-8000-000000000012','Calendar replay','e2e-calendar-replay');
insert into public.memberships(studio_id,user_id,role,display_name) values('e6900000-0000-4000-8000-000000000012','e6900000-0000-4000-8000-000000000011','coach','Fixture');
insert into public.students(id,studio_id,full_name) values
 ('e6900000-0000-4000-8000-000000000013','e6900000-0000-4000-8000-000000000012','Gmail learner'),
 ('e6900000-0000-4000-8000-000000000014','e6900000-0000-4000-8000-000000000012','Studio learner');
insert into public.student_credit_accounts(student_id,auto_apply) select id,true from public.students where studio_id='e6900000-0000-4000-8000-000000000012';
insert into public.lessons(id,studio_id,student_id,topic,starts_at,ends_at,status,location_type,location_label,source_provider,source_external_id) values
 ('e6900000-0000-4000-8000-000000000015','e6900000-0000-4000-8000-000000000012','e6900000-0000-4000-8000-000000000013','Gmail original',now()+interval '1 day',now()+interval '1 day 1 hour','scheduled','in_person','Studio','gmail','original-email'),
 ('e6900000-0000-4000-8000-000000000016','e6900000-0000-4000-8000-000000000012','e6900000-0000-4000-8000-000000000014','Studio original',now()+interval '2 days',now()+interval '2 days 1 hour','scheduled','in_person','Studio','studio',null);
insert into public.lesson_participants(lesson_id,student_id,display_name,email,status) select id,student_id,topic,'e2e-replay@example.test','confirmed' from public.lessons where studio_id='e6900000-0000-4000-8000-000000000012';
insert into public.calendar_projections(lesson_id,projected_version,status) select id,version,'queued' from public.lessons where studio_id='e6900000-0000-4000-8000-000000000012';
select public.command_grant_student_credits(id,'e2e-replay-grant-'||id,'{"quantity":1,"kind":"adjustment","reason":"Isolated replay test"}','e6900000-0000-4000-8000-000000000011') from public.students where studio_id='e6900000-0000-4000-8000-000000000012';
select set_config('request.jwt.claim.sub','e6900000-0000-4000-8000-000000000011',true);
-- Imported payment policy requires deliberate manual credit use; do not weaken it.
select public.command_apply_lesson_credit(id,null,'Synthetic reviewed credit use','e2e-replay-manual-'||id) from public.lessons where studio_id='e6900000-0000-4000-8000-000000000012' and source_provider='gmail';
insert into public.integration_imports(studio_id,provider,external_id,detected_source,student_id,lesson_id,status,payload)
 select studio_id,'google_calendar','calendar-signal-'||id,'google_calendar',student_id,id,'needs_review',jsonb_build_object('summary',topic,'start',jsonb_build_object('dateTime',starts_at),'end',jsonb_build_object('dateTime',ends_at)) from public.lessons where studio_id='e6900000-0000-4000-8000-000000000012';
select set_config('request.jwt.claim.sub','e6900000-0000-4000-8000-000000000011',true);
set local role authenticated;
select public.command_review_provider_import(id,jsonb_build_object('action','existing','studentId',student_id),'e2e-replay-review-'||id) from public.integration_imports where studio_id='e6900000-0000-4000-8000-000000000012';
select public.command_review_provider_import(id,jsonb_build_object('action','existing','studentId',student_id),'e2e-replay-review-'||id) from public.integration_imports where studio_id='e6900000-0000-4000-8000-000000000012';
reset role;
select is((select count(*) from public.lessons where studio_id='e6900000-0000-4000-8000-000000000012'),2::bigint,'Gmail and studio reviews/retries preserve exactly two original lessons');
select is((select count(*) from public.lesson_participants where lesson_id in ('e6900000-0000-4000-8000-000000000015','e6900000-0000-4000-8000-000000000016')),2::bigint,'No additional participants');
select is((select count(*) from public.calendar_projections where lesson_id in ('e6900000-0000-4000-8000-000000000015','e6900000-0000-4000-8000-000000000016')),2::bigint,'Original projections preserved');
select is((select count(*) from public.package_credit_entries where lesson_id in ('e6900000-0000-4000-8000-000000000015','e6900000-0000-4000-8000-000000000016') and quantity<0),2::bigint,'Exactly one real ledger reservation per original lesson');
select is((select sum(quantity) from public.package_credit_entries where lesson_id in ('e6900000-0000-4000-8000-000000000015','e6900000-0000-4000-8000-000000000016')),-2::bigint,'Review replay does not double debit');
select is((select count(*) from public.integration_imports i join public.lessons l on l.id=i.lesson_id where i.studio_id='e6900000-0000-4000-8000-000000000012' and i.status='imported' and l.source_provider in ('gmail','studio')),2::bigint,'Approved links and original attribution remain authoritative');
select * from finish();
rollback;


