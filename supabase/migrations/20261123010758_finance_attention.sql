-- Durable internal coach state. No deliveries or financial commands originate here.
create table workspace_internal.finance_issues (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios(id),
  student_id uuid not null,
  kind text not null,
  target_id uuid not null,
  severity integer not null check (severity between 1 and 3),
  title text not null,
  href text not null,
  evidence jsonb not null,
  state text not null default 'open' check(state in ('open','acknowledged','snoozed','dismissed','resolved')),
  version integer not null default 1,
  first_seen timestamptz not null default now(),
  changed_at timestamptz not null default now(),
  snoozed_until timestamptz,
  unique(studio_id,kind,target_id)
);
create index finance_issues_queue on workspace_internal.finance_issues(studio_id,state,severity desc,changed_at desc,id);
alter table workspace_internal.finance_issues enable row level security;
revoke all on workspace_internal.finance_issues from public,anon,authenticated,service_role;

create table workspace_internal.finance_issue_events (
  id bigint generated always as identity primary key,
  issue_id uuid not null references workspace_internal.finance_issues(id),
  actor_id uuid,
  action text not null,
  reason text,
  at timestamptz not null default now()
);
create index finance_issue_events_issue on workspace_internal.finance_issue_events(issue_id,id desc);
alter table workspace_internal.finance_issue_events enable row level security;
revoke all on workspace_internal.finance_issue_events from public,anon,authenticated,service_role;

create index finance_overdue_delivery on public.outbox_messages (studio_id,((entity_snapshot->>'invoiceId')),updated_at desc,id)
  where event_key='invoice.issued';
create index finance_failed_autopay on training_internal.lesson_autopay_attempts (mandate_id,lesson_id)
  where state='failed';

create function workspace_internal.finance_issue_sources(p_studio uuid)
returns table(kind text,target_id uuid,student_id uuid,severity integer,title text,href text,evidence jsonb)
language sql stable set search_path='' as $$
  with invoices as (
    select i.*,(i.total_minor-i.paid_minor-i.credit_minor-i.waived_minor) as remaining
    from public.studio_invoices i where i.studio_id=p_studio and i.status in ('open','partially_paid')
  ), people as (
    select s.id,s.full_name from public.students s where s.studio_id=p_studio and s.deleted_at is null
  )
  select 'overdue_invoice',i.id,i.student_id,3,i.number,
    '/coach/students/'||i.student_id||'/payments?invoice='||i.id,
    jsonb_build_object('dueDate',i.due_date,'amount',i.remaining,'currency',i.currency)
  from invoices i join people p on p.id=i.student_id join public.studios s on s.id=i.studio_id
  where i.remaining>0 and i.checkout_key is null
    and i.due_date<(now() at time zone coalesce(s.settings->>'timezone',s.timezone))::date
  union all
  select 'failed_payment',a.id,m.student_id,3,l.topic,
    '/coach/students/'||m.student_id||'/lessons/'||l.id,
    jsonb_build_object('failedAt',a.updated_at,'amount',i.remaining,'currency',i.currency)
  from training_internal.lesson_autopay_mandates m join people p on p.id=m.student_id
  join training_internal.lesson_autopay_attempts a on a.mandate_id=m.id
  join public.lessons l on l.id=a.lesson_id and l.studio_id=p_studio and l.student_id=m.student_id
  join invoices i on i.id=l.invoice_id and i.student_id=m.student_id
  where m.studio_id=p_studio and a.state='failed' and i.remaining>0 and i.checkout_key is null
    and l.status in ('scheduled','completed') and l.payment_status in ('due','partially_paid') and l.package_id is null
    and not exists (
      select 1 from training_internal.lesson_autopay_attempts next
      join training_internal.lesson_autopay_mandates replacement on replacement.id=next.mandate_id
      where next.lesson_id=a.lesson_id and replacement.student_id=m.student_id
        and next.state in ('planned','in_flight','succeeded','failed')
        and (next.updated_at,next.id)>(a.updated_at,a.id)
    )
  union all
  select 'invoice_delivery',i.id,i.student_id,2,i.number,
    '/coach/students/'||i.student_id||'/payments?invoice='||i.id,
    jsonb_build_object('attemptedAt',attempt.updated_at)
  from invoices i join people p on p.id=i.student_id
  cross join lateral (
    select o.status,o.updated_at from public.outbox_messages o
    where o.studio_id=p_studio and o.student_id=i.student_id and o.event_key='invoice.issued'
      and o.entity_snapshot->>'invoiceId'=i.id::text
    order by o.updated_at desc,o.id desc limit 1
  ) attempt
  where attempt.status='failed' and i.remaining>0
  union all
  select 'payer_review',p.id,p.id,2,p.full_name,
    '/coach/students/'||p.id||'/account',
    jsonb_build_object('authorization',m.id,'version',m.version)
  from training_internal.lesson_autopay_mandates m join people p on p.id=m.student_id
  where m.studio_id=p_studio and m.status in ('active','paused')
    and not training_internal.is_lesson_payer(m.payer_id,m.student_id)
  union all
  select 'credit_reconciliation',c.id,c.student_id,2,p.name,
    '/coach/students/'||c.student_id||'/payments?section=credits&package='||p.id,
    jsonb_build_object('caseVersion',c.version,'caseId',c.id)
  from credit_internal.reconciliation_cases c
  join people s on s.id=c.student_id join public.packages p on p.id=c.package_id and p.student_id=c.student_id
  where c.status in ('needs_review','under_review','reopened') and c.evidence->'present' is distinct from 'false'::jsonb
  union all
  select 'package_expiring',p.id,p.student_id,1,p.name,
    '/coach/students/'||p.student_id||'/payments?section=credits&package='||p.id,
    jsonb_build_object('expiresAt',p.expires_at,'quantity',balance.amount)
  from public.packages p join people s on s.id=p.student_id
  cross join lateral (select public.package_credit_balance(p.id) as amount offset 0) balance
  where p.expires_at>now() and p.expires_at<now()+interval '30 days' and balance.amount>0;
