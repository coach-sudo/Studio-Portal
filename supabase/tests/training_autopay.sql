begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

create function pg_temp.ap(n int) returns uuid language sql immutable as $$
  select ('7a000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid
$$;
insert into auth.users(id,email) values
 (pg_temp.ap(1),'autopay-student@example.test'),(pg_temp.ap(2),'autopay-payer@example.test'),
 (pg_temp.ap(3),'autopay-finance-reader@example.test');
insert into public.studios(id,name,slug,timezone,settings) values (
 pg_temp.ap(4),'Autopay fixture','autopay-fixture','America/New_York',
 '{"currency":"USD","trainingAutopay":{"chargeAtLocal":"09:00","minimumLeadDays":0,"maximumLeadDays":7,"maximumLessonMinor":9000}}'
);
insert into public.students(id,studio_id,user_id,full_name,email,is_minor,portal_enabled) values
 (pg_temp.ap(5),pg_temp.ap(4),pg_temp.ap(1),'Dependent','autopay-student@example.test',true,true);
insert into public.linked_contacts(student_id,studio_id,user_id,full_name,email,relationship_type,
 is_primary_payer,can_view_finance,can_view_schedule,portal_enabled) values
 (pg_temp.ap(5),pg_temp.ap(4),pg_temp.ap(2),'Payer','autopay-payer@example.test','guardian',true,true,false,true),
 (pg_temp.ap(5),pg_temp.ap(4),pg_temp.ap(3),'Finance reader','autopay-finance-reader@example.test','support_person',false,true,false,true);
insert into public.studio_invoices(id,studio_id,student_id,number,status,currency,issue_date,due_date,branding,recipient,items,total_minor)
select pg_temp.ap(20+index),pg_temp.ap(4),pg_temp.ap(5),'AP-'||index,'open','USD',current_date,current_date,'{}','{}',
  jsonb_build_array(jsonb_build_object('id',pg_temp.ap(30+index),'kind','service','description','Autopay test lesson',
    'lessonIds',jsonb_build_array(pg_temp.ap(40+index)),'quantity',1,'unitMinor',8500,'paidMinor',0,'creditMinor',0,'startsOn',current_date+index+4)),
  8500
from generate_series(1,5) index;
insert into public.lessons(id,studio_id,student_id,invoice_id,topic,starts_at,ends_at,status,location_type,location_label,price_minor,payment_status)
select pg_temp.ap(40+index),pg_temp.ap(4),pg_temp.ap(5),pg_temp.ap(20+index),'Autopay lesson',
  now()+make_interval(days=>index+4),now()+make_interval(days=>index+4,hours=>1),'scheduled','virtual','Synthetic studio',8500,'due'
from generate_series(1,5) index;

create function pg_temp.selection(actor int default 2, lead int default 2) returns jsonb language sql stable as $$
  select jsonb_build_object('actor',pg_temp.ap(actor),'studentId',pg_temp.ap(5),'id',pg_temp.ap(80),
    'scope','existing','leadDays',lead,'maximumLessonMinor',9000,'currency','USD',
    'existingLessonIds',jsonb_build_array(pg_temp.ap(41),pg_temp.ap(42),pg_temp.ap(43),pg_temp.ap(44)))
$$;
create function pg_temp.setup() returns jsonb language sql immutable as $$
  select jsonb_build_object('id',pg_temp.ap(80),'session','cs_test_autopay_fixture','customer','cus_autopay_fixture',
    'intent','seti_autopay_fixture','method','pm_autopay_fixture','methodLabel','Card ending in 4242')
$$;
create function pg_temp.manager(v int) returns jsonb language sql immutable as $$
  select jsonb_build_object('actor',pg_temp.ap(2),'studentId',pg_temp.ap(5),'id',pg_temp.ap(80),'expectedVersion',v)
$$;

select ok(not has_function_privilege('authenticated','public.training_lesson_autopay(text,jsonb)','EXECUTE'),'Only the verified server can invoke enrollment');
select ok(not has_function_privilege('authenticated','public.training_lesson_autopay_job(text,jsonb)','EXECUTE'),'Only the verified server can invoke charge jobs');
select throws_ok($$select public.training_lesson_autopay('review',pg_temp.selection(3))$$,'P0001','FORBIDDEN','A finance viewer cannot authorize');
select throws_ok($$select public.training_lesson_autopay('review',pg_temp.selection(1))$$,'P0001','FORBIDDEN','The dependent cannot act as payer');
select throws_ok($$select public.training_lesson_autopay('begin',pg_temp.selection())$$,'P0001',
 'VALIDATION_FAILED: Review and authorize the selected payment terms.','Enrollment requires explicit consent');
select set_config('test.autopay_review',public.training_lesson_autopay('review',pg_temp.selection())->>'reviewDigest',true);
create function pg_temp.approval(lead int default 2) returns jsonb language sql stable as $$
  select pg_temp.selection(2,lead)||jsonb_build_object('consentVersion','lesson-autopay-v1','consented',true,
    'reviewDigest',current_setting('test.autopay_review'))
$$;
select throws_ok($$select public.training_lesson_autopay('begin',pg_temp.approval(3))$$,'P0001',
 'VERSION_CONFLICT: Review the current dates and balances before authorizing.','Lead-time edits invalidate the review');
select is(public.training_lesson_autopay('begin',pg_temp.approval())->>'status','pending_setup','Explicit approval starts payment-method setup');
select is(public.training_lesson_autopay('begin',pg_temp.approval())->>'id',pg_temp.ap(80)::text,'Replayed setup request reuses the arrangement');
select is((select count(*) from training_internal.lesson_autopay_attempts where mandate_id=pg_temp.ap(80)),0::bigint,'Pending setup does not plan charges');
select throws_ok($$select public.training_lesson_autopay('setup_complete',pg_temp.setup())$$,'P0001',
 'VERSION_CONFLICT: Stripe setup does not match the authorization.','A provider result must match the attached Checkout Session');
select is(public.training_lesson_autopay('setup_attach',pg_temp.setup())->>'status','pending_setup','Attach the matching hosted setup');
select is(public.training_lesson_autopay('setup_complete',pg_temp.setup())->>'status','active','Verified setup activates the arrangement');
select is(public.training_lesson_autopay('setup_complete',pg_temp.setup())->>'version','2','Provider replay does not activate twice');
select is((select count(*) from training_internal.lesson_autopay_attempts where mandate_id=pg_temp.ap(80) and state='planned'),4::bigint,
 'Exactly the selected eligible lessons are scheduled');
select is(training_internal.autopay_when('2031-03-12 20:00:00+00','America/New_York',2,'09:00'),
 '2031-03-10 13:00:00+00'::timestamptz,'Lead days use the local calendar across daylight saving changes');
select is(training_internal.autopay_when('2031-03-09 20:00:00+00','America/New_York',0,'02:30'),
 null::timestamptz,'A missing local time requires review');
select is(training_internal.autopay_when('2031-11-02 20:00:00+00','America/New_York',0,'01:30'),
 null::timestamptz,'An ambiguous local payment time requires review');

update public.lessons set starts_at=now()+interval '5 hours',ends_at=now()+interval '6 hours' where id=pg_temp.ap(42);
update public.lessons set status='cancelled' where id=pg_temp.ap(43);
update public.lessons set price_minor=8900 where id=pg_temp.ap(44);
update public.studio_invoices set items=jsonb_set(items,'{0,unitMinor}','8900'),total_minor=8900 where id=pg_temp.ap(24);
select public.training_lesson_autopay_job('refresh','{}');
select is((select state from training_internal.lesson_autopay_attempts where mandate_id=pg_temp.ap(80) and lesson_id=pg_temp.ap(42)),
 'pay_now','Moving a lesson inside the lead window requires Pay now');
select is((select state from training_internal.lesson_autopay_attempts where mandate_id=pg_temp.ap(80) and lesson_id=pg_temp.ap(43)),
 'skipped','A cancellation drops out of the payment plan');
select is((select state from training_internal.lesson_autopay_attempts where mandate_id=pg_temp.ap(80) and lesson_id=pg_temp.ap(44)),
 'review','Changed price requires new authorization');

-- Move a previously planned attempt into the elapsed window without changing
-- the wall clock or preparing a new obligation in the past.
update training_internal.lesson_autopay_mandates set planning_since=now()-interval '2 minutes' where id=pg_temp.ap(80);
update training_internal.lesson_autopay_attempts set pay_at=now()-interval '1 minute'
 where mandate_id=pg_temp.ap(80) and lesson_id=pg_temp.ap(41);
select set_config('test.autopay_job',public.training_lesson_autopay_job('claim','{}')->>'id',true);
select ok(length(current_setting('test.autopay_job'))=36,'A due lesson claims the canonical full-balance reservation');
select is(public.training_lesson_autopay_job('claim','{}'),null::jsonb,'A concurrent scheduler cannot claim the leased payment');
select is((select checkout_amount from public.studio_invoices where id=pg_temp.ap(21)),8500::bigint,'Automatic payment shares the checkout lock');
create function pg_temp.provider(status text default 'succeeded') returns jsonb language sql stable as $$
  select jsonb_build_object('id',current_setting('test.autopay_job'),'intent','pi_autopay_fixture','status',status,
    'currency','usd','amountMinor',8500,'receivedMinor',8500,'customer','cus_autopay_fixture','method','pm_autopay_fixture')
$$;
select is(public.training_lesson_autopay_job('attach',pg_temp.provider())->>'status','in_flight','Provider intent is attached before submission');
select is(public.training_lesson_autopay_job('submit',pg_temp.provider())->>'allowed','true','Current authorization permits submission');
select is(public.training_lesson_autopay_job('reconcile',pg_temp.provider())->>'status','succeeded','Verified payment settles the lesson');
select is(public.training_lesson_autopay_job('reconcile',pg_temp.provider())->>'status','succeeded','Verified payment replay is harmless');
select is((select count(*) from public.invoice_settlements where invoice_id=pg_temp.ap(21)),1::bigint,'There is one canonical receipt');
select is((select paid_minor from public.lessons where id=pg_temp.ap(41)),8500::bigint,'The exact lesson reflects the successful payment');
select is(public.training_lesson_autopay('pause',pg_temp.manager(2))->>'status','paused','The designated payer can pause');
select is(public.training_lesson_autopay('resume',pg_temp.manager(3))->>'status','active','The designated payer can resume');
select is(public.training_lesson_autopay('cancel',pg_temp.manager(4))->>'status','cancelled','The designated payer can end the authorization');
select is((select status::text from public.lessons where id=pg_temp.ap(41)),'scheduled','Ending payments preserves the booking');
select is((select paid_minor from public.lessons where id=pg_temp.ap(41)),8500::bigint,'Ending payments preserves financial history');

create function pg_temp.future() returns jsonb language sql stable as $$
  select jsonb_build_object('actor',pg_temp.ap(2),'studentId',pg_temp.ap(5),'id',pg_temp.ap(81),
    'scope','future','leadDays',2,'currency','USD','maximumLessonMinor',9000,'existingLessonIds','[]'::jsonb)
$$;
update public.lessons set created_at=now()-interval '1 hour' where student_id=pg_temp.ap(5);
select set_config('test.autopay_future_review',public.training_lesson_autopay('review',pg_temp.future())->>'reviewDigest',true);
select is(public.training_lesson_autopay('begin',pg_temp.future()||jsonb_build_object(
  'consented',true,'consentVersion','lesson-autopay-v1','reviewDigest',current_setting('test.autopay_future_review')
))->>'status','pending_setup','Future scope has its own consent receipt');
create function pg_temp.future_setup() returns jsonb language sql immutable as $$
  select jsonb_build_object('id',pg_temp.ap(81),'session','cs_test_autopay_future','customer','cus_autopay_future',
    'intent','seti_autopay_future','method','pm_autopay_future','methodLabel','Card ending in 4242')
$$;
select public.training_lesson_autopay('setup_attach',pg_temp.future_setup());
select is(public.training_lesson_autopay('setup_complete',pg_temp.future_setup())->>'status','active','Future scope activates after setup');
select is((select count(*) from training_internal.lesson_autopay_attempts where mandate_id=pg_temp.ap(81)),0::bigint,
 'Future-only authorization leaves all existing obligations untouched');
insert into public.studio_invoices(id,studio_id,student_id,number,status,currency,issue_date,due_date,branding,recipient,items,total_minor)
values (pg_temp.ap(26),pg_temp.ap(4),pg_temp.ap(5),'AP-FUTURE','open','USD',current_date,current_date,'{}','{}',
  jsonb_build_array(jsonb_build_object('id',pg_temp.ap(36),'kind','service','description','Future lesson',
    'lessonIds',jsonb_build_array(pg_temp.ap(46)),'quantity',1,'unitMinor',8500,'paidMinor',0,'creditMinor',0,'startsOn',current_date+3)),8500);
insert into public.lessons(id,studio_id,student_id,invoice_id,topic,starts_at,ends_at,status,location_type,location_label,price_minor,payment_status)
values (pg_temp.ap(46),pg_temp.ap(4),pg_temp.ap(5),pg_temp.ap(26),'Future lesson',
  now()+interval '3 days',now()+interval '3 days 1 hour','scheduled','virtual','Synthetic studio',8500,'due');
select public.training_lesson_autopay_job('refresh','{}');
select is((select state from training_internal.lesson_autopay_attempts where mandate_id=pg_temp.ap(81) and lesson_id=pg_temp.ap(46)),
 'planned','A newly scheduled eligible lesson enters the active future scope');
update training_internal.lesson_autopay_mandates set planning_since=now()-interval '2 minutes' where id=pg_temp.ap(81);
update training_internal.lesson_autopay_attempts set pay_at=now()-interval '1 minute' where mandate_id=pg_temp.ap(81);
select set_config('test.autopay_future_job',public.training_lesson_autopay_job('claim','{}')->>'id',true);
create function pg_temp.failed_provider() returns jsonb language sql stable as $$
  select jsonb_build_object('id',current_setting('test.autopay_future_job'),'intent','pi_autopay_failure','status','canceled',
    'currency','usd','amountMinor',8500,'receivedMinor',0,'customer','cus_autopay_future','method','pm_autopay_future')
$$;
select public.training_lesson_autopay_job('attach',pg_temp.failed_provider());
select is(public.training_lesson_autopay_job('submit',pg_temp.failed_provider())->>'allowed','true','The due future lesson reaches submission');
select is(public.training_lesson_autopay_job('reconcile',pg_temp.failed_provider())->>'status','failed',
 'An unsuccessful provider attempt releases the invoice for recovery');
select is((select status from training_internal.lesson_autopay_mandates where id=pg_temp.ap(81)),'paused',
 'A failed automatic payment pauses the arrangement');
select is((select checkout_key from public.studio_invoices where id=pg_temp.ap(26)),null::text,
 'The original whole lesson can be paid manually after failure');
select is((select count(*) from public.invoice_settlements where invoice_id=pg_temp.ap(26)),0::bigint,
 'A failed attempt does not create a financial receipt');
select is((select count(*) from public.outbox_messages where student_id=pg_temp.ap(5)),0::bigint,
 'The test arrangement emits no real outbound message');

select * from finish();
rollback;
