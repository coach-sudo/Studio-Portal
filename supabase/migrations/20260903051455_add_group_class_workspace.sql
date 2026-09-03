-- Single-session group classes receive a shared message board. Existing
-- course data remains intact but is no longer published as a new-booking option.
create table if not exists public.offering_messages (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios(id) on delete cascade,
  offering_id uuid not null references public.service_offerings(id) on delete cascade,
  author_user_id uuid references auth.users(id) on delete set null,
  author_role text not null check (author_role in ('coach','student','guardian')),
  author_name text not null,
  body text not null check (char_length(body) between 1 and 4000),
  created_at timestamptz not null default now()
);

create index if not exists offering_messages_offering_created_idx
  on public.offering_messages(offering_id, created_at);

alter table public.offering_messages enable row level security;

drop policy if exists offering_messages_access on public.offering_messages;
create policy offering_messages_access on public.offering_messages
  for select to authenticated
  using (
    public.is_studio_coach(studio_id)
    or exists (
      select 1
      from public.lessons l
      join public.lesson_participants lp on lp.lesson_id = l.id
      where l.offering_id = offering_messages.offering_id
        and lp.student_id is not null
        and public.can_access_student(lp.student_id)
    )
  );

drop policy if exists offerings_participant_access on public.service_offerings;
create policy offerings_participant_access on public.service_offerings
  for select to authenticated
  using (
    exists (
      select 1
      from public.lessons l
      join public.lesson_participants lp on lp.lesson_id = l.id
      where l.offering_id = service_offerings.id
        and lp.student_id is not null
        and public.can_access_student(lp.student_id)
    )
  );

alter table public.assignments
  add column if not exists group_key text;

alter table public.assignments
  drop constraint if exists assignments_student_group_key_unique;
alter table public.assignments
  add constraint assignments_student_group_key_unique unique(student_id, group_key);

-- A timezone is only treated as a deliberate preference after the person saves it.
-- Existing accounts can therefore start with the browser-observed timezone instead
-- of inheriting the legacy America/New_York default forever.
alter table public.students
  add column if not exists timezone_confirmed boolean not null default false;

update public.students
set timezone_confirmed = true
where timezone is not null
  and timezone <> 'America/New_York';

alter table public.linked_contacts
  add column if not exists timezone text,
  add column if not exists timezone_confirmed boolean not null default false;

update public.booking_services
set published = false,
    version = version + 1,
    updated_at = now()
where category = 'course'
  and published = true;

revoke all on public.offering_messages from anon;
grant select on public.offering_messages to authenticated;
grant all on public.offering_messages to service_role;

comment on table public.offering_messages is
  'Shared message board for an enrolled single-session group class; writes are server-authorized.';
comment on column public.assignments.group_key is
  'Optional idempotency key shared by per-student copies of a class assignment.';
comment on column public.students.timezone_confirmed is
  'True after a student deliberately saves a timezone; false uses browser observation.';
comment on column public.linked_contacts.timezone_confirmed is
  'True after a linked contact deliberately saves their own timezone.';
