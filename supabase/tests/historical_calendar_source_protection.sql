begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
insert into auth.users(id,email) values
 ('e8300000-0000-4000-8000-000000000002','e2e-source-coach@example.test'),
 ('e8300000-0000-4000-8000-000000000003','e2e-source-student@example.test');
insert into public.studios(id,name,slug) values('e8300000-0000-4000-8000-000000000001','E2E historical source','e2e-historical-source');
insert into public.memberships(studio_id,user_id,role,display_name) values('e8300000-0000-4000-8000-000000000001','e8300000-0000-4000-8000-000000000002','coach','E2E coach');
insert into public.students(id,studio_id,user_id,full_name,status) values('e8300000-0000-4000-8000-000000000004','e8300000-0000-4000-8000-000000000001','e8300000-0000-4000-8000-000000000003','E2E learner','active');
insert into public.lessons(id,studio_id,student_id,topic,starts_at,ends_at,status,location_type,location_label,source_provider,source_external_id)
values('e8300000-0000-4000-8000-000000000005','e8300000-0000-4000-8000-000000000001','e8300000-0000-4000-8000-000000000004','E2E completed history','2020-01-01T15:00Z','2020-01-01T16:00Z','completed','in_person','E2E','google_calendar','legacy-event'),
 ('e8300000-0000-4000-8000-000000000006','e8300000-0000-4000-8000-000000000001','e8300000-0000-4000-8000-000000000004','E2E future','2099-01-01T15:00Z','2099-01-01T16:00Z','scheduled','in_person','E2E','studio',null);
insert into public.lesson_participants(lesson_id,student_id,display_name,email,status) values('e8300000-0000-4000-8000-000000000005','e8300000-0000-4000-8000-000000000004','E2E learner','e2e-source-student@example.test','attended');
insert into public.payment_entries(student_id,kind,amount_minor,currency,reason,external_reference) values('e8300000-0000-4000-8000-000000000004','payment',5000,'USD','E2E retained historical payment','e2e-source-history-payment');
update public.lessons set price_minor=5000,paid_minor=5000,payment_status='paid' where id='e8300000-0000-4000-8000-000000000005';
create temporary table source_history_before as select to_jsonb(l) lesson,(select jsonb_agg(to_jsonb(p) order by p.id) from public.payment_entries p where p.student_id=l.student_id) payments from public.lessons l where l.id='e8300000-0000-4000-8000-000000000005';
insert into public.integration_imports(id,studio_id,provider,external_id,detected_source,student_id,lesson_id,status,payload,updated_at) values
 ('e8300000-0000-4000-8000-000000000007','e8300000-0000-4000-8000-000000000001','google_calendar','legacy-event','google_calendar','e8300000-0000-4000-8000-000000000004','e8300000-0000-4000-8000-000000000005','ignored','{}','2020-01-01'),
 ('e8300000-0000-4000-8000-000000000031','e8300000-0000-4000-8000-000000000001','google_calendar','imported-linked','google_calendar','e8300000-0000-4000-8000-000000000004','e8300000-0000-4000-8000-000000000005','imported','{"summary":"E2E retained source"}','2020-01-01');
create function pg_temp.source_event(p_id text default 'legacy-event',p_status text default 'active') returns jsonb language sql immutable as $$
 select jsonb_build_object('id',p_id,'etag','version-1','status',p_status,'startsAt','2020-01-01T15:00:00Z','endsAt','2020-01-01T16:00:00Z','startDate',null,'endDate',null)
$$;
create function pg_temp.source_hash(p_calendar text,p_event jsonb) returns text language sql immutable as $$
 select encode(extensions.digest(jsonb_build_object('calendarId',p_calendar,'event',p_event)::text,'sha256'),'hex')
