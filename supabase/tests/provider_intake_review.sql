begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
insert into auth.users(id,email) values('e6600000-0000-4000-8000-000000000001','wave6-coach@example.test'),('e6600000-0000-4000-8000-000000000002','wave6-unrelated@example.test');
insert into public.studios(id,name,slug) values('e6600000-0000-4000-8000-000000000003','Wave six fixture','e2e-wave-six');
insert into public.memberships(studio_id,user_id,role,display_name) values('e6600000-0000-4000-8000-000000000003','e6600000-0000-4000-8000-000000000001','coach','Fixture');
insert into public.integration_imports(id,studio_id,provider,external_id,detected_source,status,payload) values
 ('e6600000-0000-4000-8000-000000000004','e6600000-0000-4000-8000-000000000003','gmail','wave-six-email','superprof','needs_review','{"candidate":{"startsAt":"2031-11-02T18:00:00Z","endsAt":"2031-11-02T19:00:00Z","topic":"Synthetic Superprof","joinUrl":"https://www.lessonface.com/classroom/synthetic"},"changeType":"confirmation"}'),
 ('e6600000-0000-4000-8000-000000000005','e6600000-0000-4000-8000-000000000003','gmail','wave-six-invalid','lessonface','needs_review','{}'),
 ('e6600000-0000-4000-8000-000000000006','e6600000-0000-4000-8000-000000000003','gmail','wave-six-cancel','superprof','needs_review','{"changeType":"cancellation"}');
set local role authenticated;
select set_config('request.jwt.claim.sub','e6600000-0000-4000-8000-000000000001',true);
select lives_ok($$select public.command_review_provider_import('e6600000-0000-4000-8000-000000000004','{"action":"create","fullName":"Name only Lessonface learner"}','e2e-wave6-review')$$,'Creates a name-only student and email-only lesson atomically');
select lives_ok($$select public.command_review_provider_import('e6600000-0000-4000-8000-000000000004','{"action":"create","fullName":"Name only Lessonface learner"}','e2e-wave6-review')$$,'Lost response can replay its receipt');
select is((select count(*) from public.students where studio_id='e6600000-0000-4000-8000-000000000003'),1::bigint,'Replay creates no duplicate student');
select is((select count(*) from public.lessons where studio_id='e6600000-0000-4000-8000-000000000003'),1::bigint,'Replay creates no duplicate lesson');
select is((select source_provider from public.lessons where studio_id='e6600000-0000-4000-8000-000000000003'),'superprof','Superprof attribution retained');
select is((select email from public.students where studio_id='e6600000-0000-4000-8000-000000000003'),null::text,'No email fabricated');
select is((select portal_enabled from public.students where studio_id='e6600000-0000-4000-8000-000000000003'),false,'Review does not grant portal access');
select is((select meeting_provider from public.lessons where studio_id='e6600000-0000-4000-8000-000000000003'),null::text,'Provider classroom does not provision Meet');
reset role;
select is((select count(*) from public.calendar_projections c join public.lessons l on l.id=c.lesson_id where l.studio_id='e6600000-0000-4000-8000-000000000003' and c.status='queued'),1::bigint,'Email-only lesson queues existing calendar workflow');
select is((select count(*) from public.outbox_messages where studio_id='e6600000-0000-4000-8000-000000000003'),0::bigint,'Confirmation sends no message');
set local role authenticated;
select throws_ok($$select public.command_review_provider_import('e6600000-0000-4000-8000-000000000004','{"action":"ignore"}','e2e-wave6-review')$$,'P0001','IDEMPOTENCY_CONFLICT','Replay key is bound to payload');
select throws_ok($$select public.command_review_provider_import('e6600000-0000-4000-8000-000000000005','{"action":"create","fullName":"Must roll back"}','e2e-wave6-fail')$$,'P0001','REVIEW_REQUIRED: Open the lesson calendar to confirm its time.','Invalid time fails transaction');
select is((select count(*) from public.students where full_name='Must roll back'),0::bigint,'Failure rolls back student creation');
select throws_ok($$select public.command_review_provider_import('e6600000-0000-4000-8000-000000000006','{"action":"create","fullName":"Wrong new student"}','e2e-wave6-cancel')$$,'P0001','REVIEW_REQUIRED: Link this change to an existing lesson.','Cancellation cannot create a new lesson');
select throws_ok($$select public.command_review_provider_import('e6600000-0000-4000-8000-000000000004','{"action":"create","fullName":"Duplicate"}','e2e-wave6-new-key')$$,'P0001','VERSION_CONFLICT: This signal has already been reviewed. Refresh Today.','New key cannot reprocess completed review');
select set_config('request.jwt.claim.sub','e6600000-0000-4000-8000-000000000002',true);
select throws_ok($$select public.command_review_provider_import('e6600000-0000-4000-8000-000000000005','{"action":"ignore"}','e2e-wave6-forged')$$,'42501','FORBIDDEN','Unrelated identity cannot review imports');
select set_config('request.jwt.claim.sub','e6600000-0000-4000-8000-000000000001',true);
select lives_ok($$select public.command_review_provider_import('e6600000-0000-4000-8000-000000000005','{"action":"ignore"}','e2e-wave6-ignore')$$,'Ignore preserves original records');

