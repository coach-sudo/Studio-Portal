begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

insert into auth.users(id,email) values
('f0410000-0000-4000-8000-000000000001','coach-one@example.test'),
('f0410000-0000-4000-8000-000000000002','coach-two@example.test'),
('f0410000-0000-4000-8000-000000000003','learner@example.test'),
('f0410000-0000-4000-8000-000000000004','guardian@example.test');
insert into public.studios(id,name,slug,timezone) values
('f0410000-0000-4000-8000-000000000010','Wave 4 one','wave4-report-one','America/New_York'),
('f0410000-0000-4000-8000-000000000020','Wave 4 two','wave4-report-two','UTC');
insert into public.memberships(studio_id,user_id,role,display_name) values
('f0410000-0000-4000-8000-000000000010','f0410000-0000-4000-8000-000000000001','coach','Coach one'),
('f0410000-0000-4000-8000-000000000020','f0410000-0000-4000-8000-000000000002','coach','Coach two');
insert into public.students(id,studio_id,user_id,full_name,email) values
('f0410000-0000-4000-8000-000000000011','f0410000-0000-4000-8000-000000000010','f0410000-0000-4000-8000-000000000003','=SUM(1,1)','learner@example.test'),
('f0410000-0000-4000-8000-000000000021','f0410000-0000-4000-8000-000000000020',null,'Other studio only','elsewhere@example.test');
insert into public.linked_contacts(id,studio_id,student_id,user_id,full_name,email,relationship_type,is_primary_payer,can_view_finance,can_view_schedule,portal_enabled)
values ('f0410000-0000-4000-8000-000000000030','f0410000-0000-4000-8000-000000000010','f0410000-0000-4000-8000-000000000011','f0410000-0000-4000-8000-000000000004','Guardian','guardian@example.test','guardian',true,true,true,true);

insert into public.packages(id,student_id,name,credit_quantity,expires_at)
values ('f0410000-0000-4000-8000-000000000012','f0410000-0000-4000-8000-000000000011','Voice package',3,now()+interval '10 days');
insert into public.package_credit_entries(package_id,quantity,kind,reason,created_at) values
('f0410000-0000-4000-8000-000000000012',3,'purchase','Synthetic coverage','2026-03-08T13:00Z');

insert into public.payment_entries(student_id,amount_minor,kind,currency,created_at,external_reference,account_credit,package_id,reason) values
('f0410000-0000-4000-8000-000000000011',2000,'payment','USD','2026-03-08T05:00Z','wave4-partial',false,null,'Partial receipt'),
('f0410000-0000-4000-8000-000000000011',1000,'payment','USD','2026-03-09T03:59:59Z','wave4-package',false,'f0410000-0000-4000-8000-000000000012','Package purchase'),
('f0410000-0000-4000-8000-000000000011',250,'refund','USD','2026-03-09T03:00Z','wave4-refund',false,null,'Partial refund'),
('f0410000-0000-4000-8000-000000000011',95,'refund','USD','2026-03-09T04:00Z','wave4-next',false,null,'Later refund'),
('f0410000-0000-4000-8000-000000000011',550,'refund','USD','2026-03-08T10:00Z','wave4-account-credit',true,null,'Dollar credit issued'),
('f0410000-0000-4000-8000-000000000011',800,'payment','EUR','2026-03-08T10:00Z','wave4-euro',false,null,'Second currency'),
('f0410000-0000-4000-8000-000000000021',100000,'payment','USD','2026-03-08T12:00Z','wave4-other-studio',false,null,'Private'),
('f0410000-0000-4000-8000-000000000011',10,'payment','USD','2026-03-08T04:59:59Z','wave4-previous',false,null,'Prior date');
insert into public.payment_entries(student_id,amount_minor,kind,currency,created_at,external_reference,reason)
values ('f0410000-0000-4000-8000-000000000011',2000,'payment','USD','2026-03-08T05:00Z','wave4-partial','Replay')
on conflict (external_reference) do nothing;

