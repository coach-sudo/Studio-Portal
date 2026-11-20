-- Preserve the installed training migration history while tightening the provider boundaries.
create or replace function public.training_lesson_checkout(p_action text,p_value jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  attempt training_internal.lesson_checkouts;
  actor uuid := (p_value->>'actor')::uuid;
  attempt_id uuid := (p_value->>'id')::uuid;
  provider_session text := p_value->>'session';
  provider_intent text := p_value->>'intent';
  invoice_group record;
  claim text := 'training:'||attempt_id;
  target_status text;
begin
  if p_action='payers' then
    return jsonb_build_object(
      'studentIds',coalesce((
        select jsonb_agg(s) from jsonb_array_elements_text(p_value->'studentIds') s
        where training_internal.is_lesson_payer(actor,s::uuid)
      ),'[]'::jsonb),
      'attempts',coalesce((
        select jsonb_agg(jsonb_build_object('id',a.id,'studentId',a.return_student_id,'status',a.status,'createdAt',a.created_at) order by a.created_at desc)
        from training_internal.lesson_checkouts a
        where a.payer_user_id=actor and a.status in ('reserved','review')
          and (p_value->'studentIds') ? a.return_student_id::text
          and training_internal.is_lesson_payer(actor,a.return_student_id)
          and not exists (select 1 from training_internal.lesson_autopay_attempts scheduled
            where scheduled.id=a.id)
      ),'[]'::jsonb)
    );
  end if;
  -- The worker owns these reservations, including the interval before Stripe attaches an intent.
  if p_action in ('reserve','read') and exists (
    select 1 from training_internal.lesson_autopay_attempts scheduled where scheduled.id=attempt_id
  ) then raise exception 'NOT_FOUND'; end if;
  if p_action='reserve' then
    attempt:=training_internal.reserve_lesson_checkout(p_value);
    return to_jsonb(attempt)-'payer_user_id'-'selection';
  end if;
  if p_action='review' then
    select id into attempt_id from training_internal.lesson_checkouts
      where stripe_payment_intent_id=provider_intent;
    if not found then return null; end if;
    claim:='training:'||attempt_id;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(claim,0));
  select * into attempt from training_internal.lesson_checkouts where id=attempt_id for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if p_action='review' then
    if attempt.status='settled' then
      perform s.id from public.students s where s.id in (
        select (a->>'studentId')::uuid from jsonb_array_elements(attempt.allocations) a
      ) order by s.id for update;
      update training_internal.lesson_checkouts set status='review',updated_at=now()
        where id=attempt_id returning * into attempt;
      update public.lessons set payment_needs_review=true,version=version+1,updated_at=now()
        where id in (select (a->>'lessonId')::uuid from jsonb_array_elements(attempt.allocations) a);
      insert into public.audit_events(studio_id,action,entity_type,entity_id,reason,correlation_id,source,after_state)
        values(attempt.studio_id,'training.checkout_review','training_checkout',attempt.id,
          'Stripe reported a refund or dispute',p_value->>'eventId','stripe',
          jsonb_build_object('stripePaymentIntentId',provider_intent,'allocations',attempt.allocations));
    end if;
    return jsonb_build_object('id',attempt.id,'status',attempt.status);
  end if;
  if p_action='read' then
    if attempt.payer_user_id is distinct from actor
      or (attempt.status='reserved' and exists (
        select 1 from jsonb_array_elements(attempt.allocations) a
        where not training_internal.is_lesson_payer(actor,(a->>'studentId')::uuid)
      )) then raise exception 'FORBIDDEN'; end if;
    return to_jsonb(attempt)-'payer_user_id'-'selection';
  end if;
  if p_action not in ('attach','settle','expire','fail') or provider_session is null
    or p_value->>'currency' is distinct from lower(attempt.currency)
    or (p_value->>'amountMinor')::bigint is distinct from attempt.amount_minor
    or (provider_intent is not null and attempt.stripe_payment_intent_id is not null
      and provider_intent<>attempt.stripe_payment_intent_id)
    or (attempt.stripe_session_id is not null and attempt.stripe_session_id<>provider_session) then
    raise exception 'VERSION_CONFLICT: Stripe session does not match the lesson selection.';
  end if;
  if attempt.status<>'reserved' then
    if p_action='settle' and attempt.status not in ('settled','review') then
      raise exception 'INVALID_TRANSITION: A paid session requires reconciliation.';
    end if;
    return to_jsonb(attempt)-'payer_user_id'-'selection';
  end if;
  if p_action='attach' then
    update training_internal.lesson_checkouts set stripe_session_id=provider_session,
      stripe_payment_intent_id=coalesce(provider_intent,stripe_payment_intent_id),updated_at=now()
      where id=attempt_id returning * into attempt;
    return to_jsonb(attempt)-'payer_user_id'-'selection';
  end if;

  perform s.id from public.students s where s.id in (
    select (a->>'studentId')::uuid from jsonb_array_elements(attempt.allocations) a
  ) order by s.id for update;
  perform i.id from public.studio_invoices i where i.id in (
    select (a->>'invoiceId')::uuid from jsonb_array_elements(attempt.allocations) a
  ) order by i.id for update;

  target_status:=case p_action when 'settle' then 'settled' when 'expire' then 'expired' else 'failed' end;
  for invoice_group in
    select (a->>'invoiceId')::uuid as id,
      sum((a->>'amountMinor')::bigint)::bigint as amount,
      jsonb_agg(a order by a->>'lineId') as items
    from jsonb_array_elements(attempt.allocations) a group by 1 order by 1
  loop
    if not exists (select 1 from public.studio_invoices i
      where i.id=invoice_group.id and i.checkout_key=claim and i.checkout_amount=invoice_group.amount) then
      raise exception 'VERSION_CONFLICT: An invoice reservation changed.';
    end if;
    if p_action='settle' then
      perform set_config('app.invoice_checkout_key',claim,true);
      perform training_internal.settle_invoice(invoice_group.id,invoice_group.amount,'stripe',
        'training-stripe:'||provider_session||':'||invoice_group.id,null,invoice_group.items);
    end if;
    perform public.release_studio_invoice_checkout(invoice_group.id,claim);
  end loop;
  update training_internal.lesson_checkouts set status=target_status,
    stripe_session_id=provider_session,stripe_payment_intent_id=coalesce(provider_intent,stripe_payment_intent_id),
    updated_at=now() where id=attempt_id returning * into attempt;
  insert into public.audit_events(studio_id,action,entity_type,entity_id,reason,correlation_id,source,after_state)
    values(attempt.studio_id,'training.checkout_'||target_status,'training_checkout',attempt.id,
      'Verified Stripe checkout outcome',attempt.id::text,'stripe',
      jsonb_build_object('stripeSessionId',provider_session,'allocations',attempt.allocations));
  return to_jsonb(attempt)-'payer_user_id'-'selection';
