-- A referral is attributed on the first confirmed booking made through a
-- student's link. Rewards are issued only after a non-free payment, once per
-- referred student and reward type, even when that payment happens later.
alter table public.students
  add column if not exists referral_code text;
update public.students set referral_code = upper(left(replace(gen_random_uuid()::text, '-', ''), 16))
  where referral_code is null;
alter table public.students alter column referral_code set default upper(left(replace(gen_random_uuid()::text, '-', ''), 16));
alter table public.students alter column referral_code set not null;
create unique index if not exists students_referral_code_unique on public.students(referral_code);

alter table public.bookings add column if not exists referral_code text;

create table if not exists public.referrals (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios(id) on delete cascade,
  referrer_student_id uuid not null references public.students(id) on delete cascade,
  referred_student_id uuid not null references public.students(id) on delete cascade,
  referred_email text not null,
  source_booking_id uuid not null references public.bookings(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (studio_id, referred_student_id),
  check (referrer_student_id <> referred_student_id)
);
create index if not exists referrals_referrer_idx on public.referrals(referrer_student_id, created_at desc);
alter table public.referrals enable row level security;
create policy referrals_read on public.referrals for select to authenticated
  using (public.is_studio_coach(studio_id) or public.can_access_student(referrer_student_id));
revoke all on public.referrals from anon, authenticated;
grant select on public.referrals to authenticated;
grant all on public.referrals to service_role;

alter table public.discount_codes
  add column if not exists restricted_student_id uuid references public.students(id) on delete set null,
  add column if not exists referral_reward_kind text
    check (referral_reward_kind in ('paid_lesson', 'recurring_slot'));

create table if not exists public.referral_rewards (
  id uuid primary key default gen_random_uuid(),
  referral_id uuid not null references public.referrals(id) on delete cascade,
  kind text not null check (kind in ('paid_lesson', 'recurring_slot')),
  discount_code_id uuid not null unique references public.discount_codes(id) on delete restrict,
  earned_booking_id uuid not null references public.bookings(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (referral_id, kind)
);
create index if not exists referral_rewards_referral_idx on public.referral_rewards(referral_id);
alter table public.referral_rewards enable row level security;
create policy referral_rewards_read on public.referral_rewards for select to authenticated
  using (exists (
    select 1 from public.referrals r where r.id = referral_id
      and (public.is_studio_coach(r.studio_id) or public.can_access_student(r.referrer_student_id))
  ));
revoke all on public.referral_rewards from anon, authenticated;
grant select on public.referral_rewards to authenticated;
grant all on public.referral_rewards to service_role;

-- The four-argument form remains for existing callers and ordinary coupons.
create or replace function public.claim_booking_discount(
  target_studio uuid, target_service uuid, target_code text,
  target_subtotal bigint, target_student uuid, target_recurrence text
) returns table(code_id uuid, discount_minor bigint)
language plpgsql security definer set search_path = '' as $$
declare d public.discount_codes; svc public.booking_services; calculated bigint;
begin
  select * into d from public.discount_codes
    where studio_id = target_studio and upper(code) = upper(trim(target_code)) for update;
  if d.id is null or not d.active
    or (d.starts_at is not null and d.starts_at > now())
    or (d.ends_at is not null and d.ends_at < now())
    or (cardinality(d.service_ids) > 0 and not target_service = any(d.service_ids))
    or (d.max_redemptions is not null and d.redemption_count >= d.max_redemptions)
    or (d.restricted_student_id is not null and d.restricted_student_id is distinct from target_student)
  then raise exception 'DISCOUNT_INVALID'; end if;
  if d.referral_reward_kind = 'recurring_slot' then
    select * into svc from public.booking_services where id = target_service and studio_id = target_studio;
    if svc.id is null or svc.category <> 'private' or svc.duration_minutes <> 60
      or target_recurrence <> 'none' then raise exception 'DISCOUNT_INVALID'; end if;
  end if;
  calculated := case when d.discount_type = 'percent'
    then round(target_subtotal * d.amount / 100.0)::bigint else d.amount::bigint end;
  calculated := greatest(0, least(target_subtotal, calculated));
  update public.discount_codes set redemption_count = redemption_count + 1,
    version = version + 1, updated_at = now() where id = d.id;
  return query select d.id, calculated;
end $$;
revoke all on function public.claim_booking_discount(uuid, uuid, text, bigint, uuid, text) from public, anon, authenticated;
grant execute on function public.claim_booking_discount(uuid, uuid, text, bigint, uuid, text) to service_role;

create or replace function public.claim_booking_discount(
  target_studio uuid, target_service uuid, target_code text, target_subtotal bigint
) returns table(code_id uuid, discount_minor bigint)
language sql security definer set search_path = '' as $$
  select * from public.claim_booking_discount(target_studio, target_service, target_code, target_subtotal, null::uuid, 'none'::text)
$$;
revoke all on function public.claim_booking_discount(uuid, uuid, text, bigint) from public, anon, authenticated;
grant execute on function public.claim_booking_discount(uuid, uuid, text, bigint) to service_role;

create or replace function public.process_referral_booking() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  referral public.referrals;
  referrer public.students;
  paid_booking public.bookings;
  recurring_booking public.bookings;
  new_code uuid;
  reward_code text;
  studio_contact text;
  reward_kind text;
begin
  if new.status <> 'confirmed' or new.student_id is null then return new; end if;
  if new.referral_code is not null then
    select * into referrer from public.students
      where referral_code = upper(new.referral_code) and studio_id = new.studio_id and deleted_at is null;
    if referrer.id is not null and referrer.id <> new.student_id then
      insert into public.referrals(studio_id, referrer_student_id, referred_student_id, referred_email, source_booking_id)
        values(new.studio_id, referrer.id, new.student_id, lower(trim(new.guest_email)), new.id)
        on conflict (studio_id, referred_student_id) do nothing;
    end if;
  end if;
  select * into referral from public.referrals
    where studio_id = new.studio_id and referred_student_id = new.student_id for update;
  if referral.id is null then return new; end if;

  select b.* into paid_booking from public.bookings b
    where b.studio_id = new.studio_id and b.student_id = new.student_id
      and b.status = 'confirmed' and b.paid_minor > 0
    order by b.created_at, b.id limit 1;
  select b.* into recurring_booking from public.bookings b
    join public.booking_services svc on svc.id = b.service_id
    join public.recurring_series rs on rs.id = b.series_id
    where b.studio_id = new.studio_id and b.student_id = new.student_id
      and b.status = 'confirmed' and b.paid_minor > 0 and svc.category = 'private'
      and rs.kind in ('fixed', 'ongoing')
    order by b.created_at, b.id limit 1;

  select settings->>'contactEmail' into studio_contact from public.studios where id = new.studio_id;
  for reward_kind in select unnest(array['paid_lesson', 'recurring_slot']) loop
    if (reward_kind = 'paid_lesson' and paid_booking.id is null)
      or (reward_kind = 'recurring_slot' and recurring_booking.id is null)
      or exists(select 1 from public.referral_rewards where referral_id = referral.id and kind = reward_kind)
    then continue; end if;
    reward_code := case when reward_kind = 'paid_lesson' then 'REF15-' else 'REFFREE-' end
      || upper(left(replace(gen_random_uuid()::text, '-', ''), 18));
    insert into public.discount_codes(
      studio_id, code, description, discount_type, amount, currency,
      max_redemptions, restricted_student_id, referral_reward_kind
    ) values (
      new.studio_id, reward_code,
      case when reward_kind = 'paid_lesson' then 'Referral: $15 off next lesson'
        else 'Referral: one free 60-minute private lesson' end,
      case when reward_kind = 'paid_lesson' then 'fixed' else 'percent' end,
      case when reward_kind = 'paid_lesson' then 1500 else 100 end,
      'USD', 1, referral.referrer_student_id, reward_kind
    ) returning id into new_code;
    insert into public.referral_rewards(referral_id, kind, discount_code_id, earned_booking_id)
      values(referral.id, reward_kind, new_code,
        case when reward_kind = 'paid_lesson' then paid_booking.id else recurring_booking.id end);
    if nullif(trim(coalesce(studio_contact, '')), '') is not null then
      insert into public.outbox_messages(
        studio_id, student_id, channel, recipient, subject, body,
        status, send_at, event_key, dedupe_key
      ) values (
        new.studio_id, referral.referrer_student_id, 'email', studio_contact,
        'Referral reward earned',
        referrer.full_name || ' earned ' ||
          case when reward_kind = 'paid_lesson' then '$15 off their next lesson'
            else 'a free 60-minute private lesson' end ||
          ' after ' || new.guest_name || ' purchased a ' ||
          case when reward_kind = 'paid_lesson' then 'paid lesson.' else 'recurring slot.' end ||
          E'\n\nTrack referrals in the coach portal.',
        'queued', now(), 'referral.reward',
        'referral:' || referral.id::text || ':' || reward_kind
      ) on conflict (dedupe_key) where dedupe_key is not null do nothing;
    end if;
  end loop;
  return new;
end $$;
revoke all on function public.process_referral_booking() from public, anon, authenticated;
drop trigger if exists process_referral_booking on public.bookings;
create trigger process_referral_booking after update of status, paid_minor, student_id on public.bookings
  for each row when (new.status = 'confirmed') execute function public.process_referral_booking();
