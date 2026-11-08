create schema calendar_inbound;
revoke all on schema calendar_inbound from public, anon, authenticated;

create table calendar_inbound.checkpoints (
  studio_id uuid not null references public.studios(id) on delete cascade,
  calendar_id text not null,
  revision bigint not null default 0,
  sync_token text,
  page_token text,
  scan_id uuid not null default gen_random_uuid(),
  completed_at timestamptz,
  primary key (studio_id, calendar_id)
);

create table calendar_inbound.events (
  studio_id uuid not null,
  calendar_id text not null,
  event_id text not null,
  scan_id uuid not null,
  lesson_id uuid references public.lessons(id) on delete set null,
  observation jsonb not null,
  disposition text not null check (disposition in ('personal','busy_only','studio_lesson','cancelled','needs_review')),
  primary key (studio_id, calendar_id, event_id),
  foreign key (studio_id, calendar_id) references calendar_inbound.checkpoints(studio_id, calendar_id) on delete cascade
);

create function public.calendar_inbound_checkpoint(p_studio uuid, p_calendar text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare checkpoint calendar_inbound.checkpoints;
begin
  if p_calendar is null or p_calendar = 'primary' or length(p_calendar) not between 1 and 1024
    then raise exception 'VALIDATION_FAILED'; end if;
  insert into calendar_inbound.checkpoints(studio_id,calendar_id)
    values(p_studio,p_calendar) on conflict do nothing;
  select * into strict checkpoint from calendar_inbound.checkpoints
    where studio_id=p_studio and calendar_id=p_calendar;
  return jsonb_build_object('revision',checkpoint.revision,'syncToken',checkpoint.sync_token,'pageToken',checkpoint.page_token);
end $$;

-- Callers hold the lesson and projection locks in that order.
create function calendar_inbound.hold_for_review(p_lesson public.lessons, p_projection uuid, p_payload jsonb)
returns void language plpgsql set search_path='' as $$
begin
  if not exists(select 1 from public.sync_conflicts c where c.studio_id=p_lesson.studio_id and c.entity_type='lesson'
      and c.entity_id=p_lesson.id and c.status='open') then
    insert into public.sync_conflicts(studio_id,entity_type,entity_id,source,internal_version,external_payload)
      values(p_lesson.studio_id,'lesson',p_lesson.id,'google_calendar',p_lesson.version,p_payload);
  end if;
  update public.calendar_projections set status='failed',last_error='synchronization_review_required'
    where id=p_projection and status<>'review_required' and (claim_until is null or claim_until<=now());
end $$;

create function calendar_inbound.observe_event(p_studio uuid, p_calendar text, p_scan uuid, p_event jsonb)
returns text language plpgsql set search_path='' as $$
declare
  source_event_id text := p_event->>'id';
  source_revision text := p_event->>'etag';
  cancelled boolean := p_event->>'status' = 'cancelled';
  starts timestamptz := (p_event->>'startsAt')::timestamptz;
  ends timestamptz := (p_event->>'endsAt')::timestamptz;
  prior calendar_inbound.events;
  projection public.calendar_projections;
  lesson public.lessons;
  target uuid;
  disposition text;
  action text;
  applied boolean := false;
  has_conflict boolean;
begin
  select * into prior from calendar_inbound.events e
    where e.studio_id=p_studio and e.calendar_id=p_calendar and e.event_id=source_event_id;
  if prior.observation=p_event then
    update calendar_inbound.events e set scan_id=p_scan
      where e.studio_id=p_studio and e.calendar_id=p_calendar and e.event_id=source_event_id;
    return 'unchanged';
  end if;

  select p.lesson_id into target from public.calendar_projections p
    join public.lessons l on l.id=p.lesson_id
    where l.studio_id=p_studio and p.external_event_id=source_event_id;
  if target is not null then
    perform 1 from public.students s where s.studio_id=p_studio and s.id in (
      select l.student_id from public.lessons l where l.id=target
      union select lp.student_id from public.lesson_participants lp where lp.lesson_id=target
    ) order by s.id for update;
    select * into lesson from public.lessons where id=target for update;
    select * into projection from public.calendar_projections where lesson_id=target for update;
  end if;

  if target is null or projection.external_event_id is distinct from source_event_id then
    if prior.lesson_id is not null or exists(select 1 from public.integration_imports i
        where i.studio_id=p_studio and i.provider='google_calendar' and i.external_id=source_event_id
          and (i.lesson_id is not null or i.verified_at is not null))
      or exists(select 1 from public.calendar_projections p join public.lessons l on l.id=p.lesson_id
        where l.studio_id=p_studio and 'coachd'||replace(l.id::text,'-','')=source_event_id) then
      disposition := 'needs_review';
    elsif cancelled then disposition := 'cancelled';
    elsif p_event->>'transparency'='transparent' then disposition := 'personal';
    else disposition := 'busy_only';
    end if;
    target := prior.lesson_id;
  elsif prior.lesson_id is distinct from target
      and (source_revision is null or source_revision is distinct from projection.external_version) then
    -- Existing projections did not store the calendar. A matching provider
    -- revision establishes provenance on the first scan of this calendar.
    disposition := 'needs_review';
  else
    select exists(select 1 from public.sync_conflicts c where c.studio_id=p_studio and c.entity_type='lesson'
      and c.entity_id=target and c.status='open') into has_conflict;
    if cancelled and lesson.status not in ('cancelled','late_cancelled') then action := 'cancel';
    elsif not cancelled and (starts is distinct from lesson.starts_at or ends is distinct from lesson.ends_at)
      then action := 'reschedule';
    end if;

    if not cancelled and lesson.status in ('cancelled','late_cancelled') then
      disposition := 'needs_review';
    elsif action is null then
      disposition := case when cancelled then 'cancelled' else 'studio_lesson' end;
      if source_revision is not null and source_revision is distinct from projection.external_version then
        if not has_conflict and (projection.claim_until is null or projection.claim_until<=now()) and (
          (projection.status='projected' and projection.projected_version=lesson.version)
          or (projection.status in ('queued','failed','projecting') and projection.projected_version<lesson.version
            and lesson.status='scheduled' and lesson.starts_at>now() and p_event->>'status'='confirmed'
            and prior.observation->>'etag'=projection.external_version)
        ) then
          -- Acknowledge agreement on timing only. Outbound still owns the rest
          -- of the projection and must finish under its normal claim and ETag fences.
          update public.calendar_projections set external_version=source_revision,
            next_attempt_at=case when last_error='calendar_external_change_requires_review' then now() else next_attempt_at end
            where id=projection.id;
        else
          disposition := 'needs_review';
        end if;
      end if;
    elsif lesson.status<>'scheduled' or lesson.starts_at<=now()
      or p_event->>'status'='tentative'
      or projection.status<>'projected' or projection.projected_version<>lesson.version
      or projection.claim_until>now()
      or (action='reschedule' and (starts is null or ends is null or starts<=now() or ends<=starts))
      or (action='reschedule' and exists(select 1 from public.lessons other
        where other.studio_id=p_studio and other.id<>target and other.status='scheduled'
          and other.starts_at<ends and other.ends_at>starts))
      or has_conflict then
      disposition := 'needs_review';
    else
      begin
        perform public.command_change_lesson_state(target,lesson.version,action,starts,ends,false);
        update public.calendar_projections set
          external_version=coalesce(source_revision,calendar_projections.external_version),
          projected_version=(select version from public.lessons where id=target),last_error=null
          where id=projection.id;
        disposition := case when cancelled then 'cancelled' else 'studio_lesson' end;
        applied := true;
      exception when raise_exception then
        if sqlerrm not like 'REVIEW_REQUIRED:%' and sqlerrm not in ('VERSION_CONFLICT','IDEMPOTENCY_CONFLICT') then
          raise;
        end if;
        disposition := 'needs_review';
      end;
    end if;
  end if;

  if disposition='needs_review' and lesson.id is not null then
    perform calendar_inbound.hold_for_review(lesson,projection.id,p_event||jsonb_build_object('calendarId',p_calendar));
  end if;
  -- Preserve a trusted mapping, but do not promote a first revision mismatch.
  if prior.lesson_id is distinct from target and disposition='needs_review' then target := prior.lesson_id; end if;
  insert into calendar_inbound.events(studio_id,calendar_id,event_id,scan_id,lesson_id,observation,disposition)
    values(p_studio,p_calendar,source_event_id,p_scan,target,p_event,disposition)
    on conflict on constraint events_pkey do update set scan_id=excluded.scan_id,lesson_id=excluded.lesson_id,
      observation=excluded.observation,disposition=excluded.disposition;
  return case when applied then 'applied' when disposition='needs_review' then 'review' else 'observed' end;
end $$;

create function public.commit_calendar_inbound_page(
  p_studio uuid, p_calendar text, p_revision bigint, p_events jsonb,
  p_next_page text, p_next_sync text, p_reset boolean
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  checkpoint calendar_inbound.checkpoints;
  missing calendar_inbound.events;
  lesson public.lessons;
  projection public.calendar_projections;
  item jsonb;
  outcome text;
  applied integer := 0;
  review integer := 0;
begin
  select * into strict checkpoint from calendar_inbound.checkpoints
    where studio_id=p_studio and calendar_id=p_calendar for update;
  if checkpoint.revision<>p_revision then return jsonb_build_object('committed',false); end if;
  if p_reset then
    update calendar_inbound.checkpoints set revision=revision+1,sync_token=null,page_token=null,scan_id=gen_random_uuid()
      where studio_id=p_studio and calendar_id=p_calendar;
    return jsonb_build_object('committed',true,'imported',0,'review',0);
  end if;
  if jsonb_typeof(p_events) is distinct from 'array' or jsonb_array_length(p_events)>50
    or (p_next_page is null)=(p_next_sync is null)
    or p_next_page is not null and p_next_page is not distinct from checkpoint.page_token
    then raise exception 'VALIDATION_FAILED'; end if;

  perform pg_advisory_xact_lock(hashtext(p_studio::text));
  for item in select value from jsonb_array_elements(p_events) order by value->>'id' loop
    outcome := calendar_inbound.observe_event(p_studio,p_calendar,checkpoint.scan_id,item);
    if outcome='applied' then applied := applied+1; end if;
    if outcome='review' then review := review+1; end if;
  end loop;
  if p_next_sync is not null and checkpoint.sync_token is null then
    -- A lost token can hide old tombstones. Absence from a complete scan is
    -- review evidence, never permission to cancel a canonical lesson.
    for missing in
      select * from calendar_inbound.events where studio_id=p_studio and calendar_id=p_calendar
        and scan_id<>checkpoint.scan_id and disposition<>'cancelled' and lesson_id is not null
        order by lesson_id,event_id
    loop
      select * into lesson from public.lessons where id=missing.lesson_id and studio_id=p_studio for update;
      if found then
        select * into projection from public.calendar_projections where lesson_id=lesson.id for update;
        if projection.external_event_id=missing.event_id then
          perform calendar_inbound.hold_for_review(lesson,projection.id,missing.observation||jsonb_build_object(
            'calendarId',p_calendar,'reason','mapped_event_missing_from_full_scan'));
        end if;
      end if;
      review := review+1;
    end loop;
    update calendar_inbound.events set disposition=case when lesson_id is null then 'cancelled' else 'needs_review' end
      where studio_id=p_studio and calendar_id=p_calendar and scan_id<>checkpoint.scan_id and disposition<>'cancelled';
  end if;
  update calendar_inbound.checkpoints set revision=revision+1,page_token=p_next_page,
    sync_token=coalesce(p_next_sync,sync_token),
    completed_at=case when p_next_sync is not null then now() else completed_at end
    where studio_id=p_studio and calendar_id=p_calendar;
  return jsonb_build_object('committed',true,'imported',applied,'review',review);
end $$;

revoke all on function public.calendar_inbound_checkpoint(uuid,text),
  public.commit_calendar_inbound_page(uuid,text,bigint,jsonb,text,text,boolean) from public, anon, authenticated;
grant execute on function public.calendar_inbound_checkpoint(uuid,text),
  public.commit_calendar_inbound_page(uuid,text,bigint,jsonb,text,text,boolean) to service_role;
