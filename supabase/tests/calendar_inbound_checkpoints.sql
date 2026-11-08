begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(34);

insert into public.studios (id, name, slug)
values ('73ff1894-792a-4554-8839-3b8e8477525e', 'Calendar checkpoint fixture', 'calendar-checkpoint-fixture');
select is(public.calendar_inbound_checkpoint('73ff1894-792a-4554-8839-3b8e8477525e','test-calendar')->>'revision','0','New calendar starts a full scan');
select is(public.commit_calendar_inbound_page(
  '73ff1894-792a-4554-8839-3b8e8477525e','test-calendar',0,
  '[{"id":"personal","status":"confirmed","transparency":"transparent"}]', 'page-2',null,false
)->>'committed','true','First page and observations commit together');
select is(public.calendar_inbound_checkpoint('73ff1894-792a-4554-8839-3b8e8477525e','test-calendar')->>'pageToken','page-2','Interrupted scan resumes the saved page');
select is(public.commit_calendar_inbound_page(
  '73ff1894-792a-4554-8839-3b8e8477525e','test-calendar',0,'[]',null,'obsolete',false
)->>'committed','false','An overlapping worker cannot overwrite the checkpoint');
select is(public.commit_calendar_inbound_page(
  '73ff1894-792a-4554-8839-3b8e8477525e','test-calendar',1,
  '[{"id":"busy","status":"confirmed","transparency":"opaque"}]',null,'cursor',false
)->>'committed','true','Final page records a durable cursor');
select results_eq(
  $$select disposition from calendar_inbound.events where calendar_id='test-calendar' order by event_id$$,
  $$values ('busy_only'::text),('personal'::text)$$,
  'Unlinked events are classified without creating lessons'
);
select ok(
  not has_function_privilege('authenticated','public.commit_calendar_inbound_page(uuid,text,bigint,jsonb,text,text,boolean)','execute')
  and has_function_privilege('service_role','public.commit_calendar_inbound_page(uuid,text,bigint,jsonb,text,text,boolean)','execute'),
  'Checkpoint writes require service role'
);
select is(public.calendar_inbound_checkpoint('73ff1894-792a-4554-8839-3b8e8477525e','other-calendar')->>'syncToken',null,'Calendar cursors are independent');

insert into public.students(id,studio_id,full_name)
  values ('73ff1894-792a-4554-8839-3b8e84775260','73ff1894-792a-4554-8839-3b8e8477525e','Calendar fixture learner');
insert into public.lessons(id,studio_id,topic,starts_at,ends_at,status,location_type,location_label,source_provider) values
  ('73ff1894-792a-4554-8839-3b8e84775261','73ff1894-792a-4554-8839-3b8e8477525e','Convergent fixture',now()+interval '2 days',now()+interval '2 days 1 hour','scheduled','in_person','Studio','studio'),
  ('73ff1894-792a-4554-8839-3b8e84775262','73ff1894-792a-4554-8839-3b8e8477525e','Missing fixture',now()+interval '5 days',now()+interval '5 days 1 hour','scheduled','in_person','Studio','studio'),
  ('73ff1894-792a-4554-8839-3b8e84775263','73ff1894-792a-4554-8839-3b8e8477525e','Unrelated fixture',now()+interval '7 days',now()+interval '7 days 1 hour','scheduled','in_person','Studio','studio');
update public.lessons set student_id='73ff1894-792a-4554-8839-3b8e84775260' where id='73ff1894-792a-4554-8839-3b8e84775261';
insert into public.calendar_projections(lesson_id,status,projected_version,external_event_id,external_version) values
  ('73ff1894-792a-4554-8839-3b8e84775261','projected',1,'convergent-event','prior-etag'),
  ('73ff1894-792a-4554-8839-3b8e84775262','projected',1,'missing-event','prior-etag'),
  ('73ff1894-792a-4554-8839-3b8e84775263','projected',1,'unrelated-event','prior-etag');
create temporary view checkpoint_fixture_events as
select p.external_event_id as event_id, jsonb_build_object('id',p.external_event_id,'etag',p.external_version,
  'status','confirmed','startsAt',l.starts_at,'endsAt',l.ends_at) as event
