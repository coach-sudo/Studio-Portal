create or replace function public.merge_studio_students(
  keep_student_id uuid,
  remove_student_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  keep_row public.students%rowtype;
  remove_row public.students%rowtype;
  keep_profile public.actor_profiles%rowtype;
  remove_profile public.actor_profiles%rowtype;
begin
  if keep_student_id = remove_student_id then
    raise exception 'Students must be different.';
  end if;

  select * into keep_row from public.students where id = keep_student_id for update;
  select * into remove_row from public.students where id = remove_student_id for update;
  if keep_row.id is null or remove_row.id is null or keep_row.studio_id <> remove_row.studio_id then
    raise exception 'Students were not found in the same studio.';
  end if;
  if not public.is_studio_coach(keep_row.studio_id) then
    raise exception 'Not authorized.';
  end if;

  update public.students set
    user_id = coalesce(keep_row.user_id, remove_row.user_id),
    preferred_name = coalesce(keep_row.preferred_name, remove_row.preferred_name),
    pronouns = coalesce(keep_row.pronouns, remove_row.pronouns),
    email = coalesce(keep_row.email, remove_row.email),
    phone = coalesce(keep_row.phone, remove_row.phone),
    focus_area = coalesce(keep_row.focus_area, remove_row.focus_area),
    guardian_name = coalesce(keep_row.guardian_name, remove_row.guardian_name),
    guardian_email = coalesce(keep_row.guardian_email, remove_row.guardian_email),
    drive_folder_url = coalesce(keep_row.drive_folder_url, remove_row.drive_folder_url),
    actor_page_eligible = keep_row.actor_page_eligible or remove_row.actor_page_eligible,
    portal_enabled = keep_row.portal_enabled or remove_row.portal_enabled,
    tags = coalesce(keep_row.tags, '{}'::text[]) || coalesce(remove_row.tags, '{}'::text[]),
    version = keep_row.version + 1,
    updated_at = now()
  where id = keep_student_id;

  insert into public.student_relationships(student_id,user_id,relationship,can_view_finance,can_manage_profile)
  select keep_student_id,user_id,relationship,can_view_finance,can_manage_profile
  from public.student_relationships where student_id = remove_student_id
  on conflict(student_id,user_id) do update set
    can_view_finance = public.student_relationships.can_view_finance or excluded.can_view_finance,
    can_manage_profile = public.student_relationships.can_manage_profile or excluded.can_manage_profile;

  select * into keep_profile from public.actor_profiles where student_id = keep_student_id;
  select * into remove_profile from public.actor_profiles where student_id = remove_student_id;
  if keep_profile.id is not null and remove_profile.id is not null then
    update public.actor_profiles set
      bio = case when length(trim(keep_profile.bio)) > 0 then keep_profile.bio else remove_profile.bio end,
      draft_content = coalesce(remove_profile.draft_content, '{}'::jsonb) || coalesce(keep_profile.draft_content, '{}'::jsonb),
      version = keep_profile.version + 1,
      updated_at = now()
    where id = keep_profile.id;
    delete from public.actor_profiles where id = remove_profile.id;
  elsif remove_profile.id is not null then
    update public.actor_profiles set student_id = keep_student_id where id = remove_profile.id;
  end if;

  delete from public.student_pricing_rules r
  where r.student_id = remove_student_id
    and exists (
      select 1 from public.student_pricing_rules k
      where k.student_id = keep_student_id
        and k.active and r.active
        and k.ends_at is null and r.ends_at is null
        and k.service_id is not distinct from r.service_id
    );

  update public.lessons set student_id = keep_student_id where student_id = remove_student_id;
  update public.notes set student_id = keep_student_id where student_id = remove_student_id;
  update public.assignments set student_id = keep_student_id where student_id = remove_student_id;
  update public.materials set owner_student_id = keep_student_id where owner_student_id = remove_student_id;
  update public.material_links set student_id = keep_student_id where student_id = remove_student_id;
  update public.packages set student_id = keep_student_id where student_id = remove_student_id;
  update public.payment_entries set student_id = keep_student_id where student_id = remove_student_id;
  update public.reader_requests set student_id = keep_student_id where student_id = remove_student_id;
  update public.outbox_messages set student_id = keep_student_id where student_id = remove_student_id;
  update public.recommendations set student_id = keep_student_id where student_id = remove_student_id;
  update public.recurring_series set student_id = keep_student_id where student_id = remove_student_id;
  update public.bookings set student_id = keep_student_id where student_id = remove_student_id;
  update public.lesson_participants set student_id = keep_student_id where student_id = remove_student_id;
  update public.student_pricing_rules set student_id = keep_student_id where student_id = remove_student_id;
  update public.booking_admin_overrides set student_id = keep_student_id where student_id = remove_student_id;
  update public.integration_imports set student_id = keep_student_id where student_id = remove_student_id;

  delete from public.students where id = remove_student_id;
  return jsonb_build_object('keptStudentId', keep_student_id, 'removedStudentId', remove_student_id);
end;
$$;

revoke all on function public.merge_studio_students(uuid,uuid) from public,anon;
grant execute on function public.merge_studio_students(uuid,uuid) to authenticated;
