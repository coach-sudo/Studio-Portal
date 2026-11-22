-- Catalog edits must not change the service or duration sold with an issued lot.
-- No legacy row is backfilled from today's catalog.
create table credit_internal.package_credit_terms (
  package_id uuid primary key references public.packages(id) on delete cascade,
  original_student_id uuid not null,
  original_definition_id uuid,
  original_name text not null,
  original_expires_at timestamptz,
  service_ids uuid[] not null,
  duration_minutes integer,
  issuance_entry_id uuid references public.package_credit_entries(id) on delete set null,
  captured_at timestamptz not null default now()
);
alter table credit_internal.package_credit_terms enable row level security;
revoke all on credit_internal.package_credit_terms from public,anon,authenticated,service_role;

create function credit_internal.capture_package_credit_terms()
returns trigger language plpgsql security definer set search_path='' as $$
declare definition public.package_definitions;
begin
  select d.* into definition from public.package_definitions d
    join public.students s on s.studio_id=d.studio_id and s.id=new.student_id
    where d.id=new.definition_id;
  insert into credit_internal.package_credit_terms(package_id,original_student_id,
    original_definition_id,original_name,original_expires_at,service_ids,duration_minutes)
  values(new.id,new.student_id,new.definition_id,new.name,new.expires_at,
    coalesce(definition.eligible_service_ids,'{}'),definition.session_duration_minutes);
  return new;
end $$;
revoke all on function credit_internal.capture_package_credit_terms() from public,anon,authenticated;
create trigger capture_package_credit_terms after insert on public.packages
  for each row execute function credit_internal.capture_package_credit_terms();

create function credit_internal.capture_package_credit_issuance()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  update credit_internal.package_credit_terms set issuance_entry_id=new.id
    where package_id=new.package_id and issuance_entry_id is null;
  return new;
end $$;
revoke all on function credit_internal.capture_package_credit_issuance() from public,anon,authenticated;
create trigger capture_package_credit_issuance after insert on public.package_credit_entries
  for each row when (new.lesson_id is null and new.quantity>0 and new.kind in ('purchase','adjustment'))
  execute function credit_internal.capture_package_credit_issuance();