from public.lessons l join public.calendar_projections p on p.lesson_id=l.id
where l.studio_id='73ff1894-792a-4554-8839-3b8e8477525e';
create temporary table checkpoint_original_events as select * from checkpoint_fixture_events;
select is(public.commit_calendar_inbound_page('73ff1894-792a-4554-8839-3b8e8477525e','test-calendar',2,
  (select jsonb_agg(event) from checkpoint_original_events),null,'mapped-cursor',false)->>'review','0','Initial ETags establish three exact mappings');
select is(public.command_change_lesson_state('73ff1894-792a-4554-8839-3b8e84775261',1,'reschedule',
  now()+interval '3 days',now()+interval '3 days 1 hour',true)->'lesson'->>'version','2','Portal reschedule increments the lesson version');
update public.calendar_projections set status='failed',attempts=1,last_error='calendar_external_change_requires_review',next_attempt_at=now()+interval '1 hour'
  where external_event_id='convergent-event';
create temporary table checkpoint_converged as
select event||'{"etag":"converged-etag"}'::jsonb as event from checkpoint_fixture_events where event_id='convergent-event';
select is(public.commit_calendar_inbound_page('73ff1894-792a-4554-8839-3b8e8477525e','test-calendar',3,
  (select jsonb_agg(event) from checkpoint_converged),null,'converged-cursor',false),
  '{"committed":true,"imported":0,"review":0}'::jsonb,'Convergent timing acknowledges the new provider revision without another lesson edit');
select results_eq(
  $$select external_version,projected_version,attempts from public.calendar_projections where external_event_id='convergent-event'$$,
  $$values ('converged-etag'::text,1,1)$$,'Acknowledgement leaves the pending projection and retry history intact');
select is(public.commit_calendar_inbound_page('73ff1894-792a-4554-8839-3b8e8477525e','test-calendar',4,
  (select jsonb_agg(event) from checkpoint_converged),null,'replayed-cursor',false)->>'imported','0','Replayed convergence is a no-op for the canonical lesson');
create temporary table checkpoint_converged_claim as
select projection from public.claim_calendar_projections(25) where projection->>'external_event_id'='convergent-event';
select is((select projection->>'external_version' from checkpoint_converged_claim),'converged-etag','The worker reclaims the same event with the acknowledged revision');
select ok((select public.finish_calendar_projection((projection->>'id')::uuid,(projection->>'claim_token')::uuid,
  '{"id":"convergent-event","etag":"outbound-etag"}') from checkpoint_converged_claim),'Ordinary fenced completion projects the queued version');
select is((select version from public.lessons where id='73ff1894-792a-4554-8839-3b8e84775261'),2,'The single portal reschedule remains the only lesson version change');
select is((select count(*) from public.claim_calendar_projections(25) where projection->>'external_event_id'='convergent-event'),0::bigint,'Completion leaves no duplicate projection to claim');

update public.calendar_projections set status='queued' where external_event_id in ('missing-event','unrelated-event');
create temporary table checkpoint_open_claims as
select projection from public.claim_calendar_projections(25) where projection->>'external_event_id' in ('missing-event','unrelated-event');
select is(public.commit_calendar_inbound_page('73ff1894-792a-4554-8839-3b8e8477525e','test-calendar',5,'[]',null,null,true)->>'committed',
  'true','Expired cursor begins a replacement scan');
select is(public.commit_calendar_inbound_page('73ff1894-792a-4554-8839-3b8e8477525e','test-calendar',6,
  (select jsonb_agg(event) from checkpoint_converged),'replacement-page',null,false)->>'review','0','A partial scan cannot declare a mapped event missing');
select ok((select public.calendar_claim_current((projection->>'id')::uuid,(projection->>'claim_token')::uuid) from checkpoint_open_claims
  where projection->>'external_event_id'='missing-event'),'The existing claim is valid until absence is established');
