-- Synthetic roles and records. The transaction leaves the test database unchanged.
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

insert into auth.users(id,email) values
  ('f7100000-0000-4000-8000-000000000001','recovery-coach@example.test'),
  ('f7100000-0000-4000-8000-000000000002','recovery-second-coach@example.test'),
  ('f7100000-0000-4000-8000-000000000003','recovery-student@example.test'),
  ('f7100000-0000-4000-8000-000000000004','recovery-household@example.test'),
  ('f7100000-0000-4000-8000-000000000005','recovery-foreign-coach@example.test');
insert into public.studios(id,name,slug) values
  ('f7100000-0000-4000-8000-000000000011','Synthetic recovery studio','synthetic-recovery-test'),
  ('f7100000-0000-4000-8000-000000000012','Synthetic foreign studio','synthetic-foreign-recovery-test');
insert into public.memberships(studio_id,user_id,role,display_name) values
  ('f7100000-0000-4000-8000-000000000011','f7100000-0000-4000-8000-000000000001','coach','Synthetic coach'),
  ('f7100000-0000-4000-8000-000000000011','f7100000-0000-4000-8000-000000000002','coach','Synthetic second coach'),
  ('f7100000-0000-4000-8000-000000000012','f7100000-0000-4000-8000-000000000005','coach','Synthetic foreign coach');
insert into public.students(id,studio_id,user_id,full_name) values
  ('f7100000-0000-4000-8000-000000000021','f7100000-0000-4000-8000-000000000011','f7100000-0000-4000-8000-000000000003','Synthetic student'),
  ('f7100000-0000-4000-8000-000000000022','f7100000-0000-4000-8000-000000000011',null,'Second synthetic student');
insert into public.linked_contacts(studio_id,student_id,user_id,full_name,email,portal_enabled,can_view_work)
values ('f7100000-0000-4000-8000-000000000011','f7100000-0000-4000-8000-000000000021',
  'f7100000-0000-4000-8000-000000000004','Synthetic household','recovery-household@example.test',true,true);
insert into public.lessons(id,studio_id,student_id,topic,starts_at,ends_at,status,location_type,location_label)
values ('f7100000-0000-4000-8000-000000000031','f7100000-0000-4000-8000-000000000011',
  'f7100000-0000-4000-8000-000000000021','Synthetic lesson',now(),now()+interval '1 hour','completed','virtual','Synthetic');
insert into public.notes(id,lesson_id,student_id,title,body,body_html,status,published_at)
values ('f7100000-0000-4000-8000-000000000041','f7100000-0000-4000-8000-000000000031',
  'f7100000-0000-4000-8000-000000000021','Public title','Public feedback','<p>Public feedback</p>','published',now());

create function pg_temp.recover(action text, is_new boolean, payload jsonb default '{}')
returns jsonb language sql security invoker as $$
  select public.manage_lesson_note_recovery(action,'f7100000-0000-4000-8000-000000000021',
    case when is_new then null::uuid else 'f7100000-0000-4000-8000-000000000041'::uuid end,
    null,payload);
$$;

select ok(not has_function_privilege('anon','public.manage_lesson_note_recovery(text,uuid,uuid,uuid,jsonb)','EXECUTE'),
  'Anonymous access is denied at the RPC grant');
select ok(not has_table_privilege('authenticated','workspace_internal.lesson_note_recoveries','SELECT'),
  'Authenticated clients have no direct access to recovery rows');
select ok(not has_table_privilege('authenticated','workspace_internal.lesson_note_recoveries','UPDATE'),
  'Recovery writes always go through the CAS check');
select ok(not (select prosecdef from pg_proc
  where oid='public.manage_lesson_note_recovery(text,uuid,uuid,uuid,jsonb)'::regprocedure),
  'The exposed RPC is security invoker');

