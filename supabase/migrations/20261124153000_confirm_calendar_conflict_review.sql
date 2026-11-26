-- Resolve one reviewed mapping without replaying any event write or lesson command.
create function public.confirm_calendar_conflict_review(
  p_studio uuid, p_actor uuid, p_lesson uuid, p_version integer,
  p_event_id text, p_event_revision text, p_starts_at timestamptz, p_ends_at timestamptz,
  p_correlation text
) returns text language plpgsql security definer set search_path='' as $$
declare
  lesson public.lessons;
  projection public.calendar_projections;
  total integer;
  distinct_observations integer;
  exact_mapping boolean;
  historical boolean;
begin
  if not exists(select 1 from public.memberships where studio_id=p_studio
    and user_id=p_actor and role='coach') then
    raise exception 'FORBIDDEN';
  end if;
  select * into lesson from public.lessons
    where id=p_lesson and studio_id=p_studio for update;
  if not found or lesson.version is distinct from p_version then return 'changed'; end if;
  select * into projection from public.calendar_projections where lesson_id=p_lesson for update;
  if not found or p_event_id is null or nullif(p_event_revision,'') is null or projection.external_event_id is distinct from p_event_id
    then return 'changed'; end if;
  if projection.status='reviewed' then return 'already_reviewed'; end if;
  if projection.status not in ('failed','review_required')
    or projection.last_error is distinct from 'synchronization_review_required'
    or projection.claim_until>now() then return 'changed'; end if;

  historical := lesson.status='completed' and lesson.ends_at<now();
  if not historical and (lesson.status<>'scheduled'
    or lesson.starts_at is distinct from p_starts_at
    or lesson.ends_at is distinct from p_ends_at) then return 'changed'; end if;

  select count(*),count(distinct (internal_version,external_payload)),
    bool_and(coalesce(source='google_calendar' and external_payload->>'id'=p_event_id,false))
    into total,distinct_observations,exact_mapping
    from public.sync_conflicts where studio_id=p_studio
      and entity_type='lesson' and entity_id=p_lesson and status='open';
  if total=0 or distinct_observations<>1 or exact_mapping is not true then return 'changed'; end if;

  update public.sync_conflicts set status='accepted_internal',resolved_at=now()
    where studio_id=p_studio and entity_type='lesson' and entity_id=p_lesson and status='open';
  update public.calendar_projections set status='reviewed',external_version=p_event_revision,last_error=null,next_attempt_at=null,
    claim_token=null,claim_until=null where id=projection.id;
  insert into public.audit_events(studio_id,actor_id,action,entity_type,entity_id,source,
    reason,correlation_id,after_state)
    values(p_studio,p_actor,'system_health.review_calendar_conflict','lesson',p_lesson,'coach',
      case when historical then 'Retain completed lesson as recorded' else 'Verified matching event timing' end,
      p_correlation,jsonb_build_object('conflictsReviewed',total,'lessonVersion',p_version));
  return 'reviewed';
end $$;
revoke all on function public.confirm_calendar_conflict_review(uuid,uuid,uuid,integer,text,text,timestamptz,timestamptz,text)
  from public,anon,authenticated;
grant execute on function public.confirm_calendar_conflict_review(uuid,uuid,uuid,integer,text,text,timestamptz,timestamptz,text)
  to service_role;
