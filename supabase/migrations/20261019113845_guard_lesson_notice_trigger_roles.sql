-- Additive defense for managed Supabase default table grants; no grant changes.
create or replace function lesson_ops.notice_effect(m public.outbox_messages) returns uuid
language plpgsql stable security definer set search_path='' as $$
declare effect_id uuid; candidates uuid[]; version_token text; scoped_booking uuid; notice_kind text;
begin
  -- PostgREST retains the original SET ROLE in this GUC inside a definer.
  -- Public table grants must not let a BEFORE trigger become a private lookup
  -- oracle before the later RLS WITH CHECK rejects the insert.
  if coalesce(current_setting('role',true),'') not in ('none','postgres','supabase_admin','service_role') then
    raise insufficient_privilege using message='permission denied for lesson change notification';
  end if;
  if coalesce(m.event_key,'') not in ('lesson.cancelled.student','lesson.cancelled.coach','lesson.rescheduled.student','lesson.rescheduled.coach')
     or m.lesson_id is null then return null; end if;
  notice_kind:=split_part(m.event_key,'.',2);
  if nullif(m.entity_snapshot->>'changeId','') is not null then
    effect_id:=(m.entity_snapshot->>'changeId')::uuid;
  else
    -- Only the exact legacy producer grammar is eligible for compatibility.
    version_token:=split_part(coalesce(m.dedupe_key,''),':',3);
    if version_token !~ '^[1-9][0-9]{0,9}$' then return null; end if;
    if split_part(m.dedupe_key,':',5) not in ('student','coach') then
      scoped_booking:=split_part(m.dedupe_key,':',5)::uuid;
    end if;
    if m.dedupe_key <> ('lesson:'||m.lesson_id::text||':'||version_token||':'||notice_kind||
      case when scoped_booking is null then '' else ':'||scoped_booking::text end||
      case when m.event_key like '%.student' then ':student:'||m.recipient else ':coach' end) then
      raise exception 'INVALID_NOTIFICATION_IDENTITY';
    end if;
  end if;
  select array_agg(e.id order by e.id) into candidates from lesson_ops.effects e
    join public.lessons l on l.id=e.lesson_id
    where e.lesson_id=m.lesson_id and l.studio_id=m.studio_id and e.kind=notice_kind
      and (effect_id is null or e.id=effect_id)
      and (effect_id is not null or e.lesson_version::bigint=version_token::bigint)
      and (scoped_booking is null or e.booking_id=scoped_booking)
      and (e.snapshot->>'startsAt')::timestamptz=(m.entity_snapshot->>'startsAt')::timestamptz
      and (e.snapshot->>'endsAt')::timestamptz=(m.entity_snapshot->>'endsAt')::timestamptz
      and (e.booking_id is null or e.booking_id=m.booking_id)
      and (m.student_id is null or m.student_id=any(e.student_ids))
      and (m.event_key like '%.coach' or m.student_id is not null or exists(
        select 1 from public.lesson_participants p where p.id=any(e.participant_ids)
          and p.lesson_id=e.lesson_id and p.student_id is null and p.booking_id=m.booking_id));
  if coalesce(cardinality(candidates),0)=1 then return candidates[1]; end if;
  -- A legacy-only historical event with no durable effects retains its old key.
  -- Stale/ambiguous post-migration producers fail closed; their durable effect
  -- remains available to the current worker. Never guess a more recent event.
  if effect_id is not null or exists(select 1 from lesson_ops.effects e where e.lesson_id=m.lesson_id) then
    raise exception 'INVALID_NOTIFICATION_IDENTITY: authoritative occurrence required';
  end if;
  return null;
end $$;
revoke all on function lesson_ops.notice_effect(public.outbox_messages) from public,anon,authenticated,service_role;

