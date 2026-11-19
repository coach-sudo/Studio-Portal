-- Exercise lesson files and script revisions under the actual authenticated role.
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
insert into auth.users(id,email) values
  ('5b000000-0000-4000-8000-000000000001','my-work-student@example.test'),
  ('5b000000-0000-4000-8000-000000000002','my-work-peer@example.test');
insert into public.studios(id,name,slug) values ('5b000000-0000-4000-8000-000000000003','My Work test','my-work-test');
insert into public.students(id,studio_id,user_id,full_name,portal_enabled) values
  ('5b000000-0000-4000-8000-000000000004','5b000000-0000-4000-8000-000000000003','5b000000-0000-4000-8000-000000000001','Student',true),
  ('5b000000-0000-4000-8000-000000000005','5b000000-0000-4000-8000-000000000003','5b000000-0000-4000-8000-000000000002','Peer',true);
insert into public.lessons(id,studio_id,student_id,topic,starts_at,ends_at,location_type,location_label) values
  ('5b000000-0000-4000-8000-000000000006','5b000000-0000-4000-8000-000000000003','5b000000-0000-4000-8000-000000000004','Rehearsal','2030-02-01T10:00:00Z','2030-02-01T11:00:00Z','virtual','Online'),
  ('5b000000-0000-4000-8000-000000000007','5b000000-0000-4000-8000-000000000003','5b000000-0000-4000-8000-000000000005','Other rehearsal','2030-02-01T11:00:00Z','2030-02-01T12:00:00Z','virtual','Online');
insert into public.file_assets(id,studio_id,owner_student_id,uploaded_by,entity_type,storage_path,original_name,mime_type,file_size_bytes,visibility) values
  ('5b000000-0000-4000-8000-000000000008','5b000000-0000-4000-8000-000000000003','5b000000-0000-4000-8000-000000000004','5b000000-0000-4000-8000-000000000001','material','5b000000-0000-4000-8000-000000000003/5b000000-0000-4000-8000-000000000004/student/test','Sides.docx','application/vnd.openxmlformats-officedocument.wordprocessingml.document',42,'student');
select ok((select not public and file_size_limit=52428800 and 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'=any(allowed_mime_types) from storage.buckets where id='studio-materials'),'Word upload is allowed in the private 50 MB bucket');
set local role authenticated;
select set_config('request.jwt.claim.sub','5b000000-0000-4000-8000-000000000001',true);
select set_config('test.my_work.attachment','{"studioId":"5b000000-0000-4000-8000-000000000003","studentId":"5b000000-0000-4000-8000-000000000004","lessonId":"5b000000-0000-4000-8000-000000000006","fileAssetId":"5b000000-0000-4000-8000-000000000008","title":"Sides.docx"}',true);
select set_config('test.my_work.first_script','{"studentId":"5b000000-0000-4000-8000-000000000004","requestId":"5b000000-0000-4000-8000-000000000009","title":"First script","externalUrl":"https://example.test/first"}',true);
select isnt(public.manage_material_resources('resource_attach_file',current_setting('test.my_work.attachment')::jsonb)->>'id',null,'Student attaches a Word file');
select is(public.manage_material_resources('resource_attach_file',current_setting('test.my_work.attachment')::jsonb)->>'id',(select material_id::text from public.material_links where lesson_id='5b000000-0000-4000-8000-000000000006'),'Retry finds the original lesson attachment');
select throws_ok($$select public.manage_material_resources('resource_attach_file',current_setting('test.my_work.attachment')::jsonb || '{"lessonId":"5b000000-0000-4000-8000-000000000007"}')$$,'P0001','Invalid related lesson','Student cannot attach files to another studentâ€™s lesson');
select is(public.manage_material_resources('replace_current_script',current_setting('test.my_work.first_script')::jsonb)->>'title','First script','Student starts with a link');
select throws_ok($$select public.manage_material_resources('replace_current_script',current_setting('test.my_work.first_script')::jsonb || '{"lessonId":"5b000000-0000-4000-8000-000000000007"}')$$,'P0001','Choose a lesson for this student','Wrong lesson cannot replace the current script');
select is((select status::text from public.materials where id='5b000000-0000-4000-8000-000000000009'),'active','Rejected update leaves the current script active');
select is(public.manage_material_resources('replace_current_script','{"studentId":"5b000000-0000-4000-8000-000000000004","lessonId":"5b000000-0000-4000-8000-000000000006","requestId":"5b000000-0000-4000-8000-000000000010","title":"New script","storagePath":"5b000000-0000-4000-8000-000000000003/5b000000-0000-4000-8000-000000000004/student/test"}')->>'file_asset_id','5b000000-0000-4000-8000-000000000008','File revision uses the existing private file asset');
select is(public.manage_material_resources('replace_current_script',current_setting('test.my_work.first_script')::jsonb)->>'status','archived','Retrying a previous script leaves it archived');
select is((select count(*) from public.material_links where student_id='5b000000-0000-4000-8000-000000000004' and role='current_script' and status='active'),1::bigint,'One script is current after replacement');
select isnt(public.material_resource_workspace('5b000000-0000-4000-8000-000000000009','5b000000-0000-4000-8000-000000000004'),null::jsonb,'Student can still open archived script');
select set_config('request.jwt.claim.sub','5b000000-0000-4000-8000-000000000002',true);
select throws_ok($$select public.manage_material_resources('replace_current_script',current_setting('test.my_work.first_script')::jsonb)$$,'42501','FORBIDDEN','Other students cannot replace scripts');
select throws_ok($$select public.manage_material_resources('resource_attach_file',current_setting('test.my_work.attachment')::jsonb)$$,'42501','FORBIDDEN','Other students cannot access or attach private files');
reset role;
select * from finish();
rollback;
