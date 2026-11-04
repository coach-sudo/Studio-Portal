-- Coach navigation links only. Never delete profiles or transfer their history.
create table workspace_internal.student_identity_groups (
 id uuid primary key default gen_random_uuid(),studio_id uuid not null references public.studios(id) on delete restrict,
 current_student_id uuid not null references public.students(id) on delete restrict,
 active boolean not null default true,version integer not null default 1 check(version>0),
 actor_id uuid not null,reason text not null check(length(trim(reason)) between 3 and 500),
 created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
create table workspace_internal.student_identity_members (
 id uuid primary key default gen_random_uuid(),group_id uuid not null references workspace_internal.student_identity_groups(id) on delete restrict,
 student_id uuid not null references public.students(id) on delete restrict,
 joined_at timestamptz not null default now(),ended_at timestamptz,
 check(ended_at is null or ended_at>=joined_at)
);
create unique index one_active_identity_group_per_student on workspace_internal.student_identity_members(student_id) where ended_at is null;
create index student_identity_group_cursor on workspace_internal.student_identity_members(group_id,student_id) where ended_at is null;
create table workspace_internal.student_identity_receipts (
 actor_id uuid not null,request_key text not null,studio_id uuid not null references public.studios(id) on delete restrict,
 request_hash text not null,result jsonb not null,created_at timestamptz not null default now(),primary key(actor_id,request_key)
);
create table workspace_internal.student_identity_revisions (
 group_id uuid not null references workspace_internal.student_identity_groups(id) on delete restrict,version integer not null,
 actor_id uuid not null,request_key text not null,action text not null,reason text not null,
 before_state jsonb,after_state jsonb not null,created_at timestamptz not null default now(),primary key(group_id,version)
);
alter table workspace_internal.student_identity_groups enable row level security;
alter table workspace_internal.student_identity_members enable row level security;
alter table workspace_internal.student_identity_receipts enable row level security;
alter table workspace_internal.student_identity_revisions enable row level security;
revoke all on workspace_internal.student_identity_groups,workspace_internal.student_identity_members,workspace_internal.student_identity_receipts,workspace_internal.student_identity_revisions from public,anon,authenticated,service_role;

-- Snapshot only identity-bearing dependencies. Lessons, receipts and financial
-- rows never move, so a new lesson or payment cannot change grouping authority.
create function workspace_internal.student_identity_snapshot(p_student uuid) returns jsonb
language sql stable security definer set search_path='' as $$
select jsonb_build_object('student',to_jsonb(s),
 'relationships',coalesce((select jsonb_agg(to_jsonb(r) order by r.id) from public.student_relationships r where r.student_id=s.id),'[]'),
 'contacts',coalesce((select jsonb_agg(to_jsonb(c) order by c.id) from public.linked_contacts c where c.student_id=s.id),'[]'),
 'customers',coalesce((select jsonb_agg(customer order by customer) from (
  select s.stripe_customer_id customer where s.stripe_customer_id is not null
  union select b.stripe_customer_id from public.bookings b where b.student_id=s.id and b.stripe_customer_id is not null
  union select p.stripe_customer_id from public.package_subscriptions p where p.student_id=s.id and p.stripe_customer_id is not null
 ) customers),'[]'),
 'guardians',coalesce((select jsonb_agg(identity order by identity) from (
  select 'email:'||lower(trim(s.guardian_email)) identity where nullif(trim(s.guardian_email),'') is not null
  union select 'user:'||r.user_id::text from public.student_relationships r where r.student_id=s.id
  union select coalesce('user:'||c.user_id::text,'email:'||lower(trim(c.email))) from public.linked_contacts c where c.student_id=s.id and c.portal_enabled and (c.can_view_work or c.can_view_schedule or c.can_view_finance or c.can_manage_profile or c.can_manage_lessons)
 ) guardians where identity is not null),'[]'),
 'payers',coalesce((select jsonb_agg(identity order by identity) from (
  select coalesce('user:'||c.user_id::text,'email:'||lower(trim(c.email))) identity from public.linked_contacts c where c.student_id=s.id and c.is_primary_payer
 ) payers where identity is not null),'[]'))
from public.students s where s.id=p_student
$$;
revoke all on function workspace_internal.student_identity_snapshot(uuid) from public,anon,authenticated,service_role;

create function public.preview_student_identity_change(p_value jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare current_profile public.students; duplicate_profile public.students; current_group workspace_internal.student_identity_groups; other_group uuid;
 action_name text:=p_value->>'action'; current_snapshot jsonb; duplicate_snapshot jsonb; members jsonb; blocked text; stamp text; customer_count integer;
begin
 select * into current_profile from public.students where id=(p_value->>'currentStudentId')::uuid and deleted_at is null;
 if auth.uid() is null or current_profile.id is null or not public.is_studio_coach(current_profile.studio_id) then raise exception 'FORBIDDEN' using errcode='42501';end if;
 if jsonb_typeof(p_value) is distinct from 'object' or length(p_value::text)>10000 or action_name is null or action_name not in ('group','dissolve')
 or jsonb_typeof(p_value->'reason') is distinct from 'string' or length(trim(p_value->>'reason')) not between 3 and 500
 or exists(select 1 from jsonb_object_keys(p_value) k where k not in ('action','currentStudentId','duplicateStudentId','reason')) then raise exception 'VALIDATION_FAILED';end if;
 select g.* into current_group from workspace_internal.student_identity_groups g join workspace_internal.student_identity_members m on m.group_id=g.id
 where m.student_id=current_profile.id and m.ended_at is null and g.active;
 if current_group.id is not null and current_group.current_student_id<>current_profile.id then blocked:='select_designated_current_profile';end if;
 current_snapshot:=workspace_internal.student_identity_snapshot(current_profile.id);
 if action_name='group' then
  select * into duplicate_profile from public.students where id=(p_value->>'duplicateStudentId')::uuid and studio_id=current_profile.studio_id and deleted_at is null;
  if duplicate_profile.id is null then raise exception 'FORBIDDEN' using errcode='42501';end if;
  if current_profile.id=duplicate_profile.id then raise exception 'VALIDATION_FAILED';end if;
  select group_id into other_group from workspace_internal.student_identity_members where student_id=duplicate_profile.id and ended_at is null;
  duplicate_snapshot:=workspace_internal.student_identity_snapshot(duplicate_profile.id);
  select count(distinct c.value) into customer_count from jsonb_array_elements((current_snapshot->'customers')||(duplicate_snapshot->'customers')) c;
  if other_group is not null then blocked:=case when other_group=current_group.id then 'already_grouped' else 'existing_group_requires_review' end;
  elsif current_profile.user_id is not null and duplicate_profile.user_id is not null and current_profile.user_id<>duplicate_profile.user_id then blocked:='different_authenticated_users';
  elsif customer_count>1 then blocked:='different_provider_customers';
  elsif jsonb_array_length(current_snapshot->'guardians')>0 and jsonb_array_length(duplicate_snapshot->'guardians')>0 and current_snapshot->'guardians'<>duplicate_snapshot->'guardians' then blocked:='different_guardian_identities';
  elsif jsonb_array_length(current_snapshot->'payers')>0 and jsonb_array_length(duplicate_snapshot->'payers')>0 and current_snapshot->'payers'<>duplicate_snapshot->'payers' then blocked:='different_payer_identities';end if;
 else
  if p_value ? 'duplicateStudentId' then raise exception 'VALIDATION_FAILED';end if;
  if current_group.id is null then blocked:='no_active_group';end if;
 end if;
 select coalesce(jsonb_agg(jsonb_build_object('membership',to_jsonb(m),'identity',workspace_internal.student_identity_snapshot(m.student_id)) order by m.student_id),'[]') into members
 from workspace_internal.student_identity_members m where m.group_id=current_group.id and m.ended_at is null;
 -- Existing members' identities also remain review holds when adding a profile.
 if action_name='group' and blocked is null and exists(select 1 from jsonb_array_elements(members) item
  where (item#>>'{identity,student,user_id}' is not null and duplicate_profile.user_id is not null and item#>>'{identity,student,user_id}'<>duplicate_profile.user_id::text)
   or (select count(distinct c.value) from jsonb_array_elements((item#>'{identity,customers}')||(duplicate_snapshot->'customers')) c)>1
   or (jsonb_array_length(item#>'{identity,guardians}')>0 and jsonb_array_length(duplicate_snapshot->'guardians')>0 and item#>'{identity,guardians}'<>duplicate_snapshot->'guardians')
   or (jsonb_array_length(item#>'{identity,payers}')>0 and jsonb_array_length(duplicate_snapshot->'payers')>0 and item#>'{identity,payers}'<>duplicate_snapshot->'payers')) then blocked:='group_identity_requires_review';end if;
 stamp:=encode(extensions.digest(jsonb_build_object('proposal',p_value,'current',current_snapshot,'duplicate',duplicate_snapshot,'group',to_jsonb(current_group),'members',members,'otherGroup',other_group)::text,'sha256'),'hex');
 return jsonb_build_object('phase','preview','stamp',stamp,'proposal',p_value,'blockedReason',blocked,
  'currentProfile',jsonb_build_object('id',current_profile.id,'name',coalesce(current_profile.preferred_name,current_profile.full_name),'version',current_profile.version),
  'duplicateProfile',case when duplicate_profile.id is not null then jsonb_build_object('id',duplicate_profile.id,'name',coalesce(duplicate_profile.preferred_name,duplicate_profile.full_name),'version',duplicate_profile.version) end,
  'group',case when current_group.id is not null then jsonb_build_object('id',current_group.id,'version',current_group.version,'currentStudentId',current_group.current_student_id,'memberCount',jsonb_array_length(members)) end,
  'financialEffects','[]'::jsonb,'permissionEffects','[]'::jsonb,'providerEffects','[]'::jsonb,'profilesDeleted',false);
end $$;
revoke all on function public.preview_student_identity_change(jsonb) from public,anon,service_role;
grant execute on function public.preview_student_identity_change(jsonb) to authenticated;

create function public.command_student_identity_change(p_value jsonb,p_stamp text,p_key text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); current_profile public.students; group_row workspace_internal.student_identity_groups; prior workspace_internal.student_identity_receipts;
 preview jsonb; before_group jsonb; result jsonb; profile_ids uuid[]; audit_id uuid:=gen_random_uuid(); action_name text:=p_value->>'action';
 digest text:=encode(extensions.digest(jsonb_build_object('command','student_identity_change','proposal',p_value,'stamp',p_stamp)::text,'sha256'),'hex');
begin
 select * into current_profile from public.students where id=(p_value->>'currentStudentId')::uuid and deleted_at is null;
 if actor is null or current_profile.id is null or not public.is_studio_coach(current_profile.studio_id) then raise exception 'FORBIDDEN' using errcode='42501';end if;
 if length(coalesce(p_key,'')) not between 8 and 200 or coalesce(p_stamp,'') !~ '^[0-9a-f]{64}$' then raise exception 'VALIDATION_FAILED';end if;
 perform pg_advisory_xact_lock(hashtext(current_profile.studio_id::text));
 perform pg_advisory_xact_lock(hashtextextended(actor::text||':student-identity:'||p_key,0));
 select * into prior from workspace_internal.student_identity_receipts where actor_id=actor and request_key=p_key;
 if found then if prior.request_hash<>digest or prior.studio_id<>current_profile.studio_id then raise exception 'IDEMPOTENCY_CONFLICT';end if;return prior.result;end if;
 select array_agg(s.id order by s.id) into profile_ids from public.students s where s.id in(current_profile.id,nullif(p_value->>'duplicateStudentId','')::uuid)
  or s.id in(select m.student_id from workspace_internal.student_identity_members m where m.ended_at is null and m.group_id in(select group_id from workspace_internal.student_identity_members where student_id=current_profile.id and ended_at is null));
 perform 1 from public.students where id=any(profile_ids) order by id for update;
 -- Parent locks fence new FK-bearing identities; lock existing identity rows as
 -- well so a concurrent contact/provider edit cannot change reviewed ownership.
 perform 1 from public.student_relationships where student_id=any(profile_ids) order by id for update;
 perform 1 from public.linked_contacts where student_id=any(profile_ids) order by id for update;
 perform 1 from public.bookings where student_id=any(profile_ids) order by id for update;
 perform 1 from public.package_subscriptions where student_id=any(profile_ids) order by id for update;
 preview:=public.preview_student_identity_change(p_value);
 if preview->>'stamp'<>p_stamp then raise exception 'VERSION_CONFLICT: Refresh the identity preview.';end if;
 if preview->>'blockedReason' is not null then raise exception 'REVIEW_REQUIRED: %',preview->>'blockedReason';end if;
 select g.* into group_row from workspace_internal.student_identity_groups g join workspace_internal.student_identity_members m on m.group_id=g.id where m.student_id=current_profile.id and m.ended_at is null for update of g;
 if group_row.id is not null then before_group:=to_jsonb(group_row);end if;
 if action_name='group' then
  if group_row.id is null then
   insert into workspace_internal.student_identity_groups(studio_id,current_student_id,actor_id,reason) values(current_profile.studio_id,current_profile.id,actor,trim(p_value->>'reason')) returning * into group_row;
   insert into workspace_internal.student_identity_members(group_id,student_id) values(group_row.id,current_profile.id);
  else
   update workspace_internal.student_identity_groups set version=version+1,actor_id=actor,reason=trim(p_value->>'reason'),updated_at=now() where id=group_row.id returning * into group_row;
  end if;
  insert into workspace_internal.student_identity_members(group_id,student_id) values(group_row.id,(p_value->>'duplicateStudentId')::uuid);
 else
  update workspace_internal.student_identity_members set ended_at=clock_timestamp() where group_id=group_row.id and ended_at is null;
  update workspace_internal.student_identity_groups set active=false,version=version+1,actor_id=actor,reason=trim(p_value->>'reason'),updated_at=now() where id=group_row.id returning * into group_row;
 end if;
 insert into workspace_internal.student_identity_revisions(group_id,version,actor_id,request_key,action,reason,before_state,after_state)
 values(group_row.id,group_row.version,actor,p_key,action_name,trim(p_value->>'reason'),before_group,to_jsonb(group_row));
 insert into public.audit_events(id,studio_id,actor_id,entity_type,entity_id,action,reason,correlation_id,source,before_state,after_state)
 values(audit_id,current_profile.studio_id,actor,'student_identity_group',group_row.id,'student.identity_'||action_name,trim(p_value->>'reason'),p_key,'coach_identity_review',before_group,
  jsonb_build_object('group',to_jsonb(group_row),'reviewedProposal',p_value,'reviewedStamp',p_stamp,'financialEffects','[]'::jsonb,'permissionEffects','[]'::jsonb));
 result:=jsonb_build_object('resource',jsonb_build_object('groupId',group_row.id,'version',group_row.version,'active',group_row.active,'currentStudentId',group_row.current_student_id,'profilesDeleted',false),
  'auditEventId',audit_id,'queuedSideEffects','[]'::jsonb);
 insert into workspace_internal.student_identity_receipts(actor_id,request_key,studio_id,request_hash,result) values(actor,p_key,current_profile.studio_id,digest,result);
 return result;
end $$;
revoke all on function public.command_student_identity_change(jsonb,text,text) from public,anon,service_role;
grant execute on function public.command_student_identity_change(jsonb,text,text) to authenticated;

create function public.student_identity_group(p_student uuid,p_after_student uuid default null) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare student public.students; group_row workspace_internal.student_identity_groups; items jsonb; total bigint; more boolean; cursor_id uuid;
begin
 select * into student from public.students where id=p_student;
 if auth.uid() is null or student.id is null or not public.is_studio_coach(student.studio_id) then raise exception 'FORBIDDEN' using errcode='42501';end if;
 select g.* into group_row from workspace_internal.student_identity_groups g join workspace_internal.student_identity_members m on m.group_id=g.id where m.student_id=p_student and m.ended_at is null and g.active;
 select count(*) into total from workspace_internal.student_identity_members where group_id=group_row.id and ended_at is null;
 with page as(select s.id,s.full_name,s.preferred_name,s.status,s.deleted_at from workspace_internal.student_identity_members m join public.students s on s.id=m.student_id where m.group_id=group_row.id and m.ended_at is null and (p_after_student is null or m.student_id>p_after_student) order by m.student_id limit 26),visible as(select * from page order by id limit 25)
 select coalesce(jsonb_agg(jsonb_build_object('studentId',id,'name',coalesce(preferred_name,full_name),'status',status,'deletedAt',deleted_at,'isCurrent',id=group_row.current_student_id) order by id),'[]'),(select count(*)>25 from page),(array_agg(id order by id desc))[1] into items,more,cursor_id from visible;
 return jsonb_build_object('group',case when group_row.id is not null then jsonb_build_object('id',group_row.id,'version',group_row.version,'currentStudentId',group_row.current_student_id) end,'members',items,'total',total,'hasMore',more,'nextAfterStudent',case when more then cursor_id end,'financialAccountsRemainSeparate',true,'permissionsRemainSeparate',true);
end $$;
revoke all on function public.student_identity_group(uuid,uuid) from public,anon,service_role;
grant execute on function public.student_identity_group(uuid,uuid) to authenticated;

-- Preserve the old signature, but never invoke its physical deletion/permission
-- union implementation from a legacy client after identity grouping is enabled.
create or replace function public.merge_studio_students(keep_student_id uuid,remove_student_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or keep_student_id=remove_student_id or not exists(select 1 from public.students k join public.students r on r.studio_id=k.studio_id where k.id=keep_student_id and r.id=remove_student_id and public.is_studio_coach(k.studio_id)) then raise exception 'FORBIDDEN' using errcode='42501';end if;
 raise exception 'REVIEW_REQUIRED: Use the identity-preserving duplicate profile preview. Existing records and permissions have not moved.';
end $$;
revoke all on function public.merge_studio_students(uuid,uuid) from public,anon,service_role;
grant execute on function public.merge_studio_students(uuid,uuid) to authenticated;
