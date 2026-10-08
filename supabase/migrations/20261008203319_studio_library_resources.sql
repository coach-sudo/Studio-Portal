-- Extend the existing resource, relationship, and storage model. No files are moved or deleted.
create schema if not exists library_internal;
revoke all on schema library_internal from public, anon;
grant usage on schema library_internal to authenticated, service_role;

alter table public.materials
  add column in_library boolean not null default false,
  add column catalog_visibility text not null default 'assigned' check(catalog_visibility in ('assigned','studio')),
  add column source text not null default '',
  add column keywords text[] not null default '{}',
  add column text_content text not null default '',
  add column assignment_only boolean not null default false,
  add column file_asset_id uuid references public.file_assets(id) on delete restrict,
  add column search_document tsvector;

-- Permit text resources without weakening existing file/link references.
do $$ declare constraint_name text; begin
  for constraint_name in select conname from pg_constraint where conrelid='public.materials'::regclass and contype='c' and pg_get_constraintdef(oid) like '%storage_path%external_url%'
  loop execute format('alter table public.materials drop constraint %I',constraint_name); end loop;
end $$;
alter table public.materials add constraint material_resource_content check(storage_path is not null or external_url is not null or length(text_content)>0);

alter table public.material_links
  add column status public.material_status not null default 'active',
  add column pinned boolean not null default false,
  add column instructions text not null default '',
  add column assigned_by uuid references auth.users(id) on delete set null,
  add column note_id uuid references public.notes(id) on delete cascade,
  add column version integer not null default 1,
  add column updated_at timestamptz not null default now(),
  add column assignment_key text unique;
update public.material_links l set status=m.status,updated_at=m.updated_at from public.materials m where m.id=l.material_id;
-- Legacy owner-only rows were visible before relationships were mandatory for the paged view.
insert into public.material_links(material_id,student_id,role,visible_to_student,status,created_at,updated_at)
select m.id,m.owner_student_id,'library',true,m.status,m.created_at,m.updated_at from public.materials m
where m.owner_student_id is not null and not exists(select 1 from public.material_links l where l.material_id=m.id);
update public.materials m set file_asset_id=f.id from public.file_assets f where f.storage_path=m.storage_path and f.studio_id=m.studio_id;
create index material_links_student_status_idx on public.material_links(student_id,status,created_at desc,id);
create index material_links_note_idx on public.material_links(note_id) where note_id is not null;
create index materials_catalog_idx on public.materials(studio_id,in_library,status,title,id);
create index materials_search_idx on public.materials using gin(search_document);
create index materials_asset_idx on public.materials(file_asset_id) where file_asset_id is not null;

alter table public.file_assets add column content_sha256 text check(content_sha256 is null or content_sha256 ~ '^[0-9a-f]{64}$');
-- Private student objects and studio objects deliberately occupy different deduplication scopes.
create unique index file_assets_scoped_hash_idx on public.file_assets(studio_id,coalesce(owner_student_id,'00000000-0000-0000-0000-000000000000'::uuid),visibility,content_sha256) where content_sha256 is not null;

create table public.material_options (
  id uuid primary key default gen_random_uuid(), studio_id uuid not null references public.studios(id) on delete cascade,
  kind text not null check(kind in ('category','topic','level','medium','tag')),
  name text not null check(length(trim(name)) between 1 and 100),
  normalized_name text generated always as (regexp_replace(lower(trim(name)), '[[:space:][:punct:]]+', '', 'g')) stored,
  archived boolean not null default false, created_at timestamptz not null default now(),
  unique(studio_id,kind,normalized_name)
);
create table public.material_option_links (
  material_id uuid not null references public.materials(id) on delete cascade,
  option_id uuid not null references public.material_options(id) on delete restrict,
  primary key(material_id,option_id)
);
create index material_option_links_option_idx on public.material_option_links(option_id,material_id);
create table public.material_assignment_private (
  link_id uuid primary key references public.material_links(id) on delete cascade,
  coach_notes text not null default ''
);
insert into public.material_options(studio_id,kind,name)
select s.id,'level',n from public.studios s cross join unnest(array['Foundational','Beginner','Intermediate','Advanced','Professional']) n;
-- Preserve original category text while making existing classifications searchable.
insert into public.material_options(studio_id,kind,name)
select distinct studio_id,'category',left(trim(category),100) from public.materials where trim(category)<>''
on conflict(studio_id,kind,normalized_name) do nothing;
insert into public.material_option_links(material_id,option_id)
select m.id,o.id from public.materials m join public.material_options o on o.studio_id=m.studio_id and o.kind='category' and o.normalized_name=regexp_replace(lower(trim(left(m.category,100))),'[[:space:][:punct:]]+','','g');

