-- Direct caller writes cannot bypass the authoritative booking commands.
-- Existing RLS SELECT policy and service-only/coach-authorized definer RPCs remain.
revoke insert,update,delete,truncate on table public.bookings from public,anon,authenticated;
drop policy if exists bookings_coach_write on public.bookings;
