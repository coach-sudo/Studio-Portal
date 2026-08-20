create extension if not exists btree_gist;

create table if not exists public.booking_services (
  id uuid primary key default gen_random_uuid(), studio_id uuid not null references public.studios(id) on delete cascade,
  slug text not null, name text not null, description text not null default '', category text not null check(category in ('private','group_class','course')),
  duration_minutes integer not null check(duration_minutes between 15 and 480), price_minor bigint not null default 0 check(price_minor>=0), deposit_minor bigint not null default 0 check(deposit_minor>=0 and deposit_minor<=price_minor), currency text not null default 'USD' check(char_length(currency)=3), capacity integer not null default 1 check(capacity>0),
  location_options text[] not null default array['google_meet'], default_location text not null default 'google_meet' check(default_location in ('google_meet','in_person')),
  recurrence_options text[] not null default array['none'], payment_policies text[] not null default array['pay_now'],
  buffer_before_minutes integer not null default 0 check(buffer_before_minutes>=0), buffer_after_minutes integer not null default 0 check(buffer_after_minutes>=0), minimum_notice_hours integer not null default 24 check(minimum_notice_hours>=0), booking_horizon_days integer not null default 90 check(booking_horizon_days between 1 and 730), slot_interval_minutes integer not null default 30 check(slot_interval_minutes between 5 and 120),
  policy jsonb not null default '{"cancellationWindowHours":24,"rescheduleLimit":1,"settlement":"original_payment","lateSettlement":"none"}', published boolean not null default false,
  version integer not null default 1 check(version>0), created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(studio_id,slug)
);
create table if not exists public.availability_rules (
  id uuid primary key default gen_random_uuid(), studio_id uuid not null references public.studios(id) on delete cascade, service_id uuid references public.booking_services(id) on delete cascade,
  weekday smallint not null check(weekday between 0 and 6), starts_at_local time not null, ends_at_local time not null, timezone text not null default 'America/New_York', active boolean not null default true,
  version integer not null default 1, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), check(ends_at_local>starts_at_local)
);
create table if not exists public.availability_exceptions (
  id uuid primary key default gen_random_uuid(), studio_id uuid not null references public.studios(id) on delete cascade, service_id uuid references public.booking_services(id) on delete cascade,
  starts_at timestamptz not null, ends_at timestamptz not null, kind text not null check(kind in ('unavailable','available')), label text not null default '',
  version integer not null default 1, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), check(ends_at>starts_at)
);
create table if not exists public.service_offerings (
  id uuid primary key default gen_random_uuid(), studio_id uuid not null references public.studios(id) on delete cascade, service_id uuid not null references public.booking_services(id) on delete restrict,
  title text not null, starts_at timestamptz not null, ends_at timestamptz not null, enrollment_closes_at timestamptz not null, capacity integer not null check(capacity>0), enrolled integer not null default 0 check(enrolled>=0 and enrolled<=capacity), lesson_ids uuid[] not null default '{}', published boolean not null default false,
  version integer not null default 1, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), check(ends_at>starts_at)
);
create table if not exists public.recurring_series (
  id uuid primary key default gen_random_uuid(), studio_id uuid not null references public.studios(id) on delete cascade, service_id uuid not null references public.booking_services(id) on delete restrict, student_id uuid references public.students(id) on delete set null,
  kind text not null check(kind in ('fixed','ongoing','course')), cadence text not null check(cadence in ('weekly','biweekly')), status text not null default 'active' check(status in ('active','paused','cancel_at_period_end','cancelled','completed')),
  starts_on timestamptz not null, ends_on timestamptz, occurrence_count integer check(occurrence_count>0), payment_policy text not null, stripe_subscription_id text unique, next_billing_at timestamptz,
  version integer not null default 1, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.bookings (
  id uuid primary key default gen_random_uuid(), studio_id uuid not null references public.studios(id) on delete cascade, reference text not null unique,
  service_id uuid not null references public.booking_services(id) on delete restrict, offering_id uuid references public.service_offerings(id) on delete restrict, series_id uuid references public.recurring_series(id) on delete set null, student_id uuid references public.students(id) on delete set null,
  guest_name text not null, guest_email text not null, guardian_name text, guardian_email text, for_minor boolean not null default false,
  starts_at timestamptz not null, ends_at timestamptz not null, timezone text not null, location text not null check(location in ('google_meet','in_person')),
  status text not null default 'held' check(status in ('held','pending_payment','confirmed','cancelled','late_cancelled','completed','expired','needs_attention')),
  payment_policy text not null check(payment_policy in ('pay_now','pay_later','deposit','credits','installments','subscription')),
  payment_status text not null default 'processing' check(payment_status in ('not_required','due','processing','paid','partially_paid','past_due','refunded','failed')),
  total_minor bigint not null check(total_minor>=0), paid_minor bigint not null default 0 check(paid_minor>=0), currency text not null default 'USD', policy_snapshot jsonb not null,
  reschedule_count integer not null default 0 check(reschedule_count>=0), manage_token_hash text not null unique, stripe_checkout_session_id text unique, stripe_customer_id text, stripe_subscription_id text unique, installment_count integer check(installment_count>0), installments_paid integer not null default 0 check(installments_paid>=0), installment_remainder_minor bigint not null default 0 check(installment_remainder_minor>=0),
  hold_ids uuid[] not null default '{}',
  version integer not null default 1, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), check(ends_at>starts_at)
);
create table if not exists public.booking_holds (
  id uuid primary key default gen_random_uuid(), studio_id uuid not null references public.studios(id) on delete cascade, service_id uuid not null references public.booking_services(id) on delete cascade, offering_id uuid references public.service_offerings(id) on delete cascade,
  starts_at timestamptz not null, ends_at timestamptz not null, quantity integer not null default 1 check(quantity=1), expires_at timestamptz not null default now()+interval '30 minutes', status text not null default 'active' check(status in ('active','converted','expired')), checkout_session_id text unique,
  created_at timestamptz not null default now(), check(ends_at>starts_at)
);
create table if not exists public.lesson_participants (
  id uuid primary key default gen_random_uuid(), lesson_id uuid not null references public.lessons(id) on delete cascade, booking_id uuid references public.bookings(id) on delete set null, student_id uuid references public.students(id) on delete set null,
  display_name text not null, email text not null, status text not null default 'confirmed' check(status in ('reserved','confirmed','cancelled','attended','no_show')), created_at timestamptz not null default now(), unique(lesson_id,email)
);
create table if not exists public.public_endpoint_rate_limits (
  key text primary key, request_count integer not null default 0 check(request_count>=0), window_ends_at timestamptz not null, updated_at timestamptz not null default now()
);

