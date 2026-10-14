-- Execute against the full migration chain, never against a linked live DB.
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

select ok(not has_function_privilege('anon','public.student_credit_coverage(uuid,integer,integer,boolean)','EXECUTE'), 'Anonymous coverage RPC access is denied');
select ok(has_function_privilege('authenticated','public.student_credit_coverage(uuid,integer,integer,boolean)','EXECUTE'), 'Authorized identities may invoke the guarded RPC');
select ok(not has_function_privilege('authenticated','credit_internal.evaluate_student_lesson_credit(uuid,uuid,text,jsonb,uuid,boolean)','EXECUTE'), 'The raw eligibility evaluator is not a client API');
select ok(not (select prosecdef from pg_proc where oid='public.student_credit_coverage(uuid,integer,integer,boolean)'::regprocedure), 'Public RPC remains an invoker');
select is((select provolatile::text from pg_proc where oid='public.student_credit_coverage(uuid,integer,integer,boolean)'::regprocedure), 's', 'Coverage is a stable read');

insert into auth.users(id,email) values
 ('71000000-0000-4000-8000-000000000001','e2e-coverage-coach@example.test'),
 ('71000000-0000-4000-8000-000000000002','e2e-coverage-student@example.test'),
 ('71000000-0000-4000-8000-000000000003','e2e-coverage-other@example.test'),
 ('71000000-0000-4000-8000-000000000004','e2e-coverage-finance-guardian@example.test'),
 ('71000000-0000-4000-8000-000000000005','e2e-coverage-work-guardian@example.test'),
 ('71000000-0000-4000-8000-000000000006','e2e-coverage-minor@example.test');
insert into public.studios(id,name,slug) values
 ('72000000-0000-4000-8000-000000000001','Credit coverage SQL fixture','e2e-credit-coverage-sql');
insert into public.memberships(studio_id,user_id,role,display_name) values
 ('72000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000001','coach','Coverage coach');
insert into public.students(id,studio_id,user_id,full_name,is_minor) values
 ('73000000-0000-4000-8000-000000000001','72000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000002','Coverage student',false),
 ('73000000-0000-4000-8000-000000000002','72000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000006','Coverage minor',true);
insert into public.linked_contacts(id,studio_id,student_id,user_id,full_name,email,can_view_finance,can_view_schedule,can_view_work) values
 ('74000000-0000-4000-8000-000000000001','72000000-0000-4000-8000-000000000001','73000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000004','Finance guardian','e2e-coverage-finance-guardian@example.test',true,false,false),
 ('74000000-0000-4000-8000-000000000002','72000000-0000-4000-8000-000000000001','73000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000005','Work guardian','e2e-coverage-work-guardian@example.test',false,true,true);
insert into public.packages(id,student_id,name,expires_at) values
 ('75000000-0000-4000-8000-000000000001','73000000-0000-4000-8000-000000000001','Early expiry',now()+interval '3 days'),
 ('75000000-0000-4000-8000-000000000002','73000000-0000-4000-8000-000000000001','Lasting credits',null);
insert into public.package_credit_entries(package_id,kind,quantity,reason) values
 ('75000000-0000-4000-8000-000000000001','purchase',1,'Coverage test purchase'),
 ('75000000-0000-4000-8000-000000000002','purchase',1,'Coverage test purchase');
insert into public.lessons(id,studio_id,student_id,topic,starts_at,ends_at,status,location_type,location_label,payment_status) values
 ('76000000-0000-4000-8000-000000000001','72000000-0000-4000-8000-000000000001','73000000-0000-4000-8000-000000000001','First lesson',now()+interval '1 day',now()+interval '1 day 1 hour','scheduled','virtual','Meet','due'),
 ('76000000-0000-4000-8000-000000000002','72000000-0000-4000-8000-000000000001','73000000-0000-4000-8000-000000000001','Later lesson',now()+interval '5 days',now()+interval '5 days 1 hour','scheduled','virtual','Meet','due'),
 ('76000000-0000-4000-8000-000000000003','72000000-0000-4000-8000-000000000001','73000000-0000-4000-8000-000000000001','Uncovered lesson',now()+interval '6 days',now()+interval '6 days 1 hour','scheduled','virtual','Meet','due');

