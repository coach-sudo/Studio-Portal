begin;
create extension if not exists pgtap with schema extensions;
select plan(14);

insert into auth.users(id,email) values
  ('f7200000-0000-4000-8000-000000000001','gmail-coach@example.test'),
  ('f7200000-0000-4000-8000-000000000002','gmail-student@example.test');
insert into public.studios(id,name,slug) values
  ('f7200000-0000-4000-8000-000000000011','Synthetic Gmail studio','synthetic-gmail-oauth'),
  ('f7200000-0000-4000-8000-000000000012','Synthetic other studio','synthetic-gmail-other');
insert into public.memberships(studio_id,user_id,role,display_name) values
  ('f7200000-0000-4000-8000-000000000011','f7200000-0000-4000-8000-000000000001','coach','Synthetic coach');

select ok(not has_function_privilege('anon','public.gmail_delivery_oauth_status(uuid,text)','EXECUTE'),
  'Anonymous callers cannot inspect grant metadata');
select ok(not has_function_privilege('authenticated','public.gmail_delivery_oauth_refresh(uuid,text,text)','EXECUTE'),
  'Authenticated callers cannot read a credential');
select ok(not has_function_privilege('authenticated','public.save_gmail_delivery_oauth(uuid,uuid,text,text,text)','EXECUTE'),
  'Authenticated callers cannot install a credential directly');
select ok(not has_table_privilege('service_role','gmail_delivery_oauth_internal.pending','SELECT'),
  'The service role uses the dedicated RPCs for PKCE');

set local role service_role;
select throws_ok($$select public.begin_gmail_delivery_oauth('f7200000-0000-4000-8000-000000000011',
  'f7200000-0000-4000-8000-000000000002','state','browser','verifier')$$,'P0001','FORBIDDEN',
  'A coach role is required when starting the request');
select lives_ok($$select public.begin_gmail_delivery_oauth('f7200000-0000-4000-8000-000000000011',
  'f7200000-0000-4000-8000-000000000001','state','browser','verifier')$$,
  'The service can start a scoped coach recovery');
select is(public.consume_gmail_delivery_oauth('state','other-browser'),null::jsonb,
  'Mismatched browsers cannot consume the state');
select is(public.consume_gmail_delivery_oauth('state','browser')->>'verifier','verifier',
  'A matched browser receives the saved PKCE verifier');
select is(public.consume_gmail_delivery_oauth('state','browser'),null::jsonb,
  'A callback state is one-time');
select lives_ok($$select public.save_gmail_delivery_oauth('f7200000-0000-4000-8000-000000000011',
  'f7200000-0000-4000-8000-000000000001','sender@example.test','gmail-client','synthetic-grant')$$,
  'Only the scoped service operation installs a Gmail grant');
select is(public.gmail_delivery_oauth_refresh('f7200000-0000-4000-8000-000000000011','sender@example.test','gmail-client'),
  'synthetic-grant','The intended route reads its Vault credential');
select is(public.gmail_delivery_oauth_refresh('f7200000-0000-4000-8000-000000000011','sender@example.test','different-client'),
  null::text,'The legacy client cannot read the dedicated credential');
select is(public.gmail_delivery_oauth_refresh('f7200000-0000-4000-8000-000000000012','sender@example.test','gmail-client'),
  null::text,'Another studio cannot use the credential');
select ok(not (public.gmail_delivery_oauth_status('f7200000-0000-4000-8000-000000000011','gmail-client')::text like '%synthetic-grant%'),
  'Status returns account metadata without the refresh credential');
reset role;

select * from finish();
rollback;
