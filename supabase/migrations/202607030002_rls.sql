create or replace function public.is_studio_coach(target_studio uuid) returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.memberships m where m.studio_id=target_studio and m.user_id=(select auth.uid()) and m.role='coach')
$$;
create or replace function public.can_access_student(target_student uuid) returns boolean language sql stable security definer set search_path='' as $$
  select exists(
    select 1 from public.students s where s.id=target_student and (
      s.user_id=(select auth.uid()) or public.is_studio_coach(s.studio_id) or exists(select 1 from public.student_relationships r where r.student_id=s.id and r.user_id=(select auth.uid()))
    )
  )
$$;
create or replace function public.can_view_student_finance(target_student uuid) returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.students s where s.id=target_student and (public.is_studio_coach(s.studio_id) or s.user_id=(select auth.uid()) or exists(select 1 from public.student_relationships r where r.student_id=s.id and r.user_id=(select auth.uid()) and r.can_view_finance)))
$$;

alter table public.studios enable row level security;
alter table public.memberships enable row level security;
alter table public.students enable row level security;
alter table public.student_relationships enable row level security;
alter table public.lessons enable row level security;
alter table public.notes enable row level security;
alter table public.assignments enable row level security;
alter table public.materials enable row level security;
alter table public.material_links enable row level security;
alter table public.packages enable row level security;
alter table public.package_credit_entries enable row level security;
alter table public.payment_entries enable row level security;
alter table public.actor_profiles enable row level security;
alter table public.actor_profile_revisions enable row level security;
alter table public.profile_submissions enable row level security;
alter table public.reader_requests enable row level security;
alter table public.outbox_messages enable row level security;
alter table public.delivery_attempts enable row level security;
alter table public.calendar_connections enable row level security;
alter table public.calendar_projections enable row level security;
alter table public.sync_conflicts enable row level security;
alter table public.recommendations enable row level security;
alter table public.webhook_events enable row level security;
alter table public.idempotency_keys enable row level security;
alter table public.audit_events enable row level security;

