-- Repair household lifecycle, persist inbox read/draft state, and keep future
-- attendee/contact projections aligned without deleting historical records.

alter table public.linked_contacts
  add column if not exists portal_preferences jsonb not null default '{"appearance":"light"}'::jsonb;

insert into public.linked_contacts (
  studio_id, student_id, full_name, email, relationship_type,
  relationship_label, can_view_schedule, can_manage_lessons, can_view_work,
  can_manage_profile, can_view_finance, can_receive_notifications,
  notification_preferences, portal_enabled
)
select
  s.studio_id, s.id, coalesce(nullif(trim(s.guardian_name), ''), 'Guardian'),
  lower(trim(s.guardian_email)), 'guardian', 'Parent or guardian', true, true,
  true, true, true, true,
  coalesce(s.notification_preferences, '{}'::jsonb), false
from public.students s
where nullif(trim(s.guardian_email), '') is not null
on conflict (student_id, (lower(email))) do update
set full_name = case
      when trim(public.linked_contacts.full_name) = '' then excluded.full_name
      else public.linked_contacts.full_name
    end,
    relationship_type = 'guardian',
    relationship_label = coalesce(nullif(public.linked_contacts.relationship_label, ''), 'Parent or guardian'),
    updated_at = now();

create table if not exists public.conversation_states (
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  last_read_at timestamptz,
  draft_body text not null default '' check (char_length(draft_body) <= 4000),
  updated_at timestamptz not null default now(),
  primary key (conversation_id, user_id)
);

create index if not exists conversation_states_user_recent_idx
  on public.conversation_states(user_id, updated_at desc);
create index if not exists conversation_states_user_drafts_idx
  on public.conversation_states(user_id, updated_at desc)
  where draft_body <> '';

alter table public.conversation_states enable row level security;
drop policy if exists conversation_states_owner_read on public.conversation_states;
create policy conversation_states_owner_read on public.conversation_states
  for select to authenticated using ((select auth.uid()) = user_id);

revoke all on public.conversation_states from anon;
revoke insert, update, delete on public.conversation_states from authenticated;
grant select on public.conversation_states to authenticated;
grant all on public.conversation_states to service_role;

create or replace function public.sync_future_contact_details(
  p_student_id uuid,
  p_old_email text,
  p_new_email text,
  p_old_name text,
  p_new_name text,
  p_old_phone text default null,
  p_new_phone text default null,
  p_contact_kind text default 'student'
) returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  affected_lessons uuid[];
  affected_count integer := 0;
begin
  select coalesce(array_agg(distinct l.id), '{}'::uuid[])
    into affected_lessons
  from public.lessons l
  join public.lesson_participants lp on lp.lesson_id = l.id
  where lp.student_id = p_student_id
    and l.starts_at >= now()
    and l.status = 'scheduled';

  update public.lesson_participants lp
  set email = case
        when nullif(trim(p_old_email), '') is not null
         and lower(lp.email) = lower(trim(p_old_email))
        then lower(trim(p_new_email)) else lp.email end,
      display_name = case
        when p_contact_kind = 'student'
         and nullif(trim(p_new_name), '') is not null
         and (lp.display_name = p_old_name or lp.student_id = p_student_id)
        then trim(p_new_name) else lp.display_name end
  where lp.student_id = p_student_id
    and lp.lesson_id = any(affected_lessons);

  update public.bookings b
  set guest_name = case
        when p_contact_kind = 'student' and b.guest_name = p_old_name
        then coalesce(nullif(trim(p_new_name), ''), b.guest_name) else b.guest_name end,
      guest_email = case
        when nullif(trim(p_old_email), '') is not null and lower(b.guest_email) = lower(trim(p_old_email))
        then lower(trim(p_new_email)) else b.guest_email end,
      guest_phone = case
        when nullif(trim(p_old_phone), '') is not null and b.guest_phone = p_old_phone
        then nullif(trim(p_new_phone), '') else b.guest_phone end,
      guardian_name = case
        when p_contact_kind = 'household' and b.guardian_name = p_old_name
        then coalesce(nullif(trim(p_new_name), ''), b.guardian_name) else b.guardian_name end,
      guardian_email = case
        when p_contact_kind = 'household' and nullif(trim(p_old_email), '') is not null
         and lower(coalesce(b.guardian_email, '')) = lower(trim(p_old_email))
        then lower(trim(p_new_email)) else b.guardian_email end,
      version = b.version + 1,
      updated_at = now()
  where b.student_id = p_student_id
    and b.starts_at >= now()
    and b.status not in ('cancelled', 'late_cancelled', 'expired', 'completed');

  if nullif(trim(p_old_email), '') is not null and nullif(trim(p_new_email), '') is not null then
    update public.outbox_messages
    set recipient = lower(trim(p_new_email)), updated_at = now(), version = version + 1
    where student_id = p_student_id
      and lower(recipient) = lower(trim(p_old_email))
      and status in ('draft', 'approved', 'queued', 'failed')
      and coalesce(send_at, now()) >= now();
  end if;

  insert into public.calendar_projections (lesson_id, status, projected_version, attempts, next_attempt_at, last_error)
  select unnest(affected_lessons), 'queued', 0, 0, null, null
  on conflict (lesson_id) do update
  set status = 'queued', projected_version = 0, attempts = 0,
      next_attempt_at = null, last_error = null;

  affected_count := coalesce(array_length(affected_lessons, 1), 0);
  return affected_count;
end;
$$;

revoke all on function public.sync_future_contact_details(uuid,text,text,text,text,text,text,text)
  from public, anon, authenticated;
grant execute on function public.sync_future_contact_details(uuid,text,text,text,text,text,text,text)
  to service_role;

comment on table public.conversation_states is
  'Per-user read position and draft for the unified inbox.';
comment on function public.sync_future_contact_details(uuid,text,text,text,text,text,text,text) is
  'Service-only propagation of changed student or household contact details to future bookings, reminders, participants, and Calendar projections.';