insert into public.studio_invoices(id,studio_id,student_id,number,status,currency,issue_date,due_date,total_minor,paid_minor,credit_minor,waived_minor,items,branding,recipient)
values ('f0410000-0000-4000-8000-000000000013','f0410000-0000-4000-8000-000000000010','f0410000-0000-4000-8000-000000000011',
  'WAVE4-INVOICE','partially_paid','USD',current_date-8,current_date-2,6000,2000,800,200,'[]','{}','{"name":"Primary payer"}'),
('f0410000-0000-4000-8000-000000000014','f0410000-0000-4000-8000-000000000010','f0410000-0000-4000-8000-000000000011',
  'WAVE4-DRAFT','draft','USD',current_date-8,current_date-2,9900,0,0,0,'[]','{}','{}');

create function pg_temp.report(p_group text,filters jsonb default '{}',p_start date default '2026-03-08',p_end date default '2026-03-08') returns jsonb
language sql as $$ select public.finance_report('f0410000-0000-4000-8000-000000000010',$3,$4,jsonb_build_object('group',$1)||$2) $$;
create function pg_temp.attention(filters jsonb default '{}') returns jsonb
language sql as $$ select public.finance_attention('f0410000-0000-4000-8000-000000000010',$1) $$;
create function pg_temp.metric(summary jsonb,p_metric text,p_currency text) returns bigint
language sql as $$ select (item->>'amount')::bigint from jsonb_array_elements(summary->'totals') item where item->>'metric'=p_metric and item->>'currency'=p_currency $$;

set local role authenticated;
select set_config('request.jwt.claim.sub','f0410000-0000-4000-8000-000000000001',true);
select is(pg_temp.metric(pg_temp.report('overview'),'gross','USD'),3000::bigint,'Payments and package purchase counted once across the DST day');
select is(pg_temp.metric(pg_temp.report('overview'),'refunds','USD'),250::bigint,'Only the monetary refund in the period counts');
select is(pg_temp.metric(pg_temp.report('overview'),'net','USD'),2750::bigint,'Partial refund reduces period net');
select is(pg_temp.metric(pg_temp.report('overview'),'net','EUR'),800::bigint,'Currencies stay separate');
select is(pg_temp.metric(pg_temp.report('overview','{}','2026-03-09','2026-03-09'),'net','USD'),-95::bigint,'Refund in a later period produces negative net');
select is(pg_temp.metric(pg_temp.report('overview'),'outstanding','USD'),3000::bigint,'Only the outstanding issued invoice portion counts');
select is(pg_temp.metric(pg_temp.report('overview'),'overdue','USD'),3000::bigint,'Current overdue amount uses the actual due date');
select is((pg_temp.report('packages')->>'count')::int,1,'Only verified package purchases appear with monetary amounts');
select is((pg_temp.report('credits')->'rows'->0->>'currency'),'CREDITS','Credit history stays quantity only');
select is((pg_temp.report('receivables','{"search":"primary payer"}')->>'count')::int,1,'Payer attribution can be searched');
select is((pg_temp.report('receivables','{"filterDates":true}')->>'count')::int,0,'Due-date filter applies to receivables only when enabled');
select is((pg_temp.report('collections','{"currency":"EUR"}')->>'count')::int,1,'Currency filters constrain the same rows');
select ok(pg_temp.report('collections','{"export":true,"currency":"EUR"}')->>'csv' like '%''=SUM(1,1)%','Spreadsheet formulas in text are neutralized');
select ok(pg_temp.report('collections','{"export":true,"currency":"EUR"}')->>'csv' not like '%learner@example.test%','CSV excludes private addresses');
select is((pg_temp.attention()->>'count')::int,2,'Only actionable overdue and expiring package issues are detected');
select set_config('e2e.wave4.issue',pg_temp.attention()->'items'->0->>'id',true);
select is(pg_temp.attention()->'items'->0->>'id',current_setting('e2e.wave4.issue'),'Repeat reads use a stable issue identity');
select is(pg_temp.attention(jsonb_build_object('action','acknowledge','id',current_setting('e2e.wave4.issue'),'version',1))->'items'->0->>'state','acknowledged','Acknowledgement persists without resolving the invoice');
select throws_ok(format('select pg_temp.attention(%L)',jsonb_build_object('action','dismiss','id',current_setting('e2e.wave4.issue'),'version',2,'reason','Synthetic reason')::text),'P0001','VALIDATION_FAILED: Only informational package notices can be dismissed with a reason.','A debt cannot be dismissed');
select is((pg_temp.attention(jsonb_build_object('action','snooze','id',current_setting('e2e.wave4.issue'),'version',2,'until',now()+interval '1 day'))->>'count')::int,1,'Snooze moves only the selected item out of the queue');
select is((pg_temp.attention('{"queue":"snoozed"}')->>'count')::int,1,'Snoozed state persists');