create temporary table coverage_baseline as select
 (select jsonb_agg(to_jsonb(e) order by e.id) from public.package_credit_entries e where e.package_id in ('75000000-0000-4000-8000-000000000001','75000000-0000-4000-8000-000000000002')) ledger,
 (select jsonb_agg(to_jsonb(l) order by l.id) from public.lessons l where l.studio_id='72000000-0000-4000-8000-000000000001') lessons,
 (select public.student_credit_summary('73000000-0000-4000-8000-000000000001')) summary;

set local role authenticated;
select set_config('request.jwt.claim.sub','71000000-0000-4000-8000-000000000001',true);
select is(public.student_credit_coverage('73000000-0000-4000-8000-000000000001')->'items'->0->>'reasonCode','auto_disabled','Disabled preference is explained');
select is(public.student_credit_coverage('73000000-0000-4000-8000-000000000001',1,1,true)->'items'->0->>'packageId','75000000-0000-4000-8000-000000000001','Preview chooses earliest valid expiry');
select is(public.student_credit_coverage('73000000-0000-4000-8000-000000000001',2,1,true)->'items'->0->>'packageId','75000000-0000-4000-8000-000000000002','Second page preserves first-page allocation');
select is(public.student_credit_coverage('73000000-0000-4000-8000-000000000001',3,1,true)->'items'->0->>'reasonCode','no_available_credits','Limited credits do not cover a third lesson');
select is(public.student_credit_coverage('73000000-0000-4000-8000-000000000001',2,1,true)->'counts'->>'eligible','2','Counts cover the full set, not just this page');
select ok(public.student_credit_coverage('73000000-0000-4000-8000-000000000001',1,1,true)->'summary'->'lots' is null,'Coverage does not return unbounded lot histories');
select throws_ok($$select public.student_credit_coverage('73000000-0000-4000-8000-000000000001',0,25)$$,'22023',null,'Invalid page fails explicitly');
select throws_ok($$select public.student_credit_coverage('73000000-0000-4000-8000-000000000001',1,101)$$,'22023',null,'Oversized page fails explicitly');
select throws_ok($$select credit_internal.evaluate_student_lesson_credit('73000000-0000-4000-8000-000000000001','76000000-0000-4000-8000-000000000001')$$,'42501',null,'Authenticated role cannot bypass the read facade');

reset role;
select is((select jsonb_agg(to_jsonb(e) order by e.id) from public.package_credit_entries e where e.package_id in ('75000000-0000-4000-8000-000000000001','75000000-0000-4000-8000-000000000002')),(select ledger from coverage_baseline),'Preview leaves ledger bytes unchanged');
select is((select jsonb_agg(to_jsonb(l) order by l.id) from public.lessons l where l.studio_id='72000000-0000-4000-8000-000000000001'),(select lessons from coverage_baseline),'Preview leaves lesson versions and payments unchanged');
select is(public.student_credit_summary('73000000-0000-4000-8000-000000000001'),(select summary from coverage_baseline),'Preview leaves preference and account version unchanged');

-- Reserve using the same evaluator and established financial commands.
select is(public.reserve_student_lesson_credit('76000000-0000-4000-8000-000000000001','73000000-0000-4000-8000-000000000001',null,true),'75000000-0000-4000-8000-000000000001'::uuid,'Manual reservation uses the same earliest-expiry selection');
set local role authenticated;
select set_config('request.jwt.claim.sub','71000000-0000-4000-8000-000000000002',true);
select is(public.student_credit_coverage('73000000-0000-4000-8000-000000000001')->'items'->0->>'state','covered','Adult student sees their existing reservation');
select is(public.student_credit_coverage('73000000-0000-4000-8000-000000000001')->'summary'->>'reserved','1','Account shows one reservation');

