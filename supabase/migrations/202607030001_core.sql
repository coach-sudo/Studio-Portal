create extension if not exists pgcrypto;

do $$ begin create type public.studio_role as enum ('coach','student','guardian'); exception when duplicate_object then null; end $$;
do $$ begin create type public.student_status as enum ('lead','active','paused','alumni','inactive'); exception when duplicate_object then null; end $$;
do $$ begin create type public.lesson_status as enum ('draft','scheduled','completed','cancelled','late_cancelled','no_show'); exception when duplicate_object then null; end $$;
do $$ begin create type public.content_status as enum ('draft','published','archived'); exception when duplicate_object then null; end $$;
do $$ begin create type public.assignment_status as enum ('assigned','in_progress','completed','reopened'); exception when duplicate_object then null; end $$;
do $$ begin create type public.material_status as enum ('active','vaulted','archived'); exception when duplicate_object then null; end $$;
do $$ begin create type public.approval_status as enum ('not_public','pending_review','changes_requested','approved','removed'); exception when duplicate_object then null; end $$;
do $$ begin create type public.actor_profile_status as enum ('draft','review_requested','changes_requested','approved','published','archived'); exception when duplicate_object then null; end $$;
do $$ begin create type public.reader_request_status as enum ('submitted','coach_review','approved','queued','sent','fulfilled','cancelled'); exception when duplicate_object then null; end $$;
do $$ begin create type public.delivery_status as enum ('draft','approved','queued','sending','sent','failed','cancelled'); exception when duplicate_object then null; end $$;
do $$ begin create type public.credit_entry_kind as enum ('purchase','reservation','consumption','release','adjustment','expiration'); exception when duplicate_object then null; end $$;
do $$ begin create type public.payment_entry_kind as enum ('payment','refund','adjustment'); exception when duplicate_object then null; end $$;

