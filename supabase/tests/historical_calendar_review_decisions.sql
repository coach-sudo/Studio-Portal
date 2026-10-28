begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
insert into auth.users(id,email) values
 ('e8400000-0000-4000-8000-000000000002','e2e-review-coach@example.test'),
 ('e8400000-0000-4000-8000-000000000003','e2e-review-student@example.test'),
 ('e8400000-0000-4000-8000-000000000004','e2e-review-guardian@example.test'),
 ('e8400000-0000-4000-8000-000000000005','e2e-review-unrelated@example.test');
insert into public.studios(id,name,slug) values('e8400000-0000-4000-8000-000000000001','E2E historical review','e2e-historical-review');
insert into public.memberships(studio_id,user_id,role,display_name) values
 ('e8400000-0000-4000-8000-000000000001','e8400000-0000-4000-8000-000000000002','coach','E2E coach'),
 ('e8400000-0000-4000-8000-000000000001','e8400000-0000-4000-8000-000000000003','student','E2E learner'),
 ('e8400000-0000-4000-8000-000000000001','e8400000-0000-4000-8000-000000000004','guardian','E2E guardian');
insert into public.students(id,studio_id,user_id,full_name,status) values('e8400000-0000-4000-8000-000000000006','e8400000-0000-4000-8000-000000000001','e8400000-0000-4000-8000-000000000003','E2E learner','active');
insert into public.lessons(id,studio_id,student_id,topic,starts_at,ends_at,status,location_type,price_minor,paid_minor,payment_status) values('e8400000-0000-4000-8000-000000000030','e8400000-0000-4000-8000-000000000001','e8400000-0000-4000-8000-000000000006','E2E paid historical outcome','2020-01-01T15:00Z','2020-01-01T16:00Z','completed','in_person',5000,5000,'paid');
insert into public.lesson_participants(lesson_id,student_id,display_name,email,status) values('e8400000-0000-4000-8000-000000000030','e8400000-0000-4000-8000-000000000006','E2E learner','e2e-review-student@example.test','attended');
insert into public.payment_entries(student_id,kind,amount_minor,currency,reason,external_reference) values('e8400000-0000-4000-8000-000000000006','payment',5000,'USD','E2E retained payment','e2e-historical-review-payment');
create temporary table review_finance_before as select to_jsonb(l) lesson,
 (select jsonb_agg(to_jsonb(p) order by p.id) from public.payment_entries p where p.student_id=l.student_id) payments,
 (select jsonb_agg(to_jsonb(p) order by p.id) from public.lesson_participants p where p.lesson_id=l.id) participants
 from public.lessons l where l.id='e8400000-0000-4000-8000-000000000030';
