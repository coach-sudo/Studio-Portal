-- Accept commonly shared lesson files while retaining the existing private bucket and size limit.
update storage.buckets
set allowed_mime_types = array(
  select distinct mime from unnest(coalesce(allowed_mime_types, array[]::text[]) || array[
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/vnd.oasis.opendocument.text',
    'application/vnd.apple.pages',
    'application/rtf', 'application/octet-stream', 'application/zip',
    'text/csv', 'text/markdown', 'image/gif', 'image/heic', 'image/avif',
    'audio/wav', 'audio/ogg', 'audio/webm', 'video/webm', 'video/ogg', 'video/quicktime'
  ]) as mime order by mime
)
where id = 'studio-materials';

create or replace function library_internal.replace_current_script(p_payload jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  student_id uuid := (p_payload->>'studentId')::uuid;
  lesson_id uuid := (p_payload->>'lessonId')::uuid;
  script_id uuid := coalesce((p_payload->>'requestId')::uuid, gen_random_uuid());
  script_title text := trim(coalesce(p_payload->>'title', ''));
  script_url text := nullif(trim(p_payload->>'externalUrl'), '');
  student public.students%rowtype;
  asset public.file_assets%rowtype;
  revised public.materials%rowtype;
begin
  select * into student from public.students s where s.id = student_id and s.deleted_at is null;
  if not found or not public.can_manage_student_profile(student_id) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if lesson_id is not null and not exists (
    select 1 from public.lessons l where l.id = lesson_id and l.studio_id = student.studio_id
      and (l.student_id = student.id or exists (
        select 1 from public.lesson_participants lp where lp.lesson_id = l.id and lp.student_id = student.id and lp.status <> 'cancelled'
      ))
  ) then
    raise exception 'Choose a lesson for this student';
  end if;
  if p_payload->>'storagePath' is not null then
    select * into asset from public.file_assets a where a.storage_path = p_payload->>'storagePath'
      and a.studio_id = student.studio_id and a.owner_student_id = student.id
      and a.bucket_id = 'studio-materials' and a.visibility = 'student';
    if not found then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  end if;
  if length(script_title) not between 1 and 200 or (asset.id is null and script_url is null)
    or (script_url is not null and (length(script_url) > 2048 or script_url !~* '^https?://')) then
    raise exception 'Enter a script title and upload a file or share an HTTP or HTTPS link';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('current-script:' || student.id::text, 0));
  select m.* into revised from public.materials m
    join public.material_links ml on ml.material_id = m.id
    where m.id = script_id and m.owner_student_id = student.id
      and ml.student_id = student.id and ml.role = 'current_script';
  if found then
    if revised.title is distinct from script_title or revised.storage_path is distinct from asset.storage_path
      or revised.external_url is distinct from script_url then
      raise exception 'This script change has already been saved. Reopen the editor to start another version.';
    end if;
    return to_jsonb(revised);
  end if;

  with replaced as (
    update public.material_links ml set status = 'archived', updated_at = now(), version = ml.version + 1
      where ml.student_id = student.id and ml.role = 'current_script' and ml.status = 'active'
      returning ml.id, ml.material_id
  )
  update public.materials m set status = 'archived', updated_at = now(), version = m.version + 1
    where m.owner_student_id = student.id and not m.in_library and m.status = 'active'
      and m.id in (select r.material_id from replaced r)
      and not exists (
        select 1 from public.material_links other where other.material_id = m.id and other.status = 'active'
          and other.id not in (select r.id from replaced r)
      );

  insert into public.materials(
    id, studio_id, owner_student_id, title, category, file_asset_id, storage_path,
    external_url, mime_type, file_size_bytes, media_kind, caption
  ) values (
    script_id, student.studio_id, student.id, script_title, coalesce(nullif(p_payload->>'category', ''), 'Script'),
    asset.id, asset.storage_path, script_url, asset.mime_type, asset.file_size_bytes,
    case when asset.id is null then 'link' when asset.mime_type like 'image/%' then 'image'
         when asset.mime_type like 'audio/%' then 'audio' when asset.mime_type like 'video/%' then 'video' else 'document' end,
    coalesce(p_payload->>'caption', '')
  ) returning * into revised;
  insert into public.material_links(material_id, student_id, lesson_id, role, visible_to_student, assigned_by)
  values (revised.id, student.id, lesson_id, 'current_script', true, auth.uid());
  return to_jsonb(revised);
end;
$$;
revoke all on function library_internal.replace_current_script(jsonb) from public, anon, authenticated;

