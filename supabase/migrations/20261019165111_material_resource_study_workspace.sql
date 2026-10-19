-- Additive resource workspace. Canonical files and assignments stay in place.
alter table public.materials add column learner_instructions text not null default ''
  check (length(learner_instructions) <= 10000);

create function library_internal.material_content_identity(target uuid) returns text
language sql stable security definer set search_path='' as $$
  select encode(sha256(convert_to(jsonb_build_array(m.file_asset_id,m.storage_path,
    m.external_url,m.text_content,f.content_sha256)::text,'UTF8')),'hex')
  from public.materials m left join public.file_assets f on f.id=m.file_asset_id
  where m.id=target and library_internal.can_read_material(m.id);
$$;
create function library_internal.owns_study_student(target uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select auth.uid() is not null and exists(select 1 from public.students s
    where s.id=target and s.user_id=auth.uid() and s.portal_enabled and s.deleted_at is null);
$$;
revoke all on function library_internal.material_content_identity(uuid),library_internal.owns_study_student(uuid) from public,anon,service_role;
grant execute on function library_internal.material_content_identity(uuid),library_internal.owns_study_student(uuid) to authenticated;

create function library_internal.can_study_resource(student uuid, material uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select library_internal.owns_study_student(student) and library_internal.can_read_material(material)
 and exists(select 1 from public.students s join public.materials m on m.studio_id=s.studio_id where s.id=student and m.id=material);
$$;
revoke all on function library_internal.can_study_resource(uuid,uuid) from public,anon,service_role;
grant execute on function library_internal.can_study_resource(uuid,uuid) to authenticated;

create or replace function public.get_material_resource(p_id uuid) returns jsonb
language sql stable security invoker set search_path='' as $$
  select jsonb_build_object('id',m.id,'title',m.title,'description',m.caption,
    'text',m.text_content,'storagePath',m.storage_path,'externalUrl',m.external_url,
    'keywords',m.keywords,'source',m.source,'version',m.version,
    'mimeType',m.mime_type,'mediaKind',m.media_kind,'sharedInstructions',m.learner_instructions,
    'contentIdentity',library_internal.material_content_identity(m.id),'options',coalesce((select jsonb_agg(jsonb_build_object('id',o.id,'kind',o.kind,'name',o.name,'archived',o.archived)) from public.material_option_links ml join public.material_options o on o.id=ml.option_id where ml.material_id=m.id),'[]'::jsonb))
  from public.materials m where m.id=p_id;
$$;
create or replace function public.get_material_assignment(p_id uuid) returns jsonb
language sql stable security invoker set search_path='' as $$
  select jsonb_build_object('id',l.id,'resourceId',l.material_id,'studentId',coalesce(l.student_id,s.student_id),
    'lessonId',l.lesson_id,'noteId',l.note_id,'instructions',l.instructions,'coachNotes',p.coach_notes,'version',l.version)
  from public.material_links l left join public.lessons s on s.id=l.lesson_id
  left join public.material_assignment_private p on p.link_id=l.id where l.id=p_id;
$$;

-- An exact assignment URL is checked before returning even the resource title.
create function public.material_resource_workspace(p_id uuid,p_student uuid default null,p_assignment uuid default null)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare detail jsonb; assignment jsonb;
begin
  if p_student is not null and not exists(select 1 from public.students s join public.materials m on m.studio_id=s.studio_id
    where m.id=p_id and s.id=p_student and public.can_view_student_work(s.id)) then return null; end if;
  if p_assignment is not null then
    assignment:=public.get_material_assignment(p_assignment);
    if assignment is null or assignment->>'resourceId'<>p_id::text
      or (p_student is not null and assignment->>'studentId' is distinct from p_student::text) then return null; end if;
  end if;
  detail:=public.get_material_resource(p_id);
  if detail is null then return null; end if;
  return jsonb_build_object('resource',detail,'assignment',assignment);
end;
$$;
revoke all on function public.material_resource_workspace(uuid,uuid,uuid) from public,anon,service_role;
grant execute on function public.material_resource_workspace(uuid,uuid,uuid) to authenticated;

create table public.material_study_state (
  user_id uuid not null references auth.users(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete restrict,
  material_id uuid not null references public.materials(id) on delete restrict,
  content_identity text not null check(content_identity ~ '^[a-f0-9]{64}$'),
  anchor jsonb not null default '{}',
  version integer not null default 1 check(version>0),
  updated_at timestamptz not null default now(),
  primary key(user_id,student_id,material_id,content_identity)
);
create table public.material_study_annotations (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete restrict,
  material_id uuid not null references public.materials(id) on delete restrict,
  content_identity text not null check(content_identity ~ '^[a-f0-9]{64}$'),
  kind text not null check(kind in ('bookmark','note')),
  anchor jsonb not null default '{}',
  body text not null default '' check(length(body)<=10000),
  version integer not null default 1 check(version>0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index material_study_annotations_owner_idx on public.material_study_annotations(user_id,student_id,material_id,content_identity,updated_at desc,id);

create function library_internal.valid_study_anchor(value jsonb) returns boolean
language sql immutable set search_path='' as $$
  select jsonb_typeof(value)='object' and length(value::text)<=200
    and not exists(select 1 from jsonb_each(value) e where e.key not in ('page','paragraph','seconds')
      or jsonb_typeof(e.value)<>'number' or (e.value::text)::numeric<0 or (e.value::text)::numeric>10000000
      or (e.key in ('page','paragraph') and ((e.value::text)::numeric<1 or (e.value::text)::numeric<>trunc((e.value::text)::numeric))));
$$;
alter table public.material_study_state add check(library_internal.valid_study_anchor(anchor));
alter table public.material_study_annotations add check(library_internal.valid_study_anchor(anchor));
alter table public.material_study_state enable row level security;
alter table public.material_study_annotations enable row level security;
create policy study_state_read on public.material_study_state for select to authenticated
  using(user_id=(select auth.uid()) and library_internal.can_study_resource(student_id,material_id));
create policy study_state_insert on public.material_study_state for insert to authenticated
  with check(user_id=(select auth.uid()) and library_internal.can_study_resource(student_id,material_id)
    and content_identity=library_internal.material_content_identity(material_id));
create policy study_state_update on public.material_study_state for update to authenticated
  using(user_id=(select auth.uid()) and library_internal.can_study_resource(student_id,material_id))
  with check(user_id=(select auth.uid()) and library_internal.can_study_resource(student_id,material_id)
    and content_identity=library_internal.material_content_identity(material_id));
create policy study_annotations_read on public.material_study_annotations for select to authenticated
  using(user_id=(select auth.uid()) and library_internal.can_study_resource(student_id,material_id));
create policy study_annotations_insert on public.material_study_annotations for insert to authenticated
  with check(user_id=(select auth.uid()) and library_internal.can_study_resource(student_id,material_id)
    and content_identity=library_internal.material_content_identity(material_id));
create policy study_annotations_update on public.material_study_annotations for update to authenticated
  using(user_id=(select auth.uid()) and library_internal.can_study_resource(student_id,material_id))
  with check(user_id=(select auth.uid()) and library_internal.can_study_resource(student_id,material_id)
    and content_identity=library_internal.material_content_identity(material_id));
create policy study_annotations_delete on public.material_study_annotations for delete to authenticated
  using(user_id=(select auth.uid()) and library_internal.can_study_resource(student_id,material_id));
revoke all on public.material_study_state,public.material_study_annotations from public,anon,service_role;
grant select,insert,update on public.material_study_state to authenticated;
grant select,insert,update,delete on public.material_study_annotations to authenticated;

-- Version checks prevent stale tabs overwriting notes. Stable annotation IDs make
-- a repeated identical request a read, rather than another annotation/version.
create function public.save_material_study(p_material uuid,p_student uuid,p_content text,p_kind text,
  p_id uuid,p_anchor jsonb,p_body text,p_version integer default 0)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare result jsonb;
begin
  if not library_internal.can_study_resource(p_student,p_material) or p_content is distinct from library_internal.material_content_identity(p_material)
    then raise exception 'Resource unavailable' using errcode='42501'; end if;
  if p_kind='position' then
    select to_jsonb(s) into result from public.material_study_state s where user_id=auth.uid() and student_id=p_student
      and material_id=p_material and content_identity=p_content and anchor=p_anchor;
    if result is not null then return result; end if;
    insert into public.material_study_state as s(user_id,student_id,material_id,content_identity,anchor)
      values(auth.uid(),p_student,p_material,p_content,p_anchor)
      on conflict(user_id,student_id,material_id,content_identity) do update
      set anchor=excluded.anchor,version=s.version+1,updated_at=now() where s.version=p_version returning to_jsonb(s.*) into result;
  elsif p_kind in ('bookmark','note') and p_id is not null then
    perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||p_material::text,0));
    select to_jsonb(a) into result from public.material_study_annotations a where id=p_id and user_id=auth.uid()
      and student_id=p_student and material_id=p_material and content_identity=p_content and kind=p_kind and anchor=p_anchor and body=p_body;
    if result is not null then return result; end if;
    if p_version>0 and not exists(select 1 from public.material_study_annotations where id=p_id and user_id=auth.uid()) then raise exception 'VERSION_CONFLICT'; end if;
    if p_version=0 and (select count(*) from public.material_study_annotations where user_id=auth.uid() and student_id=p_student
      and material_id=p_material and content_identity=p_content)>=200 then raise exception 'Annotation limit reached'; end if;
    insert into public.material_study_annotations as a(id,user_id,student_id,material_id,content_identity,kind,anchor,body)
      values(p_id,auth.uid(),p_student,p_material,p_content,p_kind,p_anchor,p_body)
      on conflict(id) do update set anchor=excluded.anchor,body=excluded.body,version=a.version+1,updated_at=now()
      where a.version=p_version and a.user_id=auth.uid() and a.student_id=p_student and a.material_id=p_material
        and a.content_identity=p_content and a.kind=p_kind returning to_jsonb(a.*) into result;
  else raise exception 'Invalid study operation'; end if;
  if result is null then raise exception 'VERSION_CONFLICT'; end if;
  return result;
end;
$$;
revoke all on function public.save_material_study(uuid,uuid,text,text,uuid,jsonb,text,integer) from public,anon,service_role;
grant execute on function public.save_material_study(uuid,uuid,text,text,uuid,jsonb,text,integer) to authenticated;

-- Extend the existing merge transaction without exposing or transferring note
-- ownership. A different surviving login never inherits the old user's notes.
alter function public.merge_studio_students(uuid,uuid) set schema library_internal;
alter function library_internal.merge_studio_students(uuid,uuid) rename to merge_students_without_study;
revoke all on function library_internal.merge_students_without_study(uuid,uuid) from public,anon,authenticated,service_role;
create function public.merge_studio_students(keep_student_id uuid,remove_student_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
  if keep_student_id=remove_student_id or not exists(select 1 from public.students k join public.students r on r.studio_id=k.studio_id
    where k.id=keep_student_id and r.id=remove_student_id and public.is_studio_coach(k.studio_id)) then raise exception 'Not authorized.' using errcode='42501'; end if;
  perform 1 from public.students where id in (keep_student_id,remove_student_id) order by id for update;
  update public.material_study_annotations set student_id=keep_student_id where student_id=remove_student_id;
  insert into public.material_study_state as s(user_id,student_id,material_id,content_identity,anchor,version,updated_at)
    select user_id,keep_student_id,material_id,content_identity,anchor,version,updated_at from public.material_study_state where student_id=remove_student_id
    on conflict(user_id,student_id,material_id,content_identity) do update
    set anchor=case when excluded.updated_at>s.updated_at then excluded.anchor else s.anchor end,
      version=greatest(s.version,excluded.version)+1,updated_at=greatest(s.updated_at,excluded.updated_at);
  delete from public.material_study_state where student_id=remove_student_id;
  return library_internal.merge_students_without_study(keep_student_id,remove_student_id);
end;
$$;
revoke all on function public.merge_studio_students(uuid,uuid) from public,anon,service_role;
grant execute on function public.merge_studio_students(uuid,uuid) to authenticated;

-- Keep existing atomic resource commands; add only the shared instructions field.
create or replace function public.manage_material_resources(p_command text,p_payload jsonb,p_expected_version integer default 0)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
  if p_payload ? 'sharedInstructions' and (not public.is_studio_coach((p_payload->>'studioId')::uuid)
    or length(p_payload->>'sharedInstructions')>10000) then raise exception 'FORBIDDEN' using errcode='42501'; end if;
  result:=library_internal.manage_material_resources(p_command,p_payload,p_expected_version);
  if p_command in ('resource_create','resource_update') and p_payload ? 'sharedInstructions' then
    update public.materials set learner_instructions=coalesce(p_payload->>'sharedInstructions','') where id=(result->>'id')::uuid;
  end if;
  return result;
end;
$$;
revoke all on function public.manage_material_resources(text,jsonb,integer) from public,anon;
grant execute on function public.manage_material_resources(text,jsonb,integer) to authenticated;

-- Collection filtering extends the existing bounded RLS-backed search.
create or replace function public.search_material_resources(p_studio_id uuid,p_student_id uuid default null,p_catalog boolean default true,p_search text default '',p_filters jsonb default '{}',p_status text default 'active',p_pinned boolean default false,p_sort text default 'title',p_page integer default 1,p_limit integer default 25,p_lesson_id uuid default null)
returns jsonb language sql stable security invoker set search_path='' as $$
with matches as (
 select m.id,m.title,m.caption as description,m.source,m.in_library as "inLibrary",m.catalog_visibility as visibility,m.owner_student_id as "ownerStudentId",m.media_kind as "mediaKind",m.mime_type as "mimeType",m.version,m.created_at as "createdAt",m.status as "resourceStatus",
 l.id as "assignmentId",l.status::text as status,l.pinned,(length(l.instructions)>0) as "hasInstructions",l.lesson_id as "lessonId",l.note_id as "noteId",l.version as "assignmentVersion",l.created_at as "assignedAt",
 coalesce((select jsonb_agg(jsonb_build_object('id',o.id,'kind',o.kind,'name',o.name,'archived',o.archived) order by o.kind,o.name,o.id) from public.material_option_links ml join public.material_options o on o.id=ml.option_id where ml.material_id=m.id),'[]') as options
 from public.materials m
 left join public.material_links l on not p_catalog and l.material_id=m.id and coalesce(l.student_id,(select student_id from public.lessons where id=l.lesson_id))=p_student_id
 where m.studio_id=p_studio_id
 and ((p_catalog and m.in_library and (public.is_studio_coach(m.studio_id) or m.catalog_visibility='studio')) or (not p_catalog and l.id is not null and l.role<>'actor_material'))
 and (not (p_filters ? 'excluded_roles') or not (coalesce(l.role::text,'')=any(array(select jsonb_array_elements_text(p_filters->'excluded_roles')))))
 and (not (p_filters ? 'collection') or jsonb_array_length(p_filters->'collection')=0 or exists(select 1 from public.material_collection_members cm where cm.material_id=m.id and cm.collection_id::text in (select jsonb_array_elements_text(p_filters->'collection'))))
 and (p_lesson_id is null or l.lesson_id=p_lesson_id)
 and (p_status='all' or case when p_catalog then m.status::text else l.status::text end=p_status)
 and (not p_pinned or coalesce(l.pinned,false))
 and (not (p_filters ? 'visibility') or jsonb_array_length(p_filters->'visibility')=0 or m.catalog_visibility in(select jsonb_array_elements_text(p_filters->'visibility')))
 and (length(trim(p_search))=0 or (m.search_document @@ websearch_to_tsquery('simple'::regconfig,left(p_search,200)) or m.search_document @@ to_tsquery('simple'::regconfig,array_to_string(array(select quote_literal(lexeme)||':*' from unnest(tsvector_to_array(to_tsvector('simple'::regconfig,left(p_search,200)))) lexeme),' & '))))
 and not exists(select 1 from jsonb_each(p_filters) f where f.key not in ('visibility','collection','excluded_roles') and jsonb_typeof(f.value)='array' and jsonb_array_length(f.value)>0 and not exists(select 1 from public.material_option_links ml join public.material_options o on o.id=ml.option_id where ml.material_id=m.id and o.kind=f.key and o.id::text in(select jsonb_array_elements_text(f.value))))
), ordered as (
 select *,row_number() over(order by case when p_sort='date' then coalesce("assignedAt","createdAt") end desc,case when p_sort='pinned' then pinned end desc nulls last,lower(title),id,"assignmentId") as ordinal from matches
), paged as (select * from ordered order by ordinal limit greatest(1,least(coalesce(p_limit,25),50)) offset (greatest(coalesce(p_page,1),1)-1)*greatest(1,least(coalesce(p_limit,25),50)))
select jsonb_build_object('items',coalesce((select jsonb_agg(to_jsonb(paged)-'ordinal' order by ordinal) from paged),'[]'),'total',(select count(*) from matches),'page',greatest(coalesce(p_page,1),1),'pageSize',greatest(1,least(coalesce(p_limit,25),50)));
$$;