$$;
insert into discovery_internal.source_decisions(id,studio_id,calendar_id,event_id,disposition,lesson_id,lesson_ends_at,reviewed_hash,actor_id,reason)
values('e8300000-0000-4000-8000-000000000008','e8300000-0000-4000-8000-000000000001','canonical-a','legacy-event','linked','e8300000-0000-4000-8000-000000000005','2020-01-01T16:00Z',pg_temp.source_hash('canonical-a',pg_temp.source_event()),'e8300000-0000-4000-8000-000000000002','Explicit historical link'),
 ('e8300000-0000-4000-8000-000000000009','e8300000-0000-4000-8000-000000000001','canonical-b','legacy-event','not_lesson',null,null,pg_temp.source_hash('canonical-b',pg_temp.source_event()),'e8300000-0000-4000-8000-000000000002','Different calendar decision'),
 ('e8300000-0000-4000-8000-000000000032','e8300000-0000-4000-8000-000000000001','canonical-a','imported-linked','linked','e8300000-0000-4000-8000-000000000005','2020-01-01T16:00Z',pg_temp.source_hash('canonical-a',pg_temp.source_event('imported-linked')),'e8300000-0000-4000-8000-000000000002','Retained imported source');
select ok(not has_table_privilege('authenticated','discovery_internal.source_decisions','SELECT'),'No authenticated direct decision read');
select ok(not has_table_privilege('service_role','discovery_internal.source_decisions','INSERT'),'Worker cannot create coach decisions');
select ok(not has_table_privilege('service_role','discovery_internal.source_write_authorizations','INSERT'),'Worker cannot manufacture command authorization');
select ok(not has_function_privilege('authenticated','public.observe_protected_calendar_sources(uuid,text,jsonb)','EXECUTE'),'Coach/student/guardian JWT cannot call worker observation RPC');
select ok(not has_function_privilege('anon','public.observe_protected_calendar_sources(uuid,text,jsonb)','EXECUTE'),'Anonymous cannot call observation RPC');
select ok(has_function_privilege('service_role','public.observe_protected_calendar_sources(uuid,text,jsonb)','EXECUTE'),'Service-only worker may observe minimal source state');
-- The disposable migration replay lacks production's legacy table grants.
-- Simulate only the columns these old-worker statements need, within rollback.
grant select(id,version,studio_id,student_id,starts_at,ends_at,status,source_provider,source_external_id,offering_id) on public.lessons to service_role;
grant update(status,version,starts_at) on public.lessons to service_role;
grant insert(studio_id,student_id,topic,starts_at,ends_at,status,location_type,location_label,source_provider,source_external_id) on public.lessons to service_role;
select throws_ok($$insert into discovery_internal.source_decisions(studio_id,calendar_id,event_id,disposition,lesson_id,lesson_ends_at,reviewed_hash,actor_id,reason) values('e8300000-0000-4000-8000-000000000001','canonical-a','future','linked','e8300000-0000-4000-8000-000000000006','2099-01-01T16:00Z',repeat('a',64),'e8300000-0000-4000-8000-000000000002','Future lesson')$$,'P0001','REVIEW_REQUIRED: Select the exact historical lesson.','Historical protection does not silently redefine future/student cancellation authority');
select throws_ok($$update discovery_internal.source_decisions set calendar_id='different' where id='e8300000-0000-4000-8000-000000000008'$$,'P0001','REVIEW_REQUIRED: Source identity is immutable.','Source identity cannot drift');
set local role service_role;
select is(jsonb_array_length(public.observe_protected_calendar_sources('e8300000-0000-4000-8000-000000000001','canonical-a',jsonb_build_array(pg_temp.source_event()))),1,'Exact calendar decision wins over a different calendar with the same event ID');
select is(public.observe_protected_calendar_sources('e8300000-0000-4000-8000-000000000001','canonical-a',jsonb_build_array(pg_temp.source_event()))#>>'{0,state}','protected','Exact source is protected');
select is(public.observe_protected_calendar_sources('e8300000-0000-4000-8000-000000000001','canonical-a',jsonb_build_array(pg_temp.source_event()))#>>'{0,changed}','false','Identical reviewed version does not invent a new change');
select is(public.observe_protected_calendar_sources('e8300000-0000-4000-8000-000000000001','canonical-a',jsonb_build_array(pg_temp.source_event('new-event')))#>>'{0,state}','unprotected','Untouched sources retain existing intake behavior');
select is(public.observe_protected_calendar_sources('e8300000-0000-4000-8000-000000000001','canonical-c',jsonb_build_array(pg_temp.source_event()))#>>'{0,state}','ambiguous','Unscoped collision on another calendar requires review');
select is(public.observe_protected_calendar_sources('e8300000-0000-4000-8000-000000000001','canonical-a',jsonb_build_array(pg_temp.source_event('legacy-event','cancelled')))#>>'{0,changed}','true','Cancellation becomes an observation, not attendance or canonical cancellation');
select throws_ok($$select public.observe_protected_calendar_sources('e8300000-0000-4000-8000-000000000001','primary','[]')$$,'P0001','VALIDATION_FAILED','Unresolved account-relative alias cannot identify protected history');
select throws_ok($$select public.observe_protected_calendar_sources('e8300000-0000-4000-8000-000000000001','canonical-a','[{"id":"legacy-event","status":"active","description":"excluded private payload"}]')$$,'P0001','VALIDATION_FAILED','Raw provider fields are rejected');
select throws_ok($$select public.observe_protected_calendar_sources('e8300000-0000-4000-8000-000000000001','canonical-a','[{"id":"legacy-event","status":"active","etag":{"private":"excluded"}}]')$$,'P0001','VALIDATION_FAILED','Nested provider payload cannot hide in a version field');
select throws_ok($$update public.lessons set status='cancelled',version=version+1 where id='e8300000-0000-4000-8000-000000000005'$$,'P0001','REVIEW_REQUIRED: Review the protected historical lesson before changing its schedule or outcome.','An old service worker cannot cancel protected history');
select throws_ok($$update public.lessons set starts_at='2020-01-01T15:15Z',version=version+1 where id='e8300000-0000-4000-8000-000000000005'$$,'P0001','REVIEW_REQUIRED: Review the protected historical lesson before changing its schedule or outcome.','An old service worker cannot reschedule protected history');
select throws_ok($$insert into public.lessons(studio_id,student_id,topic,starts_at,ends_at,status,location_type,location_label,source_provider,source_external_id) values('e8300000-0000-4000-8000-000000000001','e8300000-0000-4000-8000-000000000004','Duplicate raw source','2020-01-02T15:00Z','2020-01-02T16:00Z','scheduled','in_person','E2E','lessonface','legacy-event')$$,'P0001','REVIEW_REQUIRED: This Calendar identity has a protected historical decision.','Old detected-provider raw insert cannot duplicate a coach-linked source');
select throws_ok($$update public.integration_imports set status='needs_review' where id='e8300000-0000-4000-8000-000000000007'$$,'P0001','REVIEW_REQUIRED: Use the historical reconciliation command for this Calendar decision.','An old worker cannot reopen a protected ignored signal');
select throws_ok($$delete from public.integration_imports where id='e8300000-0000-4000-8000-000000000007'$$,'P0001','REVIEW_REQUIRED: Use the historical reconciliation command for this Calendar decision.','Old ignored-payload retention cannot delete a protected source');
select throws_ok($$update public.integration_imports set provider='gmail' where id='e8300000-0000-4000-8000-000000000007'$$,'P0001','REVIEW_REQUIRED: A protected Calendar identity cannot be rewritten.','Identity rewrite cannot evade a historical decision');
reset role;
select is((select count(*) from discovery_internal.source_observations where decision_id='e8300000-0000-4000-8000-000000000008' and calendar_id='canonical-a'),2::bigint,'Repeated same observation is durable once; changed cancellation is a separate observation');
select is((select status::text from public.lessons where id='e8300000-0000-4000-8000-000000000005'),'completed','Protected completed outcome survives source processing');
select is((select status from public.lesson_participants where lesson_id='e8300000-0000-4000-8000-000000000005'),'attended','Recorded attendance is preserved');
select is((select status from public.integration_imports where id='e8300000-0000-4000-8000-000000000007'),'ignored','Ignored legacy state is not silently resurrected');
select is((select count(*) from public.payment_entries where student_id='e8300000-0000-4000-8000-000000000004'),1::bigint,'Observations create no second payment');
select is((select to_jsonb(l) from public.lessons l where id='e8300000-0000-4000-8000-000000000005'),(select lesson from source_history_before),'Full historical lesson, creation time and paid fields remain byte-equivalent');
select is((select jsonb_agg(to_jsonb(p) order by p.id) from public.payment_entries p where student_id='e8300000-0000-4000-8000-000000000004'),(select payments from source_history_before),'Existing append-only payment history remains byte-equivalent');
select is((select count(*) from public.outbox_messages where studio_id='e8300000-0000-4000-8000-000000000001'),0::bigint,'Observations queue no message');
select is((select count(*) from public.calendar_projections where lesson_id='e8300000-0000-4000-8000-000000000005'),0::bigint,'Observations queue no Calendar write');
select set_config('request.jwt.claim.sub','e8300000-0000-4000-8000-000000000002',true);
select lives_ok($$update public.lessons set status='scheduled',version=version+1 where id='e8300000-0000-4000-8000-000000000005'$$,'Explicit coach context retains canonical outcome authority');
select set_config('request.jwt.claim.sub','',true);
select set_config('app.lesson_actor','e8300000-0000-4000-8000-000000000003',true);
select throws_ok($$update public.lessons set status='cancelled' where id='e8300000-0000-4000-8000-000000000005'$$,'P0001','REVIEW_REQUIRED: Review the protected historical lesson before changing its schedule or outcome.','Non-coach occurrence context cannot bypass protection');
select set_config('app.lesson_actor','e8300000-0000-4000-8000-000000000002',true);
select lives_ok($$update public.lessons set status='completed',version=version+1 where id='e8300000-0000-4000-8000-000000000005'$$,'Existing validated service-only coach occurrence context remains compatible');
select set_config('app.lesson_actor','',true);
select lives_ok($$update public.lessons set payment_status='untracked' where id='e8300000-0000-4000-8000-000000000005'$$,'Financial-only update is not mistaken for a source schedule/outcome change');
select set_config('test.source.ignored_before',public.studio_storage_health()#>>'{cleanupCandidates,ignoredImports}',true);
insert into public.integration_imports(id,studio_id,provider,external_id,detected_source,status,updated_at) values('e8300000-0000-4000-8000-000000000030','e8300000-0000-4000-8000-000000000001','google_calendar','unprotected-old','google_calendar','ignored','2020-01-01');
select is((public.studio_storage_health()#>>'{cleanupCandidates,ignoredImports}')::integer,current_setting('test.source.ignored_before')::integer+1,'Cleanup diagnostics count unprotected transient imports only');
select lives_ok($$select public.cleanup_transient_studio_data()$$,'Protected history does not poison maintenance cleanup');
select is((select count(*) from public.integration_imports where id='e8300000-0000-4000-8000-000000000007'),1::bigint,'Cleanup retains explicitly protected ignored history');
select is((select count(*) from public.integration_imports where id='e8300000-0000-4000-8000-000000000030'),0::bigint,'Existing cleanup policy still prunes unprotected transient history');
select is((select payload->>'summary' from public.integration_imports where id='e8300000-0000-4000-8000-000000000031'),'E2E retained source','Cleanup preserves protected reviewed payload evidence');
-- A historical source link must not silently revoke a later, legitimately
-- corrected future booking's student cancellation policy.
insert into public.booking_services(id,studio_id,slug,name,category,duration_minutes) values('e8300000-0000-4000-8000-000000000040','e8300000-0000-4000-8000-000000000001','e2e-source-cancel','E2E source cancel','private',60);
insert into public.bookings(id,studio_id,service_id,student_id,reference,guest_name,guest_email,starts_at,ends_at,timezone,location,status,payment_policy,payment_status,total_minor,currency,policy_snapshot,manage_token_hash) values
 ('e8300000-0000-4000-8000-000000000041','e8300000-0000-4000-8000-000000000001','e8300000-0000-4000-8000-000000000040','e8300000-0000-4000-8000-000000000004','E2E-SOURCE-CANCEL','E2E learner','e2e-source-student@example.test','2020-01-03T15:00Z','2020-01-03T16:00Z','UTC','in_person','confirmed','pay_later','not_required',0,'USD','{"cancellationWindowHours":24}','e2e-source-cancel-token');
insert into public.lessons(id,studio_id,student_id,topic,starts_at,ends_at,status,location_type,location_label) values('e8300000-0000-4000-8000-000000000042','e8300000-0000-4000-8000-000000000001','e8300000-0000-4000-8000-000000000004','E2E later corrected record','2020-01-03T15:00Z','2020-01-03T16:00Z','scheduled','in_person','E2E');
insert into public.lesson_participants(lesson_id,booking_id,student_id,display_name,email,status) values('e8300000-0000-4000-8000-000000000042','e8300000-0000-4000-8000-000000000041','e8300000-0000-4000-8000-000000000004','E2E learner','e2e-source-student@example.test','confirmed');
insert into discovery_internal.source_decisions(studio_id,calendar_id,event_id,disposition,lesson_id,lesson_ends_at,reviewed_hash,actor_id,reason) values('e8300000-0000-4000-8000-000000000001','canonical-a','later-corrected','linked','e8300000-0000-4000-8000-000000000042','2020-01-03T16:00Z',repeat('a',64),'e8300000-0000-4000-8000-000000000002','Explicit historical review');
select set_config('request.jwt.claim.sub','e8300000-0000-4000-8000-000000000002',true);
update public.lessons set starts_at='2099-01-03T15:00Z',ends_at='2099-01-03T16:00Z',version=version+1 where id='e8300000-0000-4000-8000-000000000042';
update public.bookings set starts_at='2099-01-03T15:00Z',ends_at='2099-01-03T16:00Z' where id='e8300000-0000-4000-8000-000000000041';
select set_config('request.jwt.claim.sub','',true);
set local role service_role;
select throws_ok($$update public.lessons set status='cancelled',version=version+1 where id='e8300000-0000-4000-8000-000000000042'$$,'P0001','REVIEW_REQUIRED: Review the protected historical lesson before changing its schedule or outcome.','Provider still cannot cancel a coach-corrected future occurrence');
select lives_ok($$select public.cancel_booking_credit('e8300000-0000-4000-8000-000000000041',1,false,true)$$,'Existing service-only student cancellation retains its canonical permission and financial checks');
select lives_ok($$select public.cancel_booking_credit('e8300000-0000-4000-8000-000000000041',1,false,true)$$,'Identical authorized cancellation replay remains harmless');
reset role;
select is((select status from public.bookings where id='e8300000-0000-4000-8000-000000000041'),'cancelled','Authorized booking cancellation commits');
select is((select status::text from public.lessons where id='e8300000-0000-4000-8000-000000000042'),'cancelled','Authorized downstream lesson cancellation commits');
select is((select jsonb_agg(to_jsonb(p) order by p.id) from public.payment_entries p where student_id='e8300000-0000-4000-8000-000000000004'),(select payments from source_history_before),'Booking cancellation does not mutate unrelated historical payment');
select * from finish();
rollback;