create table if not exists public.studios (
  id uuid primary key default gen_random_uuid(), name text not null, slug text not null unique,
  timezone text not null default 'America/New_York', settings jsonb not null default '{}', created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.memberships (
  id uuid primary key default gen_random_uuid(), studio_id uuid not null references public.studios(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade, role public.studio_role not null,
  display_name text not null, created_at timestamptz not null default now(), unique(studio_id,user_id,role)
);
create table if not exists public.students (
  id uuid primary key default gen_random_uuid(), studio_id uuid not null references public.studios(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null, full_name text not null, email text, phone text,
  status public.student_status not null default 'lead', focus_area text, is_minor boolean not null default false,
  portal_enabled boolean not null default true, actor_page_eligible boolean not null default false,
  version integer not null default 1 check(version > 0), created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.student_relationships (
  id uuid primary key default gen_random_uuid(), student_id uuid not null references public.students(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade, relationship text not null,
  can_view_finance boolean not null default false, can_manage_profile boolean not null default false,
  created_at timestamptz not null default now(), unique(student_id,user_id)
);
create table if not exists public.lessons (
  id uuid primary key default gen_random_uuid(), studio_id uuid not null references public.studios(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete restrict, topic text not null,
  starts_at timestamptz not null, ends_at timestamptz not null, status public.lesson_status not null default 'draft',
  location_type text not null check(location_type in ('virtual','in_person')), location_label text not null, join_url text,
  package_id uuid, version integer not null default 1 check(version > 0), created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  check(ends_at > starts_at)
);
create table if not exists public.notes (
  id uuid primary key default gen_random_uuid(), lesson_id uuid not null references public.lessons(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade, title text not null, body text not null default '',
  status public.content_status not null default 'draft', published_at timestamptz,
  version integer not null default 1 check(version > 0), created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.assignments (
  id uuid primary key default gen_random_uuid(), lesson_id uuid references public.lessons(id) on delete set null,
  student_id uuid not null references public.students(id) on delete cascade, title text not null, details text not null default '', due_at timestamptz,
  status public.assignment_status not null default 'assigned', help_requested boolean not null default false,
  version integer not null default 1 check(version > 0), created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.materials (
  id uuid primary key default gen_random_uuid(), studio_id uuid not null references public.studios(id) on delete cascade,
  owner_student_id uuid references public.students(id) on delete cascade, title text not null, category text not null default 'Other',
  storage_path text, external_url text, status public.material_status not null default 'active', approval_status public.approval_status not null default 'not_public',
  version integer not null default 1 check(version > 0), created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  check(storage_path is not null or external_url is not null)
);
create table if not exists public.material_links (
  id uuid primary key default gen_random_uuid(), material_id uuid not null references public.materials(id) on delete cascade,
  student_id uuid references public.students(id) on delete cascade, lesson_id uuid references public.lessons(id) on delete cascade,
  role text not null check(role in ('current_script','lesson_material','library','actor_material')),
  visible_to_student boolean not null default false, created_at timestamptz not null default now(),
  check(student_id is not null or lesson_id is not null)
);
create table if not exists public.packages (
  id uuid primary key default gen_random_uuid(), student_id uuid not null references public.students(id) on delete restrict,
  name text not null, price_minor bigint not null default 0 check(price_minor >= 0), currency text not null default 'USD' check(char_length(currency)=3), expires_at timestamptz,
  stripe_price_id text, credit_quantity integer not null default 1 check(credit_quantity > 0), version integer not null default 1 check(version > 0), created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
alter table public.lessons drop constraint if exists lessons_package_id_fkey;
alter table public.lessons add constraint lessons_package_id_fkey foreign key(package_id) references public.packages(id) on delete set null;
create table if not exists public.package_credit_entries (
  id uuid primary key default gen_random_uuid(), package_id uuid not null references public.packages(id) on delete restrict,
  lesson_id uuid references public.lessons(id) on delete restrict, kind public.credit_entry_kind not null, quantity integer not null check(quantity <> 0),
  reason text not null, idempotency_key text unique, created_by uuid references auth.users(id) on delete set null, created_at timestamptz not null default now()
);
create table if not exists public.payment_entries (
  id uuid primary key default gen_random_uuid(), student_id uuid not null references public.students(id) on delete restrict,
  package_id uuid references public.packages(id) on delete restrict, kind public.payment_entry_kind not null,
  amount_minor bigint not null check(amount_minor >= 0), currency text not null default 'USD' check(char_length(currency)=3),
  external_reference text unique, reason text not null, created_by uuid references auth.users(id) on delete set null, created_at timestamptz not null default now()
);
create table if not exists public.actor_profiles (
  id uuid primary key default gen_random_uuid(), student_id uuid not null unique references public.students(id) on delete cascade,
  slug text not null unique, display_name text not null, bio text not null default '', status public.actor_profile_status not null default 'draft',
  published_revision_id uuid, version integer not null default 1 check(version > 0), created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.actor_profile_revisions (
  id uuid primary key default gen_random_uuid(), actor_profile_id uuid not null references public.actor_profiles(id) on delete cascade,
  revision_number integer not null, content jsonb not null, published_at timestamptz not null default now(), unique(actor_profile_id,revision_number)
);
alter table public.actor_profiles drop constraint if exists actor_profiles_published_revision_id_fkey;
alter table public.actor_profiles add constraint actor_profiles_published_revision_id_fkey foreign key(published_revision_id) references public.actor_profile_revisions(id) on delete set null;
create table if not exists public.profile_submissions (
  id uuid primary key default gen_random_uuid(), actor_profile_id uuid not null references public.actor_profiles(id) on delete cascade,
  material_id uuid references public.materials(id) on delete set null, submitted_by uuid references auth.users(id) on delete set null,
  approval_status public.approval_status not null default 'pending_review', coach_note text, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.reader_requests (
  id uuid primary key default gen_random_uuid(), student_id uuid not null references public.students(id) on delete cascade,
  filming_at timestamptz not null, meeting_method text not null, instructions text not null default '', status public.reader_request_status not null default 'submitted',
  version integer not null default 1 check(version > 0), created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.outbox_messages (
  id uuid primary key default gen_random_uuid(), studio_id uuid not null references public.studios(id) on delete cascade,
  student_id uuid references public.students(id) on delete set null, channel text not null check(channel in ('email','sms')),
  recipient text not null, subject text not null default '', body text not null, status public.delivery_status not null default 'draft',
  attempts integer not null default 0 check(attempts >= 0), next_attempt_at timestamptz, last_error text,
  version integer not null default 1 check(version > 0), created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.delivery_attempts (
  id uuid primary key default gen_random_uuid(), outbox_message_id uuid not null references public.outbox_messages(id) on delete cascade,
  provider text not null, provider_reference text, response jsonb not null default '{}', succeeded boolean not null, error text, created_at timestamptz not null default now()
);
create table if not exists public.calendar_connections (
  id uuid primary key default gen_random_uuid(), studio_id uuid not null unique references public.studios(id) on delete cascade,
  provider_account text not null, calendar_id text not null, token_secret_ref text not null, status text not null, last_success_at timestamptz, last_error text, updated_at timestamptz not null default now()
);
create table if not exists public.calendar_projections (
  id uuid primary key default gen_random_uuid(), lesson_id uuid not null unique references public.lessons(id) on delete cascade,
  external_event_id text unique, projected_version integer not null default 0, external_version text, status text not null default 'queued', last_projected_at timestamptz, last_error text
);
create table if not exists public.sync_conflicts (
  id uuid primary key default gen_random_uuid(), studio_id uuid not null references public.studios(id) on delete cascade,
  entity_type text not null, entity_id uuid not null, source text not null, internal_version integer not null, external_payload jsonb not null,
  status text not null default 'open' check(status in ('open','accepted_internal','accepted_external','merged')), created_at timestamptz not null default now(), resolved_at timestamptz
);
create table if not exists public.recommendations (
  id uuid primary key default gen_random_uuid(), studio_id uuid not null references public.studios(id) on delete cascade,
  student_id uuid references public.students(id) on delete cascade, entity_type text not null, entity_id uuid,
  reason_code text not null, title text not null, explanation text not null, evidence jsonb not null default '[]', urgency smallint not null check(urgency between 1 and 5),
  due_at timestamptz, suggested_action text not null, requires_confirmation boolean not null default true,
  status text not null default 'open' check(status in ('open','snoozed','resolved','dismissed')), dedupe_key text not null unique,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.webhook_events (
  id text primary key, provider text not null, event_type text not null, payload jsonb not null, status text not null default 'received',
  error text, received_at timestamptz not null default now(), processed_at timestamptz
);
create table if not exists public.idempotency_keys (
  key text primary key, actor_id uuid, command text not null, request_hash text not null, response jsonb, created_at timestamptz not null default now(), expires_at timestamptz not null default now()+interval '7 days'
);
create table if not exists public.audit_events (
  id uuid primary key default gen_random_uuid(), studio_id uuid not null references public.studios(id) on delete cascade,
  actor_id uuid references auth.users(id) on delete set null, action text not null, entity_type text not null, entity_id uuid not null,
  reason text not null, correlation_id text not null, source text not null, before_state jsonb, after_state jsonb, created_at timestamptz not null default now()
);

create index if not exists memberships_studio_id_idx on public.memberships(studio_id);
create index if not exists memberships_user_id_idx on public.memberships(user_id);
create index if not exists students_studio_id_idx on public.students(studio_id);
create index if not exists students_user_id_idx on public.students(user_id);
create index if not exists student_relationships_user_id_idx on public.student_relationships(user_id);
create index if not exists student_relationships_student_id_idx on public.student_relationships(student_id);
create index if not exists lessons_studio_starts_idx on public.lessons(studio_id,starts_at);
create index if not exists lessons_student_id_idx on public.lessons(student_id);
create index if not exists lessons_package_id_idx on public.lessons(package_id);
create index if not exists notes_student_id_idx on public.notes(student_id);
create index if not exists notes_lesson_id_idx on public.notes(lesson_id);
create index if not exists assignments_student_id_idx on public.assignments(student_id);
create index if not exists materials_studio_id_idx on public.materials(studio_id);
create index if not exists materials_owner_student_id_idx on public.materials(owner_student_id);
create index if not exists material_links_material_id_idx on public.material_links(material_id);
create index if not exists material_links_student_id_idx on public.material_links(student_id);
create index if not exists material_links_lesson_id_idx on public.material_links(lesson_id);
create index if not exists packages_student_id_idx on public.packages(student_id);
create index if not exists package_credit_entries_package_id_idx on public.package_credit_entries(package_id);
create index if not exists payment_entries_student_id_idx on public.payment_entries(student_id);
create index if not exists actor_profiles_student_id_idx on public.actor_profiles(student_id);
create index if not exists outbox_messages_status_attempt_idx on public.outbox_messages(status,next_attempt_at) where status in ('queued','failed');
create index if not exists recommendations_studio_open_idx on public.recommendations(studio_id,urgency desc,due_at) where status='open';
create index if not exists audit_events_entity_idx on public.audit_events(entity_type,entity_id,created_at desc);
