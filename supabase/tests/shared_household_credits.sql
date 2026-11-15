begin;
create extension if not exists pgtap with schema extensions;
set search_path=public,extensions;
select plan(95);

insert into auth.users(id,email)
select md5('shared-user-'||n)::uuid,'shared-role-'||n||'@example.test' from generate_series(1,5) n;
insert into studios(id,name,slug) values(md5('shared-studio')::uuid,'Shared tests','shared-credit-test');
insert into memberships(studio_id,user_id,role,display_name)
values(md5('shared-studio')::uuid,md5('shared-user-1')::uuid,'coach','Coach');
insert into students(id,studio_id,user_id,full_name,portal_enabled)
select md5('shared-student-'||n)::uuid,md5('shared-studio')::uuid,
  case when n=1 then md5('shared-user-2')::uuid when n=3 then md5('shared-user-4')::uuid end,
  'Student '||n,true from generate_series(1,3) n;
insert into linked_contacts(studio_id,student_id,user_id,full_name,email,portal_enabled,can_view_finance,can_view_schedule)
select md5('shared-studio')::uuid,md5('shared-student-'||n)::uuid,md5('shared-user-3')::uuid,
  'Guardian','guardian@example.test',true,true,true from generate_series(1,2) n;
insert into linked_contacts(studio_id,student_id,user_id,full_name,email,portal_enabled,can_view_finance,can_view_schedule)
values(md5('shared-studio')::uuid,md5('shared-student-1')::uuid,md5('shared-user-5')::uuid,'Schedule only','schedule@example.test',true,false,true);
insert into booking_services(id,studio_id,slug,name,category,duration_minutes)
select md5('shared-service-'||n)::uuid,md5('shared-studio')::uuid,'shared-service-'||n,'Service '||n,'private',60
from generate_series(1,2)n;
insert into package_definitions(id,studio_id,name,session_count,session_duration_minutes,price_minor,eligible_service_ids,expiration_days)
values(md5('shared-definition')::uuid,md5('shared-studio')::uuid,'Shared coaching',3,60,30000,
  array[md5('shared-service-1')::uuid],30);
create function pg_temp.h(p_action text,p_value jsonb default '{}') returns jsonb language sql as $$
  select public.household_credit_access(md5('shared-student-1')::uuid,p_action,p_value)
$$;
set local role authenticated;
select set_config('request.jwt.claim.sub',md5('shared-user-1')::uuid::text,true);
select lives_ok($$select pg_temp.h('create_household',jsonb_build_object(
  'key','household-create-test','name','Family test','reason','Verified household',
  'members',array[md5('shared-student-1')::uuid,md5('shared-student-2')::uuid]))$$,'Coach creates an explicit household');
select lives_ok($$select pg_temp.h('configure_definition',jsonb_build_object(
  'key','household-policy-test','definitionId',md5('shared-definition')::uuid,'reason','Approved terms',
  'shared',true,'transfer',true))$$,'Coach records explicit sharing and transfer terms');
reset role;

create function pg_temp.household() returns uuid language sql security definer set search_path='' as $$
  select id from credit_internal.credit_households where name='Family test'
$$;
create function pg_temp.pool() returns uuid language sql security definer set search_path='' as $$
  select p.id from public.packages p where p.household_id=pg_temp.household()
    and p.transferred_from_package_id is null
$$;
create function pg_temp.member_value(n integer,eligible boolean) returns jsonb language sql as $$
  select jsonb_build_object('packageId',pg_temp.pool(),'studentId',md5('shared-student-'||n)::uuid,'eligible',eligible)
$$;
create function pg_temp.member_apply(n integer,eligible boolean,p_key text) returns jsonb language plpgsql as $$
declare v jsonb:=pg_temp.member_value(n,eligible);
begin
  return pg_temp.h('membership_apply',v||jsonb_build_object('key',p_key,'reason','Reviewed eligible student',
    'preview',pg_temp.h('membership_preview',v)-'status'-'canApply'));
end $$;
set local role authenticated;
select lives_ok($$select pg_temp.h('issue',jsonb_build_object('key','household-issue-test',
  'definitionId',md5('shared-definition')::uuid,'householdId',pg_temp.household(),'reason','Shared studio grant'))$$,
  'Coach issues a household-owned lot under approved terms');
