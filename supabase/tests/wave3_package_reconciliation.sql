begin;
create extension if not exists pgtap with schema extensions;
set search_path=public,extensions;
select no_plan();

insert into auth.users(id,email) values
 ('c1000000-0000-4000-8000-000000000001','e2e-stage-b-coach@example.test'),
 ('c1000000-0000-4000-8000-000000000002','e2e-stage-b-student@example.test');
insert into studios(id,name,slug) values ('c2000000-0000-4000-8000-000000000001','Credit reconciliation','e2e-credit-reconciliation');
insert into memberships(studio_id,user_id,role,display_name) values
 ('c2000000-0000-4000-8000-000000000001','c1000000-0000-4000-8000-000000000001','coach','Coach');
insert into students(id,studio_id,user_id,full_name) values
 ('c3000000-0000-4000-8000-000000000001','c2000000-0000-4000-8000-000000000001','c1000000-0000-4000-8000-000000000002','First'),
 ('c3000000-0000-4000-8000-000000000002','c2000000-0000-4000-8000-000000000001',null,'Second');
insert into booking_services(id,studio_id,slug,name,category,duration_minutes) values
 ('c4000000-0000-4000-8000-000000000001','c2000000-0000-4000-8000-000000000001','coaching','Coaching','private',60),
 ('c4000000-0000-4000-8000-000000000002','c2000000-0000-4000-8000-000000000001','audition','Audition','private',60);
insert into package_definitions(id,studio_id,name,session_count,session_duration_minutes,price_minor,eligible_service_ids)
 values ('c5000000-0000-4000-8000-000000000001','c2000000-0000-4000-8000-000000000001','Coaching package',5,60,40000,array['c4000000-0000-4000-8000-000000000001']::uuid[]);
insert into packages(id,student_id,name,definition_id,expires_at) values
 ('c6000000-0000-4000-8000-000000000001','c3000000-0000-4000-8000-000000000001','Current','c5000000-0000-4000-8000-000000000001',now()+interval '1 month'),
 ('c6000000-0000-4000-8000-000000000002','c3000000-0000-4000-8000-000000000001','Expired',null,now()-interval '1 day'),
 ('c6000000-0000-4000-8000-000000000003','c3000000-0000-4000-8000-000000000002','Other student',null,null),
 ('c6000000-0000-4000-8000-000000000004','c3000000-0000-4000-8000-000000000001','Erroneous grant',null,null);
insert into lessons(id,studio_id,student_id,topic,starts_at,ends_at,status,location_type,location_label,service_id)
 select ('c7000000-0000-4000-8000-00000000000'||n)::uuid,'c2000000-0000-4000-8000-000000000001',
 'c3000000-0000-4000-8000-000000000001','Lesson '||n,now()+make_interval(days=>n),
 now()+make_interval(days=>n)+make_interval(mins=>case when n=3 then 30 else 60 end),
 (case when n=2 then 'completed' else 'scheduled' end)::lesson_status,'virtual','Meet',
 (case when n=4 then 'c4000000-0000-4000-8000-000000000002' else 'c4000000-0000-4000-8000-000000000001' end)::uuid
 from generate_series(1,4) n;
insert into package_credit_entries(id,package_id,lesson_id,kind,quantity,reason) values
 ('c8000000-0000-4000-8000-000000000001','c6000000-0000-4000-8000-000000000001',null,'purchase',5,'Legitimate purchase'),
 ('c8000000-0000-4000-8000-000000000002','c6000000-0000-4000-8000-000000000001','c7000000-0000-4000-8000-000000000001','reservation',-1,'Hold'),
 ('c8000000-0000-4000-8000-000000000003','c6000000-0000-4000-8000-000000000001','c7000000-0000-4000-8000-000000000002','reservation',-1,'Completed hold'),
 ('c8000000-0000-4000-8000-000000000004','c6000000-0000-4000-8000-000000000002',null,'purchase',2,'Expired grant'),
 ('c8000000-0000-4000-8000-000000000005','c6000000-0000-4000-8000-000000000004',null,'adjustment',2,'Wrong grant');
insert into payment_entries(student_id,package_id,kind,amount_minor,currency,external_reference,reason)
values ('c3000000-0000-4000-8000-000000000001','c6000000-0000-4000-8000-000000000001','payment',40000,'USD','e2e-credit-stage-b-payment','Legitimate purchase');

