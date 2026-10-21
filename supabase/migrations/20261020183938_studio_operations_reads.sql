-- One authorized fact projection drives both dashboard totals and bounded supporting lists.
create function workspace_internal.finance_facts(p_studio uuid,p_from timestamptz,p_until timestamptz)
returns table(metric text,currency text,unit text,amount bigint,id uuid,student_id uuid,title text,href text,occurred_at timestamptz,state text)
language sql stable security invoker set search_path='' as $$
 with people as materialized (select s.* from public.students s where s.studio_id=p_studio and public.is_studio_coach(s.studio_id) and s.deleted_at is null),
 invoices as (select i.* from public.studio_invoices i join people s on s.id=i.student_id where i.studio_id=p_studio and i.status not in ('draft','void')),
 money as (select e.* from public.payment_entries e join people s on s.id=e.student_id),
 credits as materialized (select s.id,s.full_name,public.student_credit_summary(s.id) summary from people s)
 select 'outstanding',i.currency,'money',greatest(0,i.total_minor-i.paid_minor-i.credit_minor-i.waived_minor)::bigint,i.id,i.student_id,i.number,
  '/coach/students/'||i.student_id||'/payments?invoice='||i.id,i.updated_at,i.status from invoices i where i.total_minor>i.paid_minor+i.credit_minor+i.waived_minor
 union all select case when m.kind='refund' then 'refunds' else 'receipts' end,m.currency,'money',m.amount_minor::bigint,m.id,m.student_id,m.reason,
  '/coach/students/'||m.student_id||'/payments?payment='||m.id,m.created_at,m.kind::text from money m where not m.account_credit and m.kind in ('payment','refund') and m.created_at>=p_from and m.created_at<p_until
 union all select 'pending',i.currency,'money',greatest(0,coalesce(i.checkout_amount,i.total_minor-i.paid_minor-i.credit_minor-i.waived_minor))::bigint,i.id,i.student_id,i.number,
  '/coach/students/'||i.student_id||'/payments?invoice='||i.id,i.updated_at,'Checkout pending' from invoices i where i.checkout_key is not null
 union all select 'pending',b.currency,'money',greatest(0,b.total_minor-b.paid_minor)::bigint,b.id,b.student_id,b.reference,
  '/coach/bookings?booking='||b.id,b.updated_at,'Payment processing' from public.bookings b join people s on s.id=b.student_id
  where b.studio_id=p_studio and b.payment_status='processing' and not exists(select 1 from public.lesson_participants lp join public.lessons l on l.id=lp.lesson_id where lp.booking_id=b.id and (l.invoice_id is not null or exists(select 1 from invoices i cross join lateral jsonb_array_elements(i.items) x where coalesce(x->'lessonIds','[]') ? l.id::text)))
 union all select 'dollarCredit',m.currency,'money',greatest(0,sum(case when m.kind='refund' then m.amount_minor else -m.amount_minor end))::bigint,m.student_id,m.student_id,s.full_name,
  '/coach/students/'||m.student_id||'/payments',max(m.created_at),case when sum(case when m.kind='refund' then m.amount_minor else -m.amount_minor end)<0 then 'Review required' else 'Current dollar credit' end from money m join people s on s.id=m.student_id where m.account_credit group by m.currency,m.student_id,s.full_name
 union all select v.metric,'CREDITS','credits',coalesce((c.summary->>v.key)::bigint,0),c.id,c.id,c.full_name,
  '/coach/students/'||c.id||'/payments?section=credits',now(),case when c.summary->>'needsReview'='true' then 'Review required' else 'Current lesson credits' end
  from credits c cross join (values('availableCredits','available'),('reservedCredits','reserved'),('remainingCredits','remaining'))v(metric,key)
 union all select 'packageExceptions',p.currency,'records',1::bigint,p.id,p.student_id,p.name,
  '/coach/students/'||p.student_id||'/payments?package='||p.id,p.expires_at,'Credits expire within 30 days' from public.packages p join people s on s.id=p.student_id
  where p.expires_at>now() and p.expires_at<now()+interval '30 days' and public.package_credit_balance(p.id)>0
 union all select 'packageExceptions',coalesce(d.currency,'USD'),'records',1::bigint,r.id,r.student_id,coalesce(d.name,'Package renewal'),
  '/coach/students/'||r.student_id||'/payments?subscription='||r.id,r.updated_at,r.status from public.package_subscriptions r join people s on s.id=r.student_id left join public.package_definitions d on d.id=r.definition_id where r.studio_id=p_studio and (r.status in ('pending','past_due') or (r.renewal_in_flight and r.renewal_claimed_at<now()-interval '15 minutes'));
$$;
revoke all on function workspace_internal.finance_facts(uuid,timestamptz,timestamptz) from public,anon;
grant usage on schema workspace_internal to authenticated;
grant execute on function workspace_internal.finance_facts(uuid,timestamptz,timestamptz) to authenticated;