select lives_ok($$select pg_temp.h('issue',jsonb_build_object('key','household-issue-test',
  'definitionId',md5('shared-definition')::uuid,'householdId',pg_temp.household(),'reason','Shared studio grant'))$$,
  'Exact issuance replay succeeds');
select is(pg_temp.member_apply(1,true,'member-first-add')->>'status','completed','First explicit pool member added');
select is(pg_temp.member_apply(2,true,'member-second-add')->>'status','completed','Second explicit pool member added');
select throws_ok($$select pg_temp.h('membership_preview',pg_temp.member_value(3,true))$$,'P0001','FORBIDDEN','Unrelated student cannot join the pool');
reset role;
select is((select student_id from packages where id=pg_temp.pool()),null::uuid,'Shared lot has no student owner');
select is(package_credit_balance(pg_temp.pool()),3,'Issuance replay created exactly three credits');
select ok((select issuance_entry_id is not null and original_household_id=pg_temp.household()
 from credit_internal.package_credit_terms where package_id=pg_temp.pool()),'Shared issuance has original terms and provenance');

insert into lessons(id,studio_id,student_id,topic,starts_at,ends_at,status,location_type,location_label,service_id)
select md5('shared-lesson-'||n)::uuid,md5('shared-studio')::uuid,md5('shared-student-'||case when n=2 then 2 when n=3 then 3 else 1 end)::uuid,
  'Shared lesson '||n,now()+make_interval(days=>n),now()+make_interval(days=>n,mins=>case when n=4 then 30 else 60 end),
  'scheduled','virtual','Meet',md5('shared-service-'||case when n=5 then 2 else 1 end)::uuid
from generate_series(1,6)n;
update package_definitions set visibility='public',direct_purchase=true where id=md5('shared-definition')::uuid;
insert into package_billing_options(studio_id,definition_id,renewal_mode,stripe_price_id)
values(md5('shared-studio')::uuid,md5('shared-definition')::uuid,'one_time','price_shared_renewal_fixture');
insert into bookings(id,studio_id,service_id,student_id,reference,guest_name,guest_email,starts_at,
  ends_at,timezone,location,status,payment_policy,total_minor,policy_snapshot,manage_token_hash)
select md5('shared-renewal-booking')::uuid,studio_id,service_id,student_id,'shared-renewal-test','Student 1',
  'shared-role-2@example.test',starts_at,ends_at,'America/New_York','google_meet','confirmed','credits',0,'{}','shared-renewal-token'
from lessons where id=md5('shared-lesson-1')::uuid;
insert into lesson_participants(lesson_id,booking_id,student_id,display_name,email)
values(md5('shared-lesson-1')::uuid,md5('shared-renewal-booking')::uuid,md5('shared-student-1')::uuid,
  'Student 1','shared-role-2@example.test');
insert into student_credit_accounts(student_id,auto_apply) values(md5('shared-student-1')::uuid,true);
create function pg_temp.renewals() returns jsonb language sql as $$
  select portal_renewal_options(md5('shared-student-1')::uuid,md5('shared-lesson-1')::uuid)
$$;
set local request.jwt.claim.sub to '';
select set_config('request.jwt.claim.sub',md5('shared-user-2')::uuid::text,true);
select is(pg_temp.renewals()->'definitionIds','[]'::jsonb,'Compatible unreserved shared credit suppresses checkout recommendations');
select is((student_credit_coverage(md5('shared-student-1')::uuid,1,10,false)->'items'->0)->>'coverageStatus',
  'awaiting_reservation','Portal reports an eligible unreserved shared credit separately');
select set_config('request.jwt.claim.sub',md5('shared-user-1')::uuid::text,true);
select is(booking_credit_preflight(md5('shared-student-1')::uuid,md5('shared-service-1')::uuid,array[now()+interval '1 day'])->>'status',
  'eligible','Booking preflight can see an eligible shared credit');
select is(booking_credit_preflight(md5('shared-student-3')::uuid,md5('shared-service-1')::uuid,array[now()+interval '1 day'])->>'status',
  'needs_credit','Public preflight respects explicit membership');
