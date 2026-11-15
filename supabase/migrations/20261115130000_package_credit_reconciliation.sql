-- Definitions establish duration and approved services. A definitionless legacy lot
-- remains visible for reconciliation; its compatibility cannot be inferred.
create function credit_internal.package_lesson_matches(p_package uuid,p_lesson uuid)
returns boolean language sql stable set search_path='' as $$
  select case when p.definition_id is null then null else
    coalesce(d.session_duration_minutes is not null
      and l.service_id=any(d.eligible_service_ids)
      and l.ends_at-l.starts_at=make_interval(mins=>d.session_duration_minutes),false)
  end
  from public.packages p join public.students s on s.id=p.student_id
  join public.lessons l on l.id=p_lesson and l.studio_id=s.studio_id
  left join public.package_definitions d on d.id=p.definition_id and d.studio_id=s.studio_id
  where p.id=p_package
$$;
revoke all on function credit_internal.package_lesson_matches(uuid,uuid) from public,anon,authenticated;

-- Validate existing dated holds when the lesson is changed or completed. Timely
-- cancellation can still release an invalid hold through the established path.
create function credit_internal.guard_typed_credit_hold()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if old.status<>'scheduled' or new.status not in ('scheduled','completed') or
    (new.status=old.status and
     (new.starts_at,new.ends_at,new.service_id) is not distinct from
     (old.starts_at,old.ends_at,old.service_id)) then
    return new;
  end if;
  if exists (
    select 1 from public.package_credit_entries e
    join public.packages p on p.id=e.package_id
    join public.students s on s.id=p.student_id
    left join public.package_definitions d on d.id=p.definition_id and d.studio_id=s.studio_id
    where e.lesson_id=old.id and p.definition_id is not null
      and ((new.service_id=any(d.eligible_service_ids)
        and new.ends_at-new.starts_at=make_interval(mins=>d.session_duration_minutes)) is not true
        or p.expires_at<=new.starts_at)
    group by p.id having sum(e.quantity)<0
  ) then
    raise exception 'INVALID_TRANSITION: Review incompatible or expired package coverage before changing this lesson.';
  end if;
  return new;
end $$;
revoke all on function credit_internal.guard_typed_credit_hold() from public,anon,authenticated;
create trigger guard_typed_credit_hold before update of status,starts_at,ends_at,service_id on public.lessons
  for each row execute function credit_internal.guard_typed_credit_hold();

