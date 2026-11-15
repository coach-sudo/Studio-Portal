-- Optional pool routing points to a verified contact identity. Neither this
-- mapping nor its audit is exposed to portal roles.
create table credit_internal.shared_pool_billing_contacts (
  package_id uuid primary key references public.packages(id),
  contact_id uuid not null references public.linked_contacts(id) on delete cascade
);
alter table credit_internal.shared_pool_billing_contacts enable row level security;
revoke all on credit_internal.shared_pool_billing_contacts from public,anon,authenticated,service_role;

create function credit_internal.shared_pool_billing_contact(p_pool uuid,p_student uuid)
returns uuid language sql stable set search_path='' as $$
  select coalesce(
    (select authorized.id from credit_internal.shared_pool_billing_contacts m
     join public.linked_contacts configured on configured.id=m.contact_id
     join public.linked_contacts authorized on authorized.user_id=configured.user_id
     join public.students s on s.id=authorized.student_id and s.studio_id=authorized.studio_id
     where m.package_id=p_pool and authorized.student_id=p_student
       and credit_internal.student_may_spend_pool(p_pool,p_student)
       and credit_internal.student_may_spend_pool(p_pool,configured.student_id)
       and configured.studio_id=s.studio_id and configured.portal_enabled
       and configured.can_view_finance and configured.can_receive_notifications
       and authorized.portal_enabled and authorized.can_view_finance and authorized.can_receive_notifications
     order by (authorized.id=configured.id) desc, authorized.id limit 1),
    (select c.id from public.linked_contacts c join public.students s on s.id=c.student_id and s.studio_id=c.studio_id
     where c.student_id=p_student and c.is_primary_payer and c.user_id is not null
       and s.deleted_at is null and c.portal_enabled and c.can_view_finance and c.can_receive_notifications
       and (p_pool is null or credit_internal.student_may_spend_pool(p_pool,p_student)))
  )
$$;
revoke all on function credit_internal.shared_pool_billing_contact(uuid,uuid) from public,anon,authenticated;

create function credit_internal.manage_shared_pool_billing(p_student uuid,p_action text,p_value jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); studio uuid; pool uuid:=(p_value->>'packageId')::uuid;
  chosen uuid:=(p_value->>'contactId')::uuid; current_contact uuid; options jsonb; preview jsonb;
  reason_text text:=trim(p_value->>'reason'); result jsonb; k text:=p_value->>'key';
  prior credit_internal.credit_command_receipts;
