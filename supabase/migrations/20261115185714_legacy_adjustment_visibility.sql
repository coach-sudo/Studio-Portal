create or replace function public.command_student_credit_settings(
  p_student uuid,p_command text,p_value jsonb,p_version integer,p_key text,p_actor uuid
) returns jsonb language plpgsql security definer set search_path='' as $$
declare s public.students; prior credit_internal.credit_command_receipts; result jsonb; audit_id uuid; before_balance jsonb;
  request jsonb:=jsonb_build_object('command',p_command,'value',p_value,'version',p_version);
begin
  if p_command in ('bulk_package_preview','bulk_package_apply') then
    return credit_internal.bulk_package_adjustment(p_student,p_command,p_value,p_key,p_actor);
  end if;
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
    if p_value->'portalVisible' = 'false'::jsonb then
      insert into credit_internal.hidden_portal_credit_entries(entry_id) values((result->>'entryId')::uuid);
    end if;
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
    if p_value->'portalVisible'='false'::jsonb then
      insert into credit_internal.hidden_portal_credit_entries(entry_id)
      select e.id from public.package_credit_entries e join public.packages p on p.id=e.package_id
      where p.student_id=p_student and e.kind='adjustment' and (
        e.idempotency_key='credit-total:'||p_key||':add'
        or e.idempotency_key='credit-total:'||p_key||':'||e.package_id::text)
      on conflict do nothing;
    end if;
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

-- Read persisted cases through the same studio-scoped entry point used by
-- household credit administration. Keep private evidence out of the list.
create function credit_internal.credit_attention_cases(p_student uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare studio uuid;
begin
  select studio_id into studio from public.students where id=p_student and deleted_at is null;
  if studio is null or auth.uid() is null or not public.is_studio_coach(studio) then
    raise exception 'FORBIDDEN' using errcode='42501';
  end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id',c.id,'studentId',c.student_id,
    'packageId',c.package_id,'packageName',p.name,'finding',c.finding,'status',c.status)
    order by c.detected_at,c.id)
    from credit_internal.reconciliation_cases c
    join public.students s on s.id=c.student_id and s.studio_id=studio and s.deleted_at is null
    join public.packages p on p.id=c.package_id and p.student_id=s.id
    where c.status in ('needs_review','under_review','reopened')
      and coalesce(c.evidence->'present','true'::jsonb)='true'::jsonb),'[]');
end $$;

