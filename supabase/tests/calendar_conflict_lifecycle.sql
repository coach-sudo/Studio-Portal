begin;
create extension if not exists pgtap with schema extensions;
select plan(14);

insert into auth.users(id,email) values ('93300000-0000-4000-8000-000000000001','e2e-calendar-hold@example.test');
insert into studios(id,name,slug) values ('93300000-0000-4000-8000-000000000002','Calendar hold fixture','e2e-calendar-hold');
insert into memberships(studio_id,user_id,role,display_name)
values ('93300000-0000-4000-8000-000000000002','93300000-0000-4000-8000-000000000001','coach','Fixture coach');
insert into lessons(id,studio_id,topic,starts_at,ends_at,status,location_type,location_label,source_provider) values
 ('93300000-0000-4000-8000-000000000003','93300000-0000-4000-8000-000000000002','Completion fixture',now()-interval '2 days',now()-interval '2 days'+interval '1 hour','scheduled','in_person','Studio','studio'),
 ('93300000-0000-4000-8000-000000000004','93300000-0000-4000-8000-000000000002','Change fixture',now()+interval '2 days',now()+interval '2 days 1 hour','scheduled','in_person','Studio','studio'),
 ('93300000-0000-4000-8000-000000000005','93300000-0000-4000-8000-000000000002','Independent fixture',now()+interval '5 days',now()+interval '5 days 1 hour','scheduled','in_person','Studio','studio');
insert into calendar_projections(lesson_id,status,last_error,attempts,external_event_id) values
 ('93300000-0000-4000-8000-000000000003','failed','synchronization_review_required',45,'hold-completed-event'),
 ('93300000-0000-4000-8000-000000000004','failed','synchronization_review_required',2,'hold-changed-event'),
 ('93300000-0000-4000-8000-000000000005','queued',null,0,null);
insert into sync_conflicts(studio_id,entity_type,entity_id,source,internal_version,external_payload)
select studio_id,'lesson',id,'google_calendar',version,'{}' from lessons where id in
 ('93300000-0000-4000-8000-000000000003','93300000-0000-4000-8000-000000000004');

set local role authenticated;
set local request.jwt.claim.sub='93300000-0000-4000-8000-000000000001';
select is(public.command_complete_lesson('93300000-0000-4000-8000-000000000003',1,'Fixture completion','hold-complete','hold-complete')->'resource'->>'status','completed','Lesson completion succeeds while Calendar is held');
reset role;
select is((select status from calendar_projections where external_event_id='hold-completed-event'),'queued','Completion exercises the queue reset');

create temporary table hold_change_request as
select jsonb_build_object('lessonId','93300000-0000-4000-8000-000000000004','action','reschedule','scope','occurrence',
  'startsAt',now()+interval '3 days','endsAt',now()+interval '3 days 1 hour','reason','Fixture reschedule','wholeClass',false,'useCredit',false) value;
update hold_change_request set value=value||jsonb_build_object('reviewToken',public.preview_lesson_occurrence_change('93300000-0000-4000-8000-000000000001',value)->>'reviewToken');
select throws_ok($$select public.execute_lesson_occurrence_change('93300000-0000-4000-8000-000000000001','hold-reschedule',value) from hold_change_request$$,
  'P0001','REVIEW_REQUIRED: One or more occurrences require review.','Reviewed reschedule still requires conflict review');
create temporary table hold_initial_claims as select * from public.claim_calendar_projections(25);
select is((select count(*) from hold_initial_claims where lesson->>'studio_id'='93300000-0000-4000-8000-000000000002'),1::bigint,'Only the unrelated projection can be claimed');
select is((select count(*) from hold_initial_claims where lesson->>'id'='93300000-0000-4000-8000-000000000005'),1::bigint,'Unrelated synchronization continues');

update hold_change_request set value=(value-'reviewToken'-'startsAt'-'endsAt')||'{"action":"cancel","reason":"Fixture cancellation"}';
update hold_change_request set value=value||jsonb_build_object('reviewToken',public.preview_lesson_occurrence_change('93300000-0000-4000-8000-000000000001',value)->>'reviewToken');
select throws_ok($$select public.execute_lesson_occurrence_change('93300000-0000-4000-8000-000000000001','hold-cancel',value) from hold_change_request$$,
  'P0001','REVIEW_REQUIRED: One or more occurrences require review.','Reviewed cancellation still requires conflict review');
update calendar_projections set status='projecting',last_error=null,claim_until=now()-interval '1 minute'
where external_event_id='hold-changed-event';
select is((select count(*) from public.claim_calendar_projections(25) where lesson->>'studio_id'='93300000-0000-4000-8000-000000000002'),0::bigint,'Open conflicts and active leases prevent another claim');
select is((select sum(attempts) from calendar_projections where external_event_id in ('hold-completed-event','hold-changed-event')),47::bigint,'Lifecycle transitions do not increment held attempts');
select is((select count(*) from sync_conflicts where studio_id='93300000-0000-4000-8000-000000000002' and status='open'),2::bigint,'Both original conflicts are still open');

update sync_conflicts set status='accepted_internal',resolved_at=now()
where entity_id='93300000-0000-4000-8000-000000000004';
create temporary table hold_resolved_claim as select * from public.claim_calendar_projections(25) where lesson->>'id'='93300000-0000-4000-8000-000000000004';
select is((select count(*) from hold_resolved_claim),1::bigint,'A resolved conflict makes the latest projection eligible');
select is((select lesson->>'status' from hold_resolved_claim),'scheduled','Claim carries the current lesson state');
select ok((select public.calendar_claim_current((projection->>'id')::uuid,(projection->>'claim_token')::uuid) from hold_resolved_claim),'Resolved work passes the current-lease fence');
select ok((select public.finish_calendar_projection((projection->>'id')::uuid,(projection->>'claim_token')::uuid,'{"id":"hold-changed-event"}') from hold_resolved_claim),'Completion preserves the provider event identity');
select is((select count(*) from public.claim_calendar_projections(25) where lesson->>'studio_id'='93300000-0000-4000-8000-000000000002'),0::bigint,'Acknowledged projection cannot be claimed again');

select * from finish();
rollback;
