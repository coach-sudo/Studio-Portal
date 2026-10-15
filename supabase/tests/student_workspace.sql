-- Execute against the full migration chain, never against a linked live DB.
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

insert into auth.users(id,email) values
 ('d1000000-0000-4000-8000-000000000001','e2e-workspace-coach@example.test'),
 ('d1000000-0000-4000-8000-000000000002','e2e-workspace-student@example.test'),
 ('d1000000-0000-4000-8000-000000000003','e2e-workspace-other@example.test'),
 ('d1000000-0000-4000-8000-000000000004','e2e-workspace-finance-guardian@example.test'),
 ('d1000000-0000-4000-8000-000000000005','e2e-workspace-work-guardian@example.test'),
 ('d1000000-0000-4000-8000-000000000006','e2e-workspace-minor@example.test');
insert into public.studios(id,name,slug) values
 ('d2000000-0000-4000-8000-000000000001','Credit coverage SQL fixture','e2e-workspace-sql');
insert into public.memberships(studio_id,user_id,role,display_name) values
 ('d2000000-0000-4000-8000-000000000001','d1000000-0000-4000-8000-000000000001','coach','Coverage coach');
insert into public.students(id,studio_id,user_id,full_name,is_minor) values
 ('d3000000-0000-4000-8000-000000000001','d2000000-0000-4000-8000-000000000001','d1000000-0000-4000-8000-000000000002','Coverage student',false),
 ('d3000000-0000-4000-8000-000000000002','d2000000-0000-4000-8000-000000000001','d1000000-0000-4000-8000-000000000006','Coverage minor',true);
insert into public.linked_contacts(id,studio_id,student_id,user_id,full_name,email,can_view_finance,can_view_schedule,can_view_work) values
 ('d4000000-0000-4000-8000-000000000001','d2000000-0000-4000-8000-000000000001','d3000000-0000-4000-8000-000000000001','d1000000-0000-4000-8000-000000000004','Finance guardian','e2e-workspace-finance-guardian@example.test',true,false,false),
 ('d4000000-0000-4000-8000-000000000002','d2000000-0000-4000-8000-000000000001','d3000000-0000-4000-8000-000000000001','d1000000-0000-4000-8000-000000000005','Work guardian','e2e-workspace-work-guardian@example.test',false,true,true);
insert into public.packages(id,student_id,name,expires_at) values
 ('d5000000-0000-4000-8000-000000000001','d3000000-0000-4000-8000-000000000001','Early expiry',now()+interval '3 days'),
 ('d5000000-0000-4000-8000-000000000002','d3000000-0000-4000-8000-000000000001','Lasting credits',null);
insert into public.package_credit_entries(package_id,kind,quantity,reason) values
 ('d5000000-0000-4000-8000-000000000001','purchase',1,'Coverage test purchase'),
 ('d5000000-0000-4000-8000-000000000002','purchase',1,'Coverage test purchase');
insert into public.lessons(id,studio_id,student_id,topic,starts_at,ends_at,status,location_type,location_label,payment_status) values
 ('d6000000-0000-4000-8000-000000000001','d2000000-0000-4000-8000-000000000001','d3000000-0000-4000-8000-000000000001','First lesson',now()+interval '1 day',now()+interval '1 day 1 hour','scheduled','virtual','Meet','due'),
 ('d6000000-0000-4000-8000-000000000002','d2000000-0000-4000-8000-000000000001','d3000000-0000-4000-8000-000000000001','Later lesson',now()+interval '5 days',now()+interval '5 days 1 hour','scheduled','virtual','Meet','due'),
 ('d6000000-0000-4000-8000-000000000003','d2000000-0000-4000-8000-000000000001','d3000000-0000-4000-8000-000000000001','Uncovered lesson',now()+interval '6 days',now()+interval '6 days 1 hour','scheduled','virtual','Meet','due');


update public.lessons set price_minor=1000 where studio_id='d2000000-0000-4000-8000-000000000001';
update public.lessons set payment_status='partially_paid',paid_minor=250 where id='d6000000-0000-4000-8000-000000000002';
insert into public.notes(lesson_id,student_id,title,body,status) values
 ('d6000000-0000-4000-8000-000000000001','d3000000-0000-4000-8000-000000000001','Private draft','PRIVATE TAKEAWAY','draft');