select set_config('request.jwt.claim.sub','71000000-0000-4000-8000-000000000004',true);
select is((select count(*) from public.lessons where studio_id='72000000-0000-4000-8000-000000000001'),0::bigint,'Finance-only guardian cannot read lesson logistics');
select is(public.student_credit_coverage('73000000-0000-4000-8000-000000000001')->'summary'->>'reserved','1','Finance-only guardian gets authoritative reserved totals despite lesson RLS');
select is(jsonb_array_length(public.student_credit_coverage('73000000-0000-4000-8000-000000000001')->'items'),0,'Finance-only guardian receives no lesson details');
select is(public.student_credit_coverage('73000000-0000-4000-8000-000000000001')->'counts','null'::jsonb,'Hidden logistics do not appear as misleading zero counts');

select set_config('request.jwt.claim.sub','71000000-0000-4000-8000-000000000005',true);
select throws_ok($$select public.student_credit_coverage('73000000-0000-4000-8000-000000000001')$$,'42501','FORBIDDEN','Work-only guardian cannot read financial coverage');
select set_config('request.jwt.claim.sub','71000000-0000-4000-8000-000000000003',true);
select throws_ok($$select public.student_credit_coverage('73000000-0000-4000-8000-000000000001')$$,'42501','FORBIDDEN','Unrelated identity cannot read coverage');
select throws_ok($$select credit_internal.read_student_credit_coverage('73000000-0000-4000-8000-000000000001',1,25,false)$$,'42501','FORBIDDEN','Private facade also validates ownership');
select set_config('request.jwt.claim.sub','71000000-0000-4000-8000-000000000006',true);
select throws_ok($$select public.student_credit_coverage('73000000-0000-4000-8000-000000000002')$$,'42501','FORBIDDEN','Minor login does not expose finance');

reset role;
update public.linked_contacts set portal_enabled=false where id='74000000-0000-4000-8000-000000000001';
set local role authenticated;
select set_config('request.jwt.claim.sub','71000000-0000-4000-8000-000000000004',true);
select throws_ok($$select public.student_credit_coverage('73000000-0000-4000-8000-000000000001')$$,'42501','FORBIDDEN','Revoking guardian access blocks subsequent reads');
reset role;
update public.students set portal_enabled=false where id='73000000-0000-4000-8000-000000000001';
set local role authenticated;
select set_config('request.jwt.claim.sub','71000000-0000-4000-8000-000000000002',true);
select throws_ok($$select public.student_credit_coverage('73000000-0000-4000-8000-000000000001')$$,'42501','FORBIDDEN','Disabled student workspace blocks direct RPC access');
reset role;
update public.students set portal_enabled=true where id='73000000-0000-4000-8000-000000000001';

-- Characterization: existing scans overcount existing reservations. PR 1
-- documents this without changing counts or enabling automatic use.
select is(public.reserve_student_upcoming_credits('73000000-0000-4000-8000-000000000001')->>'applied','0','Repeated scan reports no new reservations');
select is((select count(*) from public.package_credit_entries where lesson_id='76000000-0000-4000-8000-000000000001'),1::bigint,'Repeated scan still does not double-debit');

-- Characterize recurring conversion against the actual full-schema function.
select set_config('request.jwt.claim.sub','71000000-0000-4000-8000-000000000001',true);
update public.student_credit_accounts set auto_apply=true where student_id='73000000-0000-4000-8000-000000000001';
insert into public.package_credit_entries(package_id,kind,quantity,reason) values('75000000-0000-4000-8000-000000000002','adjustment',5,'Recurring characterization');
select lives_ok($$select public.command_make_lesson_recurring('76000000-0000-4000-8000-000000000002',1,'weekly',3,'America/New_York')$$,'Actual recurring conversion succeeds');
select is((select count(*) from public.lessons where series_id=(select series_id from public.lessons where id='76000000-0000-4000-8000-000000000002')),3::bigint,'Recurring conversion creates three occurrences');
select is((select count(*) from public.package_credit_entries where lesson_id in (select id from public.lessons where series_id=(select series_id from public.lessons where id='76000000-0000-4000-8000-000000000002'))),3::bigint,'Recurring conversion immediately reserves three occurrences');
select ok((public.student_credit_coverage('73000000-0000-4000-8000-000000000001')->'counts'->>'covered')::integer >= 3,'Diagnostics agree on covered recurring occurrences');
select * from finish();
rollback;
