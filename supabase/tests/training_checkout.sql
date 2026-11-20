begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

insert into auth.users(id,email) values
 ('6a000000-0000-4000-8000-000000000001','training-payer@example.test'),
 ('6a000000-0000-4000-8000-000000000002','training-viewer@example.test'),
 ('6a000000-0000-4000-8000-000000000003','training-dependent@example.test');
insert into public.studios(id,name,slug) values
 ('6a000000-0000-4000-8000-000000000004','Training test','training-checkout-tests');
insert into public.students(id,studio_id,user_id,full_name,email,is_minor,portal_enabled) values
 ('6a000000-0000-4000-8000-000000000005','6a000000-0000-4000-8000-000000000004','6a000000-0000-4000-8000-000000000003','Student One','training-dependent@example.test',true,true),
 ('6a000000-0000-4000-8000-000000000006','6a000000-0000-4000-8000-000000000004',null,'Student Two','training-dependent-two@example.test',true,true);
insert into public.linked_contacts(studio_id,student_id,user_id,full_name,email,relationship_type,
  is_primary_payer,can_view_finance,can_view_schedule,can_manage_lessons,portal_enabled) values
 ('6a000000-0000-4000-8000-000000000004','6a000000-0000-4000-8000-000000000005','6a000000-0000-4000-8000-000000000001',
  'Designated Payer','training-payer@example.test','guardian',true,true,false,false,true),
 ('6a000000-0000-4000-8000-000000000004','6a000000-0000-4000-8000-000000000006','6a000000-0000-4000-8000-000000000001',
  'Designated Payer','training-payer@example.test','guardian',true,true,false,false,true),
 ('6a000000-0000-4000-8000-000000000004','6a000000-0000-4000-8000-000000000005','6a000000-0000-4000-8000-000000000002',
  'Finance Viewer','training-viewer@example.test','guardian',false,true,false,false,true);

create function pg_temp.key(base text, n integer) returns uuid language sql immutable as $$
  select ('6a000000-0000-4000-8000-'||base||lpad(n::text,8,'0'))::uuid
$$;
insert into public.studio_invoices(id,studio_id,student_id,number,status,currency,issue_date,due_date,branding,recipient,items,total_minor)
select pg_temp.key('1000',invoice),
 '6a000000-0000-4000-8000-000000000004',
 case when invoice=1 then '6a000000-0000-4000-8000-000000000005'::uuid else '6a000000-0000-4000-8000-000000000006'::uuid end,
 'TRAINING-'||invoice,'open','USD','2030-01-31','2030-04-01','{}','{}',
 jsonb_agg(jsonb_build_object(
   'id',pg_temp.key('2000',n),'kind','service','description','Rehearsal '||n,
   'quantity',1,'unitMinor',8000+n*100,'lessonIds',jsonb_build_array(pg_temp.key('3000',n)),
   'paidMinor',0,'creditMinor',0,'startsOn',(date '2030-02-01'+n*7)::text
 ) order by n),sum(8000+n*100)
from (select n,case when n<=6 then 1 else 2 end as invoice from generate_series(1,8) n) v
group by invoice;

insert into public.lessons(id,studio_id,student_id,topic,starts_at,ends_at,status,location_type,location_label,invoice_id,price_minor,payment_status)
select pg_temp.key('3000',n), i.studio_id,i.student_id,'Rehearsal '||n,
 '2030-02-01T12:00Z'::timestamptz + n*interval '1 week',
 '2030-02-01T13:00Z'::timestamptz + n*interval '1 week',
 'scheduled','virtual','Online',i.id,8000+n*100,'due'
from generate_series(1,8) n
join public.studio_invoices i on i.id=pg_temp.key('1000',case when n<=6 then 1 else 2 end);

create function pg_temp.pick(attempt integer, selections int[], payer integer default 1)
returns jsonb language sql stable as $$
  select jsonb_build_object(
    'id',pg_temp.key('4000',attempt),'actor',pg_temp.key('0000',payer),
    'studentId','6a000000-0000-4000-8000-000000000005','items',
    jsonb_agg(jsonb_build_object(
      'invoiceId',i.id,'invoiceVersion',i.version,'lineId',pg_temp.key('2000',n),
      'lessonId',l.id,'amountMinor',l.price_minor-l.paid_minor
    ))
  )
  from unnest(selections) n join public.lessons l on l.id=pg_temp.key('3000',n)
    join public.studio_invoices i on i.id=l.invoice_id
$$;
create function pg_temp.provider(attempt integer, amount bigint)
returns jsonb language sql immutable as $$
  select jsonb_build_object('id',pg_temp.key('4000',attempt),
    'session','cs_test_training_'||attempt,'intent','pi_training_'||attempt,'amountMinor',amount,'currency','usd')
$$;