alter table public.lessons alter column student_id drop not null;
alter table public.students add column if not exists guardian_name text;
alter table public.students add column if not exists guardian_email text;
alter table public.lessons add column if not exists service_id uuid references public.booking_services(id) on delete set null;
alter table public.lessons add column if not exists offering_id uuid references public.service_offerings(id) on delete set null;
alter table public.lessons add column if not exists series_id uuid references public.recurring_series(id) on delete set null;
alter table public.lessons add column if not exists meeting_provider text check(meeting_provider in ('google_meet','in_person'));
alter table public.lessons add column if not exists capacity integer not null default 1 check(capacity>0);
alter table public.calendar_projections add column if not exists conference_request_id text;
alter table public.outbox_messages add column if not exists send_at timestamptz not null default now();
alter table public.outbox_messages add column if not exists booking_id uuid references public.bookings(id) on delete set null;

insert into public.lesson_participants(lesson_id,student_id,display_name,email,status)
select l.id,l.student_id,s.full_name,coalesce(s.email,''),'confirmed' from public.lessons l join public.students s on s.id=l.student_id
on conflict(lesson_id,email) do nothing;

alter table public.booking_services enable row level security;
alter table public.availability_rules enable row level security;
alter table public.availability_exceptions enable row level security;
alter table public.service_offerings enable row level security;
alter table public.recurring_series enable row level security;
alter table public.bookings enable row level security;
alter table public.booking_holds enable row level security;
alter table public.lesson_participants enable row level security;
alter table public.public_endpoint_rate_limits enable row level security;
drop policy if exists assignments_student_update on public.assignments;
drop policy if exists actor_profiles_related_write on public.actor_profiles;
create policy booking_services_coach on public.booking_services for all to authenticated using(public.is_studio_coach(studio_id)) with check(public.is_studio_coach(studio_id));
create policy availability_rules_coach on public.availability_rules for all to authenticated using(public.is_studio_coach(studio_id)) with check(public.is_studio_coach(studio_id));
create policy availability_exceptions_coach on public.availability_exceptions for all to authenticated using(public.is_studio_coach(studio_id)) with check(public.is_studio_coach(studio_id));
create policy offerings_coach on public.service_offerings for all to authenticated using(public.is_studio_coach(studio_id)) with check(public.is_studio_coach(studio_id));
create policy series_access on public.recurring_series for select to authenticated using(public.is_studio_coach(studio_id) or (student_id is not null and public.can_access_student(student_id)));
create policy series_coach_write on public.recurring_series for all to authenticated using(public.is_studio_coach(studio_id)) with check(public.is_studio_coach(studio_id));
create policy bookings_access on public.bookings for select to authenticated using(public.is_studio_coach(studio_id) or (student_id is not null and public.can_access_student(student_id)));
create policy bookings_coach_write on public.bookings for all to authenticated using(public.is_studio_coach(studio_id)) with check(public.is_studio_coach(studio_id));
create policy holds_coach on public.booking_holds for select to authenticated using(public.is_studio_coach(studio_id));
create policy participants_access on public.lesson_participants for select to authenticated using((student_id is not null and public.can_access_student(student_id)) or exists(select 1 from public.lessons l where l.id=lesson_id and public.is_studio_coach(l.studio_id)));
create policy participants_coach_write on public.lesson_participants for all to authenticated using(exists(select 1 from public.lessons l where l.id=lesson_id and public.is_studio_coach(l.studio_id))) with check(exists(select 1 from public.lessons l where l.id=lesson_id and public.is_studio_coach(l.studio_id)));
create or replace function public.can_access_lesson(target_lesson uuid,target_student uuid,target_studio uuid) returns boolean language sql stable security definer set search_path='' as $$
  select public.is_studio_coach(target_studio) or (target_student is not null and public.can_access_student(target_student)) or exists(select 1 from public.lesson_participants p where p.lesson_id=target_lesson and p.student_id is not null and public.can_access_student(p.student_id))