reset role;
insert into public.integration_imports(id,studio_id,provider,external_id,detected_source,status,payload) values
 ('e6600000-0000-4000-8000-000000000007','e6600000-0000-4000-8000-000000000003','google_calendar','wave-six-calendar','superprof','needs_review','{"summary":"Synthetic Superprof","start":{"dateTime":"2031-11-02T18:00:00Z"},"end":{"dateTime":"2031-11-02T19:00:00Z"}}'),
 ('e6600000-0000-4000-8000-000000000008','e6600000-0000-4000-8000-000000000003','gmail','wave-six-reschedule','superprof','needs_review','{"changeType":"reschedule","candidate":{"startsAt":"2031-11-02T20:00:00Z","endsAt":"2031-11-02T21:00:00Z"}}');
set local role authenticated;
select lives_ok(format($$select public.command_review_provider_import('e6600000-0000-4000-8000-000000000007',%L::jsonb,'e2e-wave6-calendar')$$,jsonb_build_object('action','existing','studentId',(select student_id from public.integration_imports where id='e6600000-0000-4000-8000-000000000004'))),'Calendar and Gmail signals link to the same approved occurrence');
select is((select count(*) from public.lessons where studio_id='e6600000-0000-4000-8000-000000000003'),1::bigint,'Cross-signal review creates no duplicate lesson');
select throws_ok(format($$select public.command_review_provider_import('e6600000-0000-4000-8000-000000000008',%L::jsonb,'e2e-wave6-ambiguous')$$,jsonb_build_object('action','existing','studentId',(select student_id from public.integration_imports where id='e6600000-0000-4000-8000-000000000004'))),'P0001','REVIEW_REQUIRED: Choose the exact existing lesson.','Reschedule never selects nearest date');
select throws_ok(format($$select public.command_review_provider_import('e6600000-0000-4000-8000-000000000008',%L::jsonb,'e2e-wave6-stale-lesson')$$,jsonb_build_object('action','existing','studentId',(select student_id from public.integration_imports where id='e6600000-0000-4000-8000-000000000004'),'lessonId',(select lesson_id from public.integration_imports where id='e6600000-0000-4000-8000-000000000004'),'lessonVersion',0)),'P0001','VERSION_CONFLICT: Refresh the selected lesson.','Stale lesson selection is rejected');
select lives_ok(format($$select public.command_review_provider_import('e6600000-0000-4000-8000-000000000008',%L::jsonb,'e2e-wave6-move')$$,jsonb_build_object('action','existing','studentId',(select student_id from public.integration_imports where id='e6600000-0000-4000-8000-000000000004'),'lessonId',(select id from public.lessons where studio_id='e6600000-0000-4000-8000-000000000003'),'lessonVersion',(select version from public.lessons where studio_id='e6600000-0000-4000-8000-000000000003'))),'Reviewed reschedule uses existing occurrence command');
select is((select starts_at from public.lessons where studio_id='e6600000-0000-4000-8000-000000000003'),'2031-11-02T20:00:00Z'::timestamptz,'Exactly selected lesson moved');
select lives_ok(format($$select public.command_review_provider_import('e6600000-0000-4000-8000-000000000006',%L::jsonb,'e2e-wave6-cancel-exact')$$,jsonb_build_object('action','existing','studentId',(select student_id from public.integration_imports where id='e6600000-0000-4000-8000-000000000004'),'lessonId',(select id from public.lessons where studio_id='e6600000-0000-4000-8000-000000000003'),'lessonVersion',(select version from public.lessons where studio_id='e6600000-0000-4000-8000-000000000003'))),'Reviewed cancellation uses existing financial and class safeguards');
select is((select status::text from public.lessons where studio_id='e6600000-0000-4000-8000-000000000003'),'cancelled','Exact selected occurrence cancelled');
select is((select count(*) from public.lessons where studio_id='e6600000-0000-4000-8000-000000000003'),1::bigint,'Cancellation never creates replacement lesson');

reset role;
insert into public.integration_imports(id,studio_id,provider,external_id,detected_source,status,payload) values
 ('e6600000-0000-4000-8000-000000000009','e6600000-0000-4000-8000-000000000003','gmail','wave-six-recovery','lessonface','needs_review','{"candidate":{"startsAt":"2031-11-03T18:00:00Z","endsAt":"2031-11-03T19:00:00Z"}}');