select is(booking_credit_preflight(md5('shared-student-1')::uuid,md5('shared-service-1')::uuid,array[now()+interval '31 days'])->>'status',
  'needs_credit','Booking preflight respects shared expiration');
create function pg_temp.reserve(n integer,student integer) returns uuid language sql as $$
  select public.reserve_student_lesson_credit(md5('shared-lesson-'||n)::uuid,md5('shared-student-'||student)::uuid,null,true)
$$;
select is(pg_temp.reserve(3,3),null::uuid,'Nonmember cannot reserve');
select is(pg_temp.reserve(4,1),null::uuid,'Shorter lesson cannot consume a shared credit');
select is(pg_temp.reserve(5,1),null::uuid,'Another service cannot consume a shared credit');
select is(pg_temp.reserve(1,1),pg_temp.pool(),'First student reserves one credit');
select is(pg_temp.reserve(1,1),pg_temp.pool(),'Reservation replay identifies the existing hold');
select is(pg_temp.reserve(2,2),pg_temp.pool(),'Second member creates a separately attributed hold');
select is(package_credit_balance(pg_temp.pool()),1,'Only two credits have been reserved');
select is((credit_internal.evaluate_student_lesson_credit(md5('shared-student-1')::uuid,
  md5('shared-lesson-1')::uuid,'manual')->>'state'),'covered','The existing shared reservation is authoritative coverage');
select is((student_credit_coverage(md5('shared-student-1')::uuid,1,10,false)->'items'->0)->>'coverageStatus',
  'covered','Portal reports coverage after the shared reservation exists');
select is((credit_internal.evaluate_student_lesson_credit(md5('shared-student-1')::uuid,
  md5('shared-lesson-6')::uuid,'manual')->>'state'),'eligible_unreserved','Available shared credit is not a confirmed reservation');
set local role authenticated;
select ok(not (pg_temp.h('membership_preview',pg_temp.member_value(1,false))->>'canApply')::boolean,
  'Member removal is blocked while a reservation exists');