end
$$;

create or replace function public.training_lesson_autopay(p_action text,p_value jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  actor uuid:=(p_value->>'actor')::uuid;
  student_id_arg uuid:=(p_value->>'studentId')::uuid;
  target uuid:=(p_value->>'id')::uuid;
  requested_replace uuid:=(p_value->>'replacesId')::uuid;
  m training_internal.lesson_autopay_mandates;
  previous training_internal.lesson_autopay_mandates;
  studio public.studios;
  lesson public.lessons;
  quote jsonb;
  selected jsonb:='{}';
  reviewed jsonb:='{}';
  digest text;
  chosen uuid;
  policy jsonb;
  chosen_scope text:=p_value->>'scope';
  days integer:=(p_value->>'leadDays')::integer;
  cap bigint:=(p_value->>'maximumLessonMinor')::bigint;
  session_prefix text := case when p_value->'livemode'='true'::jsonb then '^cs_live_' else '^cs_test_' end;
  active_plan jsonb;
  pending_plan jsonb;
begin
  if p_action in ('list','review','begin','setup_for_payer','pause','resume','cancel') then
    if not training_internal.is_lesson_payer(actor,student_id_arg) then raise exception 'FORBIDDEN'; end if;
    perform pg_advisory_xact_lock(hashtextextended('training-autopay:'||student_id_arg,0));
    update training_internal.lesson_autopay_mandates set status='cancelled',version=version+1
      where student_id=student_id_arg and status='pending_setup' and setup_expires_at<=now();
    select * into previous from training_internal.lesson_autopay_mandates
      where student_id=student_id_arg and status in ('active','paused') for update;
    if found and previous.payer_id<>actor then
      select * into m from training_internal.lesson_autopay_mandates where id=previous.id for update;
      update training_internal.lesson_autopay_mandates set status='cancelled',version=version+1
        where id=m.id returning * into m;
      perform training_internal.autopay_audit(m,'payer_changed');
      previous:=null;
    end if;
    if p_action='list' then
      if previous.id is not null then
        perform training_internal.autopay_refresh(previous);
        active_plan:=training_internal.autopay_portal_plan(previous);
      end if;
      select * into m from training_internal.lesson_autopay_mandates where student_id=student_id_arg
        and payer_id=actor and status='pending_setup';
      if found then pending_plan:=training_internal.autopay_portal_plan(m); end if;
      return jsonb_build_object('arrangement',active_plan,'pending',pending_plan);
    end if;
    if p_action in ('begin','review') then
      if (p_action='begin' and (target is null or p_value->>'consentVersion' is distinct from 'lesson-autopay-v1'
        or p_value->'consented' is distinct from 'true'::jsonb))
        or chosen_scope is null or chosen_scope not in ('existing','future','existing_and_future')
        or jsonb_typeof(p_value->'existingLessonIds') is distinct from 'array'
        or jsonb_array_length(p_value->'existingLessonIds')>50
        or (chosen_scope='future')<>(jsonb_array_length(p_value->'existingLessonIds')=0)
        or cap is null or cap not between 1 and 99999999 or days is null then
        raise exception 'VALIDATION_FAILED: Review and authorize the selected payment terms.';
      end if;
      if p_action='begin' then
        select * into m from training_internal.lesson_autopay_mandates where id=target for update;
        if found then
          if m.student_id<>student_id_arg or m.payer_id<>actor or m.status<>'pending_setup'
            or m.scope<>chosen_scope or m.lead_days<>days or m.maximum_minor<>cap
            or m.replaces_id is distinct from requested_replace
            or (select array_agg(x order by x) from jsonb_object_keys(m.existing_terms) x)
              is distinct from (select array_agg(x order by x) from jsonb_array_elements_text(p_value->'existingLessonIds') x)
            then raise exception 'VERSION_CONFLICT: Review the current authorization request.'; end if;
          return to_jsonb(m);
        end if;
        if previous.id is distinct from requested_replace or (
          previous.id is not null and previous.version is distinct from (p_value->>'expectedVersion')::integer
        ) then raise exception 'VERSION_CONFLICT: Review the current payment arrangement.'; end if;
        if exists(select 1 from training_internal.lesson_autopay_mandates
          where student_id=student_id_arg and status='pending_setup') then
          raise exception 'INVALID_TRANSITION: Finish or cancel the pending payment setup first.';
        end if;
      end if;
      select st.* into studio from public.studios st join public.students s on s.studio_id=st.id
        where s.id=student_id_arg;
      policy:=studio.settings->'trainingAutopay';
      if policy is null or coalesce(studio.settings->>'currency','USD') is distinct from p_value->>'currency'
        or coalesce(policy->>'chargeAtLocal','') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
        or days not between (policy->>'minimumLeadDays')::integer and (policy->>'maximumLeadDays')::integer
        or cap>(policy->>'maximumLessonMinor')::bigint
        or (policy->>'minimumLeadDays') is null or (policy->>'maximumLeadDays') is null
        or (policy->>'maximumLessonMinor') is null then
        raise exception 'VERSION_CONFLICT: Review the studio payment policy.';
      end if;
      for chosen in select x::uuid from jsonb_array_elements_text(p_value->'existingLessonIds') x loop
        select * into lesson from public.lessons where id=chosen and student_id=student_id_arg
          and studio_id=studio.id and starts_at>now();
        quote:=training_internal.autopay_lesson_terms(chosen);
        if not found or quote is null or quote->>'currency'<>p_value->>'currency'
          or (quote->>'amountMinor')::bigint>cap or selected ? chosen::text
          then raise exception 'VERSION_CONFLICT: Review the current dates and balances before authorizing.'; end if;
        selected:=selected||jsonb_build_object(chosen,quote);
        reviewed:=reviewed||jsonb_build_object(chosen,jsonb_build_object('startsAt',lesson.starts_at,
          'payAt',training_internal.autopay_when(lesson.starts_at,studio.timezone,days,(policy->>'chargeAtLocal')::time),
          'date',(lesson.starts_at at time zone studio.timezone)::date,
          'terms',quote-'invoiceVersion'));
      end loop;
      digest:=encode(sha256(convert_to(jsonb_build_object('payer',actor,'student',student_id_arg,'scope',chosen_scope,
        'leadDays',days,'cap',cap,'currency',p_value->>'currency','timezone',studio.timezone,
        'chargeTime',policy->>'chargeAtLocal','selected',reviewed)::text,'UTF8')),'hex');
      if p_action='review' then
        return jsonb_build_object('reviewDigest',digest,'reviewed',reviewed,'timeZone',studio.timezone,
          'evaluatedAt',now());
      end if;
      if p_value->>'reviewDigest' is distinct from digest then
        raise exception 'VERSION_CONFLICT: Review the current dates and balances before authorizing.';
      end if;
      insert into training_internal.lesson_autopay_mandates(id,studio_id,student_id,payer_id,replaces_id,replaces_version,
        scope,lead_days,currency,maximum_minor,timezone,charge_time,existing_terms,consent_version)
      values(target,studio.id,student_id_arg,actor,requested_replace,previous.version,chosen_scope,days,p_value->>'currency',
        cap,studio.timezone,(policy->>'chargeAtLocal')::time,selected,p_value->>'consentVersion') returning * into m;
      perform training_internal.autopay_audit(m,'consented');
      return to_jsonb(m);
    end if;
    select * into m from training_internal.lesson_autopay_mandates where id=target and student_id=student_id_arg
      and payer_id=actor for update;
    if not found then raise exception 'FORBIDDEN'; end if;
    if p_action='setup_for_payer' then
      if m.status<>'pending_setup' then return training_internal.autopay_portal_plan(m); end if;
      return to_jsonb(m);
    end if;
    if m.version is distinct from (p_value->>'expectedVersion')::integer
      then raise exception 'VERSION_CONFLICT: Review the current payment arrangement.'; end if;
    if p_action='pause' and m.status='active' then
      update training_internal.lesson_autopay_mandates set status='paused',version=version+1 where id=m.id returning * into m;
    elsif p_action='resume' and m.status='paused' then
      update training_internal.lesson_autopay_mandates set status='active',planning_since=now(),version=version+1
        where id=m.id returning * into m;
      perform training_internal.autopay_refresh(m);
    elsif p_action='cancel' and m.status in ('active','paused','pending_setup') then
      update training_internal.lesson_autopay_mandates set status='cancelled',version=version+1 where id=m.id returning * into m;
      if previous.id=m.id then
        update training_internal.lesson_autopay_mandates set status='cancelled',version=version+1
          where student_id=student_id_arg and status='pending_setup' and replaces_id=m.id;
      end if;
    else raise exception 'INVALID_TRANSITION: The payment arrangement has already changed.';
    end if;
    perform training_internal.autopay_audit(m,p_action);
    return training_internal.autopay_portal_plan(m);
  end if;

  select * into m from training_internal.lesson_autopay_mandates where id=target;
  if not found then raise exception 'NOT_FOUND'; end if;
  if p_action='setup_reference' then
    if m.status='pending_setup' and m.stripe_session is null then
      raise exception 'PROVIDER_UNAVAILABLE: Stripe setup is being recorded.';
    end if;
    return jsonb_build_object('session',m.stripe_session);
  end if;
  perform pg_advisory_xact_lock(hashtextextended('training-autopay:'||m.student_id,0));
  select * into m from training_internal.lesson_autopay_mandates where id=target for update;
  if p_action='setup_attach' and m.status='pending_setup' then
    if coalesce(p_value->>'session','') !~ session_prefix or coalesce(p_value->>'customer','') !~ '^cus_'
      or (m.stripe_customer is not null and m.stripe_customer is distinct from p_value->>'customer')
      or (m.stripe_session is not null and m.stripe_session is distinct from p_value->>'session') then
      raise exception 'VERSION_CONFLICT: Stripe setup does not match the authorization.';
    end if;
    update training_internal.lesson_autopay_mandates set stripe_customer=p_value->>'customer',stripe_session=p_value->>'session'
      where id=m.id returning * into m;
    return training_internal.autopay_portal_plan(m);
  end if;
  if p_action='setup_complete' then
    if m.status<>'pending_setup' then return training_internal.autopay_portal_plan(m); end if;
    if coalesce(p_value->>'session','') !~ session_prefix or coalesce(p_value->>'customer','') !~ '^cus_'
      or coalesce(p_value->>'intent','') !~ '^seti_' or coalesce(p_value->>'method','') !~ '^pm_'
      or m.stripe_session is distinct from p_value->>'session'
      or m.stripe_customer is distinct from p_value->>'customer' then
      raise exception 'VERSION_CONFLICT: Stripe setup does not match the authorization.';
    end if;
    if m.setup_expires_at<=now() or not training_internal.is_lesson_payer(m.payer_id,m.student_id) then
      update training_internal.lesson_autopay_mandates set status='cancelled',version=version+1 where id=m.id returning * into m;
      perform training_internal.autopay_audit(m,'setup_expired');
      return training_internal.autopay_portal_plan(m);
    end if;
    if not training_internal.autopay_studio_allows(m) then
      update training_internal.lesson_autopay_mandates set status='cancelled',version=version+1 where id=m.id returning * into m;
      perform training_internal.autopay_audit(m,'setup_needs_review');
      return training_internal.autopay_portal_plan(m);
    end if;
    if m.replaces_id is not null then
      update training_internal.lesson_autopay_mandates set status='replaced',version=version+1
        where id=m.replaces_id and student_id=m.student_id and payer_id=m.payer_id
          and status in ('active','paused') and version=m.replaces_version;
      if not found then
        update training_internal.lesson_autopay_mandates set status='cancelled',version=version+1 where id=m.id returning * into m;
        perform training_internal.autopay_audit(m,'setup_needs_review');
        return training_internal.autopay_portal_plan(m);
      end if;
    end if;
    update training_internal.lesson_autopay_mandates set stripe_customer=p_value->>'customer',
      stripe_session=p_value->>'session',stripe_setup_intent=p_value->>'intent',stripe_method=p_value->>'method',
      method_label=p_value->>'methodLabel',authorized_at=now(),planning_since=now(),status='active',version=version+1
      where id=m.id returning * into m;
    perform training_internal.autopay_refresh(m);
    perform training_internal.autopay_audit(m,'activated');
    return training_internal.autopay_portal_plan(m);
  end if;
  if p_action='setup_expired' then
    if m.status='pending_setup' and m.stripe_session=p_value->>'session' then
      update training_internal.lesson_autopay_mandates set status='cancelled',version=version+1 where id=m.id returning * into m;
      perform training_internal.autopay_audit(m,'setup_expired');
    end if;
    return training_internal.autopay_portal_plan(m);
  end if;
  raise exception 'INVALID_TRANSITION: The payment arrangement has already changed.';
end
$$;

create or replace function public.training_lesson_autopay_job(p_action text,p_value jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  target uuid:=(p_value->>'id')::uuid;
  m training_internal.lesson_autopay_mandates;
  a training_internal.lesson_autopay_attempts;
  l public.lessons;
  terms jsonb;
  attempt training_internal.lesson_checkouts;
  provider_id text:=p_value->>'intent';
  paid_state text:=p_value->>'status';
  session_key text;
  terminal_state text;
  still_eligible boolean;
begin
  if p_action='refresh' then
    for m in select * from training_internal.lesson_autopay_mandates
      where status='active' order by planned_at nulls first,id limit 100 for update skip locked
    loop
      perform training_internal.autopay_refresh(m);
      update training_internal.lesson_autopay_mandates set planned_at=now() where id=m.id;
    end loop;
    return '{}'::jsonb;
  end if;
  if p_action='claim' then
    select x.id into target from training_internal.lesson_autopay_attempts x
    join training_internal.lesson_autopay_mandates mandate on mandate.id=x.mandate_id
    left join public.lessons lesson on lesson.id=x.lesson_id
    where (x.lease_until is null or x.lease_until<=now())
      and (x.state='in_flight' or (x.state='planned' and x.pay_at<=now() and mandate.status='active'
        and lesson.status='scheduled' and lesson.starts_at=x.starts_at and lesson.starts_at>now()
        and x.pay_at>=mandate.planning_since
        and training_internal.is_lesson_payer(mandate.payer_id,mandate.student_id)
        and training_internal.autopay_studio_allows(mandate)))
    order by x.lease_until nulls first,x.pay_at,x.id limit 1;
    if target is null then return null; end if;
  end if;
  select mandate.* into m from training_internal.lesson_autopay_mandates mandate
    join training_internal.lesson_autopay_attempts job on job.mandate_id=mandate.id where job.id=target;
  if not found then raise exception 'NOT_FOUND'; end if;
  perform pg_advisory_xact_lock(hashtextextended('training-autopay:'||m.student_id,0));
  select * into m from training_internal.lesson_autopay_mandates where id=m.id for update;
  select * into a from training_internal.lesson_autopay_attempts where id=target for update;
  select * into l from public.lessons where id=a.lesson_id;
  still_eligible:=m.status='active' and l.status='scheduled' and l.starts_at=a.starts_at
    and l.starts_at>now() and a.pay_at>=m.planning_since
    and training_internal.is_lesson_payer(m.payer_id,m.student_id)
    and training_internal.autopay_studio_allows(m);
  if p_action='claim' then
    if a.lease_until>now() or a.state not in ('planned','in_flight') then return null; end if;
    if a.state='planned' then
      if not coalesce(still_eligible,false) or a.pay_at>now() then return null; end if;
      terms:=training_internal.autopay_lesson_terms(a.lesson_id);
      if terms is null or training_internal.autopay_binding(terms)<>training_internal.autopay_binding(a.terms)
        or (terms->>'amountMinor')::bigint>a.amount_minor then
        perform training_internal.autopay_refresh(m);
        update training_internal.lesson_autopay_attempts set lease_until=now()+interval '2 minutes'
          where id=a.id and state='planned';
        return null;
      end if;
      begin
        attempt:=training_internal.reserve_lesson_checkout(jsonb_build_object(
          'id',a.id,'actor',m.payer_id,'studentId',m.student_id,
          'items',jsonb_build_array(terms)
        ));
      exception when raise_exception then
        if sqlerrm !~ '^(VERSION_CONFLICT|INVALID_TRANSITION|FORBIDDEN)' then raise; end if;
        update training_internal.lesson_autopay_attempts set lease_until=now()+interval '2 minutes' where id=a.id;
        return null;
      end;
      update training_internal.lesson_autopay_attempts set state='in_flight',amount_minor=attempt.amount_minor,
        updated_at=now() where id=a.id returning * into a;
    end if;
    update training_internal.lesson_autopay_attempts set lease_until=now()+interval '2 minutes'
      where id=a.id returning * into a;
    return jsonb_build_object('id',a.id,'status',a.state,'intent',a.stripe_intent,'amountMinor',a.amount_minor,
      'currency',m.currency,'customer',m.stripe_customer,'method',m.stripe_method,
      'submitted',a.submitted_at is not null,'eligible',coalesce(still_eligible,false));
  end if;
  if a.state in ('succeeded','failed','skipped') then return jsonb_build_object('status',a.state); end if;
  if a.state<>'in_flight' then raise exception 'INVALID_TRANSITION: The payment attempt is unavailable.'; end if;
  if p_action in ('attach','reconcile') then
    if coalesce(provider_id,'') !~ '^pi_'
      or p_value->>'customer' is distinct from m.stripe_customer
      or (p_value->>'method' is not null and p_value->>'method' is distinct from m.stripe_method)
      or (p_value->>'amountMinor')::bigint is distinct from a.amount_minor
      or p_value->>'currency' is distinct from lower(m.currency)
      or (a.stripe_intent is not null and a.stripe_intent<>provider_id) then
      raise exception 'VERSION_CONFLICT: Stripe payment does not match the reserved lesson.';
    end if;
  end if;
  if p_action='attach' then
    if p_value->>'method' is distinct from m.stripe_method then raise exception 'VERSION_CONFLICT'; end if;
    perform public.training_lesson_checkout('attach',jsonb_build_object('id',a.id,'session','autopay:'||provider_id,
      'intent',provider_id,'amountMinor',a.amount_minor,'currency',lower(m.currency)));
    update training_internal.lesson_autopay_attempts set stripe_intent=provider_id,updated_at=now() where id=a.id;
    return jsonb_build_object('status','in_flight');
  end if;
  if p_action='submit' then
    if a.stripe_intent is null or a.stripe_intent is distinct from provider_id then raise exception 'VERSION_CONFLICT'; end if;
    -- The reservation prevents competing invoice and coverage work. Re-read the
    -- lesson immediately before granting permission to submit to Stripe.
    perform 1 from public.students where id=m.student_id for update;
    perform c.id from public.linked_contacts c where c.student_id=m.student_id order by c.id for share;
    select * into l from public.lessons where id=a.lesson_id for update;
    if a.submitted_at is not null then return jsonb_build_object('allowed',true); end if;
    if not coalesce(still_eligible,false) or l.starts_at<>a.starts_at or l.status<>'scheduled'
      or l.package_id is not null or l.payment_status not in ('due','partially_paid') or l.payment_needs_review
      or extract(epoch from l.ends_at-l.starts_at) is distinct from (a.terms->>'durationSeconds')::numeric
      or l.price_minor is distinct from (a.terms->>'priceMinor')::bigint
      or l.service_id is distinct from (a.terms->>'serviceId')::uuid
      or not training_internal.is_lesson_payer(m.payer_id,m.student_id)
      or not training_internal.autopay_studio_allows(m)
      or not exists(select 1 from public.studio_invoices i where i.id=l.invoice_id and i.checkout_key='training:'||a.id)
      then return jsonb_build_object('allowed',false); end if;
    update training_internal.lesson_autopay_attempts set submitted_at=now(),updated_at=now() where id=a.id;
    return jsonb_build_object('allowed',true);
  end if;
  if p_action='abandon' and a.stripe_intent is null and a.submitted_at is null
    and not coalesce(still_eligible,false) and a.lease_until>now() then
    session_key:='autopay:unsubmitted:'||a.id;
    terminal_state:='skipped';
  elsif p_action='reconcile' and a.stripe_intent=provider_id then
    session_key:='autopay:'||provider_id;
    if paid_state='succeeded' then
      if a.submitted_at is null or p_value->>'method' is distinct from m.stripe_method
        or (p_value->>'receivedMinor')::bigint is distinct from a.amount_minor then raise exception 'VERSION_CONFLICT'; end if;
      terminal_state:='succeeded';
    elsif paid_state='canceled' then
      terminal_state:=case when a.submitted_at is not null then 'failed' else 'skipped' end;
    else
      return jsonb_build_object('status','in_flight');
    end if;
  else
    raise exception 'INVALID_TRANSITION: The payment attempt is unavailable.';
  end if;
  perform public.training_lesson_checkout(case when terminal_state='succeeded' then 'settle' else 'fail' end,
    jsonb_build_object('id',a.id,'session',session_key,'intent',a.stripe_intent,
      'amountMinor',a.amount_minor,'currency',lower(m.currency)));
  update training_internal.lesson_autopay_attempts set state=terminal_state,lease_until=null,updated_at=now(),
    reason=case terminal_state when 'failed' then 'Automatic payment could not be completed. Use Pay now to pay this lesson.'
      when 'skipped' then 'This lesson is outside the automatic payment arrangement.' else null end
    where id=a.id;
  if terminal_state='failed' and m.status='active' then
    update training_internal.lesson_autopay_mandates set status='paused',version=version+1
      where id=m.id returning * into m;
    perform training_internal.autopay_audit(m,'payment_needs_attention');
  end if;
  insert into public.audit_events(studio_id,actor_id,action,entity_type,entity_id,reason,correlation_id,source,after_state)
    values(m.studio_id,m.payer_id,'training.autopay_'||terminal_state,'lesson_autopay_attempt',a.id,
      'Reconciled automatic lesson payment',a.id::text,'stripe',
      jsonb_build_object('lessonId',a.lesson_id,'amountMinor',a.amount_minor,'status',terminal_state));
  return jsonb_build_object('status',terminal_state);
end
$$;
