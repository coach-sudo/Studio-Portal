-- Full migration chain; fixtures and operational intents roll back.
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
select ok(not has_function_privilege('authenticated','public.execute_lesson_occurrence_change(uuid,text,jsonb)','EXECUTE'),'Reviewed writes are service-only');
select ok(not has_table_privilege('service_role','lesson_ops.effects','SELECT'),'Raw notification cohorts are private');
select ok(not has_function_privilege('anon','public.claim_calendar_projections(integer)','EXECUTE'),'Calendar claims are private');
insert into auth.users(id,email) values('a1000000-0000-4000-8000-000000000001','e2e-occurrence@example.test');
insert into studios(id,name,slug) values('a2000000-0000-4000-8000-000000000001','Occurrence fixture','e2e-occurrence-safety');
insert into memberships(studio_id,user_id,role,display_name) values('a2000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000001','coach','Occurrence coach');
insert into students(id,studio_id,full_name) values('a3000000-0000-4000-8000-000000000001','a2000000-0000-4000-8000-000000000001','Occurrence student');
insert into booking_services(id,studio_id,slug,name,category,duration_minutes,price_minor) values('a4000000-0000-4000-8000-000000000001','a2000000-0000-4000-8000-000000000001','occurrence-test','Occurrence service','private',60,0);
insert into bookings(id,studio_id,student_id,service_id,reference,guest_name,guest_email,starts_at,ends_at,timezone,location,status,payment_policy,payment_status,total_minor,policy_snapshot,manage_token_hash)
values('a5000000-0000-4000-8000-000000000001','a2000000-0000-4000-8000-000000000001','a3000000-0000-4000-8000-000000000001','a4000000-0000-4000-8000-000000000001','OCCURRENCE-TEST','Student','e2e-occurrence-student@example.test',now()+interval '2 days',now()+interval '2 days 1 hour','America/New_York','in_person','confirmed','pay_later','due',0,'{"rescheduleLimit":5}','occurrence-manage-token');
insert into lessons(id,studio_id,student_id,topic,starts_at,ends_at,status,location_type,location_label,source_provider) values
 ('a6000000-0000-4000-8000-000000000001','a2000000-0000-4000-8000-000000000001','a3000000-0000-4000-8000-000000000001','First occurrence',now()+interval '2 days',now()+interval '2 days 1 hour','scheduled','in_person','Studio','studio'),
 ('a6000000-0000-4000-8000-000000000002','a2000000-0000-4000-8000-000000000001','a3000000-0000-4000-8000-000000000001','Next occurrence',now()+interval '9 days',now()+interval '9 days 1 hour','scheduled','in_person','Studio','studio');
