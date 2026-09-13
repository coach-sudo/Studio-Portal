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