create function credit_internal.credit_expiration_command(p_student uuid,p_action text,p_value jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare studio uuid; actor uuid:=auth.uid(); lot public.packages; target uuid:=(p_value->>'packageId')::uuid;
  next_expiry timestamptz; reviewed jsonb; result jsonb; prior credit_internal.credit_command_receipts;
  request_key text:=p_value->>'key'; reason_text text:=trim(p_value->>'reason'); members uuid[];
begin
  select studio_id into studio from public.students where id=p_student and deleted_at is null;
  if studio is null or actor is null or not public.is_studio_coach(studio) then
    raise exception 'FORBIDDEN' using errcode='42501';
  end if;
  if p_action is null or p_action not in ('expiration_preview','expiration_apply','expiration_history') then raise exception 'VALIDATION_FAILED'; end if;
  if p_action='expiration_apply' then
    if reason_text is null or char_length(reason_text) not between 3 and 500
      or request_key is null or char_length(request_key) not between 8 and 120 then
      raise exception 'VALIDATION_FAILED: Enter a reason and confirm the expiration change.';
    end if;
    request_key:='credit-expiration:'||request_key;
    perform pg_advisory_xact_lock(hashtextextended(request_key,0));
    select * into prior from credit_internal.credit_command_receipts where key=request_key;
    if found then
      if prior.student_id<>p_student or prior.actor_id is distinct from actor or prior.request<>p_value
        then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
      return prior.response;
    end if;
    select array_agg(s.id order by s.id) into members from public.students s
      where s.studio_id=studio and s.deleted_at is null and (s.id=(
        select p.student_id from public.packages p where p.id=target)
        or exists(select 1 from credit_internal.credit_pool_members m where m.package_id=target and m.student_id=s.id));
    perform s.id from public.students s where s.id=any(members) order by s.id for update;
  end if;
  select p.* into lot from public.packages p where p.id=target and (
    exists(select 1 from public.students s where s.id=p.student_id and s.studio_id=studio and s.deleted_at is null)
    or exists(select 1 from credit_internal.credit_households h where h.id=p.household_id and h.studio_id=studio))
    for update;
  if not found then raise exception 'FORBIDDEN' using errcode='42501'; end if;
  if p_action='expiration_history' then
    return coalesce((select jsonb_agg(jsonb_build_object('id',e.id,'reason',e.reason,
      'oldExpiry',e.before_state->'oldExpiry','newExpiry',e.after_state->'newExpiry','createdAt',e.created_at)
      order by e.created_at desc,e.id)
      from public.audit_events e where e.studio_id=studio and e.entity_id=target and e.action='credits.expiration_changed'),'[]');
  end if;
  if p_value->>'operation'='extend' then
    next_expiry:=(p_value->>'expiresAt')::timestamptz;
    if next_expiry is null or next_expiry<=greatest(now(),lot.expires_at) then
      raise exception 'VALIDATION_FAILED: Choose a future expiration after the current expiration.';
    end if;
  elsif p_value->>'operation' is distinct from 'waive' then raise exception 'VALIDATION_FAILED';
  end if;
  if lot.expires_at is null then raise exception 'INVALID_TRANSITION: This pool has no expiration to change.'; end if;
  reviewed:=jsonb_build_object('packageId',lot.id,'oldExpiry',lot.expires_at,'newExpiry',next_expiry,
    'balance',public.package_credit_balance(lot.id),'reservations',coalesce((
      select jsonb_agg(jsonb_build_object('lessonId',l.id,'topic',l.topic,'startsAt',l.starts_at,
        'coveredBefore',l.starts_at<lot.expires_at and lot.expires_at>now(),
        'coveredAfter',next_expiry is null or l.starts_at<next_expiry) order by l.starts_at,l.id)
      from public.lessons l where l.status='scheduled' and exists(
        select 1 from public.package_credit_entries e where e.package_id=lot.id and e.lesson_id=l.id
        group by e.used_by_student_id having sum(e.quantity)<0 and not bool_or(e.kind='consumption'))
      ),'[]'));
  if p_action='expiration_preview' then return reviewed; end if;
  if p_value->'preview' is distinct from reviewed then
    return jsonb_build_object('status','stale','preview',reviewed);
  end if;
  update public.packages set expires_at=next_expiry,version=version+1,updated_at=now() where id=target;
  perform credit_internal.enqueue_coverage(s.id) from public.students s where s.id=any(members) order by s.id;
  result:=jsonb_build_object('status','completed','newExpiry',next_expiry);
  insert into public.audit_events(studio_id,actor_id,action,entity_type,entity_id,reason,
    correlation_id,source,before_state,after_state)
    values(studio,actor,'credits.expiration_changed','package',target,reason_text,request_key,'coach_portal',reviewed,result);
  insert into credit_internal.credit_command_receipts(key,student_id,actor_id,request,response)
    values(request_key,p_student,actor,p_value,result);
  return result;
end $$;

revoke all on function credit_internal.credit_attention_cases(uuid),
  credit_internal.credit_expiration_command(uuid,text,jsonb) from public,anon;
grant execute on function credit_internal.credit_attention_cases(uuid),
  credit_internal.credit_expiration_command(uuid,text,jsonb) to authenticated;
create or replace function public.household_credit_access(p_student uuid,p_action text,p_value jsonb default '{}'::jsonb)
returns jsonb language sql security invoker set search_path='' as $$
  select case
    when p_action='attention_cases' then credit_internal.credit_attention_cases(p_student)
    when p_action in ('expiration_preview','expiration_apply','expiration_history')
      then credit_internal.credit_expiration_command(p_student,p_action,p_value)
    else credit_internal.household_credit_access(p_student,p_action,p_value)
  end
$$;

create or replace function credit_internal.bulk_package_adjustment(
  p_anchor uuid,p_command text,p_value jsonb,p_key text,p_actor uuid
) returns jsonb language plpgsql set search_path='' as $$
declare studio uuid; requested jsonb:=p_value->'rows'; reason_text text:=trim(p_value->>'reason');
  row_data record; review jsonb; previews jsonb:='[]'::jsonb; receipts jsonb:='[]'::jsonb;
  prior credit_internal.credit_command_receipts; mutation jsonb;
  request_value jsonb:=jsonb_build_object('command',p_command,'value',p_value);
  lot public.packages; entry uuid; audit_id uuid; current_version integer; response jsonb; conflicts boolean:=false; after_unused integer;
begin
  select s.studio_id into studio from public.students s where s.id=p_anchor and s.deleted_at is null;
  if studio is null or p_actor is null or not exists(select 1 from public.memberships m
     where m.studio_id=studio and m.user_id=p_actor and m.role='coach') then raise exception 'FORBIDDEN'; end if;
  if jsonb_typeof(requested) is distinct from 'array' or jsonb_array_length(requested) not between 1 and 25
    or reason_text is null or char_length(reason_text) not between 3 and 500
    or p_key is null or char_length(p_key) not between 8 and 200 then raise exception 'VALIDATION_FAILED'; end if;
  if (select count(distinct (x->>'packageId')::uuid) from jsonb_array_elements(requested) x)<>jsonb_array_length(requested)
    or not exists(select 1 from jsonb_array_elements(requested) x where (x->>'studentId')::uuid=p_anchor)
    or exists(select 1 from jsonb_array_elements(requested) x
      where jsonb_typeof(x->'delta') is distinct from 'number'
        or (x->>'delta')::integer not between -100000 and 100000 or (x->>'delta')::integer=0)
    then raise exception 'VALIDATION_FAILED'; end if;

  -- Lock every student before any lot; all batch requests take the same order.
  perform s.id from public.students s where s.id in (
    select (x->>'studentId')::uuid from jsonb_array_elements(requested) x
  ) order by s.id for update;
  if p_command='bulk_package_apply' then
    perform pg_advisory_xact_lock(hashtextextended('bulk-credit:'||p_key,0));
    select * into prior from credit_internal.credit_command_receipts where key=p_key;
    if found then
      if prior.student_id<>p_anchor or prior.actor_id is distinct from p_actor or prior.request<>request_value
        then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
      return prior.response||jsonb_build_object('duplicate',true);
    end if;
  end if;
  perform p.id from public.packages p where p.id in (
    select (x->>'packageId')::uuid from jsonb_array_elements(requested) x
  ) order by p.id for update;

  if exists(select 1 from jsonb_array_elements(requested) x where not exists(
    select 1 from public.students s join public.packages p on p.id=(x->>'packageId')::uuid
    where s.id=(x->>'studentId')::uuid and s.studio_id=studio and s.deleted_at is null and (
      p.student_id=s.id or (p.household_id is not null and credit_internal.student_may_spend_pool(p.id,s.id))
    ))) then raise exception 'FORBIDDEN'; end if;

  for row_data in select (x->>'studentId')::uuid student_id,(x->>'packageId')::uuid package_id,
      (x->>'delta')::integer delta from jsonb_array_elements(requested) x order by 1,2
  loop
    select * into strict lot from public.packages where id=row_data.package_id;
    if lot.household_id is not null then
      review:=jsonb_build_object('version',lot.version,'selected',
        credit_internal.shared_pool_projection(lot.id,'{}',true)||jsonb_build_object('issues',case
          when exists(select 1 from credit_internal.package_credit_terms t
            where t.package_id=lot.id and t.issuance_entry_id is not null
              and t.duration_minutes is not null and cardinality(t.service_ids)>0)
          then '[]'::jsonb else '["missing_issuance"]'::jsonb end),
        'reservations',coalesce((select jsonb_agg(jsonb_build_object('id',l.id,'topic',l.topic,
          'startsAt',l.starts_at,'studentId',v.student_id) order by l.starts_at,l.id,v.student_id)
          from credit_internal.shared_pool_usage(lot.id) v join public.lessons l on l.id=v.lesson_id
          where v.reserved>0),'[]'));
    else
      review:=credit_internal.review_student_package_credits(row_data.student_id,
        jsonb_build_object('packageId',row_data.package_id));
    end if;
    current_version:=(review->>'version')::integer;
    after_unused:=(review->'selected'->>'unused')::integer+row_data.delta;
    previews:=previews||jsonb_build_array(jsonb_build_object(
      'studentId',row_data.student_id,'packageId',row_data.package_id,'version',current_version,
      'delta',row_data.delta,'before',review->'selected','afterUnused',after_unused,
      'conflict',case
        when (review->'selected'->>'expiresAt')::timestamptz<=now() then 'expired'
        when (review->'selected'->>'available')::integer+row_data.delta<0 then 'reserved_or_unavailable'
        when (review->'selected'->'issues') ?| array['negative_ledger','missing_issuance','orphaned_debit',
          'cancelled_lesson_debit','duplicate_lesson_debit','expired_reservation','conflicting_package_allocations']
          then 'reconciliation_required' end,
      'reservations',review->'reservations'));
  end loop;
  select exists(select 1 from jsonb_array_elements(previews) x where x->>'conflict' is not null) into conflicts;
  if p_command='bulk_package_preview' then
    return jsonb_build_object('status','preview','rows',previews,'canApply',not conflicts);
  end if;
  if previews is distinct from p_value->'preview' then
    return jsonb_build_object('status','stale','rows',previews,'canApply',not conflicts);
  end if;
  if conflicts then return jsonb_build_object('status','unapplied','rows',previews,'canApply',false); end if;

  for row_data in select x from jsonb_array_elements(previews) x loop
    select * into strict lot from public.packages where id=(row_data.x->>'packageId')::uuid;
    if lot.household_id is not null then
      insert into public.package_credit_entries(package_id,kind,quantity,reason,idempotency_key,created_by)
        values(lot.id,'adjustment',(row_data.x->>'delta')::integer,reason_text,
          'bulk-row:'||md5(p_key)||':'||lot.id::text,p_actor) returning id into entry;
      update public.packages set version=version+1,updated_at=now() where id=lot.id;
      if p_value->'portalVisible'='false'::jsonb then
        insert into credit_internal.hidden_portal_credit_entries(entry_id) values(entry);
      end if;
      mutation:=jsonb_build_object('entryId',entry,'packageId',lot.id,'householdId',lot.household_id,
        'delta',(row_data.x->>'delta')::integer,'unused',(row_data.x->>'afterUnused')::integer,
        'available',public.package_credit_balance(lot.id));
      insert into public.audit_events(studio_id,actor_id,action,entity_type,entity_id,reason,
        correlation_id,source,before_state,after_state)
        values(studio,p_actor,'credits.package_correct','package',lot.id,reason_text,p_key,
          'coach_portal',row_data.x->'before',mutation) returning id into audit_id;
      receipts:=receipts||jsonb_build_array(mutation||jsonb_build_object('auditEventId',audit_id));
      continue;
    end if;
    select coalesce((select version from public.student_credit_accounts where student_id=(row_data.x->>'studentId')::uuid),1)
      into current_version;
    mutation:=public.command_student_credit_settings((row_data.x->>'studentId')::uuid,'package_correct',
      jsonb_build_object('packageId',row_data.x->>'packageId','operation',case when (row_data.x->>'delta')::integer>0 then 'add' else 'remove' end,
        'quantity',abs((row_data.x->>'delta')::integer),'reason',reason_text,'reviewedLot',row_data.x->'before',
        'portalVisible',coalesce((p_value->>'portalVisible')::boolean,true)),
      current_version,'bulk-row:'||md5(p_key)||':'||(row_data.x->>'packageId'),p_actor);
    receipts:=receipts||jsonb_build_array(mutation);
  end loop;
  response:=jsonb_build_object('status','completed','rows',previews,'receipts',receipts);
  insert into credit_internal.credit_command_receipts(key,student_id,actor_id,request,response)
    values(p_key,p_anchor,p_actor,request_value,response);
  return response;
end $$;

create or replace function credit_internal.read_student_credit_history(p_student uuid,p_page integer)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare coach boolean;
begin
  perform credit_internal.require_student_finance(p_student);
  if p_page is null or p_page not between 1 and 1000000 then raise exception 'VALIDATION_FAILED'; end if;
  select public.is_studio_coach(s.studio_id) into coach from public.students s where s.id=p_student;
  return (with visible as materialized (
    select e.*,p.name from public.package_credit_entries e
    join public.packages p on p.id=e.package_id
    where (p.student_id=p_student or (p.household_id is not null and e.kind='adjustment'
      and e.lesson_id is null and credit_internal.student_may_spend_pool(p.id,p_student)))
    and (coach or not exists (
      select 1 from credit_internal.hidden_portal_credit_entries h where h.entry_id=e.id))
  ) select jsonb_build_object('studentId',p_student,'page',p_page,
    'total',(select count(*) from visible),
    'items',coalesce((select jsonb_agg(jsonb_build_object(
      'id',e.id,'quantity',e.quantity,'kind',e.kind,'createdAt',e.created_at,
      'packageName',e.name,'reason',case when coach then e.reason end)
      order by e.created_at desc,e.id)
      from (select * from visible order by created_at desc,id limit 25 offset (p_page-1)*25) e),'[]'::jsonb)));
end $$;
