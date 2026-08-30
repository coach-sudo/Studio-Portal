create or replace function public.lesson_payment_status_from_booking(value text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case value
    when 'paid' then 'paid'
    when 'partially_paid' then 'partially_paid'
    when 'refunded' then 'refunded'
    when 'not_required' then 'waived'
    else 'due'
  end
$$;

update public.lessons l
set payment_status = public.lesson_payment_status_from_booking(b.payment_status::text),
    price_minor = b.total_minor,
    paid_minor = b.paid_minor,
    updated_at = greatest(l.updated_at, b.updated_at)
from public.lesson_participants p
join public.bookings b on b.id = p.booking_id
where p.lesson_id = l.id;

create or replace function public.sync_lesson_financials_from_participant()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.booking_id is not null then
    update public.lessons l
    set payment_status = public.lesson_payment_status_from_booking(b.payment_status::text),
        price_minor = b.total_minor,
        paid_minor = b.paid_minor,
        updated_at = greatest(l.updated_at, b.updated_at)
    from public.bookings b
    where b.id = new.booking_id and l.id = new.lesson_id;
  end if;
  return new;
end
$$;

create or replace function public.sync_lesson_financials_from_booking()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.lessons l
  set payment_status = public.lesson_payment_status_from_booking(new.payment_status::text),
      price_minor = new.total_minor,
      paid_minor = new.paid_minor,
      updated_at = greatest(l.updated_at, new.updated_at)
  from public.lesson_participants p
  where p.booking_id = new.id and p.lesson_id = l.id;
  return new;
end
$$;

drop trigger if exists lesson_participant_financial_sync on public.lesson_participants;
create trigger lesson_participant_financial_sync
after insert or update of booking_id on public.lesson_participants
for each row execute function public.sync_lesson_financials_from_participant();

drop trigger if exists booking_lesson_financial_sync on public.bookings;
create trigger booking_lesson_financial_sync
after update of payment_status, total_minor, paid_minor on public.bookings
for each row execute function public.sync_lesson_financials_from_booking();

revoke all on function public.lesson_payment_status_from_booking(text) from public, anon, authenticated;
revoke all on function public.sync_lesson_financials_from_participant() from public, anon, authenticated;
revoke all on function public.sync_lesson_financials_from_booking() from public, anon, authenticated;
