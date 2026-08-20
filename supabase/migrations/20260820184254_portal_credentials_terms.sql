-- Durable portal credentials and auditable terms acceptance.
alter table public.students
  add column if not exists portal_username text;

alter table public.students
  drop constraint if exists students_portal_username_format;
alter table public.students
  add constraint students_portal_username_format
  check (
    portal_username is null
    or portal_username ~ '^[A-Za-z][A-Za-z0-9._-]{2,31}$'
  );

create unique index if not exists students_studio_portal_username_unique
  on public.students (studio_id, lower(portal_username))
  where portal_username is not null;

alter table public.bookings
  add column if not exists terms_version text,
  add column if not exists terms_accepted_at timestamptz,
  add column if not exists terms_accepted_by_name text;

create table if not exists public.terms_acceptances (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios(id) on delete cascade,
  booking_id uuid references public.bookings(id) on delete set null,
  student_id uuid references public.students(id) on delete set null,
  user_id uuid references auth.users(id) on delete set null,
  version text not null,
  accepted_by_name text not null,
  accepted_by_email text not null,
  accepted_as_guardian boolean not null default false,
  accepted_at timestamptz not null default now(),
  ip_hash text,
  user_agent text,
  unique (booking_id, version)
);

create index if not exists terms_acceptances_studio_date_idx
  on public.terms_acceptances (studio_id, accepted_at desc);

alter table public.terms_acceptances enable row level security;

drop policy if exists terms_acceptances_coach_read on public.terms_acceptances;
create policy terms_acceptances_coach_read on public.terms_acceptances
  for select to authenticated
  using (public.is_studio_coach(studio_id));

drop policy if exists terms_acceptances_self_read on public.terms_acceptances;
create policy terms_acceptances_self_read on public.terms_acceptances
  for select to authenticated
  using (
    user_id = auth.uid()
    or (student_id is not null and public.can_access_student(student_id))
  );

revoke all on public.terms_acceptances from public, anon;
grant select on public.terms_acceptances to authenticated;
grant all on public.terms_acceptances to service_role;