-- Private helpers avoid a recursive materials -> links -> materials RLS policy.
create function library_internal.can_read_material(target uuid) returns boolean
language sql stable security definer set search_path='' as $$
select auth.uid() is not null and exists(select 1 from public.materials m where m.id=target and (
 public.is_studio_coach(m.studio_id)
 or (not m.in_library and not m.assignment_only and m.owner_student_id is not null and public.can_view_student_work(m.owner_student_id))
 or (m.in_library and m.catalog_visibility='studio' and m.status='active' and exists(select 1 from public.students s where s.studio_id=m.studio_id and public.can_view_student_work(s.id)))
 or exists(select 1 from public.material_links l where l.material_id=m.id and l.visible_to_student and public.can_view_student_work(coalesce(l.student_id,(select student_id from public.lessons where id=l.lesson_id))) and (l.note_id is null or exists(select 1 from public.notes n where n.id=l.note_id and n.status='published')))
));
$$;
create function library_internal.can_read_material_link(target uuid) returns boolean
language sql stable security definer set search_path='' as $$
select auth.uid() is not null and exists(select 1 from public.material_links l join public.materials m on m.id=l.material_id where l.id=target and (
 public.is_studio_coach(m.studio_id) or (l.visible_to_student and public.can_view_student_work(coalesce(l.student_id,(select student_id from public.lessons where id=l.lesson_id))) and (l.note_id is null or exists(select 1 from public.notes n where n.id=l.note_id and n.status='published')))
));
$$;
revoke all on function library_internal.can_read_material(uuid),library_internal.can_read_material_link(uuid) from public,anon;
grant execute on function library_internal.can_read_material(uuid),library_internal.can_read_material_link(uuid) to authenticated,service_role;

alter table public.material_options enable row level security;
alter table public.material_option_links enable row level security;
alter table public.material_assignment_private enable row level security;
create policy material_options_coach on public.material_options for all to authenticated using(public.is_studio_coach(studio_id)) with check(public.is_studio_coach(studio_id));
create policy material_options_student on public.material_options for select to authenticated using(exists(select 1 from public.material_option_links l where l.option_id=id and library_internal.can_read_material(l.material_id)));
create policy material_option_links_read on public.material_option_links for select to authenticated using(library_internal.can_read_material(material_id));
create policy material_option_links_coach on public.material_option_links for all to authenticated using(exists(select 1 from public.materials m where m.id=material_id and public.is_studio_coach(m.studio_id))) with check(exists(select 1 from public.materials m join public.material_options o on o.id=option_id and o.studio_id=m.studio_id where m.id=material_id and public.is_studio_coach(m.studio_id)));
create policy material_assignment_private_coach on public.material_assignment_private for all to authenticated using(exists(select 1 from public.material_links l join public.materials m on m.id=l.material_id where l.id=link_id and public.is_studio_coach(m.studio_id))) with check(exists(select 1 from public.material_links l join public.materials m on m.id=l.material_id where l.id=link_id and public.is_studio_coach(m.studio_id)));
revoke all on public.material_options,public.material_option_links,public.material_assignment_private from public,anon;
grant select,insert,update,delete on public.material_options,public.material_option_links,public.material_assignment_private to authenticated,service_role;
drop policy materials_access on public.materials;
create policy materials_access on public.materials for select to authenticated using(library_internal.can_read_material(id));
drop policy material_links_access on public.material_links;
create policy material_links_access on public.material_links for select to authenticated using(library_internal.can_read_material_link(id));

create function library_internal.can_read_material_path(target_path text) returns boolean
language sql stable security definer set search_path='' as $$
select auth.uid() is not null and exists(select 1 from public.materials m where m.storage_path=target_path and split_part(target_path,'/',1)=m.studio_id::text and library_internal.can_read_material(m.id));
$$;
revoke all on function library_internal.can_read_material_path(text) from public,anon;
grant execute on function library_internal.can_read_material_path(text) to authenticated,service_role;
-- Add a reference-based path for reused studio objects; retain original ownership paths.
create policy material_objects_assigned_read on storage.objects for select to authenticated using(bucket_id='studio-materials' and library_internal.can_read_material_path(name));
drop policy if exists material_objects_read on storage.objects;
create policy material_objects_read on storage.objects for select to authenticated using(bucket_id='studio-materials' and (
 exists(select 1 from public.studios s where s.id::text=split_part(name,'/',1) and public.is_studio_coach(s.id))
 or (split_part(name,'/',3)<>'private' and exists(select 1 from public.students s where s.id::text=split_part(name,'/',2) and s.studio_id::text=split_part(name,'/',1) and public.can_view_student_work(s.id)))
));
drop policy if exists file_assets_access on public.file_assets;
create policy file_assets_access on public.file_assets for select to authenticated using(public.is_studio_coach(studio_id) or (owner_student_id is not null and public.can_view_student_work(owner_student_id) and (visibility<>'private' or uploaded_by=(select auth.uid()) or library_internal.can_read_material_path(storage_path))));

drop policy if exists file_assets_insert on public.file_assets;
create policy file_assets_insert on public.file_assets for insert to authenticated with check(
 uploaded_by=(select auth.uid()) and bucket_id='studio-materials'
 and split_part(storage_path,'/',1)=studio_id::text
 and split_part(storage_path,'/',2)=coalesce(owner_student_id,studio_id)::text
 and (content_sha256 is null or split_part(storage_path,'/',3)=visibility)
 and (public.is_studio_coach(studio_id) or (owner_student_id is not null and public.can_manage_student_profile(owner_student_id) and exists(select 1 from public.students s where s.id=owner_student_id and s.studio_id=file_assets.studio_id)))
);