create policy studios_member_select on public.studios for select to authenticated using (exists(select 1 from public.memberships m where m.studio_id=id and m.user_id=(select auth.uid())));
create policy memberships_self_or_coach on public.memberships for select to authenticated using (user_id=(select auth.uid()) or public.is_studio_coach(studio_id));
create policy students_access on public.students for select to authenticated using (public.can_access_student(id));
create policy students_coach_write on public.students for all to authenticated using (public.is_studio_coach(studio_id)) with check(public.is_studio_coach(studio_id));
create policy relationships_access on public.student_relationships for select to authenticated using (user_id=(select auth.uid()) or public.can_access_student(student_id));
create policy relationships_coach_write on public.student_relationships for all to authenticated using (exists(select 1 from public.students s where s.id=student_id and public.is_studio_coach(s.studio_id))) with check(exists(select 1 from public.students s where s.id=student_id and public.is_studio_coach(s.studio_id)));
create policy lessons_access on public.lessons for select to authenticated using(public.can_access_student(student_id));
create policy lessons_coach_write on public.lessons for all to authenticated using(public.is_studio_coach(studio_id)) with check(public.is_studio_coach(studio_id));
create policy notes_visible on public.notes for select to authenticated using(public.can_access_student(student_id) and (status='published' or exists(select 1 from public.students s where s.id=student_id and public.is_studio_coach(s.studio_id))));
create policy notes_coach_write on public.notes for all to authenticated using(exists(select 1 from public.students s where s.id=student_id and public.is_studio_coach(s.studio_id))) with check(exists(select 1 from public.students s where s.id=student_id and public.is_studio_coach(s.studio_id)));
create policy assignments_access on public.assignments for select to authenticated using(public.can_access_student(student_id));
create policy assignments_student_update on public.assignments for update to authenticated using(public.can_access_student(student_id)) with check(public.can_access_student(student_id));
create policy assignments_coach_write on public.assignments for all to authenticated using(exists(select 1 from public.students s where s.id=student_id and public.is_studio_coach(s.studio_id))) with check(exists(select 1 from public.students s where s.id=student_id and public.is_studio_coach(s.studio_id)));
create policy materials_access on public.materials for select to authenticated using(owner_student_id is not null and public.can_access_student(owner_student_id));
create policy materials_coach_write on public.materials for all to authenticated using(public.is_studio_coach(studio_id)) with check(public.is_studio_coach(studio_id));
create policy material_links_access on public.material_links for select to authenticated using((student_id is not null and public.can_access_student(student_id)) or exists(select 1 from public.lessons l where l.id=lesson_id and public.can_access_student(l.student_id)));
create policy material_links_coach_write on public.material_links for all to authenticated using(exists(select 1 from public.materials m where m.id=material_id and public.is_studio_coach(m.studio_id))) with check(exists(select 1 from public.materials m where m.id=material_id and public.is_studio_coach(m.studio_id)));
create policy packages_finance_access on public.packages for select to authenticated using(public.can_view_student_finance(student_id));
create policy packages_coach_write on public.packages for all to authenticated using(exists(select 1 from public.students s where s.id=student_id and public.is_studio_coach(s.studio_id))) with check(exists(select 1 from public.students s where s.id=student_id and public.is_studio_coach(s.studio_id)));
create policy credits_finance_access on public.package_credit_entries for select to authenticated using(exists(select 1 from public.packages p where p.id=package_id and public.can_view_student_finance(p.student_id)));
create policy payments_finance_access on public.payment_entries for select to authenticated using(public.can_view_student_finance(student_id));
create policy actor_profiles_access on public.actor_profiles for select to authenticated using(public.can_access_student(student_id));
create policy actor_profiles_related_write on public.actor_profiles for update to authenticated using(public.can_access_student(student_id)) with check(public.can_access_student(student_id));
create policy actor_revisions_access on public.actor_profile_revisions for select to authenticated using(exists(select 1 from public.actor_profiles p where p.id=actor_profile_id and public.can_access_student(p.student_id)));
create policy profile_submissions_access on public.profile_submissions for select to authenticated using(exists(select 1 from public.actor_profiles p where p.id=actor_profile_id and public.can_access_student(p.student_id)));
create policy profile_submissions_related_write on public.profile_submissions for insert to authenticated with check(exists(select 1 from public.actor_profiles p where p.id=actor_profile_id and public.can_access_student(p.student_id)));
create policy reader_requests_access on public.reader_requests for select to authenticated using(public.can_access_student(student_id));
create policy reader_requests_related_insert on public.reader_requests for insert to authenticated with check(public.can_access_student(student_id));
create policy outbox_coach_access on public.outbox_messages for select to authenticated using(public.is_studio_coach(studio_id));
create policy attempts_coach_access on public.delivery_attempts for select to authenticated using(exists(select 1 from public.outbox_messages o where o.id=outbox_message_id and public.is_studio_coach(o.studio_id)));
create policy calendar_coach_access on public.calendar_connections for select to authenticated using(public.is_studio_coach(studio_id));
create policy projections_coach_access on public.calendar_projections for select to authenticated using(exists(select 1 from public.lessons l where l.id=lesson_id and public.is_studio_coach(l.studio_id)));
create policy conflicts_coach_access on public.sync_conflicts for select to authenticated using(public.is_studio_coach(studio_id));
create policy recommendations_coach_access on public.recommendations for select to authenticated using(public.is_studio_coach(studio_id));
create policy audit_coach_access on public.audit_events for select to authenticated using(public.is_studio_coach(studio_id));

create or replace view public.published_actor_profiles with (security_invoker=false) as
select p.slug,p.display_name,r.content,r.published_at
from public.actor_profiles p join public.actor_profile_revisions r on r.id=p.published_revision_id
where p.status='published';
grant select on public.published_actor_profiles to anon, authenticated;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('studio-materials','studio-materials',false,52428800,array['application/pdf','image/jpeg','image/png','image/webp','video/mp4','text/plain'])
on conflict(id) do nothing;
create policy material_objects_read on storage.objects for select to authenticated using(bucket_id='studio-materials');
create policy material_objects_insert on storage.objects for insert to authenticated with check(bucket_id='studio-materials');
