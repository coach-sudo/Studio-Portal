revoke all on function public.can_view_student_schedule(uuid)
  from public, anon;
revoke all on function public.can_view_student_work(uuid)
  from public, anon;
revoke all on function public.can_manage_student_profile(uuid)
  from public, anon;
revoke all on function public.can_manage_student_lessons(uuid)
  from public, anon;

grant execute on function public.can_view_student_schedule(uuid)
  to authenticated;
grant execute on function public.can_view_student_work(uuid)
  to authenticated;
grant execute on function public.can_manage_student_profile(uuid)
  to authenticated;
grant execute on function public.can_manage_student_lessons(uuid)
  to authenticated;