create function credit_internal.package_credit_review(p_student uuid, p_package uuid)
returns jsonb language sql stable set search_path='' as $$
  with lot as (
    select p.*,
      case when t.package_id is not null then t.duration_minutes else d.session_duration_minutes end session_duration_minutes,
      case when t.package_id is not null then t.service_ids else d.eligible_service_ids end eligible_service_ids,
      t.package_id is not null captured,
      t.original_student_id,t.original_definition_id,t.original_name,t.original_expires_at,t.issuance_entry_id
    from public.packages p
    join public.students s on s.id=p.student_id
    left join credit_internal.package_credit_terms t on t.package_id=p.id
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
    'terms', case when p.captured then jsonb_build_object(
      'originalStudentId',p.original_student_id,'originalDefinitionId',p.original_definition_id,
      'originalName',p.original_name,'originalExpiresAt',p.original_expires_at,'issuanceEntryId',p.issuance_entry_id) end,
    'expiresAt', p.expires_at, 'issued', ledger.issued, 'purchased', ledger.purchased,
    'ledgerBalance', ledger.net, 'consumed', totals.consumed,
    'held', totals.held,
    'reserved', case when p.expires_at<=now() then 0 else totals.held end,
    'unused', case when p.expires_at<=now() then 0 else ledger.net+totals.held end,
    'available', case when p.expires_at<=now() then 0 else ledger.net end,
    'issues', to_jsonb(array_remove(array[
      case when not p.captured then 'legacy_terms_unverified' end,
      case when p.session_duration_minutes is null or coalesce(cardinality(p.eligible_service_ids),0)=0 then 'eligibility_unverified' end,
      case when ledger.net<0 then 'negative_ledger' end,
      case when ledger.purchased>0 and exists (
        select 1 from public.package_credit_entries e where e.package_id=p.id and e.kind='purchase'
          and e.quantity>0 and e.idempotency_key is null) then 'purchase_source_unverified' end,
      case when exists (
        select 1 from public.package_credit_entries e where e.package_id=p.id and e.kind='purchase'
          and e.quantity>0 and e.idempotency_key is not null
        group by e.reason,e.quantity having count(*)>1) then 'repeated_purchase_description' end,
      case when exists(select 1 from debits b join public.lessons l on l.id=b.lesson_id
        where l.student_id=p_student and l.package_id is not null and l.package_id<>p.id)
        then 'lesson_package_mismatch' end,
      case when ledger.issued=0 and (ledger.net<>0 or exists(select 1 from debits)
        or exists(select 1 from public.payment_entries e where e.package_id=p.id and e.student_id=p_student and e.kind='payment'))
        then 'missing_issuance' end,
      case when exists(select 1 from debits b join public.lessons l on l.id=b.lesson_id
        where l.paid_minor>0 or l.payment_status in ('paid','partially_paid')) then 'cash_credit_overlap' end,
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
      if source.kind='purchase' and not exists(
        select 1 from jsonb_array_elements(credit_internal.checkout_credit_duplicates(p_student,pkg.id)) as d
        where d->>'entryId'=source.id::text
      ) then raise exception 'INVALID_TRANSITION: Verify the duplicate purchase before reversing its credits.'; end if;
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

create table credit_internal.reconciliation_cases (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null,
  package_id uuid not null,
  finding text not null,
  evidence jsonb not null,
  status text not null default 'needs_review' check(status in ('needs_review','under_review','resolved','dismissed','reopened')),
  detected_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewer uuid,
  reason text,
  correction_id uuid,
  version integer not null default 1,
  unique(package_id,finding)
);
alter table credit_internal.reconciliation_cases enable row level security;
revoke all on credit_internal.reconciliation_cases from public,anon,authenticated,service_role;

-- Only exact references from processed checkout payloads count as confirmed links.
create function credit_internal.checkout_credit_duplicates(p_student uuid,p_package uuid)
returns jsonb language sql stable set search_path='' as $$
  with refs as (
    select distinct e.id,e.package_id,w.payload #>> '{data,object,id}' session,
      w.payload #>> '{data,object,payment_intent}' intent
    from public.webhook_events w
    join public.package_credit_entries e on e.idempotency_key='stripe-credit:'||(w.payload #>> '{data,object,id}')
    join public.packages p on p.id=e.package_id
    where p.student_id=p_student and w.provider='stripe' and w.status='processed'
      and w.event_type in ('checkout.session.completed','checkout.session.async_payment_succeeded')
      and e.kind='purchase' and e.quantity>0
      and w.payload #>> '{data,object,payment_intent}' ~ '^pi_[A-Za-z0-9_]+$'
  )
  select coalesce(jsonb_agg(jsonb_build_object('entryId',a.id,'relatedEntryId',b.id)
    order by a.id,b.id),'[]'::jsonb)
  from refs a join refs b on b.intent=a.intent and b.id<>a.id and a.session<>b.session
  where a.package_id=p_package
    and not exists(select 1 from public.package_credit_entries e where e.reverses_entry_id in (a.id,b.id))
$$;
revoke all on function credit_internal.checkout_credit_duplicates(uuid,uuid) from public,anon,authenticated;

create function credit_internal.sync_reconciliation_cases(p_student uuid,p_package uuid,p_actor uuid)
returns jsonb language plpgsql set search_path='' as $$
declare lot jsonb; v_evidence jsonb; issue text; issues jsonb; duplicates jsonb;
  current_case credit_internal.reconciliation_cases;
  studio uuid;
begin
  lot:=credit_internal.package_credit_review(p_student,p_package);
  if lot is null then raise exception 'FORBIDDEN'; end if;
  select studio_id into studio from public.students where id=p_student;
  duplicates:=credit_internal.checkout_credit_duplicates(p_student,p_package);
  issues:=lot->'issues';
  if duplicates<>'[]'::jsonb then issues:=issues||jsonb_build_array('confirmed_checkout_duplicate'); end if;
  v_evidence:=jsonb_build_object('balance',lot-'issues'-'purchaseReferences',
    'checkoutDuplicates',duplicates,'ledger',coalesce((
      select md5(jsonb_agg(jsonb_build_array(e.id,e.quantity,e.lesson_id,l.status,l.starts_at,l.ends_at,l.service_id)
        order by e.id)::text)
      from public.package_credit_entries e left join public.lessons l on l.id=e.lesson_id
      where e.package_id=p_package),''));
  for issue in
    select value from jsonb_array_elements_text(issues)
    union select finding from credit_internal.reconciliation_cases where package_id=p_package
  loop
    select * into current_case from credit_internal.reconciliation_cases
      where package_id=p_package and finding=issue for update;
    if not found then
      insert into credit_internal.reconciliation_cases(student_id,package_id,finding,evidence)
        values(p_student,p_package,issue,v_evidence);
    elsif current_case.evidence is distinct from v_evidence
      or (coalesce((current_case.evidence->>'present')::boolean,true) is distinct from (issues ? issue)) then
      -- Keep completed decisions when the finding disappeared. Reopen only
      -- when the finding is present and its evidence materially changed.
      if current_case.evidence-'present' is distinct from v_evidence
        or coalesce((current_case.evidence->>'present')::boolean,true) is distinct from (issues ? issue) then
        update credit_internal.reconciliation_cases set evidence=v_evidence||jsonb_build_object('present',issues ? issue),
          status=case when issues ? issue and status in ('dismissed','resolved') then 'reopened' else status end,
          version=version+1
          where id=current_case.id;
        insert into public.audit_events(studio_id,actor_id,action,entity_type,entity_id,reason,correlation_id,source,before_state,after_state)
          values(studio,p_actor,'credits.case_evidence_changed','credit_case',current_case.id,'Package reconciliation evidence changed',
            gen_random_uuid()::text,'coach_portal',to_jsonb(current_case),
            (select to_jsonb(c) from credit_internal.reconciliation_cases c where c.id=current_case.id));
      end if;
    end if;
  end loop;
  return coalesce((select jsonb_agg(to_jsonb(c)||jsonb_build_object('history',coalesce((
      select jsonb_agg(to_jsonb(h) order by h.at desc) from (
        select a.created_at at,a.reason,
          coalesce(a.after_state->'case'->>'status',a.after_state->>'status') status
        from public.audit_events a where a.entity_id=c.id and a.entity_type='credit_case'
          and a.action in ('credits.case_decide','credits.case_evidence_changed')
        order by a.created_at desc,a.id limit 20
      ) h),'[]'::jsonb)) order by c.detected_at,c.id)
    from credit_internal.reconciliation_cases c where package_id=p_package and student_id=p_student),'[]'::jsonb);
end $$;
revoke all on function credit_internal.sync_reconciliation_cases(uuid,uuid,uuid) from public,anon,authenticated;

create function credit_internal.decide_reconciliation_case(p_student uuid,p_value jsonb,p_actor uuid,p_version integer)
returns jsonb language plpgsql set search_path='' as $$
declare current_case credit_internal.reconciliation_cases; next_case credit_internal.reconciliation_cases;
  target text:=p_value->>'status'; note text:=trim(p_value->>'reason');
  correction uuid:=(p_value->>'correctionId')::uuid;
begin
  if target is null or target not in ('under_review','resolved','dismissed','reopened') or note is null
    or char_length(note) not between 3 and 500 then raise exception 'VALIDATION_FAILED'; end if;
  select * into current_case from credit_internal.reconciliation_cases
    where id=(p_value->>'caseId')::uuid and student_id=p_student;
  if not found then raise exception 'FORBIDDEN'; end if;
  perform credit_internal.sync_reconciliation_cases(p_student,current_case.package_id,p_actor);
  select * into current_case from credit_internal.reconciliation_cases where id=current_case.id for update;
  if current_case.version<>p_version then raise exception 'VERSION_CONFLICT: Refresh the finding before deciding.'; end if;
  if target=current_case.status
    or (current_case.status in ('resolved','dismissed') and target<>'reopened')
    or (current_case.status not in ('resolved','dismissed') and target='reopened') then
    raise exception 'INVALID_TRANSITION'; end if;
  if correction is not null and (target<>'resolved' or not exists(
    select 1 from public.package_credit_entries e where e.id=correction and e.package_id=current_case.package_id
      and e.idempotency_key like 'package-correction:%')) then raise exception 'VALIDATION_FAILED'; end if;
  update credit_internal.reconciliation_cases set status=target,reason=note,reviewer=p_actor,reviewed_at=now(),
    correction_id=correction,version=version+1 where id=current_case.id returning * into next_case;
  return jsonb_build_object('before',to_jsonb(current_case),'case',to_jsonb(next_case));
end $$;
revoke all on function credit_internal.decide_reconciliation_case(uuid,jsonb,uuid,integer) from public,anon,authenticated;

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
    result:=credit_internal.review_student_package_credits(p_student,p_value);
    if p_value->>'packageId' is not null then
      result:=result||jsonb_build_object('cases',credit_internal.sync_reconciliation_cases(
        p_student,(p_value->>'packageId')::uuid,p_actor));
    end if;
    return result;
  end if;
  if p_key is null or length(p_key)<3 or length(p_key)>250 then raise exception 'VALIDATION_FAILED'; end if;
  select * into prior from credit_internal.credit_command_receipts where key=p_key;
  if prior.key is not null then
    if prior.student_id<>p_student or prior.actor_id is distinct from p_actor or prior.request<>request then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
    return prior.response||jsonb_build_object('duplicate',true);
  end if;
  if p_command='case_decide' then
    result:=credit_internal.decide_reconciliation_case(p_student,p_value,p_actor,p_version);
    before_balance:=result->'before';
  elsif p_command='package_correct' then
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
    values(s.studio_id,p_actor,'credits.'||p_command,case when p_command='case_decide' then 'credit_case' else 'student' end,
      case when p_command='case_decide' then (result->'case'->>'id')::uuid else s.id end,coalesce(p_value->>'reason','Coach reviewed credit coverage'),p_key,'coach_portal',before_balance,result)
    returning id into audit_id;
  result:=result||jsonb_build_object('auditEventId',audit_id);
  insert into credit_internal.credit_command_receipts(key,student_id,actor_id,request,response) values(p_key,s.id,p_actor,request,result);
  return result;
end $$;