-- Package-scoped review and corrections reuse the ledger's unique source-entry link.
create function credit_internal.package_credit_review(p_student uuid, p_package uuid)
returns jsonb language sql stable set search_path='' as $$
  with lot as (
    select p.*, d.session_duration_minutes, d.eligible_service_ids
    from public.packages p
    join public.students s on s.id=p.student_id
    left join public.package_definitions d on d.id=p.definition_id and d.studio_id=s.studio_id
    where p.id=p_package and p.student_id=p_student
  ), debits as (
    select e.lesson_id, sum(e.quantity)::integer net, l.status, l.starts_at, l.ends_at,
      l.service_id, l.topic, l.student_id,
      (l.student_id=p_student or exists(select 1 from public.lesson_participants lp
        where lp.lesson_id=l.id and lp.student_id=p_student and lp.status in ('reserved','confirmed'))) participant
    from public.package_credit_entries e
    join lot p on p.id=e.package_id
    left join public.lessons l on l.id=e.lesson_id
    where e.lesson_id is not null or e.kind in ('reservation','consumption')
    group by e.lesson_id,l.id
    having sum(e.quantity) < 0
  ), totals as (
    select coalesce(sum(-net) filter (where status='scheduled'),0)::integer held,
      coalesce(sum(-net) filter (where status in ('completed','late_cancelled','no_show')),0)::integer consumed
    from debits
  ), ledger as (
    select coalesce(sum(e.quantity),0)::integer net,
      coalesce(sum(e.quantity) filter (where e.kind='purchase' and e.quantity>0),0)::integer purchased,
      coalesce(sum(e.quantity) filter (where e.kind in ('purchase','adjustment') and e.quantity>0 and e.lesson_id is null and e.reverses_entry_id is null),0)::integer issued
    from lot p join public.package_credit_entries e on e.package_id=p.id
  )
  select jsonb_build_object(
    'id', p.id, 'name', p.name, 'studentId', p.student_id,
    'durationMinutes', p.session_duration_minutes, 'serviceIds', coalesce(p.eligible_service_ids,'{}'),
    'services', coalesce((select jsonb_agg(b.name order by b.name,b.id)
      from public.booking_services b join public.students s on s.id=p.student_id
      where b.studio_id=s.studio_id and b.id=any(p.eligible_service_ids)),'[]'::jsonb),
    'expiresAt', p.expires_at, 'issued', ledger.issued, 'purchased', ledger.purchased,
    'ledgerBalance', ledger.net, 'consumed', totals.consumed,
    'held', totals.held,
    'reserved', case when p.expires_at<=now() then 0 else totals.held end,
    'unused', case when p.expires_at<=now() then 0 else ledger.net+totals.held end,
    'available', case when p.expires_at<=now() then 0 else ledger.net end,
    'issues', to_jsonb(array_remove(array[
      case when p.session_duration_minutes is null or coalesce(cardinality(p.eligible_service_ids),0)=0 then 'eligibility_unverified' end,
      case when ledger.net<0 then 'negative_ledger' end,
      case when ledger.issued=0 and (ledger.net<>0 or exists(select 1 from debits)) then 'missing_issuance' end,
      case when exists(select 1 from debits where status is null or (status='scheduled' and participant is not true)) then 'orphaned_debit' end,
      case when exists(select 1 from debits where status='cancelled') then 'cancelled_lesson_debit' end,
      case when exists(select 1 from debits where net < -1) then 'duplicate_lesson_debit' end,
      case when exists(select 1 from debits where status='scheduled' and p.expires_at<=greatest(now(),starts_at)) then 'expired_reservation' end,
      case when exists(select 1 from debits where status='scheduled' and
        (service_id=any(p.eligible_service_ids) and ends_at-starts_at=make_interval(mins=>p.session_duration_minutes)) is not true)
        then 'unverified_reservation_eligibility' end,
      case when exists(select 1 from debits b where b.lesson_id is not null and exists (
        select 1 from public.package_credit_entries e join public.packages other on other.id=e.package_id
        where e.lesson_id=b.lesson_id and other.student_id=p_student and other.id<>p.id
        group by other.id having sum(e.quantity)<0)) then 'conflicting_package_allocations' end
    ],null)),
    'purchaseReferences', coalesce((select jsonb_agg(r.external_reference) from
      (select external_reference from public.payment_entries where package_id=p.id and student_id=p_student
        and kind='payment' and external_reference is not null order by created_at desc,id limit 25) r),'[]'::jsonb))
  from lot p cross join totals cross join ledger
$$;

create function credit_internal.review_student_package_credits(p_student uuid,p_value jsonb)
returns jsonb language plpgsql stable set search_path='' as $$
declare selected uuid := (p_value->>'packageId')::uuid;
  page integer := coalesce((p_value->>'page')::integer,1);
  detail jsonb;