create function public.studio_financial_dashboard(p_month date default null,p_metric text default null,p_currency text default null,p_page integer default 1) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare studio public.studios; first_day date; from_time timestamptz; until_time timestamptz; result jsonb;
begin
 select s.* into studio from public.studios s where public.is_studio_coach(s.id) order by s.id limit 1;
 if studio.id is null then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if p_page<1 or p_page>100000 or (p_metric is not null and p_metric not in ('outstanding','receipts','refunds','pending','dollarCredit','availableCredits','reservedCredits','remainingCredits','packageExceptions')) then raise exception 'VALIDATION_FAILED'; end if;
 first_day:=date_trunc('month',coalesce(p_month,(now() at time zone coalesce(studio.settings->>'timezone',studio.timezone,'America/New_York'))::date))::date;
 from_time:=first_day::timestamp at time zone coalesce(studio.settings->>'timezone',studio.timezone,'America/New_York');
 until_time:=(first_day+interval '1 month')::timestamp at time zone coalesce(studio.settings->>'timezone',studio.timezone,'America/New_York');
 with facts as materialized(select * from workspace_internal.finance_facts(studio.id,from_time,until_time)), totals as (
  select metric,currency,unit,sum(amount) amount,count(*) count from facts group by metric,currency,unit
 ), selected as (select * from facts where (p_metric is null or metric=p_metric) and (p_currency is null or currency=p_currency)), rows as (
  select * from selected order by occurred_at desc nulls last,id,metric limit 25 offset (p_page-1)*25
 ) select jsonb_build_object('month',first_day,'timezone',coalesce(studio.settings->>'timezone',studio.timezone),'from',from_time,'until',until_time,'evaluatedAt',now(),
  'totals',coalesce((select jsonb_agg(to_jsonb(t) order by metric,currency) from totals t),'[]'),'reviewCount',(select count(distinct student_id) from facts where state='Review required'),
  'items',coalesce((select jsonb_agg(to_jsonb(r)) from rows r),'[]'),'count',(select count(*) from selected),'page',p_page) into result;
 return result;
end $$;
revoke all on function public.studio_financial_dashboard(date,text,text,integer) from public,anon;
grant execute on function public.studio_financial_dashboard(date,text,text,integer) to authenticated;

create function public.communication_activity(p_page integer default 1,p_attention boolean default false,p_search text default '',p_kind text default '') returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare result jsonb;
begin
 if (select auth.uid()) is null then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if p_page<1 or p_page>100000 or p_kind not in ('','message','notification','invitation','campaign') then raise exception 'VALIDATION_FAILED'; end if;
 with activity as (
  select m.id,m.created_at happened_at,'message' kind,c.title title,
   case when m.author_role='coach' then 'Coach message' else 'Reply received' end state,
   ('/'||case when public.is_studio_coach(m.studio_id) then 'coach' else 'portal' end||'/inbox?conversation='||m.conversation_id||'&message='||m.id) href,
   (public.is_studio_coach(m.studio_id) and m.author_role<>'coach' and not exists(select 1 from public.conversation_messages newer where newer.conversation_id=m.conversation_id and newer.created_at>m.created_at)) attention
   from public.conversation_messages m join public.conversations c on c.id=m.conversation_id where m.deleted_at is null
  union all select o.id,o.updated_at,case when o.campaign_id is not null then 'campaign' when o.event_key like '%invite%' or o.event_key like '%credentials%' then 'invitation' else 'notification' end,left(o.subject,200),o.status::text,
   case when o.campaign_id is not null then '/coach/campaigns?campaign='||o.campaign_id when o.student_id is not null then '/coach/students/'||o.student_id||'/household' else '/coach/settings?panel=data' end,
   (o.status='failed' or o.suppression_reason is not null or (o.status='queued' and (o.event_key like '%invite%' or o.event_key like '%credentials%') and o.send_at<now()-interval '15 minutes')) from public.outbox_messages o where public.is_studio_coach(o.studio_id)
 ), selected as (select * from activity where (not p_attention or attention) and (p_kind='' or kind=p_kind) and (p_search='' or title ilike '%'||left(p_search,120)||'%')),
 rows as (select * from selected order by happened_at desc,id limit 25 offset (p_page-1)*25)
 select jsonb_build_object('items',coalesce((select jsonb_agg(to_jsonb(r)) from rows r),'[]'),'count',(select count(*) from selected),'page',p_page) into result;
 return result;
end $$;
revoke all on function public.communication_activity(integer,boolean,text,text) from public,anon;
grant execute on function public.communication_activity(integer,boolean,text,text) to authenticated;

-- Auth evidence is reduced to access state for one coach-authorized Household.
create function public.household_access_states(p_student uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 if not exists(select 1 from public.students s where s.id=p_student and s.deleted_at is null and public.is_studio_coach(s.studio_id)) then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 select jsonb_build_object('items',coalesce(jsonb_agg(to_jsonb(x)),'[]')) into result from (
  select a.account_type,a.linked_contact_id,a.must_change_password,
   (to_jsonb(u)->>'last_sign_in_at') last_signed_in_at,
   case when nullif(to_jsonb(u)->>'last_sign_in_at','') is not null then 'signed_in' else 'provisioned' end activation,
   case when a.account_type='student' then s.portal_enabled else coalesce(c.portal_enabled,false) end access_enabled
  from public.portal_accounts a join public.students s on s.id=a.student_id left join public.linked_contacts c on c.id=a.linked_contact_id
   left join auth.users u on u.id=a.user_id where a.student_id=p_student and a.studio_id=s.studio_id order by a.created_at,a.id limit 100
 )x;
 return result;
end $$;
revoke all on function public.household_access_states(uuid) from public,anon;
grant execute on function public.household_access_states(uuid) to authenticated;
