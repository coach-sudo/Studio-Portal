-- Preserve legacy draft metadata; validate only newly submitted portfolio fields.
create or replace function public.command_actor_page(p_profile uuid,p_command text,p_value jsonb,p_version integer,p_key text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=(select auth.uid()); profile public.actor_profiles; student public.students; previous jsonb; receipt workspace_internal.operation_receipts;
 request jsonb:=jsonb_build_object('profile',p_profile,'command',p_command,'value',p_value); next_status text:=coalesce(p_value->>'status','draft'); revision_id uuid; actor_content jsonb; result jsonb;
begin
 select s.* into student from public.students s join public.actor_profiles a on a.student_id=s.id where a.id=p_profile and s.deleted_at is null for update of s;
 if actor is null or student.id is null or not public.can_manage_student_profile(student.id) then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if student.user_id=actor and not student.portal_enabled then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if length(coalesce(p_key,''))<8 then raise exception 'VALIDATION_FAILED'; end if;
 select * into profile from public.actor_profiles where id=p_profile for update;
 select * into receipt from workspace_internal.operation_receipts where actor_id=actor and key=p_key;
 if found then if receipt.request<>request then raise exception 'IDEMPOTENCY_CONFLICT'; end if; return receipt.result; end if;
 if profile.version<>p_version then raise exception 'VERSION_CONFLICT'; end if;
 previous:=to_jsonb(profile);
 if p_command='save' then
  if next_status not in ('draft','review_requested') or length(trim(coalesce(p_value->>'displayName',profile.display_name)))<2 or length(p_value::text)>100000 then raise exception 'VALIDATION_FAILED'; end if;
  actor_content:=coalesce(profile.draft_content,'{}')||coalesce(p_value->'portfolio','{}');
  if jsonb_typeof(coalesce(p_value->'portfolio','{}'::jsonb))<>'object' or jsonb_typeof(actor_content)<>'object' or exists(select 1 from jsonb_object_keys(coalesce(p_value->'portfolio','{}'::jsonb)) k where k not in ('profileLabel','headline','unionStatus','location','playingAge','height','eyeColor','hairColor','website','representation','accentColor','contactEmail','contactPhone','showEmail','showPhone','primaryHeadshotMaterialId','presentation','credits','skills')) then raise exception 'VALIDATION_FAILED'; end if;
  if coalesce(actor_content->>'website','')<>'' and actor_content->>'website' !~ '^https?://' then raise exception 'VALIDATION_FAILED: Unsafe website URL.'; end if;
  if actor_content?'presentation' and (actor_content#>>'{presentation,version}'<>'1' or actor_content#>>'{presentation,layout}' not in ('classic','spotlight') or jsonb_array_length(actor_content#>'{presentation,sections}')<>5 or (select count(distinct v) from jsonb_array_elements_text(actor_content#>'{presentation,sections}') v where v in ('biography','headshots','credits','skills','media'))<>5) then raise exception 'VALIDATION_FAILED: Unsupported layout.'; end if;
  update public.actor_profiles set display_name=coalesce(p_value->>'displayName',display_name),bio=coalesce(p_value->>'bio',bio),draft_content=actor_content,draft_status=next_status,
   status=case when published_revision_id is not null and status='published' then status else next_status::public.actor_profile_status end,version=version+1,updated_at=now() where id=p_profile returning * into profile;
 elsif p_command='review' then
  if not public.is_studio_coach(student.studio_id) then raise exception 'FORBIDDEN' using errcode='42501'; end if;
  if next_status='published' then
   if coalesce(profile.draft_status,profile.status::text)<>'approved' or not student.actor_page_eligible then raise exception 'REVIEW_REQUIRED: Approve this draft before publication.'; end if;
   actor_content:=coalesce(profile.draft_content,'{}')||jsonb_build_object('displayName',profile.display_name,'bio',profile.bio,'slug',profile.slug,
    'materialIds',coalesce((select jsonb_agg(m.id order by m.sort_order,m.id) from public.materials m where m.owner_student_id=student.id and m.status='active' and m.approval_status='approved' and m.public_embed),'[]'),
    'materialSnapshot',coalesce((select jsonb_agg(to_jsonb(x)) from(select m.id,m.title,m.category,m.caption,m.external_url,m.storage_path,m.mime_type,m.media_kind,m.public_embed,m.sort_order from public.materials m where m.owner_student_id=student.id and m.status='active' and m.approval_status='approved' and m.public_embed order by m.sort_order,m.id)x),'[]'));
   insert into public.actor_profile_revisions(actor_profile_id,revision_number,content) select p_profile,coalesce(max(revision_number),0)+1,actor_content from public.actor_profile_revisions where actor_profile_id=p_profile returning id into revision_id;
   update public.actor_profiles set status='published',draft_status=null,published_revision_id=revision_id,version=version+1,updated_at=now() where id=p_profile returning * into profile;
  elsif next_status in ('approved','changes_requested') then
   update public.actor_profiles set draft_status=next_status,status=case when next_status='changes_requested' then 'changes_requested'::public.actor_profile_status when status='published' then status else next_status::public.actor_profile_status end,version=version+1,updated_at=now() where id=p_profile returning * into profile;
  else raise exception 'INVALID_TRANSITION'; end if;
 else raise exception 'INVALID_TRANSITION'; end if;
 insert into public.audit_events(studio_id,actor_id,action,entity_type,entity_id,reason,correlation_id,source,before_state,after_state) values(student.studio_id,actor,'actor_profile.'||next_status,'actor_profile',p_profile,'Reviewed Actor Page change',p_key,'portal',previous,to_jsonb(profile));
 result:=jsonb_build_object('resource',to_jsonb(profile),'queuedSideEffects','[]'::jsonb);
 insert into workspace_internal.operation_receipts(actor_id,key,studio_id,request,result) values(actor,p_key,student.studio_id,request,result);
 return result;
end $$;
revoke all on function public.command_actor_page(uuid,text,jsonb,integer,text) from public,anon;
grant execute on function public.command_actor_page(uuid,text,jsonb,integer,text) to authenticated;
