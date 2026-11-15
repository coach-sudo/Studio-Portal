create or replace function public.command_grant_student_credits(
  p_student uuid,p_key text,p_value jsonb,p_actor uuid default null
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  s public.students; pkg public.packages; entry public.package_credit_entries; prior credit_internal.credit_command_receipts;
  quantity integer:=(p_value->>'quantity')::integer; kind public.credit_entry_kind:=(p_value->>'kind')::public.credit_entry_kind;
  lid uuid:=(p_value->>'lessonId')::uuid; reason text:=trim(p_value->>'reason'); def public.package_definitions;
  result jsonb; coverage jsonb; audit_id uuid; request jsonb:=p_value;
  custom jsonb:=p_value->'customTerms'; svc public.booking_services;
  minutes integer; expires timestamptz; batch jsonb; review jsonb; batch_result jsonb; batch_key text;
begin
  select * into s from public.students where id=p_student and deleted_at is null for update;
  if s.id is null or (p_actor is not null and not exists(select 1 from public.memberships
    where user_id=p_actor and studio_id=s.studio_id and role='coach')) then raise exception 'FORBIDDEN'; end if;
  if p_key is null or length(p_key)<3 or length(p_key)>250 or quantity is null or quantity=0
    or abs(quantity)>100000 or kind is null or kind not in ('purchase','adjustment') or reason is null or length(reason)<3 then raise exception 'VALIDATION_FAILED'; end if;
  select * into prior from credit_internal.credit_command_receipts where key=p_key;
  if prior.key is not null then
    if prior.student_id<>p_student or prior.actor_id is distinct from p_actor or prior.request<>request then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
    return prior.response||jsonb_build_object('duplicate',true);
  end if;
  if lid is not null and not exists(select 1 from public.lessons where id=lid and student_id=s.id and studio_id=s.studio_id) then raise exception 'FORBIDDEN'; end if;
  perform credit_internal.lock_upcoming(p_student);
  -- Handle a pre-upgrade provider delivery key without granting it a second time.
  select * into entry from public.package_credit_entries where idempotency_key=p_key;
  if entry.id is not null then
    select * into pkg from public.packages where id=entry.package_id and student_id=s.id;
    if pkg.id is null or entry.quantity<>quantity or entry.kind<>kind or entry.lesson_id is distinct from lid
      or (p_value->>'packageId' is not null and pkg.id<>(p_value->>'packageId')::uuid) then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
  else
    if custom is not null then
      if p_actor is null or kind<>'adjustment' or quantity<1 or lid is not null
         or p_value ? 'packageId' or p_value ? 'package'
         or jsonb_typeof(custom) is distinct from 'object' then raise exception 'VALIDATION_FAILED'; end if;
      select * into svc from public.booking_services where id=(custom->>'serviceId')::uuid and studio_id=s.studio_id;
      minutes:=(custom->>'durationMinutes')::integer;
      expires:=(custom->>'expiresAt')::timestamptz;
      if svc.id is null or minutes is null or minutes not between 15 and 480
        or expires<=now() then raise exception 'VALIDATION_FAILED: Choose a studio service, a valid duration and a future expiration.'; end if;
      if custom->>'poolId' is not null then
        select p.* into pkg from public.packages p join credit_internal.credit_households h on h.id=p.household_id
          where p.id=(custom->>'poolId')::uuid and h.studio_id=s.studio_id
            and credit_internal.student_may_spend_pool(p.id,p_student) for update of p;
        if not found then raise exception 'FORBIDDEN'; end if;
        if pkg.expires_at is distinct from expires or not exists(
          select 1 from credit_internal.package_credit_terms t where t.package_id=pkg.id
            and t.service_ids=array[svc.id] and t.duration_minutes=minutes and t.issuance_entry_id is not null
        ) then raise exception 'VALIDATION_FAILED: The grant must match the shared pool service, duration and expiration.'; end if;
        batch_key:='shared-grant:'||md5(p_key);
        batch:=jsonb_build_object('rows',jsonb_build_array(jsonb_build_object(
          'studentId',p_student,'packageId',pkg.id,'delta',quantity)),
          'reason',reason,'portalVisible',coalesce(p_value->'portalVisible','true'::jsonb));
        review:=credit_internal.bulk_package_adjustment(p_student,'bulk_package_preview',batch,batch_key,p_actor);
        if review->>'canApply' is distinct from 'true' then raise exception 'INVALID_TRANSITION: Review the shared pool before granting credits.'; end if;
        batch_result:=credit_internal.bulk_package_adjustment(p_student,'bulk_package_apply',
          batch||jsonb_build_object('preview',review->'rows'),batch_key,p_actor);
        if batch_result->>'status' is distinct from 'completed' then raise exception 'VERSION_CONFLICT: Reopen the shared pool.'; end if;
        select * into strict entry from public.package_credit_entries where id=(batch_result#>>'{receipts,0,entryId}')::uuid;
        result:=jsonb_build_object('package',to_jsonb(pkg),'entry',to_jsonb(entry),
          'auditEventId',batch_result#>>'{receipts,0,auditEventId}','duplicate',false);
        insert into credit_internal.credit_command_receipts(key,student_id,actor_id,request,response)
          values(p_key,p_student,p_actor,request,result);
        return result;
      end if;
      insert into public.packages(student_id,name,expires_at,credit_quantity,auto_apply)
        values(s.id,svc.name||' discretionary credits',expires,quantity,
          coalesce((select auto_apply from public.student_credit_accounts where student_id=s.id),false))
        returning * into pkg;
      update credit_internal.package_credit_terms set service_ids=array[svc.id],duration_minutes=minutes
        where package_id=pkg.id;
    elsif p_value->>'packageId' is not null then
      select * into pkg from public.packages where id=(p_value->>'packageId')::uuid and student_id=s.id for update;
      if pkg.id is null then raise exception 'FORBIDDEN'; end if;
    elsif p_value->'package' is not null then
      select * into def from public.package_definitions where id=(p_value->'package'->>'definitionId')::uuid and studio_id=s.studio_id;
      if def.id is null or quantity<>def.session_count or quantity<=0 then raise exception 'VALIDATION_FAILED: Package changed; review the quote.'; end if;
      insert into public.packages(student_id,definition_id,name,price_minor,currency,expires_at,stripe_price_id,credit_quantity,auto_apply)
      values(s.id,def.id,p_value->'package'->>'name',(p_value->'package'->>'priceMinor')::bigint,
        p_value->'package'->>'currency',case when def.expiration_days is null then null else now()+make_interval(days=>def.expiration_days) end,
        p_value->'package'->>'stripePriceId',quantity,coalesce((select auto_apply from public.student_credit_accounts where student_id=s.id),false)) returning * into pkg;
    else
      select * into pkg from public.packages where student_id=s.id and name='Studio lesson credits' and expires_at is null order by created_at,id limit 1 for update;
      if pkg.id is null then insert into public.packages(student_id,name) values(s.id,'Studio lesson credits') returning * into pkg; end if;
    end if;
    if quantity<0 and ((public.student_credit_summary(s.id)->>'needsReview')::boolean or public.package_credit_balance(pkg.id)+quantity<0) then
      raise exception 'CREDIT_UNAVAILABLE: Reserved credits cannot be removed.';
    end if;
    insert into public.package_credit_entries(package_id,lesson_id,kind,quantity,reason,idempotency_key,created_by)
      values(pkg.id,lid,kind,quantity,reason,p_key,p_actor) returning * into entry;
  end if;
  if p_actor is not null and kind='adjustment' and p_value->'portalVisible'='false'::jsonb then
    insert into credit_internal.hidden_portal_credit_entries(entry_id) values(entry.id) on conflict do nothing;
  end if;
  coverage:=credit_internal.request_coverage(s.id);
  insert into public.audit_events(studio_id,actor_id,action,entity_type,entity_id,reason,correlation_id,source,after_state)
    values(s.studio_id,p_actor,case when p_value->'package' is not null then 'package.assigned' else 'credit.granted' end,
      'credit',entry.id,reason,p_key,case when p_actor is null then 'provider' else 'coach_portal' end,
      jsonb_build_object('entry',to_jsonb(entry),'coverage',coverage)) returning id into audit_id;
  result:=jsonb_build_object('package',to_jsonb(pkg),'entry',to_jsonb(entry),'coverage',coverage,'auditEventId',audit_id,'duplicate',false);
  insert into credit_internal.credit_command_receipts(key,student_id,actor_id,request,response) values(p_key,s.id,p_actor,request,result);
  return result;
end $$;
