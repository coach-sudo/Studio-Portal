begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

insert into auth.users (id, email) values
  ('aa000000-0000-4000-8000-000000000001', 'assignment-student@example.test'),
  ('aa000000-0000-4000-8000-000000000002', 'assignment-peer@example.test'),
  ('aa000000-0000-4000-8000-000000000003', 'assignment-coach@example.test'),
  ('aa000000-0000-4000-8000-000000000004', 'assignment-other-coach@example.test'),
  ('aa000000-0000-4000-8000-000000000005', 'assignment-work-household@example.test'),
  ('aa000000-0000-4000-8000-000000000006', 'assignment-schedule-household@example.test');
insert into public.studios (id, name, slug) values
  ('aa000000-0000-4000-8000-000000000010', 'Attachment studio', 'attachment-studio-test'),
  ('aa000000-0000-4000-8000-000000000020', 'Other studio', 'attachment-other-studio-test');
insert into public.memberships (studio_id, user_id, role, display_name) values
  ('aa000000-0000-4000-8000-000000000010', 'aa000000-0000-4000-8000-000000000003', 'coach', 'Coach'),
  ('aa000000-0000-4000-8000-000000000020', 'aa000000-0000-4000-8000-000000000004', 'coach', 'Other coach');
insert into public.students (id, studio_id, user_id, full_name) values
  ('aa000000-0000-4000-8000-000000000011', 'aa000000-0000-4000-8000-000000000010',
   'aa000000-0000-4000-8000-000000000001', 'Student'),
  ('aa000000-0000-4000-8000-000000000012', 'aa000000-0000-4000-8000-000000000010',
   'aa000000-0000-4000-8000-000000000002', 'Peer');
insert into public.student_relationships
  (student_id, user_id, relationship, can_view_work, can_view_schedule, can_view_finance) values
  ('aa000000-0000-4000-8000-000000000011', 'aa000000-0000-4000-8000-000000000005',
   'guardian', true, false, false),
  ('aa000000-0000-4000-8000-000000000011', 'aa000000-0000-4000-8000-000000000006',
   'guardian', false, true, true);
insert into public.assignments (id, student_id, title) values
  ('aa000000-0000-4000-8000-000000000013', 'aa000000-0000-4000-8000-000000000011', 'Practice'),
  ('aa000000-0000-4000-8000-000000000014', 'aa000000-0000-4000-8000-000000000012', 'Peer practice');
select set_config('test.assignment_files.id', 'aa000000-0000-4000-8000-000000000013', true);
select set_config('test.assignment_files.hash', repeat('a', 64), true);
select set_config('test.assignment_files.path',
  'aa000000-0000-4000-8000-000000000010/aa000000-0000-4000-8000-000000000011/'
  || current_setting('test.assignment_files.id') || '/sha256-'
  || current_setting('test.assignment_files.hash'), true);

select ok((select not public and file_size_limit = 52428800
  and 'video/quicktime' = any(allowed_mime_types)
  and 'audio/mpeg' = any(allowed_mime_types)
  and 'text/plain' = any(allowed_mime_types)
  from storage.buckets where id = 'assignment-attachments'),
  'Assignment videos, audio and documents use private storage and the studio size limit');
select ok(not has_table_privilege('anon', 'public.assignment_attachments', 'SELECT'),
  'Anonymous clients have no attachment metadata grant');
select ok(not has_table_privilege('authenticated', 'public.assignment_attachments', 'INSERT'),
  'Authentic attachment metadata can be written only through the record-scoped function');
select ok(not has_function_privilege('anon', 'public.attach_assignment_file(uuid,text,text)', 'EXECUTE'),
  'Anonymous clients cannot attach files');

set local role authenticated;
select set_config('request.jwt.claim.sub', 'aa000000-0000-4000-8000-000000000001', true);
select lives_ok($$insert into storage.objects (bucket_id, name, owner_id, metadata) values
  ('assignment-attachments', current_setting('test.assignment_files.path'),
   auth.uid()::text, '{"size":24,"mimetype":"text/plain"}')$$, 'Student can upload into their own assignment scope');
select is((select count(*) from storage.objects where bucket_id = 'assignment-attachments'),
  0::bigint, 'Unlinked uploads have no download access');
select throws_ok($$select public.attach_assignment_file(
  'aa000000-0000-4000-8000-000000000014', current_setting('test.assignment_files.hash'), 'Practice.txt')
  $$, '42501', 'FORBIDDEN', 'Student cannot attach files to a peer assignment');
select set_config('test.assignment_files.receipt', (public.attach_assignment_file(
  current_setting('test.assignment_files.id')::uuid,
  current_setting('test.assignment_files.hash'), 'Practice.txt')).id::text, true);
select is((public.attach_assignment_file(current_setting('test.assignment_files.id')::uuid,
  current_setting('test.assignment_files.hash'), 'Practice.txt')).id::text,
  current_setting('test.assignment_files.receipt'), 'A repeated attach keeps the same attachment');
select is((select count(*) from public.assignment_attachments where submitted_at is null),
  1::bigint, 'A newly attached file is still a draft');
select is((select count(*) from storage.objects where name=current_setting('test.assignment_files.path')),
  1::bigint, 'Student can download their own attached file before submission');

select set_config('request.jwt.claim.sub', 'aa000000-0000-4000-8000-000000000003', true);
select is((select count(*) from public.assignment_attachments), 0::bigint, 'Coach cannot read pending attachment metadata');
select is((select count(*) from storage.objects where name=current_setting('test.assignment_files.path')),
  0::bigint, 'Coach cannot download the student draft attachment before submission');