begin
  if page not between 1 and 100000 then raise exception 'VALIDATION_FAILED'; end if;
  if selected is not null then
    detail:=credit_internal.package_credit_review(p_student,selected);
    if detail is null then raise exception 'FORBIDDEN'; end if;
  end if;
  return jsonb_build_object('studentId',p_student,
    'version',coalesce((select version from public.student_credit_accounts where student_id=p_student),1),
    'lots',coalesce((select jsonb_agg(credit_internal.package_credit_review(p_student,p.id)
      order by p.created_at desc,p.id) from public.packages p where p.student_id=p_student),'[]'::jsonb),
    'selected',detail,
    'page',page,
    'total', (select count(*) from public.package_credit_entries e where e.package_id=selected),
    'entries',coalesce((select jsonb_agg(to_jsonb(h) order by h."createdAt" desc,h.id) from (
      select e.id,e.kind,e.quantity,e.reason,e.created_at "createdAt",e.lesson_id "lessonId",
        l.topic,l.status,e.idempotency_key "sourceKey", c.id "correctedBy",
        e.reverses_entry_id "corrects", l.starts_at "lessonStarts",
        case
          when c.id is not null or e.reverses_entry_id is not null then null
          when e.lesson_id is null and e.kind in ('adjustment','purchase') then 'reverse'
          when e.kind in ('consumption','reservation') and e.quantity<0 and l.status='completed' then 'restore'
        end action
      from public.package_credit_entries e
      left join public.lessons l on l.id=e.lesson_id
      left join public.package_credit_entries c on c.reverses_entry_id=e.id
      where e.package_id=selected order by e.created_at desc,e.id desc
      limit 25 offset (page-1)*25) h),'[]'::jsonb),
    'reservations', coalesce((select jsonb_agg(to_jsonb(r)) from (
      select l.id,l.topic,l.starts_at "startsAt",-sum(e.quantity)::integer quantity
      from public.package_credit_entries e join public.lessons l on l.id=e.lesson_id
      where e.package_id=selected and l.status='scheduled'
      group by l.id having sum(e.quantity)<0 order by l.starts_at,l.id limit 25
    ) r),'[]'::jsonb));
end $$;

create function credit_internal.correct_student_package_credit(
  p_student uuid,p_value jsonb,p_actor uuid,p_key text,p_version integer
) returns jsonb language plpgsql set search_path='' as $$
declare
  pkg public.packages;
  source public.package_credit_entries;
  before_lot jsonb;
  operation text:=p_value->>'operation';
  explanation text:=trim(p_value->>'reason');
  reviewed jsonb:=p_value->'reviewedLot';
  delta integer;
  lesson_to_restore uuid;
  inserted uuid;
  requested integer;