-- Canonical objects are immutable while referenced. Assignment removal never deletes a file.
create function library_internal.material_path_referenced(target_path text) returns boolean
language sql stable security definer set search_path='' as $$
select auth.uid() is not null and exists(select 1 from public.materials where storage_path=target_path);
$$;
revoke all on function library_internal.material_path_referenced(text) from public,anon;
grant execute on function library_internal.material_path_referenced(text) to authenticated,service_role;
drop policy if exists material_objects_update on storage.objects;
create policy material_objects_update on storage.objects for update to authenticated
using(bucket_id='studio-materials' and not library_internal.material_path_referenced(name) and (
 exists(select 1 from public.studios s where s.id::text=split_part(name,'/',1) and public.is_studio_coach(s.id))
 or exists(select 1 from public.students s where s.id::text=split_part(name,'/',2) and s.studio_id::text=split_part(name,'/',1) and public.can_manage_student_profile(s.id))
)) with check(false);
drop policy if exists material_objects_delete on storage.objects;
create policy material_objects_delete on storage.objects for delete to authenticated
using(bucket_id='studio-materials' and not library_internal.material_path_referenced(name) and (
 exists(select 1 from public.studios s where s.id::text=split_part(name,'/',1) and public.is_studio_coach(s.id))
 or exists(select 1 from public.students s where s.id::text=split_part(name,'/',2) and s.studio_id::text=split_part(name,'/',1) and public.can_manage_student_profile(s.id))
));
drop policy if exists material_links_coach_write on public.material_links;
create policy material_links_coach_write on public.material_links for all to authenticated
using(exists(select 1 from public.materials m where m.id=material_id and public.is_studio_coach(m.studio_id)))
with check(exists(select 1 from public.materials m where m.id=material_id and public.is_studio_coach(m.studio_id)
 and (student_id is null or exists(select 1 from public.students s where s.id=material_links.student_id and s.studio_id=m.studio_id))
 and (lesson_id is null or exists(select 1 from public.lessons l where l.id=material_links.lesson_id and l.studio_id=m.studio_id))
 and (note_id is null or exists(select 1 from public.notes n where n.id=material_links.note_id and n.student_id=material_links.student_id and n.lesson_id is not distinct from material_links.lesson_id))));

create function library_internal.refresh_material_search() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if new.file_asset_id is null and new.storage_path is not null then select f.id into new.file_asset_id from public.file_assets f where f.storage_path=new.storage_path and f.studio_id=new.studio_id; end if;
 new.search_document := to_tsvector('simple'::regconfig,coalesce(new.title,'')||' '||coalesce(new.caption,'')||' '||coalesce(new.category,'')||' '||array_to_string(new.keywords,' ')||' '||coalesce((select string_agg(o.name,' ') from public.material_option_links l join public.material_options o on o.id=l.option_id where l.material_id=new.id),''));
 return new;
end $$;
create trigger material_search_refresh before insert or update on public.materials for each row execute function library_internal.refresh_material_search();
create function library_internal.refresh_material_option_search() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if tg_table_name='material_options' then
  update public.materials set updated_at=updated_at where id in (select material_id from public.material_option_links where option_id=new.id);
 elsif tg_op='DELETE' then
  update public.materials set updated_at=updated_at where id=old.material_id;
 else
  update public.materials set updated_at=updated_at where id=new.material_id;
 end if;
 return null;
end $$;
create trigger material_option_search_refresh after insert or delete or update on public.material_option_links for each row execute function library_internal.refresh_material_option_search();
create trigger material_option_name_search_refresh after update of name on public.material_options for each row execute function library_internal.refresh_material_option_search();
revoke all on function library_internal.refresh_material_search(),library_internal.refresh_material_option_search() from public,anon,authenticated;
update public.materials set updated_at=updated_at;