$$;
revoke all on function public.can_access_lesson(uuid,uuid,uuid) from public,anon;grant execute on function public.can_access_lesson(uuid,uuid,uuid) to authenticated;
drop policy if exists lessons_access on public.lessons;
create policy lessons_access on public.lessons for select to authenticated using(public.can_access_lesson(id,student_id,studio_id));

create index if not exists booking_services_studio_published_idx on public.booking_services(studio_id,published);
create index if not exists bookings_studio_starts_idx on public.bookings(studio_id,starts_at);
create index if not exists bookings_student_idx on public.bookings(student_id,starts_at);
create index if not exists holds_active_idx on public.booking_holds(studio_id,starts_at,ends_at) where status='active';
create index if not exists participants_student_idx on public.lesson_participants(student_id);
create unique index if not exists lessons_series_occurrence_idx on public.lessons(series_id,starts_at) where series_id is not null;
alter table public.booking_holds add constraint booking_holds_private_overlap exclude using gist (studio_id with =, tstzrange(starts_at,ends_at,'[)') with &&) where (status='active' and offering_id is null);
alter table public.lessons add constraint lessons_private_overlap exclude using gist (studio_id with =, tstzrange(starts_at,ends_at,'[)') with &&) where (status='scheduled' and offering_id is null);

create or replace function public.create_booking_hold(target_service uuid,target_offering uuid,target_start timestamptz,target_end timestamptz)
returns public.booking_holds language plpgsql security definer set search_path='' as $$
declare service public.booking_services; offering public.service_offerings; result public.booking_holds; held integer;
begin
  select * into service from public.booking_services where id=target_service and published=true;
  if service.id is null then raise exception 'SERVICE_NOT_FOUND'; end if;
  perform pg_advisory_xact_lock(hashtext(service.studio_id::text));
  if target_start < now()+make_interval(hours=>service.minimum_notice_hours) or target_end<=target_start then raise exception 'SLOT_UNAVAILABLE'; end if;
  update public.booking_holds set status='expired' where status='active' and expires_at<=now();
  if target_offering is not null then
    select * into offering from public.service_offerings where id=target_offering and service_id=target_service and published=true for update;
    select count(*) into held from public.booking_holds where offering_id=target_offering and status='active' and expires_at>now();
    if offering.id is null or offering.enrolled+held>=offering.capacity then raise exception 'OFFERING_FULL'; end if;
  elsif exists(select 1 from public.lessons l where l.studio_id=service.studio_id and l.status='scheduled' and tstzrange(l.starts_at,l.ends_at,'[)') && tstzrange(target_start-make_interval(mins=>service.buffer_before_minutes),target_end+make_interval(mins=>service.buffer_after_minutes),'[)'))
    or exists(select 1 from public.booking_holds h join public.booking_services hs on hs.id=h.service_id where h.studio_id=service.studio_id and h.status='active' and h.expires_at>now() and h.offering_id is null and tstzrange(h.starts_at-make_interval(mins=>hs.buffer_before_minutes),h.ends_at+make_interval(mins=>hs.buffer_after_minutes),'[)') && tstzrange(target_start-make_interval(mins=>service.buffer_before_minutes),target_end+make_interval(mins=>service.buffer_after_minutes),'[)')) then
    raise exception 'SLOT_UNAVAILABLE';
  end if;
  insert into public.booking_holds(studio_id,service_id,offering_id,starts_at,ends_at) values(service.studio_id,target_service,target_offering,target_start,target_end) returning * into result;
  return result;
