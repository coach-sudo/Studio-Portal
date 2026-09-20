create view public.material_library_rows
with (security_invoker = true)
as
select
  m.id,
  m.studio_id,
  m.owner_student_id,
  m.title,
  m.category,
  m.status,
  m.approval_status,
  m.storage_path,
  m.external_url,
  m.caption,
  m.mime_type,
  m.file_size_bytes,
  m.media_kind,
  m.public_embed,
  m.sort_order,
  m.version,
  m.created_at,
  m.updated_at,
  link.id as link_id,
  link.lesson_id,
  link.role as link_role,
  link.student_id as link_student_id,
  link.visible_to_student,
  student.full_name as student_name,
  lesson.topic as lesson_topic
from public.materials m
left join lateral (
  select ml.*
  from public.material_links ml
  where ml.material_id = m.id
  order by ml.created_at, ml.id
  limit 1
) link on true
left join public.students student
  on student.id = coalesce(link.student_id, m.owner_student_id)
left join public.lessons lesson
  on lesson.id = link.lesson_id;

revoke all on table public.material_library_rows from public, anon;
grant select on table public.material_library_rows to authenticated;