-- Bounded, RLS-backed projection: no full text body, coach notes, or file bytes.
create function public.search_material_resources(p_studio_id uuid,p_student_id uuid default null,p_catalog boolean default true,p_search text default '',p_filters jsonb default '{}',p_status text default 'active',p_pinned boolean default false,p_sort text default 'title',p_page integer default 1,p_limit integer default 25,p_lesson_id uuid default null)
returns jsonb language sql stable security invoker set search_path='' as $$
with matches as (
 select m.id,m.title,m.caption as description,m.source,m.in_library as "inLibrary",m.catalog_visibility as visibility,m.owner_student_id as "ownerStudentId",m.media_kind as "mediaKind",m.mime_type as "mimeType",m.version,m.created_at as "createdAt",m.status as "resourceStatus",
 l.id as "assignmentId",l.status::text as status,l.pinned,(length(l.instructions)>0) as "hasInstructions",l.lesson_id as "lessonId",l.note_id as "noteId",l.version as "assignmentVersion",l.created_at as "assignedAt",
 coalesce((select jsonb_agg(jsonb_build_object('id',o.id,'kind',o.kind,'name',o.name,'archived',o.archived) order by o.kind,o.name,o.id) from public.material_option_links ml join public.material_options o on o.id=ml.option_id where ml.material_id=m.id),'[]') as options
 from public.materials m
 left join public.material_links l on not p_catalog and l.material_id=m.id and coalesce(l.student_id,(select student_id from public.lessons where id=l.lesson_id))=p_student_id
 where m.studio_id=p_studio_id
 and ((p_catalog and m.in_library and (public.is_studio_coach(m.studio_id) or m.catalog_visibility='studio')) or (not p_catalog and l.id is not null and l.role<>'actor_material'))
 and (p_lesson_id is null or l.lesson_id=p_lesson_id)
 and (p_status='all' or case when p_catalog then m.status::text else l.status::text end=p_status)
 and (not p_pinned or coalesce(l.pinned,false))
 and (not (p_filters ? 'visibility') or jsonb_array_length(p_filters->'visibility')=0 or m.catalog_visibility in(select jsonb_array_elements_text(p_filters->'visibility')))
 and (length(trim(p_search))=0 or (m.search_document @@ websearch_to_tsquery('simple'::regconfig,left(p_search,200)) or m.search_document @@ to_tsquery('simple'::regconfig,array_to_string(array(select quote_literal(lexeme)||':*' from unnest(tsvector_to_array(to_tsvector('simple'::regconfig,left(p_search,200)))) lexeme),' & '))))
 and not exists(select 1 from jsonb_each(p_filters) f where f.key<>'visibility' and jsonb_typeof(f.value)='array' and jsonb_array_length(f.value)>0 and not exists(select 1 from public.material_option_links ml join public.material_options o on o.id=ml.option_id where ml.material_id=m.id and o.kind=f.key and o.id::text in(select jsonb_array_elements_text(f.value))))
), ordered as (
 select *,row_number() over(order by case when p_sort='date' then coalesce("assignedAt","createdAt") end desc,case when p_sort='pinned' then pinned end desc nulls last,lower(title),id,"assignmentId") as ordinal from matches
), paged as (select * from ordered order by ordinal limit greatest(1,least(coalesce(p_limit,25),50)) offset (greatest(coalesce(p_page,1),1)-1)*greatest(1,least(coalesce(p_limit,25),50)))
select jsonb_build_object('items',coalesce((select jsonb_agg(to_jsonb(paged)-'ordinal' order by ordinal) from paged),'[]'),'total',(select count(*) from matches),'page',greatest(coalesce(p_page,1),1),'pageSize',greatest(1,least(coalesce(p_limit,25),50)));
$$;
revoke all on function public.search_material_resources(uuid,uuid,boolean,text,jsonb,text,boolean,text,integer,integer,uuid) from public,anon;
grant execute on function public.search_material_resources(uuid,uuid,boolean,text,jsonb,text,boolean,text,integer,integer,uuid) to authenticated;

create function public.get_material_resource(p_id uuid) returns jsonb language sql stable security invoker set search_path='' as $$
select jsonb_build_object('id',id,'title',title,'description',caption,'text',text_content,'storagePath',storage_path,'externalUrl',external_url,'keywords',keywords,'source',source,'version',version) from public.materials where id=p_id;
$$;
revoke all on function public.get_material_resource(uuid) from public,anon;
grant execute on function public.get_material_resource(uuid) to authenticated;

create function public.get_material_assignment(p_id uuid) returns jsonb language sql stable security invoker set search_path='' as $$
select jsonb_build_object('id',l.id,'instructions',l.instructions,'coachNotes',p.coach_notes,'version',l.version)
from public.material_links l left join public.material_assignment_private p on p.link_id=l.id where l.id=p_id;
$$;
revoke all on function public.get_material_assignment(uuid) from public,anon;
grant execute on function public.get_material_assignment(uuid) to authenticated;

-- Bounded metadata suggestions. Student results derive only from authorized resources.
create function public.search_material_options(p_studio_id uuid,p_kind text,p_search text default '',p_page integer default 1,p_include_archived boolean default false)
returns jsonb language sql stable security invoker set search_path='' as $$
with rows as(select o.id,o.kind,o.name,o.archived,(select count(*) from public.material_option_links l where l.option_id=o.id) as uses from public.material_options o where o.studio_id=p_studio_id and o.kind=p_kind and (p_include_archived or not o.archived) and o.name ilike '%'||left(p_search,100)||'%' order by lower(o.name),o.id limit 26 offset (greatest(p_page,1)-1)*25)
select jsonb_build_object('items',coalesce((select jsonb_agg(to_jsonb(r)) from (select * from rows limit 25) r),'[]'),'hasMore',(select count(*)>25 from rows));
$$;
revoke all on function public.search_material_options(uuid,text,text,integer,boolean) from public,anon;
grant execute on function public.search_material_options(uuid,text,text,integer,boolean) to authenticated;

