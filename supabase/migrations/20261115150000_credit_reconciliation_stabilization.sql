create function credit_internal.available_lesson_package(
  p_student uuid,p_studio uuid,p_service uuid,p_duration interval,p_start timestamptz,
  p_allocated jsonb,p_package uuid,p_automatic boolean
) returns uuid language sql stable set search_path='' as $$
  select p.id from public.packages p
  where p.student_id=p_student and (p_package is null or p.id=p_package)
    and (not p_automatic or p.auto_apply)
    and credit_internal.package_terms_match(p.id,p_studio,p_service,p_duration) is not false
    and (p.expires_at is null or p.expires_at>greatest(now(),p_start))
    and public.package_credit_balance(p.id)>coalesce((p_allocated->>p.id::text)::integer,0)
  order by p.expires_at nulls last,p.created_at,p.id limit 1
$$;
revoke all on function credit_internal.available_lesson_package(uuid,uuid,uuid,interval,timestamptz,jsonb,uuid,boolean) from public,anon,authenticated;

create function public.booking_credit_preflight(p_student uuid,p_service uuid,p_starts timestamptz[])
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare svc public.booking_services; occurrence timestamptz; chosen uuid;
  allocated jsonb:='{}'; covered integer:=0; uncertain boolean:=false;
begin
  select b.* into svc from public.booking_services b join public.students s on s.studio_id=b.studio_id
    where b.id=p_service and s.id=p_student and s.deleted_at is null;
  if not found then raise exception 'FORBIDDEN'; end if;
  if coalesce(cardinality(p_starts),0) not between 1 and 52
    or array_position(p_starts,null) is not null then raise exception 'VALIDATION_FAILED'; end if;
  if (public.student_credit_summary(p_student)->>'needsReview')::boolean then
    return jsonb_build_object('status','review_required','eligibleOccurrences',0);
  end if;
  for occurrence in select unnest(p_starts) order by 1 loop
    chosen:=credit_internal.available_lesson_package(p_student,svc.studio_id,svc.id,
      make_interval(mins=>svc.duration_minutes),occurrence,allocated,null,false);
    if chosen is null then continue; end if;
    covered:=covered+1;
    uncertain:=uncertain or credit_internal.package_terms_match(chosen,svc.studio_id,svc.id,
      make_interval(mins=>svc.duration_minutes)) is null;
    allocated:=jsonb_set(allocated,array[chosen::text],to_jsonb(coalesce((allocated->>chosen::text)::integer,0)+1));
  end loop;
  return jsonb_build_object('status',case
    when covered<cardinality(p_starts) then 'needs_credit'
    when uncertain then 'legacy_eligible'
    else 'eligible' end,'eligibleOccurrences',covered);
