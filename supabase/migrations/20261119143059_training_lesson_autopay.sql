-- An authorization is immutable. A changed scope, lead time or payment cap
-- takes a new approval. The old arrangement remains in force until replaced.
create table training_internal.lesson_autopay_mandates (
  id uuid primary key,
  studio_id uuid not null references public.studios(id),
  student_id uuid not null references public.students(id),
  payer_id uuid not null,
  replaces_id uuid references training_internal.lesson_autopay_mandates(id),
  replaces_version integer,
  scope text not null check (scope in ('existing','future','existing_and_future')),
  lead_days integer not null check (lead_days >= 0),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  maximum_minor bigint not null check (maximum_minor between 1 and 99999999),
  timezone text not null,
  charge_time time not null,
  existing_terms jsonb not null,
  consent_version text not null,
  consented_at timestamptz not null default now(),
  setup_expires_at timestamptz not null default (now()+interval '2 hours'),
  authorized_at timestamptz,
  planning_since timestamptz,
  stripe_customer text,
  stripe_session text unique,
  stripe_setup_intent text unique,
  stripe_method text,
  method_label text,
  planned_at timestamptz,
  status text not null default 'pending_setup'
    check (status in ('pending_setup','active','paused','cancelled','replaced')),
  version integer not null default 1
);
alter table training_internal.lesson_autopay_mandates enable row level security;
create unique index lesson_autopay_open on training_internal.lesson_autopay_mandates(student_id)
  where status in ('active','paused');
create unique index lesson_autopay_setup on training_internal.lesson_autopay_mandates(student_id)
  where status='pending_setup';

create table training_internal.lesson_autopay_attempts (
  id uuid primary key default gen_random_uuid(),
  mandate_id uuid not null references training_internal.lesson_autopay_mandates(id),
  lesson_id uuid not null references public.lessons(id),
  starts_at timestamptz not null,
  pay_at timestamptz not null,
  amount_minor bigint not null check (amount_minor between 1 and 99999999),
  terms jsonb not null,
  state text not null
    check (state in ('planned','pay_now','review','in_flight','succeeded','failed','skipped')),
  stripe_intent text unique,
  reason text,
  submitted_at timestamptz,
  lease_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(mandate_id,lesson_id)
);
alter table training_internal.lesson_autopay_attempts enable row level security;
create index lesson_autopay_due on training_internal.lesson_autopay_attempts(pay_at,id)
  where state in ('planned','in_flight');
create unique index lesson_autopay_in_flight on training_internal.lesson_autopay_attempts(lesson_id)
  where state='in_flight';

create function training_internal.autopay_lesson_terms(p_lesson uuid)
returns jsonb language sql stable set search_path='' as $$
  select jsonb_build_object(
    'invoiceId',i.id,'invoiceVersion',i.version,'lineId',li->>'id','lessonId',l.id,
    'currency',i.currency,'amountMinor',line.amount_minor,'serviceId',l.service_id,
    'durationSeconds',extract(epoch from l.ends_at-l.starts_at),'priceMinor',l.price_minor
  )
  from public.lessons l
  join public.studio_invoices i on i.id=l.invoice_id and i.student_id=l.student_id and i.studio_id=l.studio_id
  cross join lateral jsonb_array_elements(i.items) li
  cross join lateral (
    select (li->>'unitMinor')::bigint-coalesce((li->>'paidMinor')::bigint,0)
      -coalesce((li->>'creditMinor')::bigint,0)-coalesce((li->>'waivedMinor')::bigint,0) as amount_minor
  ) line
  where l.id=p_lesson and l.status='scheduled' and l.payment_status in ('due','partially_paid')
    and l.package_id is null and not l.payment_needs_review and not l.invoice_payment_pending
    and i.status in ('open','partially_paid') and i.checkout_key is null
    and li->>'kind'='service' and li->>'quantity'='1' and li->'lessonIds'=jsonb_build_array(l.id)
    and not coalesce((li->>'cancelled')::boolean,false)
    and l.price_minor=(li->>'unitMinor')::bigint and l.paid_minor=coalesce((li->>'paidMinor')::bigint,0)
    and line.amount_minor between 1 and least(99999999,i.total_minor-i.paid_minor-i.credit_minor-i.waived_minor)
    and not exists (
      select 1 from public.studio_invoices another
      cross join lateral jsonb_array_elements(another.items) item
      where another.student_id=l.student_id and another.status not in ('draft','void')
        and not coalesce((item->>'cancelled')::boolean,false) and item->'lessonIds' ? l.id::text
        and (another.id<>i.id or item->>'id' is distinct from li->>'id')
    )
    and not exists (
      select 1 from public.lesson_participants lp join public.bookings b on b.id=lp.booking_id
      where lp.lesson_id=l.id and lp.student_id=l.student_id
        and (lp.status='cancelled' or b.status not in ('confirmed','completed')
          or b.payment_status in ('processing','not_required','paid','refunded')
          or b.payment_policy not in ('pay_later','pay_now'))
    )
