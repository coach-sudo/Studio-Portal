begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

create function pg_temp.key(n integer) returns uuid language sql immutable as $$
  select ('f1090000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid
$$;
insert into auth.users(id,email)
select pg_temp.key(n),'pr109-payer-'||n||'@example.test' from generate_series(1,4) n;
insert into public.studios(id,name,slug,settings)
values(pg_temp.key(10),'PR109 sandbox','pr109-direct-tests','{"currency":"USD"}');
insert into public.memberships(studio_id,user_id,role,display_name)
values(pg_temp.key(10),pg_temp.key(4),'coach','Coach');
insert into public.students(id,studio_id,user_id,full_name,email,is_minor,portal_enabled) values
 (pg_temp.key(20),pg_temp.key(10),pg_temp.key(1),'Self payer','pr109-payer-1@example.test',false,true),
 (pg_temp.key(21),pg_temp.key(10),null,'Dependent','pr109-dependent@example.test',true,true);
insert into public.linked_contacts(studio_id,student_id,user_id,full_name,email,relationship_type,is_primary_payer,can_view_finance,portal_enabled)
values(pg_temp.key(10),pg_temp.key(21),pg_temp.key(2),'Guardian','pr109-payer-2@example.test','guardian',true,true,true);
insert into public.linked_contacts(studio_id,student_id,user_id,full_name,email,relationship_type,can_view_schedule,portal_enabled)
values(pg_temp.key(10),pg_temp.key(21),pg_temp.key(3),'Schedule viewer','pr109-payer-3@example.test','guardian',true,true);
insert into public.booking_services(id,studio_id,slug,name,category,duration_minutes,price_minor)
values(pg_temp.key(30),pg_temp.key(10),'direct-rehearsal','Rehearsal','private',60,8000);
insert into public.lessons(id,studio_id,student_id,service_id,topic,starts_at,ends_at,status,location_type,location_label,price_minor,payment_status,source_provider)
select pg_temp.key(100+n),pg_temp.key(10),pg_temp.key(case when n>=7 then 21 else 20 end),pg_temp.key(30),'Rehearsal '||n,
  now()+n*interval '2 days',now()+n*interval '2 days'+interval '1 hour','scheduled','virtual','Online',8000,'due','studio'
from generate_series(1,9) n;
select set_config('request.jwt.claim.sub',pg_temp.key(4)::text,true);
set local role authenticated;
select public.command_create_manual_booking('pr109-direct-booking',
 jsonb_build_object('student_id',pg_temp.key(20),'service_id',pg_temp.key(30),
 'starts_at',to_char((now()+interval '21 days') at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'),
 'timezone','America/New_York','price_minor',8000));
reset role;

create function pg_temp.args(n integer, ids uuid[], actor integer default 1, focus integer default 20)
returns jsonb language sql stable as $$
  select jsonb_build_object('id',pg_temp.key(200+n),'actor',pg_temp.key(actor),'studentId',pg_temp.key(focus),
    'items',jsonb_agg(jsonb_build_object('studentId',q->>'studentId','lessonId',l,
       'amountMinor',(q->>'remainingMinor')::bigint,'currency',q->>'currency','terms',q->>'terms')))
  from unnest(ids) l
  cross join lateral (select training_internal.direct_lesson_quote(pg_temp.key(actor),l,null) q) x
$$;
create function pg_temp.use_attempt(n integer,actor integer default 1) returns jsonb language sql immutable as $$
  select jsonb_build_object('id',pg_temp.key(200+n),'actor',pg_temp.key(actor))
$$;
create function pg_temp.provider(n integer,amount bigint) returns jsonb language sql immutable as $$
  select jsonb_build_object('id',pg_temp.key(200+n),'session','cs_test_pr109_'||n,'intent','pi_test_pr109_'||n,
    'amountMinor',amount,'currency','usd')
$$;
create function pg_temp.invoice(lesson uuid) returns jsonb language sql stable as $$
  select jsonb_build_object('student_id',l.student_id,'studio_id',l.studio_id,'status','open','currency','USD',
    'issue_date',current_date,'due_date',current_date+5,'branding','{}'::jsonb,'recipient','{}'::jsonb,
    'introduction','','notes','','footer','','items',jsonb_build_array(jsonb_build_object(
      'id',pg_temp.key(90),'kind','service','referenceId',l.service_id,'description',l.topic,'quantity',1,
      'unitMinor',l.price_minor,'lessonIds',jsonb_build_array(l.id),'paidMinor',0,'creditMinor',0)))
  from public.lessons l where l.id=lesson
$$;

select ok(not has_function_privilege('authenticated','public.training_lesson_checkout(text,jsonb)','EXECUTE'),
  'Browser roles cannot claim or settle directly');
select is(jsonb_array_length(public.training_lesson_checkout('direct_options',jsonb_build_object(
 'actor',pg_temp.key(3),'studentId',pg_temp.key(21),'studentIds',jsonb_build_array(pg_temp.key(21))))),
  0,'Schedule-only user sees no payable balances');
select throws_ok($$select training_internal.direct_lesson_quote(pg_temp.key(2),pg_temp.key(101),null)$$,'42501','FORBIDDEN',
  'Guardian cannot review an unrelated adult lesson');

select set_config('test.pr109.one',pg_temp.args(1,array[pg_temp.key(101)])::text,true);
select is(public.training_lesson_checkout('reserve_direct',current_setting('test.pr109.one')::jsonb)->>'amount_minor',
  '8000','Invoice-free checkout reserves the verified amount');
select is(public.training_lesson_checkout('reserve_direct',current_setting('test.pr109.one')::jsonb)->>'id',
  pg_temp.key(201)::text,'Reservation replay keeps the same ID');
select is(credit_internal.evaluate_student_lesson_credit(pg_temp.key(20),pg_temp.key(101))->>'reasonCode',
  'payment_pending','Credit allocator sees a direct monetary hold');
select throws_ok($$select public.save_studio_invoice(pg_temp.invoice(pg_temp.key(101)),'pr109-invoice-race',0)$$,
  'P0001','INVALID_TRANSITION: A lesson payment is already pending. Check the payment first.','Coach invoice sees the same hold');
select throws_ok($$select public.training_lesson_checkout('reserve_direct',jsonb_set(current_setting('test.pr109.one')::jsonb,'{id}',to_jsonb(pg_temp.key(222))))$$,
  'P0001','VERSION_CONFLICT: A lesson or its payment terms changed. Review the current balance.','Second attempt cannot claim the same lesson');
select throws_ok($$select public.training_lesson_checkout('settle',pg_temp.provider(1,8000))$$,
  'P0001','INVALID_TRANSITION: The checkout was not opened with the provider.','Unstarted attempt cannot settle');
select is(public.training_lesson_checkout('begin_direct_provider',pg_temp.use_attempt(1))->>'status','reserved','Start is recorded before Stripe');
select is(public.training_lesson_checkout('cancel_unstarted',pg_temp.use_attempt(1))->>'status','reserved','An unattached provider attempt remains held');
select throws_ok($$select public.training_lesson_checkout('settle',pg_temp.provider(1,7999))$$,
  'P0001','VERSION_CONFLICT: Stripe session does not match the lesson selection.','Provider amount mismatch is refused');
select is(public.training_lesson_checkout('settle',pg_temp.provider(1,8000))->>'status','settled','Verified provider outcome settles the exact lesson');
select is(public.training_lesson_checkout('settle',pg_temp.provider(1,8000))->>'status','settled','Duplicate provider outcome is idempotent');
select is(public.training_lesson_checkout('expire',pg_temp.provider(1,8000))->>'status','settled','Late expiry cannot reverse settlement');
select is((select count(*) from public.payment_entries where external_reference='lesson-checkout:'||pg_temp.key(201)||':'||pg_temp.key(101)),
  1::bigint,'One exact lesson allocation in the existing payment ledger');
select is((select payment_status from public.lessons where id=pg_temp.key(101)),'paid','Existing lesson view displays paid');
select ok(not (credit_internal.evaluate_student_lesson_credit(pg_temp.key(20),pg_temp.key(101))->>'eligible')::boolean,'Settled lesson is excluded from credit');
select throws_ok($$select public.save_studio_invoice(pg_temp.invoice(pg_temp.key(101)),'pr109-invoice-settled',0)$$,
  'P0001','VALIDATION_FAILED: Choose an unpaid matching lesson.','Later invoice cannot charge the paid lesson');

select is(public.training_lesson_checkout('reserve_direct',pg_temp.args(2,array[pg_temp.key(107),pg_temp.key(108)],2,21))->>'amount_minor',
  '16000','Authorized household payer can reserve two lessons atomically');
select is(public.training_lesson_checkout('begin_direct_provider',pg_temp.use_attempt(2,2))->>'status','reserved','Household payment becomes provider-backed');
select is(public.training_lesson_checkout('attach',pg_temp.provider(2,16000))->>'status','reserved','Incomplete provider result keeps the hold');
select is(public.training_lesson_checkout('expire',pg_temp.provider(2,16000))->>'status','expired','Provider expiry releases both holds');
select ok(not exists(select 1 from public.lessons where id in(pg_temp.key(107),pg_temp.key(108)) and invoice_payment_pending),
  'Both lessons are available after verified expiry');
select is(public.training_lesson_checkout('reserve_direct',pg_temp.args(3,array[pg_temp.key(107),pg_temp.key(108)],2,21))->>'amount_minor',
  '16000','Released household selection can be reviewed again');
select is(public.training_lesson_checkout('begin_direct_provider',pg_temp.use_attempt(3,2))->>'status','reserved','Household retry starts with a new identity');
select is(public.training_lesson_checkout('settle',pg_temp.provider(3,16000))->>'status','settled','Two lessons settle in one provider payment');
select is((select count(*) from public.payment_entries where student_id=pg_temp.key(21)),2::bigint,'Separate exact allocations in one ledger');

select public.save_studio_invoice(pg_temp.invoice(pg_temp.key(102)),'pr109-existing-invoice',0);
select is(training_internal.direct_lesson_quote(pg_temp.key(1),pg_temp.key(102),null)->>'reasonCode','use_invoice','Invoice-backed lesson cannot be collected directly');
select is(public.training_lesson_checkout('reserve_direct',pg_temp.args(4,array[pg_temp.key(103)]))->>'status','reserved','Unstarted checkout can be created');
select is(public.training_lesson_checkout('cancel_unstarted',pg_temp.use_attempt(4))->>'status','expired','Unstarted checkout can be canceled safely');
select public.training_lesson_checkout('reserve_direct',pg_temp.args(7,array[pg_temp.key(103)]));
update training_internal.lesson_checkouts set created_at=now()-interval '16 minutes' where id=pg_temp.key(207);
select ok(jsonb_array_length(public.training_lesson_checkout('direct_options',jsonb_build_object(
  'actor',pg_temp.key(1),'studentId',pg_temp.key(20),'studentIds',jsonb_build_array(pg_temp.key(20)),
  'lessonId',pg_temp.key(103))))=1,'An aged unstarted hold expires before the next quote');
select is((select status from training_internal.lesson_checkouts where id=pg_temp.key(207)),'expired',
  'Automatic expiry applies only when provider start was never recorded');
select set_config('test.pr109.stale',pg_temp.args(5,array[pg_temp.key(104)])::text,true);
update public.students set email='pr109-updated@example.test' where id=pg_temp.key(20);
select throws_ok($$select public.training_lesson_checkout('reserve_direct',current_setting('test.pr109.stale')::jsonb)$$,
  'P0001','VERSION_CONFLICT: A lesson or its payment terms changed. Review the current balance.','Payer edits invalidate stale review');

select set_config('test.pr109.booked',(select l.id::text from public.lessons l join public.lesson_participants p on p.lesson_id=l.id
 where l.student_id=pg_temp.key(20) and p.booking_id is not null),true);
set local role authenticated;
select public.record_lesson_payment(jsonb_build_object('lessonId',current_setting('test.pr109.booked'),'version',
 (public.lesson_payment_context(current_setting('test.pr109.booked')::uuid)->>'version')::int,'reviewToken',
 public.lesson_payment_context(current_setting('test.pr109.booked')::uuid)->>'reviewToken',
 'amountMinor',2000,'currency','USD','method','bank','reason','Synthetic received transfer'),'pr109-partial-cash');
reset role;
select is(public.training_lesson_checkout('reserve_direct',pg_temp.args(6,array[current_setting('test.pr109.booked')::uuid]))->>'amount_minor',
  '6000','Direct checkout sees the real remaining balance on a coach-booked lesson');
select is(public.training_lesson_checkout('begin_direct_provider',pg_temp.use_attempt(6))->>'status','reserved','A partially paid lesson can reach the provider');
select is(public.training_lesson_checkout('settle',pg_temp.provider(6,6000))->>'status','settled','Settlement adds only the remaining amount');
select is((select paid_minor from public.lessons where id=current_setting('test.pr109.booked')::uuid),
  8000::bigint,'Manual and online receipts agree with the scheduled lesson');

insert into public.packages(id,student_id,name) values(pg_temp.key(70),pg_temp.key(20),'Prepaid');
insert into public.package_credit_entries(package_id,kind,quantity,reason) values(pg_temp.key(70),'purchase',1,'Synthetic entitlement');
select public.command_apply_lesson_credit(pg_temp.key(105),pg_temp.key(70),'Existing reservation','pr109-covered');
select is(training_internal.direct_lesson_quote(pg_temp.key(1),pg_temp.key(105),null)->>'reasonCode',
  'credit_review','Existing credit reservation prevents cash collection');

select * from finish();
rollback;
