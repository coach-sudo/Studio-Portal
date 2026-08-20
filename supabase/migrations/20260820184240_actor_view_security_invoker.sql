-- Public actor profiles are exposed only through an explicitly invoker-safe
-- view. The public Netlify endpoint still performs publication checks and
-- signed media URL generation server-side.
alter view public.published_actor_profiles set (security_invoker = true);

alter extension btree_gist set schema extensions;

revoke execute on function public.can_access_student(uuid) from public, anon;
revoke execute on function public.can_view_student_finance(uuid) from public, anon;
revoke execute on function public.is_studio_coach(uuid) from public, anon;
revoke execute on function public.command_approve_outbox(uuid,integer,text,text,text) from public, anon;
revoke execute on function public.command_complete_lesson(uuid,integer,text,text,text) from public, anon;
revoke execute on function public.command_transition(text,uuid,integer,text,text,text,text) from public, anon;

grant execute on function public.can_access_student(uuid), public.can_view_student_finance(uuid), public.is_studio_coach(uuid) to authenticated;