select is(public.commit_calendar_inbound_page('73ff1894-792a-4554-8839-3b8e8477525e','test-calendar',7,
  (select jsonb_agg(event) from checkpoint_original_events where event_id='unrelated-event'),null,'replacement-cursor',false)->>'review',
  '1','The final page records one mapped absence');
select results_eq(
  $$select c.status,c.external_payload->>'id',c.external_payload->>'reason',c.external_payload->>'calendarId'
    from public.sync_conflicts c where c.entity_id='73ff1894-792a-4554-8839-3b8e84775262'$$,
  $$values ('open'::text,'missing-event'::text,'mapped_event_missing_from_full_scan'::text,'test-calendar'::text)$$,
  'The committed checkpoint has an actionable conflict with exact calendar and event identity');
select is(public.calendar_inbound_checkpoint('73ff1894-792a-4554-8839-3b8e8477525e','test-calendar')->>'syncToken',
  'replacement-cursor','The replacement cursor commits with the conflict');
select ok(not (select public.calendar_claim_current((projection->>'id')::uuid,(projection->>'claim_token')::uuid) from checkpoint_open_claims
  where projection->>'external_event_id'='missing-event'),'The open conflict fences an already-issued claim');
select ok((select public.finish_calendar_projection((projection->>'id')::uuid,(projection->>'claim_token')::uuid,
  '{"id":"unrelated-event","etag":"unrelated-etag"}') from checkpoint_open_claims where projection->>'external_event_id'='unrelated-event'),
  'Unrelated synchronization continues during the hold');
select ok(not (select public.finish_calendar_projection((projection->>'id')::uuid,(projection->>'claim_token')::uuid,'{}')
  from checkpoint_open_claims where projection->>'external_event_id'='missing-event'),'A late completion cannot clear the hold');
update public.calendar_projections set next_attempt_at=now() where external_event_id='missing-event';
select is((select count(*) from public.claim_calendar_projections(25) where projection->>'external_event_id'='missing-event'),
  0::bigint,'The missing projection cannot be reclaimed even when its backoff ends');
select is(public.commit_calendar_inbound_page('73ff1894-792a-4554-8839-3b8e8477525e','test-calendar',7,
  '[]',null,'obsolete-cursor',false)->>'committed','false','Replaying the final page with its old revision cannot repeat the hold');
select is(public.commit_calendar_inbound_page('73ff1894-792a-4554-8839-3b8e8477525e','test-calendar',8,
  (select jsonb_agg(event) from checkpoint_original_events where event_id='missing-event'),null,'restored-cursor',false)->>'imported',
  '0','Reappearance preserves the original mapping without another lesson change');
select is((select count(*) from public.sync_conflicts where entity_id='73ff1894-792a-4554-8839-3b8e84775262' and status='open'),
  1::bigint,'Reappearance leaves the same conflict open for coach review');
select results_eq(
  $$select l.version,l.status::text,p.attempts,e.lesson_id from public.lessons l join public.calendar_projections p on p.lesson_id=l.id
    join calendar_inbound.events e on e.event_id=p.external_event_id where p.external_event_id='missing-event'$$,
  $$values (1,'scheduled'::text,1,'73ff1894-792a-4554-8839-3b8e84775262'::uuid)$$,
  'Missing-event review preserves lesson history, event mapping and attempts');
update public.sync_conflicts set status='accepted_internal',resolved_at=now() where entity_id='73ff1894-792a-4554-8839-3b8e84775262';
create temporary table checkpoint_recovered_claim as
select projection from public.claim_calendar_projections(25) where projection->>'external_event_id'='missing-event';
select is((select projection->>'external_version' from checkpoint_recovered_claim),'prior-etag','After review the recovered event is eligible with its original ETag');
select ok((select public.finish_calendar_projection((projection->>'id')::uuid,(projection->>'claim_token')::uuid,
  '{"id":"missing-event","etag":"recovered-etag"}') from checkpoint_recovered_claim),'Recovered work completes without replacing the event identity');
select is((select count(*) from public.lessons where studio_id='73ff1894-792a-4554-8839-3b8e8477525e'),3::bigint,'Recovery creates no extra lessons');
select * from finish();
rollback;
