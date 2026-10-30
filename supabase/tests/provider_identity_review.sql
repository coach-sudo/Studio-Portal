begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
create function pg_temp.provider_identity_id(p_n integer) returns uuid language sql immutable as $$select ('e8900000-0000-4000-8000-'||lpad(p_n::text,12,'0'))::uuid$$;
insert into auth.users(id,email) select pg_temp.provider_identity_id(n),'e2e-provider-identity-'||n||'@example.test' from generate_series(2,5)n;
insert into public.studios(id,name,slug) values(pg_temp.provider_identity_id(1),'E2E provider identity hold','e2e-provider-identity-hold');
insert into public.memberships(studio_id,user_id,role,display_name) values
 (pg_temp.provider_identity_id(1),pg_temp.provider_identity_id(2),'coach','E2E coach'),
 (pg_temp.provider_identity_id(1),pg_temp.provider_identity_id(3),'student','E2E original student'),
 (pg_temp.provider_identity_id(1),pg_temp.provider_identity_id(5),'guardian','E2E original guardian');
insert into public.students(id,studio_id,full_name,status,user_id) values
 (pg_temp.provider_identity_id(10),pg_temp.provider_identity_id(1),'E2E original owner','active',pg_temp.provider_identity_id(3)),
 (pg_temp.provider_identity_id(11),pg_temp.provider_identity_id(1),'E2E selected owner','active',null);
insert into public.student_credit_accounts(student_id,auto_apply) values(pg_temp.provider_identity_id(10),false);
insert into public.student_relationships(student_id,user_id,relationship,can_view_finance,can_manage_profile) values(pg_temp.provider_identity_id(10),pg_temp.provider_identity_id(5),'guardian',true,false);
insert into public.linked_contacts(studio_id,student_id,user_id,full_name,email,can_view_finance,portal_enabled,is_primary_payer) values(pg_temp.provider_identity_id(1),pg_temp.provider_identity_id(10),pg_temp.provider_identity_id(5),'E2E original payer','e2e-provider-identity-5@example.test',true,true,true);
insert into credit_internal.credit_coverage_jobs(student_id,requested_version) values(pg_temp.provider_identity_id(10),1);
insert into public.payment_entries(student_id,kind,amount_minor,currency,external_reference,reason) values
 (pg_temp.provider_identity_id(10),'payment',1900,'EUR','e2e-provider-identity-original-payment','E2E original history');
insert into public.lessons(id,studio_id,student_id,topic,starts_at,ends_at,status,location_type,location_label,price_minor,paid_minor,payment_status) values
 (pg_temp.provider_identity_id(20),pg_temp.provider_identity_id(1),pg_temp.provider_identity_id(10),'E2E original paid attendance','2020-01-01T15:00Z','2020-01-01T16:00Z','completed','in_person','E2E original studio',1900,1900,'paid');
insert into public.lesson_participants(lesson_id,student_id,display_name,email,status) values(pg_temp.provider_identity_id(20),pg_temp.provider_identity_id(10),'E2E original participant','original@example.test','attended');
insert into public.integration_imports(id,studio_id,student_id,lesson_id,provider,external_id,detected_source,status,payload) values
 (pg_temp.provider_identity_id(30),pg_temp.provider_identity_id(1),pg_temp.provider_identity_id(10),pg_temp.provider_identity_id(20),'gmail','e2e-provider-identity-linked','superprof','needs_review','{"candidate":{"startsAt":"2020-01-01T15:00Z","endsAt":"2020-01-01T16:00Z"},"changeType":"confirmation"}'),
 (pg_temp.provider_identity_id(31),pg_temp.provider_identity_id(1),pg_temp.provider_identity_id(10),null,'gmail','e2e-provider-identity-unlinked','superprof','needs_review','{"candidate":{"startsAt":"2031-01-01T15:00Z","endsAt":"2031-01-01T16:00Z"},"changeType":"confirmation"}');
