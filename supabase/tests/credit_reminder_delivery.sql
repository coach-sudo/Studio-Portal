begin;
create extension if not exists pgtap with schema extensions;
set search_path=public,extensions;
select no_plan();

insert into auth.users(id,email) values
 (md5('dispatch-coach')::uuid,'dispatch-coach@example.test'),(md5('dispatch-student-user')::uuid,'dispatch-student@example.test'),
 (md5('dispatch-payer')::uuid,'dispatch-payer@example.test'),(md5('dispatch-outside')::uuid,'dispatch-outside@example.test');
insert into studios(id,name,slug,timezone)
values(md5('dispatch-studio')::uuid,'Dispatch fixture','credit-dispatch-test','UTC');
insert into memberships(studio_id,user_id,role,display_name)
values(md5('dispatch-studio')::uuid,md5('dispatch-coach')::uuid,'coach','Dispatch coach');
insert into students(id,studio_id,user_id,full_name,email,portal_enabled,is_minor,notification_preferences)
values(md5('dispatch-student')::uuid,md5('dispatch-studio')::uuid,md5('dispatch-student-user')::uuid,
  'Jordan Student','dispatch-student@example.test',true,false,'{"packageBalance":true}');
insert into linked_contacts(id,studio_id,student_id,user_id,email,full_name,portal_enabled,can_view_finance,can_receive_notifications,is_primary_payer)
values(md5('dispatch-contact')::uuid,md5('dispatch-studio')::uuid,md5('dispatch-student')::uuid,
  md5('dispatch-payer')::uuid,'dispatch-payer@example.test','Morgan Payer',true,true,true,true);
insert into booking_services(id,studio_id,slug,name,category,duration_minutes,payment_policies)
values(md5('dispatch-service')::uuid,md5('dispatch-studio')::uuid,'dispatch-service','Acting','private',60,array['credits','pay_later']);

