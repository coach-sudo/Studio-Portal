-- Live branding, rich content, private uploads, actor media and portal controls.

alter table public.students
  add column if not exists preferred_name text,
  add column if not exists pronouns text,
  add column if not exists goals text not null default '',
  add column if not exists lead_source text,
  add column if not exists tags text[] not null default '{}',
  add column if not exists last_contact_at timestamptz,
  add column if not exists drive_folder_url text,
  add column if not exists portal_preferences jsonb not null default '{"compactView":false,"emailReminders":true,"timezoneDisplay":"local"}',
  add column if not exists stripe_customer_id text unique,
  add column if not exists payment_method_summary jsonb not null default '{}';

alter table public.notes
  add column if not exists body_html text,
  add column if not exists rich_content jsonb not null default '{"version":1,"blocks":[]}',
  add column if not exists category text not null default 'lesson_note',
  add column if not exists tags text[] not null default '{}',
  add column if not exists pinned boolean not null default false;

alter table public.assignments
  add column if not exists category text not null default 'practice',
  add column if not exists priority smallint not null default 2 check(priority between 1 and 3),
  add column if not exists progress smallint not null default 0 check(progress between 0 and 100),
  add column if not exists student_response text not null default '',
  add column if not exists tags text[] not null default '{}';

alter table public.materials
  add column if not exists caption text not null default '',
  add column if not exists mime_type text,
  add column if not exists file_size_bytes bigint check(file_size_bytes is null or file_size_bytes >= 0),
  add column if not exists media_kind text not null default 'document' check(media_kind in ('image','video','audio','document','link')),
  add column if not exists thumbnail_path text,
  add column if not exists public_embed boolean not null default false,
  add column if not exists sort_order integer not null default 0;

create table if not exists public.file_assets (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios(id) on delete cascade,
  owner_student_id uuid references public.students(id) on delete cascade,
  uploaded_by uuid not null references auth.users(id) on delete restrict,
  entity_type text not null check(entity_type in ('student','lesson','note','assignment','material','actor_profile','studio')),
  entity_id uuid,
  bucket_id text not null default 'studio-materials',
  storage_path text not null unique,
  original_name text not null,
  mime_type text not null,
  file_size_bytes bigint not null check(file_size_bytes between 1 and 52428800),
  visibility text not null default 'private' check(visibility in ('private','student','public_actor')),
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index if not exists file_assets_studio_entity_idx on public.file_assets(studio_id,entity_type,entity_id);
create index if not exists file_assets_student_idx on public.file_assets(owner_student_id,created_at desc);
alter table public.file_assets enable row level security;
create policy file_assets_access on public.file_assets for select to authenticated
  using(public.is_studio_coach(studio_id) or (owner_student_id is not null and public.can_access_student(owner_student_id)));
create policy file_assets_insert on public.file_assets for insert to authenticated
  with check(public.is_studio_coach(studio_id) or (owner_student_id is not null and public.can_access_student(owner_student_id) and uploaded_by=(select auth.uid())));
create policy file_assets_coach_update on public.file_assets for update to authenticated
  using(public.is_studio_coach(studio_id)) with check(public.is_studio_coach(studio_id));
revoke all on public.file_assets from anon;
grant select,insert,update,delete on public.file_assets to authenticated;

drop policy if exists studios_related_select on public.studios;
create policy studios_related_select on public.studios for select to authenticated using(
  public.is_studio_coach(id)
  or exists(select 1 from public.students s where s.studio_id=id and public.can_access_student(s.id))
);
drop policy if exists booking_services_related_select on public.booking_services;
create policy booking_services_related_select on public.booking_services for select to authenticated using(
  published or public.is_studio_coach(studio_id)
);
drop policy if exists package_definitions_related_select on public.package_definitions;
create policy package_definitions_related_select on public.package_definitions for select to authenticated using(
  public.is_studio_coach(studio_id) or (active and visibility='public')
);

drop policy if exists material_objects_read on storage.objects;
drop policy if exists material_objects_insert on storage.objects;
drop policy if exists material_objects_update on storage.objects;
drop policy if exists material_objects_delete on storage.objects;
create policy material_objects_read on storage.objects for select to authenticated using(
  bucket_id='studio-materials' and (
    public.is_studio_coach(((storage.foldername(name))[1])::uuid)
    or (array_length(storage.foldername(name),1)>=2 and public.can_access_student(((storage.foldername(name))[2])::uuid))
  )
);
create policy material_objects_insert on storage.objects for insert to authenticated with check(
  bucket_id='studio-materials' and array_length(storage.foldername(name),1)>=2 and (
    public.is_studio_coach(((storage.foldername(name))[1])::uuid)
    or public.can_access_student(((storage.foldername(name))[2])::uuid)
  )
);
create policy material_objects_update on storage.objects for update to authenticated using(
  bucket_id='studio-materials' and (
    public.is_studio_coach(((storage.foldername(name))[1])::uuid)
    or (array_length(storage.foldername(name),1)>=2 and public.can_access_student(((storage.foldername(name))[2])::uuid))
  )
) with check(bucket_id='studio-materials');
create policy material_objects_delete on storage.objects for delete to authenticated using(
  bucket_id='studio-materials' and public.is_studio_coach(((storage.foldername(name))[1])::uuid)
);

update public.studios set settings = settings || '{
  "branding":{"primaryColor":"#173F35","secondaryColor":"#C99A45","accentColor":"#E46F61","surfaceColor":"#F7F3EA"},
  "bookingCopy":{"eyebrow":"Coaching built around your work","headline":"Find the right room for your next breakthrough.","intro":"Private acting coaching with straightforward scheduling and policies."},
  "portalDefaults":{"compactView":false,"showProgress":true,"showActorPage":true}
}'::jsonb where slug='stage-story';
