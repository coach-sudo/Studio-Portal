begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
insert into auth.users(id,email) values
 ('e8600000-0000-4000-8000-000000000002','e2e-review-coach@example.test'),
 ('e8600000-0000-4000-8000-000000000003','e2e-review-student@example.test'),
 ('e8600000-0000-4000-8000-000000000004','e2e-review-guardian@example.test'),
 ('e8600000-0000-4000-8000-000000000005','e2e-review-unrelated@example.test');
insert into public.studios(id,name,slug) values('e8600000-0000-4000-8000-000000000001','E2E historical review','e2e-historical-review');
insert into public.memberships(studio_id,user_id,role,display_name) values
 ('e8600000-0000-4000-8000-000000000001','e8600000-0000-4000-8000-000000000002','coach','E2E coach'),
 ('e8600000-0000-4000-8000-000000000001','e8600000-0000-4000-8000-000000000003','student','E2E learner'),
 ('e8600000-0000-4000-8000-000000000001','e8600000-0000-4000-8000-000000000004','guardian','E2E guardian');
insert into public.students(id,studio_id,user_id,full_name,status) values('e8600000-0000-4000-8000-000000000006','e8600000-0000-4000-8000-000000000001','e8600000-0000-4000-8000-000000000003','E2E learner','active');
insert into public.lessons(id,studio_id,student_id,topic,starts_at,ends_at,status,location_type,location_label,price_minor,paid_minor,payment_status) values('e8600000-0000-4000-8000-000000000030','e8600000-0000-4000-8000-000000000001','e8600000-0000-4000-8000-000000000006','E2E paid historical outcome','2020-01-01T15:00Z','2020-01-01T16:00Z','completed','in_person','E2E studio',5000,5000,'paid');
insert into public.lesson_participants(lesson_id,student_id,display_name,email,status) values('e8600000-0000-4000-8000-000000000030','e8600000-0000-4000-8000-000000000006','E2E learner','e2e-review-student@example.test','attended');
insert into public.payment_entries(student_id,kind,amount_minor,currency,reason,external_reference) values('e8600000-0000-4000-8000-000000000006','payment',5000,'USD','E2E retained payment','e2e-historical-review-payment');
create temporary table review_finance_before as select to_jsonb(l) lesson,
 (select jsonb_agg(to_jsonb(p) order by p.id) from public.payment_entries p where p.student_id=l.student_id) payments,
 (select jsonb_agg(to_jsonb(p) order by p.id) from public.lesson_participants p where p.lesson_id=l.id) participants
 from public.lessons l where l.id='e8600000-0000-4000-8000-000000000030';