create table public.material_collections (
 id uuid primary key default gen_random_uuid(),studio_id uuid not null references public.studios(id) on delete cascade,
 title text not null check(length(trim(title)) between 1 and 200),description text not null default '',
 archived boolean not null default false,version integer not null default 1,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 search_document tsvector generated always as(to_tsvector('simple'::regconfig,title||' '||description)) stored
);
create index material_collections_search_idx on public.material_collections using gin(search_document);
create index material_collections_catalog_idx on public.material_collections(studio_id,archived,title,id);
create table public.material_collection_members (
 collection_id uuid not null references public.material_collections(id) on delete cascade,
 material_id uuid not null references public.materials(id) on delete restrict,
 primary key(collection_id,material_id)
);
create table public.material_collection_assignments (
 id uuid primary key default gen_random_uuid(),studio_id uuid not null references public.studios(id) on delete cascade,
 collection_id uuid not null references public.material_collections(id) on delete restrict,
 student_id uuid not null references public.students(id) on delete cascade,collection_version integer not null,
 resource_ids uuid[] not null,assigned_by uuid not null references auth.users(id),created_at timestamptz not null default now(),
 constraint material_collection_assignment_version_unique unique(collection_id,student_id,collection_version)
);
alter table public.material_collections enable row level security;
alter table public.material_collection_members enable row level security;
alter table public.material_collection_assignments enable row level security;
create policy material_collection_assignments_read on public.material_collection_assignments for select to authenticated using(public.is_studio_coach(studio_id) or public.can_view_student_work(student_id));
create policy material_collections_coach on public.material_collections for all to authenticated using(public.is_studio_coach(studio_id)) with check(public.is_studio_coach(studio_id));
create policy material_collections_assigned on public.material_collections for select to authenticated using(exists(select 1 from public.material_collection_assignments a where a.collection_id=id and public.can_view_student_work(a.student_id)));
create policy material_collection_members_read on public.material_collection_members for select to authenticated using(exists(select 1 from public.material_collections c where c.id=collection_id and public.is_studio_coach(c.studio_id)) or exists(select 1 from public.material_collection_assignments a where a.collection_id=material_collection_members.collection_id and material_id=any(a.resource_ids) and public.can_view_student_work(a.student_id)));
revoke all on public.material_collections,public.material_collection_members,public.material_collection_assignments from public,anon;
grant select on public.material_collections,public.material_collection_members,public.material_collection_assignments to authenticated;
grant all on public.material_collections,public.material_collection_members,public.material_collection_assignments to service_role;

create function public.search_material_collections(p_studio_id uuid,p_search text default '',p_page integer default 1,p_include_archived boolean default false)
returns jsonb language sql stable security invoker set search_path='' as $$
with matches as(select c.id,c.title,c.description,c.archived,c.version,(select count(*) from public.material_collection_members m where m.collection_id=c.id) as "resourceCount" from public.material_collections c where c.studio_id=p_studio_id and (p_include_archived or not c.archived) and (length(trim(p_search))=0 or c.search_document @@ websearch_to_tsquery('simple'::regconfig,left(p_search,200)))), paged as(select * from matches order by lower(title),id limit 25 offset (greatest(p_page,1)-1)*25)
select jsonb_build_object('items',coalesce((select jsonb_agg(to_jsonb(paged) order by lower(title),id) from paged),'[]'),'total',(select count(*) from matches),'page',greatest(p_page,1),'pageSize',25);
$$;
create function public.get_material_collection(p_id uuid) returns jsonb language sql stable security invoker set search_path='' as $$
select jsonb_build_object('id',c.id,'title',c.title,'description',c.description,'version',c.version,'resources',coalesce((select jsonb_agg(jsonb_build_object('id',m.id,'title',m.title) order by lower(m.title),m.id) from public.material_collection_members cm join public.materials m on m.id=cm.material_id where cm.collection_id=c.id),'[]')) from public.material_collections c where c.id=p_id;
$$;
revoke all on function public.search_material_collections(uuid,text,integer,boolean),public.get_material_collection(uuid) from public,anon;
grant execute on function public.search_material_collections(uuid,text,integer,boolean),public.get_material_collection(uuid) to authenticated;

-- Mutations execute transactionally in a non-exposed schema with explicit identity checks.
create function library_internal.manage_material_resources(p_command text,p_payload jsonb,p_expected_version integer default 0)
returns jsonb language plpgsql security definer set search_path='' as $$
#variable_conflict use_variable
declare
 studio uuid := nullif(p_payload->>'studioId','')::uuid;
 resource_id uuid := nullif(p_payload->>'id','')::uuid;
 owner_id uuid := nullif(p_payload->>'studentId','')::uuid;
 asset_id uuid := nullif(p_payload->>'fileAssetId','')::uuid;
 lesson_id uuid := nullif(p_payload->>'lessonId','')::uuid;
 note_id uuid := nullif(p_payload->>'noteId','')::uuid;
 option_id uuid;
 target_id uuid;
 student_id uuid;
 material public.materials;
 collection_row public.material_collections;
 link public.material_links;
 option_row public.material_options;
 asset public.file_assets;
 coach boolean;
 library boolean := coalesce((p_payload->>'inLibrary')::boolean,false);
 ids uuid[];
 students uuid[];
 options uuid[];
 results jsonb := '[]';
 created_id uuid;
 key text;
