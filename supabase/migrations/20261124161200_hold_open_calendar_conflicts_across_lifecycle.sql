-- Lifecycle commands can requeue a projection and clear its last error.
-- Use the same open-conflict predicate as the pre-write and completion fences.
create or replace function public.claim_calendar_projections(batch_size integer default 10)
returns table(projection jsonb,lesson jsonb) language plpgsql security definer set search_path='' as $$
begin
  if batch_size not between 1 and 25 then raise exception 'VALIDATION_FAILED'; end if;
  return query with wanted as(select p.id from public.calendar_projections p
    where p.status in ('queued','failed','projecting') and (p.next_attempt_at is null or p.next_attempt_at<=now())
      and not exists (
        select 1 from public.sync_conflicts c
        where c.entity_type = 'lesson' and c.entity_id = p.lesson_id and c.status = 'open'
      )
      and (p.claim_until is null or p.claim_until<=now()) order by p.next_attempt_at nulls first,p.id for update skip locked limit batch_size),
  claimed as(update public.calendar_projections p set status='projecting',claim_token=gen_random_uuid(),
    claim_until=now()+interval '5 minutes',claimed_version=l.version,attempts=p.attempts+1,
    first_attempted_at=coalesce(p.first_attempted_at,now()) from public.lessons l
    where p.id in(select id from wanted) and l.id=p.lesson_id returning p.*)
  select to_jsonb(c),to_jsonb(l) from claimed c join public.lessons l on l.id=c.lesson_id;
end $$;