insert into discovery_internal.scans(id,studio_id,actor_id,request_key,request_hash,range_start,range_end,timezone) values('e8600000-0000-4000-8000-000000000007','e8600000-0000-4000-8000-000000000001','e8600000-0000-4000-8000-000000000002','e2e-review-scan',repeat('a',64),'2020-01-01','2020-02-01','UTC');
insert into discovery_internal.sources(scan_id,calendar_id,label) values('e8600000-0000-4000-8000-000000000007','canonical-a','E2E calendar');
insert into discovery_internal.candidates(id,scan_id,calendar_id,event_id,source_key,summary,status,starts_at,ends_at,reason_code)
 select ('e8600000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'e8600000-0000-4000-8000-000000000007','canonical-a','e2e-review-'||n,jsonb_build_array('canonical-a','e2e-review-'||n)::text,'E2E source '||n,'active','2020-01-01T15:00Z','2020-01-01T16:00Z','event_detected' from generate_series(10,18)n;
update discovery_internal.candidates set starts_at=null,ends_at=null,start_date='2020-01-01',end_date='2020-01-02',reason_code='date_only_requires_time' where id='e8600000-0000-4000-8000-000000000011';
update discovery_internal.candidates set starts_at='2099-01-01T15:00Z',ends_at='2099-01-01T16:00Z' where id='e8600000-0000-4000-8000-000000000012';
update discovery_internal.candidates set starts_at=null,ends_at=null,reason_code='invalid_time_requires_review' where id='e8600000-0000-4000-8000-000000000013';
insert into public.integration_imports(id,studio_id,provider,external_id,detected_source,status,lesson_id,payload,updated_at) values
 ('e8600000-0000-4000-8000-000000000040','e8600000-0000-4000-8000-000000000001','google_calendar','e2e-review-14','google_calendar','ignored','e8600000-0000-4000-8000-000000000030','{"privateSourceEvidence":"retained-only"}','2020-01-01'),
 ('e8600000-0000-4000-8000-000000000041','e8600000-0000-4000-8000-000000000001','google_calendar','e2e-review-16','google_calendar','ignored',null,'{"privateSourceEvidence":"fault-retained"}','2020-01-01'),
 ('e8600000-0000-4000-8000-000000000042','e8600000-0000-4000-8000-000000000001','google_calendar','e2e-review-17','google_calendar','ignored',null,'{}','2020-01-01');

update discovery_internal.candidates set starts_at='2020-01-05T15:00Z',ends_at='2020-01-05T16:00Z' where id='e8600000-0000-4000-8000-000000000018';
insert into discovery_internal.candidates(id,scan_id,calendar_id,event_id,source_key,summary,status,starts_at,ends_at,reason_code) values('e8600000-0000-4000-8000-000000000019','e8600000-0000-4000-8000-000000000007','canonical-a','e2e-canonical-fault',jsonb_build_array('canonical-a','e2e-canonical-fault')::text,'E2E late fault','active','2020-01-08T15:00Z','2020-01-08T16:00Z','event_detected');
insert into public.integration_imports(id,studio_id,provider,external_id,detected_source,status,payload,updated_at) values('e8600000-0000-4000-8000-000000000043','e8600000-0000-4000-8000-000000000001','google_calendar','e2e-review-13','google_calendar','ignored','{"originalEvidence":"retained"}','2020-01-01');
insert into public.students(id,studio_id,full_name,status) values('e8600000-0000-4000-8000-000000000009','e8600000-0000-4000-8000-000000000001','E2E other primary learner','active');
insert into public.lessons(id,studio_id,student_id,topic,starts_at,ends_at,status,location_type,location_label,source_provider,source_external_id) values
 ('e8600000-0000-4000-8000-000000000031','e8600000-0000-4000-8000-000000000001','e8600000-0000-4000-8000-000000000006','E2E cancelled source history','2020-01-03T15:00Z','2020-01-03T16:00Z','cancelled','in_person','E2E','lessonface','e2e-review-15'),
 ('e8600000-0000-4000-8000-000000000032','e8600000-0000-4000-8000-000000000001','e8600000-0000-4000-8000-000000000009','E2E other-primary participant history','2020-01-04T15:00Z','2020-01-04T16:00Z','completed','in_person','E2E','studio',null);
insert into public.lesson_participants(lesson_id,student_id,display_name,email,status) values('e8600000-0000-4000-8000-000000000032','e8600000-0000-4000-8000-000000000006','E2E learner','e2e-review-student@example.test','cancelled');
insert into discovery_internal.source_decisions(studio_id,calendar_id,event_id,disposition,reviewed_hash,actor_id,reason) values('e8600000-0000-4000-8000-000000000001','canonical-b','e2e-review-17','not_lesson',repeat('a',64),'e8600000-0000-4000-8000-000000000002','Another calendar decision');
create function pg_temp.canonical_candidate(p_n integer) returns uuid language sql immutable as $$select ('e8600000-0000-4000-8000-'||lpad(p_n::text,12,'0'))::uuid$$;
create function pg_temp.create_value(p_day text,p_ack boolean default false) returns jsonb language sql immutable as $$
 select jsonb_build_object('action','create','studentId','e8600000-0000-4000-8000-000000000006','reason','Explicit synthetic historical creation','startsAt',p_day||'T15:00:00Z','endsAt',p_day||'T16:00:00Z','timezone','UTC','topic','E2E historical recorded lesson','locationType','in_person','locationLabel','E2E studio','acknowledgeSourceDifference',p_ack)
$$;
create function pg_temp.link_value(p_lesson uuid,p_ack boolean default false) returns jsonb language sql as $$
 select jsonb_build_object('action','link','studentId','e8600000-0000-4000-8000-000000000006','reason','Explicit synthetic canonical link','lessonId',p_lesson,'lessonVersion',1,'acknowledgeSourceDifference',p_ack)
$$;
create function pg_temp.canonical_commit(p_n integer,p_value jsonb,p_key text) returns jsonb language sql as $$
 select public.command_historical_calendar_reconciliation(pg_temp.canonical_candidate(p_n),p_value,public.preview_historical_calendar_reconciliation(pg_temp.canonical_candidate(p_n),p_value)->>'stamp',p_key)
$$;
create function pg_temp.canonical_reopen(p_n integer,p_import uuid default null) returns jsonb language plpgsql as $$
declare value jsonb:=jsonb_build_object('action','reopen','reason','Explicit synthetic source reopening','stamp',public.preview_historical_calendar_reopening(pg_temp.canonical_candidate(p_n))->>'stamp');
begin
 if p_import is not null then select value||jsonb_build_object('legacyImportId',i.id,'legacyUpdatedAt',i.updated_at,'acknowledgeUnscoped',true) into value from public.integration_imports i where i.id=p_import;end if;
 return public.command_historical_calendar_review(pg_temp.canonical_candidate(p_n),value,'e2e-canonical-reopen-'||p_n);
end$$;
select ok(not has_function_privilege('anon','public.command_historical_calendar_reconciliation(uuid,jsonb,text,text)','execute'),'Anonymous cannot reconcile history');
select ok(not has_function_privilege('service_role','public.command_historical_calendar_reconciliation(uuid,jsonb,text,text)','execute'),'Provider worker cannot create coach canonical history');
select ok(not has_function_privilege('service_role','public.preview_historical_calendar_reconciliation(uuid,jsonb)','execute'),'Worker cannot borrow coach preview authority');
select ok(not has_function_privilege('authenticated','discovery_internal.historical_review_snapshot_core(uuid,boolean)','execute'),'Manual-source override helper is private');
select ok(not has_function_privilege('anon','public.historical_calendar_decision_history(uuid,integer)','execute'),'Anonymous cannot read source decisions');
select set_config('request.jwt.claim.sub','e8600000-0000-4000-8000-000000000003',true);
set local role authenticated;
select throws_ok($$select public.preview_historical_calendar_reconciliation(pg_temp.canonical_candidate(18),pg_temp.create_value('2020-01-05'))$$,'42501','FORBIDDEN','Student cannot preview canonical reconciliation');
select set_config('request.jwt.claim.sub','e8600000-0000-4000-8000-000000000004',true);
select throws_ok($$select public.preview_historical_calendar_reopening(pg_temp.canonical_candidate(13))$$,'42501','FORBIDDEN','Guardian cannot reopen an uncertain source');
select set_config('request.jwt.claim.sub','e8600000-0000-4000-8000-000000000005',true);
select throws_ok($$select public.historical_calendar_decision_history(pg_temp.canonical_candidate(10))$$,'42501','FORBIDDEN','Unrelated user cannot read decision history');
select set_config('request.jwt.claim.sub','e8600000-0000-4000-8000-000000000002',true);
select is(public.preview_historical_calendar_reconciliation(pg_temp.canonical_candidate(18),pg_temp.create_value('2020-01-05'))->>'phase','preview','Preview is explicitly uncommitted');
select is(public.preview_historical_calendar_reconciliation(pg_temp.canonical_candidate(18),pg_temp.create_value('2020-01-05'))->'canonicalEffects','[]'::jsonb,'Preview does not report planned effects as committed');
select throws_ok($$select public.preview_historical_calendar_reconciliation(pg_temp.canonical_candidate(18),pg_temp.create_value('2020-01-05')||'{"status":"completed"}')$$,'P0001','VALIDATION_FAILED','Source creation cannot invent an outcome');
select throws_ok($$select public.preview_historical_calendar_reconciliation(pg_temp.canonical_candidate(18),pg_temp.create_value('2020-01-05')||'{"paidMinor":5000}')$$,'P0001','VALIDATION_FAILED','Source creation cannot invent payment');
select throws_ok($$select public.preview_historical_calendar_reconciliation(pg_temp.canonical_candidate(18),pg_temp.create_value('2020-01-05')||'{"timezone":"invalid/timezone"}')$$,'P0001','VALIDATION_FAILED','Invalid timezone cannot silently become New York');
select throws_ok($$select public.preview_historical_calendar_reconciliation(pg_temp.canonical_candidate(18),pg_temp.create_value('2099-01-05'))$$,'P0001','REVIEW_REQUIRED: Enter a finite increasing historical interval.','Historical command does not silently schedule an upcoming occurrence');
select is(public.preview_historical_calendar_reconciliation(pg_temp.canonical_candidate(10),pg_temp.create_value('2020-01-01'))->>'blockedReason','existing_historical_interval','Existing paid/completed interval prevents a duplicate');
select lives_ok($$select pg_temp.canonical_commit(10,pg_temp.link_value('e8600000-0000-4000-8000-000000000030'),'e2e-canonical-paid-link')$$,'Coach links exact paid/completed history without changing it');
select set_config('e2e.canonical.create.value',pg_temp.create_value('2020-01-05')::text,true);
select set_config('e2e.canonical.create.stamp',public.preview_historical_calendar_reconciliation(pg_temp.canonical_candidate(18),current_setting('e2e.canonical.create.value')::jsonb)->>'stamp',true);
select set_config('e2e.canonical.create.result',public.command_historical_calendar_reconciliation(pg_temp.canonical_candidate(18),current_setting('e2e.canonical.create.value')::jsonb,current_setting('e2e.canonical.create.stamp'),'e2e-canonical-create')::text,true);
select is(public.command_historical_calendar_reconciliation(pg_temp.canonical_candidate(18),current_setting('e2e.canonical.create.value')::jsonb,current_setting('e2e.canonical.create.stamp'),'e2e-canonical-create'),current_setting('e2e.canonical.create.result')::jsonb,'Identical replay after a lost response returns the same logical result');
select throws_ok($$select public.command_historical_calendar_reconciliation(pg_temp.canonical_candidate(18),current_setting('e2e.canonical.create.value')::jsonb||'{"reason":"Changed request"}',current_setting('e2e.canonical.create.stamp'),'e2e-canonical-create')$$,'P0001','IDEMPOTENCY_CONFLICT','Changed payload cannot reuse an accepted key');
reset role;
delete from public.memberships where studio_id='e8600000-0000-4000-8000-000000000001' and user_id='e8600000-0000-4000-8000-000000000002';
set local role authenticated;
select throws_ok($$select public.command_historical_calendar_reconciliation(pg_temp.canonical_candidate(18),current_setting('e2e.canonical.create.value')::jsonb,current_setting('e2e.canonical.create.stamp'),'e2e-canonical-create')$$,'42501','FORBIDDEN','Revoked coach cannot retrieve a committed receipt');
reset role;
insert into public.memberships(studio_id,user_id,role,display_name) values('e8600000-0000-4000-8000-000000000001','e8600000-0000-4000-8000-000000000002','coach','E2E coach');
select is((select status::text from public.lessons where id=(current_setting('e2e.canonical.create.result')::jsonb#>>'{resource,lessonId}')::uuid),'scheduled','Historical creation is scheduled, not automatically completed');
select is((select status from public.lesson_participants where lesson_id=(current_setting('e2e.canonical.create.result')::jsonb#>>'{resource,lessonId}')::uuid),'confirmed','Historical creation confirms identity/participation, not attendance');
select is((select payment_status from public.lessons where id=(current_setting('e2e.canonical.create.result')::jsonb#>>'{resource,lessonId}')::uuid),'untracked','Financial coverage is not invented');
select is((select paid_minor from public.lessons where id=(current_setting('e2e.canonical.create.result')::jsonb#>>'{resource,lessonId}')::uuid),0::bigint,'Historical source creates no paid amount');
select ok((select created_at>=transaction_timestamp() and starts_at<created_at from public.lessons where id=(current_setting('e2e.canonical.create.result')::jsonb#>>'{resource,lessonId}')::uuid),'Creation timestamp records actual entry time, not the historical occurrence');
select is((select count(*) from public.lessons where studio_id='e8600000-0000-4000-8000-000000000001' and source_external_id=jsonb_build_array('canonical-a','e2e-review-18')::text),1::bigint,'Replay retains one qualified canonical lesson');
select is((select count(*) from discovery_internal.source_write_authorizations where transaction_id=txid_current()),0::bigint,'No private import write proof escapes the transaction');
set local role authenticated;
select is(public.preview_historical_calendar_reconciliation(pg_temp.canonical_candidate(11),pg_temp.create_value('2020-01-02'))->>'blockedReason','source_difference_acknowledgement_required','All-day source requires an explicit interval difference acknowledgement');
select lives_ok($$select pg_temp.canonical_commit(11,pg_temp.create_value('2020-01-02',true),'e2e-canonical-all-day')$$,'Coach can record a manually reviewed all-day historical interval');
select is(public.preview_historical_calendar_reconciliation(pg_temp.canonical_candidate(13),pg_temp.create_value('2020-01-07',true))->>'blockedReason','reopen_required','Ignored malformed source cannot be silently resurrected');
select lives_ok($$select pg_temp.canonical_reopen(13,'e8600000-0000-4000-8000-000000000043')$$,'Coach explicitly reopens uncertain timing without fabricating a source instant');
select lives_ok($$select pg_temp.canonical_commit(13,pg_temp.create_value('2020-01-07',true),'e2e-canonical-uncertain')$$,'Manually confirmed historical time can reconcile the explicitly reopened source');
select is(public.preview_historical_calendar_reconciliation(pg_temp.canonical_candidate(15),pg_temp.create_value('2020-01-03',true))->>'blockedReason','source_identity_requires_review','Cancelled raw-provider history cannot be duplicated under a scoped identity');
select lives_ok($$select pg_temp.canonical_commit(15,pg_temp.link_value('e8600000-0000-4000-8000-000000000031',true),'e2e-canonical-cancelled-link')$$,'Explicit link preserves a cancelled existing source');
select lives_ok($$select pg_temp.canonical_reopen(16,'e8600000-0000-4000-8000-000000000041')$$,'Group candidate first reopens its exact ignored signal');
select is(public.preview_historical_calendar_reconciliation(pg_temp.canonical_candidate(16),pg_temp.create_value('2020-01-04',true))->>'blockedReason','existing_historical_interval','Group participation duplicate is detected even when another learner is primary');
select lives_ok($$select pg_temp.canonical_commit(16,pg_temp.link_value('e8600000-0000-4000-8000-000000000032',true),'e2e-canonical-participant-link')$$,'Coach can link the exact existing historical participant without recreating attendance');
select is(public.preview_historical_calendar_reconciliation(pg_temp.canonical_candidate(14),pg_temp.link_value('e8600000-0000-4000-8000-000000000030'))->>'blockedReason','reopen_required','A linked ignored legacy import still requires explicit reopening');
select lives_ok($$select pg_temp.canonical_reopen(14,'e8600000-0000-4000-8000-000000000040')$$,'One exact ignored legacy source is reopened for review');
select lives_ok($$select pg_temp.canonical_commit(14,pg_temp.link_value('e8600000-0000-4000-8000-000000000030'),'e2e-canonical-legacy-link')$$,'Reconciliation retains the selected legacy canonical pointer');
select throws_ok($$select pg_temp.canonical_reopen(17,'e8600000-0000-4000-8000-000000000042')$$,'P0001','REVIEW_REQUIRED: Review the ambiguous legacy Calendar identity.','Coarse raw identity cannot override another calendar decision');
select set_config('e2e.canonical.stale.value',pg_temp.create_value('2020-01-06',true)::text,true);
select set_config('e2e.canonical.stale.stamp',public.preview_historical_calendar_reconciliation(pg_temp.canonical_candidate(12),current_setting('e2e.canonical.stale.value')::jsonb)->>'stamp',true);
reset role;
update discovery_internal.candidates set etag='changed-source' where id=pg_temp.canonical_candidate(12);
set local role authenticated;
select throws_ok($$select public.command_historical_calendar_reconciliation(pg_temp.canonical_candidate(12),current_setting('e2e.canonical.stale.value')::jsonb,current_setting('e2e.canonical.stale.stamp'),'e2e-canonical-stale')$$,'P0001','VERSION_CONFLICT: Refresh the historical reconciliation preview.','Changed provider observation invalidates the preview before canonical writes');
select lives_ok($$select pg_temp.canonical_commit(12,pg_temp.create_value('2020-01-06',true),'e2e-canonical-source-correction')$$,'Explicit coach review can correct a source date while recording a finite past interval');
reset role;
create function pg_temp.canonical_fault() returns trigger language plpgsql as $$begin if current_setting('e2e.canonical.fault',true)=tg_table_name then raise exception 'SYNTHETIC_CANONICAL_WRITE_FAILURE';end if;return new;end$$;
create trigger e2e_canonical_participant_fault before insert on public.lesson_participants for each row execute function pg_temp.canonical_fault();
create trigger e2e_canonical_import_fault before insert on public.integration_imports for each row execute function pg_temp.canonical_fault();
create trigger e2e_canonical_audit_fault before insert on public.audit_events for each row execute function pg_temp.canonical_fault();
create trigger e2e_canonical_receipt_fault before insert on discovery_internal.review_receipts for each row execute function pg_temp.canonical_fault();
select set_config('e2e.canonical.fault','lesson_participants',true);
set local role authenticated;
select throws_ok($$select pg_temp.canonical_commit(19,pg_temp.create_value('2020-01-08'),'e2e-canonical-fault')$$,'P0001','SYNTHETIC_CANONICAL_WRITE_FAILURE','Failed participant insert rolls back canonical lesson and head');
reset role;
select is((select count(*) from public.lessons where studio_id='e8600000-0000-4000-8000-000000000001' and source_external_id=jsonb_build_array('canonical-a','e2e-canonical-fault')::text),0::bigint,'Participant failure leaves no orphan lesson');
select set_config('e2e.canonical.fault','integration_imports',true);
set local role authenticated;
select throws_ok($$select pg_temp.canonical_commit(19,pg_temp.create_value('2020-01-08'),'e2e-canonical-fault')$$,'P0001','SYNTHETIC_CANONICAL_WRITE_FAILURE','Failed verified import rolls back lesson and participant');
reset role;
select is((select count(*) from discovery_internal.source_decisions where studio_id='e8600000-0000-4000-8000-000000000001' and event_id='e2e-canonical-fault'),0::bigint,'Import failure leaves no false linked decision');
select set_config('e2e.canonical.fault','audit_events',true);
set local role authenticated;
select throws_ok($$select pg_temp.canonical_commit(19,pg_temp.create_value('2020-01-08'),'e2e-canonical-fault')$$,'P0001','SYNTHETIC_CANONICAL_WRITE_FAILURE','Failed audit rolls back all canonical/source writes');
reset role;
select is((select count(*) from discovery_internal.review_receipts where request_key='e2e-canonical-fault'),0::bigint,'Audit failure cannot leave a successful receipt');
select set_config('e2e.canonical.fault','review_receipts',true);
set local role authenticated;
select throws_ok($$select pg_temp.canonical_commit(19,pg_temp.create_value('2020-01-08'),'e2e-canonical-fault')$$,'P0001','SYNTHETIC_CANONICAL_WRITE_FAILURE','Failed replay receipt rolls back every earlier write');
reset role;
select is((select count(*) from public.audit_events where correlation_id='e2e-canonical-fault'),0::bigint,'Receipt failure leaves no success audit');
select is((select count(*) from public.integration_imports where studio_id='e8600000-0000-4000-8000-000000000001' and external_id=jsonb_build_array('canonical-a','e2e-canonical-fault')::text),0::bigint,'Receipt failure leaves no verified import');
select set_config('e2e.canonical.fault','',true);
set local role authenticated;
select lives_ok($$select pg_temp.canonical_commit(19,pg_temp.create_value('2020-01-08'),'e2e-canonical-fault')$$,'Retry after rollback creates one recoverable canonical record');
-- Exercise cursor history through the public commands, preserving canonical data.
do $$declare n integer;begin for n in 1..13 loop
 perform public.command_historical_calendar_review(pg_temp.canonical_candidate(10),jsonb_build_object('action','reopen','reason','Synthetic history page review','stamp',public.preview_historical_calendar_reopening(pg_temp.canonical_candidate(10))->>'stamp'),'e2e-canonical-page-reopen-'||n);
 perform pg_temp.canonical_commit(10,pg_temp.link_value('e8600000-0000-4000-8000-000000000030'),'e2e-canonical-page-link-'||n);
end loop;end$$;
select is(jsonb_array_length(public.historical_calendar_decision_history(pg_temp.canonical_candidate(10))->'items'),25,'Decision history returns a bounded first page');
select is((public.historical_calendar_decision_history(pg_temp.canonical_candidate(10))->>'total')::integer,27,'History retains authoritative total beyond the page size');
select is(public.historical_calendar_decision_history(pg_temp.canonical_candidate(10))->>'hasMore','true','Older history is discoverable');
select is(jsonb_array_length(public.historical_calendar_decision_history(pg_temp.canonical_candidate(10),(public.historical_calendar_decision_history(pg_temp.canonical_candidate(10))->>'nextBeforeVersion')::integer)->'items'),2,'Cursor exposes the remaining history without duplicates');
reset role;
-- Equal provider event IDs on distinct selected calendars retain their own
-- source identities. Neither an account-relative alias nor a raw ID can choose
-- the other calendar's existing lesson for the coach.
insert into discovery_internal.sources(scan_id,calendar_id,label) values('e8600000-0000-4000-8000-000000000007','canonical-b','E2E second calendar');
insert into discovery_internal.candidates(id,scan_id,calendar_id,event_id,source_key,summary,status,starts_at,ends_at,reason_code)
 values(pg_temp.canonical_candidate(20),'e8600000-0000-4000-8000-000000000007','canonical-b','e2e-review-18',jsonb_build_array('canonical-b','e2e-review-18')::text,'E2E distinct-calendar event','active','2020-01-09T15:00Z','2020-01-09T16:00Z','event_detected');
set local role authenticated;
select is((public.preview_historical_calendar_reconciliation(pg_temp.canonical_candidate(20),pg_temp.create_value('2020-01-09'))->>'sourceMatchCount')::integer,0,'Same raw event ID on another canonical calendar is not the existing source');
select lives_ok($$select pg_temp.canonical_commit(20,pg_temp.create_value('2020-01-09'),'e2e-canonical-other-calendar')$$,'Explicit distinct-calendar historical source records its own lesson');
reset role;
select is((select count(*) from public.lessons where studio_id='e8600000-0000-4000-8000-000000000001' and source_external_id in(jsonb_build_array('canonical-a','e2e-review-18')::text,jsonb_build_array('canonical-b','e2e-review-18')::text)),2::bigint,'The two qualified sources retain independent canonical lesson identities');
set local role service_role;
select is((public.observe_protected_calendar_sources('e8600000-0000-4000-8000-000000000001','canonical-a','[{"id":"e2e-review-18","status":"cancelled"}]')->0->>'lessonId')::uuid,(current_setting('e2e.canonical.create.result')::jsonb#>>'{resource,lessonId}')::uuid,'Later Calendar A observations resolve only the Calendar A lesson');
reset role;
insert into public.lessons(id,studio_id,student_id,topic,starts_at,ends_at,status,location_type,location_label) values('e8600000-0000-4000-8000-000000000033','e8600000-0000-4000-8000-000000000001','e8600000-0000-4000-8000-000000000006','E2E coach-corrected future record','2020-01-10T15:00Z','2020-01-10T16:00Z','scheduled','in_person','E2E');
insert into discovery_internal.source_decisions(studio_id,calendar_id,event_id,disposition,lesson_id,lesson_ends_at,reviewed_hash,actor_id,reason) values('e8600000-0000-4000-8000-000000000001','canonical-a','e2e-review-future-linked','linked','e8600000-0000-4000-8000-000000000033','2020-01-10T16:00Z',repeat('a',64),'e8600000-0000-4000-8000-000000000002','Synthetic prior historical link');
update public.lessons set starts_at='2099-01-10T15:00Z',ends_at='2099-01-10T16:00Z',version=version+1 where id='e8600000-0000-4000-8000-000000000033';
insert into discovery_internal.candidates(id,scan_id,calendar_id,event_id,source_key,summary,status,starts_at,ends_at,reason_code)
 values(pg_temp.canonical_candidate(21),'e8600000-0000-4000-8000-000000000007','canonical-a','e2e-review-future-linked',jsonb_build_array('canonical-a','e2e-review-future-linked')::text,'E2E corrected future linked source','active',null,null,'invalid_time_requires_review');
set local role authenticated;
select throws_ok($$select pg_temp.canonical_reopen(21)$$,'P0001','REVIEW_REQUIRED: Preserve the exact historical canonical lesson link.','Uncertain-source reopening cannot mutate a linked future lesson');
reset role;
select is((select version from discovery_internal.source_decisions where studio_id='e8600000-0000-4000-8000-000000000001' and event_id='e2e-review-future-linked'),1,'Rejected future-linked reopening leaves source history unchanged');
select is((select to_jsonb(l) from public.lessons l where id='e8600000-0000-4000-8000-000000000030'),(select lesson from review_finance_before),'Repeated linking preserves the complete paid/completed canonical row');
select is((select jsonb_agg(to_jsonb(p) order by p.id) from public.payment_entries p where p.student_id='e8600000-0000-4000-8000-000000000006'),(select payments from review_finance_before),'No reconciliation changes or duplicates append-only payment history');
select is((select jsonb_agg(to_jsonb(p) order by p.id) from public.lesson_participants p where p.lesson_id='e8600000-0000-4000-8000-000000000030'),(select participants from review_finance_before),'Existing attended participation remains byte-equivalent');
select is((select status::text from public.lessons where id='e8600000-0000-4000-8000-000000000031'),'cancelled','Source verification does not revive a cancelled outcome');
select is((select status from public.lesson_participants where lesson_id='e8600000-0000-4000-8000-000000000032' and student_id='e8600000-0000-4000-8000-000000000006'),'cancelled','Linking another-primary participation does not invent attendance');
select is((select payload->>'originalEvidence' from public.integration_imports where id='e8600000-0000-4000-8000-000000000043'),'retained','Explicit reopening/finalization preserves original source evidence');
select is((select status from public.integration_imports where id='e8600000-0000-4000-8000-000000000042'),'ignored','Unselected ambiguous source remains ignored');
select is((select count(*) from public.package_credit_entries e join public.lessons l on l.id=e.lesson_id where l.studio_id='e8600000-0000-4000-8000-000000000001'),0::bigint,'Historical reconciliation consumes/grants no credits');
select is((select count(*) from public.outbox_messages where studio_id='e8600000-0000-4000-8000-000000000001'),0::bigint,'Historical reconciliation queues no notification');
select is((select count(*) from public.calendar_projections p join public.lessons l on l.id=p.lesson_id where l.studio_id='e8600000-0000-4000-8000-000000000001'),0::bigint,'Historical reconciliation creates no Calendar or Meet effect');
select is((select count(*) from discovery_internal.source_write_authorizations where transaction_id=txid_current()),0::bigint,'Faults/replay/finalization leave no reusable private write proofs');
select * from finish();
rollback;
