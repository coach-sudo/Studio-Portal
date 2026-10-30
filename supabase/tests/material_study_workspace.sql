-- Local isolated full-schema regression. No providers or deliveries.
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
insert into auth.users(id,email) values
 ('e3100000-0000-4000-8000-000000000001','e2e-wave3-coach@example.test'),
 ('e3100000-0000-4000-8000-000000000002','e2e-wave3-student@example.test'),
 ('e3100000-0000-4000-8000-000000000003','e2e-wave3-peer@example.test'),
 ('e3100000-0000-4000-8000-000000000004','e2e-wave3-guardian@example.test');
insert into public.studios(id,name,slug) values ('e3200000-0000-4000-8000-000000000001','Wave 3 test','e2e-wave3-study');
insert into public.memberships(studio_id,user_id,role,display_name) values ('e3200000-0000-4000-8000-000000000001','e3100000-0000-4000-8000-000000000001','coach','Wave 3 coach');
insert into public.students(id,studio_id,user_id,full_name,is_minor,portal_enabled) values
 ('e3300000-0000-4000-8000-000000000001','e3200000-0000-4000-8000-000000000001','e3100000-0000-4000-8000-000000000002','Wave 3 student',false,true),
 ('e3300000-0000-4000-8000-000000000002','e3200000-0000-4000-8000-000000000001','e3100000-0000-4000-8000-000000000003','Wave 3 peer',false,true);
insert into public.linked_contacts(studio_id,student_id,user_id,full_name,email,can_view_work,can_manage_profile,portal_enabled) values
 ('e3200000-0000-4000-8000-000000000001','e3300000-0000-4000-8000-000000000001','e3100000-0000-4000-8000-000000000004','Wave 3 guardian','e2e-wave3-guardian@example.test',true,true,true);
insert into public.materials(id,studio_id,title,text_content,in_library,learner_instructions) values
 ('e3400000-0000-4000-8000-000000000001','e3200000-0000-4000-8000-000000000001','Shared reader','Original paragraph',true,'Shared learner instruction'),
 ('e3400000-0000-4000-8000-000000000002','e3200000-0000-4000-8000-000000000001','Other reader','Other content',true,'');
insert into public.material_links(id,material_id,student_id,role,visible_to_student,instructions) values
 ('e3500000-0000-4000-8000-000000000001','e3400000-0000-4000-8000-000000000001','e3300000-0000-4000-8000-000000000001','library',true,'Assignment instruction'),
 ('e3500000-0000-4000-8000-000000000002','e3400000-0000-4000-8000-000000000001','e3300000-0000-4000-8000-000000000002','library',true,''),
 ('e3500000-0000-4000-8000-000000000003','e3400000-0000-4000-8000-000000000002','e3300000-0000-4000-8000-000000000001','current_script',true,'');