create temp table workspace_baseline as select (select jsonb_agg(to_jsonb(x)) from public.package_credit_entries x) ledger;
set local role authenticated;
select set_config('request.jwt.claim.sub','d1000000-0000-4000-8000-000000000001',true);
select is(public.student_workspace_summary('d3000000-0000-4000-8000-000000000001')->'nextLesson'->>'id','d6000000-0000-4000-8000-000000000001','Overview links the exact chronological lesson');
select is(public.student_workspace_summary('d3000000-0000-4000-8000-000000000001')->'latestNote'->>'takeaway','PRIVATE TAKEAWAY','Coach sees the latest relevant private takeaway');
select is(public.student_financial_overview('d3000000-0000-4000-8000-000000000001')->'balances'->0->>'dueMinor','2750','Summary includes partial obligations without netting lesson credits');
select is(public.student_financial_overview('d3000000-0000-4000-8000-000000000002')->'balances'->0->>'dueMinor','0','Empty records have an authoritative zero obligation');
select is(public.student_workspace_summary('d3000000-0000-4000-8000-000000000002')->'latestNote','null'::jsonb,'Empty student has no borrowed note');
select set_config('request.jwt.claim.sub','d1000000-0000-4000-8000-000000000004',true);
select is((select count(*) from public.lessons where studio_id='d2000000-0000-4000-8000-000000000001'),0::bigint,'Finance-only guardian cannot read lesson logistics');
select is(public.student_financial_overview('d3000000-0000-4000-8000-000000000001')->'balances'->0->>'dueMinor','2750','Guardian gets complete totals despite schedule RLS');
select ok(position('PRIVATE TAKEAWAY' in public.student_financial_overview('d3000000-0000-4000-8000-000000000001')::text)=0,'Finance response contains no private note');
select ok(not (public.student_financial_overview('d3000000-0000-4000-8000-000000000001') ? 'lessons'),'Finance response exposes no lesson collection');
select throws_ok($$select public.student_workspace_summary('d3000000-0000-4000-8000-000000000001')$$,'P0001','FORBIDDEN','Finance guardian cannot call the coach summary');
select is(jsonb_array_length(public.student_credit_history('d3000000-0000-4000-8000-000000000001')->'items'),2,'Finance guardian can inspect their ledger without lesson logistics');
select set_config('request.jwt.claim.sub','d1000000-0000-4000-8000-000000000002',true);
select lives_ok($$select public.student_financial_overview('d3000000-0000-4000-8000-000000000001')$$,'Adult student can read their totals');
select throws_ok($$select public.student_workspace_summary('d3000000-0000-4000-8000-000000000001')$$,'P0001','FORBIDDEN','Student cannot read coach-private summary');
select set_config('request.jwt.claim.sub','d1000000-0000-4000-8000-000000000005',true);
select throws_ok($$select public.student_financial_overview('d3000000-0000-4000-8000-000000000001')$$,'42501','FORBIDDEN','Work-only guardian cannot read totals');
select set_config('request.jwt.claim.sub','d1000000-0000-4000-8000-000000000003',true);
select throws_ok($$select public.student_credit_history('d3000000-0000-4000-8000-000000000001')$$,'42501','FORBIDDEN','Unrelated actor cannot read credit history');
select set_config('request.jwt.claim.sub','d1000000-0000-4000-8000-000000000006',true);
select throws_ok($$select public.student_financial_overview('d3000000-0000-4000-8000-000000000002')$$,'42501','FORBIDDEN','Minor finance remains restricted');
reset role;
update public.linked_contacts set portal_enabled=false where id='d4000000-0000-4000-8000-000000000001';
set local role authenticated;
select set_config('request.jwt.claim.sub','d1000000-0000-4000-8000-000000000004',true);
select throws_ok($$select public.student_financial_overview('d3000000-0000-4000-8000-000000000001')$$,'42501','FORBIDDEN','Revoked contact cannot read totals');
reset role;
select is((select jsonb_agg(to_jsonb(x)) from public.package_credit_entries x),(select ledger from workspace_baseline),'Summary and history reads leave ledger bytes unchanged');
select ok(not has_function_privilege('anon','public.student_workspace_summary(uuid)','EXECUTE'),'Anonymous summary privilege is revoked');
select ok(not (select prosecdef from pg_proc where oid='public.student_financial_overview(uuid)'::regprocedure),'Public financial facade remains invoker');
select * from finish();
rollback;