begin
  if operation is null or operation not in ('add','remove','set','reverse','restore')
    or explanation is null or char_length(explanation) not between 3 and 500 then
    raise exception 'VALIDATION_FAILED: Select a correction and enter a reason.';
  end if;
  select * into pkg from public.packages where id=(p_value->>'packageId')::uuid
    and student_id=p_student for update;
  if not found then raise exception 'FORBIDDEN'; end if;
  before_lot:=credit_internal.package_credit_review(p_student,pkg.id);
  if reviewed is distinct from before_lot or p_version is distinct from
    coalesce((select version from public.student_credit_accounts where student_id=p_student),1) then
    raise exception 'VERSION_CONFLICT: Review the current package balance again.';
  end if;
  if pkg.expires_at<=now() then
    raise exception 'INVALID_TRANSITION: Review the expiry before correcting this package.';
  end if;
  if operation in ('reverse','restore') then
    select * into source from public.package_credit_entries
      where id=(p_value->>'sourceEntryId')::uuid and package_id=pkg.id;
    if not found then raise exception 'FORBIDDEN'; end if;
    if source.reverses_entry_id is not null or exists(select 1 from public.package_credit_entries
      where reverses_entry_id=source.id) then
      raise exception 'INVALID_TRANSITION: This entry already has a linked correction.';
    end if;
    if operation='reverse' then
      if source.lesson_id is not null or source.kind not in ('purchase','adjustment')
        or (source.quantity>0 and exists(select 1 from public.package_credit_entries e
          where e.package_id=pkg.id and e.id<>source.id and e.quantity<0 and e.created_at>=source.created_at)) then
        raise exception 'INVALID_TRANSITION: Reconcile subsequent debits before reversing this grant.';
      end if;
    else
      select l.id into lesson_to_restore from public.lessons l
        where l.id=source.lesson_id and l.status='completed'
          and (l.student_id=p_student or exists(select 1 from public.lesson_participants lp
            where lp.lesson_id=l.id and lp.student_id=p_student and lp.status in ('reserved','confirmed')))
        for update;
      if lesson_to_restore is null or source.kind not in ('reservation','consumption') or source.quantity<>-1
        or (select sum(quantity) from public.package_credit_entries where package_id=pkg.id and lesson_id=source.lesson_id)<>-1
        or (select count(*) from public.package_credit_entries where package_id=pkg.id and lesson_id=source.lesson_id and quantity<0)<>1 then
        raise exception 'INVALID_TRANSITION: The lesson debit is ambiguous or already restored.';
      end if;
    end if;
    delta:=-source.quantity;
  else
    if jsonb_typeof(p_value->'quantity') is distinct from 'number' then raise exception 'VALIDATION_FAILED'; end if;
    requested:=(p_value->>'quantity')::integer;
    if requested not between (case when operation='set' then 0 else 1 end) and 100000 then
      raise exception 'VALIDATION_FAILED';
    end if;
    delta:=case operation when 'add' then requested when 'remove' then -requested
      else requested-(before_lot->>'unused')::integer end;
  end if;
  if delta=0 then raise exception 'VALIDATION_FAILED: The proposed balance is unchanged.'; end if;
  if delta<0 and (before_lot->>'available')::integer+delta<0 then
    raise exception 'CREDIT_UNAVAILABLE: Resolve reserved lesson credits before reducing this package.';
  end if;
  if operation<>'restore' and (before_lot->'issues') ?| array[
    'negative_ledger','missing_issuance','orphaned_debit','cancelled_lesson_debit',
    'duplicate_lesson_debit','expired_reservation','conflicting_package_allocations'] then
    raise exception 'INVALID_TRANSITION: Reconcile the package ledger before changing the balance.';
  end if;
  insert into public.package_credit_entries(package_id,lesson_id,kind,quantity,reason,idempotency_key,created_by,reverses_entry_id)
    values(pkg.id,lesson_to_restore,
      case when operation='restore' then 'release'::public.credit_entry_kind else 'adjustment'::public.credit_entry_kind end,
      delta,explanation,'package-correction:'||p_key,p_actor,source.id)
    returning id into inserted;
  return jsonb_build_object('entryId',inserted,'sourceEntryId',source.id,'before',before_lot,
    'after',credit_internal.package_credit_review(p_student,pkg.id));
end $$;

revoke all on function credit_internal.package_credit_review(uuid,uuid) from public,anon,authenticated;
revoke all on function credit_internal.review_student_package_credits(uuid,jsonb) from public,anon,authenticated;
revoke all on function credit_internal.correct_student_package_credit(uuid,jsonb,uuid,text,integer) from public,anon,authenticated;

create or replace function public.command_student_credit_settings(
  p_student uuid,p_command text,p_value jsonb,p_version integer,p_key text,p_actor uuid
) returns jsonb language plpgsql security definer set search_path='' as $$
declare s public.students; prior credit_internal.credit_command_receipts; result jsonb; audit_id uuid; before_balance jsonb;
  request jsonb:=jsonb_build_object('command',p_command,'value',p_value,'version',p_version);
