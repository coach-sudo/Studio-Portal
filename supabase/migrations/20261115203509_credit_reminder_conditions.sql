-- Private conditions are a projection of Stage C coverage and recipient rules.
-- Creating or refreshing a condition has no delivery side effect.
create table credit_internal.reminder_conditions (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios(id),
  student_id uuid not null references public.students(id),
  lesson_id uuid not null,
  condition_type text not null check (condition_type='uncovered_lesson'),
  status text not null check (status in ('open','blocked','resolved')),
  status_reason text not null,
  package_id uuid references public.packages(id) on delete set null,
  contact_id uuid references public.linked_contacts(id) on delete set null,
  opened_at timestamptz not null,
  evaluated_at timestamptz not null,
  last_delivery_at timestamptz,
  next_due_at timestamptz,
  resolved_at timestamptz,
  unique(student_id,condition_type,lesson_id),
  check (status='open' or next_due_at is null)
);
alter table credit_internal.reminder_conditions enable row level security;
revoke all on credit_internal.reminder_conditions from public,anon,authenticated,service_role;
create index reminder_conditions_due_idx on credit_internal.reminder_conditions(next_due_at,id)
  where status='open' and next_due_at is not null;

create function public.refresh_credit_reminder_conditions(p_student uuid,p_at timestamptz default now())
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_studio uuid; lesson record; route jsonb; evaluation jsonb;
  v_status text; v_reason text; v_package uuid; v_contact uuid;
  checked_count integer:=0; open_count integer:=0; blocked_count integer:=0; resolved_count integer;
begin
  if p_at is null or not isfinite(p_at) then raise exception 'VALIDATION_FAILED'; end if;
  select s.studio_id into v_studio from public.students s where s.id=p_student and s.deleted_at is null for share;
  perform pg_advisory_xact_lock(hashtextextended('credit-reminders:'||p_student::text,0));

  for lesson in
    select l.id,l.starts_at, bool_or(b.payment_status='processing') as payment_pending,
      bool_or(b.payment_status='partially_paid' or b.paid_minor>0) as financial_review
    from public.lessons l
    join public.lesson_participants lp on lp.lesson_id=l.id and lp.student_id=p_student
    join public.bookings b on b.id=lp.booking_id and b.student_id=p_student and b.studio_id=v_studio
    where l.studio_id=v_studio and l.status='scheduled' and l.service_id is not null
      and l.starts_at>greatest(now(),p_at) and lp.status in ('reserved','confirmed')
      and b.status='confirmed' and b.payment_policy='credits'
    group by l.id
    order by l.starts_at,l.id
  loop
    checked_count:=checked_count+1;
    evaluation:=credit_internal.evaluate_student_lesson_credit(p_student,lesson.id,'manual');
    route:=credit_internal.credit_lesson_billing_route(p_student,lesson.id);
    v_package:=null;
    v_contact:=null;
    if lesson.payment_pending or evaluation->>'reasonCode'='payment_pending' then
      v_status:='blocked'; v_reason:='processing';
    elsif lesson.financial_review or evaluation->>'state'='review_required' or route->>'status'='disputed' then
      v_status:='blocked'; v_reason:='studio_review';
    elsif route->>'status' in ('missing_recipient','ambiguous_pool') then
      v_status:='blocked'; v_reason:=route->>'status';
      v_package:=(route->>'packageId')::uuid;
    elsif route->>'status'='authorized' and route->>'contactId' is not null then
      v_status:='open'; v_reason:='uncovered';
      v_package:=(route->>'packageId')::uuid; v_contact:=(route->>'contactId')::uuid;
    else
      -- A valid hold or a compatible available lot needs no demand.
      update credit_internal.reminder_conditions set status='resolved',status_reason='coverage_changed',
        package_id=null,contact_id=null,evaluated_at=p_at,next_due_at=null,resolved_at=p_at
        where student_id=p_student and lesson_id=lesson.id and condition_type='uncovered_lesson' and status<>'resolved';
      continue;
    end if;
    if v_status='open' then open_count:=open_count+1; else blocked_count:=blocked_count+1; end if;
    insert into credit_internal.reminder_conditions as current_condition (
      studio_id,student_id,lesson_id,condition_type,status,status_reason,package_id,contact_id,opened_at,evaluated_at,next_due_at
    ) values (
      v_studio,p_student,lesson.id,'uncovered_lesson',v_status,v_reason,v_package,v_contact,p_at,p_at,
      case when v_status='open' then p_at end
    ) on conflict (student_id,condition_type,lesson_id) do update set
      status=excluded.status,status_reason=excluded.status_reason,package_id=excluded.package_id,
      contact_id=excluded.contact_id,evaluated_at=excluded.evaluated_at,resolved_at=null,
      next_due_at=case
        when excluded.status<>'open' then null
        when current_condition.last_delivery_at is not null then current_condition.last_delivery_at+interval '72 hours'
        when current_condition.status='open' then current_condition.next_due_at
        else excluded.evaluated_at
      end;
  end loop;

  update credit_internal.reminder_conditions as c set status='resolved',status_reason='lesson_no_longer_actionable',
    package_id=null,contact_id=null,evaluated_at=p_at,next_due_at=null,resolved_at=p_at
    where c.student_id=p_student and c.status<>'resolved' and not exists(
      select 1 from public.lessons l
      join public.lesson_participants lp on lp.lesson_id=l.id and lp.student_id=p_student
      join public.bookings b on b.id=lp.booking_id and b.student_id=p_student and b.studio_id=v_studio
      where l.id=c.lesson_id and l.studio_id=v_studio and l.status='scheduled' and l.service_id is not null
        and l.starts_at>greatest(now(),p_at) and lp.status in ('reserved','confirmed')
        and b.status='confirmed' and b.payment_policy='credits'
    );
  get diagnostics resolved_count=row_count;
  return jsonb_build_object('evaluated',checked_count,'open',open_count,'blocked',blocked_count,
    'noLongerActionable',resolved_count);
end $$;
revoke all on function public.refresh_credit_reminder_conditions(uuid,timestamptz) from public,anon,authenticated;
grant execute on function public.refresh_credit_reminder_conditions(uuid,timestamptz) to service_role;
