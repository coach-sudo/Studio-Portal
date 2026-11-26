-- Recovery data is private to the author and only reachable through the checked RPC.
create table workspace_internal.lesson_note_recoveries (
  id uuid primary key default gen_random_uuid(),
  coach_id uuid not null references auth.users(id) on delete cascade,
  studio_id uuid not null references public.studios(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  note_id uuid references public.notes(id) on delete cascade,
  launch_lesson_id uuid references public.lessons(id) on delete cascade,
  lesson_id uuid references public.lessons(id) on delete cascade,
  working_note_id uuid not null,
  base_version integer not null check (base_version >= 0),
  version integer not null default 1 check (version > 0),
  last_write_id uuid not null,
  title text not null,
  body text not null,
  body_html text not null,
  updated_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '30 days'),
  unique nulls not distinct (coach_id, student_id, note_id, launch_lesson_id),
  check (note_id is null or (note_id=working_note_id and launch_lesson_id is null)),
  check (octet_length(title)+octet_length(body)+octet_length(body_html) <= 1048576)
);

create index lesson_note_recoveries_expiry on workspace_internal.lesson_note_recoveries (expires_at);
create index lesson_note_recoveries_note on workspace_internal.lesson_note_recoveries (note_id);
create index lesson_note_recoveries_student on workspace_internal.lesson_note_recoveries (student_id);
alter table workspace_internal.lesson_note_recoveries enable row level security;
revoke all on workspace_internal.lesson_note_recoveries from public, anon, authenticated;

create function workspace_internal.manage_lesson_note_recovery(
  p_action text,
  p_student_id uuid,
  p_note_id uuid,
  p_launch_lesson_id uuid,
  p_payload jsonb
) returns jsonb
language plpgsql security definer set search_path=''
as $$
declare
  v_actor uuid := auth.uid();
  v_studio uuid;
  v_note public.notes;
  v_row workspace_internal.lesson_note_recoveries;
  v_lesson uuid;
  v_working_id uuid;
  v_base integer;
  v_expected integer;
  v_write_id uuid;
  v_title text;
  v_body text;
  v_html text;
  v_committed boolean;