begin
  select * into s from public.students where id=p_student and deleted_at is null for update;
  if s.id is null or p_actor is null or not exists(select 1 from public.memberships
    where user_id=p_actor and studio_id=s.studio_id and role='coach') then raise exception 'FORBIDDEN'; end if;
  if p_command='package_review' then
    return credit_internal.review_student_package_credits(p_student,p_value);
  end if;
  if p_key is null or length(p_key)<3 or length(p_key)>250 then raise exception 'VALIDATION_FAILED'; end if;
  select * into prior from credit_internal.credit_command_receipts where key=p_key;
  if prior.key is not null then
    if prior.student_id<>p_student or prior.actor_id is distinct from p_actor or prior.request<>request then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
    return prior.response||jsonb_build_object('duplicate',true);
  end if;
  if p_command='package_correct' then
    result:=credit_internal.correct_student_package_credit(p_student,p_value,p_actor,p_key,p_version);
    before_balance:=result->'before';
  elsif p_command='set_total' then
    select jsonb_build_object('remaining', summary->'remaining',
      'available', summary->'available', 'reserved', summary->'reserved')
      into before_balance from public.student_credit_summary(p_student) summary;
    if p_value ? 'reviewedBalance' and
      (select count(*) from public.packages where student_id=p_student and (expires_at is null or expires_at>now()))>1 then
      raise exception 'INVALID_TRANSITION: Select the exact package to adjust.';
    end if;
    if p_value ? 'reviewedBalance' and (p_value->>'total')::integer>(before_balance->>'remaining')::integer
      and exists(select 1 from public.packages where student_id=p_student
        and (expires_at is null or expires_at>now())
        and (definition_id is not null or name<>'Studio lesson credits' or expires_at is not null)) then
      raise exception 'INVALID_TRANSITION: Select the exact package to add credits to.';
    end if;
    if p_value ? 'reviewedBalance' and p_value->'reviewedBalance' is distinct from before_balance then
      raise exception 'VERSION_CONFLICT: Review the current credit balance again.';
    end if;
    result:=public.set_student_credit_total(p_student,(p_value->>'total')::integer,p_version,p_value->>'reason','credit-total:'||p_key);
  elsif p_command='set_auto' then
    if jsonb_typeof(p_value->'enabled') is distinct from 'boolean' then raise exception 'VALIDATION_FAILED'; end if;
    if (p_value->>'enabled')::boolean=false then
      update credit_internal.credit_coverage_jobs set manual_requested=false where student_id=p_student;
    end if;
    result:=public.set_student_credit_auto(p_student,(p_value->>'enabled')::boolean,p_version);
  elsif p_command='apply_upcoming' then
    if coalesce((select version from public.student_credit_accounts where student_id=p_student),1)<>p_version then raise exception 'VERSION_CONFLICT'; end if;
    result:=credit_internal.request_coverage(p_student,true);
  else raise exception 'VALIDATION_FAILED'; end if;
  insert into public.audit_events(studio_id,actor_id,action,entity_type,entity_id,reason,correlation_id,source,before_state,after_state)
    values(s.studio_id,p_actor,'credits.'||p_command,'student',s.id,coalesce(p_value->>'reason','Coach reviewed credit coverage'),p_key,'coach_portal',before_balance,result)
    returning id into audit_id;
  result:=result||jsonb_build_object('auditEventId',audit_id);
  insert into credit_internal.credit_command_receipts(key,student_id,actor_id,request,response) values(p_key,s.id,p_actor,request,result);
  return result;
end $$;
revoke all on function public.command_student_credit_settings(uuid,text,jsonb,integer,text,uuid) from public,anon,authenticated;
grant execute on function public.command_student_credit_settings(uuid,text,jsonb,integer,text,uuid) to service_role;

create or replace function credit_internal.evaluate_student_lesson_credit(
  p_student uuid, p_lesson uuid, p_mode text default 'automatic',
  p_allocated jsonb default '{}'::jsonb, p_package uuid default null,
  p_needs_review boolean default null
) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  l public.lessons;
  pkg public.packages;
  enabled boolean;
  reason text;
  state text := 'ineligible';
  reservation_count integer;
  reserved_package uuid;