set local role authenticated;
select set_config('request.jwt.claim.sub','f7100000-0000-4000-8000-000000000001',true);
select is(pg_temp.recover('read',true),null::jsonb,'A fresh new-note scope is empty');
select is(pg_temp.recover('save',true,'{"workingNoteId":"f7100000-0000-4000-8000-000000000042","baseVersion":0,
  "lessonId":null,"title":"Before first save","body":"Outline","bodyHtml":"<p>Outline</p>","expectedVersion":0,
  "writeId":"f7100000-0000-4000-8000-000000000051"}')->>'version','1','A new note can recover writing before choosing a lesson');
select is(pg_temp.recover('save',true,'{"workingNoteId":"f7100000-0000-4000-8000-000000000042","baseVersion":0,
  "lessonId":null,"title":"Before first save","body":"Outline","bodyHtml":"<p>Outline</p>","expectedVersion":0,
  "writeId":"f7100000-0000-4000-8000-000000000051"}')->>'version','1','Retry after a lost response returns the original version');
select is((select count(*) from public.notes where id='f7100000-0000-4000-8000-000000000042'),0::bigint,
  'Private recovery never creates a published or explicit note');
select is(pg_temp.recover('save',false,'{"workingNoteId":"f7100000-0000-4000-8000-000000000041","baseVersion":1,
  "lessonId":"f7100000-0000-4000-8000-000000000031","title":"Private title","body":"Private feedback",
  "bodyHtml":"<p><strong>Private feedback</strong></p>","expectedVersion":0,
  "writeId":"f7100000-0000-4000-8000-000000000052"}')->>'version','1',
  'Coach may write a private revision of an existing published note');
select throws_ok($$select pg_temp.recover('save',false,'{"workingNoteId":"f7100000-0000-4000-8000-000000000041","baseVersion":1,
  "lessonId":"f7100000-0000-4000-8000-000000000031","title":"Another editor","body":"Different text",
  "bodyHtml":"<p>Different text</p>","expectedVersion":0,"writeId":"f7100000-0000-4000-8000-000000000053"}')$$,
  '40001','VERSION_CONFLICT','A stale editor cannot overwrite the committed recovery');
select is(pg_temp.recover('read',false)->>'bodyHtml','<p><strong>Private feedback</strong></p>',
  'A reopened recovery returns exact saved rich content');
select throws_ok($$select public.manage_lesson_note_recovery('read','f7100000-0000-4000-8000-000000000022',
  'f7100000-0000-4000-8000-000000000041',null,'{}')$$,'42501','FORBIDDEN',
  'The note ID must match the selected student');

select set_config('request.jwt.claim.sub','f7100000-0000-4000-8000-000000000002',true);
select is(pg_temp.recover('read',false),null::jsonb,'A second authorized studio coach cannot read another authors recovery text');
select set_config('request.jwt.claim.sub','f7100000-0000-4000-8000-000000000005',true);
select throws_ok($$select pg_temp.recover('read',false)$$,'42501','FORBIDDEN','Cross-studio recovery is denied');
select set_config('request.jwt.claim.sub','f7100000-0000-4000-8000-000000000003',true);
select throws_ok($$select pg_temp.recover('read',false)$$,'42501','FORBIDDEN','Student cannot read the private revision');
select is((select body_html from public.notes where id='f7100000-0000-4000-8000-000000000041'),
  '<p>Public feedback</p>','The student still sees the original published revision');
select set_config('request.jwt.claim.sub','f7100000-0000-4000-8000-000000000004',true);
select throws_ok($$select pg_temp.recover('read',false)$$,'42501','FORBIDDEN','Work-authorized household cannot read the private revision');
select is((select body_html from public.notes where id='f7100000-0000-4000-8000-000000000041'),
  '<p>Public feedback</p>','The authorized household still sees the original published revision');

reset role;
update public.notes set title='Private title',body='Private feedback',body_html='<p><strong>Private feedback</strong></p>',version=2
where id='f7100000-0000-4000-8000-000000000041';
set local role authenticated;
select set_config('request.jwt.claim.sub','f7100000-0000-4000-8000-000000000001',true);
select is(pg_temp.recover('read',false)->>'committed','true','A committed explicit save can be recognized after interruption');
select is(pg_temp.recover('discard',false,
  jsonb_build_object('recoveryId',pg_temp.recover('read',false)->>'id','expectedVersion',1)),
  null::jsonb,'Discard retires the recovery by exact version');
select is(pg_temp.recover('read',false),null::jsonb,'An acknowledged discard does not recover again');
select set_config('request.jwt.claim.sub','f7100000-0000-4000-8000-000000000003',true);
select is((select body_html from public.notes where id='f7100000-0000-4000-8000-000000000041'),
  '<p><strong>Private feedback</strong></p>','Authorized publication reads preserve the confirmed rich content');

reset role;
update workspace_internal.lesson_note_recoveries set expires_at=now()-interval '1 day'
where working_note_id='f7100000-0000-4000-8000-000000000042';
set local role authenticated;
select set_config('request.jwt.claim.sub','f7100000-0000-4000-8000-000000000001',true);
select is(pg_temp.recover('read',true),null::jsonb,'Expired recovery is unavailable');
reset role;
select is(workspace_internal.prune_lesson_note_recoveries(),1::bigint,'Maintenance removes expired data');
select is((select status::text from public.lessons where id='f7100000-0000-4000-8000-000000000031'),
  'completed','Recovery leaves lesson workflow untouched');
select is((select count(*) from public.outbox_messages where studio_id='f7100000-0000-4000-8000-000000000011'),0::bigint,
  'Recovery queues no communications');

select * from finish();
rollback;