$$;

create function training_internal.autopay_binding(p_terms jsonb)
returns jsonb language sql immutable set search_path='' as $$
  select p_terms - 'invoiceVersion' - 'amountMinor'
$$;

create function training_internal.autopay_when(p_start timestamptz,p_zone text,p_days integer,p_time time)
returns timestamptz language sql stable set search_path='' as $$
  select case when (instant.at_utc at time zone p_zone)=local.wall_time
    and not exists (
      select 1 from unnest(array[instant.at_utc-interval '1 day',instant.at_utc+interval '1 day']) probe
      cross join lateral (select (probe at time zone p_zone)-(probe at time zone 'UTC') as utc_offset) offset_at
      cross join lateral (select (local.wall_time-offset_at.utc_offset) at time zone 'UTC' as alternate) candidate
      where candidate.alternate<>instant.at_utc and (candidate.alternate at time zone p_zone)=local.wall_time
    ) then instant.at_utc end
  from (select ((p_start at time zone p_zone)::date-p_days)+p_time as wall_time) local
  cross join lateral (select local.wall_time at time zone p_zone as at_utc) instant
$$;

create function training_internal.autopay_studio_allows(p_m training_internal.lesson_autopay_mandates)
returns boolean language sql stable set search_path='' as $$
  select coalesce((
    select s.timezone=p_m.timezone and coalesce(s.settings->>'currency','USD')=p_m.currency
      and (s.settings #>> '{trainingAutopay,chargeAtLocal}') is not null
      and left(p_m.charge_time::text,5)=s.settings #>> '{trainingAutopay,chargeAtLocal}'
      and p_m.lead_days between (s.settings #>> '{trainingAutopay,minimumLeadDays}')::integer
        and (s.settings #>> '{trainingAutopay,maximumLeadDays}')::integer
      and p_m.maximum_minor<=(s.settings #>> '{trainingAutopay,maximumLessonMinor}')::bigint
    from public.studios s where s.id=p_m.studio_id
  ),false)
$$;

create function training_internal.autopay_portal_plan(p_m training_internal.lesson_autopay_mandates)
returns jsonb language sql stable set search_path='' as $$
  select jsonb_build_object(
    'id',p_m.id,'status',p_m.status,'scope',p_m.scope,'leadDays',p_m.lead_days,'version',p_m.version,
    'currency',p_m.currency,'maximumLessonMinor',p_m.maximum_minor,'timeZone',p_m.timezone,
    'authorizedAt',p_m.authorized_at,'methodLabel',p_m.method_label,'setupExpiresAt',p_m.setup_expires_at,
    'needsReauthorization',not training_internal.autopay_studio_allows(p_m),
    'lessons',coalesce((
      select jsonb_agg(jsonb_build_object('lessonId',a.lesson_id,'payAt',a.pay_at,
        'date',(a.starts_at at time zone p_m.timezone)::date,'amountMinor',a.amount_minor,
        'status',case when l.payment_needs_review then 'review'
          when a.state in ('skipped','failed','pay_now') and l.payment_status in ('paid','paid_by_credit','waived') then 'succeeded'
          else a.state end,
        'reason',case when l.payment_needs_review then 'This payment is under review.' else a.reason end) order by a.starts_at)
      from (select * from training_internal.lesson_autopay_attempts x
        where x.mandate_id=p_m.id and (x.starts_at >= now() or x.updated_at >= now()-interval '30 days')
        order by x.starts_at limit 100) a
      join public.lessons l on l.id=a.lesson_id
    ),'[]'::jsonb)
  )
$$;

create function training_internal.autopay_audit(p_m training_internal.lesson_autopay_mandates,p_action text)
returns void language sql set search_path='' as $$
  insert into public.audit_events(studio_id,actor_id,action,entity_type,entity_id,reason,correlation_id,source,after_state)
  values(p_m.studio_id,p_m.payer_id,'training.autopay_'||p_action,'lesson_autopay',p_m.id,
    'Lesson payment arrangement '||p_action,p_m.id::text||':'||p_m.version,'student_portal',
    jsonb_build_object('studentId',p_m.student_id,'scope',p_m.scope,'leadDays',p_m.lead_days,
      'currency',p_m.currency,'maximumMinor',p_m.maximum_minor,'consentVersion',p_m.consent_version,
      'status',p_m.status,'existingTerms',p_m.existing_terms))
$$;

create function training_internal.autopay_refresh(p_m training_internal.lesson_autopay_mandates)
returns void language plpgsql set search_path='' as $$
declare
  lesson public.lessons;
  job training_internal.lesson_autopay_attempts;
  old_terms jsonb;
  terms jsonb;
  due_at timestamptz;
  amount bigint;
  next_state text;
  reason text;
  terms_changed boolean;
begin
  if p_m.status<>'active' or not training_internal.is_lesson_payer(p_m.payer_id,p_m.student_id)
    or not training_internal.autopay_studio_allows(p_m) then
    return;
  end if;
  -- Only recorded authorizations and lessons created after activation qualify.
  for lesson in select l.* from public.lessons l
    where l.student_id=p_m.student_id and l.studio_id=p_m.studio_id
      and (l.starts_at>now() or exists (select 1 from training_internal.lesson_autopay_attempts a
        where a.mandate_id=p_m.id and a.lesson_id=l.id and a.state='planned'))
      and (p_m.existing_terms ? l.id::text or (p_m.scope<>'existing' and l.created_at>=p_m.authorized_at))
    order by l.starts_at,l.id
  loop
    select * into job from training_internal.lesson_autopay_attempts
      where mandate_id=p_m.id and lesson_id=lesson.id for update;
    if job.state in ('in_flight','succeeded','failed','review','pay_now') then continue; end if;
    terms:=training_internal.autopay_lesson_terms(lesson.id);
    if terms is null and lesson.starts_at>now() and lesson.status='scheduled'
      and (lesson.invoice_payment_pending or exists(select 1 from public.studio_invoices i
        where i.id=lesson.invoice_id and i.checkout_key is not null)) then
      continue;
    end if;
    if terms is null or lesson.starts_at<=now() then
      if job.state in ('planned','pay_now') then
        update training_internal.lesson_autopay_attempts
          set state='skipped',reason='Lesson or balance is unavailable',updated_at=now() where id=job.id;
      end if;
      continue;
    end if;
    old_terms:=coalesce(p_m.existing_terms->lesson.id::text,job.terms);
    amount:=(terms->>'amountMinor')::bigint;
    due_at:=training_internal.autopay_when(lesson.starts_at,p_m.timezone,p_m.lead_days,p_m.charge_time);
    terms_changed:=old_terms is not null and (
      training_internal.autopay_binding(old_terms)<>training_internal.autopay_binding(terms)
      or amount>(old_terms->>'amountMinor')::bigint
    );
    next_state:='planned';
    reason:=null;
    if terms_changed or terms->>'currency'<>p_m.currency or amount>p_m.maximum_minor then
      next_state:='review'; reason:='Payment terms changed. Review and authorize this lesson again.';
    elsif due_at is null then
      next_state:='review'; reason:='The configured payment time is unavailable on this date.';
    elsif due_at>=lesson.starts_at or (
      due_at<=now() and (job.state is distinct from 'planned' or job.starts_at<>lesson.starts_at
        or job.pay_at<>due_at or job.pay_at<p_m.planning_since)
    ) then
      next_state:='pay_now'; reason:='This lesson is inside the automatic payment window.';
    end if;
    insert into training_internal.lesson_autopay_attempts(mandate_id,lesson_id,starts_at,pay_at,amount_minor,terms,state,reason)
    values(p_m.id,lesson.id,lesson.starts_at,coalesce(due_at,lesson.starts_at),amount,terms,next_state,reason)
    on conflict (mandate_id,lesson_id) do update set starts_at=excluded.starts_at,pay_at=excluded.pay_at,
      amount_minor=excluded.amount_minor,state=excluded.state,reason=excluded.reason,updated_at=now()
      where (lesson_autopay_attempts.starts_at,lesson_autopay_attempts.pay_at,lesson_autopay_attempts.amount_minor,
        lesson_autopay_attempts.state,lesson_autopay_attempts.reason)
        is distinct from (excluded.starts_at,excluded.pay_at,excluded.amount_minor,excluded.state,excluded.reason);
  end loop;
end
$$;

-- The service supplies the verified payer (user commands) or a test-mode
-- Stripe result (provider commands). Direct callers have no RPC or table grants.
create function public.training_lesson_autopay(p_action text,p_value jsonb)
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
    if coalesce(p_value->>'session','') !~ '^cs_test_' or coalesce(p_value->>'customer','') !~ '^cus_'
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
    if coalesce(p_value->>'session','') !~ '^cs_test_' or coalesce(p_value->>'customer','') !~ '^cus_'
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
revoke all on function public.training_lesson_autopay(text,jsonb) from public,anon,authenticated;
grant execute on function public.training_lesson_autopay(text,jsonb) to service_role;

create function public.training_lesson_autopay_job(p_action text,p_value jsonb)
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
    where (x.lease_until is null or x.lease_until<=now())
      and (x.state='in_flight' or (x.state='planned' and x.pay_at<=now() and mandate.status='active'
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
revoke all on function public.training_lesson_autopay_job(text,jsonb) from public,anon,authenticated;
grant execute on function public.training_lesson_autopay_job(text,jsonb) to service_role;
