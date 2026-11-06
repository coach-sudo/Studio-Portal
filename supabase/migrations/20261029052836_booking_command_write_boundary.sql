-- Direct caller writes cannot bypass the authoritative booking commands.
-- Existing RLS SELECT policy and service-only/coach-authorized definer RPCs remain.
revoke insert,update,delete,truncate on table public.bookings from public,anon,authenticated;
drop policy if exists bookings_coach_write on public.bookings;
-- BYPASSRLS does not confer table privileges. Keep server writes explicit even
-- when auto_expose_new_tables=false or hosted default ACLs differ from replay.
grant select,insert,update,delete on table public.bookings to service_role;