select set_config('request.jwt.claim.sub',md5('dispatch-coach')::uuid::text,true);
create temporary table issued as
select (command_grant_student_credits(md5('dispatch-student')::uuid,'dispatch-credit-issue',
  jsonb_build_object('quantity',2,'kind','adjustment','reason','Synthetic typed credit',
    'customTerms',jsonb_build_object('serviceId',md5('dispatch-service')::uuid,'durationMinutes',60)),
  md5('dispatch-coach')::uuid)#>>'{package,id}')::uuid lot;
create temporary table scheduled as
select command_create_manual_booking('dispatch-credit-booking',jsonb_build_object(
  'student_id',md5('dispatch-student')::uuid,'service_id',md5('dispatch-service')::uuid,
  'duration_minutes',60,'starts_at',now()+interval '30 days','timezone','UTC',
  'billing_arrangement','credits','reason','Synthetic prepaid classification')) result;

create function pg_temp.cmd(p_action text,p_value jsonb default '{}') returns jsonb language sql as $$
  select public.manage_credit_reminders(md5('dispatch-student')::uuid,p_action,p_value)
$$;
select is(credit_internal.reminder_policy(md5('dispatch-studio')::uuid,md5('dispatch-student')::uuid,(select lot from issued))->>'threshold',
  '2','Default low-credit threshold is two');
select lives_ok($$select pg_temp.cmd('save_settings',jsonb_build_object('scope','package','targetId',(select lot from issued),'threshold',0))$$,
  'Coach sets a package threshold');
select is(scan_credit_reminders(30)->>'staged','0','Package override can suppress an otherwise low lot');
select lives_ok($$select pg_temp.cmd('save_settings',jsonb_build_object('scope','student','targetId',md5('dispatch-student')::uuid,'threshold',1,'studentCopy',true))$$,
  'Coach sets a student override and an optional copy');
select is(pg_temp.cmd('preview_template','{"kind":"low_credit","subject":"Update for {{student_first_name}}","body":"Available {{available_credits}}"}')->>'subject',
 'Update for Jordan','Preview uses representative values');
select throws_ok($$select pg_temp.cmd('preview_template','{"kind":"low_credit","subject":"Update","body":"{{private_notes}}"}')$$,
 'P0001','VALIDATION_FAILED: Unknown reminder variable private_notes.','Template rejects private or unsupported fields');
select is(pg_temp.cmd('save_template','{"kind":"low_credit","version":0,"active":true,"subject":"Update for {{student_first_name}}","body":"Available {{available_credits}}"}')->>'version',
 '1','Saving creates an immutable version');
select throws_ok($$select pg_temp.cmd('save_template','{"kind":"low_credit","version":0,"active":true,"subject":"Update","body":"Please review"}')$$,
 'P0001','VERSION_CONFLICT: Reload the latest template before saving.','A stale template cannot overwrite a newer one');
select is(jsonb_array_length(pg_temp.cmd('configuration')->'history'),1,'Coach sees template version history');

insert into package_definitions(id,studio_id,name,session_count,session_duration_minutes,price_minor,eligible_service_ids)
values(md5('dispatch-pending-def')::uuid,md5('dispatch-studio')::uuid,'Pending renewal package',3,60,8000,array[md5('dispatch-service')::uuid]);
insert into packages(id,student_id,definition_id,name,stripe_price_id,credit_quantity)
values(md5('dispatch-pending-lot')::uuid,md5('dispatch-student')::uuid,md5('dispatch-pending-def')::uuid,'Pending renewal package','price_synthetic_checkout',3);
select is(scan_credit_reminders(30)->>'staged','0','A compatible checkout without verified issuance suppresses the low-credit notice');
select is((select status_reason from credit_internal.reminder_conditions where low_package_id=(select lot from issued)),
  'processing','Coach can see remaining processing for a compatible package');
delete from packages where id=md5('dispatch-pending-lot')::uuid;
select is(scan_credit_reminders(30)->>'staged','4','First cycle creates both channels for the payer and authorized student copy');
select is(scan_credit_reminders(30)->>'staged','0','Replaying the scanner does not duplicate notifications');
select is((select available_credits from credit_internal.reminder_conditions where condition_type='low_credit'),1,
 'Low reminder uses available credits after the valid reservation');
select is((select count(*) from credit_internal.reminder_conditions where condition_type='uncovered_lesson'),0::bigint,
 'The covered lesson is not treated as a credit shortage');
select is((select subject from credit_internal.reminder_deliveries where channel='portal' and not is_copy),'Update for Jordan',
 'Portal delivery retains the rendered template');
select is((select subject from credit_internal.reminder_deliveries where channel='portal' and is_copy),'Review your lesson credits',
 'Student copy excludes the billing template and package counts');

select set_config('request.jwt.claim.sub',md5('dispatch-payer')::uuid::text,true);
set local role authenticated;
select is(jsonb_array_length(credit_reminder_history(array[md5('dispatch-student')::uuid])),1,'Designated guardian sees their one notification');
select throws_ok($$select pg_temp.cmd('configuration')$$,'42501','FORBIDDEN','Guardian cannot edit or read private settings');
reset role;
select set_config('request.jwt.claim.sub',md5('dispatch-outside')::uuid::text,true);
set local role authenticated;
select is(jsonb_array_length(credit_reminder_history(array[md5('dispatch-student')::uuid])),0,'An unrelated authenticated person receives no history');
reset role;
select set_config('request.jwt.claim.sub',md5('dispatch-student-user')::uuid::text,true);
select is(jsonb_array_length(credit_reminder_history(array[md5('dispatch-student')::uuid])),1,'The student sees only their own copy');
select set_config('request.jwt.claim.sub',md5('dispatch-coach')::uuid::text,true);

create temporary table current_claims as
select (x->>'id')::uuid id,(x->>'token')::uuid token from jsonb_array_elements(claim_credit_reminder_email(8)) x;
select is((select count(*) from current_claims),2::bigint,'Scheduler claims each email once');
select is(jsonb_array_length(claim_credit_reminder_email(8)),0,'A second claim skips leased emails');
select ok((select finish_credit_reminder_email(c.id,c.token,'retry_before_send') from current_claims c join credit_internal.reminder_deliveries d using(id) where not d.is_copy),
 'An error known to precede provider send returns to retry');
select is(jsonb_array_length(claim_credit_reminder_email(8,now()+interval '14 minutes')),1,
 'Only the lapsed unstarted copy lease can be reclaimed before the retry deadline');
create temporary table retry_claim as
select (x->>'id')::uuid id,(x->>'token')::uuid token
from jsonb_array_elements(claim_credit_reminder_email(8,now()+interval '15 minutes')) x;
select is((select begin_credit_reminder_email(id,token,now()+interval '15 minutes')->>'recipient'
  from retry_claim),'dispatch-payer@example.test','Retry revalidates and opens the approved payer delivery');
select ok((select finish_credit_reminder_email(id,token,'sent',now()+interval '16 minutes','stub-provider-reference') from retry_claim),
 'Acknowledged test email is marked sent');
select ok((select finish_credit_reminder_email(id,token,'sent',now()+interval '16 minutes','stub-provider-reference') from retry_claim),
 'Acknowledgement replay changes nothing');
select is((select next_due_at from credit_internal.reminder_conditions where condition_type='low_credit'),
  now()+interval '72 hours 16 minutes','Follow-up is anchored to acknowledged delivery');

create temporary table copy_claim as
select (x->>'id')::uuid id,(x->>'token')::uuid token from jsonb_array_elements(claim_credit_reminder_email(8,now()+interval '20 minutes')) x;
select is((select begin_credit_reminder_email(id,token,now()+interval '20 minutes')->>'recipient' from copy_claim),
  'dispatch-student@example.test','Copy reaches only the authorized student');
select ok((select finish_credit_reminder_email(id,token,'uncertain',now()+interval '20 minutes') from copy_claim),
 'A send with uncertain acknowledgement is retained for review');
select is(jsonb_array_length(claim_credit_reminder_email(8,now()+interval '3 days')),0,'Uncertain deliveries are never automatically resent');
select is(scan_credit_reminders(30,now()+interval '3 days 20 minutes')->>'staged','0',
 'The unresolved send blocks an overlapping follow-up cycle');

select is(pg_temp.cmd('dismiss_delivery',jsonb_build_object('targetId',(select condition_id from credit_internal.reminder_deliveries where id=(select id from copy_claim)),
  'deliveryId',(select id from copy_claim),'reason','Verified isolated provider outcome'))->>'status','suppressed','Coach can dismiss a reviewed delivery');
select pg_temp.cmd('pause',jsonb_build_object('targetId',(select id from credit_internal.reminder_conditions where condition_type='low_credit'),
 'reason','Pause before the follow-up'));
select is(scan_credit_reminders(30,now()+interval '3 days 21 minutes')->>'staged','0','A coach pause prevents a due follow-up');
select pg_temp.cmd('resume',jsonb_build_object('targetId',(select id from credit_internal.reminder_conditions where condition_type='low_credit'),
 'reason','Resume after checking current credits'));
select is(scan_credit_reminders(30,now()+interval '3 days 21 minutes')->>'staged','4',
 'One follow-up cycle is created while the condition remains eligible');
select is((select count(*) from credit_internal.reminder_deliveries where template_kind='follow_up'),4::bigint,'Follow-ups record the selected template version');

select command_grant_student_credits(md5('dispatch-student')::uuid,'dispatch-credit-renewal',jsonb_build_object(
  'quantity',2,'kind','adjustment','reason','Synthetic renewal','packageId',(select lot from issued)),md5('dispatch-coach')::uuid);
select is(scan_credit_reminders(30,now()+interval '4 days')->>'staged','0','A qualifying grant ends recurring renewal');
select is((select status from credit_internal.reminder_conditions where condition_type='low_credit'),'resolved','Low condition closes once authoritative balance recovers');
create temporary table stale_follow_up as
  select (x->>'id')::uuid id,(x->>'token')::uuid token
  from jsonb_array_elements(claim_credit_reminder_email(8,now()+interval '4 days')) x;
select is((select count(*) from stale_follow_up where begin_credit_reminder_email(id,token,now()+interval '4 days') is not null),0::bigint,
 'A verified balance change cancels queued emails at the final eligibility check');
select is((select count(*) from credit_internal.reminder_deliveries d join stale_follow_up c using(id) where d.status='suppressed'),2::bigint,
 'Each canceled delivery remains in the private audit');
-- Two active members with one designated payer must not multiply the pool.
insert into students(id,studio_id,full_name,is_minor,portal_enabled)
values(md5('dispatch-second')::uuid,md5('dispatch-studio')::uuid,'Second household student',true,true);
insert into linked_contacts(id,studio_id,student_id,user_id,email,full_name,portal_enabled,can_view_finance,can_receive_notifications,is_primary_payer)
values(md5('dispatch-second-contact')::uuid,md5('dispatch-studio')::uuid,md5('dispatch-second')::uuid,
  md5('dispatch-payer')::uuid,'dispatch-payer@example.test','Morgan Payer',true,true,true,true);
insert into credit_internal.credit_households(id,studio_id,name)
values(md5('dispatch-family')::uuid,md5('dispatch-studio')::uuid,'Dispatch household');
insert into credit_internal.credit_household_members values
 (md5('dispatch-family')::uuid,md5('dispatch-student')::uuid),
 (md5('dispatch-family')::uuid,md5('dispatch-second')::uuid);
insert into package_definitions(id,studio_id,name,session_count,session_duration_minutes,price_minor,eligible_service_ids,allow_household_credits)
values(md5('dispatch-shared-def')::uuid,md5('dispatch-studio')::uuid,'Shared acting',3,60,0,array[md5('dispatch-service')::uuid],true);
insert into packages(id,household_id,definition_id,name,expires_at,credit_quantity,auto_apply)
values(md5('dispatch-pool')::uuid,md5('dispatch-family')::uuid,md5('dispatch-shared-def')::uuid,
 'Shared acting',now()+interval '80 days',3,true);
insert into credit_internal.credit_pool_members
 select md5('dispatch-pool')::uuid,household_id,student_id from credit_internal.credit_household_members
 where household_id=md5('dispatch-family')::uuid;
insert into package_credit_entries(package_id,kind,quantity,reason)
values(md5('dispatch-pool')::uuid,'adjustment',3,'Synthetic shared issuance');
select command_create_manual_booking('dispatch-shared-'||v.student, jsonb_build_object(
  'student_id',v.student,'service_id',md5('dispatch-service')::uuid,'duration_minutes',60,
  'starts_at',now()+make_interval(days=>v.day),'timezone','UTC','billing_arrangement','credits','reason','Shared coverage fixture'))
from (values (md5('dispatch-student')::uuid,35),(md5('dispatch-second')::uuid,36)) v(student,day);

select scan_credit_reminders(30,now()+interval '4 days');
select is((select count(*) from credit_internal.reminder_conditions where low_package_id=md5('dispatch-pool')::uuid),
  1::bigint,'One shared pool has one low-credit condition');
select is((select count(*) from credit_internal.reminder_deliveries d join credit_internal.reminder_conditions c on c.id=d.condition_id
  where c.low_package_id=md5('dispatch-pool')::uuid and d.channel='portal' and not d.is_copy),
  1::bigint,'One shared pool sends a single notice to the authorized household payer');
update linked_contacts set user_id=md5('dispatch-outside')::uuid,email='dispatch-outside@example.test'
 where id=md5('dispatch-second-contact')::uuid;
select scan_credit_reminders(30,now()+interval '4 days 1 hour');
select is((select status from credit_internal.reminder_conditions where low_package_id=md5('dispatch-pool')::uuid),
  'blocked','A shared pool with conflicting approved payer identities requires review');
select ok((select next_due_at is null and contact_id is null from credit_internal.reminder_conditions
  where low_package_id=md5('dispatch-pool')::uuid),'Conflicting household routing cannot stage another notice');

select pg_temp.cmd('pause',jsonb_build_object('targetId',(select id from credit_internal.reminder_conditions
 where low_package_id=md5('dispatch-pool')::uuid),'reason','Review shared recipient'));
select ok((select paused_at is not null from credit_internal.reminder_conditions where low_package_id=md5('dispatch-pool')::uuid),
 'Coach can pause a condition with an auditable reason');
select pg_temp.cmd('resume',jsonb_build_object('targetId',(select id from credit_internal.reminder_conditions
 where low_package_id=md5('dispatch-pool')::uuid),'reason','Resume after verification'));
select ok((select paused_at is null and next_due_at is null from credit_internal.reminder_conditions
 where low_package_id=md5('dispatch-pool')::uuid),'Resume does not bypass a routing conflict');
update packages set expires_at=now()-interval '1 day' where id=md5('dispatch-pool')::uuid;
select scan_credit_reminders(30,now()+interval '4 days 2 hours');
select is((select status from credit_internal.reminder_conditions where low_package_id=md5('dispatch-pool')::uuid),
 'resolved','An expired pool can no longer generate low-credit reminders');

select * from finish();
rollback;
