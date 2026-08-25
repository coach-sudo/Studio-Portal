set lock_timeout = '5s';
alter table public.bookings add column if not exists guest_phone text;
