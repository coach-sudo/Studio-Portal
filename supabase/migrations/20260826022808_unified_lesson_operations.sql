alter table public.lessons
  add column if not exists preparation jsonb not null default '{"planned":false,"setupReady":false,"materialsReady":false}'::jsonb;

alter table public.packages
  add column if not exists auto_apply boolean not null default false;

alter table public.outbox_messages
  add column if not exists lesson_id uuid references public.lessons(id) on delete set null,
  add column if not exists correlation_id text;

alter table public.calendar_projections
  add column if not exists attempts integer not null default 0,
  add column if not exists next_attempt_at timestamptz;

alter table public.package_credit_entries
  add column if not exists reverses_entry_id uuid unique references public.package_credit_entries(id) on delete restrict;

create index if not exists outbox_messages_lesson_status_idx
  on public.outbox_messages(lesson_id,status,send_at);
create index if not exists packages_auto_apply_idx
  on public.packages(student_id,expires_at) where auto_apply;

create or replace function public.command_change_lesson_state(
  p_lesson_id uuid,
  p_expected_version integer,
  p_action text,
  p_starts_at timestamptz default null,
  p_ends_at timestamptz default null,
  p_queue_calendar boolean default true
) returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  current_lesson public.lessons%rowtype;
  changed_lesson public.lessons%rowtype;
  linked_booking_id uuid;
  debit record;
begin
  if p_action not in ('reschedule','cancel') then
    raise exception 'VALIDATION_FAILED: Unsupported lesson change';
  end if;

  select * into current_lesson
  from public.lessons
  where id=p_lesson_id
  for update;

  if not found then raise exception 'NOT_FOUND'; end if;
  if current_lesson.version <> p_expected_version then
    raise exception 'VERSION_CONFLICT:%', p_expected_version;
  end if;

  select booking_id into linked_booking_id
  from public.lesson_participants
  where lesson_id=p_lesson_id and booking_id is not null
  order by created_at
  limit 1;

  if p_action='reschedule' then
    if current_lesson.status <> 'scheduled' then
      raise exception 'VALIDATION_FAILED: Only scheduled lessons can be rescheduled';
    end if;
    if p_starts_at is null or p_ends_at is null or p_ends_at <= p_starts_at then
      raise exception 'VALIDATION_FAILED: A valid lesson time is required';
    end if;
    update public.lessons
      set starts_at=p_starts_at,ends_at=p_ends_at,version=version+1,updated_at=now()
      where id=p_lesson_id
      returning * into changed_lesson;
    if linked_booking_id is not null then
      update public.bookings
      set starts_at=p_starts_at,ends_at=p_ends_at,reschedule_count=reschedule_count+1,
          version=version+1,updated_at=now()
      where id=linked_booking_id;
    end if;
  else
    update public.lessons
      set status='cancelled',version=version+1,updated_at=now()
      where id=p_lesson_id
      returning * into changed_lesson;
    update public.lesson_participants set status='cancelled'
      where lesson_id=p_lesson_id and status in ('reserved','confirmed');
    if linked_booking_id is not null then
      update public.bookings
      set status='cancelled',version=version+1,updated_at=now()
      where id=linked_booking_id and status not in ('cancelled','late_cancelled','completed');
    end if;
    for debit in
      select * from public.package_credit_entries
      where lesson_id=p_lesson_id and quantity < 0
      order by created_at
    loop
      insert into public.package_credit_entries(
        package_id,lesson_id,kind,quantity,reason,idempotency_key,reverses_entry_id
      ) values(
        debit.package_id,p_lesson_id,'release',abs(debit.quantity),
        'Credit restored after lesson cancellation',
        'lesson-credit-release:'||debit.id::text,debit.id
      ) on conflict(idempotency_key) do nothing;
    end loop;
  end if;

  update public.outbox_messages
    set status='cancelled',updated_at=now()
    where status in ('draft','approved','queued','failed')
      and event_key='booking.reminder.student'
      and (lesson_id=p_lesson_id or booking_id=linked_booking_id);

  if p_queue_calendar then
    insert into public.calendar_projections(lesson_id,status,last_error,next_attempt_at)
    values(p_lesson_id,'queued',null,now())
    on conflict(lesson_id) do update
      set status='queued',last_error=null,next_attempt_at=now(),attempts=0;
  end if;

  return jsonb_build_object(
    'lesson',to_jsonb(changed_lesson),
    'bookingId',linked_booking_id,
    'action',p_action
  );
