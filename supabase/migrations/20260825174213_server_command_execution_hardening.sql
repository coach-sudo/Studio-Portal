-- All mutations flow through audited Netlify functions using the service role.
-- RLS helper functions remain executable by authenticated users because policies
-- call them while evaluating access; mutation commands do not need that grant.

revoke all on function public.command_approve_outbox(uuid, integer, text, text, text)
  from public, anon, authenticated;
grant execute on function public.command_approve_outbox(uuid, integer, text, text, text)
  to service_role;

revoke all on function public.command_complete_lesson(uuid, integer, text, text, text)
  from public, anon, authenticated;
grant execute on function public.command_complete_lesson(uuid, integer, text, text, text)
  to service_role;

revoke all on function public.command_transition(text, uuid, integer, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.command_transition(text, uuid, integer, text, text, text, text)
  to service_role;

revoke all on function public.command_create_service_offering(uuid, text, timestamptz, timestamptz, integer, integer, boolean)
  from public, anon, authenticated;
grant execute on function public.command_create_service_offering(uuid, text, timestamptz, timestamptz, integer, integer, boolean)
  to service_role;

revoke all on function public.merge_studio_students(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.merge_studio_students(uuid, uuid)
  to service_role;
