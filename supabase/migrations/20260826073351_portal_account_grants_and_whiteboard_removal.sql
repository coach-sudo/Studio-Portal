-- Portal identities are readable for routing but may only be mutated through
-- authenticated server commands using the service role.
revoke all on table public.portal_accounts from anon;
revoke insert,update,delete,truncate,references,trigger on table public.portal_accounts from authenticated;
grant select on table public.portal_accounts to authenticated;
grant all on table public.portal_accounts to service_role;

-- Cover the foreign-key and coach lookup paths used by account administration.
create index if not exists portal_accounts_studio_idx on public.portal_accounts(studio_id);
create index if not exists portal_accounts_student_idx on public.portal_accounts(student_id);

-- Whiteboards were removed in favor of Google Meet collaboration tools. The
-- coach explicitly requested deletion of any saved boards.
drop table if exists public.lesson_whiteboards cascade;