insert into discovery_internal.scans(id,studio_id,actor_id,request_key,request_hash,range_start,range_end,timezone) values('e8400000-0000-4000-8000-000000000007','e8400000-0000-4000-8000-000000000001','e8400000-0000-4000-8000-000000000002','e2e-review-scan',repeat('a',64),'2020-01-01','2020-02-01','UTC');
insert into discovery_internal.sources(scan_id,calendar_id,label) values('e8400000-0000-4000-8000-000000000007','canonical-a','E2E calendar');
insert into discovery_internal.candidates(id,scan_id,calendar_id,event_id,source_key,summary,status,starts_at,ends_at,reason_code)
 select ('e8400000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'e8400000-0000-4000-8000-000000000007','canonical-a','e2e-review-'||n,jsonb_build_array('canonical-a','e2e-review-'||n)::text,'E2E source '||n,'active','2020-01-01T15:00Z','2020-01-01T16:00Z','event_detected' from generate_series(10,18)n;
update discovery_internal.candidates set starts_at=null,ends_at=null,start_date='2020-01-01',end_date='2020-01-02',reason_code='date_only_requires_time' where id='e8400000-0000-4000-8000-000000000011';
update discovery_internal.candidates set starts_at='2099-01-01T15:00Z',ends_at='2099-01-01T16:00Z' where id='e8400000-0000-4000-8000-000000000012';
update discovery_internal.candidates set starts_at=null,ends_at=null,reason_code='invalid_time_requires_review' where id='e8400000-0000-4000-8000-000000000013';
insert into public.integration_imports(id,studio_id,provider,external_id,detected_source,status,lesson_id,payload,updated_at) values
 ('e8400000-0000-4000-8000-000000000040','e8400000-0000-4000-8000-000000000001','google_calendar','e2e-review-14','google_calendar','ignored','e8400000-0000-4000-8000-000000000030','{"privateSourceEvidence":"retained-only"}','2020-01-01'),
 ('e8400000-0000-4000-8000-000000000041','e8400000-0000-4000-8000-000000000001','google_calendar','e2e-review-16','google_calendar','ignored',null,'{"privateSourceEvidence":"fault-retained"}','2020-01-01'),
 ('e8400000-0000-4000-8000-000000000042','e8400000-0000-4000-8000-000000000001','google_calendar','e2e-review-17','google_calendar','ignored',null,'{}','2020-01-01');
create function pg_temp.review_payload(p_id uuid,p_action text default 'skip') returns jsonb language sql as $$
 select jsonb_build_object('stamp',public.preview_historical_calendar_review(p_id)->>'stamp','action',p_action,'reason','Explicit synthetic coach review')
$$;
create function pg_temp.reopen_payload(p_id uuid,p_import uuid) returns jsonb language sql as $$
 select pg_temp.review_payload(p_id,'reopen')||jsonb_build_object('legacyImportId',i.id,'legacyUpdatedAt',i.updated_at,'acknowledgeUnscoped',true) from public.integration_imports i where i.id=p_import
$$;
select ok(not has_function_privilege('anon','public.command_historical_calendar_review(uuid,jsonb,text)','execute'),'Anonymous cannot mutate review decisions');
select ok(not has_function_privilege('service_role','public.command_historical_calendar_review(uuid,jsonb,text)','execute'),'Worker cannot author coach decisions');
select ok(not has_function_privilege('service_role','public.preview_historical_calendar_review(uuid)','execute'),'Worker cannot bypass coach preview authority');
select ok(not has_table_privilege('authenticated','discovery_internal.review_receipts','select'),'Replay bodies are private');
select ok(not has_table_privilege('authenticated','discovery_internal.decision_revisions','update'),'Decision revisions cannot be rewritten by portal roles');
select set_config('request.jwt.claim.sub','',true);
set local role authenticated;
select throws_ok($$select public.preview_historical_calendar_review('e8400000-0000-4000-8000-000000000010')$$,'42501','FORBIDDEN','Missing authenticated subject cannot preview');
select set_config('request.jwt.claim.sub','e8400000-0000-4000-8000-000000000003',true);
select throws_ok($$select public.command_historical_calendar_review('e8400000-0000-4000-8000-000000000010','{}','e2e-review-forbidden')$$,'42501','FORBIDDEN','Student cannot write a source decision');
select set_config('request.jwt.claim.sub','e8400000-0000-4000-8000-000000000004',true);
select throws_ok($$select public.preview_historical_calendar_review('e8400000-0000-4000-8000-000000000010')$$,'42501','FORBIDDEN','Guardian finance/profile access is not coach review authority');
select set_config('request.jwt.claim.sub','e8400000-0000-4000-8000-000000000005',true);
select throws_ok($$select public.preview_historical_calendar_review('e8400000-0000-4000-8000-000000000010')$$,'42501','FORBIDDEN','Unrelated user cannot read a source');
select set_config('request.jwt.claim.sub','e8400000-0000-4000-8000-000000000002',true);
select is(public.preview_historical_calendar_review('e8400000-0000-4000-8000-000000000010')#>>'{observation,startsAt}','2020-01-01T15:00:00.000Z','Preview uses the same normalized UTC precision as provider observations');
select is(public.preview_historical_calendar_review('e8400000-0000-4000-8000-000000000010')->>'attendanceVerified','false','Preview does not claim attendance');
select is(public.preview_historical_calendar_review('e8400000-0000-4000-8000-000000000014')::text like '%privateSourceEvidence%',false,'Raw import payload is not returned in the preview');
select throws_ok($$select public.preview_historical_calendar_review('e8400000-0000-4000-8000-000000000012')$$,'P0001','REVIEW_REQUIRED: Select a confirmed historical interval before using historical review.','Future events cannot enter this historical policy');
select throws_ok($$select public.preview_historical_calendar_review('e8400000-0000-4000-8000-000000000013')$$,'P0001','REVIEW_REQUIRED: Select a confirmed historical interval before using historical review.','Malformed intervals require explicit correction first');
select set_config('e2e.review.request',pg_temp.review_payload('e8400000-0000-4000-8000-000000000010')::text,true);
select set_config('e2e.review.result',public.command_historical_calendar_review('e8400000-0000-4000-8000-000000000010',current_setting('e2e.review.request')::jsonb,'e2e-review-replay')::text,true);
select is(public.command_historical_calendar_review('e8400000-0000-4000-8000-000000000010',current_setting('e2e.review.request')::jsonb,'e2e-review-replay'),current_setting('e2e.review.result')::jsonb,'Lost response returns the identical logical receipt');
select throws_ok($$select public.command_historical_calendar_review('e8400000-0000-4000-8000-000000000010',current_setting('e2e.review.request')::jsonb||'{"reason":"Changed request"}','e2e-review-replay')$$,'P0001','IDEMPOTENCY_CONFLICT','Changed reason cannot reuse a command key');
select set_config('request.jwt.claim.sub','e8400000-0000-4000-8000-000000000003',true);
select throws_ok($$select public.command_historical_calendar_review('e8400000-0000-4000-8000-000000000010',current_setting('e2e.review.request')::jsonb,'e2e-review-replay')$$,'42501','FORBIDDEN','A different principal cannot retrieve a coach receipt');
select set_config('request.jwt.claim.sub','e8400000-0000-4000-8000-000000000002',true);
reset role;
delete from public.memberships where studio_id='e8400000-0000-4000-8000-000000000001' and user_id='e8400000-0000-4000-8000-000000000002';
set local role authenticated;
select throws_ok($$select public.command_historical_calendar_review('e8400000-0000-4000-8000-000000000010',current_setting('e2e.review.request')::jsonb,'e2e-review-replay')$$,'42501','FORBIDDEN','A removed coach cannot recover a previously committed receipt');
reset role;
insert into public.memberships(studio_id,user_id,role,display_name) values('e8400000-0000-4000-8000-000000000001','e8400000-0000-4000-8000-000000000002','coach','E2E coach');
set local role authenticated;
select lives_ok($$select public.command_historical_calendar_review('e8400000-0000-4000-8000-000000000011',pg_temp.review_payload('e8400000-0000-4000-8000-000000000011','not_lesson'),'e2e-review-all-day')$$,'Historical date-only entry can be explicitly marked not a lesson without inventing time');
select set_config('e2e.review.stale',pg_temp.review_payload('e8400000-0000-4000-8000-000000000018')::text,true);
reset role;
update discovery_internal.candidates set etag='changed-source' where id='e8400000-0000-4000-8000-000000000018';
set local role authenticated;
select throws_ok($$select public.command_historical_calendar_review('e8400000-0000-4000-8000-000000000018',current_setting('e2e.review.stale')::jsonb,'e2e-review-stale')$$,'P0001','VERSION_CONFLICT: Refresh the historical source preview.','Changed source invalidates the preview before any decision');
select throws_ok($$select public.command_historical_calendar_review('e8400000-0000-4000-8000-000000000014',pg_temp.reopen_payload('e8400000-0000-4000-8000-000000000014','e8400000-0000-4000-8000-000000000040')-'acknowledgeUnscoped','e2e-review-raw-noack')$$,'P0001','REVIEW_REQUIRED: Review the ambiguous legacy Calendar identity.','Legacy raw-ID reopening needs explicit acknowledgement');
select throws_ok($$select public.command_historical_calendar_review('e8400000-0000-4000-8000-000000000014',pg_temp.review_payload('e8400000-0000-4000-8000-000000000014','not_lesson'),'e2e-review-legacy-linked-hold')$$,'P0001','REVIEW_REQUIRED: Preserve the existing canonical lesson link.','Existing legacy canonical pointer cannot be ignored before a qualified decision exists');
select set_config('e2e.review.reopen',pg_temp.reopen_payload('e8400000-0000-4000-8000-000000000014','e8400000-0000-4000-8000-000000000040')::text,true);
select lives_ok($$select public.command_historical_calendar_review('e8400000-0000-4000-8000-000000000014',current_setting('e2e.review.reopen')::jsonb,'e2e-review-reopen')$$,'Coach explicitly reopens one exact ignored source');
select is(public.command_historical_calendar_review('e8400000-0000-4000-8000-000000000014',current_setting('e2e.review.reopen')::jsonb,'e2e-review-reopen')#>>'{resource,disposition}','review','Reopen replay returns review, not lesson completion');
reset role;
select is((select status from public.integration_imports where id='e8400000-0000-4000-8000-000000000040'),'needs_review','Only the selected ignored signal is reopened');
select is((select status from public.integration_imports where id='e8400000-0000-4000-8000-000000000041'),'ignored','Other ignored entries are not resurrected');
select is((select payload->>'privateSourceEvidence' from public.integration_imports where id='e8400000-0000-4000-8000-000000000040'),'retained-only','Explicit reopening preserves source evidence');
select is((select lesson_id from public.integration_imports where id='e8400000-0000-4000-8000-000000000040'),'e8400000-0000-4000-8000-000000000030'::uuid,'Existing canonical pointer survives reopening');
select is((select lesson_id from discovery_internal.source_decisions where studio_id='e8400000-0000-4000-8000-000000000001' and event_id='e2e-review-14'),'e8400000-0000-4000-8000-000000000030'::uuid,'Reopening an already-linked signal also protects its exact canonical lesson');
select is((select count(*) from discovery_internal.source_write_authorizations where transaction_id=txid_current()),0::bigint,'Private mutation authorization is removed before commit');
select is((select count(*) from discovery_internal.decision_revisions where request_key='e2e-review-replay'),1::bigint,'Replay appends one decision revision');
select is((select count(*) from public.audit_events where correlation_id='e2e-review-replay'),1::bigint,'Replay appends one audit event');
select is((select count(*) from discovery_internal.review_receipts where request_key='e2e-review-replay'),1::bigint,'Replay commits one durable receipt');
set local role service_role;
select is(public.observe_protected_calendar_sources('e8400000-0000-4000-8000-000000000001','canonical-a','[{"id":"e2e-review-10","etag":null,"status":"active","startsAt":"2020-01-01T15:00:00.000Z","endsAt":"2020-01-01T16:00:00.000Z","startDate":null,"endDate":null}]')#>>'{0,changed}','false','Routine worker recognizes an unchanged reviewed preview version');
reset role;
insert into discovery_internal.source_decisions(studio_id,calendar_id,event_id,disposition,lesson_id,lesson_ends_at,reviewed_hash,actor_id,reason) values
 ('e8400000-0000-4000-8000-000000000001','canonical-a','e2e-review-15','linked','e8400000-0000-4000-8000-000000000030','2020-01-01T16:00Z',repeat('a',64),'e8400000-0000-4000-8000-000000000002','Already linked paid lesson'),
 ('e8400000-0000-4000-8000-000000000001','canonical-b','e2e-review-17','not_lesson',null,null,repeat('a',64),'e8400000-0000-4000-8000-000000000002','Another calendar identity');
set local role authenticated;
select throws_ok($$select public.command_historical_calendar_review('e8400000-0000-4000-8000-000000000015',pg_temp.review_payload('e8400000-0000-4000-8000-000000000015','not_lesson'),'e2e-review-linked-hold')$$,'P0001','REVIEW_REQUIRED: Preserve the existing canonical lesson link.','Paid linked history cannot be reclassified or detached');
select lives_ok($$select public.command_historical_calendar_review('e8400000-0000-4000-8000-000000000015',pg_temp.review_payload('e8400000-0000-4000-8000-000000000015','reopen'),'e2e-review-linked-reopen')$$,'Linked historical decision can be reopened without detaching its canonical lesson');
select throws_ok($$select public.command_historical_calendar_review('e8400000-0000-4000-8000-000000000017',pg_temp.reopen_payload('e8400000-0000-4000-8000-000000000017','e8400000-0000-4000-8000-000000000042'),'e2e-review-ambiguous')$$,'P0001','REVIEW_REQUIRED: Review the ambiguous legacy Calendar identity.','Acknowledgement cannot erase another calendar decision sharing the raw ID');
reset role;
create function pg_temp.review_fault() returns trigger language plpgsql as $$begin if current_setting('e2e.review.fault',true)=tg_table_name then raise exception 'SYNTHETIC_REVIEW_WRITE_FAILURE';end if;return new;end$$;
create trigger e2e_review_revision_fault before insert on discovery_internal.decision_revisions for each row execute function pg_temp.review_fault();
create trigger e2e_review_audit_fault before insert on public.audit_events for each row execute function pg_temp.review_fault();
create trigger e2e_review_receipt_fault before insert on discovery_internal.review_receipts for each row execute function pg_temp.review_fault();
select set_config('e2e.review.fault','decision_revisions',true);
set local role authenticated;
select throws_ok($$select public.command_historical_calendar_review('e8400000-0000-4000-8000-000000000016',pg_temp.reopen_payload('e8400000-0000-4000-8000-000000000016','e8400000-0000-4000-8000-000000000041'),'e2e-review-fault')$$,'P0001','SYNTHETIC_REVIEW_WRITE_FAILURE','Late revision failure rolls back the whole decision');
reset role;
select is((select status from public.integration_imports where id='e8400000-0000-4000-8000-000000000041'),'ignored','Revision failure rolls back the already-written import status');
select set_config('e2e.review.fault','audit_events',true);
set local role authenticated;
select throws_ok($$select public.command_historical_calendar_review('e8400000-0000-4000-8000-000000000016',pg_temp.reopen_payload('e8400000-0000-4000-8000-000000000016','e8400000-0000-4000-8000-000000000041'),'e2e-review-fault')$$,'P0001','SYNTHETIC_REVIEW_WRITE_FAILURE','Audit failure rolls back review and reopening');
reset role;
select is((select count(*) from discovery_internal.source_decisions where studio_id='e8400000-0000-4000-8000-000000000001' and event_id='e2e-review-16'),0::bigint,'Audit failure leaves no protected decision');
select set_config('e2e.review.fault','review_receipts',true);
set local role authenticated;
select throws_ok($$select public.command_historical_calendar_review('e8400000-0000-4000-8000-000000000016',pg_temp.reopen_payload('e8400000-0000-4000-8000-000000000016','e8400000-0000-4000-8000-000000000041'),'e2e-review-fault')$$,'P0001','SYNTHETIC_REVIEW_WRITE_FAILURE','Lost receipt write rolls back all effects');
reset role;
select is((select count(*) from public.audit_events where correlation_id='e2e-review-fault'),0::bigint,'Receipt failure does not leave a success audit');
select is((select count(*) from discovery_internal.decision_revisions where request_key='e2e-review-fault'),0::bigint,'Receipt failure does not leave a revision');
select is((select status from public.integration_imports where id='e8400000-0000-4000-8000-000000000041'),'ignored','Receipt failure preserves the ignored status');
select set_config('e2e.review.fault','',true);
set local role authenticated;
select lives_ok($$select public.command_historical_calendar_review('e8400000-0000-4000-8000-000000000016',pg_temp.reopen_payload('e8400000-0000-4000-8000-000000000016','e8400000-0000-4000-8000-000000000041'),'e2e-review-fault')$$,'Retry after a rolled-back transaction commits once');
reset role;
select is((select to_jsonb(l) from public.lessons l where id='e8400000-0000-4000-8000-000000000030'),(select lesson from review_finance_before),'All decisions preserve paid canonical history byte-for-byte');
select is((select jsonb_agg(to_jsonb(p) order by p.id) from public.payment_entries p where p.student_id='e8400000-0000-4000-8000-000000000006'),(select payments from review_finance_before),'All decisions preserve ledger history byte-for-byte');
select is((select jsonb_agg(to_jsonb(p) order by p.id) from public.lesson_participants p where p.lesson_id='e8400000-0000-4000-8000-000000000030'),(select participants from review_finance_before),'Attendance remains independently recorded and unchanged');
select is((select count(*) from public.lessons where studio_id='e8400000-0000-4000-8000-000000000001'),1::bigint,'Review creates no canonical lesson');
select is((select count(*) from public.outbox_messages where studio_id='e8400000-0000-4000-8000-000000000001'),0::bigint,'Review queues no notification');
select is((select count(*) from public.calendar_projections where lesson_id='e8400000-0000-4000-8000-000000000030'),0::bigint,'Review queues no provider projection');
select is((select count(*) from discovery_internal.source_write_authorizations where transaction_id=txid_current()),0::bigint,'No private write authorization survives command completion or faults');
-- A new review may acknowledge an already-corrected historical canonical time
-- without rewriting the lesson or losing the earlier decision snapshot.
insert into public.lessons(id,studio_id,student_id,topic,starts_at,ends_at,status,location_type) values('e8400000-0000-4000-8000-000000000031','e8400000-0000-4000-8000-000000000001','e8400000-0000-4000-8000-000000000006','E2E corrected history','2020-02-01T15:00Z','2020-02-01T16:00Z','completed','in_person');
insert into discovery_internal.candidates(id,scan_id,calendar_id,event_id,source_key,summary,status,starts_at,ends_at,reason_code) values('e8400000-0000-4000-8000-000000000019','e8400000-0000-4000-8000-000000000007','canonical-a','e2e-review-19',jsonb_build_array('canonical-a','e2e-review-19')::text,'E2E corrected source','active','2020-02-01T15:00Z','2020-02-01T16:00Z','event_detected');
insert into discovery_internal.source_decisions(studio_id,calendar_id,event_id,disposition,lesson_id,lesson_ends_at,reviewed_hash,actor_id,reason) values('e8400000-0000-4000-8000-000000000001','canonical-a','e2e-review-19','linked','e8400000-0000-4000-8000-000000000031','2020-02-01T16:00Z',repeat('a',64),'e8400000-0000-4000-8000-000000000002','Previously linked historical lesson');
update public.lessons set starts_at='2021-02-01T15:00Z',ends_at='2021-02-01T16:00Z' where id='e8400000-0000-4000-8000-000000000031';
create temporary table reviewed_corrected_before as select to_jsonb(l) value from public.lessons l where id='e8400000-0000-4000-8000-000000000031';
set local role authenticated;
select lives_ok($$select public.command_historical_calendar_review('e8400000-0000-4000-8000-000000000019',pg_temp.review_payload('e8400000-0000-4000-8000-000000000019','reopen'),'e2e-review-corrected-history')$$,'Fresh explicit review can acknowledge an already-corrected historical lesson');
reset role;
select is((select lesson_ends_at from discovery_internal.source_decisions where studio_id='e8400000-0000-4000-8000-000000000001' and event_id='e2e-review-19'),'2021-02-01T16:00Z'::timestamptz,'New decision snapshots the current confirmed historical interval');
select is((select to_jsonb(l) from public.lessons l where id='e8400000-0000-4000-8000-000000000031'),(select value from reviewed_corrected_before),'Review leaves the corrected canonical lesson byte-equivalent');
select * from finish();
rollback;
