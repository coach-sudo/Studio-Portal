begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

insert into auth.users(id,email) values
  ('f0540000-0000-4000-8000-000000000001','coach-health@example.test'),
  ('f0540000-0000-4000-8000-000000000002','other-health@example.test'),
  ('f0540000-0000-4000-8000-000000000003','learner-health@example.test');
insert into public.studios(id,name,slug) values
  ('f0540000-0000-4000-8000-000000000010','Health acceptance','e2e-health'),
  ('f0540000-0000-4000-8000-000000000020','Health other studio','e2e-health-other');
insert into public.memberships(studio_id,user_id,role,display_name) values
  ('f0540000-0000-4000-8000-000000000010','f0540000-0000-4000-8000-000000000001','coach','Synthetic Coach'),
  ('f0540000-0000-4000-8000-000000000020','f0540000-0000-4000-8000-000000000002','coach','Other Coach'),
  ('f0540000-0000-4000-8000-000000000010','f0540000-0000-4000-8000-000000000003','student','Synthetic Learner');
insert into public.students(id,studio_id,user_id,full_name,email) values
  ('f0540000-0000-4000-8000-000000000011','f0540000-0000-4000-8000-000000000010','f0540000-0000-4000-8000-000000000003','Synthetic learner','learner-health@example.test');
insert into public.lessons(id,studio_id,student_id,topic,starts_at,ends_at,status,location_type,location_label) values
  ('f0540000-0000-4000-8000-000000000012','f0540000-0000-4000-8000-000000000010','f0540000-0000-4000-8000-000000000011',
    'Synthetic Calendar lesson',now()+interval '1 day',now()+interval '25 hours','scheduled','virtual','Online');
insert into public.calendar_projections(id,lesson_id,external_event_id,status,next_attempt_at,attempts,last_error) values
  ('f0540000-0000-4000-8000-000000000013','f0540000-0000-4000-8000-000000000012','existing-event','failed',now()+interval '1 hour',2,'calendar_write_503');
insert into public.outbox_messages(id,studio_id,student_id,channel,recipient,subject,body,status,attempts,last_error,event_key,delivery_provider_started_at) values
  ('f0540000-0000-4000-8000-000000000014','f0540000-0000-4000-8000-000000000010','f0540000-0000-4000-8000-000000000011',
    'email','private@example.test','Sensitive subject','Sensitive body','failed',2,'delivery_preflight_failed','booking.confirmed.student',null),
  ('f0540000-0000-4000-8000-000000000015','f0540000-0000-4000-8000-000000000010','f0540000-0000-4000-8000-000000000011',
    'email','private@example.test','Sensitive subject','Sensitive body','failed',2,'private provider token','booking.confirmed.student',now());
insert into public.studio_invoices(id,studio_id,student_id,number,status,currency,issue_date,due_date,total_minor,items,branding,recipient)
values ('f0540000-0000-4000-8000-000000000016','f0540000-0000-4000-8000-000000000010','f0540000-0000-4000-8000-000000000011',
  'HEALTH-INVOICE','open','USD',current_date-2,current_date+4,6000,'[]','{}','{}');
insert into public.webhook_events(id,provider,event_type,status,payload,processed_at)
values ('evt_healthKnown','stripe','checkout.session.completed','failed',
  '{"data":{"object":{"payment_status":"paid","metadata":{"studio_invoice_id":"f0540000-0000-4000-8000-000000000016","secret":"private payload"}}}}',now()),
  ('evt_healthUnattributed','stripe','checkout.session.completed','failed','{"data":{"object":{"metadata":{"secret":"private payload"}}}}',now());

create function pg_temp.studio() returns uuid language sql immutable as $$ select 'f0540000-0000-4000-8000-000000000010'::uuid $$;
create function pg_temp.actor() returns uuid language sql immutable as $$ select 'f0540000-0000-4000-8000-000000000001'::uuid $$;
create function pg_temp.read_health() returns jsonb language sql as $$ select public.studio_health_read(pg_temp.studio()) $$;
create function pg_temp.issue(p_category text) returns uuid language sql as $$
  select (j->>'id')::uuid from jsonb_array_elements(pg_temp.read_health()->'issues') j where j->>'category'=p_category
$$;
create function pg_temp.snapshot() returns jsonb language sql as $$
  select jsonb_agg(jsonb_build_object('service',s,'complete',true,'state','healthy',
    'problems', public.studio_health_evidence(pg_temp.studio(),s,true)->'problems'))
  from unnest(array['calendar','email','stripe','access']) s
$$;
create function pg_temp.recheck() returns boolean language plpgsql as $$
declare token uuid;
begin
  update studio_health_internal.checkpoints set checked_at=now()-interval '5 minutes' where studio_id=pg_temp.studio();
  token:=public.studio_health_claim(pg_temp.studio(),false);
  return public.studio_health_finish(pg_temp.studio(),token,false,pg_temp.snapshot());
end $$;