create function pg_temp.review(p_package uuid) returns jsonb language sql as $$
  select command_student_credit_settings('c3000000-0000-4000-8000-000000000001','package_review',
    jsonb_build_object('packageId',p_package),0,'review','c1000000-0000-4000-8000-000000000001')
$$;
create function pg_temp.correct(p_package uuid,p_operation text,p_qty integer,p_source uuid,p_key text)
returns jsonb language sql as $$
  select command_student_credit_settings('c3000000-0000-4000-8000-000000000001','package_correct',
    jsonb_build_object('packageId',p_package,'operation',p_operation,'quantity',p_qty,'sourceEntryId',p_source,
      'reviewedLot',r->'selected','reason','Reviewed package correction'),
    (r->>'version')::integer,p_key,'c1000000-0000-4000-8000-000000000001') from (select pg_temp.review(p_package) r) snapshot
$$;

select is((pg_temp.review('c6000000-0000-4000-8000-000000000001')->'selected')->>'unused','4','Unused includes one hold');
select is((pg_temp.review('c6000000-0000-4000-8000-000000000001')->'selected')->>'reserved','1','One reserved credit');
select is((pg_temp.review('c6000000-0000-4000-8000-000000000001')->'selected')->>'available','3','Hold and consumption each debit once');
select is((pg_temp.review('c6000000-0000-4000-8000-000000000002')->'selected')->>'available','0','Expired balance excluded');
select is((pg_temp.review('c6000000-0000-4000-8000-000000000001')->'selected')->>'consumed','1','Completed reservation is consumed');
select throws_ok($$select pg_temp.review('c6000000-0000-4000-8000-000000000003')$$,'P0001','FORBIDDEN','Another student package is inaccessible');
select throws_ok($$select command_student_credit_settings('c3000000-0000-4000-8000-000000000001','package_review','{}',0,'review','c1000000-0000-4000-8000-000000000002')$$,'P0001','FORBIDDEN','Student cannot request coach review');
select ok(not has_function_privilege('authenticated','public.command_student_credit_settings(uuid,text,jsonb,integer,text,uuid)','EXECUTE'),'Authenticated clients cannot bypass the coach endpoint');
select throws_ok($$select pg_temp.correct('c6000000-0000-4000-8000-000000000001','remove',4,null,'stage-b-blocked')$$,'P0001','CREDIT_UNAVAILABLE: Resolve reserved lesson credits before reducing this package.','Removal protects holds');
select is(pg_temp.correct('c6000000-0000-4000-8000-000000000001','remove',1,null,'stage-b-remove')->'after'->>'available','2','Removal changes selected package only');
select is(package_credit_balance('c6000000-0000-4000-8000-000000000004'),2,'Other active package stays unchanged');
select is(pg_temp.correct('c6000000-0000-4000-8000-000000000004','reverse',null,'c8000000-0000-4000-8000-000000000005','stage-b-reverse')->'after'->>'available','0','Grant reversal appends compensating debit');
select throws_ok($$select pg_temp.correct('c6000000-0000-4000-8000-000000000004','reverse',null,'c8000000-0000-4000-8000-000000000005','stage-b-reverse-again')$$,'P0001','INVALID_TRANSITION: This entry already has a linked correction.','A new key cannot repeat the reversal');
select is(pg_temp.correct('c6000000-0000-4000-8000-000000000001','restore',null,'c8000000-0000-4000-8000-000000000003','stage-b-restore')->'after'->>'consumed','0','Linked restoration undoes the effective debit');
select is((select status::text from lessons where id='c7000000-0000-4000-8000-000000000002'),'completed','Restoration preserves completion');
select is((select amount_minor from payment_entries where external_reference='e2e-credit-stage-b-payment'),40000::bigint,'Credit reversal and restoration do not change payment amounts');
select is((select (command_student_credit_settings(student_id,'package_correct',request->'value',
    (request->>'version')::integer,key,actor_id))->>'duplicate'
  from credit_internal.credit_command_receipts where key='stage-b-restore'),'true',
  'The exact restoration replay returns the original receipt');
update lessons set status='cancelled' where id='c7000000-0000-4000-8000-000000000001';
select ok((pg_temp.review('c6000000-0000-4000-8000-000000000001')->'selected'->'issues') ? 'cancelled_lesson_debit',
  'A historical cancelled hold needs reconciliation');
select is((pg_temp.review('c6000000-0000-4000-8000-000000000001')->'selected'->'terms')->>'issuanceEntryId',
  'c8000000-0000-4000-8000-000000000001','Original issuance source is captured');