select is(pg_temp.h('membership_preview',pg_temp.member_value(1,false))#>>'{conflicts,0,topic}','Shared lesson 1','Preview identifies the affected lesson');
reset role;
select throws_ok($$update lessons set ends_at=starts_at+interval '30 minutes'
  where id=md5('shared-lesson-1')::uuid$$,'P0001',null,'Incompatible reschedule is blocked');
update lessons set starts_at=starts_at+interval '1 hour',ends_at=ends_at+interval '1 hour' where id=md5('shared-lesson-1')::uuid;
select is(package_credit_balance(pg_temp.pool()),1,'Compatible reschedule preserves reservations');
update lessons set status='completed' where id=md5('shared-lesson-1')::uuid;
select is((select used_by_student_id from package_credit_entries where package_id=pg_temp.pool()
  and lesson_id=md5('shared-lesson-1')::uuid and kind='consumption'),md5('shared-student-1')::uuid,
  'Completion records the specific student');
select is(package_credit_balance(pg_temp.pool()),1,'Completion consumes the existing debit without another deduction');
select lives_ok($$select settle_lesson_credits(md5('shared-lesson-2')::uuid,false,md5('shared-student-2')::uuid)$$,
  'Timely cancellation settles the specific student');
select is(package_credit_balance(pg_temp.pool()),2,'Timely cancellation returns the credit to the household');
select is(pg_temp.reserve(6,1),pg_temp.pool(),'A returned credit is available on another lesson');
select lives_ok($$select settle_lesson_credits(md5('shared-lesson-6')::uuid,true,md5('shared-student-1')::uuid)$$,
  'Chargeable cancellation consumes the reservation');
select lives_ok($$select settle_lesson_credits(md5('shared-lesson-6')::uuid,true,md5('shared-student-1')::uuid)$$,
  'Chargeable cancellation replay is safe');
select is((select count(*) from package_credit_entries where package_id=pg_temp.pool() and kind='consumption'),2::bigint,
  'Exactly two credit uses are recorded');

set local role authenticated;
select set_config('request.jwt.claim.sub',md5('shared-user-3')::uuid::text,true);
select is(jsonb_array_length(pg_temp.h('portal',jsonb_build_object('studentIds',
  array[md5('shared-student-1')::uuid,md5('shared-student-2')::uuid]))),1,'Guardian receives one shared balance across both students');
select is(pg_temp.h('portal')->0->>'consumed','2','Authorized guardian sees attributed shared usage');
select is((select count(*) from package_credit_entries where package_id=pg_temp.pool()),0::bigint,'Portal cannot read raw audit or ledger details');
select throws_ok($$select pg_temp.h('membership_preview',pg_temp.member_value(1,false))$$,'42501','FORBIDDEN','Guardian cannot modify membership');
select throws_ok($$select pg_temp.h('transfer_preview','{}')$$,'42501','FORBIDDEN','Guardian cannot transfer a credit');
select set_config('request.jwt.claim.sub',md5('shared-user-2')::uuid::text,true);
select is(jsonb_array_length(pg_temp.h('portal')->0->'members'),1,'Student sees only finance-authorized member identity');
select set_config('request.jwt.claim.sub',md5('shared-user-5')::uuid::text,true);
select throws_ok($$select pg_temp.h('portal')$$,'42501','FORBIDDEN','Schedule-only guardian cannot read credit pools');
select set_config('request.jwt.claim.sub',md5('shared-user-4')::uuid::text,true);
select throws_ok($$select pg_temp.h('portal')$$,'42501','FORBIDDEN','Unrelated student cannot read household balances');
select set_config('request.jwt.claim.sub',md5('shared-user-1')::uuid::text,true);
select is(pg_temp.member_apply(1,false,'member-first-remove')->>'status','completed','Consumed credit history does not prevent member removal');
reset role;
select is((select count(*) from credit_internal.shared_pool_usage(pg_temp.pool()) where student_id=md5('shared-student-1')::uuid and consumed=1),
  2::bigint,'Removing eligibility retains historical student attribution');

create function pg_temp.transfer_value(n integer,qty integer) returns jsonb language sql as $$
  select jsonb_build_object('packageId',pg_temp.pool(),'studentId',md5('shared-student-'||n)::uuid,'quantity',qty)
$$;
create function pg_temp.transfer_apply(p_value jsonb,p_key text,p_preview jsonb default null) returns jsonb language sql as $$
  select pg_temp.h('transfer_apply',p_value||jsonb_build_object('key',p_key,'reason','Authorized package transfer',
    'preview',coalesce(p_preview,pg_temp.h('transfer_preview',p_value)-'status'-'canApply')))
$$;
set local role authenticated;
select is(pg_temp.h('transfer_preview',pg_temp.transfer_value(3,1))->>'canApply','false','Unrelated recipient cannot receive transfers');
select is(pg_temp.h('transfer_preview',pg_temp.transfer_value(2,2))->>'canApply','false','Transfer cannot move already consumed credits');
select is(pg_temp.transfer_apply(pg_temp.transfer_value(2,1),'shared-transfer-one','{}')->>'status','stale','An unreviewed transfer is rejected');
select is(pg_temp.transfer_apply(pg_temp.transfer_value(2,1),'shared-transfer-one')->>'status','completed','Authorized transfer splits an available credit into a linked individual lot');
reset role;
select is(package_credit_balance(pg_temp.pool()),0,'Source was debited once');
select is((select package_credit_balance(id) from packages where transferred_from_package_id=pg_temp.pool()),1,'Destination receives exactly one unit');
select is((select count(*) from payment_entries where student_id in (
  md5('shared-student-1')::uuid,md5('shared-student-2')::uuid)),0::bigint,'Sharing and transfer create no payment entries');
select is((select count(*) from packages p join credit_internal.package_credit_terms t on t.package_id=p.id
  join credit_internal.package_credit_terms original on original.package_id=pg_temp.pool()
  where p.transferred_from_package_id=pg_temp.pool() and t.issuance_entry_id=original.issuance_entry_id
    and t.service_ids=original.service_ids and p.expires_at=original.original_expires_at),1::bigint,
  'The destination preserves original issuance, eligibility and expiration');


-- Exercise the Stage C gap-closure commands through the existing coach boundary.
select set_config('request.jwt.claim.sub',md5('shared-user-1')::uuid::text,true);
create function pg_temp.shared_bulk(p_delta integer) returns jsonb language sql as $$
  select jsonb_build_object('rows',jsonb_build_array(jsonb_build_object('packageId',pg_temp.pool(),
    'studentId',md5('shared-student-2')::uuid,'delta',p_delta)),'reason','Verified shared adjustment','portalVisible',false)
$$;
select is(command_student_credit_settings(md5('shared-student-2')::uuid,'bulk_package_preview',
  pg_temp.shared_bulk(2),0,'shared-preview-test',md5('shared-user-1')::uuid)->>'canApply','true',
  'Existing bulk preview accepts explicitly eligible shared lots');
select throws_ok($$select command_student_credit_settings(md5('shared-student-2')::uuid,'bulk_package_preview',
  pg_temp.shared_bulk(2)||jsonb_build_object('rows',(pg_temp.shared_bulk(2)->'rows')||(pg_temp.shared_bulk(2)->'rows')),
  0,'shared-duplicate-test',md5('shared-user-1')::uuid)$$,'P0001','VALIDATION_FAILED',
  'A shared lot cannot be selected twice');
create function pg_temp.shared_apply() returns jsonb language sql as $$
  select command_student_credit_settings(md5('shared-student-2')::uuid,'bulk_package_apply',
    pg_temp.shared_bulk(2)||jsonb_build_object('preview',command_student_credit_settings(
      md5('shared-student-2')::uuid,'bulk_package_preview',pg_temp.shared_bulk(2),
      0,'shared-preview-test',md5('shared-user-1')::uuid)->'rows'),0,'shared-apply-test',md5('shared-user-1')::uuid)
$$;
select is(pg_temp.shared_apply()->>'status','completed','Shared adjustment uses the same atomic batch command');
select is(package_credit_balance(pg_temp.pool()),2,'Shared adjustment changes the authoritative balance');
select is((select count(*) from credit_internal.hidden_portal_credit_entries h join package_credit_entries e on e.id=h.entry_id
  where e.package_id=pg_temp.pool()),1::bigint,'Shared adjustment is hidden from portal history independently of balance');
select is((select count(*) from audit_events where correlation_id='shared-apply-test' and entity_id=pg_temp.pool()),1::bigint,
  'Shared correction retains a private audit');
select is(reserve_student_lesson_credit(md5('shared-lesson-2')::uuid,md5('shared-student-2')::uuid,pg_temp.pool(),true),
  pg_temp.pool(),'Shared pool has a reservation to preview');
create function pg_temp.expiry_value(op text) returns jsonb language sql as $$
  select jsonb_build_object('packageId',pg_temp.pool(),'operation',op,'expiresAt',
    case when op='extend' then now()+interval '60 days' end)
$$;
create function pg_temp.expiry_apply(op text,p_key text) returns jsonb language sql as $$
  select pg_temp.h('expiration_apply',pg_temp.expiry_value(op)||jsonb_build_object(
    'preview',pg_temp.h('expiration_preview',pg_temp.expiry_value(op)), 'key',p_key,'reason','Reviewed expiry exception'))
$$;
select is(pg_temp.h('expiration_preview',pg_temp.expiry_value('extend'))#>>'{reservations,0,topic}',
  'Shared lesson 2','Expiration preview shows the existing reservation');
select throws_ok($$select pg_temp.h('expiration_apply',pg_temp.expiry_value('extend'))$$,
  'P0001','VALIDATION_FAILED: Enter a reason and confirm the expiration change.','Expiration changes require a reason');
select is(pg_temp.expiry_apply('extend','shared-extension-test')->>'status','completed','Authorized coach extends expiration');
select is(pg_temp.expiry_apply('waive','shared-waiver-test')->>'status','completed','Authorized coach waives expiration');
select is((select expires_at from packages where id=pg_temp.pool()),null::timestamptz,'Waiver clears the effective expiration');
select ok((select original_expires_at is not null from credit_internal.package_credit_terms where package_id=pg_temp.pool()),
  'Expiration exceptions preserve original purchase terms');
select is(jsonb_array_length(pg_temp.h('expiration_history',pg_temp.expiry_value('waive'))),2,'Both exceptions appear in private audit history');
select set_config('request.jwt.claim.sub',md5('shared-user-3')::uuid::text,true);
select throws_ok($$select pg_temp.h('expiration_history',pg_temp.expiry_value('waive'))$$,
  '42501','FORBIDDEN','Guardian cannot read private expiration reasons');
select throws_ok($$select pg_temp.h('attention_cases')$$,'42501','FORBIDDEN','Guardian cannot read coach reconciliation cases');


select set_config('request.jwt.claim.sub',md5('shared-user-1')::uuid::text,true);
select lives_ok($$select command_student_credit_settings(md5('shared-student-3')::uuid,'set_total',
  '{"total":2,"reason":"Private legacy correction","portalVisible":false,"reviewedBalance":{"remaining":0,"reserved":0,"available":0}}',
  1,'private-legacy-test',md5('shared-user-1')::uuid)$$,'A legacy correction can opt out of portal history');
select is(student_credit_summary(md5('shared-student-3')::uuid)->>'remaining','2',
  'Hiding a legacy adjustment preserves the changed balance');
select is((select count(*) from credit_internal.hidden_portal_credit_entries h join package_credit_entries e on e.id=h.entry_id
  where e.idempotency_key='credit-total:private-legacy-test:add'),1::bigint,'Legacy grant entry is marked private');
select is((select count(*) from audit_events where correlation_id='private-legacy-test' and reason='Private legacy correction'),
  1::bigint,'Legacy visibility does not erase coach audit');
insert into credit_internal.reconciliation_cases(student_id,package_id,finding,evidence)
select student_id,id,'missing_issuance','{"present":true}' from packages where student_id=md5('shared-student-3')::uuid;
select is(pg_temp.h('attention_cases')#>>'{0,status}','needs_review','Attention reads persisted Stage B case state');
select set_config('request.jwt.claim.sub',md5('shared-user-4')::uuid::text,true);
select is(student_credit_history(md5('shared-student-3')::uuid,1)->>'total','0',
  'Student history omits the private legacy reason and entry');


select set_config('request.jwt.claim.sub',md5('shared-user-1')::uuid::text,true);
create function pg_temp.restore_request() returns jsonb language sql as $$
  select jsonb_build_object('packageId',pg_temp.pool(),'entryId',id)
  from package_credit_entries where package_id=pg_temp.pool() and kind='consumption'
    and lesson_id=md5('shared-lesson-1')::uuid
$$;
select is(jsonb_array_length(pg_temp.h('restore_list',pg_temp.restore_request())),1,
  'Restore list includes the completed shared debit even after membership removal');
create temporary table reviewed_shared_restore as
select pg_temp.restore_request()||jsonb_build_object('preview',pg_temp.h('restore_preview',pg_temp.restore_request()),
  'key','restore-shared-pool-test','reason','Incorrect shared deduction','portalVisible',false) as request;
select is(pg_temp.h('restore_apply',(select request from reviewed_shared_restore))->>'status','completed',
  'Coach restores the shared debit');
select is(pg_temp.h('restore_apply',(select request from reviewed_shared_restore))->>'status','completed',
  'Exact restoration retry returns its receipt');
select is((select count(*) from package_credit_entries where idempotency_key='shared-restoration:restore-shared-pool-test'
  and used_by_student_id=md5('shared-student-1')::uuid and package_id=pg_temp.pool()),1::bigint,
  'Shared restoration preserves student attribution and original pool');
select is((select status::text from lessons where id=md5('shared-lesson-1')::uuid),'completed',
  'Restoration preserves completed lesson status');
select is(jsonb_array_length(pg_temp.h('restore_list',pg_temp.restore_request())),0,
  'Restored uses cannot be selected again');


select set_config('request.jwt.claim.sub',md5('shared-user-1')::uuid::text,true);
update linked_contacts set is_primary_payer=true where student_id=md5('shared-student-2')::uuid
  and user_id=md5('shared-user-3')::uuid;
insert into linked_contacts(id,studio_id,student_id,user_id,full_name,email,portal_enabled,can_view_finance,can_receive_notifications)
values(md5('pool-billing-alternate')::uuid,md5('shared-studio')::uuid,md5('shared-student-2')::uuid,
 md5('shared-user-5')::uuid,'Shared pool payer','pool-payer@example.test',true,true,true);
select is((select full_name from linked_contacts where id=credit_internal.shared_pool_billing_contact(
  pg_temp.pool(),md5('shared-student-2')::uuid)), 'Guardian','Pool falls back to affected student’s designated payer');
create function pg_temp.billing_change(p_contact uuid,p_key text) returns jsonb language sql as $$
  select pg_temp.h('billing_apply',v||jsonb_build_object(
    'key',p_key,'preview',pg_temp.h('billing_preview',v),'reason','Reviewed pool billing'))
  from (select jsonb_build_object('packageId',pg_temp.pool(),'contactId',p_contact) v) x
$$;
select is(pg_temp.billing_change(md5('pool-billing-alternate')::uuid,'reviewed-pool-payer')->>'status',
  'completed','Coach can designate an eligible pool contact');
select is(credit_internal.shared_pool_billing_contact(pg_temp.pool(),md5('shared-student-2')::uuid),
  md5('pool-billing-alternate')::uuid,'Authorized pool contact takes precedence');
update linked_contacts set can_receive_notifications=false where id=md5('pool-billing-alternate')::uuid;
select is((select full_name from linked_contacts where id=credit_internal.shared_pool_billing_contact(
  pg_temp.pool(),md5('shared-student-2')::uuid)), 'Guardian','Revoked permission uses the valid fallback');
select is(pg_temp.billing_change(null,'cleared-pool-payer')->>'status','completed','Coach can clear designation');
select is(jsonb_array_length(pg_temp.h('billing_read',jsonb_build_object('packageId',pg_temp.pool()))->'history'),
  2,'Changes record an audit history');
select set_config('request.jwt.claim.sub',md5('shared-user-3')::uuid::text,true);
select throws_ok($$select pg_temp.h('billing_read',jsonb_build_object('packageId',pg_temp.pool()))$$,
  '42501','FORBIDDEN','Guardian cannot read private pool billing settings');


create temporary table custom_credit_fixture as
select command_grant_student_credits(md5('shared-student-3')::uuid,'typed-discretionary-test',
  jsonb_build_object('quantity',2,'kind','adjustment','reason','Typed credit grant','portalVisible',false,
    'customTerms',jsonb_build_object('serviceId',md5('shared-service-1')::uuid,'durationMinutes',60)),
  md5('shared-user-1')::uuid) as result;
select ok(credit_internal.package_terms_match((result#>>'{package,id}')::uuid,md5('shared-studio')::uuid,
 md5('shared-service-1')::uuid,interval '1 hour'),'Typed discretionary lot matches the explicit terms') from custom_credit_fixture;
select is(credit_internal.package_terms_match((result#>>'{package,id}')::uuid,md5('shared-studio')::uuid,
 md5('shared-service-2')::uuid,interval '1 hour'),false,'Typed discretionary lot rejects a different service') from custom_credit_fixture;
select is(credit_internal.package_terms_match((result#>>'{package,id}')::uuid,md5('shared-studio')::uuid,
 md5('shared-service-1')::uuid,interval '30 minutes'),false,'Typed discretionary lot rejects a different duration') from custom_credit_fixture;
select is((select count(*) from payment_entries where student_id=md5('shared-student-3')::uuid),0::bigint,
 'Discretionary grants create no financial entry');

select set_config('request.jwt.claim.sub',md5('shared-user-1')::uuid::text,true);
insert into lessons(id,studio_id,student_id,topic,starts_at,ends_at,status,location_type,location_label,source_provider)
values(md5('unclassified-manual-test')::uuid,md5('shared-studio')::uuid,md5('shared-student-3')::uuid,
 'Unclassified manual test',now()+interval '20 days',now()+interval '20 days 1 hour','scheduled','virtual','Meet','studio');
select is((select item->>'coverageStatus' from jsonb_array_elements(student_credit_coverage(
  md5('shared-student-3')::uuid,1,20,false)->'items') item
  where item->>'lessonId'=md5('unclassified-manual-test')::uuid::text),
  'studio_review','An unclassified manual lesson requires review without a guessed billing obligation');

select * from finish();
rollback;