select ok(not has_function_privilege('anon','public.studio_health_read(uuid,uuid)','execute'),'Anonymous SQL callers cannot read');
select ok(not has_function_privilege('authenticated','public.studio_health_evidence(uuid,text,boolean)','execute'),'Authenticated clients cannot query evidence');
select ok(not has_function_privilege('authenticated','public.studio_health_retry(uuid,uuid,uuid,uuid,text)','execute'),'Authenticated clients cannot submit recovery RPC directly');
select ok(not has_schema_privilege('authenticated','studio_health_internal','usage'),'Observations and audits are server-only');
select ok(public.studio_health_claim(pg_temp.studio(),false) is not null,'One check acquires the studio lease');
select is(public.studio_health_claim(pg_temp.studio(),false),null::uuid,'Overlapping manual check is fenced');
select is(public.studio_health_claim(pg_temp.studio(),true),null::uuid,'Automatic check shares the same lease');
select is(public.studio_health_finish(pg_temp.studio(),gen_random_uuid(),false,'[]'),false,'An unrelated lease cannot publish results');
update studio_health_internal.checkpoints set lease_until=now()-interval '1 second' where studio_id=pg_temp.studio();
select ok(pg_temp.recheck(),'Authorized observation writes sanitized issues');
select is(jsonb_array_length(pg_temp.read_health()->'issues'),4,'Records one projection, two email failures and a studio-linked Stripe issue');
select ok(position('private' in pg_temp.read_health()::text)=0,'No raw provider error, address, message text or unscoped payload');
select is(jsonb_array_length(public.studio_health_read('f0540000-0000-4000-8000-000000000020')->'issues'),0,'Other studio has no issue data');
select is(jsonb_array_length(public.studio_health_evidence('f0540000-0000-4000-8000-000000000020','stripe',false)->'problems'),0,'Unattributed and other-studio Stripe evidence excluded');
select ok(pg_temp.recheck(),'Repeated observation succeeds');
select is(jsonb_array_length(pg_temp.read_health()->'issues'),4,'Repeat observations deduplicate');
select is((select occurrences from studio_health_internal.issues where id=pg_temp.issue('calendar_sync')),1,'An unchanged failure counts once');
select throws_ok(format('select public.studio_health_retry(%L,%L,%L,gen_random_uuid(),%L)',pg_temp.studio(),
  'f0540000-0000-4000-8000-000000000003',pg_temp.issue('calendar_sync'),'calendar'),'P0001','FORBIDDEN','Student cannot queue retries');
select throws_ok(format('select public.studio_health_retry(%L,%L,%L,gen_random_uuid(),%L)',pg_temp.studio(),
  'f0540000-0000-4000-8000-000000000002',pg_temp.issue('calendar_sync'),'calendar'),'P0001','FORBIDDEN','Other studio coach cannot queue retries');
select is(public.studio_health_retry(pg_temp.studio(),pg_temp.actor(),pg_temp.issue('email_ambiguous'),gen_random_uuid(),'email'),'not_eligible','Ambiguous Gmail submission cannot be queued');
select is(public.studio_health_retry(pg_temp.studio(),pg_temp.actor(),pg_temp.issue('email_preflight'),gen_random_uuid(),'email'),'queued','Proven preflight failure retries the same outbox record');
select is(public.studio_health_retry(pg_temp.studio(),pg_temp.actor(),pg_temp.issue('email_preflight'),gen_random_uuid(),'email'),'recent_retry','Replay does not queue email again');
select is(public.studio_health_retry(pg_temp.studio(),pg_temp.actor(),pg_temp.issue('calendar_sync'),gen_random_uuid(),'calendar'),'queued','Eligible projection queued');
select is(public.studio_health_retry(pg_temp.studio(),pg_temp.actor(),pg_temp.issue('calendar_sync'),gen_random_uuid(),'calendar'),'recent_retry','Duplicate recovery fenced');
select is((select external_event_id from public.calendar_projections where id='f0540000-0000-4000-8000-000000000013'),'existing-event','Existing Google event identity preserved');
select is((select count(*)::int from public.audit_events where studio_id=pg_temp.studio() and action like 'system_health.retry_%'),2,'Each successful command writes one durable audit');
select is((select count(*)::int from public.claim_booking_reminders(50) where id='f0540000-0000-4000-8000-000000000015'),0,'Scheduled claimant cannot repeat an uncertain provider submission');

update public.calendar_projections set status='projected',last_error=null,last_projected_at=now()
  where id='f0540000-0000-4000-8000-000000000013';
update public.outbox_messages set status='sent',last_error=null where id='f0540000-0000-4000-8000-000000000014';
select ok(pg_temp.recheck(),'Sources are observed after recovery');
select is((select evidence->>'resolution' from studio_health_internal.issues where id=pg_temp.issue('calendar_sync')),'confirmed','Actual Calendar success resolves the incident');
select is((select evidence->>'resolution' from studio_health_internal.issues where id=pg_temp.issue('email_preflight')),'confirmed','Gmail acceptance resolves the matching incident');
update public.calendar_projections set status='failed',last_error='calendar_write_503',attempts=3
  where id='f0540000-0000-4000-8000-000000000013';
select ok(pg_temp.recheck(),'Recurring failure is observed');
select is((select occurrences from studio_health_internal.issues where id=pg_temp.issue('calendar_sync')),2,'Recurrence reopens the same issue');
select is((select resolved_at from studio_health_internal.issues where id=pg_temp.issue('calendar_sync')),null::timestamptz,'Recurrence is active');

select * from finish();
rollback;
