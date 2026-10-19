-- Wave 2: bounded invoker reads. No new write authority or hosted application.
create schema if not exists workspace_internal;
revoke all on schema workspace_internal from public, anon;
grant usage on schema workspace_internal to authenticated;

create function workspace_internal.records(p_student uuid default null)
returns table(kind text,id uuid,student_id uuid,lesson_id uuid,assignment_id uuid,title text,snippet text)
language sql stable security invoker set search_path='' as $$
  select 'student',s.id,s.id,null::uuid,null::uuid,left(s.full_name,240),''
  from public.students s where (select auth.uid()) is not null
    and public.is_studio_coach(s.studio_id) and s.deleted_at is null
    and (p_student is null or s.id=p_student)
  union all
  select 'lesson',l.id,coalesce(p_student,l.student_id),l.id,null::uuid,left(l.topic,240),''
  from public.lessons l where (select auth.uid()) is not null
    and (p_student is null or l.student_id=p_student or exists(
      select 1 from public.lesson_participants lp where lp.lesson_id=l.id and lp.student_id=p_student))
    and (p_student is null or public.can_view_student_schedule(p_student))
  union all
  select 'booking',b.id,b.student_id,null::uuid,null::uuid,left('Booking '||b.reference,240),''
  from public.bookings b where (select auth.uid()) is not null
    and (p_student is null or b.student_id=p_student)
  union all
  select 'resource',m.id,coalesce(p_student,m.owner_student_id,ml.student_id),ml.lesson_id,ml.id,left(m.title,240),''
  from public.materials m
  left join lateral (select x.id,x.student_id,x.lesson_id from public.material_links x
    where x.material_id=m.id and p_student is not null and x.student_id=p_student
    order by x.id limit 1) ml on true
  where (select auth.uid()) is not null
    and (p_student is null or public.can_view_student_work(p_student)
      and (m.owner_student_id=p_student or ml.student_id=p_student))
  union all
  select 'note',n.id,n.student_id,n.lesson_id,null::uuid,left(n.title,240),
    regexp_replace(regexp_replace(n.body,'<[^>]*>',' ','g'),'[[:cntrl:]]',' ','g')
  from public.notes n where (select auth.uid()) is not null
    and (p_student is null or n.student_id=p_student)
    and (n.status='published' or exists(select 1 from public.students s
      where s.id=n.student_id and public.is_studio_coach(s.studio_id)))
$$;
revoke all on function workspace_internal.records(uuid) from public, anon;
grant execute on function workspace_internal.records(uuid) to authenticated;

create function public.studio_record_target(p_kind text,p_id uuid,p_student uuid default null)
returns jsonb language sql stable security invoker set search_path='' as $$
  select jsonb_build_object('kind',r.kind,'id',r.id,'studentId',r.student_id,
    'lessonId',r.lesson_id,'assignmentId',r.assignment_id)
  from workspace_internal.records(p_student) r where r.kind=p_kind and r.id=p_id limit 1
$$;
revoke all on function public.studio_record_target(text,uuid,uuid) from public,anon;
grant execute on function public.studio_record_target(text,uuid,uuid) to authenticated;

create function public.studio_global_search(p_query text,p_student uuid default null,p_group text default null,p_page integer default 1)
returns jsonb language sql stable security invoker set search_path='' as $$
with input as (
 select left(btrim(coalesce(p_query,'')),120) q,
   greatest(1,least(coalesce(p_page,1),1000)) page,
   case when p_group is null then 5 else 20 end page_size
), groups as (
 select g.kind from unnest(array['student','lesson','booking','resource','note']) g(kind)
 where p_group is null or p_group=g.kind
), results as (
 select r.*,row_number() over(partition by r.kind order by lower(r.title),r.id) position
 from groups g cross join input i cross join lateral (
   select r.* from workspace_internal.records(p_student) r
   where r.kind=g.kind and length(i.q)>=2
     and (strpos(lower(r.title),lower(i.q))>0 or
       r.kind='note' and strpos(lower(r.snippet),lower(i.q))>0)
   order by lower(r.title),r.id
   limit (i.page_size+1) offset ((i.page-1)*i.page_size)
 ) r
)
select jsonb_build_object('items',coalesce((select jsonb_agg(jsonb_build_object(
 'kind',r.kind,'id',r.id,'studentId',r.student_id,'lessonId',r.lesson_id,
 'assignmentId',r.assignment_id,'title',r.title,'snippet',left(r.snippet,240))
 order by r.kind,r.position) from results r where r.position<=i.page_size),'[]'::jsonb),
 'moreGroups',coalesce((select jsonb_agg(r.kind) from results r where r.position>i.page_size),'[]'::jsonb),
 'page',i.page)
from input i
$$;
revoke all on function public.studio_global_search(text,uuid,text,integer) from public,anon;
grant execute on function public.studio_global_search(text,uuid,text,integer) to authenticated;

comment on function public.studio_global_search(text,uuid,text,integer) is
 'Read-only RLS/invoker search: two-character minimum, five per group, twenty per expanded page, no file URLs or bodies.';

create function public.portal_student_contexts(p_student uuid default null,p_page integer default 1)
returns jsonb language sql stable security invoker set search_path='' as $$
with visible as (
 select s.id,s.full_name,s.preferred_name,s.is_minor,
   public.can_view_student_schedule(s.id) can_schedule,
   public.can_view_student_work(s.id) can_work,
   public.can_view_student_finance(s.id) can_finance,
   coalesce(c.can_manage_profile,s.user_id=(select auth.uid())) can_profile,
   coalesce(c.can_manage_lessons,s.user_id=(select auth.uid())) can_lessons
 from public.students s left join public.linked_contacts c
   on c.student_id=s.id and c.user_id=(select auth.uid()) and c.portal_enabled
 where (select auth.uid()) is not null and s.deleted_at is null
   and ((s.user_id=(select auth.uid()) and s.portal_enabled) or c.id is not null)
), page as (
 select * from visible order by lower(full_name),id limit 51
 offset ((greatest(1,least(coalesce(p_page,1),1000))-1)*50)
), encoded as (
 select id,full_name,jsonb_build_object('id',id,'fullName',full_name,'preferredName',preferred_name,
  'isMinor',is_minor,'canViewSchedule',can_schedule,'canViewWork',can_work,
  'canViewFinance',can_finance,'canManageProfile',can_profile,'canManageLessons',can_lessons) value
 from visible
)
select jsonb_build_object('items',coalesce((select jsonb_agg(e.value order by lower(e.full_name),e.id)
 from (select * from page order by lower(full_name),id limit 50) p join encoded e using(id)),'[]'::jsonb),
 'selected',(select value from encoded where id=p_student),
 'hasMore',(select count(*)>50 from page))
$$;
revoke all on function public.portal_student_contexts(uuid,integer) from public,anon;
grant execute on function public.portal_student_contexts(uuid,integer) to authenticated;