end $$;

revoke all on function public.command_change_lesson_state(uuid,integer,text,timestamptz,timestamptz,boolean)
  from public,anon,authenticated;
grant execute on function public.command_change_lesson_state(uuid,integer,text,timestamptz,timestamptz,boolean)
  to service_role;

create or replace function public.reserve_package_credit_for_lesson(
  p_lesson_id uuid,
  p_package_id uuid default null,
  p_reason text default 'Automatically applied to upcoming lesson'
) returns uuid
language plpgsql
security definer
set search_path=''
as $$
declare
  target_lesson public.lessons%rowtype;
  target_package public.packages%rowtype;
begin
  select * into target_lesson from public.lessons where id=p_lesson_id for update;
  if not found or target_lesson.status <> 'scheduled' then return null; end if;
  if exists(select 1 from public.package_credit_entries where lesson_id=p_lesson_id and quantity < 0) then
    return target_lesson.package_id;
  end if;
  if exists(
    select 1 from public.lesson_participants lp
    join public.bookings b on b.id=lp.booking_id
    where lp.lesson_id=p_lesson_id
      and b.payment_status in ('paid','partially_paid')
  ) then return null; end if;

  select p.* into target_package
  from public.packages p
  where p.student_id=target_lesson.student_id
    and p.auto_apply
    and (p_package_id is null or p.id=p_package_id)
    and (p.expires_at is null or p.expires_at > target_lesson.starts_at)
    and public.package_credit_balance(p.id) > 0
    and (
      p.definition_id is null or exists(
        select 1 from public.package_definitions d
        where d.id=p.definition_id and d.active
          and (cardinality(d.eligible_service_ids)=0 or target_lesson.service_id=any(d.eligible_service_ids))
          and d.session_duration_minutes=(extract(epoch from (target_lesson.ends_at-target_lesson.starts_at))/60)::integer
          and target_lesson.meeting_provider::text=any(d.meeting_providers)
      )
    )
  order by p.expires_at nulls last,p.created_at
  for update skip locked
  limit 1;

  if not found then return null; end if;
  insert into public.package_credit_entries(
    package_id,lesson_id,kind,quantity,reason,idempotency_key
  ) values(
    target_package.id,p_lesson_id,'reservation',-1,p_reason,
    'auto-credit:lesson:'||p_lesson_id::text
  ) on conflict(idempotency_key) do nothing;
  update public.lessons set package_id=target_package.id,updated_at=now()
    where id=p_lesson_id;
  return target_package.id;
end $$;

revoke all on function public.reserve_package_credit_for_lesson(uuid,uuid,text)
  from public,anon,authenticated;
grant execute on function public.reserve_package_credit_for_lesson(uuid,uuid,text)
  to service_role;

create or replace function public.claim_calendar_projections(batch_size integer default 10)
returns table(projection jsonb,lesson jsonb)
language plpgsql
security definer
set search_path=''
as $$
begin
  return query with claimed as (
    select p.id from public.calendar_projections p
    where p.status in ('queued','failed')
      and coalesce(p.next_attempt_at,now())<=now()
      and p.attempts < 12
    order by coalesce(p.next_attempt_at,now()),p.id
    for update skip locked limit batch_size
  ), updated as (
    update public.calendar_projections p
      set status='projecting',attempts=attempts+1
    from claimed where p.id=claimed.id returning p.*
  ) select to_jsonb(u),to_jsonb(l)
    from updated u join public.lessons l on l.id=u.lesson_id;
end $$;

revoke all on function public.claim_calendar_projections(integer) from public,anon,authenticated;
grant execute on function public.claim_calendar_projections(integer) to service_role;
