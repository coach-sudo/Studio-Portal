drop policy if exists offerings_enrolled_select on public.service_offerings;
create policy offerings_enrolled_select on public.service_offerings
  for select to authenticated
  using (
    exists (
      select 1
      from public.lessons l
      where l.offering_id = service_offerings.id
        and public.can_access_lesson(l.id, l.student_id, l.studio_id)
    )
  );

create index if not exists assignments_lesson_id_idx
  on public.assignments(lesson_id) where lesson_id is not null;
create index if not exists material_links_lesson_id_idx
  on public.material_links(lesson_id) where lesson_id is not null;
create index if not exists actor_profiles_published_revision_id_idx
  on public.actor_profiles(published_revision_id)
  where published_revision_id is not null;
