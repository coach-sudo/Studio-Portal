alter table public.service_offerings
  add column if not exists description text,
  add column if not exists meeting_url text,
  add column if not exists resource_links jsonb not null default '[]'::jsonb;

create table if not exists public.lesson_messages (
  id uuid primary key default gen_random_uuid(),
  lesson_id uuid not null references public.lessons(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  author_user_id uuid references auth.users(id) on delete set null,
  author_role text not null check (author_role in ('coach','student','guardian')),
  body text not null check (char_length(body) between 1 and 4000),
  created_at timestamptz not null default now()
);

create index if not exists lesson_messages_lesson_created_idx
  on public.lesson_messages(lesson_id, created_at);

alter table public.lesson_messages enable row level security;

drop policy if exists lesson_messages_access on public.lesson_messages;
create policy lesson_messages_access on public.lesson_messages
  for select to authenticated
  using (
    public.can_access_student(student_id)
    and exists (
      select 1 from public.lessons l
      where l.id = lesson_id
        and (
          l.student_id = student_id
          or exists (
            select 1 from public.lesson_participants lp
            where lp.lesson_id = l.id and lp.student_id = student_id
          )
        )
    )
  );

revoke all on public.lesson_messages from anon;
grant select on public.lesson_messages to authenticated;

comment on table public.lesson_messages is
  'Lesson-scoped coach/student conversation. Writes are authorized by server commands; clients receive RLS-scoped reads only.';

-- New services use the studio's current 36-hour change policy. Existing
-- booking snapshots remain immutable and existing bookings keep their terms.
update public.booking_services
set policy = jsonb_set(
      coalesce(policy, '{}'::jsonb),
      '{cancellationWindowHours}',
      '36'::jsonb,
      true
    ),
    policy_version = policy_version + 1,
    updated_at = now()
where coalesce((policy->>'cancellationWindowHours')::integer, 0) <> 36;

update public.studios
set settings = jsonb_set(
      coalesce(settings, '{}'::jsonb),
      '{bookingDefaults,cancellationWindowHours}',
      '36'::jsonb,
      true
    ),
    updated_at = now()
where coalesce((settings#>>'{bookingDefaults,cancellationWindowHours}')::integer, 0) <> 36;
