-- PR 1.6: read-only summaries. Invoker execution retains each table's RLS.
create function credit_internal.read_student_financial_overview(p_student uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb; target_studio uuid;
begin
  perform credit_internal.require_student_finance(p_student);
  select studio_id into target_studio from public.students where id=p_student;
  with issued as (
    select * from public.studio_invoices where student_id=p_student and studio_id=target_studio and status not in ('draft','void')
  ), invoiced_lessons as (
    select distinct lid from issued i cross join lateral jsonb_array_elements(i.items) x
      cross join lateral jsonb_array_elements_text(coalesce(x->'lessonIds','[]')) lid
  ), own_lessons as (
    select l.* from public.lessons l where l.studio_id=target_studio and (l.student_id=p_student or exists(
      select 1 from public.lesson_participants lp where lp.lesson_id=l.id and lp.student_id=p_student and lp.status in ('reserved','confirmed','attended','no_show')))
      and l.status not in ('draft','cancelled')
  ), own_bookings as (
    select b.* from public.bookings b where b.student_id=p_student and b.studio_id=target_studio and b.status not in ('cancelled','expired','held')
  ), linked as (
    select distinct lp.booking_id from public.lesson_participants lp join own_lessons l on l.id=lp.lesson_id
      where lp.student_id=p_student and lp.booking_id is not null
  ), booking_invoice as (
    select distinct lp.booking_id from public.lesson_participants lp join public.lessons l on l.id=lp.lesson_id
    where lp.student_id=p_student and (l.invoice_id is not null or l.id::text in (select lid from invoiced_lessons))
  ), obligations as (
    select i.currency, greatest(0,i.total_minor-i.paid_minor-i.waived_minor-i.credit_minor) amount,
      false review, i.checkout_key is not null pending from issued i
    union all
    select b.currency,
      case when b.id in (select booking_id from booking_invoice) then 0
        when b.payment_status in ('paid','not_required') then 0
        when b.payment_policy='credits' then 0 else greatest(0,b.total_minor-b.paid_minor) end,
      b.payment_status in ('failed','refunded') or (b.payment_policy='credits' and b.payment_status<>'paid')
        or b.id in (select booking_id from booking_invoice), b.payment_status='processing'
    from own_bookings b
    union all
    select coalesce(s.settings->>'currency','USD'),
      case when l.payment_status in ('paid','waived','paid_by_credit') then 0 else greatest(0,coalesce(l.price_minor,0)-coalesce(l.paid_minor,0)) end,
      l.price_minor is null or coalesce(l.payment_status,'untracked') in ('untracked','failed','refunded')
        or (l.payment_status='paid_by_credit' and not exists(select 1 from public.package_credit_entries e join public.packages p on p.id=e.package_id where p.student_id=p_student and e.lesson_id=l.id group by e.lesson_id having sum(e.quantity)<0)),
      l.payment_status='processing'
    from own_lessons l join public.studios s on s.id=l.studio_id
    where l.student_id=p_student and l.invoice_id is null and l.id::text not in (select lid from invoiced_lessons)
      and not exists(select 1 from public.lesson_participants lp where lp.lesson_id=l.id and lp.student_id=p_student and lp.booking_id is not null)
  ), dollars as (
    select currency,sum(case when kind='refund' then amount_minor else -amount_minor end) amount
    from public.payment_entries where student_id=p_student and account_credit group by currency
  ), currencies as (select currency from obligations union select currency from dollars union select coalesce(st.settings->>'currency','USD') from public.students s join public.studios st on st.id=s.studio_id where s.id=p_student), balances as (
    select c.currency,coalesce((select sum(amount) from obligations o where o.currency=c.currency),0) due,
      coalesce((select amount from dollars d where d.currency=c.currency),0) credit from currencies c
  ) select jsonb_build_object(
    'studentId',p_student,'evaluatedAt',now(),
    'balances',coalesce((select jsonb_agg(jsonb_build_object('currency',currency,'dueMinor',due,'dollarCreditMinor',credit) order by currency) from balances),'[]'::jsonb),
    'reviewRequired',coalesce((select bool_or(review) from obligations),false) or exists(
      select 1 from linked x where not exists(select 1 from own_bookings b where b.id=x.booking_id))
      or (public.student_credit_summary(p_student)->>'needsReview')::boolean
      or exists(select 1 from balances where credit<0)
      or exists(select 1 from public.lessons l where l.studio_id<>target_studio and (l.student_id=p_student or exists(select 1 from public.lesson_participants lp where lp.lesson_id=l.id and lp.student_id=p_student)))
      or exists(select 1 from public.bookings b where b.student_id=p_student and b.studio_id<>target_studio)
      or exists(select 1 from public.studio_invoices i where i.student_id=p_student and i.studio_id<>target_studio)
      or exists(select 1 from own_lessons l where l.invoice_id is not null and not exists(select 1 from issued i where i.id=l.invoice_id))
      or exists(select 1 from own_lessons l join public.package_credit_entries e on e.lesson_id=l.id join public.packages p on p.id=e.package_id
        where l.status='scheduled' and p.student_id=p_student and p.expires_at<=l.starts_at group by l.id,p.id having sum(e.quantity)<0)
      or exists(select 1 from own_lessons l where l.student_id is distinct from p_student and not exists(select 1 from public.lesson_participants lp where lp.lesson_id=l.id and lp.student_id=p_student and lp.booking_id is not null))
      or exists(select 1 from own_lessons l where coalesce(l.paid_minor,0)>0 and exists(select 1 from public.package_credit_entries e join public.packages p on p.id=e.package_id where p.student_id=p_student and e.lesson_id=l.id group by e.lesson_id having sum(e.quantity)<0)),
    'pendingPayments',(select count(*) from obligations where pending),
    'unpaidInvoices',(select count(*) from issued where status in ('open','partially_paid')),
    'activePackages',(select count(*) from public.packages p where p.student_id=p_student and (p.expires_at is null or p.expires_at>now()) and (public.package_credit_balance(p.id)>0 or exists(
      select 1 from public.package_credit_entries e join public.lessons l on l.id=e.lesson_id where e.package_id=p.id and l.status='scheduled' and l.ends_at>now() group by l.id having sum(e.quantity)<0))),
    'renewalExceptions',(select count(*) from public.package_subscriptions where student_id=p_student and status in ('past_due','pending')),
    'expiringPackages',(select count(*) from public.packages p where p.student_id=p_student and p.expires_at>now() and p.expires_at<now()+interval '30 days' and public.package_credit_balance(p.id)>0)
  ) into result;
  return result;
end $$;
revoke all on function credit_internal.read_student_financial_overview(uuid) from public,anon;
grant execute on function credit_internal.read_student_financial_overview(uuid) to authenticated;
create function public.student_financial_overview(p_student uuid) returns jsonb
language sql stable security invoker set search_path='' as $$
  select credit_internal.read_student_financial_overview(p_student);
$$;
revoke all on function public.student_financial_overview(uuid) from public,anon;
grant execute on function public.student_financial_overview(uuid) to authenticated;

-- Submission bodies stay inaccessible; expose only a guarded coach count.
create function credit_internal.workspace_approval_count(p_student uuid) returns bigint
language plpgsql stable security definer set search_path='' as $$
begin
  if auth.uid() is null or not exists(select 1 from public.students s where s.id=p_student and s.deleted_at is null and public.is_studio_coach(s.studio_id)) then raise exception 'FORBIDDEN'; end if;
  return (select count(*) from public.profile_submissions p join public.actor_profiles a on a.id=p.actor_profile_id where a.student_id=p_student and p.approval_status='pending_review');
end $$;
revoke all on function credit_internal.workspace_approval_count(uuid) from public,anon;
grant execute on function credit_internal.workspace_approval_count(uuid) to authenticated;

-- Coach workspace has private coaching context; portal consumers cannot call it.
create function public.student_workspace_summary(p_student uuid) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare s public.students; result jsonb;
begin
  select * into s from public.students where id=p_student and deleted_at is null;
  if auth.uid() is null or s.id is null or not public.is_studio_coach(s.studio_id) then raise exception 'FORBIDDEN'; end if;
  select jsonb_build_object('studentId',s.id,'evaluatedAt',now(),
    'nextLesson',(select jsonb_build_object('id',l.id,'topic',l.topic,'startsAt',l.starts_at) from public.lessons l
      where l.studio_id=s.studio_id and l.status='scheduled' and l.ends_at>now() and (l.student_id=s.id or exists(
        select 1 from public.lesson_participants lp where lp.lesson_id=l.id and lp.student_id=s.id and lp.status in ('reserved','confirmed')))
      order by l.starts_at,l.id limit 1),
    'latestNote',(select jsonb_build_object('id',n.id,'lessonId',n.lesson_id,'title',n.title,'takeaway',left(n.body,300),'status',n.status) from public.notes n where n.student_id=s.id and n.status<>'archived' order by n.updated_at desc,n.id limit 1),
    'work',coalesce((select jsonb_agg(x.item) from (
      select distinct on (m.id) jsonb_build_object('id',m.id,'assignmentId',ml.id,'lessonId',ml.lesson_id,'title',m.title,'role',ml.role) item
      from public.material_links ml join public.materials m on m.id=ml.material_id
      where (ml.student_id=s.id or (ml.student_id is null and exists(select 1 from public.lessons l where l.id=ml.lesson_id and (l.student_id=s.id or exists(select 1 from public.lesson_participants lp where lp.lesson_id=l.id and lp.student_id=s.id and lp.status in ('reserved','confirmed'))))))
        and ml.status='active' and m.status='active'
      order by m.id,(ml.role='current_script') desc,ml.pinned desc,ml.updated_at desc,ml.id limit 5
    ) x),'[]'::jsonb),
    'practice',coalesce((select jsonb_agg(x.item) from (select jsonb_build_object('id',a.id,'lessonId',a.lesson_id,'title',a.title,'helpRequested',a.help_requested) item from public.assignments a where a.student_id=s.id and a.status<>'completed' order by a.due_at nulls last,a.id limit 5) x),'[]'::jsonb),
    'questions',(select count(*) from public.assignments a where a.student_id=s.id and a.help_requested and a.status<>'completed'),
    'approvals',credit_internal.workspace_approval_count(s.id),
    'finance',public.student_financial_overview(s.id)
  ) into result;
  return result;
end $$;
revoke all on function public.student_workspace_summary(uuid) from public,anon;
grant execute on function public.student_workspace_summary(uuid) to authenticated;

create function public.student_workspace_resource(p_student uuid,p_resource uuid,p_assignment uuid) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare result jsonb;
begin
  if auth.uid() is null or not exists(select 1 from public.students where id=p_student and deleted_at is null and public.is_studio_coach(studio_id)) then raise exception 'FORBIDDEN'; end if;
  select jsonb_build_object('id',m.id,'title',m.title,'description','','source',m.source,
    'version',m.version,'inLibrary',m.in_library,'visibility',m.catalog_visibility,'resourceStatus',m.status,
    'createdAt',m.created_at,'options','[]'::jsonb,'assignmentId',ml.id,'assignmentVersion',ml.version)
    into result from public.materials m join public.material_links ml on ml.material_id=m.id
    where m.id=p_resource and ml.id=p_assignment and (ml.student_id=p_student or (ml.student_id is null and exists(
      select 1 from public.lessons l where l.id=ml.lesson_id and (l.student_id=p_student or exists(select 1 from public.lesson_participants lp where lp.lesson_id=l.id and lp.student_id=p_student and lp.status in ('reserved','confirmed'))))));
  if result is null then raise exception 'NOT_FOUND'; end if;
  return result;
end $$;
revoke all on function public.student_workspace_resource(uuid,uuid,uuid) from public,anon;
grant execute on function public.student_workspace_resource(uuid,uuid,uuid) to authenticated;

create function credit_internal.read_student_credit_history(p_student uuid,p_page integer) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
  perform credit_internal.require_student_finance(p_student);
  if p_page not between 1 and 1000000 then raise exception 'VALIDATION_FAILED'; end if;
  return jsonb_build_object('studentId',p_student,'page',p_page,'total',(select count(*) from public.package_credit_entries e join public.packages p on p.id=e.package_id where p.student_id=p_student),
    'items',coalesce((select jsonb_agg(x.item order by x.created_at desc,x.id) from (
      select e.created_at,e.id,jsonb_build_object('id',e.id,'quantity',e.quantity,'kind',e.kind,'createdAt',e.created_at,'packageName',p.name,'reason',case when exists(select 1 from public.students s where s.id=p_student and public.is_studio_coach(s.studio_id)) then e.reason else null end) item
      from public.package_credit_entries e join public.packages p on p.id=e.package_id where p.student_id=p_student
      order by e.created_at desc,e.id limit 25 offset (p_page-1)*25
    )x),'[]'::jsonb));
end $$;
revoke all on function credit_internal.read_student_credit_history(uuid,integer) from public,anon;
grant execute on function credit_internal.read_student_credit_history(uuid,integer) to authenticated;
create function public.student_credit_history(p_student uuid,p_page integer default 1) returns jsonb
language sql stable security invoker set search_path='' as $$select credit_internal.read_student_credit_history(p_student,p_page)$$;
revoke all on function public.student_credit_history(uuid,integer) from public,anon;
grant execute on function public.student_credit_history(uuid,integer) to authenticated;

-- Explicit manual application does not enable the preference. Failed intent survives recovery.
alter table credit_internal.credit_coverage_jobs add column manual_requested boolean not null default false;
create or replace function credit_internal.request_coverage(p_student uuid,p_manual boolean default false) returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb; failed boolean; version_now integer; manual_mode boolean;
begin
  perform 1 from public.students where id=p_student and deleted_at is null for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  perform credit_internal.enqueue_coverage(p_student);
  update credit_internal.credit_coverage_jobs set manual_requested=manual_requested or p_manual where student_id=p_student;
  select manual_requested into manual_mode from credit_internal.credit_coverage_jobs where student_id=p_student;
  begin
    result:=credit_internal.apply_upcoming(p_student,manual_mode);
  exception
    when others then
      -- A grant and its recovery intent survive a coverage failure, never a partial debit.
      result:=public.student_credit_summary(p_student)||jsonb_build_object('applied',0,'alreadyCovered',0,
        'skipped',0,'failed',1,'skipReasons','{}'::jsonb,'failureCodes',jsonb_build_object(sqlstate,1),'autoApplyPending',true);
  end;
  failed:=(result->>'failed')::integer>0;
  select version into version_now from public.student_credit_accounts where student_id=p_student;
  update credit_internal.credit_coverage_jobs set
    requested_version=coalesce(version_now,1),
    completed_version=case when failed then completed_version else coalesce(version_now,1) end,
    completed_generation=case when failed then completed_generation else generation end,
    manual_requested=case when failed then manual_requested else false end,
    attempts=case when failed then attempts+1 else 0 end,
    next_attempt_at=case when failed then now()+make_interval(secs=>least(3600,30*power(2,least(attempts,7))::integer)) else now() end,
    last_error=case when failed then 'coverage_failed' else null end,last_result=result,updated_at=now()
    where student_id=p_student;
  return result;
end $$;
revoke all on function credit_internal.request_coverage(uuid,boolean) from public,anon,authenticated;


create or replace function public.command_student_credit_settings(
  p_student uuid,p_command text,p_value jsonb,p_version integer,p_key text,p_actor uuid
) returns jsonb language plpgsql security definer set search_path='' as $$
declare s public.students; prior credit_internal.credit_command_receipts; result jsonb; audit_id uuid;
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
  insert into public.audit_events(studio_id,actor_id,action,entity_type,entity_id,reason,correlation_id,source,after_state)
    values(s.studio_id,p_actor,'credits.'||p_command,'student',s.id,coalesce(p_value->>'reason','Coach reviewed credit coverage'),p_key,'coach_portal',result)
    returning id into audit_id;
  result:=result||jsonb_build_object('auditEventId',audit_id);
  insert into credit_internal.credit_command_receipts(key,student_id,actor_id,request,response) values(p_key,s.id,p_actor,request,result);
  return result;
end $$;
revoke all on function public.command_student_credit_settings(uuid,text,jsonb,integer,text,uuid) from public,anon,authenticated;
grant execute on function public.command_student_credit_settings(uuid,text,jsonb,integer,text,uuid) to service_role;


