begin;

create extension if not exists pgtap with schema extensions;
select plan(5);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'portal-one@example.test', '', now(), '{}', '{}', now(), now()),
  ('10000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'portal-two@example.test', '', now(), '{}', '{}', now(), now());

insert into public.studios (id, name, slug)
values ('20000000-0000-0000-0000-000000000001', 'RLS Studio', 'rls-studio');

insert into public.students (
  id, studio_id, user_id, full_name, email, status, portal_enabled
) values
  ('30000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'Visible Student', 'portal-one@example.test', 'active', true),
  ('30000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000002', 'Unrelated Student', 'portal-two@example.test', 'active', true);

insert into public.lessons (
  id, studio_id, student_id, topic, starts_at, ends_at,
  status, location_type, location_label
) values
  ('40000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', 'Visible lesson', now() + interval '1 day', now() + interval '1 day 1 hour', 'scheduled', 'virtual', 'Google Meet pending'),
  ('40000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000002', 'Unrelated lesson', now() + interval '2 days', now() + interval '2 days 1 hour', 'scheduled', 'virtual', 'Google Meet pending');

insert into public.recommendations (
  studio_id, student_id, entity_type, reason_code, title, explanation,
  urgency, suggested_action, dedupe_key
) values (
  '20000000-0000-0000-0000-000000000001',
  '30000000-0000-0000-0000-000000000001',
  'student', 'test', 'Coach-only recommendation', 'Private coach detail',
  3, 'review', 'rls-route-test'
);

insert into public.materials (
  id, studio_id, owner_student_id, title, category, external_url
) values
  ('50000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', 'Visible material', 'Scene', 'https://example.test/visible'),
  ('50000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000002', 'Unrelated material', 'Scene', 'https://example.test/unrelated');

insert into public.material_links (
  material_id, student_id, role, visible_to_student
) values
  ('50000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', 'current_script', true),
  ('50000000-0000-0000-0000-000000000002', '30000000-0000-0000-0000-000000000002', 'current_script', true);

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);

select is((select count(*) from public.students), 1::bigint, 'portal user sees only their student row');
select is((select count(*) from public.lessons), 1::bigint, 'portal user sees only their lesson row');
select is((select count(*) from public.recommendations), 0::bigint, 'portal user cannot read coach recommendations');
select is(
  jsonb_array_length(public.studio_route_snapshot(array['students','lessons','administration'])->'students'),
  1,
  'route snapshot RPC preserves student RLS'
);
select is(
  (select count(*) from public.material_library_rows),
  1::bigint,
  'paginated material view preserves student RLS'
);

select * from finish();
rollback;