begin
  select s.studio_id into studio from public.students s where s.id=p_student and s.deleted_at is null;
  if studio is null or actor is null or not public.is_studio_coach(studio) then raise exception 'FORBIDDEN' using errcode='42501'; end if;
  if p_action is null or p_action not in ('billing_read','billing_preview','billing_apply') then raise exception 'VALIDATION_FAILED'; end if;
  perform p.id from public.packages p join credit_internal.credit_households h on h.id=p.household_id
    where p.id=pool and h.studio_id=studio for update of p;
  if not found then raise exception 'FORBIDDEN' using errcode='42501'; end if;
  if p_action='billing_apply' then
    if reason_text is null or char_length(reason_text) not between 3 and 500 or k is null or char_length(k) not between 8 and 120 then
      raise exception 'VALIDATION_FAILED: Provide a reason and confirm the routing change.';
    end if;
    k:='shared-billing:'||k;
    perform pg_advisory_xact_lock(hashtextextended(k,0));
    select * into prior from credit_internal.credit_command_receipts where key=k;
    if found then
      if prior.actor_id is distinct from actor or prior.student_id<>p_student or prior.request<>p_value then
        raise exception 'IDEMPOTENCY_CONFLICT';
      end if;
      return prior.response;
    end if;
  end if;
  select contact_id into current_contact from credit_internal.shared_pool_billing_contacts where package_id=pool;
  select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'name',c.full_name) order by c.full_name,c.id),'[]') into options
    from public.linked_contacts c where c.studio_id=studio and c.user_id is not null and c.portal_enabled
      and c.can_view_finance and c.can_receive_notifications and credit_internal.student_may_spend_pool(pool,c.student_id);
  if p_action='billing_read' then
    return jsonb_build_object('contactId',current_contact,'options',options,'history',coalesce((
      select jsonb_agg(v.data order by v.created_at desc,v.id) from (
        select e.created_at,e.id,jsonb_build_object('reason',e.reason,'createdAt',e.created_at,'before',e.before_state,
          'after',e.after_state) data from public.audit_events e where e.studio_id=studio and e.entity_id=pool
          and e.action='credits.pool_billing_changed' order by e.created_at desc,e.id limit 50
      ) v),'[]'));
  end if;
  if chosen is not null and not exists(select 1 from jsonb_array_elements(options) x where x->>'id'=chosen::text) then
    raise exception 'INVALID_TRANSITION: Choose a contact authorized for pool billing notifications.';
  end if;
  preview:=jsonb_build_object('packageId',pool,'before',current_contact,'after',chosen,'routes',coalesce((
    select jsonb_agg(jsonb_build_object('student',s.full_name,'recipient',r.full_name) order by s.full_name,s.id)
    from credit_internal.credit_pool_members m join public.students s on s.id=m.student_id and s.deleted_at is null
    left join public.linked_contacts configured on configured.id=chosen
    left join lateral (select c.full_name from public.linked_contacts c where c.student_id=s.id
      and c.studio_id=studio and c.user_id is not null and c.portal_enabled and c.can_view_finance and c.can_receive_notifications
      and (c.user_id=configured.user_id or c.is_primary_payer)
      order by (c.user_id=configured.user_id) desc nulls last,(c.id=chosen) desc,c.id limit 1) r on true
    where m.package_id=pool),'[]'));
  if p_action='billing_preview' then return preview; end if;
  if preview is distinct from p_value->'preview' then return jsonb_build_object('status','stale'); end if;
  if chosen is null then
    delete from credit_internal.shared_pool_billing_contacts where package_id=pool;
  else
    insert into credit_internal.shared_pool_billing_contacts(package_id,contact_id) values(pool,chosen)
      on conflict(package_id) do update set contact_id=excluded.contact_id;
  end if;
  result:=jsonb_build_object('status','completed','contactId',chosen);
  insert into public.audit_events(studio_id,actor_id,action,entity_type,entity_id,reason,
    correlation_id,source,before_state,after_state)
    values(studio,actor,'credits.pool_billing_changed','package',pool,reason_text,k,'coach_portal',
      jsonb_build_object('contactId',current_contact),result);
  insert into credit_internal.credit_command_receipts(key,student_id,actor_id,request,response)
    values(k,p_student,actor,p_value,result);
  return result;
end $$;
revoke all on function credit_internal.manage_shared_pool_billing(uuid,text,jsonb) from public,anon;
grant execute on function credit_internal.manage_shared_pool_billing(uuid,text,jsonb) to authenticated;

create or replace function public.household_credit_access(p_student uuid,p_action text,p_value jsonb default '{}'::jsonb)
returns jsonb language sql security invoker set search_path='' as $$
  select case
    when p_action in ('billing_read','billing_preview','billing_apply') then credit_internal.manage_shared_pool_billing(p_student,p_action,p_value)
    when p_action in ('restore_list','restore_preview','restore_apply') then credit_internal.restore_shared_credit(p_student,p_action,p_value)
    when p_action='attention_cases' then credit_internal.credit_attention_cases(p_student)
    when p_action in ('expiration_preview','expiration_apply','expiration_history')
      then credit_internal.credit_expiration_command(p_student,p_action,p_value)
    else credit_internal.household_credit_access(p_student,p_action,p_value)
  end
$$;
