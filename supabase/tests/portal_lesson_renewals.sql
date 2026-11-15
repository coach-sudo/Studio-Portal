begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select plan(11);
insert into auth.users(id,email) values
 ('d1000000-0000-4000-8000-000000000001','renewal-student@example.test'),
 ('d1000000-0000-4000-8000-000000000002','renewal-payer@example.test'),
 ('d1000000-0000-4000-8000-000000000003','renewal-unrelated@example.test');
insert into studios(id,name,slug) values ('d2000000-0000-4000-8000-000000000001','Renewal fixture','e2e-renewal-fixture');
insert into students(id,studio_id,user_id,full_name) values
 ('d3000000-0000-4000-8000-000000000001','d2000000-0000-4000-8000-000000000001','d1000000-0000-4000-8000-000000000001','Renewal student');
insert into booking_services(id,studio_id,slug,name,category,duration_minutes) values
 ('d4000000-0000-4000-8000-000000000001','d2000000-0000-4000-8000-000000000001','coaching','Coaching','private',60),
 ('d4000000-0000-4000-8000-000000000002','d2000000-0000-4000-8000-000000000001','audition','Audition','private',60);
insert into lessons(id,studio_id,service_id,student_id,topic,status,location_type,location_label,starts_at,ends_at)
values('d5000000-0000-4000-8000-000000000001','d2000000-0000-4000-8000-000000000001',
'd4000000-0000-4000-8000-000000000001','d3000000-0000-4000-8000-000000000001','Upcoming coaching','scheduled','virtual','Meet',now()+interval '5 days',now()+interval '5 days 1 hour');
insert into bookings(id,studio_id,service_id,student_id,reference,guest_name,guest_email,starts_at,ends_at,timezone,location,status,payment_policy,total_minor,policy_snapshot,manage_token_hash)
values('d6000000-0000-4000-8000-000000000001','d2000000-0000-4000-8000-000000000001',
'd4000000-0000-4000-8000-000000000001','d3000000-0000-4000-8000-000000000001','e2e-renewal','Renewal student','renewal-student@example.test',
now()+interval '5 days',now()+interval '5 days 1 hour','America/New_York','google_meet','confirmed','credits',0,'{}','e2e-stage-c-renewal-token');
insert into lesson_participants(lesson_id,booking_id,student_id,display_name,email)
values('d5000000-0000-4000-8000-000000000001','d6000000-0000-4000-8000-000000000001','d3000000-0000-4000-8000-000000000001','Renewal student','renewal-student@example.test');
insert into package_definitions(id,studio_id,name,session_count,session_duration_minutes,price_minor,eligible_service_ids,expiration_days,visibility,direct_purchase)
select ('d7000000-0000-4000-8000-00000000000'||n)::uuid,'d2000000-0000-4000-8000-000000000001',
'Renewal definition '||n,1,case when n=2 then 30 else 60 end,10000,
array[(case when n=3 then 'd4000000-0000-4000-8000-000000000002' else 'd4000000-0000-4000-8000-000000000001' end)::uuid],
case when n=4 then 2 else 30 end,'public',true from generate_series(1,5) n;
insert into package_billing_options(studio_id,definition_id,renewal_mode,stripe_price_id)
select 'd2000000-0000-4000-8000-000000000001',('d7000000-0000-4000-8000-00000000000'||n)::uuid,
'one_time','price_stage_c_fixture_'||n from generate_series(1,4) n;
create function pg_temp.renewals() returns jsonb language sql as $$
select portal_renewal_options('d3000000-0000-4000-8000-000000000001','d5000000-0000-4000-8000-000000000001')
$$;
set local request.jwt.claim.sub='d1000000-0000-4000-8000-000000000001';
select is(pg_temp.renewals()->>'canPurchase','true','Independent adult has checkout access');
select is(pg_temp.renewals()->'definitionIds','["d7000000-0000-4000-8000-000000000001"]'::jsonb,
  'Only exact duration and service with valid expiry and checkout survive');
insert into linked_contacts(studio_id,student_id,user_id,full_name,email,relationship_type,portal_enabled,can_view_finance,can_view_schedule,is_primary_payer)
values('d2000000-0000-4000-8000-000000000001','d3000000-0000-4000-8000-000000000001','d1000000-0000-4000-8000-000000000002','Billing contact','renewal-payer@example.test','guardian',true,true,true,true);
select is(pg_temp.renewals()->>'canPurchase','false','Designated billing contact owns renewal');
set local request.jwt.claim.sub='d1000000-0000-4000-8000-000000000002';
select is(pg_temp.renewals()->>'canPurchase','true','Authorized billing guardian has access');
update linked_contacts set is_primary_payer=false where student_id='d3000000-0000-4000-8000-000000000001';
select is(pg_temp.renewals()->>'canPurchase','false','Finance visibility alone does not authorize purchasing');
set local request.jwt.claim.sub='d1000000-0000-4000-8000-000000000003';
select throws_ok('select pg_temp.renewals()','P0001','FORBIDDEN','Unrelated identity cannot query eligibility');
set local request.jwt.claim.sub='d1000000-0000-4000-8000-000000000001';
update bookings set payment_policy='pay_later' where id='d6000000-0000-4000-8000-000000000001';
select is(pg_temp.renewals()->'definitionIds','[]'::jsonb,'Separate payment gets no credit renewal recommendation');
select ok(not has_function_privilege('anon','public.portal_renewal_options(uuid,uuid)','EXECUTE'),'Anonymous callers cannot query protected eligibility');
update bookings set payment_policy='credits' where id='d6000000-0000-4000-8000-000000000001';
insert into student_credit_accounts(student_id,auto_apply)
values('d3000000-0000-4000-8000-000000000001',true)
on conflict(student_id) do update set auto_apply=true;
insert into packages(id,student_id,definition_id,name,credit_quantity)
values('d8000000-0000-4000-8000-000000000001','d3000000-0000-4000-8000-000000000001',
 'd7000000-0000-4000-8000-000000000001','Issued renewal',1);
select is(process_stripe_checkout('evt_stage_c_verified','checkout.session.completed',
 '{"data":{"object":{"id":"cs_stage_c_verified","payment_intent":"pi_stage_c_verified"}}}',
 'cs_stage_c_verified','d3000000-0000-4000-8000-000000000001','d8000000-0000-4000-8000-000000000001',
 10000,'USD')->>'duplicate','false','Verified issuance records one purchase');
select is((student_credit_coverage('d3000000-0000-4000-8000-000000000001',1,5,false)->'items'->0)->>'coverageStatus',
 'covered','Verified issuance reserves credit without a new booking');
select is(pg_temp.renewals()->'definitionIds','[]'::jsonb,'Covered lesson no longer offers contextual renewal');
select * from finish();
rollback;