create or replace function library_internal.attach_work_file(p_payload jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $$
<<upload_scope>>
declare
  studio_id uuid := (p_payload->>'studioId')::uuid;
  student_id uuid := (p_payload->>'studentId')::uuid;
  lesson_id uuid := (p_payload->>'lessonId')::uuid;
  note_id uuid := (p_payload->>'noteId')::uuid;
  asset_id uuid := (p_payload->>'fileAssetId')::uuid;
  attachment_title text := trim(coalesce(p_payload->>'title', ''));
  existing uuid;
begin
  if asset_id is null or not public.can_manage_student_profile(student_id) or not exists (
    select 1 from public.file_assets a where a.id = asset_id and a.studio_id = upload_scope.studio_id
      and a.owner_student_id = upload_scope.student_id and a.bucket_id = 'studio-materials'
      and a.visibility = case when note_id is null then 'student' else 'private' end
  ) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(concat_ws(':', 'work-file', student_id, asset_id, lesson_id, note_id), 0));
  select m.id into existing
    from public.materials m join public.material_links ml on ml.material_id = m.id
    where m.file_asset_id = asset_id and m.owner_student_id = upload_scope.student_id and m.title = attachment_title
      and m.status = 'active' and ml.status = 'active' and ml.student_id = upload_scope.student_id
      and ml.role in ('library', 'lesson_material')
      and ml.lesson_id is not distinct from upload_scope.lesson_id
      and ml.note_id is not distinct from upload_scope.note_id
    order by m.created_at, m.id limit 1;
  if found then return jsonb_build_object('id', existing); end if;
  return library_internal.manage_material_resources(
    'resource_create', jsonb_build_object(
      'studioId', studio_id, 'studentId', student_id, 'lessonId', lesson_id, 'noteId', note_id,
      'title', attachment_title, 'fileAssetId', asset_id, 'inLibrary', false, 'visibility', 'assigned'
    ), 0
  );
end;
$$;
revoke all on function library_internal.attach_work_file(jsonb) from public, anon, authenticated;

-- Extend the existing authenticated, authorization-checked resource command entry point.
create or replace function public.manage_material_resources(p_command text,p_payload jsonb,p_expected_version integer default 0)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
  if auth.uid() is null then raise exception 'FORBIDDEN' using errcode='42501'; end if;
  if p_command = 'replace_current_script' then
    return library_internal.replace_current_script(p_payload);
  end if;
  if p_command = 'resource_attach_file' then
    return library_internal.attach_work_file(p_payload);
  end if;
  if p_payload ? 'sharedInstructions' and (not public.is_studio_coach((p_payload->>'studioId')::uuid)
    or length(p_payload->>'sharedInstructions')>10000) then raise exception 'FORBIDDEN' using errcode='42501'; end if;
  result:=library_internal.manage_material_resources(p_command,p_payload,p_expected_version);
  if p_command in ('resource_create','resource_update') and p_payload ? 'sharedInstructions' then
    update public.materials set learner_instructions=coalesce(p_payload->>'sharedInstructions','') where id=(result->>'id')::uuid;
  end if;
  return result;
end;
$$;

-- New online checkouts charge the full balance under the existing invoice lock.
create or replace function public.claim_studio_invoice_checkout(p_invoice uuid,p_amount bigint,p_key text,p_version integer) returns jsonb
language plpgsql security definer set search_path='' as $$
declare inv public.studio_invoices;
begin
  select * into inv from public.studio_invoices where id=p_invoice;
  perform 1 from public.students where id=inv.student_id for update;
  select * into inv from public.studio_invoices where id=p_invoice for update;
  if inv.checkout_key=p_key then return to_jsonb(inv); end if;
  if inv.version<>p_version then raise exception 'VERSION_CONFLICT'; end if;
  if inv.checkout_key is not null then raise exception 'INVALID_TRANSITION: An online payment is already pending.'; end if;
  if inv.status not in ('open','partially_paid') or p_amount<=0
    or p_amount is distinct from inv.total_minor-inv.paid_minor-inv.credit_minor-inv.waived_minor then
    raise exception 'VALIDATION_FAILED: Online payment requires the full outstanding balance.';
  end if;
  update public.studio_invoices set checkout_key=p_key,checkout_amount=p_amount,version=version+1,updated_at=now() where id=inv.id returning * into inv;
  update public.lessons l set invoice_payment_pending=true where exists(select 1 from jsonb_array_elements(inv.items) x where x->'lessonIds' @> to_jsonb(array[l.id::text]));
  return to_jsonb(inv);
end $$;
