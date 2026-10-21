-- Studio-level branding has no owner_student_id. Authorize only the two current
-- shared image references, through the caller's existing studios SELECT policies.
-- Coach identity photos and unrelated objects retain their existing private ACLs.
-- Qualify the outer ID: the historical subqueries bound bare `id` to m.id/s.id,
-- so valid portal users received no studio settings and fell back to defaults.
alter policy studios_member_select on public.studios using (
  exists (select 1 from public.memberships m
    where m.studio_id = studios.id and m.user_id = (select auth.uid()))
);
alter policy studios_related_select on public.studios using (
  public.is_studio_coach(studios.id)
  or exists (select 1 from public.students s
    where s.studio_id = studios.id and public.can_access_student(s.id))
);

-- The same name shadowing hid existing coach-owned uploads after refresh.
-- Preserve the original ownership/visibility checks with explicit outer names.
alter policy material_objects_read on storage.objects using (
  bucket_id='studio-materials' and (
    exists (select 1 from public.studios s
      where s.id::text=split_part(objects.name,'/',1) and public.is_studio_coach(s.id))
    or (split_part(objects.name,'/',3)<>'private' and exists (
      select 1 from public.students s
      where s.id::text=split_part(objects.name,'/',2)
      and s.studio_id::text=split_part(objects.name,'/',1)
      and public.can_view_student_work(s.id)))
  )
);

-- Retire derived capabilities before repairing studio reads. Preserve every
-- durable object reference and external URL without an uploaded-file reference.
update public.studios set settings = jsonb_set(settings, '{branding}',
  (settings->'branding')
    - case when nullif(settings#>>'{branding,logoStoragePath}','') is not null then array['logoUrl'] else array[]::text[] end
    - case when nullif(settings#>>'{branding,coachProfilePhotoStoragePath}','') is not null then array['coachProfilePhotoUrl'] else array[]::text[] end)
where jsonb_typeof(settings->'branding')='object'
  and ((nullif(settings#>>'{branding,logoStoragePath}','') is not null and (settings->'branding')?'logoUrl')
    or (nullif(settings#>>'{branding,coachProfilePhotoStoragePath}','') is not null and (settings->'branding')?'coachProfilePhotoUrl'));

create policy material_objects_studio_branding_read on storage.objects
for select to authenticated using (
  bucket_id = 'studio-materials'
  and split_part(name, '/', 3) = 'public_actor'
  and exists (
    select 1 from public.studios s
    where s.id::text = split_part(objects.name, '/', 1)
    and (objects.name = s.settings #>> '{branding,logoStoragePath}'
      or objects.name = s.settings #>> '{dailyPopup,backgroundImageStoragePath}')
  )
);
