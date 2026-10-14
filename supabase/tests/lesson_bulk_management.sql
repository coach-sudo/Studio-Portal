-- Full-schema execution, synthetic fixtures only; all changes roll back.
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
select ok(not has_function_privilege('authenticated','public.preview_lesson_bulk(uuid,uuid,text,jsonb)','execute'),'Preview RPC is service-only');
select ok(not has_function_privilege('anon','public.process_lesson_bulk_item(uuid,uuid)','execute'),'Worker is service-only');
select ok(not has_table_privilege('service_role','lesson_ops.lesson_deletion_snapshots','select'),'Raw deletion snapshots are private');
select ok(not has_table_privilege('authenticated','lesson_ops.lesson_bulk_jobs','select'),'Raw reviews are private');
select ok(not has_table_privilege('authenticated','public.lessons','delete'),'Coach cannot bypass reviewed deletion through the base table');
select ok(not has_table_privilege('authenticated','public.lesson_list_rows','delete'),'List view is read-only despite default grants');
insert into auth.users(id,email) values('c1000000-0000-4000-8000-000000000001','e2e-bulk@example.test');
insert into studios(id,name,slug) values('c2000000-0000-4000-8000-000000000001','Bulk fixture','e2e-bulk-management');
insert into memberships(studio_id,user_id,role,display_name) values('c2000000-0000-4000-8000-000000000001','c1000000-0000-4000-8000-000000000001','coach','Bulk coach');
insert into students(id,studio_id,full_name,email) values('c3000000-0000-4000-8000-000000000001','c2000000-0000-4000-8000-000000000001','Bulk student','e2e-bulk-student@example.test');
insert into lessons(id,studio_id,student_id,topic,starts_at,ends_at,status,location_type,location_label,source_provider)
 select ('c6000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'c2000000-0000-4000-8000-000000000001','c3000000-0000-4000-8000-000000000001',
 'e2e-bulk Fixture '||n,now()+n*interval '2 days',now()+n*interval '2 days'+interval '1 hour',case when n in (6,7) then 'cancelled'::lesson_status else 'scheduled'::lesson_status end,'in_person','Studio','studio' from generate_series(1,8) n;
insert into lesson_participants(lesson_id,student_id,display_name,email,created_at) select id,student_id,'Bulk student','e2e-bulk-student@example.test',created_at from lessons where id='c6000000-0000-4000-8000-000000000001';
insert into calendar_projections(lesson_id,status,projected_version) values('c6000000-0000-4000-8000-000000000001','queued',0);
select ok((select deletion_scaffold from lesson_participants where lesson_id='c6000000-0000-4000-8000-000000000001'),'Only native creation participant is verified scaffolding');
create function pg_temp.bulk_preview(lid uuid,op text default 'delete') returns jsonb language sql as $$
 select preview_lesson_bulk('c1000000-0000-4000-8000-000000000001','c2000000-0000-4000-8000-000000000001',gen_random_uuid()::text,jsonb_build_object('operation',op,'selectedIds',array[lid],'reason','Erroneous synthetic fixture'))
$$;
create function pg_temp.bulk_execute(r jsonb,k text default 'bulk-execute-tap-key') returns jsonb language sql as $$
 select execute_lesson_bulk('c1000000-0000-4000-8000-000000000001',(r->>'jobId')::uuid,r->>'reviewToken',k)
$$;
create function pg_temp.bulk_work(r jsonb) returns jsonb language plpgsql as $$declare c jsonb;results jsonb:='[]';begin
 for c in select value from jsonb_array_elements(claim_lesson_bulk_items(25,(r->>'jobId')::uuid)) loop
  results:=results||jsonb_build_array(process_lesson_bulk_item((c->>'id')::uuid,(c->>'claim_token')::uuid));end loop;return results;end $$;
create temp table reviews(kind text,r jsonb);
insert into reviews values('delete',pg_temp.bulk_preview('c6000000-0000-4000-8000-000000000001'));
select is((select (r->>'eligible')::integer from reviews where kind='delete'),1,'Dependency-free lesson is eligible');
select lives_ok($$select pg_temp.bulk_execute(r) from reviews where kind='delete'$$,'Execute accepts the frozen review');
select is((select pg_temp.bulk_work(r)->0->>'status' from reviews where kind='delete'),'succeeded','Physical deletion commits');
select is((select count(*)::integer from lessons where id='c6000000-0000-4000-8000-000000000001'),0,'Lesson really disappeared');
select is((select count(*)::integer from lesson_participants where lesson_id='c6000000-0000-4000-8000-000000000001'),0,'Verified scaffolding explicitly removed');
select is((select count(*)::integer from calendar_projections where lesson_id='c6000000-0000-4000-8000-000000000001'),0,'Untouched projection explicitly removed');
select is((select count(*)::integer from lesson_ops.lesson_deletion_snapshots where lesson_id='c6000000-0000-4000-8000-000000000001'),1,'Snapshot survived physical deletion');
select is((select count(*)::integer from audit_events where entity_id='c6000000-0000-4000-8000-000000000001' and action='lesson.bulk_delete'),1,'Deletion audit survived');
select throws_ok($$insert into lessons(id,studio_id,student_id,topic,starts_at,ends_at,status,location_type,location_label,source_provider)
 values('c6000000-0000-4000-8000-000000000001','c2000000-0000-4000-8000-000000000001','c3000000-0000-4000-8000-000000000001','Reused identity',now()+interval '90 days',now()+interval '90 days 1 hour','scheduled','in_person','Studio','studio')$$,
 'P0001','REVIEW_REQUIRED: This lesson was permanently deleted','Deleted identity cannot be reused');
select throws_ok($$delete from lesson_ops.lesson_deletion_snapshots where lesson_id='c6000000-0000-4000-8000-000000000001'$$,'P0001','FORBIDDEN: Deletion snapshots are immutable','Snapshot cannot be erased');
select is((select (pg_temp.bulk_execute(r)->>'duplicate')::boolean from reviews where kind='delete'),true,'Same execution key replays');
select is((select jsonb_array_length(pg_temp.bulk_work(r)) from reviews where kind='delete'),0,'Successful items never execute again');
select throws_ok($$insert into integration_imports(studio_id,provider,external_id,detected_source,payload) values('c2000000-0000-4000-8000-000000000001','google_calendar','deleted-reference','studio','{"lessonId":"c6000000-0000-4000-8000-000000000001"}')$$,'P0001','REVIEW_REQUIRED: This lesson was permanently deleted','JSON tombstone guard rejects a post-deletion writer');
insert into integration_imports(studio_id,provider,external_id,detected_source,payload) values('c2000000-0000-4000-8000-000000000001','google_calendar','hidden-reference','studio','{"nested":{"lessonIds":["c6000000-0000-4000-8000-000000000002"]}}');
select is((pg_temp.bulk_preview('c6000000-0000-4000-8000-000000000002')->>'blocked')::integer,1,'Hidden nested JSON blocks deletion');
create temp table hidden_array_references(id uuid primary key,lesson_ids uuid[]);
-- Use a real offering array (not a temp table absent from public inventory).
insert into booking_services(id,studio_id,slug,name,category,duration_minutes,price_minor) values('c4000000-0000-4000-8000-000000000001','c2000000-0000-4000-8000-000000000001','bulk-class','Bulk class','group_class',60,0);
insert into service_offerings(studio_id,service_id,title,starts_at,ends_at,enrollment_closes_at,capacity,lesson_ids)
 values('c2000000-0000-4000-8000-000000000001','c4000000-0000-4000-8000-000000000001','Bulk array fixture',now()+interval '6 days',now()+interval '6 days 1 hour',now()+interval '5 days',5,array['c6000000-0000-4000-8000-000000000003'::uuid]);
select is((pg_temp.bulk_preview('c6000000-0000-4000-8000-000000000003')->>'blocked')::integer,1,'Offering UUID array blocks deletion');
insert into reviews values('late',pg_temp.bulk_preview('c6000000-0000-4000-8000-000000000004'));
insert into notes(lesson_id,student_id,title,body) values('c6000000-0000-4000-8000-000000000004','c3000000-0000-4000-8000-000000000001','Late fixture note','Keep me');
select pg_temp.bulk_execute(r,'bulk-late-tap-key') from reviews where kind='late';
select is((select pg_temp.bulk_work(r)->0->>'status' from reviews where kind='late'),'conflicted','New dependency after review conflicts');
select is((select count(*)::integer from notes where lesson_id='c6000000-0000-4000-8000-000000000004'),1,'New authored dependency retained');
insert into reviews values('expired',pg_temp.bulk_preview('c6000000-0000-4000-8000-000000000005'));
update lesson_ops.lesson_bulk_jobs set expires_at=now()-interval '1 minute' where id=(select (r->>'jobId')::uuid from reviews where kind='expired');
select throws_ok($$select pg_temp.bulk_execute(r,'bulk-expired-tap-key') from reviews where kind='expired'$$,'P0001','REVIEW_EXPIRED','Expired review cannot execute');
select throws_ok($$select lesson_bulk_progress('c3000000-0000-4000-8000-000000000001',(select (r->>'jobId')::uuid from reviews where kind='expired'))$$,'P0001','FORBIDDEN','Student cannot inspect coach review');
insert into reviews values('archive',pg_temp.bulk_preview('c6000000-0000-4000-8000-000000000006','archive'));
select pg_temp.bulk_execute(r,'bulk-archive-tap-key') from reviews where kind='archive';
select pg_temp.bulk_work(r) from reviews where kind='archive';
select is((select status::text from lessons where id='c6000000-0000-4000-8000-000000000006'),'cancelled','Archive leaves lifecycle intact');
select set_config('request.jwt.claim.sub','c1000000-0000-4000-8000-000000000001',true);
select is(lesson_coach_record_visible('c6000000-0000-4000-8000-000000000006'),false,'Coach normal list hides archived record');
select set_config('request.jwt.claim.sub','c3000000-0000-4000-8000-000000000001',true);
select is(lesson_coach_record_visible('c6000000-0000-4000-8000-000000000006'),true,'Portal historical row remains visible');
insert into reviews values('restore',pg_temp.bulk_preview('c6000000-0000-4000-8000-000000000006','restore'));
select pg_temp.bulk_execute(r,'bulk-restore-tap-key') from reviews where kind='restore';
select pg_temp.bulk_work(r) from reviews where kind='restore';
select ok((select archived_at is null from lesson_ops.lesson_record_state where lesson_id='c6000000-0000-4000-8000-000000000006'),'Restore reverses archive');
insert into reviews values('void',pg_temp.bulk_preview('c6000000-0000-4000-8000-000000000007','void'));
select pg_temp.bulk_execute(r,'bulk-void-tap-key') from reviews where kind='void';
select pg_temp.bulk_work(r) from reviews where kind='void';
select ok((select voided_at is not null from lesson_ops.lesson_record_state where lesson_id='c6000000-0000-4000-8000-000000000007'),'Void stores inspectable metadata');
select is((select count(*)::integer from lesson_ops.effects where lesson_id in ('c6000000-0000-4000-8000-000000000006','c6000000-0000-4000-8000-000000000007')),0,'Archive/void send no notification');
select ok(not has_function_privilege('authenticated','public.lesson_bulk_progress(uuid,uuid,integer,integer)','execute'),'Resumable read remains service-only');
select is((select lesson_bulk_progress('c1000000-0000-4000-8000-000000000001',(r->>'jobId')::uuid,0,1)->'reviewContext'->>'reviewToken' from reviews where kind='delete'),(select r->>'reviewToken' from reviews where kind='delete'),'Owner can resume the original review without browser storage');
select is((select (lesson_bulk_progress('c1000000-0000-4000-8000-000000000001',(r->>'jobId')::uuid,0,1)->'counts'->>'processing')::integer from reviews where kind='delete'),0,'Completed job has zero processing items');
select * from finish();
rollback;
