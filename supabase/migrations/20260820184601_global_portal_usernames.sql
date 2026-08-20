-- Usernames are entered without a studio slug, so they must resolve globally.
drop index if exists public.students_studio_portal_username_unique;
create unique index if not exists students_portal_username_unique
  on public.students (lower(portal_username))
  where portal_username is not null;
