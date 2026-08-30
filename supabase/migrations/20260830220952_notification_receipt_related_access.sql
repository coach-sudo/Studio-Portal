drop policy if exists "notification receipts own insert" on public.notification_receipts;
create policy "notification receipts own insert"
  on public.notification_receipts for insert
  to authenticated
  with check (
    user_id = auth.uid()
    and (
      exists (
        select 1 from public.memberships m
        where m.user_id = auth.uid() and m.studio_id = notification_receipts.studio_id
      )
      or exists (
        select 1 from public.students s
        where s.user_id = auth.uid() and s.studio_id = notification_receipts.studio_id
      )
      or exists (
        select 1
        from public.student_relationships r
        join public.students s on s.id = r.student_id
        where r.user_id = auth.uid() and s.studio_id = notification_receipts.studio_id
      )
    )
  );
