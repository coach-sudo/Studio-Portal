-- Stage & Story production configuration. Business rules live in data so the
-- coach can change them without a deploy; bookings retain their own snapshots.

alter table public.booking_services
  add column if not exists deposit_type text not null default 'none'
    check (deposit_type in ('none','fixed','percentage','full')),
  add column if not exists deposit_percentage numeric(5,2)
    check (deposit_percentage is null or deposit_percentage between 0 and 100),
  add column if not exists balance_due_timing text not null default 'at_booking'
    check (balance_due_timing in ('at_booking','before_start','manual')),
  add column if not exists balance_due_hours integer
    check (balance_due_hours is null or balance_due_hours >= 0),
  add column if not exists auto_charge_balance boolean not null default false,
  add column if not exists buffer_by_location jsonb not null default '{}',
  add column if not exists policy_version integer not null default 1
    check (policy_version > 0);

alter table public.booking_services drop constraint if exists booking_services_deposit_configuration;
alter table public.booking_services add constraint booking_services_deposit_configuration check (
  (deposit_type = 'none' and deposit_minor = 0 and deposit_percentage is null)
  or (deposit_type = 'fixed' and deposit_minor > 0 and deposit_percentage is null)
  or (deposit_type = 'percentage' and deposit_percentage > 0 and deposit_percentage <= 100)
  or (deposit_type = 'full')
);

alter table public.recurring_series
  drop constraint if exists recurring_series_cadence_check;
alter table public.recurring_series
  add constraint recurring_series_cadence_check check(cadence in ('weekly','biweekly','custom')),
  add column if not exists recurrence_rule jsonb not null default '{"intervalWeeks":1,"slots":[]}',
  add column if not exists student_can_modify boolean not null default false,
  add column if not exists price_minor bigint check(price_minor is null or price_minor >= 0),
  add column if not exists discount_minor bigint not null default 0 check(discount_minor >= 0),
  add column if not exists meeting_provider text check(meeting_provider in ('google_meet','in_person')),
  add column if not exists paused_at timestamptz;

alter table public.bookings
  add column if not exists pricing_snapshot jsonb not null default '{}',
  add column if not exists balance_due_at timestamptz,
  add column if not exists auto_charge_balance boolean not null default false,
  add column if not exists admin_override jsonb not null default '{}';

alter table public.students
  add column if not exists timezone text not null default 'America/New_York',
  add column if not exists internal_notes text not null default '',
  add column if not exists default_duration_minutes integer check(default_duration_minutes in (30,60,90)),
  add column if not exists default_meeting_provider text check(default_meeting_provider in ('google_meet','in_person')),
  add column if not exists default_rate_minor bigint check(default_rate_minor is null or default_rate_minor >= 0),
  add column if not exists account_balance_minor bigint not null default 0;

