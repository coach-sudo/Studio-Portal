-- Keep the existing conflict rows as history. Receipts outlive operational
-- history retention so an old provider observation cannot reopen a review.
create schema calendar_review_internal;
revoke all on schema calendar_review_internal from public,anon,authenticated,service_role;

create table calendar_review_internal.observations (
  studio_id uuid not null references public.studios(id) on delete cascade,
  lesson_id uuid not null references public.lessons(id) on delete cascade,
  fingerprint bytea not null,
  conflict_id uuid not null,
  occurrences bigint not null default 1,
  last_seen_at timestamptz not null default now(),
  primary key(studio_id,lesson_id,fingerprint)
);
alter table calendar_review_internal.observations enable row level security;
revoke all on calendar_review_internal.observations from public,anon,authenticated,service_role;

create function calendar_review_internal.instant(p_value text) returns text
language plpgsql stable set search_path='' as $$
begin
  if p_value ~ '(Z|[+-][0-9][0-9]:[0-9][0-9])$' then
    return extract(epoch from p_value::timestamptz)::text;
  end if;
  return p_value;
exception when invalid_datetime_format or datetime_field_overflow then
  return p_value;
end $$;

create function calendar_review_internal.fingerprint(p_lesson public.lessons,p_event jsonb)
returns bytea language sql stable set search_path='' as $$
  select sha256(convert_to(jsonb_build_array(
    p_event->>'id',
    case when p_event->>'status'='cancelled' then 'cancelled' else 'active' end,
    p_event->>'reason',
    calendar_review_internal.instant(coalesce(p_event->>'startsAt',p_event#>>'{start,dateTime}',p_event#>>'{start,date}')),
    calendar_review_internal.instant(coalesce(p_event->>'endsAt',p_event#>>'{end,dateTime}',p_event#>>'{end,date}')),
    extract(epoch from p_lesson.starts_at),extract(epoch from p_lesson.ends_at),
    p_lesson.status in ('cancelled','late_cancelled')
  )::text,'UTF8'))
$$;

-- Existing duplicates keep their original payload, timestamp and identity.
-- Where an identical discrepancy was already resolved, that decision wins.
with history as (
  select c.*,calendar_review_internal.fingerprint(l,c.external_payload) as fingerprint
  from public.sync_conflicts c join public.lessons l on l.id=c.entity_id and l.studio_id=c.studio_id
  where c.entity_type='lesson' and c.source='google_calendar' and c.external_payload->>'id' is not null
), ranked as (
  select *,first_value(id) over (
    partition by studio_id,entity_id,fingerprint
    order by (status='open'),(status='merged'),created_at,id
  ) as canonical,
  count(*) over(partition by studio_id,entity_id,fingerprint) as occurrences,
  max(created_at) over(partition by studio_id,entity_id,fingerprint) as last_seen
  from history
), receipts as (
  insert into calendar_review_internal.observations(studio_id,lesson_id,fingerprint,conflict_id,occurrences,last_seen_at)
  select studio_id,entity_id,fingerprint,id,occurrences,last_seen from ranked where id=canonical
)
update public.sync_conflicts c set status='merged'
from ranked r where c.id=r.id and r.id<>r.canonical and c.status='open';

create function calendar_review_internal.consolidate() returns trigger
language plpgsql security definer set search_path='' as $$
declare lesson public.lessons; canonical uuid;
begin
  if new.source<>'google_calendar' or new.entity_type<>'lesson' or new.status<>'open'
    or new.external_payload->>'id' is null then return new; end if;
  select * into lesson from public.lessons where id=new.entity_id and studio_id=new.studio_id;
  if not found then return new; end if;
  insert into calendar_review_internal.observations as o(studio_id,lesson_id,fingerprint,conflict_id)
    values(new.studio_id,new.entity_id,calendar_review_internal.fingerprint(lesson,new.external_payload),new.id)
  on conflict(studio_id,lesson_id,fingerprint) do update set
    occurrences=o.occurrences+1,last_seen_at=now()
  returning conflict_id into canonical;
  if canonical<>new.id then return null; end if;
  return new;
end $$;
revoke all on function calendar_review_internal.consolidate() from public,anon,authenticated,service_role;

create trigger consolidate_calendar_observations before insert on public.sync_conflicts
for each row execute function calendar_review_internal.consolidate();

-- A fresh discrepancy must be visible even if its last projection succeeded.
create function calendar_review_internal.hold_projection() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  update public.calendar_projections p
    set status='failed',last_error='synchronization_review_required'
    where p.lesson_id=new.entity_id and p.external_event_id=new.external_payload->>'id'
      and p.status<>'review_required' and (p.claim_until is null or p.claim_until<=now())
      and exists(select 1 from public.lessons l where l.id=p.lesson_id and l.studio_id=new.studio_id);
  return new;
end $$;
revoke all on function calendar_review_internal.hold_projection() from public,anon,authenticated,service_role;
create trigger hold_new_calendar_discrepancy after insert on public.sync_conflicts
for each row when (new.source='google_calendar' and new.entity_type='lesson' and new.status='open')
execute function calendar_review_internal.hold_projection();

-- A repeated scan must stop before it retries a lesson command or recommendation.
create function public.observe_existing_calendar_conflict(p_studio uuid,p_lesson uuid,p_event jsonb)
returns boolean language plpgsql security definer set search_path='' as $$
declare lesson public.lessons;
begin
  if p_event->>'id' is null then return false; end if;
  select * into lesson from public.lessons where studio_id=p_studio and id=p_lesson;
  if not found then return false; end if;
  update calendar_review_internal.observations
    set occurrences=occurrences+1,last_seen_at=now()
    where studio_id=p_studio and lesson_id=p_lesson
      and fingerprint=calendar_review_internal.fingerprint(lesson,p_event);
  return found;
end $$;
revoke all on function public.observe_existing_calendar_conflict(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.observe_existing_calendar_conflict(uuid,uuid,jsonb) to service_role;
