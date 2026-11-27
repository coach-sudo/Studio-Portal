-- The existing work command reads and returns the exact assignment and updates these fields after validating the student.
grant select on public.assignments to service_role;
grant update (status, version, updated_at, help_requested, responses, progress) on public.assignments to service_role;

-- Dedicated private bucket, using the existing studio upload limits and format allowlist.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
select 'assignment-attachments', 'assignment-attachments', false, file_size_limit, allowed_mime_types
from storage.buckets where id = 'studio-materials';

create table public.assignment_attachments (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references public.assignments(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  studio_id uuid not null references public.studios(id) on delete cascade,
  storage_path text not null unique,
  original_name text not null check (length(original_name) between 1 and 255),
  mime_type text not null,
  file_size_bytes bigint not null check (file_size_bytes between 1 and 52428800),
  created_at timestamptz not null default now(),
  submitted_at timestamptz,
  check (storage_path ~ ('^' || studio_id::text || '/' || student_id::text || '/' ||
    assignment_id::text || '/sha256-[a-f0-9]{64}$'))
);
create index assignment_attachments_assignment_idx on public.assignment_attachments (assignment_id, created_at);
create index assignment_attachments_student_idx on public.assignment_attachments (student_id);
create index assignment_attachments_studio_idx on public.assignment_attachments (studio_id);
alter table public.assignment_attachments enable row level security;
revoke all on public.assignment_attachments from public, anon, authenticated;
grant select on public.assignment_attachments to authenticated;

create function library_internal.can_read_assignment_attachment(
  p_assignment uuid, p_student uuid, p_studio uuid, p_submitted boolean
) returns boolean language sql stable security definer set search_path = '' as $$
  select (select auth.uid()) is not null and exists (
    select 1
    from public.assignments a join public.students s on s.id = a.student_id
    where a.id = p_assignment and s.id = p_student and s.studio_id = p_studio
      and s.deleted_at is null
      and (
        (s.user_id = (select auth.uid()) and s.portal_enabled)
        or (p_submitted and (
          public.is_studio_coach(s.studio_id)
          or exists (
            select 1 from public.student_relationships r
            where r.student_id = s.id and r.user_id = (select auth.uid()) and r.can_view_work
          )
        ))
      )
  );
$$;
revoke all on function library_internal.can_read_assignment_attachment(uuid, uuid, uuid, boolean) from public, anon;
grant execute on function library_internal.can_read_assignment_attachment(uuid, uuid, uuid, boolean) to authenticated;

create policy assignment_attachment_read on public.assignment_attachments for select to authenticated
using (library_internal.can_read_assignment_attachment(
  assignment_id, student_id, studio_id, submitted_at is not null
));

create policy assignment_attachment_object_read on storage.objects for select to authenticated
using (
  bucket_id = 'assignment-attachments'
  and exists (select 1 from public.assignment_attachments a where a.storage_path = objects.name)
);

create function library_internal.mark_assignment_attachments_submitted()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update public.assignment_attachments a
  set submitted_at = new.updated_at
  where a.assignment_id = new.id and a.student_id = new.student_id and a.submitted_at is null;
  return new;
end;
$$;
revoke all on function library_internal.mark_assignment_attachments_submitted() from public, anon, authenticated;
create trigger mark_assignment_attachments_submitted
after update of status on public.assignments for each row
when (old.status is distinct from new.status and new.status = 'completed')
execute function library_internal.mark_assignment_attachments_submitted();

create function library_internal.can_upload_assignment_attachment(p_path text)
returns boolean language sql stable security definer set search_path = '' as $$
  select (select auth.uid()) is not null
    and p_path ~ '^[a-f0-9-]{36}/[a-f0-9-]{36}/[a-f0-9-]{36}/sha256-[a-f0-9]{64}$'
    and exists (
      select 1 from public.students s join public.assignments a on a.student_id = s.id
      where s.user_id = (select auth.uid()) and s.portal_enabled and s.deleted_at is null
        and s.studio_id::text = split_part(p_path, '/', 1)
        and s.id::text = split_part(p_path, '/', 2)
        and a.id::text = split_part(p_path, '/', 3)
        and a.status in ('assigned', 'in_progress', 'reopened')
    );
$$;
revoke all on function library_internal.can_upload_assignment_attachment(text) from public, anon;
grant execute on function library_internal.can_upload_assignment_attachment(text) to authenticated;

create policy assignment_attachment_object_upload on storage.objects for insert to authenticated
with check (
  bucket_id = 'assignment-attachments'
  and owner_id = (select auth.uid())::text
  and library_internal.can_upload_assignment_attachment(name)
);

-- A locked assignment serializes attachment changes with submission and scope changes.
-- The object is immutable and can be reused after a lost attachment response.
create function public.attach_assignment_file(p_assignment uuid, p_hash text, p_name text)
returns public.assignment_attachments language plpgsql security definer set search_path = '' as $$
declare
  assignment public.assignments%rowtype;
  target_student public.students%rowtype;
  attachment public.assignment_attachments%rowtype;
  object_path text;
  object_metadata jsonb;
  object_size bigint;
begin
  if (select auth.uid()) is null then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  select a.* into assignment from public.assignments a
    join public.students s on s.id = a.student_id
    where a.id = p_assignment and s.user_id = (select auth.uid())
      and s.portal_enabled and s.deleted_at is null
    for update of a;
  if not found then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  select s.* into target_student from public.students s where s.id = assignment.student_id
    and s.user_id = (select auth.uid()) and s.portal_enabled and s.deleted_at is null
    for share;
  if not found then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  if p_hash is null or p_hash !~ '^[a-f0-9]{64}$' or coalesce(length(trim(p_name)), 0) not between 1 and 255 then
    raise exception 'INVALID_ATTACHMENT' using errcode = '22023';
  end if;
  object_path := target_student.studio_id::text || '/' || target_student.id::text || '/' ||
    assignment.id::text || '/sha256-' || p_hash;
  select a.* into attachment from public.assignment_attachments a where a.storage_path = object_path;
  if found then return attachment; end if;
  if assignment.status not in ('assigned', 'in_progress', 'reopened') then
    raise exception 'ASSIGNMENT_CLOSED' using errcode = '23514';
  end if;
  select o.metadata into object_metadata from storage.objects o
    where o.bucket_id = 'assignment-attachments' and o.name = object_path
      and o.owner_id = (select auth.uid())::text;
  if not found then raise exception 'UPLOAD_UNAVAILABLE' using errcode = '22023'; end if;
  if coalesce(object_metadata->>'size', '') !~ '^[0-9]{1,8}$' then
    raise exception 'INVALID_ATTACHMENT' using errcode = '22023';
  end if;
  object_size := (object_metadata->>'size')::bigint;
  if object_size not between 1 and 52428800 or not exists (
    select 1 from storage.buckets b where b.id = 'assignment-attachments'
      and (object_metadata->>'mimetype') = any(b.allowed_mime_types)
  ) then
    raise exception 'INVALID_ATTACHMENT' using errcode = '22023';
  end if;
  if (select count(*) from public.assignment_attachments a where a.assignment_id = p_assignment) >= 12 then
    raise exception 'ATTACHMENT_LIMIT' using errcode = '23514';
  end if;
  insert into public.assignment_attachments
    (assignment_id, student_id, studio_id, storage_path, original_name, mime_type, file_size_bytes)
  values
    (p_assignment, target_student.id, target_student.studio_id, object_path, trim(p_name),
      object_metadata->>'mimetype', object_size)
  returning * into attachment;
  return attachment;
end;
$$;
revoke all on function public.attach_assignment_file(uuid, text, text) from public, anon;
grant execute on function public.attach_assignment_file(uuid, text, text) to authenticated;

create function public.remove_assignment_file(p_assignment uuid, p_attachment uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  assignment public.assignments%rowtype;
begin
  if (select auth.uid()) is null then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  select a.* into assignment from public.assignments a
    join public.students s on s.id = a.student_id
    where a.id = p_assignment and s.user_id = (select auth.uid())
      and s.portal_enabled and s.deleted_at is null
    for update of a;
  if not found then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  if assignment.status not in ('assigned', 'in_progress', 'reopened') then
    raise exception 'ASSIGNMENT_CLOSED' using errcode = '23514';
  end if;
  if exists (
    select 1 from public.assignment_attachments a
    where a.assignment_id = p_assignment and a.id = p_attachment and a.submitted_at is not null
  ) then
    raise exception 'ATTACHMENT_SUBMITTED' using errcode = '23514';
  end if;
  delete from public.assignment_attachments a
    where a.assignment_id = p_assignment and a.id = p_attachment
      and a.student_id = assignment.student_id and a.submitted_at is null;
end;
$$;
revoke all on function public.remove_assignment_file(uuid, uuid) from public, anon;
grant execute on function public.remove_assignment_file(uuid, uuid) to authenticated;