$$;
revoke all on function workspace_internal.finance_issue_sources(uuid) from public,anon,authenticated,service_role;

create function public.finance_attention(p_studio uuid,p_request jsonb default '{}')
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  command text:=coalesce(p_request->>'action','read');
  queue text:=coalesce(p_request->>'queue','open');
  issue_id uuid:=nullif(p_request->>'id','')::uuid;
  item workspace_internal.finance_issues;
  page integer:=coalesce((p_request->>'page')::integer,1);
  page_size integer:=case when p_request->>'preview'='true' then 3 else 25 end;
  reason text:=trim(p_request->>'reason');
  wake timestamptz:=nullif(p_request->>'until','')::timestamptz;
  result jsonb;
begin
  if auth.uid() is null or not public.is_studio_coach(p_studio) then
    raise exception 'FORBIDDEN' using errcode='42501';
  end if;
  if page not between 1 and 10000 or queue not in ('open','snoozed','history')
    or command not in ('read','acknowledge','snooze','dismiss') then raise exception 'VALIDATION_FAILED'; end if;
  perform pg_advisory_xact_lock(hashtextextended('finance-attention:'||p_studio,0));

  with sources as materialized (select * from workspace_internal.finance_issue_sources(p_studio)),
  retired as (
    update workspace_internal.finance_issues q set state='resolved',changed_at=now(),version=q.version+1,snoozed_until=null
    where q.studio_id=p_studio and q.state<>'resolved'
      and not exists(select 1 from sources s where s.kind=q.kind and s.target_id=q.target_id)
    returning q.id
  ), current_issues as (
    insert into workspace_internal.finance_issues as q (studio_id,kind,target_id,student_id,severity,title,href,evidence)
    select p_studio,s.kind,s.target_id,s.student_id,s.severity,s.title,s.href,s.evidence from sources s
    on conflict (studio_id,kind,target_id) do update set
      student_id=excluded.student_id,severity=excluded.severity,title=excluded.title,href=excluded.href,
      evidence=excluded.evidence,state='open',snoozed_until=null,changed_at=now(),version=q.version+1
    where q.state='resolved' or q.evidence is distinct from excluded.evidence
      or (q.state='snoozed' and q.snoozed_until<=now())
    returning q.id,q.version
  )
  insert into workspace_internal.finance_issue_events(issue_id,action)
    select r.id,'resolved' from retired r
    union all select c.id,case when c.version=1 then 'detected' else 'reopened' end from current_issues c;

  if command<>'read' then
    select * into item from workspace_internal.finance_issues q where q.id=issue_id and q.studio_id=p_studio;
    if not found then raise exception 'FORBIDDEN' using errcode='42501'; end if;
    if item.version is distinct from (p_request->>'version')::integer or item.state not in ('open','acknowledged','snoozed') then
      return jsonb_build_object('stale',true);
    end if;
    if command='dismiss' and (item.kind<>'package_expiring' or coalesce(length(reason),0) not between 3 and 300) then
      raise exception 'VALIDATION_FAILED: Only informational package notices can be dismissed with a reason.';
    end if;
    if command='snooze' and (wake is null or wake<=now() or wake>now()+interval '30 days') then
      raise exception 'VALIDATION_FAILED: Select a snooze within 30 days.';
    end if;
    update workspace_internal.finance_issues q set
      state=case command when 'acknowledge' then 'acknowledged' when 'dismiss' then 'dismissed' else 'snoozed' end,
      changed_at=now(),version=q.version+1,snoozed_until=case when command='snooze' then wake end where q.id=item.id;
    insert into workspace_internal.finance_issue_events(issue_id,actor_id,action,reason)
    values(item.id,auth.uid(),command,case when command='dismiss' then reason end);
  end if;

  with matching as (
    select q.*,s.full_name as student from workspace_internal.finance_issues q
    left join public.students s on s.id=q.student_id and s.studio_id=p_studio
    where q.studio_id=p_studio and (
      (issue_id is not null and command='read' and q.id=issue_id)
      or ((issue_id is null or command<>'read') and (case queue when 'open' then q.state in ('open','acknowledged')
        when 'snoozed' then q.state='snoozed' else q.state in ('resolved','dismissed') end))
    )
      and (nullif(p_request->>'kind','') is null or q.kind=p_request->>'kind')
      and (nullif(p_request->>'severity','') is null or q.severity::text=p_request->>'severity')
      and (nullif(p_request->>'student','') is null or q.student_id::text=p_request->>'student')
  ), paged as (
    select m.*,coalesce((select jsonb_agg(to_jsonb(e) order by e.id desc) from
      (select event.id,event.action,event.reason,event.at from workspace_internal.finance_issue_events event
        where event.issue_id=m.id order by event.id desc limit 12)e),'[]') as history from (
      select * from matching order by severity desc,changed_at desc,id limit page_size offset (page-1)*page_size
    )m
  )
  select jsonb_build_object('count',(select count(*) from matching),'items',
    coalesce((select jsonb_agg(to_jsonb(p) order by severity desc,changed_at desc,id) from paged p),'[]')) into result;
  return result;
end $$;
revoke all on function public.finance_attention(uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.finance_attention(uuid,jsonb) to authenticated;