begin
  if p_mode not in ('automatic', 'enable_preview', 'manual')
     or jsonb_typeof(p_allocated) is distinct from 'object' then
    raise exception 'VALIDATION_FAILED: Invalid coverage evaluation mode.' using errcode = '22023';
  end if;
  select x.* into l from public.lessons x join public.students s on s.id = p_student
    where x.id = p_lesson and x.studio_id = s.studio_id
      and (x.student_id = p_student or exists(
        select 1 from public.lesson_participants lp where lp.lesson_id = x.id
          and lp.student_id = p_student and lp.status in ('reserved', 'confirmed')));
  if l.id is null then
    return jsonb_build_object('state', 'ineligible', 'reasonCode', 'lesson_ineligible', 'eligible', false);
  end if;
  select coalesce(sum(t.qty), 0)::integer, (array_agg(t.package_id order by t.package_id))[1]
    into reservation_count, reserved_package
    from (select e.package_id, greatest(0, -sum(e.quantity))::integer qty
      from public.package_credit_entries e join public.packages p on p.id = e.package_id
      where e.lesson_id = l.id and p.student_id = p_student
      group by e.package_id having sum(e.quantity) < 0) t;

  -- A date correction preserves accounting. Only an explicit manual credit
  -- command may allocate coverage to a corrected record afterward.
  if p_mode<>'manual' and exists(select 1 from lesson_ops.datetime_corrections c where c.lesson_id=l.id) then
    return jsonb_build_object('state','review_required','reasonCode','reconciliation_required','eligible',false,'existingReservation',reservation_count>0);
  end if;
  if l.status <> 'scheduled' and not (p_mode = 'manual' and l.status = 'completed') then
    reason := 'lesson_ineligible';
  elsif exists(select 1 from public.studio_invoices i cross join jsonb_array_elements(i.items) x
    where i.student_id = p_student and i.checkout_key is not null
      and x->'lessonIds' @> to_jsonb(array[l.id::text])) then
    reason := 'payment_pending';
    if reservation_count > 0 then state := 'review_required'; end if;
  elsif reservation_count > 1 then
    select * into pkg from public.packages where id = reserved_package;
    return jsonb_build_object('state', 'review_required', 'reasonCode', 'reconciliation_required',
      'eligible', false, 'existingReservation', true, 'packageId', pkg.id, 'expiresAt', pkg.expires_at);
  elsif reservation_count = 1 then
    select * into pkg from public.packages where id = reserved_package;
    if credit_internal.package_lesson_matches(pkg.id,l.id) is false then
      return jsonb_build_object('state','review_required','reasonCode','reconciliation_required',
        'eligible',false,'existingReservation',true,'packageId',pkg.id,'expiresAt',pkg.expires_at);
    end if;
    if l.status = 'scheduled' and pkg.expires_at <= greatest(now(), l.starts_at) then
      return jsonb_build_object('state', 'review_required', 'reasonCode', 'expires_before_lesson',
        'eligible', false, 'existingReservation', true, 'packageId', pkg.id, 'expiresAt', pkg.expires_at);
    end if;
    if (l.student_id = p_student and (l.paid_minor > 0 or l.payment_status in ('paid', 'partially_paid', 'waived', 'refunded')))
       or exists(select 1 from public.lesson_participants lp join public.bookings b on b.id = lp.booking_id
         where lp.lesson_id = l.id and b.student_id = p_student and b.payment_policy <> 'credits'
           and b.payment_status in ('paid', 'partially_paid', 'processing')) then
      return jsonb_build_object('state', 'review_required', 'reasonCode', 'reconciliation_required',
        'eligible', false, 'existingReservation', true, 'packageId', pkg.id, 'expiresAt', pkg.expires_at);
    end if;
    return jsonb_build_object('state', 'covered', 'reasonCode', 'already_reserved',
      'eligible', false, 'existingReservation', true, 'packageId', pkg.id, 'expiresAt', pkg.expires_at);
  elsif coalesce(p_needs_review, (public.student_credit_summary(p_student)->>'needsReview')::boolean) then
    reason := 'reconciliation_required'; state := 'review_required';
  elsif exists(select 1 from public.package_credit_entries e join public.packages p on p.id=e.package_id
    where p.student_id=p_student and e.lesson_id=l.id group by e.lesson_id having sum(e.quantity)>0) then
    reason := 'reconciliation_required'; state := 'review_required';
  elsif l.student_id = p_student and l.payment_status = 'partially_paid' then
    reason := 'partially_paid';
  elsif l.student_id = p_student and (l.payment_status = 'paid' or l.paid_minor > 0) then
    reason := 'cash_paid';
  elsif l.student_id = p_student and l.payment_status in ('waived', 'refunded') then
    reason := 'lesson_ineligible';
  else
    select case when b.payment_status = 'processing' then 'payment_pending'
        when b.payment_status = 'partially_paid' then 'partially_paid' else 'cash_paid' end
      into reason from public.lesson_participants lp join public.bookings b on b.id = lp.booking_id
      where lp.lesson_id = l.id and b.student_id = p_student and b.payment_policy <> 'credits'
        and b.payment_status in ('paid', 'partially_paid', 'processing')
      order by case b.payment_status when 'processing' then 0 when 'partially_paid' then 1 else 2 end, b.id
      limit 1;
    if reason is null then
      select case when exists(select 1 from public.student_credit_accounts where student_id=p_student)
        then (select auto_apply from public.student_credit_accounts where student_id=p_student) else false end into enabled;
      if p_mode <> 'manual' and l.source_provider is not null and l.source_provider not in ('studio','public_booking') then
        reason := 'reconciliation_required'; state := 'review_required';
      elsif p_mode = 'automatic' and enabled is null then
        reason := 'mixed_settings_review'; state := 'review_required';
      elsif p_mode = 'automatic' and enabled = false then
        reason := 'auto_disabled';
      else
        select p.* into pkg from public.packages p
          where p.student_id = p_student
            and (p_package is null or p.id = p_package)
            and (p_mode <> 'automatic' or coalesce(enabled, p.auto_apply))
            and credit_internal.package_lesson_matches(p.id,l.id) is not false
            and (p.expires_at is null or p.expires_at > greatest(now(), l.starts_at))
            and public.package_credit_balance(p.id) - coalesce((p_allocated->>p.id::text)::integer, 0) > 0
          order by p.expires_at nulls last, p.created_at, p.id limit 1;
        if pkg.id is not null then
          return jsonb_build_object('state', 'eligible_unreserved', 'reasonCode', 'eligible',
            'eligible', true, 'packageId', pkg.id, 'expiresAt', pkg.expires_at);
        end if;
        if p_mode = 'automatic' and enabled is null and exists(
          select 1 from public.packages p where p.student_id = p_student and not p.auto_apply
            and (p_package is null or p.id = p_package)
            and credit_internal.package_lesson_matches(p.id,l.id) is not false
            and (p.expires_at is null or p.expires_at > greatest(now(), l.starts_at))
            and public.package_credit_balance(p.id) - coalesce((p_allocated->>p.id::text)::integer, 0) > 0) then
          reason := 'mixed_settings_review'; state := 'review_required';
        elsif exists(select 1 from public.packages p where p.student_id=p_student
          and (p_package is null or p.id=p_package)
          and (p.expires_at is null or p.expires_at>greatest(now(),l.starts_at))
          and public.package_credit_balance(p.id)>0
          and credit_internal.package_lesson_matches(p.id,l.id) is false) then
          reason := 'reconciliation_required'; state := 'review_required';
        elsif exists(select 1 from public.packages p where p.student_id = p_student
          and (p_package is null or p.id = p_package)
          and (p_mode <> 'automatic' or coalesce(enabled, p.auto_apply))
          and p.expires_at > now() and p.expires_at <= l.starts_at
          and public.package_credit_balance(p.id) - coalesce((p_allocated->>p.id::text)::integer, 0) > 0) then
          reason := 'expires_before_lesson';
        else
          reason := 'no_available_credits';
        end if;
      end if;
    end if;
  end if;
  return jsonb_build_object('state', state, 'reasonCode', reason, 'eligible', false);
end;
$$;
