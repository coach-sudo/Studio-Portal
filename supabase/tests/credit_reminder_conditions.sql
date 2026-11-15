begin;
create extension if not exists pgtap with schema extensions;
set search_path=public,extensions;
select no_plan();

select ok(not has_function_privilege('anon','public.refresh_credit_reminder_conditions(uuid,timestamptz)','execute'),'Anonymous callers cannot evaluate reminders');
select ok(not has_function_privilege('authenticated','public.refresh_credit_reminder_conditions(uuid,timestamptz)','execute'),'Portal callers cannot evaluate private reminder conditions');
select ok(has_function_privilege('service_role','public.refresh_credit_reminder_conditions(uuid,timestamptz)','execute'),'The worker can refresh the guarded projection');
select ok(not has_table_privilege('service_role','credit_internal.reminder_conditions','insert'),'The worker cannot insert arbitrary reminder subjects');
select ok(not has_table_privilege('authenticated','credit_internal.reminder_conditions','select'),'Private reminder rows are inaccessible directly');

insert into auth.users(id,email)
values(md5('reminder-coach')::uuid,'reminder-coach@example.test'),(md5('reminder-payer')::uuid,'reminder-payer@example.test');
insert into studios(id,name,slug) values(md5('reminder-studio')::uuid,'Reminder fixture','reminder-condition-fixture');
insert into memberships(studio_id,user_id,role,display_name)
values(md5('reminder-studio')::uuid,md5('reminder-coach')::uuid,'coach','Reminder fixture coach');
insert into students(id,studio_id,full_name)
values(md5('reminder-student')::uuid,md5('reminder-studio')::uuid,'Reminder fixture student');
insert into linked_contacts(id,studio_id,student_id,user_id,email,full_name,portal_enabled,can_view_finance,can_receive_notifications,is_primary_payer)
values(md5('reminder-contact')::uuid,md5('reminder-studio')::uuid,md5('reminder-student')::uuid,md5('reminder-payer')::uuid,
 'reminder-payer@example.test','Reminder fixture payer',true,true,true,true);
insert into booking_services(id,studio_id,slug,name,category,duration_minutes,payment_policies)
values(md5('reminder-service')::uuid,md5('reminder-studio')::uuid,'reminder-service','Reminder fixture service','private',60,array['credits','pay_later']);

select set_config('request.jwt.claim.sub',md5('reminder-coach')::uuid::text,true);
create temporary table reminder_fixture as
select arrangement,command_create_manual_booking('reminder-'||arrangement,jsonb_build_object(
  'student_id',md5('reminder-student')::uuid,'service_id',md5('reminder-service')::uuid,
  'duration_minutes',60,'starts_at',now()+make_interval(days=>days),'timezone','UTC',
  'billing_arrangement',arrangement,'reason','Synthetic reminder classification'
)) as result
from (values ('credit_exception',20),('pay_later',21)) combinations(arrangement,days);

set local role service_role;
select is(refresh_credit_reminder_conditions(md5('reminder-student')::uuid)->>'open','1','Upcoming uncovered prepaid lesson produces one condition');
reset role;
select is((select count(*) from credit_internal.reminder_conditions),1::bigint,'Separate-payment lesson does not produce a condition');
select is((select contact_id from credit_internal.reminder_conditions),md5('reminder-contact')::uuid,'The condition records the authorized primary payer');
select is((select next_due_at from credit_internal.reminder_conditions),now(),'An actionable first reminder is due immediately');
select is(refresh_credit_reminder_conditions(md5('reminder-student')::uuid,now()+interval '1 hour')->>'open','1','Repeated evaluation keeps an open condition');
select is((select count(*) from credit_internal.reminder_conditions),1::bigint,'Repeated evaluation has the same condition identity');
select is((select next_due_at from credit_internal.reminder_conditions),now(),'Evaluation does not postpone the pending first reminder');
update credit_internal.reminder_conditions set last_delivery_at=now();
select refresh_credit_reminder_conditions(md5('reminder-student')::uuid,now()+interval '1 day');
select is((select next_due_at from credit_internal.reminder_conditions),now()+interval '72 hours','An acknowledged delivery makes the next reminder due in exactly three days');
select ok((select next_due_at>now()+interval '71 hours' from credit_internal.reminder_conditions),'A follow-up is not due early');