end $$;
revoke all on function public.create_booking_hold(uuid,uuid,timestamptz,timestamptz) from public,anon,authenticated;
grant execute on function public.create_booking_hold(uuid,uuid,timestamptz,timestamptz) to service_role;

create or replace function public.create_booking_series_holds(target_service uuid,target_starts timestamptz[])
returns uuid[] language plpgsql security definer set search_path='' as $$
declare service public.booking_services; occurrence_start timestamptz; held public.booking_holds; ids uuid[]:='{}';
begin
  select * into service from public.booking_services where id=target_service and published=true;
  if service.id is null or coalesce(array_length(target_starts,1),0)<2 or array_length(target_starts,1)>52 then raise exception 'VALIDATION_FAILED'; end if;
  perform pg_advisory_xact_lock(hashtext(service.studio_id::text));
  foreach occurrence_start in array target_starts loop
    select * into held from public.create_booking_hold(target_service,null,occurrence_start,occurrence_start+make_interval(mins=>service.duration_minutes));
    ids=array_append(ids,held.id);
  end loop;
  return ids;
end $$;
revoke all on function public.create_booking_series_holds(uuid,timestamptz[]) from public,anon,authenticated;
grant execute on function public.create_booking_series_holds(uuid,timestamptz[]) to service_role;

create or replace function public.expire_booking_holds() returns integer language plpgsql security definer set search_path='' as $$
declare affected integer;
begin update public.booking_holds set status='expired' where status='active' and expires_at<=now(); get diagnostics affected=row_count; return affected; end $$;
revoke all on function public.expire_booking_holds() from public,anon,authenticated; grant execute on function public.expire_booking_holds() to service_role;

create or replace function public.claim_booking_reminders(batch_size integer default 20) returns setof public.outbox_messages language plpgsql security definer set search_path='' as $$
begin
  return query with claimed as (select id from public.outbox_messages where status in ('approved','queued','failed') and send_at<=now() and coalesce(next_attempt_at,now())<=now() order by send_at for update skip locked limit batch_size)
  update public.outbox_messages o set status='sending',attempts=attempts+1,updated_at=now() from claimed where o.id=claimed.id returning o.*;
end $$;
revoke all on function public.claim_booking_reminders(integer) from public,anon,authenticated; grant execute on function public.claim_booking_reminders(integer) to service_role;