create table if not exists public.package_definitions (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios(id) on delete cascade,
  name text not null,
  description text not null default '',
  session_count integer not null check(session_count > 0),
  session_duration_minutes integer not null check(session_duration_minutes between 15 and 480),
  price_minor bigint not null check(price_minor >= 0),
  discount_minor bigint not null default 0 check(discount_minor >= 0),
  currency text not null default 'USD' check(char_length(currency) = 3),
  expiration_days integer check(expiration_days is null or expiration_days > 0),
  eligible_service_ids uuid[] not null default '{}',
  meeting_providers text[] not null default array['google_meet','in_person'],
  recurring_eligible boolean not null default true,
  visibility text not null default 'private' check(visibility in ('public','private')),
  direct_purchase boolean not null default false,
  stripe_price_id text,
  active boolean not null default true,
  version integer not null default 1 check(version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(studio_id,name)
);

alter table public.packages
  add column if not exists definition_id uuid references public.package_definitions(id) on delete set null;

create table if not exists public.student_pricing_rules (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  service_id uuid references public.booking_services(id) on delete cascade,
  price_minor bigint not null check(price_minor >= 0),
  reason text not null,
  starts_at timestamptz not null default now(),
  ends_at timestamptz,
  active boolean not null default true,
  version integer not null default 1 check(version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check(ends_at is null or ends_at > starts_at)
);

create unique index if not exists student_pricing_rules_active_unique
  on public.student_pricing_rules(student_id,service_id)
  where active and ends_at is null;
create index if not exists package_definitions_studio_active_idx
  on public.package_definitions(studio_id,active,visibility);
create index if not exists student_pricing_rules_studio_student_idx
  on public.student_pricing_rules(studio_id,student_id);

create table if not exists public.booking_admin_overrides (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios(id) on delete cascade,
  booking_id uuid references public.bookings(id) on delete cascade,
  student_id uuid references public.students(id) on delete cascade,
  override_type text not null check(override_type in ('notice','price','deposit','balance_due','cancellation','refund','credit','schedule','policy')),
  value jsonb not null,
  reason text not null,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  check(booking_id is not null or student_id is not null)
);
create index if not exists booking_admin_overrides_booking_idx on public.booking_admin_overrides(booking_id);
create index if not exists booking_admin_overrides_student_idx on public.booking_admin_overrides(student_id);

alter table public.package_definitions enable row level security;
alter table public.student_pricing_rules enable row level security;
alter table public.booking_admin_overrides enable row level security;

create policy package_definitions_coach on public.package_definitions for all to authenticated
  using(public.is_studio_coach(studio_id)) with check(public.is_studio_coach(studio_id));
create policy student_pricing_rules_coach on public.student_pricing_rules for all to authenticated
  using(public.is_studio_coach(studio_id)) with check(public.is_studio_coach(studio_id));
create policy student_pricing_rules_student_read on public.student_pricing_rules for select to authenticated
  using(public.can_view_student_finance(student_id));
create policy booking_admin_overrides_coach on public.booking_admin_overrides for all to authenticated
  using(public.is_studio_coach(studio_id)) with check(public.is_studio_coach(studio_id));

revoke all on public.package_definitions, public.student_pricing_rules, public.booking_admin_overrides from anon;
grant select,insert,update,delete on public.package_definitions, public.student_pricing_rules, public.booking_admin_overrides to authenticated;

insert into public.studios(id,name,slug,timezone,settings)
values(
  '11111111-1111-4111-8111-111111111111',
  'Stage & Story',
  'stage-story',
  'America/New_York',
  '{
    "studioName":"Stage & Story",
    "studioTagline":"Private acting coaching with Darius A. Journigan",
    "coachName":"Darius A. Journigan",
    "coachTitle":"Acting Coach",
    "contactEmail":"coach@d-a-j.com",
    "contactPhone":"",
    "timezone":"America/New_York",
    "currency":"USD",
    "bookingUrl":"https://portal.d-a-j.com/book",
    "portalLabel":"My Studio",
    "welcomeMessage":"Everything for your coaching work, in one calm place.",
    "showContactButtons":true,
    "showBookingButton":true,
    "showDriveFolder":true,
    "reminderHours":[72,24,2],
    "lessonRatesMinor":{"30":3500,"60":5000,"90":7200,"intro":3500},
    "bookingDefaults":{"minimumNoticeHours":72,"bookingHorizonDays":90,"cancellationWindowHours":24,"bufferBeforeMinutes":0,"bufferAfterMinutes":0,"recurringHorizonWeeks":12},
    "meetingFormats":{"google_meet":{"enabled":true,"label":"Google Meet"},"in_person":{"enabled":true,"label":"In person","location":""}},
    "coachEmails":["coach@d-a-j.com"]
  }'::jsonb
)
on conflict(slug) do update set name=excluded.name,timezone=excluded.timezone,settings=public.studios.settings||excluded.settings,updated_at=now();

insert into public.booking_services(
  studio_id,slug,name,description,category,duration_minutes,price_minor,deposit_minor,
  deposit_type,currency,capacity,location_options,default_location,recurrence_options,
  payment_policies,buffer_before_minutes,buffer_after_minutes,minimum_notice_hours,
  booking_horizon_days,slot_interval_minutes,policy,published
)
select s.id,v.slug,v.name,v.description,'private',v.duration,v.price,0,'none','USD',1,
  array['google_meet','in_person'], 'google_meet', array['none','weekly','biweekly'],
  array['pay_now','pay_later','credits','subscription'],0,0,72,90,30,
  '{"cancellationWindowHours":24,"rescheduleLimit":1,"settlement":"original_payment","lateSettlement":"none"}'::jsonb,true
from public.studios s
cross join (values
  ('private-acting-coaching-30','30-Minute Private Acting Coaching','A focused one-on-one acting session for audition preparation, self-tapes, monologues, scene work, script analysis, character development, or continued acting training.',30,3500::bigint),
  ('private-acting-coaching-60','60-Minute Private Acting Coaching','A full private coaching session with time for technique work, rehearsal, adjustments, exploration, and detailed feedback.',60,5000::bigint),
  ('private-acting-coaching-90','90-Minute Private Acting Coaching','An extended private coaching session for intensive audition work, multiple scenes, character development, script analysis, or longer-form technique training.',90,7200::bigint)
) as v(slug,name,description,duration,price)
where s.slug='stage-story'
on conflict(studio_id,slug) do update set
  name=excluded.name,description=excluded.description,duration_minutes=excluded.duration_minutes,
  price_minor=excluded.price_minor,location_options=excluded.location_options,
  recurrence_options=excluded.recurrence_options,minimum_notice_hours=excluded.minimum_notice_hours,
  booking_horizon_days=excluded.booking_horizon_days,published=true,updated_at=now();

create or replace function public.link_stage_story_user()
returns trigger language plpgsql security definer set search_path='' as $$
declare studio public.studios; student public.students;
begin
  select * into studio from public.studios where slug='stage-story';
  if studio.id is null or new.email is null then return new; end if;
  if exists(select 1 from jsonb_array_elements_text(coalesce(studio.settings->'coachEmails','[]'::jsonb)) e where lower(e)=lower(new.email)) then
    insert into public.memberships(studio_id,user_id,role,display_name)
    values(studio.id,new.id,'coach',coalesce(new.raw_user_meta_data->>'full_name','Darius'))
    on conflict(studio_id,user_id,role) do nothing;
  end if;
  update public.students set user_id=new.id,updated_at=now()
  where studio_id=studio.id and lower(email)=lower(new.email) and user_id is null
  returning * into student;
  if student.id is null then
    select * into student from public.students where studio_id=studio.id and lower(guardian_email)=lower(new.email) limit 1;
    if student.id is not null then
      insert into public.student_relationships(student_id,user_id,relationship,can_view_finance,can_manage_profile)
      values(student.id,new.id,'guardian',true,true) on conflict(student_id,user_id) do nothing;
    end if;
  end if;
  return new;
end $$;
revoke all on function public.link_stage_story_user() from public,anon,authenticated;
drop trigger if exists on_auth_user_stage_story_link on auth.users;
create trigger on_auth_user_stage_story_link after insert or update of email on auth.users
for each row execute function public.link_stage_story_user();

-- Link an already-created coach Auth user when this migration is applied.
insert into public.memberships(studio_id,user_id,role,display_name)
select s.id,u.id,'coach',coalesce(u.raw_user_meta_data->>'full_name','Darius')
from public.studios s join auth.users u on lower(u.email)='coach@d-a-j.com'
where s.slug='stage-story'
on conflict(studio_id,user_id,role) do nothing;
