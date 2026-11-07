begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(8);

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
select * from finish();
rollback;