reset role;
update public.studio_invoices set paid_minor=3000 where number='WAVE4-INVOICE';
set local role authenticated;
select is(pg_temp.attention()->'items'->0->>'state','open','Material balance change reopens the snoozed item');
select is(pg_temp.attention()->'items'->0->>'id',current_setting('e2e.wave4.issue'),'Material change keeps the same identity');
reset role;
update public.studio_invoices set paid_minor=5000,status='paid' where number='WAVE4-INVOICE';
set local role authenticated;
select is(pg_temp.attention('{"queue":"history"}')->'items'->0->>'state','resolved','Cleared invoice resolves automatically');
reset role;
update public.studio_invoices set paid_minor=2000,status='partially_paid' where number='WAVE4-INVOICE';
set local role authenticated;
select is(pg_temp.attention()->'items'->0->>'id',current_setting('e2e.wave4.issue'),'A recurring condition reopens the same identity');
select set_config('e2e.wave4.package_issue',pg_temp.attention('{"kind":"package_expiring"}')->'items'->0->>'id',true);
select lives_ok(format('select pg_temp.attention(%L)',jsonb_build_object('action','dismiss','id',current_setting('e2e.wave4.package_issue'),'version',1,'reason','Contacted family')::text),'Informational item can be dismissed with a reason');
select is((pg_temp.attention('{"kind":"package_expiring","queue":"history"}')->'items'->0->>'state'),'dismissed','Dismissal history persists');

select set_config('request.jwt.claim.sub','f0410000-0000-4000-8000-000000000002',true);
select throws_ok($$select pg_temp.report('collections','{"export":true}')$$,'42501','FORBIDDEN','Another studio coach cannot export these records');
select throws_ok('select pg_temp.attention()','42501','FORBIDDEN','Another studio coach cannot read these issues');

select set_config('request.jwt.claim.sub','f0410000-0000-4000-8000-000000000003',true);
select throws_ok($$select pg_temp.report('overview')$$,'42501','FORBIDDEN','Student has no studio report access');
select set_config('request.jwt.claim.sub','f0410000-0000-4000-8000-000000000004',true);
select throws_ok($$select pg_temp.report('overview')$$,'42501','FORBIDDEN','Authorized guardian has no studio report access');
select throws_ok('select pg_temp.attention()','42501','FORBIDDEN','Authorized guardian has no coach issue access');


reset role;
insert into public.booking_services(id,studio_id,name,slug,category,duration_minutes,price_minor)
values
('f0410000-0000-4000-8000-000000000040','f0410000-0000-4000-8000-000000000010','Voice','wave4-voice','private',60,1200),
('f0410000-0000-4000-8000-000000000041','f0410000-0000-4000-8000-000000000010','Acting','wave4-acting','private',60,2200);
insert into public.lessons(id,studio_id,student_id,invoice_id,service_id,topic,starts_at,ends_at,status,location_type,location_label,price_minor,payment_status)
values
('f0410000-0000-4000-8000-000000000042','f0410000-0000-4000-8000-000000000010','f0410000-0000-4000-8000-000000000011','f0410000-0000-4000-8000-000000000013','f0410000-0000-4000-8000-000000000040','Voice',now()+interval '6 days',now()+interval '6 days 1 hour','scheduled','virtual','Synthetic studio',1200,'due'),
('f0410000-0000-4000-8000-000000000043','f0410000-0000-4000-8000-000000000010','f0410000-0000-4000-8000-000000000011','f0410000-0000-4000-8000-000000000013','f0410000-0000-4000-8000-000000000041','Acting',now()+interval '7 days',now()+interval '7 days 1 hour','scheduled','virtual','Synthetic studio',2200,'due');
update public.studio_invoices set items='[
  {"id":"voice","kind":"service","lessonIds":["f0410000-0000-4000-8000-000000000042"],"quantity":1,"unitMinor":1200},
  {"id":"acting","kind":"service","lessonIds":["f0410000-0000-4000-8000-000000000043"],"quantity":1,"unitMinor":2200}
]' where number='WAVE4-INVOICE';
insert into public.invoice_settlements(invoice_id,amount_minor,method,reference,allocations)
values ('f0410000-0000-4000-8000-000000000013',2000,'cash','wave4-partial',
  '[{"lineId":"voice","amountMinor":750},{"lineId":"acting","amountMinor":1250}]');
