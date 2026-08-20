-- Rich actor portfolio drafts remain private until the coach publishes an immutable revision.
alter table public.actor_profiles
  add column if not exists draft_content jsonb not null default '{}'::jsonb;

alter table public.lessons
  add column if not exists source_provider text not null default 'studio'
    check (source_provider in ('studio','public_booking','google_calendar','gmail','lessonface','wyzant','lessons_com','acuity')),
  add column if not exists source_external_id text,
  add column if not exists source_confidence numeric(4,3),
  add column if not exists imported_at timestamptz;

create unique index if not exists lessons_source_external_unique
  on public.lessons(studio_id, source_provider, source_external_id);

create table if not exists public.integration_imports (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios(id) on delete cascade,
  provider text not null check (provider in ('google_calendar','gmail','lessonface','wyzant','lessons_com','acuity')),
  external_id text not null,
  detected_source text not null,
  student_id uuid references public.students(id) on delete set null,
  lesson_id uuid references public.lessons(id) on delete set null,
  status text not null default 'imported' check (status in ('imported','needs_review','ignored','failed')),
  confidence numeric(4,3) not null default 0,
  matched_by text,
  payload jsonb not null default '{}'::jsonb,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(studio_id,provider,external_id)
);

create index if not exists integration_imports_studio_status_idx
  on public.integration_imports(studio_id,status,created_at desc);

alter table public.integration_imports enable row level security;
drop policy if exists integration_imports_coach_read on public.integration_imports;
create policy integration_imports_coach_read on public.integration_imports
  for select to authenticated using (public.is_studio_coach(studio_id));

revoke all on public.integration_imports from anon;
grant select on public.integration_imports to authenticated;
grant all on public.integration_imports to service_role;
grant select, update on public.actor_profiles to authenticated;
