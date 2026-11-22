-- Compare the reviewed totals under the existing student lock before writing the ledger.
create or replace function public.command_student_credit_settings(
  p_student uuid,p_command text,p_value jsonb,p_version integer,p_key text,p_actor uuid
) returns jsonb language plpgsql security definer set search_path='' as $$
declare s public.students; prior credit_internal.credit_command_receipts; result jsonb; audit_id uuid; before_balance jsonb;
  request jsonb:=jsonb_build_object('command',p_command,'value',p_value,'version',p_version);
begin
  select * into s from public.students where id=p_student and deleted_at is null for update;
  if s.id is null or p_actor is null or not exists(select 1 from public.memberships
    where user_id=p_actor and studio_id=s.studio_id and role='coach') then raise exception 'FORBIDDEN'; end if;
  if p_key is null or length(p_key)<3 or length(p_key)>250 then raise exception 'VALIDATION_FAILED'; end if;
  select * into prior from credit_internal.credit_command_receipts where key=p_key;
  if prior.key is not null then
    if prior.student_id<>p_student or prior.actor_id is distinct from p_actor or prior.request<>request then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
    return prior.response||jsonb_build_object('duplicate',true);
  end if;
  if p_command='set_total' then
    select jsonb_build_object('remaining', summary->'remaining',
      'available', summary->'available', 'reserved', summary->'reserved')
      into before_balance from public.student_credit_summary(p_student) summary;
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