begin
  select s.studio_id into v_studio
  from public.students s
  where s.id=p_student_id and s.deleted_at is null;
  if v_actor is null or v_studio is null or not public.is_studio_coach(v_studio) then
    raise exception 'FORBIDDEN' using errcode='42501';
  end if;
  if p_action is null or p_action not in ('read','save','discard')
    or (p_note_id is not null and p_launch_lesson_id is not null) then
    raise exception 'Invalid recovery operation' using errcode='22023';
  end if;
  if p_note_id is not null then
    select n.* into v_note from public.notes n
    join public.lessons l on l.id=n.lesson_id and l.studio_id=v_studio
    where n.id=p_note_id and n.student_id=p_student_id;
    if not found then raise exception 'FORBIDDEN' using errcode='42501'; end if;
  end if;
  if p_launch_lesson_id is not null and not exists (
    select 1 from public.lessons l where l.id=p_launch_lesson_id and l.studio_id=v_studio and
      (l.student_id=p_student_id or exists (
        select 1 from public.lesson_participants lp where lp.lesson_id=l.id and lp.student_id=p_student_id
      ))
  ) then
    raise exception 'FORBIDDEN' using errcode='42501';
  end if;
  if p_action <> 'read' then
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
      concat_ws(':','lesson-note-recovery',v_actor,p_student_id,coalesce(p_note_id::text,'new'),
        coalesce(p_launch_lesson_id::text,'general')),0));
  end if;

  select r.* into v_row from workspace_internal.lesson_note_recoveries r
  where r.coach_id=v_actor and r.studio_id=v_studio and r.student_id=p_student_id
    and r.note_id is not distinct from p_note_id
    and r.launch_lesson_id is not distinct from p_launch_lesson_id;
  if v_row.expires_at <= now() then
    if p_action <> 'read' then
      delete from workspace_internal.lesson_note_recoveries where id=v_row.id;
    end if;
    v_row := null;
  end if;

  if p_action = 'discard' then
    if v_row.id is null then return null; end if;
    if v_row.version is distinct from (p_payload->>'expectedVersion')::integer
      or v_row.id is distinct from (p_payload->>'recoveryId')::uuid then
      raise exception 'VERSION_CONFLICT' using errcode='40001';
    end if;
    delete from workspace_internal.lesson_note_recoveries where id=v_row.id;
    return null;
  end if;

  if p_action = 'save' then
    v_working_id := (p_payload->>'workingNoteId')::uuid;
    v_expected := (p_payload->>'expectedVersion')::integer;
    v_base := (p_payload->>'baseVersion')::integer;
    v_write_id := (p_payload->>'writeId')::uuid;
    v_lesson := (p_payload->>'lessonId')::uuid;
    v_title := p_payload->>'title';
    v_body := p_payload->>'body';
    v_html := p_payload->>'bodyHtml';
    if v_working_id is null or v_expected is null or v_base is null or v_write_id is null
      or v_title is null or v_body is null or v_html is null
      or octet_length(v_title)+octet_length(v_body)+octet_length(v_html)>1048576 then
      raise exception 'Invalid recovery content' using errcode='22023';
    end if;

    if p_note_id is not null then
      if v_working_id<>v_note.id or v_lesson is distinct from v_note.lesson_id then
        raise exception 'FORBIDDEN' using errcode='42501';
      end if;
    elsif v_base <> 0 or (v_lesson is not null and not exists (
      select 1 from public.lessons l where l.id=v_lesson and l.studio_id=v_studio and
        (l.student_id=p_student_id or exists (
          select 1 from public.lesson_participants lp where lp.lesson_id=l.id and lp.student_id=p_student_id
        ))
    )) then
      raise exception 'FORBIDDEN' using errcode='42501';
    end if;

    if v_row.id is not null and v_row.last_write_id=v_write_id
      and v_row.working_note_id=v_working_id and v_row.base_version=v_base
      and v_row.lesson_id is not distinct from v_lesson and v_row.title=v_title
      and v_row.body=v_body and v_row.body_html=v_html then
      -- Return the committed receipt to a client that lost the response.
      null;
    elsif v_expected is distinct from coalesce(v_row.version,0)
      or (p_note_id is not null and v_base<>v_note.version)
      or (v_row.id is not null and (
        v_row.id is distinct from (p_payload->>'recoveryId')::uuid
        or v_row.working_note_id<>v_working_id or v_row.base_version<>v_base
      ))
      or (v_row.id is null and p_payload->>'recoveryId' is not null)
      or (p_note_id is null and exists (select 1 from public.notes n where n.id=v_working_id)) then
      raise exception 'VERSION_CONFLICT' using errcode='40001';
    elsif v_row.id is null then
      insert into workspace_internal.lesson_note_recoveries (
        coach_id, studio_id, student_id, note_id, launch_lesson_id, lesson_id,
        working_note_id, base_version, last_write_id, title, body, body_html
      ) values (
        v_actor,v_studio,p_student_id,p_note_id,p_launch_lesson_id,v_lesson,
        v_working_id,v_base,v_write_id,v_title,v_body,v_html
      ) returning * into v_row;
    elsif v_row.lesson_id is distinct from v_lesson or v_row.title<>v_title
      or v_row.body<>v_body or v_row.body_html<>v_html then
      update workspace_internal.lesson_note_recoveries set
        lesson_id=v_lesson, title=v_title, body=v_body, body_html=v_html, last_write_id=v_write_id,
        version=version+1, updated_at=now(), expires_at=now()+interval '30 days'
      where id=v_row.id returning * into v_row;
    end if;
  end if;

  if v_row.id is null then return null; end if;
  -- A confirmed private save or explicit publication already contains this copy.
  -- This also handles losing the explicit save response before the client discards it.
  select exists (
    select 1 from public.notes n where n.id=v_row.working_note_id and n.student_id=p_student_id
      and n.lesson_id=v_row.lesson_id and n.version=v_row.base_version+1
      and n.title=btrim(v_row.title) and n.body=btrim(v_row.body)
      and coalesce(n.body_html,n.body)=coalesce(nullif(v_row.body_html,''),btrim(v_row.body))
  ) into v_committed;
  return jsonb_build_object(
    'id',v_row.id,'workingNoteId',v_row.working_note_id,'baseVersion',v_row.base_version,
    'version',v_row.version,'lessonId',v_row.lesson_id,'title',v_row.title,
    'body',v_row.body,'bodyHtml',v_row.body_html,'committed',v_committed
  );
end;
$$;

revoke execute on function workspace_internal.manage_lesson_note_recovery(text,uuid,uuid,uuid,jsonb)
  from public, anon, authenticated;
grant execute on function workspace_internal.manage_lesson_note_recovery(text,uuid,uuid,uuid,jsonb)
  to authenticated;

create function public.manage_lesson_note_recovery(
  p_action text, p_student_id uuid, p_note_id uuid, p_launch_lesson_id uuid, p_payload jsonb
) returns jsonb language sql security invoker set search_path=''
as $$
  select workspace_internal.manage_lesson_note_recovery(
    p_action,p_student_id,p_note_id,p_launch_lesson_id,p_payload
  );
$$;
revoke execute on function public.manage_lesson_note_recovery(text,uuid,uuid,uuid,jsonb)
  from public, anon, authenticated;
grant execute on function public.manage_lesson_note_recovery(text,uuid,uuid,uuid,jsonb)
  to authenticated;

-- Run from an authorized database maintenance session. Recovery rows also
-- disappear when their author, student, studio, note, or lesson is deleted.
create function workspace_internal.prune_lesson_note_recoveries() returns bigint
language sql security invoker set search_path=''
as $$
  with removed as (
    delete from workspace_internal.lesson_note_recoveries where expires_at<=now()
    returning 1
  )
  select count(*) from removed;
$$;
revoke execute on function workspace_internal.prune_lesson_note_recoveries()
  from public, anon, authenticated;