create function pg_temp.provider_identity_snapshot() returns jsonb language sql as $$
select jsonb_build_object(
 'students',(select jsonb_agg(to_jsonb(t) order by id) from public.students t where studio_id=pg_temp.provider_identity_id(1)),
 'relationships',(select jsonb_agg(to_jsonb(t) order by student_id,user_id) from public.student_relationships t where student_id=pg_temp.provider_identity_id(10)),
 'contacts',(select jsonb_agg(to_jsonb(t) order by id) from public.linked_contacts t where studio_id=pg_temp.provider_identity_id(1)),
 'lessons',(select jsonb_agg(to_jsonb(t) order by id) from public.lessons t where studio_id=pg_temp.provider_identity_id(1)),
 'participants',(select jsonb_agg(to_jsonb(t) order by t.id) from public.lesson_participants t where lesson_id=pg_temp.provider_identity_id(20)),
 'payments',(select jsonb_agg(to_jsonb(t) order by id) from public.payment_entries t where student_id in(pg_temp.provider_identity_id(10),pg_temp.provider_identity_id(11))),
 'accounts',(select jsonb_agg(to_jsonb(t) order by student_id) from public.student_credit_accounts t where student_id in(pg_temp.provider_identity_id(10),pg_temp.provider_identity_id(11))),
 'jobs',(select jsonb_agg(to_jsonb(t) order by student_id) from credit_internal.credit_coverage_jobs t where student_id in(pg_temp.provider_identity_id(10),pg_temp.provider_identity_id(11))),
 'sources',(select jsonb_agg(to_jsonb(t) order by id) from public.integration_imports t where studio_id=pg_temp.provider_identity_id(1)),
 'receipts',(select jsonb_agg(to_jsonb(t) order by key) from workspace_internal.operation_receipts t where studio_id=pg_temp.provider_identity_id(1)),
 'audit',(select jsonb_agg(to_jsonb(t) order by id) from public.audit_events t where studio_id=pg_temp.provider_identity_id(1)),
 'groups',(select jsonb_agg(to_jsonb(t) order by id) from workspace_internal.student_identity_groups t where studio_id=pg_temp.provider_identity_id(1)),
 'calendar',(select jsonb_agg(to_jsonb(t) order by id) from public.calendar_projections t where lesson_id=pg_temp.provider_identity_id(20)),
 'outbox',(select jsonb_agg(to_jsonb(t) order by id) from public.outbox_messages t where studio_id=pg_temp.provider_identity_id(1))
)$$;
create temp table provider_identity_before as select pg_temp.provider_identity_snapshot() value;
set local role authenticated;
select set_config('request.jwt.claim.sub','e8900000-0000-4000-8000-000000000002',true);
select throws_ok(format($$select public.command_review_provider_import(%L,%L::jsonb,'e2e-provider-identity-existing')$$,pg_temp.provider_identity_id(30),jsonb_build_object('action','existing','studentId',pg_temp.provider_identity_id(11),'mergeStudentId',pg_temp.provider_identity_id(10))),
 'P0001','REVIEW_REQUIRED: Use the identity-preserving duplicate profile preview. Existing records and permissions have not moved.','Direct legacy provider merge is held before changing original history');
select throws_ok(format($$select public.command_review_provider_import(%L,%L::jsonb,'e2e-provider-identity-create')$$,pg_temp.provider_identity_id(31),jsonb_build_object('action','create','fullName','E2E must roll back before identity hold','mergeStudentId',pg_temp.provider_identity_id(10))),
 'P0001','REVIEW_REQUIRED: Use the identity-preserving duplicate profile preview. Existing records and permissions have not moved.','Legacy create-then-merge request rolls back the newly inserted profile');
select throws_ok(format($$select public.command_review_provider_import(%L,%L::jsonb,'e2e-provider-identity-create')$$,pg_temp.provider_identity_id(31),jsonb_build_object('action','create','fullName','E2E must roll back before identity hold','mergeStudentId',pg_temp.provider_identity_id(10))),
 'P0001','REVIEW_REQUIRED: Use the identity-preserving duplicate profile preview. Existing records and permissions have not moved.','Retry cannot leave a duplicate profile or success receipt after the hold');
reset role;
select is(pg_temp.provider_identity_snapshot(),(select value from provider_identity_before),'Both failed transactions and retry preserve original records byte-for-byte, without side effects or receipts');
select is((select count(*) from public.students where full_name='E2E must roll back before identity hold'),0::bigint,'No proposed new student survives rollback');
set local role authenticated;
select set_config('request.jwt.claim.sub','e8900000-0000-4000-8000-000000000004',true);
select throws_ok(format($$select public.command_review_provider_import(%L,%L::jsonb,'e2e-provider-identity-unrelated')$$,pg_temp.provider_identity_id(30),jsonb_build_object('action','existing','studentId',pg_temp.provider_identity_id(11),'mergeStudentId',pg_temp.provider_identity_id(10))), '42501','FORBIDDEN','Unrelated identity is denied before the merge policy');
select set_config('request.jwt.claim.sub','e8900000-0000-4000-8000-000000000003',true);
select throws_ok(format($$select public.command_review_provider_import(%L,%L::jsonb,'e2e-provider-identity-student')$$,pg_temp.provider_identity_id(30),jsonb_build_object('action','existing','studentId',pg_temp.provider_identity_id(11),'mergeStudentId',pg_temp.provider_identity_id(10))), '42501','FORBIDDEN','A student cannot use provider review to change ownership');
select set_config('request.jwt.claim.sub','e8900000-0000-4000-8000-000000000005',true);
select throws_ok(format($$select public.command_review_provider_import(%L,%L::jsonb,'e2e-provider-identity-guardian')$$,pg_temp.provider_identity_id(30),jsonb_build_object('action','existing','studentId',pg_temp.provider_identity_id(11),'mergeStudentId',pg_temp.provider_identity_id(10))), '42501','FORBIDDEN','Guardian finance access does not authorize provider ownership changes');
reset role;
select is(pg_temp.provider_identity_snapshot(),(select value from provider_identity_before),'Rejected identities preserve all source, financial, attendance, access and receipt state');
select * from finish();
rollback;
