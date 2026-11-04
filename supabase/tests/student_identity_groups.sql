begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
insert into auth.users(id,email) select ('e8700000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'e2e-identity-'||n||'@example.test' from generate_series(2,6)n;
insert into public.studios(id,name,slug) values('e8700000-0000-4000-8000-000000000001','E2E identity preservation','e2e-identity-preservation');
insert into public.memberships(studio_id,user_id,role,display_name) values
 ('e8700000-0000-4000-8000-000000000001','e8700000-0000-4000-8000-000000000002','coach','E2E coach'),
 ('e8700000-0000-4000-8000-000000000001','e8700000-0000-4000-8000-000000000003','student','E2E current student'),
 ('e8700000-0000-4000-8000-000000000001','e8700000-0000-4000-8000-000000000004','guardian','E2E duplicate guardian');
create function pg_temp.identity_id(p_n integer) returns uuid language sql immutable as $$select ('e8700000-0000-4000-8000-'||lpad(p_n::text,12,'0'))::uuid$$;
insert into public.students(id,studio_id,full_name,status) select pg_temp.identity_id(n),pg_temp.identity_id(1),'E2E retained profile '||n,'active' from generate_series(10,21)n;
update public.students set user_id=pg_temp.identity_id(3) where id=pg_temp.identity_id(10);
update public.students set user_id=pg_temp.identity_id(6) where id=pg_temp.identity_id(13);
update public.students set stripe_customer_id='cus_e2e_identity_a' where id=pg_temp.identity_id(14);
update public.students set stripe_customer_id='cus_e2e_identity_b' where id=pg_temp.identity_id(15);
update public.students set guardian_email='guardian-a@example.test' where id=pg_temp.identity_id(16);
update public.students set guardian_email='guardian-b@example.test' where id=pg_temp.identity_id(17);
insert into public.student_relationships(student_id,user_id,relationship,can_view_finance,can_manage_profile) values(pg_temp.identity_id(11),pg_temp.identity_id(4),'guardian',true,false);
insert into public.linked_contacts(studio_id,student_id,user_id,full_name,email,can_view_finance,portal_enabled,is_primary_payer) values(pg_temp.identity_id(1),pg_temp.identity_id(11),pg_temp.identity_id(4),'E2E original payer','e2e-identity-4@example.test',true,true,true);
insert into public.linked_contacts(studio_id,student_id,full_name,email,portal_enabled,is_primary_payer) values
 (pg_temp.identity_id(1),pg_temp.identity_id(20),'E2E payer A','payer-a@example.test',false,true),
 (pg_temp.identity_id(1),pg_temp.identity_id(21),'E2E payer B','payer-b@example.test',false,true);
insert into public.student_credit_accounts(student_id,auto_apply) values(pg_temp.identity_id(10),false),(pg_temp.identity_id(11),true);
insert into credit_internal.credit_coverage_jobs(student_id,requested_version) values(pg_temp.identity_id(11),1);
insert into credit_internal.credit_command_receipts(key,student_id,actor_id,request,response) values('e2e-identity-existing-financial-receipt',pg_temp.identity_id(11),pg_temp.identity_id(2),'{"originalStudent":11}','{"originalResult":"retained"}');
insert into public.payment_entries(student_id,kind,amount_minor,currency,external_reference,reason) values
 (pg_temp.identity_id(10),'payment',1200,'USD','e2e-identity-payment-usd','E2E separate account'),
 (pg_temp.identity_id(11),'payment',1900,'EUR','e2e-identity-payment-eur','E2E retained original account');
insert into public.lessons(id,studio_id,student_id,topic,starts_at,ends_at,status,location_type,location_label,price_minor,paid_minor,payment_status,source_provider,source_external_id) values
 (pg_temp.identity_id(30),pg_temp.identity_id(1),pg_temp.identity_id(11),'E2E original history','2020-01-01T15:00Z','2020-01-01T16:00Z','completed','in_person','E2E original studio',1900,1900,'paid','google_calendar','e2e-identity-calendar-source');
insert into public.lesson_participants(lesson_id,student_id,display_name,email,status) values(pg_temp.identity_id(30),pg_temp.identity_id(11),'E2E original participant','e2e-identity-11@example.test','attended');
insert into public.studio_invoices(id,studio_id,student_id,number,status,currency,issue_date,due_date,branding,recipient,items,total_minor) values(pg_temp.identity_id(31),pg_temp.identity_id(1),pg_temp.identity_id(11),'E2E-IDENTITY-INVOICE','open','EUR','2020-01-01','2020-01-02','{}','{}','[]',1900);
insert into public.conversations(id,studio_id,student_id,kind,title) values(pg_temp.identity_id(32),pg_temp.identity_id(1),pg_temp.identity_id(11),'direct','E2E retained conversation');
insert into public.integration_imports(id,studio_id,student_id,lesson_id,provider,external_id,detected_source,status,payload) values(pg_temp.identity_id(33),pg_temp.identity_id(1),pg_temp.identity_id(11),pg_temp.identity_id(30),'google_calendar','e2e-identity-calendar-source','google_calendar','imported','{"originalEvidence":"retained"}');
create function pg_temp.identity_value(p_current integer,p_duplicate integer default null) returns jsonb language sql immutable as $$
 select jsonb_build_object('action',case when p_duplicate is null then 'dissolve' else 'group' end,'currentStudentId',pg_temp.identity_id(p_current),'reason','Explicit synthetic identity review')||case when p_duplicate is null then '{}'::jsonb else jsonb_build_object('duplicateStudentId',pg_temp.identity_id(p_duplicate)) end
$$;
create function pg_temp.identity_commit(p_current integer,p_duplicate integer,p_key text) returns jsonb language sql as $$
 select public.command_student_identity_change(pg_temp.identity_value(p_current,p_duplicate),public.preview_student_identity_change(pg_temp.identity_value(p_current,p_duplicate))->>'stamp',p_key)
$$;
create function pg_temp.identity_preserved() returns jsonb language sql as $$
 select jsonb_build_object(
  'students',(select jsonb_agg(to_jsonb(s) order by id) from public.students s where id in(pg_temp.identity_id(10),pg_temp.identity_id(11))),
  'accounts',(select jsonb_agg(to_jsonb(s) order by student_id) from public.student_credit_accounts s where student_id in(pg_temp.identity_id(10),pg_temp.identity_id(11))),
  'payments',(select jsonb_agg(to_jsonb(s) order by id) from public.payment_entries s where student_id in(pg_temp.identity_id(10),pg_temp.identity_id(11))),
  'jobs',(select jsonb_agg(to_jsonb(s) order by student_id) from credit_internal.credit_coverage_jobs s where student_id=pg_temp.identity_id(11)),
  'receipts',(select jsonb_agg(to_jsonb(s) order by key) from credit_internal.credit_command_receipts s where student_id=pg_temp.identity_id(11)),
  'lessons',(select jsonb_agg(to_jsonb(s) order by id) from public.lessons s where student_id=pg_temp.identity_id(11)),
  'participants',(select jsonb_agg(to_jsonb(s) order by id) from public.lesson_participants s where student_id=pg_temp.identity_id(11)),
  'invoices',(select jsonb_agg(to_jsonb(s) order by id) from public.studio_invoices s where student_id=pg_temp.identity_id(11)),
  'conversations',(select jsonb_agg(to_jsonb(s) order by id) from public.conversations s where student_id=pg_temp.identity_id(11)),
  'imports',(select jsonb_agg(to_jsonb(s) order by id) from public.integration_imports s where student_id=pg_temp.identity_id(11)),
  'relationships',(select jsonb_agg(to_jsonb(s) order by id) from public.student_relationships s where student_id=pg_temp.identity_id(11)),
  'contacts',(select jsonb_agg(to_jsonb(s) order by id) from public.linked_contacts s where student_id=pg_temp.identity_id(11)))
$$;
select set_config('e2e.identity.preserved',pg_temp.identity_preserved()::text,true);
select ok(not has_function_privilege('anon','public.command_student_identity_change(jsonb,text,text)','execute'),'Anonymous cannot group profiles');
select ok(not has_function_privilege('service_role','public.command_student_identity_change(jsonb,text,text)','execute'),'Workers cannot impersonate a coach identity decision');
select ok(not has_table_privilege('authenticated','workspace_internal.student_identity_members','SELECT'),'Raw identity membership is private');
select ok(not has_table_privilege('service_role','workspace_internal.student_identity_receipts','SELECT'),'Provider service cannot read coach receipts');
select ok(not has_function_privilege('authenticated','library_internal.merge_students_without_study(uuid,uuid)','execute'),'Legacy physical deletion implementation remains private');
select set_config('request.jwt.claim.sub',pg_temp.identity_id(3)::text,true);
set local role authenticated;
select throws_ok($$select public.preview_student_identity_change(pg_temp.identity_value(10,11))$$,'42501','FORBIDDEN','Student cannot preview identity grouping');
select is(public.can_view_student_finance(pg_temp.identity_id(11)),false,'Current student has no original duplicate financial access');
select set_config('request.jwt.claim.sub',pg_temp.identity_id(4)::text,true);
select throws_ok($$select public.student_identity_group(pg_temp.identity_id(11))$$,'42501','FORBIDDEN','Guardian cannot list coach-only identity navigation');
select is(public.can_view_student_finance(pg_temp.identity_id(10)),false,'Duplicate guardian has no current-profile financial access');
select set_config('request.jwt.claim.sub',pg_temp.identity_id(5)::text,true);
select throws_ok($$select public.student_identity_group(pg_temp.identity_id(11))$$,'42501','FORBIDDEN','Unrelated user cannot discover groups');
select set_config('request.jwt.claim.sub',pg_temp.identity_id(2)::text,true);
select throws_ok($$select public.merge_studio_students(pg_temp.identity_id(10),pg_temp.identity_id(11))$$,'P0001','REVIEW_REQUIRED: Use the identity-preserving duplicate profile preview. Existing records and permissions have not moved.','Legacy merge stops before touching the recovery job or student');
select is(public.preview_student_identity_change(pg_temp.identity_value(10,13))->>'blockedReason','different_authenticated_users','Distinct authenticated users remain a review hold');
select is(public.preview_student_identity_change(pg_temp.identity_value(14,15))->>'blockedReason','different_provider_customers','Distinct provider customers remain a review hold');
select is(public.preview_student_identity_change(pg_temp.identity_value(16,17))->>'blockedReason','different_guardian_identities','Distinct guardian identities remain a review hold');
select is(public.preview_student_identity_change(pg_temp.identity_value(20,21))->>'blockedReason','different_payer_identities','Distinct non-portal payers remain a review hold');
select throws_ok($$select public.preview_student_identity_change(pg_temp.identity_value(10,11)||'{"combineBalances":true}')$$,'P0001','VALIDATION_FAILED','No implicit financial consolidation flag exists');
select set_config('e2e.identity.value',pg_temp.identity_value(10,11)::text,true);
select set_config('e2e.identity.stamp',public.preview_student_identity_change(current_setting('e2e.identity.value')::jsonb)->>'stamp',true);
select set_config('e2e.identity.result',public.command_student_identity_change(current_setting('e2e.identity.value')::jsonb,current_setting('e2e.identity.stamp'),'e2e-identity-initial')::text,true);
select is(public.command_student_identity_change(current_setting('e2e.identity.value')::jsonb,current_setting('e2e.identity.stamp'),'e2e-identity-initial'),current_setting('e2e.identity.result')::jsonb,'Lost-response replay returns the same identity result');
select throws_ok($$select public.command_student_identity_change(current_setting('e2e.identity.value')::jsonb||'{"reason":"Changed identity request"}',current_setting('e2e.identity.stamp'),'e2e-identity-initial')$$,'P0001','IDEMPOTENCY_CONFLICT','Changed payload cannot reuse a committed identity key');
select is((public.student_identity_group(pg_temp.identity_id(11))->>'total')::integer,2,'Both original profiles appear in coach navigation');
select is(public.student_identity_group(pg_temp.identity_id(11))#>>'{group,currentStudentId}',pg_temp.identity_id(10)::text,'Current navigation choice is explicit');
select is(public.preview_student_identity_change(pg_temp.identity_value(11,12))->>'blockedReason','select_designated_current_profile','Adding through an alias cannot silently replace the designated current profile');
select is(public.preview_student_identity_change(pg_temp.identity_value(10,11))->>'blockedReason','already_grouped','A new key cannot create duplicate membership');
select is(public.preview_student_identity_change(pg_temp.identity_value(10,16))->>'blockedReason','group_identity_requires_review','Adding a new member also checks the existing duplicate guardian identity');
select lives_ok($$select pg_temp.identity_commit(10,12,'e2e-identity-third')$$,'Coach may explicitly add an unlinked duplicate to an existing group');
select set_config('request.jwt.claim.sub',pg_temp.identity_id(3)::text,true);
select is(public.can_view_student_finance(pg_temp.identity_id(11)),false,'Grouping grants the current student no duplicate finance permission');
select throws_ok($$select public.command_student_identity_change(current_setting('e2e.identity.value')::jsonb,current_setting('e2e.identity.stamp'),'e2e-identity-initial')$$,'42501','FORBIDDEN','Student cannot recover a coach grouping receipt');
select set_config('request.jwt.claim.sub',pg_temp.identity_id(4)::text,true);
select is(public.can_view_student_finance(pg_temp.identity_id(10)),false,'Grouping grants duplicate guardian no access to the current profile');
reset role;
select is(pg_temp.identity_preserved(),current_setting('e2e.identity.preserved')::jsonb,'Grouping preserves all seeded identity, financial, recovery, receipt, attendance, source, conversation and permission rows byte-for-byte');
delete from public.memberships where studio_id=pg_temp.identity_id(1) and user_id=pg_temp.identity_id(2);
set local role authenticated;
select set_config('request.jwt.claim.sub',pg_temp.identity_id(2)::text,true);
select throws_ok($$select public.command_student_identity_change(current_setting('e2e.identity.value')::jsonb,current_setting('e2e.identity.stamp'),'e2e-identity-initial')$$,'42501','FORBIDDEN','Revoked coach cannot recover an old grouping receipt');
reset role;
insert into public.memberships(studio_id,user_id,role,display_name) values(pg_temp.identity_id(1),pg_temp.identity_id(2),'coach','E2E coach');
create function pg_temp.identity_fault() returns trigger language plpgsql as $$begin if current_setting('e2e.identity.fault',true)=tg_table_name then raise exception 'SYNTHETIC_IDENTITY_WRITE_FAILURE';end if;return new;end$$;
create trigger e2e_identity_audit_fault before insert on public.audit_events for each row execute function pg_temp.identity_fault();
create trigger e2e_identity_receipt_fault before insert on workspace_internal.student_identity_receipts for each row execute function pg_temp.identity_fault();
select set_config('e2e.identity.fault','audit_events',true);
set local role authenticated;
select throws_ok($$select pg_temp.identity_commit(18,19,'e2e-identity-fault')$$,'P0001','SYNTHETIC_IDENTITY_WRITE_FAILURE','Late audit failure rolls back group and memberships');
reset role;
select is((select count(*) from workspace_internal.student_identity_members where student_id in(pg_temp.identity_id(18),pg_temp.identity_id(19))),0::bigint,'Audit failure leaves no orphan memberships');
select set_config('e2e.identity.fault','student_identity_receipts',true);
set local role authenticated;
select throws_ok($$select pg_temp.identity_commit(18,19,'e2e-identity-fault')$$,'P0001','SYNTHETIC_IDENTITY_WRITE_FAILURE','Late receipt failure rolls back group, memberships and audit');
reset role;
select is((select count(*) from public.audit_events where correlation_id='e2e-identity-fault'),0::bigint,'Receipt failure leaves no false success audit');
select set_config('e2e.identity.fault','',true);
set local role authenticated;
select lives_ok($$select pg_temp.identity_commit(18,19,'e2e-identity-fault')$$,'A rollback can safely retry the same command key');
select set_config('e2e.identity.stale.value',pg_temp.identity_value(10)::text,true);
select set_config('e2e.identity.stale.stamp',public.preview_student_identity_change(current_setting('e2e.identity.stale.value')::jsonb)->>'stamp',true);
reset role;
update public.students set version=version+1 where id=pg_temp.identity_id(12);
set local role authenticated;
select throws_ok($$select public.command_student_identity_change(current_setting('e2e.identity.stale.value')::jsonb,current_setting('e2e.identity.stale.stamp'),'e2e-identity-stale')$$,'P0001','VERSION_CONFLICT: Refresh the identity preview.','Changed group member identity invalidates reversal preview');
reset role;
insert into public.students(id,studio_id,full_name,status) select pg_temp.identity_id(n),pg_temp.identity_id(1),'E2E large group '||n,'active' from generate_series(100,123)n;
set local role authenticated;
do $$declare n integer;begin for n in 100..123 loop perform pg_temp.identity_commit(10,n,'e2e-identity-page-'||n);end loop;end$$;
select is((public.student_identity_group(pg_temp.identity_id(10))->>'total')::integer,27,'Group reads retain authoritative member totals');
select is(jsonb_array_length(public.student_identity_group(pg_temp.identity_id(10))->'members'),25,'Group navigation has a bounded first page');
select is(public.student_identity_group(pg_temp.identity_id(10))->>'hasMore','true','Older members are discoverable rather than silently capped');
select is(jsonb_array_length(public.student_identity_group(pg_temp.identity_id(10),(public.student_identity_group(pg_temp.identity_id(10))->>'nextAfterStudent')::uuid)->'members'),2,'Cursor returns remaining original profiles without duplicates');
select lives_ok($$select pg_temp.identity_commit(10,null,'e2e-identity-dissolve')$$,'Coach can explicitly reverse grouping without undoing history');
select is((public.student_identity_group(pg_temp.identity_id(10))->>'total')::integer,0,'Reversed group is removed from active navigation');
reset role;
select is((select count(*) from workspace_internal.student_identity_members where group_id=(current_setting('e2e.identity.result')::jsonb#>>'{resource,groupId}')::uuid),27::bigint,'Reversal retains every historical membership');
select is((select count(*) from workspace_internal.student_identity_members where group_id=(current_setting('e2e.identity.result')::jsonb#>>'{resource,groupId}')::uuid and ended_at is null),0::bigint,'Reversal closes active memberships explicitly');
select is((select count(*) from workspace_internal.student_identity_receipts where request_key='e2e-identity-initial'),1::bigint,'Original command receipt survives reversal');
select is(pg_temp.identity_preserved(),current_setting('e2e.identity.preserved')::jsonb,'Reversal preserves original profiles, accounts, invoices, recovery jobs, receipts, attendance and permissions');
select is((select count(*) from public.outbox_messages where studio_id=pg_temp.identity_id(1)),0::bigint,'Grouping/reversal sends no notification intent');
select is((select count(*) from public.calendar_projections p join public.lessons l on l.id=p.lesson_id where l.studio_id=pg_temp.identity_id(1)),0::bigint,'Grouping/reversal projects no Calendar or Meet change');
select * from finish();
rollback;