create or replace function public.confirm_booking(target_booking uuid,target_hold uuid,amount_paid bigint,provider_reference text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare b public.bookings; service public.booking_services; student public.students; series_record public.recurring_series; lesson_id uuid; occurrence_id uuid; audit_id uuid; credit_package uuid; credit_count integer:=1; occurrence_total integer; idx integer; step_size interval; next_start timestamptz; next_end timestamptz;
begin
  select * into b from public.bookings where id=target_booking for update;
  if b.id is null then raise exception 'BOOKING_NOT_FOUND'; end if;
  if b.status='confirmed' then return jsonb_build_object('bookingId',b.id,'duplicate',true); end if;
  select * into service from public.booking_services where id=b.service_id;
  perform pg_advisory_xact_lock(hashtext(b.studio_id::text));
  if b.offering_id is null and exists(select 1 from public.lessons l where l.studio_id=b.studio_id and l.status='scheduled' and tstzrange(l.starts_at,l.ends_at,'[)') && tstzrange(b.starts_at-make_interval(mins=>service.buffer_before_minutes),b.ends_at+make_interval(mins=>service.buffer_after_minutes),'[)')) then raise exception 'SLOT_UNAVAILABLE'; end if;
  select * into student from public.students where studio_id=b.studio_id and lower(email)=lower(b.guest_email) order by created_at limit 1;
  if student.id is null then
    insert into public.students(studio_id,full_name,email,status,is_minor,guardian_name,guardian_email,portal_enabled)
    values(b.studio_id,b.guest_name,lower(b.guest_email),'lead',b.for_minor,b.guardian_name,b.guardian_email,true) returning * into student;
  end if;
  if b.series_id is not null then select * into series_record from public.recurring_series where id=b.series_id; credit_count=case when series_record.kind='ongoing' then 1 else coalesce(series_record.occurrence_count,1) end; end if;
  if b.payment_policy='credits' then select p.id into credit_package from public.packages p where p.student_id=student.id and public.package_credit_balance(p.id)>=credit_count order by p.expires_at nulls last limit 1 for update; if credit_package is null then raise exception 'CREDIT_UNAVAILABLE'; end if; end if;
  update public.bookings set student_id=student.id,status='confirmed',payment_status=case when payment_policy='credits' then 'paid' when amount_paid>=total_minor then 'paid' when amount_paid>0 then 'partially_paid' when payment_policy='pay_later' then 'due' else payment_status end,paid_minor=amount_paid,version=version+1,updated_at=now() where id=b.id returning * into b;
  update public.booking_holds set status='converted' where id=target_hold or id=any(b.hold_ids);
  if b.offering_id is null then
    insert into public.lessons(studio_id,student_id,topic,starts_at,ends_at,status,location_type,location_label,service_id,series_id,meeting_provider,capacity)
    values(b.studio_id,student.id,service.name,b.starts_at,b.ends_at,'scheduled',case when b.location='in_person' then 'in_person' else 'virtual' end,case when b.location='in_person' then 'Studio' else 'Google Meet' end,b.service_id,b.series_id,b.location,1) returning id into lesson_id;
    insert into public.lesson_participants(lesson_id,booking_id,student_id,display_name,email,status) values(lesson_id,b.id,student.id,b.guest_name,b.guest_email,'confirmed');
    insert into public.calendar_projections(lesson_id,projected_version,status,conference_request_id) values(lesson_id,0,'queued',case when b.location='google_meet' then 'meet-'||lesson_id::text else null end);
    if credit_package is not null then update public.lessons set package_id=credit_package where id=lesson_id; insert into public.package_credit_entries(package_id,lesson_id,kind,quantity,reason,idempotency_key) values(credit_package,lesson_id,'reservation',-credit_count,'Booking reservation '||b.reference,'booking-credit:'||b.id::text); end if;
    if b.series_id is not null then
      select * into series_record from public.recurring_series where id=b.series_id;
      occurrence_total=case when series_record.kind='ongoing' then 12 else coalesce(series_record.occurrence_count,6) end;
      step_size=case when series_record.cadence='biweekly' then interval '14 days' else interval '7 days' end;
      for idx in 1..occurrence_total-1 loop
        next_start=((b.starts_at at time zone b.timezone)+idx*step_size) at time zone b.timezone;
        next_end=next_start+(b.ends_at-b.starts_at);
        if exists(select 1 from public.lessons l where l.studio_id=b.studio_id and l.status='scheduled' and tstzrange(l.starts_at,l.ends_at,'[)') && tstzrange(next_start-make_interval(mins=>service.buffer_before_minutes),next_end+make_interval(mins=>service.buffer_after_minutes),'[)')) then raise exception 'SLOT_UNAVAILABLE'; end if;
        insert into public.lessons(studio_id,student_id,topic,starts_at,ends_at,status,location_type,location_label,service_id,series_id,meeting_provider,capacity)
        values(b.studio_id,student.id,service.name,next_start,next_end,'scheduled',case when b.location='in_person' then 'in_person' else 'virtual' end,case when b.location='in_person' then 'Studio' else 'Google Meet' end,b.service_id,b.series_id,b.location,1) returning id into occurrence_id;
        insert into public.lesson_participants(lesson_id,booking_id,student_id,display_name,email,status) values(occurrence_id,b.id,student.id,b.guest_name,b.guest_email,'confirmed');
        insert into public.calendar_projections(lesson_id,projected_version,status,conference_request_id) values(occurrence_id,0,'queued',case when b.location='google_meet' then 'meet-'||occurrence_id::text else null end);
      end loop;
    end if;
  else
    update public.service_offerings set enrolled=enrolled+1,version=version+1,updated_at=now() where id=b.offering_id and enrolled<capacity returning lesson_ids[1] into lesson_id;
    if lesson_id is null then raise exception 'OFFERING_FULL'; end if;
    foreach occurrence_id in array (select lesson_ids from public.service_offerings where id=b.offering_id) loop
      insert into public.lesson_participants(lesson_id,booking_id,student_id,display_name,email,status) values(occurrence_id,b.id,student.id,b.guest_name,b.guest_email,'confirmed') on conflict(lesson_id,email) do nothing;
    end loop;
  end if;
  if amount_paid>0 then insert into public.payment_entries(student_id,kind,amount_minor,currency,external_reference,reason) values(student.id,'payment',amount_paid,b.currency,provider_reference,'Booking payment '||b.reference) on conflict(external_reference) do nothing; end if;
  insert into public.outbox_messages(studio_id,student_id,booking_id,channel,recipient,subject,body,status,send_at)
  values(b.studio_id,student.id,b.id,'email',coalesce(b.guardian_email,b.guest_email),'Your Stage & Story booking is confirmed',service.name||E'\n'||to_char(b.starts_at at time zone b.timezone,'Dy, Mon DD at HH12:MI AM')||E'\nManage booking: /booking/'||b.reference,'queued',now()),
        (b.studio_id,student.id,b.id,'email',coalesce(b.guardian_email,b.guest_email),'Your lesson is tomorrow',service.name||' begins in 24 hours. Your calendar invitation contains the location and Meet details.','approved',b.starts_at-interval '24 hours'),
        (b.studio_id,student.id,b.id,'email',coalesce(b.guardian_email,b.guest_email),'Your lesson begins soon',service.name||' begins in 2 hours.','approved',b.starts_at-interval '2 hours');
  insert into public.audit_events(studio_id,action,entity_type,entity_id,reason,correlation_id,source,after_state)
  values(b.studio_id,'booking.confirmed','booking',b.id,'Payment or policy requirement satisfied',coalesce(provider_reference,b.reference),'booking_platform',to_jsonb(b)) returning id into audit_id;
  return jsonb_build_object('bookingId',b.id,'studentId',student.id,'lessonId',lesson_id,'auditEventId',audit_id,'duplicate',false);
end $$;
revoke all on function public.confirm_booking(uuid,uuid,bigint,text) from public,anon,authenticated; grant execute on function public.confirm_booking(uuid,uuid,bigint,text) to service_role;

create or replace function public.extend_ongoing_series() returns integer language plpgsql security definer set search_path='' as $$
declare row_data record; last_start timestamptz; next_start timestamptz; next_end timestamptz; step_size interval; lesson_id uuid; created integer:=0;
begin
  for row_data in select s.*,b.id booking_id,b.student_id,b.guest_name,b.guest_email,b.location,b.timezone,b.starts_at booking_start,b.ends_at booking_end,svc.name service_name from public.recurring_series s join public.bookings b on b.series_id=s.id join public.booking_services svc on svc.id=s.service_id where s.kind='ongoing' and s.status='active' and b.payment_status<>'past_due' loop
    perform pg_advisory_xact_lock(hashtext(row_data.id::text));
    select max(starts_at) into last_start from public.lessons where series_id=row_data.id;
    last_start=coalesce(last_start,row_data.booking_start);
    step_size=case when row_data.cadence='biweekly' then interval '14 days' else interval '7 days' end;
    while last_start<now()+interval '12 weeks' loop
      next_start=((last_start at time zone row_data.timezone)+step_size) at time zone row_data.timezone; next_end=next_start+(row_data.booking_end-row_data.booking_start);
      if not exists(select 1 from public.lessons where series_id=row_data.id and starts_at=next_start) then
        insert into public.lessons(studio_id,student_id,topic,starts_at,ends_at,status,location_type,location_label,service_id,series_id,meeting_provider,capacity)
        values(row_data.studio_id,row_data.student_id,row_data.service_name,next_start,next_end,'scheduled',case when row_data.location='in_person' then 'in_person' else 'virtual' end,case when row_data.location='in_person' then 'Studio' else 'Google Meet' end,row_data.service_id,row_data.id,row_data.location,1) returning id into lesson_id;
        insert into public.lesson_participants(lesson_id,booking_id,student_id,display_name,email,status) values(lesson_id,row_data.booking_id,row_data.student_id,row_data.guest_name,row_data.guest_email,'confirmed');
        insert into public.calendar_projections(lesson_id,status,conference_request_id) values(lesson_id,'queued',case when row_data.location='google_meet' then 'meet-'||lesson_id::text else null end); created=created+1;
      end if;
      last_start=next_start;
    end loop;
  end loop;
  return created;
end $$;
revoke all on function public.extend_ongoing_series() from public,anon,authenticated; grant execute on function public.extend_ongoing_series() to service_role;

create or replace function public.command_create_service_offering(
  target_service uuid, offering_title text, first_start timestamptz, enrollment_closes timestamptz,
  seat_capacity integer, occurrence_total integer default 1, publish_now boolean default false
) returns public.service_offerings language plpgsql security definer set search_path='' as $$
declare service public.booking_services; offering public.service_offerings; occurrence_id uuid; ids uuid[]:='{}'; idx integer; start_at timestamptz; studio_timezone text;
begin
  select * into service from public.booking_services where id=target_service and public.is_studio_coach(studio_id);
  if service.id is null then raise exception 'FORBIDDEN'; end if;
  if service.category='private' or occurrence_total<1 or occurrence_total>52 or seat_capacity<1 then raise exception 'VALIDATION_FAILED'; end if;
  select coalesce((select timezone from public.availability_rules where studio_id=service.studio_id and active=true order by service_id nulls first limit 1),'America/New_York') into studio_timezone;
  insert into public.service_offerings(studio_id,service_id,title,starts_at,ends_at,enrollment_closes_at,capacity,published)
  values(service.studio_id,service.id,offering_title,first_start,(((first_start at time zone studio_timezone)+(occurrence_total-1)*interval '7 days') at time zone studio_timezone)+make_interval(mins=>service.duration_minutes),enrollment_closes,seat_capacity,publish_now)
  returning * into offering;
  for idx in 0..occurrence_total-1 loop
    start_at=((first_start at time zone studio_timezone)+idx*interval '7 days') at time zone studio_timezone;
    insert into public.lessons(studio_id,student_id,topic,starts_at,ends_at,status,location_type,location_label,service_id,offering_id,meeting_provider,capacity)
    values(service.studio_id,null,offering_title,start_at,start_at+make_interval(mins=>service.duration_minutes),'scheduled',case when service.default_location='in_person' then 'in_person' else 'virtual' end,case when service.default_location='in_person' then 'Studio' else 'Google Meet' end,service.id,offering.id,service.default_location,seat_capacity)
    returning id into occurrence_id;
    ids=array_append(ids,occurrence_id);
    insert into public.calendar_projections(lesson_id,status,conference_request_id) values(occurrence_id,'queued',case when service.default_location='google_meet' then 'meet-'||occurrence_id::text else null end);
  end loop;
  update public.service_offerings set lesson_ids=ids where id=offering.id returning * into offering;
  return offering;
end $$;
revoke all on function public.command_create_service_offering(uuid,text,timestamptz,timestamptz,integer,integer,boolean) from public,anon;
grant execute on function public.command_create_service_offering(uuid,text,timestamptz,timestamptz,integer,integer,boolean) to authenticated;

create or replace function public.reschedule_booking_occurrences(target_booking uuid,expected_version integer,next_start timestamptz,next_end timestamptz,change_scope text default 'occurrence')
returns public.bookings language plpgsql security definer set search_path='' as $$
declare b public.bookings; service public.booking_services; shift interval; target_ids uuid[]; target_lesson record; updated public.bookings;
begin
  if change_scope not in ('occurrence','series') or next_end<=next_start then raise exception 'VALIDATION_FAILED'; end if;
  select * into b from public.bookings where id=target_booking for update;
  if b.id is null then raise exception 'BOOKING_NOT_FOUND'; end if;
  if b.version<>expected_version then raise exception 'VERSION_CONFLICT'; end if;
  if b.status<>'confirmed' then raise exception 'INVALID_TRANSITION'; end if;
  if b.reschedule_count>=cast(b.policy_snapshot->>'rescheduleLimit' as integer) then raise exception 'RESCHEDULE_LIMIT_REACHED'; end if;
  select * into service from public.booking_services where id=b.service_id;
  perform pg_advisory_xact_lock(hashtext(b.studio_id::text));
  shift=next_start-b.starts_at;
  select array_agg(id order by starts_at) into target_ids from public.lessons where id in(select lesson_id from public.lesson_participants where booking_id=b.id) and status='scheduled';
  if change_scope='occurrence' then target_ids=target_ids[1:1]; end if;
  if coalesce(array_length(target_ids,1),0)=0 then raise exception 'INVALID_TRANSITION'; end if;
  for target_lesson in select * from public.lessons where id=any(target_ids) order by starts_at loop
    if exists(select 1 from public.lessons l where l.studio_id=b.studio_id and l.status='scheduled' and not(l.id=any(target_ids)) and tstzrange(l.starts_at,l.ends_at,'[)') && tstzrange((target_lesson.starts_at+shift)-make_interval(mins=>service.buffer_before_minutes),(target_lesson.ends_at+shift)+make_interval(mins=>service.buffer_after_minutes),'[)')) then raise exception 'SLOT_UNAVAILABLE'; end if;
  end loop;
  update public.lessons set starts_at=starts_at+shift,ends_at=ends_at+shift,version=version+1,updated_at=now() where id=any(target_ids);
  update public.calendar_projections set status='queued',last_error=null where lesson_id=any(target_ids);
  update public.bookings set starts_at=next_start,ends_at=next_end,reschedule_count=reschedule_count+1,version=version+1,updated_at=now() where id=b.id returning * into updated;
  insert into public.audit_events(studio_id,action,entity_type,entity_id,reason,correlation_id,source,before_state,after_state)
  values(b.studio_id,'booking.rescheduled','booking',b.id,'Permitted self-service reschedule','booking-reschedule:'||b.id::text||':'||expected_version::text,'booking_platform',to_jsonb(b),to_jsonb(updated));
  return updated;
end $$;
revoke all on function public.reschedule_booking_occurrences(uuid,integer,timestamptz,timestamptz,text) from public,anon,authenticated;
grant execute on function public.reschedule_booking_occurrences(uuid,integer,timestamptz,timestamptz,text) to service_role;

create or replace function public.claim_public_rate_limit(target_key text,target_limit integer,target_window_seconds integer)
returns boolean language plpgsql security definer set search_path='' as $$
declare current_count integer;
begin
  if target_limit<1 or target_window_seconds<1 then raise exception 'VALIDATION_FAILED'; end if;
  insert into public.public_endpoint_rate_limits(key,request_count,window_ends_at,updated_at)
  values(target_key,1,now()+make_interval(secs=>target_window_seconds),now())
  on conflict(key) do update set request_count=case when public.public_endpoint_rate_limits.window_ends_at<=now() then 1 else public.public_endpoint_rate_limits.request_count+1 end,window_ends_at=case when public.public_endpoint_rate_limits.window_ends_at<=now() then now()+make_interval(secs=>target_window_seconds) else public.public_endpoint_rate_limits.window_ends_at end,updated_at=now()
  returning request_count into current_count;
  return current_count<=target_limit;
end $$;
revoke all on function public.claim_public_rate_limit(text,integer,integer) from public,anon,authenticated;
grant execute on function public.claim_public_rate_limit(text,integer,integer) to service_role;

create or replace function public.release_offering_seat(target_offering uuid)
returns integer language plpgsql security definer set search_path='' as $$
declare remaining integer;
begin
  update public.service_offerings set enrolled=greatest(0,enrolled-1),version=version+1,updated_at=now() where id=target_offering returning enrolled into remaining;
  return remaining;
end $$;
revoke all on function public.release_offering_seat(uuid) from public,anon,authenticated;
grant execute on function public.release_offering_seat(uuid) to service_role;

-- The webhook handler claims the event before dispatching it. Package checkout processing
-- therefore resumes an existing `processing` claim instead of treating it as a duplicate.
create or replace function public.process_stripe_checkout(event_id text,event_type text,event_payload jsonb,session_id text,student_id uuid,package_id uuid,amount_minor bigint,currency text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare pkg public.packages; payment_id uuid; duplicate boolean:=false; prior_status text;
begin
  select status into prior_status from public.webhook_events where id=event_id for update;
  if prior_status='processed' then return jsonb_build_object('duplicate',true,'eventId',event_id); end if;
  insert into public.webhook_events(id,provider,event_type,payload,status) values(event_id,'stripe',event_type,event_payload,'processing')
  on conflict(id) do update set event_type=excluded.event_type,payload=excluded.payload,status='processing',error=null,processed_at=null;
  select * into pkg from public.packages where id=package_id and packages.student_id=process_stripe_checkout.student_id for update;
  if pkg.id is null then update public.webhook_events set status='failed',error='Package not found',processed_at=now() where id=event_id; raise exception 'PACKAGE_NOT_FOUND'; end if;
  insert into public.payment_entries(student_id,package_id,kind,amount_minor,currency,external_reference,reason)
  values(student_id,package_id,'payment',amount_minor,upper(currency),session_id,'Stripe Checkout payment')
  on conflict(external_reference) do nothing returning id into payment_id;
  if payment_id is not null then
    insert into public.package_credit_entries(package_id,kind,quantity,reason,idempotency_key)
    values(package_id,'purchase',pkg.credit_quantity,'Stripe Checkout purchase','stripe-credit:'||session_id) on conflict(idempotency_key) do nothing;
  else duplicate:=true; end if;
  update public.webhook_events set status='processed',processed_at=now(),error=null where id=event_id;
  return jsonb_build_object('duplicate',duplicate,'eventId',event_id,'paymentId',payment_id);
exception when others then update public.webhook_events set status='failed',error=sqlerrm,processed_at=now() where id=event_id; raise;
end $$;
revoke all on function public.process_stripe_checkout(text,text,jsonb,text,uuid,uuid,bigint,text) from public,anon,authenticated;
grant execute on function public.process_stripe_checkout(text,text,jsonb,text,uuid,uuid,bigint,text) to service_role;