select set_config('request.jwt.claim.sub', 'aa000000-0000-4000-8000-000000000005', true);
select is((select count(*) from public.assignment_attachments), 0::bigint, 'Household work permission does not expose pending files');
select throws_ok($$select public.remove_assignment_file(current_setting('test.assignment_files.id')::uuid,
  current_setting('test.assignment_files.receipt')::uuid)$$, '42501', 'FORBIDDEN',
  'Household work permission is read-only');

select set_config('request.jwt.claim.sub', 'aa000000-0000-4000-8000-000000000001', true);
select lives_ok($$select public.remove_assignment_file(current_setting('test.assignment_files.id')::uuid,
  current_setting('test.assignment_files.receipt')::uuid)$$, 'Student can unlink an unsent attachment');
select is((select count(*) from storage.objects where name=current_setting('test.assignment_files.path')),
  0::bigint, 'Unlink revokes access to the removed object');
select set_config('test.assignment_files.receipt', (public.attach_assignment_file(
  current_setting('test.assignment_files.id')::uuid,
  current_setting('test.assignment_files.hash'), 'Practice.txt')).id::text, true);
reset role;
set local role service_role;
select lives_ok($$update public.assignments set status = 'completed', updated_at = now()
  where id = current_setting('test.assignment_files.id')::uuid$$,
  'The authorized completion command submits the existing assignment attachments');
reset role;
set local role authenticated;
select is((select count(*) from public.assignment_attachments where submitted_at is not null),
  1::bigint, 'Submission is persisted on the exact attachment');
select throws_ok($$select public.remove_assignment_file(current_setting('test.assignment_files.id')::uuid,
  current_setting('test.assignment_files.receipt')::uuid)$$, '23514', 'ASSIGNMENT_CLOSED',
  'Student cannot remove a submitted attachment');
select set_config('request.jwt.claim.sub', 'aa000000-0000-4000-8000-000000000003', true);
select is((select count(*) from public.assignment_attachments), 1::bigint, 'Owning coach can see submitted attachment metadata');
select is((select count(*) from storage.objects where name=current_setting('test.assignment_files.path')),
  1::bigint, 'Owning coach can download submitted attachment');
select set_config('request.jwt.claim.sub', 'aa000000-0000-4000-8000-000000000005', true);
select is((select count(*) from public.assignment_attachments), 1::bigint,
  'Authorized household work permission exposes submitted attachment metadata');
select is((select count(*) from storage.objects where name=current_setting('test.assignment_files.path')),
  1::bigint, 'Authorized household can download submitted attachment');
select set_config('request.jwt.claim.sub', 'aa000000-0000-4000-8000-000000000006', true);
select is((select count(*) from public.assignment_attachments), 0::bigint,
  'Schedule and payment permissions do not authorize attachment metadata');
select is((select count(*) from storage.objects where name=current_setting('test.assignment_files.path')),
  0::bigint, 'Schedule and payment permissions do not authorize file bytes');
select set_config('request.jwt.claim.sub', 'aa000000-0000-4000-8000-000000000004', true);
select is((select count(*) from public.assignment_attachments), 0::bigint, 'Cross-studio coach has no attachment metadata access');
select is((select count(*) from storage.objects where name=current_setting('test.assignment_files.path')),
  0::bigint, 'Cross-studio coach has no attachment download access');
select set_config('request.jwt.claim.sub', 'aa000000-0000-4000-8000-000000000002', true);
select is((select count(*) from public.assignment_attachments), 0::bigint, 'Peer student cannot see attachment metadata');
select is((select count(*) from storage.objects where name=current_setting('test.assignment_files.path')),
  0::bigint, 'Peer student cannot download submitted attachment');
select set_config('request.jwt.claim.sub', 'aa000000-0000-4000-8000-000000000003', true);
select throws_ok($$select public.merge_studio_students(
  'aa000000-0000-4000-8000-000000000012',
  'aa000000-0000-4000-8000-000000000011')$$, '23514',
  'ASSIGNMENT_ATTACHMENTS_PREVENT_MERGE',
  'A roster merge cannot move an assignment with attachments to a different student');
select set_config('request.jwt.claim.sub', 'aa000000-0000-4000-8000-000000000001', true);
select is((select count(*) from public.assignment_attachments where student_id =
  'aa000000-0000-4000-8000-000000000011'), 1::bigint,
  'A blocked merge keeps the file linked to its original assignment and student');
select is((select count(*) from storage.objects where name=current_setting('test.assignment_files.path')),
  1::bigint, 'The original student can still download their file after a blocked merge');
select set_config('request.jwt.claim.sub', 'aa000000-0000-4000-8000-000000000003', true);
select lives_ok($$select public.merge_studio_students(
  'aa000000-0000-4000-8000-000000000011',
  'aa000000-0000-4000-8000-000000000012')$$,
  'Assignments without attachments can still move during a roster merge');
reset role;
set local role service_role;
select lives_ok($$update public.assignments set status = 'reopened' where id = current_setting('test.assignment_files.id')::uuid$$,
  'Reopening retains the previous submission');
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'aa000000-0000-4000-8000-000000000001', true);
select throws_ok($$select public.remove_assignment_file(current_setting('test.assignment_files.id')::uuid,
  current_setting('test.assignment_files.receipt')::uuid)$$, '23514', 'ATTACHMENT_SUBMITTED',
  'A reopened assignment preserves the prior submitted file');
reset role;
select is((select count(*) from public.materials where storage_path=current_setting('test.assignment_files.path')),
  0::bigint, 'Assignment attachments do not create shared library or Actor resources');
select set_config('request.jwt.claim.sub', '', true);
set local role anon;
select is((select count(*) from storage.objects where name=current_setting('test.assignment_files.path')),
  0::bigint, 'Anonymous clients cannot find assignment objects');
reset role;
select * from finish();
rollback;