select ok(not has_function_privilege('authenticated','public.training_lesson_checkout(text,jsonb)','EXECUTE'),'Only the verified server may supply an actor');
select throws_ok($$select public.training_lesson_checkout('reserve',pg_temp.pick(1,array[2],2))$$,'P0001','FORBIDDEN','A finance viewer cannot act as the designated payer');
select throws_ok($$select public.training_lesson_checkout('reserve',pg_temp.pick(1,array[2],3))$$,'P0001','FORBIDDEN','Dependent access does not confer payer responsibility');
select throws_ok($$select public.training_lesson_checkout('reserve',jsonb_set(pg_temp.pick(1,array[2]),'{items,0,amountMinor}','200'))$$,
 'P0001','VERSION_CONFLICT: The lesson balance changed. Review the selection again.','Custom partial amount is rejected');

select set_config('test.training_selection',pg_temp.pick(1,array[2,5])::text,true);
select is(public.training_lesson_checkout('reserve',current_setting('test.training_selection')::jsonb)->>'amount_minor','16700','Select two whole balances on a six-lesson invoice');
select is(public.training_lesson_checkout('reserve',current_setting('test.training_selection')::jsonb)->>'amount_minor','16700','Exact request replay returns the same reservation');
select is((select count(*) from public.lessons where invoice_payment_pending and id::text like '6a000000-%'),2::bigint,'Only selected lessons are pending');
select throws_ok($$select public.training_lesson_checkout('reserve',pg_temp.pick(2,array[2]))$$,
 'P0001','INVALID_TRANSITION: This invoice already has a payment or is unavailable.','A competing session cannot reserve an overlapping invoice');
select throws_ok($$select public.training_lesson_checkout('settle',pg_temp.provider(1,16699))$$,
 'P0001','VERSION_CONFLICT: Stripe session does not match the lesson selection.','Provider amount must match reservation');
select is(public.training_lesson_checkout('settle',pg_temp.provider(1,16700))->>'status','settled','A verified provider event settles the selection');
select is(public.training_lesson_checkout('settle',pg_temp.provider(1,16700))->>'status','settled','Provider event replay is harmless');
select is((select array_agg(paid_minor order by id) from public.lessons where invoice_id=pg_temp.key('1000',1)),
 array[0,8200,0,0,8500,0]::bigint[],'Settlement reaches exactly lessons two and five');
select is((select status from public.studio_invoices where id=pg_temp.key('1000',1)),'partially_paid','Other complete lesson balances stay open');
select is((select count(*) from public.invoice_settlements where invoice_id=pg_temp.key('1000',1)),1::bigint,'Duplicate delivery leaves a single settlement');
select is((select count(*) from public.payment_entries where external_reference like 'training-stripe:cs_test_training_1:%'),1::bigint,'The receipt is written once to canonical payment history');

select is(public.training_lesson_checkout('reserve',pg_temp.pick(2,array[1,3,4,6,7,8]))->>'amount_minor','50900','One designated payer selects six remaining lessons across two invoices and students');
select is(public.training_lesson_checkout('expire',pg_temp.provider(2,50900))->>'status','expired','Expiry releases both invoice reservations');
select is((select count(*) from public.lessons where invoice_payment_pending and id::text like '6a000000-%'),0::bigint,'Nothing remains pending after expiry');
select is(public.training_lesson_checkout('reserve',pg_temp.pick(3,array[1,3,4,6,7,8]))->>'amount_minor','50900','Selection can be retried after link expiry');
select is(public.training_lesson_checkout('settle',pg_temp.provider(3,50900))->>'status','settled','All selected obligations settle together');
select is((select count(*) from public.lessons where payment_status='paid' and id::text like '6a000000-%'),8::bigint,'Both household schedules reflect paid lessons');
select is((select count(*) from public.studio_invoices where status='paid' and id::text like '6a000000-%'),2::bigint,'Both original invoices settle without creating duplicates');
select is(public.training_lesson_checkout('review',jsonb_build_object('intent','pi_training_1','eventId','evt_training_review'))->>'status',
 'review','Reversal opens a reconciliation case for the affected attempt');
select is((select array_agg(id order by id) from public.lessons where payment_needs_review and id::text like '6a000000-%'),
 array[pg_temp.key('3000',2),pg_temp.key('3000',5)],'Only the reversed selection is marked for review');
select is(public.training_lesson_checkout('settle',pg_temp.provider(1,16700))->>'status',
 'review','Late duplicate confirmation preserves the reconciliation state');
select is((select count(*) from public.payment_entries where external_reference like 'training-stripe:%'
  and student_id in (pg_temp.key('0000',5),pg_temp.key('0000',6))),3::bigint,
 'Original payment history survives the review and remains deduplicated');

select * from finish();
rollback;