update linked_contacts set can_receive_notifications=false where id=md5('reminder-contact')::uuid;
select is(refresh_credit_reminder_conditions(md5('reminder-student')::uuid)->>'blocked','1','Recipient permission is rechecked');
select is((select status_reason from credit_internal.reminder_conditions),'missing_recipient','Missing authorized routing remains available for review');
select ok((select contact_id is null and next_due_at is null from credit_internal.reminder_conditions),'Revocation clears the addressable recipient and due time');
update linked_contacts set can_receive_notifications=true where id=md5('reminder-contact')::uuid;
update bookings set payment_status='processing'
 where id=(select (result#>>'{resource,id}')::uuid from reminder_fixture where arrangement='credit_exception');
select refresh_credit_reminder_conditions(md5('reminder-student')::uuid);
select is((select status_reason from credit_internal.reminder_conditions),'processing','A processing purchase or payment state suppresses the reminder');
update bookings set payment_status='not_required'
 where id=(select (result#>>'{resource,id}')::uuid from reminder_fixture where arrangement='credit_exception');

insert into packages(id,student_id,name)
values(md5('reminder-legacy-lot')::uuid,md5('reminder-student')::uuid,'Legacy lot under review');
insert into credit_internal.reconciliation_cases(student_id,package_id,finding,evidence)
values(md5('reminder-student')::uuid,md5('reminder-legacy-lot')::uuid,'missing_issuance','{"present":true}');
select refresh_credit_reminder_conditions(md5('reminder-student')::uuid);
select is((select status_reason from credit_internal.reminder_conditions),'studio_review','A disputed balance suppresses credit requests');
update credit_internal.reconciliation_cases set status='dismissed'
 where package_id=md5('reminder-legacy-lot')::uuid;
select refresh_credit_reminder_conditions(md5('reminder-student')::uuid);
select is((select status from credit_internal.reminder_conditions),'open','Revalidated data can reopen an actionable condition');
select is((select next_due_at from credit_internal.reminder_conditions),now()+interval '72 hours','Reopening retains the existing follow-up interval');
select command_grant_student_credits(md5('reminder-student')::uuid,'reminder-renewal-fixture',jsonb_build_object(
  'quantity',1,'kind','adjustment','reason','Synthetic issued credit',
  'customTerms',jsonb_build_object('serviceId',md5('reminder-service')::uuid,'durationMinutes',60)),
  md5('reminder-coach')::uuid);
select reserve_student_lesson_credit((result->>'lessonId')::uuid,md5('reminder-student')::uuid,null,true)
 from reminder_fixture where arrangement='credit_exception';
select refresh_credit_reminder_conditions(md5('reminder-student')::uuid);
select is((select status from credit_internal.reminder_conditions),'resolved','An authoritative reservation resolves the shortage');
select ok((select next_due_at is null and resolved_at is not null from credit_internal.reminder_conditions),'Resolved conditions carry no pending due time');
select is((select count(*) from outbox_messages where event_key like 'credits.reminder%'),0::bigint,'Condition evaluation does not queue an external message');
create temporary table cancel_fixture as
select command_create_manual_booking('reminder-cancel-fixture',jsonb_build_object(
  'student_id',md5('reminder-student')::uuid,'service_id',md5('reminder-service')::uuid,
  'duration_minutes',60,'starts_at',now()+interval '22 days','timezone','UTC',
  'billing_arrangement','credit_exception','reason','Synthetic cancellation case')) result;
select is(refresh_credit_reminder_conditions(md5('reminder-student')::uuid)->>'open','1',
 'A second uncovered lesson opens its own condition');
update bookings set status='cancelled' where id=(select (result#>>'{resource,id}')::uuid from cancel_fixture);
select is(refresh_credit_reminder_conditions(md5('reminder-student')::uuid)->>'noLongerActionable','1',
 'Cancellation retires the remaining condition');
select is((select count(*) from credit_internal.reminder_conditions where status='open'),0::bigint,
 'The canceled booking leaves no active demand');
select * from finish();
rollback;