create function pg_temp.reject_review_audit() returns trigger language plpgsql as $$begin if new.correlation_id='e2e-wave6-late-failure' then raise exception 'SYNTHETIC_LATE_FAILURE'; end if; return new; end$$;
create trigger e2e_wave6_late_failure before insert on public.audit_events for each row execute function pg_temp.reject_review_audit();
set local role authenticated;
select throws_ok($$select public.command_review_provider_import('e6600000-0000-4000-8000-000000000009','{"action":"create","fullName":"Late failure recovery"}','e2e-wave6-late-failure')$$,'P0001','SYNTHETIC_LATE_FAILURE','Late audit failure rolls back the entire existing command');
select is((select count(*) from public.students where full_name='Late failure recovery'),0::bigint,'No partial student survives failed audit');
select is((select status from public.integration_imports where id='e6600000-0000-4000-8000-000000000009'),'needs_review','Import remains retryable after late failure');
reset role;
drop trigger e2e_wave6_late_failure on public.audit_events;
set local role authenticated;
select lives_ok($$select public.command_review_provider_import('e6600000-0000-4000-8000-000000000009','{"action":"create","fullName":"Late failure recovery"}','e2e-wave6-late-failure')$$,'Same request key succeeds after actual rollback');
select is((select count(*) from public.students where full_name='Late failure recovery'),1::bigint,'Recovery creates exactly one record');
reset role;
insert into public.integration_imports(id,studio_id,provider,external_id,detected_source,status,payload) values
 ('e6600000-0000-4000-8000-000000000010','e6600000-0000-4000-8000-000000000003','gmail','attendance-past','lessonface','needs_review','{"candidate":{"startsAt":"2020-11-03T18:00:00Z","endsAt":"2020-11-03T19:00:00Z"}}');
set local role authenticated;
select lives_ok($$select public.command_review_provider_import('e6600000-0000-4000-8000-000000000010','{"action":"create","fullName":"Historical attendance unknown","status":"completed"}','e2e-attendance-past')$$,'Past source verification does not accept attendance from a source payload');
select lives_ok($$select public.command_review_provider_import('e6600000-0000-4000-8000-000000000010','{"action":"create","fullName":"Historical attendance unknown","status":"completed"}','e2e-attendance-past')$$,'Past source verification replay remains stable');
select is((select status::text from public.lessons where student_id=(select student_id from public.integration_imports where id='e6600000-0000-4000-8000-000000000010')),'scheduled','Past imported lesson remains scheduled until coach confirms actual attendance');
select is((select p.status from public.lesson_participants p join public.integration_imports i on i.lesson_id=p.lesson_id where i.id='e6600000-0000-4000-8000-000000000010'),'confirmed','Source verification does not mark participant attended');
select is((select count(*) from public.lessons where student_id=(select student_id from public.integration_imports where id='e6600000-0000-4000-8000-000000000010')),1::bigint,'Past replay creates one lesson');
reset role;
select is((select count(*) from public.calendar_projections c join public.integration_imports i on i.lesson_id=c.lesson_id where i.id='e6600000-0000-4000-8000-000000000010'),0::bigint,'Past verification projects no Calendar event');
select is((select count(*) from public.payment_entries p join public.integration_imports i on i.student_id=p.student_id where i.id='e6600000-0000-4000-8000-000000000010'),0::bigint,'Past source verification creates no payment');
select is((select count(*) from public.outbox_messages where studio_id='e6600000-0000-4000-8000-000000000003'),0::bigint,'Source confirmation sends no notification');
update public.lessons set status='completed' where student_id=(select student_id from public.integration_imports where id='e6600000-0000-4000-8000-000000000010');
insert into public.integration_imports(id,studio_id,provider,external_id,detected_source,status,payload,lesson_id)
 select 'e6600000-0000-4000-8000-000000000011',studio_id,'google_calendar','attendance-existing','lessonface','needs_review',payload,lesson_id from public.integration_imports where id='e6600000-0000-4000-8000-000000000010';
set local role authenticated;
select lives_ok(format($$select public.command_review_provider_import('e6600000-0000-4000-8000-000000000011',%L::jsonb,'e2e-attendance-existing')$$,jsonb_build_object('action','existing','studentId',(select student_id from public.integration_imports where id='e6600000-0000-4000-8000-000000000010'))),'Linking a historical completed lesson preserves its existing outcome');
select is((select status::text from public.lessons where student_id=(select student_id from public.integration_imports where id='e6600000-0000-4000-8000-000000000010')),'completed','Existing completed history is unchanged');
select * from finish();
rollback;