update public.studios set settings=settings||'{"currency":"USD","trainingAutopay":{"chargeAtLocal":"09:00","minimumLeadDays":0,"maximumLeadDays":7,"maximumLessonMinor":9000}}'
where slug='wave4-report-one';
insert into training_internal.lesson_autopay_mandates(id,studio_id,student_id,payer_id,scope,lead_days,currency,
 maximum_minor,timezone,charge_time,existing_terms,consent_version,authorized_at,status,stripe_method)
values ('f0410000-0000-4000-8000-000000000044','f0410000-0000-4000-8000-000000000010','f0410000-0000-4000-8000-000000000011',
 'f0410000-0000-4000-8000-000000000004','existing',2,'USD',9000,'America/New_York','09:00','{}','test',now(),'active','pm_fixture_only');
insert into training_internal.lesson_autopay_attempts(mandate_id,lesson_id,starts_at,pay_at,amount_minor,terms,state)
select 'f0410000-0000-4000-8000-000000000044',l.id,l.starts_at,
 training_internal.autopay_when(l.starts_at,'America/New_York',2,'09:00'),1200,
 training_internal.autopay_lesson_terms(l.id),'planned' from public.lessons l where l.id='f0410000-0000-4000-8000-000000000042';

set local role authenticated;
select set_config('request.jwt.claim.sub','f0410000-0000-4000-8000-000000000001',true);
select is((select (s->>'gross')::bigint from jsonb_array_elements(pg_temp.report('collections')->'services') s where s->>'service'='Voice'),
  750::bigint,'Single invoice receipt attributes the posted Voice amount to Voice');
select is((select (s->>'gross')::bigint from jsonb_array_elements(pg_temp.report('collections')->'services') s where s->>'service'='Acting'),
  1250::bigint,'Single invoice receipt attributes the posted Acting amount to Acting');
select is((pg_temp.report('collections','{"service":"f0410000-0000-4000-8000-000000000040"}')->'rows'->0->>'amount')::bigint,
  750::bigint,'Service drill-down and export use the allocated share');
select is(pg_temp.metric(pg_temp.report('overview'),'gross','USD'),3000::bigint,'Per-service allocation does not multiply the posted receipt');
select is(pg_temp.metric(pg_temp.report('overview'),'scheduled','USD'),1200::bigint,'A valid future authorized plan is included as scheduled');
reset role;
update training_internal.lesson_autopay_mandates set status='paused' where id='f0410000-0000-4000-8000-000000000044';
insert into public.payment_entries(student_id,amount_minor,kind,currency,created_at,external_reference,reason)
select 'f0410000-0000-4000-8000-000000000011',100,'payment','CAD','2026-03-08T12:00Z','wave4-bulk-'||i,'Large report fixture'
from generate_series(1,5001) i;
set local role authenticated;
select is(pg_temp.metric(pg_temp.report('overview'),'scheduled','USD'),null::bigint,'Paused authorization has no scheduled collections');
select is(jsonb_array_length(pg_temp.report('collections','{"currency":"CAD","page":2}')->'rows'),25,'Large reports return a bounded page');
select is((pg_temp.report('collections','{"currency":"CAD","export":true}')->>'count')::int,5001,'Large export exposes its matching count');
select is(pg_temp.report('collections','{"currency":"CAD","export":true}')->>'csv',null::text,'Oversized export refuses instead of truncating');

select * from finish();
rollback;

