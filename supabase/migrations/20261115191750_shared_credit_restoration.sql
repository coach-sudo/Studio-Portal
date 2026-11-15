create function credit_internal.restore_shared_credit(p_student uuid,p_action text,p_value jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare studio uuid; actor uuid:=auth.uid(); lot public.packages; debit public.package_credit_entries;
  target uuid:=(p_value->>'packageId')::uuid; source_id uuid:=(p_value->>'entryId')::uuid;
  prior credit_internal.credit_command_receipts; reviewed jsonb; result jsonb;
  reason_text text:=trim(p_value->>'reason'); request_key text:=p_value->>'key'; correction uuid;
begin
  select studio_id into studio from public.students where id=p_student and deleted_at is null;
  if studio is null or actor is null or not public.is_studio_coach(studio) then
    raise exception 'FORBIDDEN' using errcode='42501';
  end if;
  if p_action is null or p_action not in ('restore_list','restore_preview','restore_apply') then
    raise exception 'VALIDATION_FAILED';
  end if;
  if p_action='restore_apply' then
    if reason_text is null or char_length(reason_text) not between 3 and 500
      or request_key is null or char_length(request_key) not between 8 and 120 then
      raise exception 'VALIDATION_FAILED: Enter a reason for the restoration.';
    end if;
    request_key:='shared-restoration:'||request_key;
    perform pg_advisory_xact_lock(hashtextextended(request_key,0));
    select * into prior from credit_internal.credit_command_receipts where key=request_key;
    if found then
      if prior.actor_id is distinct from actor or prior.student_id<>p_student or prior.request<>p_value then
        raise exception 'IDEMPOTENCY_CONFLICT';
      end if;
      return prior.response;
    end if;
  end if;
  select p.* into lot from public.packages p join credit_internal.credit_households h on h.id=p.household_id
    where p.id=target and h.studio_id=studio for update of p;
  if not found then raise exception 'FORBIDDEN' using errcode='42501'; end if;
  if p_action='restore_list' then
    return coalesce((select jsonb_agg(v.data order by v.starts_at desc,v.id) from (
      select e.id,l.starts_at,jsonb_build_object('id',e.id,'student',s.full_name,'topic',l.topic,'startsAt',l.starts_at) data
      from credit_internal.shared_pool_usage(lot.id) u
      join public.package_credit_entries e on e.package_id=lot.id and e.lesson_id=u.lesson_id
        and e.used_by_student_id=u.student_id and e.kind='consumption' and e.quantity=-1
      join public.lessons l on l.id=e.lesson_id
      join public.students s on s.id=e.used_by_student_id
      where u.consumed=1 and (l.status in ('completed','cancelled','late_cancelled') or exists(
        select 1 from public.lesson_participants lp where lp.lesson_id=l.id and lp.student_id=s.id and lp.status='cancelled'))
        and not exists(select 1 from public.package_credit_entries r where r.reverses_entry_id=e.id)
      order by l.starts_at desc,e.id limit 100) v),'[]');
  end if;
  select e.* into debit from public.package_credit_entries e join public.lessons l on l.id=e.lesson_id
    where e.id=source_id and e.package_id=lot.id and e.kind='consumption' and e.quantity=-1
      and (l.status in ('completed','cancelled','late_cancelled') or exists(
        select 1 from public.lesson_participants lp where lp.lesson_id=l.id
          and lp.student_id=e.used_by_student_id and lp.status='cancelled'))
      and exists(select 1 from credit_internal.shared_pool_usage(lot.id) u
        where u.lesson_id=e.lesson_id and u.student_id=e.used_by_student_id and u.consumed=1)
      and not exists(select 1 from public.package_credit_entries r where r.reverses_entry_id=e.id);
  if not found then raise exception 'INVALID_TRANSITION: This credit use cannot be restored.'; end if;
  reviewed:=jsonb_build_object('entryId',debit.id,'lessonId',debit.lesson_id,'studentId',debit.used_by_student_id,
    'householdId',lot.household_id,'packageId',lot.id,'expiresAt',lot.expires_at,
    'before',case when lot.expires_at<=now() then 0 else public.package_credit_balance(lot.id) end,
    'after',case when lot.expires_at<=now() then 0 else public.package_credit_balance(lot.id)+1 end);
  if p_action='restore_preview' then return reviewed; end if;
  if reviewed is distinct from p_value->'preview' then return jsonb_build_object('status','stale'); end if;
  insert into public.package_credit_entries(package_id,lesson_id,used_by_student_id,kind,quantity,reason,
    reverses_entry_id,idempotency_key,created_by)
    values(lot.id,debit.lesson_id,debit.used_by_student_id,'release',1,reason_text,debit.id,request_key,actor)
    returning id into correction;
  if p_value->'portalVisible'='false'::jsonb then
    insert into credit_internal.hidden_portal_credit_entries(entry_id) values(correction);
  end if;
  result:=reviewed||jsonb_build_object('status','completed','correctionId',correction);
  insert into public.audit_events(studio_id,actor_id,action,entity_type,entity_id,reason,
    correlation_id,source,before_state,after_state)
    values(studio,actor,'credits.shared_restored','package',lot.id,reason_text,request_key,'coach_portal',reviewed,result);
  insert into credit_internal.credit_command_receipts(key,student_id,actor_id,request,response)
    values(request_key,p_student,actor,p_value,result);
  return result;
end $$;
revoke all on function credit_internal.restore_shared_credit(uuid,text,jsonb) from public,anon;
grant execute on function credit_internal.restore_shared_credit(uuid,text,jsonb) to authenticated;


create or replace function public.household_credit_access(p_student uuid,p_action text,p_value jsonb default '{}'::jsonb)
returns jsonb language sql security invoker set search_path='' as $$
  select case
    when p_action in ('restore_list','restore_preview','restore_apply') then credit_internal.restore_shared_credit(p_student,p_action,p_value)
    when p_action='attention_cases' then credit_internal.credit_attention_cases(p_student)
    when p_action in ('expiration_preview','expiration_apply','expiration_history')
      then credit_internal.credit_expiration_command(p_student,p_action,p_value)
    else credit_internal.household_credit_access(p_student,p_action,p_value)
  end
$$;

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
    where (p.student_id=p_student or (p.household_id is not null and (
      (e.kind='adjustment' and e.lesson_id is null and credit_internal.student_may_spend_pool(p.id,p_student))
      or (e.kind='release' and e.reverses_entry_id is not null and e.used_by_student_id=p_student))))
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

create or replace function public.command_grant_student_credits(
  p_student uuid,p_key text,p_value jsonb,p_actor uuid default null
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  s public.students; pkg public.packages; entry public.package_credit_entries; prior credit_internal.credit_command_receipts;
  quantity integer:=(p_value->>'quantity')::integer; kind public.credit_entry_kind:=(p_value->>'kind')::public.credit_entry_kind;
  lid uuid:=(p_value->>'lessonId')::uuid; reason text:=trim(p_value->>'reason'); def public.package_definitions;
  result jsonb; coverage jsonb; audit_id uuid; request jsonb:=p_value;
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
    if p_value->>'packageId' is not null then
      select * into pkg from public.packages where id=(p_value->>'packageId')::uuid and student_id=s.id for update;
      if pkg.id is null then raise exception 'FORBIDDEN'; end if;
    elsif p_value->'package' is not null then
      select * into def from public.package_definitions where id=(p_value->'package'->>'definitionId')::uuid and studio_id=s.studio_id and active;
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
