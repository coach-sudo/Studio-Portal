-- Guest bookers choose whether the confirmation should provision portal
-- credentials. Existing accounts are never reset by a repeat booking.
alter table public.bookings
  add column if not exists portal_requested boolean not null default false;

comment on column public.bookings.portal_requested is
  'Guest explicitly requested a portal profile during booking.';
