-- Keep the participant lookup behind the existing security-definer boundary.
-- Querying lesson_participants directly from the lessons policy recurses through
-- participants_access, which itself checks lessons.
create or replace function public.can_access_lesson(
  target_lesson uuid,
  target_student uuid,
  target_studio uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_studio_coach(target_studio)
    or (target_student is not null and public.can_view_student_schedule(target_student))
    or exists (
      select 1
      from public.lesson_participants p
      where p.lesson_id = target_lesson
        and p.student_id is not null
        and public.can_view_student_schedule(p.student_id)
    )
$$;

revoke all on function public.can_access_lesson(uuid, uuid, uuid)
  from public, anon;
grant execute on function public.can_access_lesson(uuid, uuid, uuid)
  to authenticated;

drop policy if exists lessons_access on public.lessons;
create policy lessons_access
  on public.lessons
  for select
  to authenticated
  using (public.can_access_lesson(id, student_id, studio_id));