insert into lesson_participants(lesson_id,student_id,booking_id,display_name,email) select id,student_id,'a5000000-0000-4000-8000-000000000001','Student','e2e-occurrence-student@example.test' from lessons where studio_id='a2000000-0000-4000-8000-000000000001';
insert into student_credit_accounts(student_id,auto_apply) values('a3000000-0000-4000-8000-000000000001',true);
select public.command_grant_student_credits('a3000000-0000-4000-8000-000000000001','occurrence-grant','{"quantity":1,"kind":"adjustment","reason":"Occurrence regression"}','a1000000-0000-4000-8000-000000000001');
create temporary table saved_next as select to_jsonb(l) value from lessons l where id='a6000000-0000-4000-8000-000000000002';
create temporary table reviewed as select jsonb_build_object('lessonId','a6000000-0000-4000-8000-000000000001','action','cancel','scope','occurrence','reason','Reviewed cancellation','useCredit',false,'wholeClass',false) value;
update reviewed set value=value||jsonb_build_object('reviewToken',public.preview_lesson_occurrence_change('a1000000-0000-4000-8000-000000000001',value)->>'reviewToken');
create temporary table changed as select public.execute_lesson_occurrence_change('a1000000-0000-4000-8000-000000000001','occurrence-reviewed-key',value) result from reviewed;
select is((select status from bookings where id='a5000000-0000-4000-8000-000000000001'),'confirmed','Shared booking remains confirmed');
select is((select status::text from lessons where id='a6000000-0000-4000-8000-000000000001'),'cancelled','Only the selected lesson is cancelled');
select is((select status::text from lessons where id='a6000000-0000-4000-8000-000000000002'),'scheduled','Next occurrence remains scheduled');
select is((select status from lesson_participants where lesson_id='a6000000-0000-4000-8000-000000000002'),'confirmed','Next participation remains active');
select is((select sum(quantity) from package_credit_entries where lesson_id='a6000000-0000-4000-8000-000000000001'),0::bigint,'Returned hold nets to zero');
select is((select sum(quantity) from package_credit_entries where lesson_id='a6000000-0000-4000-8000-000000000002'),(-1)::bigint,'PR 1.2 immediately recovers coverage for next lesson');
select is(public.execute_lesson_occurrence_change('a1000000-0000-4000-8000-000000000001','occurrence-reviewed-key',(select value from reviewed))->>'duplicate','true','Execution receipt replays after version changes');
select is((select count(*) from lesson_ops.effects where lesson_id='a6000000-0000-4000-8000-000000000001'),1::bigint,'Notification intent is committed once');
select is((select count(*) from audit_events where action='lesson.cancelled' and studio_id='a2000000-0000-4000-8000-000000000001'),1::bigint,'Audit commits once');
select throws_ok($$select public.preview_lesson_occurrence_change('a3000000-0000-4000-8000-000000000001',(select value from reviewed))$$,'P0001','FORBIDDEN','Forged actor cannot preview a record');
select throws_ok($$select public.command_change_lesson_state('a6000000-0000-4000-8000-000000000002',0,'cancel')$$,'P0001','VERSION_CONFLICT','Stale command is rejected');
-- A worker obtained a remote ID, but the lesson changed before completion.
create temporary table calendar_claim as select * from public.claim_calendar_projections(25) where lesson->>'id'='a6000000-0000-4000-8000-000000000001';
update lessons set version=version+1 where id='a6000000-0000-4000-8000-000000000001';
select is(public.finish_calendar_projection((select (projection->>'id')::uuid from calendar_claim),(select (projection->>'claim_token')::uuid from calendar_claim),'{"id":"occurrence-event","etag":"etag"}'),false,'Late calendar completion cannot acknowledge a newer lesson');
select is((select status from calendar_projections where lesson_id='a6000000-0000-4000-8000-000000000001'),'queued','Newer calendar work remains queued');
select is((select external_event_id from calendar_projections where lesson_id='a6000000-0000-4000-8000-000000000001'),'occurrence-event','Obtained remote identity is retained for cleanup');
select ok((select first_attempted_at is not null from calendar_projections where lesson_id='a6000000-0000-4000-8000-000000000001'),'Prior calendar attempts remain deletion-blocking evidence');
-- Vacate occupied selected slots in the correct direction without weakening the
-- immediate PostgreSQL exclusion constraint for unrelated appointments.
insert into lessons(id,studio_id,student_id,topic,starts_at,ends_at,status,location_type,location_label,source_provider) values
 ('a6000000-0000-4000-8000-000000000003','a2000000-0000-4000-8000-000000000001','a3000000-0000-4000-8000-000000000001','Shift first',now()+interval '20 days',now()+interval '20 days 1 hour','scheduled','in_person','Studio','studio'),
 ('a6000000-0000-4000-8000-000000000004','a2000000-0000-4000-8000-000000000001','a3000000-0000-4000-8000-000000000001','Shift next',now()+interval '27 days',now()+interval '27 days 1 hour','scheduled','in_person','Studio','studio');
create temporary table shift_review as select jsonb_build_object('lessonId','a6000000-0000-4000-8000-000000000003','action','reschedule','scope','selected',
  'selectedIds',jsonb_build_array('a6000000-0000-4000-8000-000000000003','a6000000-0000-4000-8000-000000000004'),
  'startsAt',now()+interval '27 days','endsAt',now()+interval '27 days 1 hour','reason','Shift reviewed occurrences','wholeClass',false,'useCredit',false) value;
update shift_review set value=value||jsonb_build_object('reviewToken',public.preview_lesson_occurrence_change('a1000000-0000-4000-8000-000000000001',value)->>'reviewToken');
select lives_ok($$select public.execute_lesson_occurrence_change('a1000000-0000-4000-8000-000000000001','shift-selected-key',(select value from shift_review))$$,'Reviewed forward shift vacates the later selected slot first');
select is((select starts_at from lessons where id='a6000000-0000-4000-8000-000000000003'),now()+interval '27 days','First occurrence takes the vacated slot');
select is((select starts_at from lessons where id='a6000000-0000-4000-8000-000000000004'),now()+interval '34 days','Later occurrence moves once');
select * from finish();
rollback;
