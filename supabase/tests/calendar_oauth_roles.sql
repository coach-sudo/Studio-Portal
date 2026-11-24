begin;
create extension if not exists pgtap with schema extensions;
select plan(10);
insert into auth.users(id,email) values ('f6510000-0000-4000-8000-000000000001','fixture-oauth@example.test');
insert into public.studios(id,slug,name) values ('f6510000-0000-4000-8000-000000000002','e2e-calendar-oauth','Synthetic');
insert into public.memberships(studio_id,user_id,role,display_name)
values ('f6510000-0000-4000-8000-000000000002','f6510000-0000-4000-8000-000000000001','coach','Fixture');

select ok(not has_function_privilege('authenticated','public.calendar_oauth_refresh(uuid,text)','EXECUTE'),'Coach clients cannot read stored grants');
select ok(not has_function_privilege('anon','public.consume_calendar_oauth(text,text)','EXECUTE'),'Anonymous clients cannot consume OAuth state');
select lives_ok($$select public.begin_calendar_oauth('f6510000-0000-4000-8000-000000000002','f6510000-0000-4000-8000-000000000001','fixture-state','fixture-browser','fixture-verifier')$$,'Stores a synthetic challenge');
select is(public.consume_calendar_oauth('fixture-state','other-browser'),null::jsonb,'Wrong browser cannot consume the challenge');
select is(public.consume_calendar_oauth('fixture-state','fixture-browser')->>'verifier','fixture-verifier','Matching browser consumes once');
select is(public.consume_calendar_oauth('fixture-state','fixture-browser'),null::jsonb,'Replay cannot recover the verifier');
select lives_ok($$select public.save_calendar_oauth('f6510000-0000-4000-8000-000000000002','f6510000-0000-4000-8000-000000000001','fixture-oauth@example.test','synthetic-grant')$$,'Stores a synthetic grant in Vault');
select is(public.calendar_oauth_refresh('f6510000-0000-4000-8000-000000000002','fixture-oauth@example.test'),'synthetic-grant','Reads the grant only for the expected studio and account');
select is(public.calendar_oauth_refresh('f6510000-0000-4000-8000-000000000002','other@example.test'),null::text,'Account mismatch cannot read a grant');
select ok(public.save_calendar_roles('f6510000-0000-4000-8000-000000000002','f6510000-0000-4000-8000-000000000001','primary','primary',array['primary'],array[]::text[]),'Coach can save synthetic Calendar roles');
select * from finish();
rollback;
