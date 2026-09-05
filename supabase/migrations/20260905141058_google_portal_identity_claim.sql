-- Allow an authenticated person to claim only portal records whose normalized
-- email exactly matches the verified email on their Supabase Auth identity.
-- The browser cannot call this function: a server endpoint validates the
-- session and invokes it with the service role.
create or replace function public.claim_portal_access_by_verified_email(
  target_user uuid,
  target_email text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized_email text := lower(trim(target_email));
  verified_email text;
  display_name text;
  student_matches integer := 0;
  contact_matches integer := 0;
  coach_matches integer := 0;
  owned_students integer := 0;
  related_students integer := 0;
  resolved_role text;
begin
  select lower(trim(u.email)),
         coalesce(nullif(trim(u.raw_user_meta_data->>'full_name'), ''), split_part(lower(trim(u.email)), '@', 1))
    into verified_email, display_name
  from auth.users u
  where u.id = target_user
    and u.email_confirmed_at is not null;

  if verified_email is null
     or normalized_email = ''
     or verified_email <> normalized_email then
    raise exception 'FORBIDDEN:VERIFIED_EMAIL_REQUIRED';
  end if;

  -- Coach authorization continues to come only from the studio's protected
  -- coach-email configuration. Google profile metadata is display-only.
  insert into public.memberships (studio_id, user_id, role, display_name)
  select s.id, target_user, 'coach', display_name
  from public.studios s
  where jsonb_typeof(coalesce(s.settings->'coachEmails', '[]'::jsonb)) = 'array'
    and exists (
      select 1
      from jsonb_array_elements_text(coalesce(s.settings->'coachEmails', '[]'::jsonb)) configured(email)
      where lower(trim(configured.email)) = verified_email
    )
  on conflict (studio_id, user_id, role) do nothing;

  select count(*)::integer into coach_matches
  from public.memberships m
  where m.user_id = target_user and m.role = 'coach';

  if coach_matches > 0 then
    return jsonb_build_object(
      'role', 'coach',
      'destination', '/coach',
      'studentCount', 0,
      'householdCount', 0,
      'newHouseholdLinks', 0
    );
  end if;

  -- A profile already linked to another auth identity is never taken over,
  -- even when its editable contact email was later changed to the same value.
  if exists (
    select 1 from public.students s
    where s.deleted_at is null
      and s.portal_enabled
      and lower(trim(s.email)) = verified_email
      and s.user_id is not null
      and s.user_id <> target_user
  ) or exists (
    select 1 from public.linked_contacts c
    where c.portal_enabled
      and lower(trim(c.email)) = verified_email
      and c.user_id is not null
      and c.user_id <> target_user
      and exists (
        select 1 from public.students linked_student
        where linked_student.id = c.student_id
          and linked_student.portal_enabled
          and linked_student.deleted_at is null
      )
  ) then
    raise exception 'FORBIDDEN:PORTAL_IDENTITY_CONFLICT';
  end if;

  select count(*)::integer into student_matches
  from public.students s
  where s.deleted_at is null
    and s.portal_enabled
    and lower(trim(s.email)) = verified_email
    and (s.user_id is null or s.user_id = target_user);

  -- Two independent student profiles sharing an email require coach review;
  -- household access is represented by linked_contacts and may intentionally
  -- span more than one student (for example, siblings).
  if student_matches > 1 and not exists (
    select 1 from public.students s
    where s.deleted_at is null
      and s.portal_enabled
      and lower(trim(s.email)) = verified_email
      and s.user_id = target_user
  ) then
    raise exception 'FORBIDDEN:AMBIGUOUS_STUDENT_EMAIL';
  end if;

  if student_matches = 1 then
    update public.students s
    set user_id = target_user,
        version = s.version + 1,
        updated_at = now()
    where s.deleted_at is null
      and s.portal_enabled
      and lower(trim(s.email)) = verified_email
      and s.user_id is null;
  end if;

  with changed as (
    update public.linked_contacts c
    set user_id = target_user,
        version = c.version + 1,
        updated_at = now()
    where c.portal_enabled
      and lower(trim(c.email)) = verified_email
      and c.user_id is null
      and exists (
        select 1 from public.students linked_student
        where linked_student.id = c.student_id
          and linked_student.portal_enabled
          and linked_student.deleted_at is null
      )
    returning c.id
  )
  select count(*)::integer into contact_matches from changed;

  select count(*)::integer into owned_students
  from public.students s
  where s.user_id = target_user
    and s.portal_enabled
    and s.deleted_at is null;

  select count(distinct r.student_id)::integer into related_students
  from public.student_relationships r
  join public.students s on s.id = r.student_id
  where r.user_id = target_user
    and s.portal_enabled
    and s.deleted_at is null;

  if owned_students > 0 then
    resolved_role := 'student';
  elsif related_students > 0 then
    resolved_role := 'guardian';
  else
    raise exception 'FORBIDDEN:PORTAL_PROFILE_NOT_FOUND';
  end if;

  return jsonb_build_object(
    'role', resolved_role,
    'destination', case when resolved_role = 'coach' then '/coach' else '/portal' end,
    'studentCount', owned_students,
    'householdCount', related_students,
    'newHouseholdLinks', contact_matches
  );
end
$$;

revoke all on function public.claim_portal_access_by_verified_email(uuid, text)
  from public, anon, authenticated;
grant execute on function public.claim_portal_access_by_verified_email(uuid, text)
  to service_role;

comment on function public.claim_portal_access_by_verified_email(uuid, text) is
  'Service-only exact-email reconciliation for verified Supabase Auth identities. Client-supplied identity claims are not accepted.';

-- Retire the legacy profile-linking behavior in the auth.users trigger. The
-- trigger now handles coach membership only; student and household claims run
-- after authentication through the guarded function above, where ambiguity
-- and identity conflicts can be reported without breaking OAuth user creation.
create or replace function public.link_stage_story_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  studio public.studios;
begin
  select * into studio from public.studios where slug = 'stage-story';
  if studio.id is null or new.email is null then return new; end if;
  if jsonb_typeof(coalesce(studio.settings->'coachEmails', '[]'::jsonb)) = 'array'
     and exists (
       select 1
       from jsonb_array_elements_text(coalesce(studio.settings->'coachEmails', '[]'::jsonb)) configured(email)
       where lower(trim(configured.email)) = lower(trim(new.email))
     ) then
    insert into public.memberships (studio_id, user_id, role, display_name)
    values (
      studio.id,
      new.id,
      'coach',
      coalesce(nullif(trim(new.raw_user_meta_data->>'full_name'), ''), split_part(lower(trim(new.email)), '@', 1))
    )
    on conflict (studio_id, user_id, role) do nothing;
  end if;
  return new;
end
$$;

revoke all on function public.link_stage_story_user()
  from public, anon, authenticated;
