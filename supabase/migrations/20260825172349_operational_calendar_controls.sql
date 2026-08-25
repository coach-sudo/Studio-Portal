set lock_timeout = '5s';

alter table public.students
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by uuid references auth.users(id) on delete set null;

create index if not exists students_active_studio_idx
  on public.students (studio_id, status, full_name)
  where deleted_at is null;

alter table public.recurring_series alter column service_id drop not null;

create or replace function public.command_make_lesson_recurring(
  p_lesson_id uuid,
  p_expected_version integer,
  p_cadence text,
  p_occurrence_count integer,
  p_timezone text
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  base public.lessons%rowtype;
  created_series public.recurring_series%rowtype;
  created_lesson public.lessons%rowtype;
  interval_days integer;
  i integer;
  local_start timestamp;
  local_end timestamp;
begin
  if p_cadence not in ('weekly', 'biweekly') or p_occurrence_count < 2 or p_occurrence_count > 52 then
    raise exception 'VALIDATION_FAILED: Choose weekly or biweekly and 2–52 occurrences.';
  end if;

  select * into base from public.lessons where id = p_lesson_id for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if base.version <> p_expected_version then raise exception 'VERSION_CONFLICT:%', p_expected_version; end if;
  if base.status <> 'scheduled' then raise exception 'INVALID_TRANSITION: Only scheduled lessons can become recurring.'; end if;
  if base.series_id is not null then raise exception 'INVALID_TRANSITION: This lesson already belongs to a series.'; end if;

  interval_days := case when p_cadence = 'biweekly' then 14 else 7 end;
  insert into public.recurring_series (
    studio_id, service_id, student_id, kind, cadence, status, starts_on,
    occurrence_count, payment_policy, recurrence_rule, meeting_provider
  ) values (
    base.studio_id, base.service_id, base.student_id, 'fixed', p_cadence, 'active', base.starts_at,
    p_occurrence_count, 'pay_later',
    jsonb_build_object('intervalWeeks', case when p_cadence = 'biweekly' then 2 else 1 end,
      'slots', jsonb_build_array(jsonb_build_object('weekday', extract(dow from base.starts_at at time zone p_timezone)::integer,
      'time', to_char(base.starts_at at time zone p_timezone, 'HH24:MI')))),
    base.meeting_provider
  ) returning * into created_series;

  update public.lessons
  set series_id = created_series.id, version = version + 1, updated_at = now()
  where id = base.id;
  insert into public.calendar_projections (lesson_id, status)
  values (base.id, 'queued') on conflict (lesson_id) do update set status = 'queued', last_error = null;

  local_start := base.starts_at at time zone p_timezone;
  local_end := base.ends_at at time zone p_timezone;
  for i in 1..p_occurrence_count - 1 loop
    insert into public.lessons (
      studio_id, student_id, topic, starts_at, ends_at, status, location_type, location_label,
      join_url, package_id, service_id, series_id, meeting_provider, capacity, source_provider
    ) values (
      base.studio_id, base.student_id, base.topic,
      (local_start + make_interval(days => interval_days * i)) at time zone p_timezone,
      (local_end + make_interval(days => interval_days * i)) at time zone p_timezone,
      'scheduled', base.location_type, base.location_label, null, base.package_id,
      base.service_id, created_series.id, base.meeting_provider, base.capacity, 'studio'
    ) returning * into created_lesson;

    insert into public.lesson_participants (lesson_id, booking_id, student_id, display_name, email, status)
      select created_lesson.id, null, student_id, display_name, email, status
      from public.lesson_participants where lesson_id = base.id;
    insert into public.calendar_projections (lesson_id, status) values (created_lesson.id, 'queued');
  end loop;

  return jsonb_build_object('seriesId', created_series.id, 'occurrenceCount', p_occurrence_count);
end;
$$;

revoke all on function public.command_make_lesson_recurring(uuid, integer, text, integer, text) from public, anon, authenticated;
grant execute on function public.command_make_lesson_recurring(uuid, integer, text, integer, text) to service_role;
