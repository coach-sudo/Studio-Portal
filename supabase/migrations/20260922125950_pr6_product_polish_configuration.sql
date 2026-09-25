-- PR6 keeps product copy configurable without replacing any existing rows.
-- Package pricing remains authoritative; benefit_text is presentation-only.

alter table public.package_definitions
  add column if not exists benefit_text text;

update public.studios
set settings = jsonb_set(
  jsonb_set(
    coalesce(settings, '{}'::jsonb),
    '{referralProgram}',
    coalesce(
      settings -> 'referralProgram',
      jsonb_build_object(
        'enabled', true,
        'paidLessonRewardMinor', 1500,
        'recurringSlotRewardSessionMinutes', 60,
        'referredPersonBenefit', null
      )
    ),
    true
  ),
  '{actorPageCta}',
  coalesce(
    settings -> 'actorPageCta',
    jsonb_build_object('label', 'Book coaching', 'url', '/book')
  ),
  true
)
where settings -> 'referralProgram' is null
   or settings -> 'actorPageCta' is null;

comment on column public.package_definitions.benefit_text is
  'Optional coach-authored package benefit copy. Pricing and discount columns remain authoritative.';

-- Read the persisted offer when issuing rewards. Existing rewards and
-- discount codes remain untouched; the defaults match the former constants.
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
  reward_amount integer;
  reward_minutes integer;
  reward_currency text;
  referral_enabled boolean;
begin
  if new.status <> 'confirmed' or new.student_id is null then return new; end if;
  select
    coalesce((settings #>> '{referralProgram,enabled}')::boolean, true),
    coalesce((settings #>> '{referralProgram,paidLessonRewardMinor}')::integer, 1500),
    coalesce((settings #>> '{referralProgram,recurringSlotRewardSessionMinutes}')::integer, 60),
    coalesce(settings ->> 'currency', 'USD'),
    settings ->> 'contactEmail'
  into referral_enabled, reward_amount, reward_minutes, reward_currency, studio_contact
  from public.studios where id = new.studio_id;
  if not coalesce(referral_enabled, true) then return new; end if;

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
  select * into referrer from public.students where id = referral.referrer_student_id;

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
      case when reward_kind = 'paid_lesson'
        then 'Referral: ' || reward_currency || ' ' || (reward_amount / 100.0)::text || ' off next lesson'
        else 'Referral: one free ' || reward_minutes::text || '-minute private lesson' end,
      case when reward_kind = 'paid_lesson' then 'fixed' else 'percent' end,
      case when reward_kind = 'paid_lesson' then reward_amount else 100 end,
      reward_currency, 1, referral.referrer_student_id, reward_kind
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
          case when reward_kind = 'paid_lesson'
            then reward_currency || ' ' || (reward_amount / 100.0)::text || ' off their next lesson'
            else 'a free ' || reward_minutes::text || '-minute private lesson' end ||
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

create or replace function public.claim_booking_discount(
  target_studio uuid, target_service uuid, target_code text,
  target_subtotal bigint, target_student uuid, target_recurrence text
) returns table(code_id uuid, discount_minor bigint)
language plpgsql security definer set search_path = '' as $$
declare
  d public.discount_codes;
  svc public.booking_services;
  calculated bigint;
  reward_minutes integer;
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
    select coalesce((settings #>> '{referralProgram,recurringSlotRewardSessionMinutes}')::integer, 60)
      into reward_minutes from public.studios where id = target_studio;
    select * into svc from public.booking_services where id = target_service and studio_id = target_studio;
    if svc.id is null or svc.category <> 'private' or svc.duration_minutes <> coalesce(reward_minutes, 60)
      or target_recurrence <> 'none' then raise exception 'DISCOUNT_INVALID'; end if;
  end if;
  calculated := case when d.discount_type = 'percent'
    then round(target_subtotal * d.amount / 100.0)::bigint else d.amount::bigint end;
  calculated := greatest(0, least(target_subtotal, calculated));
  update public.discount_codes set redemption_count = redemption_count + 1,
    version = version + 1, updated_at = now() where id = d.id;
  return query select d.id, calculated;
end $$;