update package_definitions set eligible_service_ids=array['c4000000-0000-4000-8000-000000000002']::uuid[],
  session_duration_minutes=30 where id='c5000000-0000-4000-8000-000000000001';
select is(pg_temp.review('c6000000-0000-4000-8000-000000000001')->'selected'->>'durationMinutes','60','Issued duration is preserved in coach read');
select ok((pg_temp.review('c6000000-0000-4000-8000-000000000001')->'selected'->'issues') ? 'purchase_source_unverified',
  'Missing purchase-event references are explicitly unverified');
delete from credit_internal.package_credit_terms where package_id='c6000000-0000-4000-8000-000000000001';
select ok((pg_temp.review('c6000000-0000-4000-8000-000000000001')->'selected'->'issues') ? 'legacy_terms_unverified',
  'A legacy record without a snapshot is marked for review');
create function pg_temp.find_case(p_finding text) returns jsonb language sql as $$
  select e from jsonb_array_elements(pg_temp.review('c6000000-0000-4000-8000-000000000001')->'cases') e
  where e->>'finding'=p_finding
$$;
select is(pg_temp.find_case('purchase_source_unverified')->>'status','needs_review','Review creates a persistent case');
create function pg_temp.decide(p_case jsonb,p_status text,p_key text) returns jsonb language sql as $$
  select command_student_credit_settings('c3000000-0000-4000-8000-000000000001','case_decide',
    jsonb_build_object('caseId',p_case->>'id','status',p_status,'reason','Reviewed the original entries'),
    (p_case->>'version')::integer,p_key,'c1000000-0000-4000-8000-000000000001')
$$;
create temporary table original_case as select pg_temp.find_case('purchase_source_unverified') item;
select is(pg_temp.decide(pg_temp.find_case('purchase_source_unverified'),'dismissed','case-dismiss-test')->'case'->>'status',
  'dismissed','Dismissal records a reason and closes the case');
select throws_ok($$select pg_temp.decide((select item from original_case),'under_review','case-stale-test')$$,
  'P0001','VERSION_CONFLICT: Refresh the finding before deciding.','A stale competing decision cannot overwrite a dismissal');
select is(pg_temp.find_case('purchase_source_unverified')->>'status','dismissed','Unchanged scans preserve a dismissal');
insert into package_credit_entries(package_id,kind,quantity,reason)
  values('c6000000-0000-4000-8000-000000000001','adjustment',1,'New accounting evidence');
select is(pg_temp.find_case('purchase_source_unverified')->>'status','reopened','Material new evidence reopens an unresolved finding');
select ok(not has_table_privilege('authenticated','credit_internal.reconciliation_cases','SELECT'),
  'Students and guardians cannot read the private case table');
select is(process_stripe_checkout('evt_stage_b_first','checkout.session.completed',
  '{"data":{"object":{"id":"cs_stage_b_first","payment_intent":"pi_stage_b_shared"}}}',
  'cs_stage_b_first','c3000000-0000-4000-8000-000000000001','c6000000-0000-4000-8000-000000000004',40000,'USD')->>'duplicate',
  'false','First verified Stripe representation grants credits');
select is(process_stripe_checkout('evt_stage_b_first','checkout.session.completed',
  '{"data":{"object":{"id":"cs_stage_b_first","payment_intent":"pi_stage_b_shared"}}}',
  'cs_stage_b_first','c3000000-0000-4000-8000-000000000001','c6000000-0000-4000-8000-000000000004',40000,'USD')->>'duplicate',
  'true','Repeated event ID is a no-op');
select is(process_stripe_checkout('evt_stage_b_second','checkout.session.completed',
  '{"data":{"object":{"id":"cs_stage_b_second","payment_intent":"pi_stage_b_shared"}}}',
  'cs_stage_b_second','c3000000-0000-4000-8000-000000000001','c6000000-0000-4000-8000-000000000004',40000,'USD')->>'duplicateEvidence',
  'stripe_payment_intent','A second session backed by the same verified payment cannot issue credits');
select is(process_stripe_checkout('evt_stage_b_separate','checkout.session.completed',
  '{"data":{"object":{"id":"cs_stage_b_separate","payment_intent":"pi_stage_b_separate"}}}',
  'cs_stage_b_separate','c3000000-0000-4000-8000-000000000001','c6000000-0000-4000-8000-000000000004',40000,'USD')->>'duplicate',
  'false','A similar purchase with a different verified payment remains legitimate');
select * from finish();
rollback;