begin
 if auth.uid() is null then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if p_command in ('resource_update','resource_archive','resource_assign','resource_remove') then
  select * into material from public.materials where id=resource_id for update;
  if not found then raise exception 'FORBIDDEN' using errcode='42501'; end if;
  studio := material.studio_id;
 elsif p_command in ('assignment_update','assignment_remove') then
  select * into link from public.material_links where id=resource_id for update;
  if not found then raise exception 'FORBIDDEN' using errcode='42501'; end if;
  select * into material from public.materials where id=link.material_id;
  studio := material.studio_id;
 end if;
 coach := public.is_studio_coach(studio);
 if not coach and p_command not in ('resource_create','resource_assign','assignment_update','assignment_remove') then raise exception 'FORBIDDEN' using errcode='42501'; end if;

 if p_command in ('resource_create','resource_update') then
  if p_command='resource_update' and material.version<>p_expected_version then raise exception 'VERSION_CONFLICT'; end if;
  if p_command='resource_update' then owner_id:=material.owner_student_id; library:=coalesce((p_payload->>'inLibrary')::boolean,material.in_library); end if;
  if owner_id is not null and not exists(select 1 from public.students s where s.id=owner_id and s.studio_id=studio and s.deleted_at is null and public.can_manage_student_profile(s.id)) then raise exception 'FORBIDDEN' using errcode='42501'; end if;
  if not coach and (library or owner_id is null) then raise exception 'FORBIDDEN' using errcode='42501'; end if;
  if owner_id is null and not library then raise exception 'A private resource needs a student'; end if;
  if p_command='resource_create' and note_id is not null and p_payload->>'visibility'='studio' then raise exception 'New note attachments must start with access by assignment'; end if;
  if length(trim(coalesce(p_payload->>'title','')))<1 or length(p_payload->>'title')>200 then raise exception 'A resource title is required'; end if;
  if length(coalesce(p_payload->>'description',''))>10000 or length(coalesce(p_payload->>'text',''))>100000 or length(coalesce(p_payload->>'instructions',''))>10000 or length(coalesce(p_payload->>'coachNotes',''))>10000 then raise exception 'Resource content is too long'; end if;
  if length(coalesce(p_payload->>'source',''))>200 or length(coalesce(p_payload->>'externalUrl',''))>2048 or jsonb_array_length(coalesce(p_payload->'keywords','[]'))>50 or exists(select 1 from jsonb_array_elements_text(coalesce(p_payload->'keywords','[]')) k where length(k)>100) then raise exception 'Resource metadata is too long'; end if;
  if nullif(p_payload->>'externalUrl','') is not null and (p_payload->>'externalUrl') !~* '^https?://' then raise exception 'Use an HTTP or HTTPS link'; end if;
  if asset_id is not null then
   select * into asset from public.file_assets where id=asset_id and studio_id=studio;
   if not found or (not coach and asset.owner_student_id is distinct from owner_id) or (library and asset.owner_student_id is not null) or (not library and asset.owner_student_id is distinct from owner_id) then raise exception 'FORBIDDEN' using errcode='42501'; end if;
  end if;
  select coalesce(array_agg(value::uuid),'{}') into options from jsonb_array_elements_text(coalesce(p_payload->'optionIds','[]'));
  if cardinality(options)>100 or exists(select 1 from unnest(options) i where not exists(select 1 from public.material_options o where o.id=i and o.studio_id=studio and (not o.archived or exists(select 1 from public.material_option_links ml where ml.material_id=resource_id and ml.option_id=o.id)))) then raise exception 'Invalid resource classifications'; end if;
  if p_command='resource_create' then
   insert into public.materials(studio_id,owner_student_id,title,caption,source,keywords,text_content,assignment_only,file_asset_id,storage_path,mime_type,file_size_bytes,external_url,media_kind,in_library,catalog_visibility)
   values(studio,case when library then null else owner_id end,trim(p_payload->>'title'),coalesce(p_payload->>'description',''),coalesce(p_payload->>'source',''),array(select jsonb_array_elements_text(coalesce(p_payload->'keywords','[]'))),coalesce(p_payload->>'text',''),note_id is not null,asset_id,asset.storage_path,asset.mime_type,asset.file_size_bytes,nullif(p_payload->>'externalUrl',''),case when asset_id is not null then case when asset.mime_type like 'image/%' then 'image' when asset.mime_type like 'video/%' then 'video' when asset.mime_type like 'audio/%' then 'audio' else 'document' end when nullif(p_payload->>'externalUrl','') is not null then 'link' else 'document' end,library,case when coach and p_payload->>'visibility'='studio' then 'studio' else 'assigned' end) returning id into resource_id;
  else
   update public.materials set title=trim(p_payload->>'title'),caption=coalesce(p_payload->>'description',''),source=coalesce(p_payload->>'source',''),keywords=array(select jsonb_array_elements_text(coalesce(p_payload->'keywords','[]'))),text_content=coalesce(p_payload->>'text',material.text_content),in_library=library,catalog_visibility=case when p_payload->>'visibility'='studio' then 'studio' else 'assigned' end,version=version+1,updated_at=now() where id=resource_id;
  end if;
  delete from public.material_option_links where material_id=resource_id and not(option_id=any(options));
  insert into public.material_option_links(material_id,option_id) select resource_id,i from unnest(options) i on conflict do nothing;
  if p_command='resource_create' and owner_id is not null then
   -- Creation and assignment are atomic, including lesson/note scope checks below.
   results:=library_internal.manage_material_resources('resource_assign',jsonb_build_object('id',resource_id,'studentIds',jsonb_build_array(owner_id),'lessonId',lesson_id,'noteId',note_id,'instructions',coalesce(p_payload->>'instructions',''),'coachNotes',case when coach then coalesce(p_payload->>'coachNotes','') else '' end,'creatingPrivate',true),0);
  end if;
 elsif p_command='resource_assign' then
  if material.status<>'active' then raise exception 'Activate the resource before assigning'; end if;
  -- A student may assign only the private resource created in this transaction.
  if not coach and not(library_internal.can_read_material(material.id) and ((material.owner_student_id is not null and not material.in_library and public.can_manage_student_profile(material.owner_student_id)) or (material.in_library and material.catalog_visibility='studio' and material.status='active'))) then raise exception 'FORBIDDEN' using errcode='42501'; end if;
  select coalesce(array_agg(distinct value::uuid),'{}') into students from jsonb_array_elements_text(coalesce(p_payload->'studentIds','[]'));
  if cardinality(students)<1 or cardinality(students)>100 then raise exception 'Choose between 1 and 100 students'; end if;
  if not material.in_library and exists(select 1 from unnest(students) s where s is distinct from material.owner_student_id) then raise exception 'Promote this private resource to the Library before sharing'; end if;
  if length(coalesce(p_payload->>'instructions',''))>10000 or length(coalesce(p_payload->>'coachNotes',''))>10000 then raise exception 'Instructions are too long'; end if;
  foreach student_id in array students loop
   if not exists(select 1 from public.students s where s.id=student_id and s.studio_id=studio and s.deleted_at is null and public.can_manage_student_profile(s.id)) then raise exception 'FORBIDDEN' using errcode='42501'; end if;
   if lesson_id is not null and not exists(select 1 from public.lessons l where l.id=lesson_id and l.studio_id=studio and (l.student_id=student_id or exists(select 1 from public.lesson_participants lp where lp.lesson_id=l.id and lp.student_id=student_id))) then raise exception 'Invalid related lesson'; end if;
   if note_id is not null and not exists(select 1 from public.notes n where n.id=note_id and n.student_id=student_id and n.lesson_id is not distinct from lesson_id) then raise exception 'Invalid related note'; end if;
   key:=resource_id::text||':'||student_id::text||':'||coalesce(lesson_id::text,'')||':'||coalesce(note_id::text,'');
   select l.id into created_id from public.material_links l where l.material_id=resource_id and l.student_id=student_id and l.lesson_id is not distinct from lesson_id and l.note_id is not distinct from note_id limit 1;
   -- assignment_key also makes concurrent new assignment requests idempotent.
   if created_id is null then
    insert into public.material_links(material_id,student_id,lesson_id,note_id,role,visible_to_student,assigned_by,instructions,assignment_key)
    values(resource_id,student_id,lesson_id,note_id,case when lesson_id is null then 'library' else 'lesson_material' end,true,auth.uid(),coalesce(p_payload->>'instructions',''),key)
    on conflict(assignment_key) do update set assignment_key=excluded.assignment_key returning id into created_id;
   end if;
   if coach then insert into public.material_assignment_private(link_id,coach_notes) values(created_id,coalesce(p_payload->>'coachNotes','')) on conflict(link_id) do nothing; end if;
   results:=results||jsonb_build_array(created_id);
   created_id:=null;
  end loop;
 elsif p_command in ('assignment_update','assignment_remove') then
  if not coach and not(public.can_manage_student_profile(link.student_id) and library_internal.can_read_material_link(link.id)) then raise exception 'FORBIDDEN' using errcode='42501'; end if;
  if link.version<>p_expected_version then raise exception 'VERSION_CONFLICT'; end if;
  if p_command='assignment_remove' then delete from public.material_links where id=link.id;
  else
   if coalesce(p_payload->>'status',link.status::text) not in ('active','vaulted','archived') then raise exception 'Invalid assignment status'; end if;
   update public.material_links set status=coalesce(p_payload->>'status',link.status::text)::public.material_status,pinned=coalesce((p_payload->>'pinned')::boolean,link.pinned),instructions=case when coach then coalesce(p_payload->>'instructions',link.instructions) else link.instructions end,version=version+1,updated_at=now() where id=link.id;
   if coach and p_payload ? 'coachNotes' then insert into public.material_assignment_private(link_id,coach_notes) values(link.id,p_payload->>'coachNotes') on conflict(link_id) do update set coach_notes=excluded.coach_notes; end if;
  end if;
 elsif p_command='resource_archive' then
  if material.version<>p_expected_version then raise exception 'VERSION_CONFLICT'; end if;
  update public.materials set status=case when material.status='active' then 'archived'::public.material_status else 'active'::public.material_status end,version=version+1,updated_at=now() where id=material.id;
 elsif p_command='resource_remove' then
  if exists(select 1 from public.material_links where material_id=resource_id) then raise exception 'Remove assignments before deleting a resource'; end if;
  if material.version<>p_expected_version then raise exception 'VERSION_CONFLICT'; end if;
  -- Files remain retained for inspected cleanup; never cascade into shared objects.
  delete from public.materials where id=resource_id;
 elsif p_command in ('collection_create','collection_update','collection_archive','collection_assign') then
  if p_command<>'collection_create' then
   select * into collection_row from public.material_collections where id=resource_id and studio_id=studio for update;
   if not found then raise exception 'FORBIDDEN' using errcode='42501'; end if;
  end if;
  if p_command in ('collection_create','collection_update') then
   if length(trim(coalesce(p_payload->>'title','')))<1 or length(p_payload->>'title')>200 or length(coalesce(p_payload->>'description',''))>10000 then raise exception 'A collection title and concise description are required'; end if;
   select coalesce(array_agg(distinct value::uuid),'{}') into ids from jsonb_array_elements_text(coalesce(p_payload->'resourceIds','[]'));
   if cardinality(ids)>100 or exists(select 1 from unnest(ids) i where not exists(select 1 from public.materials m where m.id=i and m.studio_id=studio and m.in_library)) then raise exception 'Choose up to 100 Library resources'; end if;
   if p_command='collection_create' then
    insert into public.material_collections(studio_id,title,description) values(studio,trim(p_payload->>'title'),coalesce(p_payload->>'description','')) returning id into resource_id;
   else
    if collection_row.version<>p_expected_version then raise exception 'VERSION_CONFLICT'; end if;
    update public.material_collections set title=trim(p_payload->>'title'),description=coalesce(p_payload->>'description',''),version=version+1,updated_at=now() where id=resource_id;
   end if;
   delete from public.material_collection_members where collection_id=resource_id and not(material_id=any(ids));
   insert into public.material_collection_members(collection_id,material_id) select resource_id,i from unnest(ids) i on conflict do nothing;
  elsif p_command='collection_archive' then
   if collection_row.version<>p_expected_version then raise exception 'VERSION_CONFLICT'; end if;
   update public.material_collections set archived=not collection_row.archived,version=version+1,updated_at=now() where id=resource_id;
  elsif p_command='collection_assign' then
   if collection_row.archived or collection_row.version<>p_expected_version then raise exception 'The collection changed. Review it before assigning'; end if;
   select coalesce(array_agg(material_id),'{}') into ids from public.material_collection_members where collection_id=resource_id;
   select coalesce(array_agg(distinct value::uuid),'{}') into students from jsonb_array_elements_text(coalesce(p_payload->'studentIds','[]'));
   if cardinality(ids)<1 or cardinality(students)<1 or cardinality(students)>100 or cardinality(ids)*cardinality(students)>1000 then raise exception 'Choose resources and students; use batches of up to 1000 assignments'; end if;
   foreach target_id in array ids loop
    if not exists(select 1 from public.materials where id=target_id and status='active') then raise exception 'Activate archived resources before assigning the collection'; end if;
    perform library_internal.manage_material_resources('resource_assign',jsonb_build_object('id',target_id,'studentIds',p_payload->'studentIds','instructions',coalesce(p_payload->>'instructions',''),'coachNotes',coalesce(p_payload->>'coachNotes','')),0);
   end loop;
   foreach student_id in array students loop
    insert into public.material_collection_assignments(studio_id,collection_id,student_id,collection_version,resource_ids,assigned_by) values(studio,resource_id,student_id,collection_row.version,ids,auth.uid()) on conflict on constraint material_collection_assignment_version_unique do nothing;
   end loop;
  end if;
 elsif p_command like 'option_%' then
  if p_command='option_create' then
   insert into public.material_options(studio_id,kind,name) values(studio,p_payload->>'kind',trim(p_payload->>'name')) on conflict(studio_id,kind,normalized_name) do update set archived=false returning id into resource_id;
  else
   select * into option_row from public.material_options where id=resource_id and studio_id=studio for update;
   if not found then raise exception 'FORBIDDEN' using errcode='42501'; end if;
   if p_command='option_rename' then update public.material_options set name=trim(p_payload->>'name') where id=resource_id;
   elsif p_command='option_archive' then update public.material_options set archived=coalesce((p_payload->>'archived')::boolean,true) where id=resource_id;
   elsif p_command='option_merge' then
    target_id:=(p_payload->>'targetId')::uuid;
    if target_id=resource_id or not exists(select 1 from public.material_options where id=target_id and studio_id=studio and kind=option_row.kind and not archived) then raise exception 'Choose another active option of the same kind'; end if;
    insert into public.material_option_links(material_id,option_id) select material_id,target_id from public.material_option_links where option_id=resource_id on conflict do nothing;
    delete from public.material_option_links where option_id=resource_id;
    update public.material_options set archived=true where id=resource_id;
   else raise exception 'Unknown metadata action'; end if;
  end if;
 else raise exception 'Unknown resource action';
 end if;
 insert into public.audit_events(studio_id,actor_id,entity_type,entity_id,action,reason,correlation_id,source,before_state,after_state)
 values(studio,auth.uid(),'material',resource_id,p_command,'Library resource operation',gen_random_uuid()::text,'portal',null,jsonb_build_object('actor',auth.uid()));
 return jsonb_build_object('id',resource_id,'assignments',results);
end $$;
revoke all on function library_internal.manage_material_resources(text,jsonb,integer) from public,anon;
grant execute on function library_internal.manage_material_resources(text,jsonb,integer) to authenticated;
create function public.manage_material_resources(p_command text,p_payload jsonb,p_expected_version integer default 0) returns jsonb
language sql security invoker set search_path='' as $$select library_internal.manage_material_resources(p_command,p_payload,p_expected_version)$$;
revoke all on function public.manage_material_resources(text,jsonb,integer) from public,anon;
grant execute on function public.manage_material_resources(text,jsonb,integer) to authenticated;
create or replace view public.material_library_rows
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
  on lesson.id = link.lesson_id
where not m.in_library;

revoke all on table public.material_library_rows from public, anon;
grant select on table public.material_library_rows to authenticated;