end $$;
revoke all on function public.booking_credit_preflight(uuid,uuid,timestamptz[]) from public,anon,authenticated;
grant execute on function public.booking_credit_preflight(uuid,uuid,timestamptz[]) to service_role;

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
  select coalesce(jsonb_agg(jsonb_build_object('entryId',a.id,'relatedEntryId',b.id,'intent',a.intent)
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
        select p.* into pkg from public.packages p where p.id=credit_internal.available_lesson_package(
          p_student,l.studio_id,l.service_id,l.ends_at-l.starts_at,l.starts_at,p_allocated,p_package,
          p_mode='automatic' and enabled is distinct from true);
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

create or replace function credit_internal.read_student_credit_coverage(
  p_student uuid, p_page integer, p_page_size integer, p_preview_enable boolean
) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  summary jsonb;
  l record;
  result jsonb;
  items jsonb := '[]'::jsonb;
  allocated jsonb := '{}'::jsonb;
  total integer := 0;
  covered integer := 0;
  eligible integer := 0;
  uncovered integer := 0;
  review_required integer := 0;
  selected_package text;
  lessons_visible boolean;
  student_status text;
begin
  perform credit_internal.require_student_finance(p_student);
  if p_page is null or p_page < 1 or p_page > 1000000
     or p_page_size is null or p_page_size < 1 or p_page_size > 100
     or p_preview_enable is null then
    raise exception 'VALIDATION_FAILED: Coverage page size must be 1-100.' using errcode = '22023';
  end if;
  summary := public.student_credit_summary(p_student);
  lessons_visible := current_setting('role', true) = 'service_role' or public.can_view_student_schedule(p_student);
  if lessons_visible then
    for l in select x.id, x.topic, x.starts_at, x.ends_at, x.version, x.service_id from public.lessons x
      join public.students s on s.id = p_student and s.studio_id = x.studio_id
      where x.status = 'scheduled' and x.starts_at >= now()
        and (x.student_id = p_student or exists(select 1 from public.lesson_participants lp
          where lp.lesson_id = x.id and lp.student_id = p_student and lp.status in ('reserved', 'confirmed')))
      order by x.starts_at, x.id
    loop
      result := credit_internal.evaluate_student_lesson_credit(p_student, l.id,
        case when p_preview_enable then 'enable_preview' else 'automatic' end, allocated, null,
        (summary->>'needsReview')::boolean);
      total := total + 1;
      if result->>'state' = 'covered' then covered := covered + 1;
      elsif (result->>'eligible')::boolean then
        eligible := eligible + 1;
        selected_package := result->>'packageId';
        allocated := jsonb_set(allocated, array[selected_package],
          to_jsonb(coalesce((allocated->>selected_package)::integer, 0) + 1));
      else
        uncovered := uncovered + 1;
        if result->>'state' = 'review_required' then review_required := review_required + 1; end if;
      end if;
      student_status:=case
        when result->>'state'='covered' then case when credit_internal.package_lesson_matches(
          (result->>'packageId')::uuid,l.id) is true then 'covered' else 'studio_review' end
        when result->>'reasonCode'='payment_pending' then 'processing'
        when result->>'reasonCode'='expires_before_lesson' and result->>'existingReservation'='true' then 'expiration_review'
        when result->>'state'='review_required' then 'studio_review'
        when result->>'reasonCode' in ('cash_paid','partially_paid','lesson_ineligible') then 'separate_payment'
        when exists(select 1 from public.lesson_participants lp join public.bookings b on b.id=lp.booking_id
          where lp.lesson_id=l.id and b.student_id=p_student and b.status='confirmed' and b.payment_policy='credits')
          then case when result->>'state'='eligible_unreserved' then 'awaiting_reservation'
            when result->>'reasonCode'='auto_disabled' then 'studio_review' else 'needs_credit' end
        else 'separate_payment' end;
      if total > (p_page::bigint - 1) * p_page_size and total <= p_page::bigint * p_page_size then
        items := items || jsonb_build_array(result || jsonb_build_object(
          'coverageStatus',student_status,'serviceId',l.service_id,
          'durationMinutes',extract(epoch from l.ends_at-l.starts_at)/60,'lessonId', l.id, 'topic', l.topic, 'startsAt', l.starts_at, 'endsAt', l.ends_at, 'version', l.version));
      end if;
    end loop;
  end if;
  return jsonb_build_object('studentId', p_student, 'evaluatedAt', now(),
    'summary', summary - 'lots',
    'packages', coalesce((select jsonb_agg(jsonb_build_object(
      'id', v->'id','name', v->'name','durationMinutes', v->'durationMinutes',
      'services', v->'services','expiresAt', v->'expiresAt','unused', v->'unused',
      'reserved', v->'reserved','available', v->'available','consumed', v->'consumed',
      'eligibilityVerified', v->'terms' is not null and v->'terms'<>'null'::jsonb
        and not ((v->'issues') ? 'eligibility_unverified')
    ) order by p.created_at desc,p.id)
    from public.packages p cross join lateral credit_internal.package_credit_review(p_student,p.id) v
    where p.student_id=p_student),'[]'::jsonb),
    'maintenance', (select jsonb_build_object('pending',generation>completed_generation,
      'requestedVersion',requested_version,'completedVersion',completed_version,'attempts',attempts,
      'lastError',last_error,'updatedAt',updated_at) from credit_internal.credit_coverage_jobs where student_id=p_student), 'previewEnable', p_preview_enable,
    'settingReasonCode', case when summary->'autoApply' = 'null'::jsonb then 'mixed_settings_review' end,
    'lessonsVisible', lessons_visible, 'items', items,
    'page', p_page, 'pageSize', p_page_size, 'total', case when lessons_visible then total end,
    'hasMore', lessons_visible and total > p_page::bigint * p_page_size,
    'counts', case when lessons_visible then jsonb_build_object('covered', covered,
      'eligible', eligible, 'uncovered', uncovered, 'reviewRequired', review_required) end);
end;
$$;

create or replace function public.process_stripe_checkout(event_id text,event_type text,event_payload jsonb,session_id text,student_id uuid,package_id uuid,amount_minor bigint,currency text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare coverage jsonb; pkg public.packages; payment_id uuid; duplicate boolean:=false; prior_status text;
  intent text:=event_payload #>> '{data,object,payment_intent}';
begin
  perform 1 from public.students where id=student_id and deleted_at is null for update;
  if not found then raise exception 'STUDENT_NOT_FOUND'; end if;
  perform credit_internal.lock_upcoming(student_id);
  select status into prior_status from public.webhook_events where id=event_id for update;
  if prior_status='processed' then return jsonb_build_object('duplicate',true,'eventId',event_id); end if;
  insert into public.webhook_events(id,provider,event_type,payload,status) values(event_id,'stripe',event_type,event_payload,'processing')
  on conflict(id) do update set event_type=excluded.event_type,payload=excluded.payload,status='processing',error=null,processed_at=null;
  select * into pkg from public.packages where id=package_id and packages.student_id=process_stripe_checkout.student_id for update;
  if pkg.id is null then update public.webhook_events set status='failed',error='Package not found',processed_at=now() where id=event_id; raise exception 'PACKAGE_NOT_FOUND'; end if;
  if intent ~ '^pi_[A-Za-z0-9_]+$' and event_payload #>> '{data,object,id}'=session_id then
    perform pg_advisory_xact_lock(hashtextextended('stripe-package-intent:'||intent,0));
    if exists(select 1 from public.webhook_events w join public.package_credit_entries e
      on e.idempotency_key='stripe-credit:'||(w.payload #>> '{data,object,id}')
      where w.provider='stripe' and w.status='processed'
        and w.payload #>> '{data,object,payment_intent}'=intent
        and w.payload #>> '{data,object,id}'<>session_id and e.kind='purchase' and e.quantity>0) then
      update public.webhook_events set status='processed',processed_at=now(),error=null where id=event_id;
      return jsonb_build_object('duplicate',true,'eventId',event_id,'duplicateEvidence','stripe_payment_intent');
    end if;
  end if;
  insert into public.payment_entries(student_id,package_id,kind,amount_minor,currency,external_reference,reason)
  values(student_id,package_id,'payment',amount_minor,upper(currency),session_id,'Stripe Checkout payment')
  on conflict(external_reference) do nothing returning id into payment_id;
  if payment_id is not null then
    insert into public.package_credit_entries(package_id,kind,quantity,reason,idempotency_key)
    values(package_id,'purchase',pkg.credit_quantity,'Stripe Checkout purchase','stripe-credit:'||session_id) on conflict(idempotency_key) do nothing;
  else duplicate:=true; end if;
  coverage:=credit_internal.request_coverage(student_id);
  update public.webhook_events set status='processed',processed_at=now(),error=null where id=event_id;
  return jsonb_build_object('creditCoverage',coverage,'duplicate',duplicate,'eventId',event_id,'paymentId',payment_id);
exception when others then update public.webhook_events set status='failed',error=sqlerrm,processed_at=now() where id=event_id; raise;
end $$;