set local role authenticated;
select set_config('request.jwt.claim.sub','e3100000-0000-4000-8000-000000000002',true);
select set_config('test.wave3.content',library_internal.material_content_identity('e3400000-0000-4000-8000-000000000001'),true);
select is(public.search_material_resources('e3200000-0000-4000-8000-000000000001','e3300000-0000-4000-8000-000000000001',false)->>'total','2','Default bounded search preserves legacy scripts');
select is(public.search_material_resources('e3200000-0000-4000-8000-000000000001','e3300000-0000-4000-8000-000000000001',false,p_filters=>'{"excluded_roles":["current_script"]}')->>'total','1','My Work can exclude already displayed scripts explicitly');
select is(public.material_resource_workspace('e3400000-0000-4000-8000-000000000001','e3300000-0000-4000-8000-000000000001','e3500000-0000-4000-8000-000000000001')->'assignment'->>'instructions','Assignment instruction','Exact assignment instructions are available');
select is(public.material_resource_workspace('e3400000-0000-4000-8000-000000000001','e3300000-0000-4000-8000-000000000001','e3500000-0000-4000-8000-000000000003'),null::jsonb,'Assignment from another resource is rejected');
select is(public.material_resource_workspace('e3400000-0000-4000-8000-000000000001','e3300000-0000-4000-8000-000000000001','e3500000-0000-4000-8000-000000000002'),null::jsonb,'Other student assignment is rejected');
select is(public.save_material_study('e3400000-0000-4000-8000-000000000001','e3300000-0000-4000-8000-000000000001',current_setting('test.wave3.content'),'position',null,'{"paragraph":1}','',0)->>'version','1','Reading position saves');
select is(public.save_material_study('e3400000-0000-4000-8000-000000000001','e3300000-0000-4000-8000-000000000001',current_setting('test.wave3.content'),'note','e3600000-0000-4000-8000-000000000001','{"paragraph":1}','Private thought',0)->>'version','1','Owner saves a private note');
select is(public.save_material_study('e3400000-0000-4000-8000-000000000001','e3300000-0000-4000-8000-000000000001',current_setting('test.wave3.content'),'note','e3600000-0000-4000-8000-000000000001','{"paragraph":1}','Private thought',0)->>'version','1','Exact duplicate is idempotent');
select is(public.save_material_study('e3400000-0000-4000-8000-000000000001','e3300000-0000-4000-8000-000000000001',current_setting('test.wave3.content'),'note','e3600000-0000-4000-8000-000000000001','{"paragraph":1}','Edited thought',1)->>'version','2','Versioned edit succeeds');
select throws_ok($$select public.save_material_study('e3400000-0000-4000-8000-000000000001','e3300000-0000-4000-8000-000000000001',current_setting('test.wave3.content'),'note','e3600000-0000-4000-8000-000000000001','{"paragraph":1}','Stale edit',1)$$,'P0001','VERSION_CONFLICT','Stale tab cannot overwrite a note');
select is((select count(*) from public.material_study_annotations),1::bigint,'Owner can retrieve the note');
reset role;
update public.students set portal_enabled=false where id='e3300000-0000-4000-8000-000000000001';
set local role authenticated;
select is((select count(*) from public.material_study_annotations),0::bigint,'Disabled portal suppresses private study access');
reset role;
update public.students set portal_enabled=true where id='e3300000-0000-4000-8000-000000000001';
set local role authenticated;
select set_config('request.jwt.claim.sub','e3100000-0000-4000-8000-000000000001',true);
select is((select count(*) from public.material_study_annotations),0::bigint,'Coach cannot read private notes');
select is((select count(*) from public.material_study_state),0::bigint,'Coach cannot read private position');
select set_config('request.jwt.claim.sub','e3100000-0000-4000-8000-000000000004',true);
select isnt(public.get_material_resource('e3400000-0000-4000-8000-000000000001'),null::jsonb,'Work-authorized guardian can read resource');
select is((select count(*) from public.material_study_annotations),0::bigint,'Profile-managing work guardian cannot read private notes');
select throws_ok($$select public.save_material_study('e3400000-0000-4000-8000-000000000001','e3300000-0000-4000-8000-000000000001',current_setting('test.wave3.content'),'position',null,'{"paragraph":2}','',0)$$,'42501','Resource unavailable','Guardian cannot write student study state');
select set_config('request.jwt.claim.sub','e3100000-0000-4000-8000-000000000003',true);
select is((select count(*) from public.material_study_annotations),0::bigint,'Peer assigned the same resource cannot read notes');
reset role;
select ok(not has_table_privilege('service_role','public.material_study_annotations','SELECT'),'Service-role listing is not granted');
select ok(not has_table_privilege('anon','public.material_study_annotations','SELECT'),'Anonymous listing is not granted');
update public.materials set title='Metadata changed',learner_instructions='Updated instruction' where id='e3400000-0000-4000-8000-000000000001';
set local role authenticated;
select set_config('request.jwt.claim.sub','e3100000-0000-4000-8000-000000000002',true);
select is(library_internal.material_content_identity('e3400000-0000-4000-8000-000000000001'),current_setting('test.wave3.content'),'Metadata edits preserve content identity');
reset role;
update public.materials set text_content='Replacement content' where id='e3400000-0000-4000-8000-000000000001';
set local role authenticated;
select isnt(library_internal.material_content_identity('e3400000-0000-4000-8000-000000000001'),current_setting('test.wave3.content'),'Content replacement changes anchor identity');
select is((select count(*) from public.material_study_annotations where content_identity=library_internal.material_content_identity(material_id)),0::bigint,'Old annotations do not attach to replacement content');
select throws_ok($$select public.save_material_study('e3400000-0000-4000-8000-000000000001','e3300000-0000-4000-8000-000000000001',current_setting('test.wave3.content'),'position',null,'{"paragraph":2}','',1)$$,'42501','Resource unavailable','Cannot save old-content positions to replacement');
reset role;
delete from public.material_links where id='e3500000-0000-4000-8000-000000000001';
set local role authenticated;
select is((select count(*) from public.material_study_annotations),0::bigint,'Revoked resource suppresses annotation display');
reset role;
select is((select count(*) from public.material_study_annotations where id='e3600000-0000-4000-8000-000000000001'),1::bigint,'Revocation retains private annotations');
set local role authenticated;
select set_config('request.jwt.claim.sub','e3100000-0000-4000-8000-000000000001',true);
select throws_ok($$select public.merge_studio_students('e3300000-0000-4000-8000-000000000002','e3300000-0000-4000-8000-000000000001')$$,'P0001','REVIEW_REQUIRED: Use the identity-preserving duplicate profile preview. Existing records and permissions have not moved.','Legacy physical merge requires explicit identity-preserving review');
reset role;
select is((select user_id::text from public.material_study_annotations where id='e3600000-0000-4000-8000-000000000001'),'e3100000-0000-4000-8000-000000000002','Merge preserves original note owner');
select is((select student_id::text from public.material_study_annotations where id='e3600000-0000-4000-8000-000000000001'),'e3300000-0000-4000-8000-000000000001','Review hold preserves the original annotation profile identity');
set local role authenticated;
select set_config('request.jwt.claim.sub','e3100000-0000-4000-8000-000000000003',true);
select is((select count(*) from public.material_study_annotations),0::bigint,'Surviving different login never inherits private notes');
reset role;
select * from finish();
rollback;
