-- An existing file and its private storage key belong to the student who
-- uploaded it. A roster merge must not discard it or give another account access.
create function library_internal.guard_assignment_attachment_reassignment()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if exists (
    select 1 from public.assignment_attachments a where a.assignment_id = old.id
  ) then
    raise exception 'ASSIGNMENT_ATTACHMENTS_PREVENT_MERGE'
      using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function library_internal.guard_assignment_attachment_reassignment() from public, anon, authenticated;

-- The assignment row lock also serializes this check with attaching/removing files.
create trigger guard_assignment_attachment_reassignment
before update of student_id on public.assignments for each row
when (old.student_id is distinct from new.student_id)
execute function library_internal.guard_assignment_attachment_reassignment();
