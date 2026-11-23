-- Coach reporting projections. The payment and credit ledgers remain authoritative.
create index wave4_payment_student_date on public.payment_entries (student_id,created_at,id)
  where not account_credit and kind in ('payment','refund');
create index wave4_credit_package_date on public.package_credit_entries (package_id,created_at,id);
create index wave4_open_invoice_due on public.studio_invoices (studio_id,due_date,id)
  where status in ('open','partially_paid');
create index wave4_finance_lessons on public.lessons (studio_id,student_id,id)
  where payment_status in ('due','partially_paid') and status in ('scheduled','completed');

create function workspace_internal.finance_week4_facts(
  p_studio uuid,p_zone text,p_start date,p_end date,p_group text
) returns table (
  id uuid, kind text, amount bigint, currency text, date_on date, occurred_at timestamptz,
  student_id uuid, student text, payer text, title text, status text, method text,
  service_id uuid, service text, invoice_id uuid, lesson_id uuid, package_id uuid, href text,
  service_allocations jsonb
)
language sql stable set search_path='' as $$
  with students as materialized (
    select s.id,s.full_name from public.students s where s.studio_id=p_studio
  ), monetary as (
    select e.*,s.full_name,i.id as invoice_id,i.number,i.recipient->>'name' as payer,
      case when i.id is not null then st.method end as method,i.items,st.allocations,
      coalesce(r.lesson_id,direct.id,booked.lesson_id) as lesson_id,
      coalesce(r.method,case when direct.id is not null then 'online' end) as direct_method
    from students s
    join public.payment_entries e on e.student_id=s.id
    left join public.invoice_settlements st on st.reference=e.external_reference
    left join public.studio_invoices i on i.id=st.invoice_id and i.studio_id=p_studio and i.student_id=e.student_id
    left join lesson_ops.payment_receipts r on r.payment_entry_id=e.id and r.studio_id=p_studio
    left join public.lessons direct on direct.id=(case when e.external_reference ~
      '^lesson-checkout:[0-9a-f-]{36}:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then split_part(e.external_reference,':',3)::uuid end) and direct.studio_id=p_studio and direct.student_id=e.student_id
    left join lateral (
      select (array_agg(distinct lp.lesson_id))[1] as lesson_id
      from public.bookings b join public.lesson_participants lp on lp.booking_id=b.id
      where b.id=(case when e.external_reference ~
        '^manual:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        then split_part(e.external_reference,':',2)::uuid end)
        and b.student_id=e.student_id and b.studio_id=p_studio
      having count(distinct lp.lesson_id)=1
    ) booked on true
    where p_group in ('overview','collections','gross','refunds','packages')
      and not e.account_credit and e.kind in ('payment','refund')
      and e.created_at>=p_start::timestamp at time zone p_zone
      and e.created_at<(p_end+1)::timestamp at time zone p_zone
      and (p_group<>'packages' or (e.package_id is not null and e.kind='payment'))
      and (p_group<>'gross' or e.kind='payment') and (p_group<>'refunds' or e.kind='refund')
  ), cash as (
    select m.id,case when m.kind='refund' then 'refund'
      when m.package_id is not null then 'package_purchase' else 'payment' end as kind,
      m.amount_minor as amount,m.currency,(m.created_at at time zone p_zone)::date as date_on,
      m.created_at as occurred_at,m.student_id,m.full_name as student,m.payer,
      coalesce(pkg.name,m.number,lesson.topic,case when m.kind='refund' then 'Refund' else 'Payment' end) as title,
      'settled'::text as status,coalesce(m.method,m.direct_method,'unclassified') as method,
      svc.id as service_id,coalesce(svc.name,case when allocated.service_count>1 then 'Multiple services' else 'Unattributed' end) as service,
      m.invoice_id,m.lesson_id,m.package_id,
      '/coach/students/'||m.student_id||'/payments?'||
      case when m.invoice_id is not null then 'invoice='||m.invoice_id
        when m.package_id is not null then 'package='||m.package_id
        else 'payment='||m.id end as href,
      allocated.breakdown as service_allocations
    from monetary m
    left join public.packages pkg on pkg.id=m.package_id and pkg.student_id=m.student_id
    left join public.lessons lesson on lesson.id=m.lesson_id and lesson.studio_id=p_studio and lesson.student_id=m.student_id
    left join lateral (
      select count(t.service_id) as service_count,
        case when count(*)=1 and sum(t.amount)=m.amount_minor then (array_agg(t.service_id))[1] end as service_id,
        case when sum(t.amount)=m.amount_minor then jsonb_agg(jsonb_build_object(
          'service_id',t.service_id,'service',coalesce(t.name,'Unattributed'),'amount',t.amount)) end as breakdown
      from (
        select assignment.service_id,service.name,sum((a->>'amountMinor')::bigint)::bigint as amount
        from jsonb_array_elements(m.allocations) a
        join lateral jsonb_array_elements(m.items) li on li->>'id'=a->>'lineId'
        left join lateral (
          select (array_agg(distinct l.service_id))[1] as service_id
          from jsonb_array_elements_text(coalesce(li->'lessonIds','[]')) lesson_id
          join public.lessons l on l.id=(case when lesson_id.value ~
            '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then lesson_id.value::uuid end)
            and l.studio_id=p_studio and l.student_id=m.student_id
          having count(distinct l.service_id)=1 and count(l.service_id)=jsonb_array_length(coalesce(li->'lessonIds','[]'))
        ) assignment on true
        left join public.booking_services service on service.id=assignment.service_id and service.studio_id=p_studio
        where a->>'amountMinor' ~ '^[1-9][0-9]{0,15}$'
        group by assignment.service_id,service.name
      ) t
    ) allocated on m.invoice_id is not null and p_group<>'overview'
    left join public.booking_services svc on svc.id=coalesce(lesson.service_id,allocated.service_id) and svc.studio_id=p_studio
  ), receivables as (
    select i.id,'invoice'::text as kind,(i.total_minor-i.paid_minor-i.credit_minor-i.waived_minor)::bigint as amount,
      i.currency,i.due_date as date_on,i.updated_at as occurred_at,i.student_id,s.full_name as student,
      i.recipient->>'name' as payer,i.number as title,
      case when i.due_date<(now() at time zone p_zone)::date then 'overdue'
        when i.checkout_key is not null then 'checkout_pending' else i.status end as status,
      null::text as method,null::uuid as service_id,null::text as service,
      i.id as invoice_id,null::uuid as lesson_id,null::uuid as package_id,
      '/coach/students/'||i.student_id||'/payments?invoice='||i.id as href,null::jsonb as service_allocations
    from public.studio_invoices i join students s on s.id=i.student_id
    where p_group in ('overview','receivables','overdue') and i.studio_id=p_studio
      and i.status in ('open','partially_paid') and i.total_minor>i.paid_minor+i.credit_minor+i.waived_minor
      and (p_group<>'overdue' or i.due_date<(now() at time zone p_zone)::date)
    union all
    select l.id,'lesson',(terms.value->>'remainingMinor')::bigint,terms.value->>'currency',
      null,l.updated_at,l.student_id,s.full_name,null,l.topic,l.payment_status,null,svc.id,svc.name,
      null,l.id,null,'/coach/students/'||l.student_id||'/lessons/'||l.id,null::jsonb
    from public.lessons l join students s on s.id=l.student_id
    left join public.booking_services svc on svc.id=l.service_id and svc.studio_id=p_studio
    cross join lateral (select lesson_ops.payment_context(auth.uid(),l.id) as value offset 0) terms
    where p_group in ('overview','receivables') and l.studio_id=p_studio and l.invoice_id is null
      and l.status in ('scheduled','completed') and l.payment_status in ('due','partially_paid')
      and not l.payment_needs_review and terms.value->>'eligible'='true'
  ), scheduled as (
    select a.id,'scheduled'::text as kind,(terms.value->>'amountMinor')::bigint as amount,
      m.currency,(a.pay_at at time zone p_zone)::date as date_on,a.pay_at as occurred_at,
      m.student_id,s.full_name as student,null::text as payer,l.topic as title,'authorized'::text as status,
      'autopay'::text as method,svc.id as service_id,svc.name as service,l.invoice_id,l.id as lesson_id,
      null::uuid as package_id,'/coach/students/'||m.student_id||'/lessons/'||l.id as href,
      null::jsonb as service_allocations
    from training_internal.lesson_autopay_mandates m
    join students s on s.id=m.student_id
    join training_internal.lesson_autopay_attempts a on a.mandate_id=m.id
    join public.lessons l on l.id=a.lesson_id and l.studio_id=m.studio_id and l.student_id=m.student_id
    left join public.booking_services svc on svc.id=l.service_id and svc.studio_id=p_studio
    cross join lateral (select training_internal.autopay_lesson_terms(l.id) as value offset 0) terms
    where p_group in ('overview','scheduled') and m.studio_id=p_studio and m.status='active'
      and a.state='planned' and a.pay_at>now() and a.starts_at=l.starts_at
      and a.pay_at=training_internal.autopay_when(l.starts_at,m.timezone,m.lead_days,m.charge_time)
      and m.authorized_at is not null and m.stripe_method is not null
      and training_internal.is_lesson_payer(m.payer_id,m.student_id)
      and training_internal.autopay_studio_allows(m)
      and training_internal.autopay_binding(terms.value)=training_internal.autopay_binding(a.terms)
      and terms.value->>'currency'=m.currency and (terms.value->>'amountMinor')::bigint between 1 and least(m.maximum_minor,a.amount_minor)
  ), credit as (
    select e.id,e.kind::text as kind,e.quantity::bigint as amount,'CREDITS'::text as currency,
      (e.created_at at time zone p_zone)::date as date_on,e.created_at as occurred_at,
      coalesce(covered.id,s.id) as student_id,coalesce(covered.full_name,s.full_name) as student,
      s.full_name as payer,p.name as title,'recorded'::text as status,null::text as method,
      svc.id as service_id,svc.name as service,null::uuid as invoice_id,e.lesson_id,p.id as package_id,
      '/coach/students/'||s.id||'/payments?section=credits&package='||p.id as href,null::jsonb as service_allocations
    from students s join public.packages p on p.student_id=s.id
    join public.package_credit_entries e on e.package_id=p.id
    left join students covered on covered.id=e.covered_student_id
    left join public.lessons l on l.id=e.lesson_id and l.studio_id=p_studio
    left join public.booking_services svc on svc.id=l.service_id and svc.studio_id=p_studio
    where p_group='credits' and e.created_at>=p_start::timestamp at time zone p_zone
      and e.created_at<(p_end+1)::timestamp at time zone p_zone
  )
  select * from cash union all select * from receivables
  union all select * from scheduled union all select * from credit;
$$;
revoke all on function workspace_internal.finance_week4_facts(uuid,text,date,date,text) from public,anon,authenticated,service_role;

create function workspace_internal.finance_csv_cell(p_value text) returns text
language sql immutable set search_path='' as $$
  select '"' || replace(case when coalesce(p_value,'') ~ '^[[:space:][:cntrl:]]*[=+@-]'
      or coalesce(p_value,'') ~ '^[[:cntrl:]]' then '''' else '' end || coalesce(p_value,''),'"','""') || '"';
$$;
revoke all on function workspace_internal.finance_csv_cell(text) from public,anon,authenticated,service_role;

create function public.finance_report(p_studio uuid,p_start date,p_end date,p_filters jsonb default '{}')
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
  zone text;
  mode text:=coalesce(p_filters->>'group','overview');
  currency_filter text:=nullif(p_filters->>'currency','');
  term text:=lower(trim(coalesce(p_filters->>'search','')));
  status_filter text:=nullif(p_filters->>'status','');
  kind_filter text:=nullif(p_filters->>'kind','');
  student_filter text:=nullif(p_filters->>'student','');
  service_filter text:=nullif(p_filters->>'service','');
  oldest boolean:=p_filters->>'sort'='oldest';
  page integer:=coalesce((p_filters->>'page')::integer,1);
  exporting boolean:=coalesce((p_filters->>'export')::boolean,false);
  result jsonb;
begin
  if auth.uid() is null or not public.is_studio_coach(p_studio) then
    raise exception 'FORBIDDEN' using errcode='42501';
  end if;
  select coalesce(s.settings->>'timezone',s.timezone) into zone from public.studios s where s.id=p_studio;
  if p_start is null or p_end is null or p_end<p_start or p_end-p_start>365 or length(term)>120
    or page not between 1 and 100000 or mode not in ('overview','collections','gross','refunds','receivables','overdue','scheduled','packages','credits')
    or (exporting and mode='overview') then raise exception 'VALIDATION_FAILED'; end if;
  with source as materialized (
    select * from workspace_internal.finance_week4_facts(p_studio,zone,p_start,p_end,mode)
  ), facts as materialized (
    select f.id,f.kind,coalesce(slice.amount,f.amount) as amount,f.currency,f.date_on,f.occurred_at,
      f.student_id,f.student,f.payer,f.title,f.status,f.method,coalesce(slice.service_id,f.service_id) as service_id,
      coalesce(slice.service,f.service) as service,f.invoice_id,f.lesson_id,f.package_id,f.href,f.service_allocations
    from source f
    left join lateral (
      select a.* from jsonb_to_recordset(f.service_allocations) a(service_id uuid,service text,amount bigint)
      where a.service_id::text=service_filter
    ) slice on service_filter is not null
    where (currency_filter is null or f.currency=currency_filter)
      and (status_filter is null or f.status=status_filter)
      and (kind_filter is null or f.kind=kind_filter)
      and (student_filter is null or f.student_id::text=student_filter)
      and (service_filter is null or f.service_id::text=service_filter or slice.service_id is not null)
      and (term='' or strpos(lower(concat_ws(' ',f.student,f.payer,f.title,f.service,f.method,f.status,
        f.invoice_id,f.lesson_id,f.package_id,f.id)),term)>0)
      and (mode not in ('receivables','overdue','scheduled') or not coalesce((p_filters->>'filterDates')::boolean,false)
        or f.date_on between p_start and p_end)
  ), metrics as (
    select case when f.kind='refund' then 'refunds' when f.kind='scheduled' then 'scheduled'
      when f.kind in ('invoice','lesson') then 'outstanding' else 'gross' end as metric,
      f.currency,f.amount from facts f where mode='overview'
    union all select 'overdue',f.currency,f.amount from facts f where mode='overview' and f.status='overdue'
  ), totals as (
    select metric,currency,sum(amount) amount from metrics group by metric,currency
    union all
    select 'net',currency,sum(case when metric='refunds' then -amount else amount end)
    from metrics where metric in ('gross','refunds') group by currency
  ), trend as (
    select date_on,currency,sum(case when kind='refund' then 0 else amount end) gross,
      sum(case when kind='refund' then amount else 0 end) refunds
    from facts where mode='overview' and kind in ('payment','refund','package_purchase') group by 1,2
  ), service_breakdown as (
    select coalesce(a.service,'Unattributed') as service,f.currency,
      sum(case when f.kind='refund' then 0 else a.amount end) gross,
      sum(case when f.kind='refund' then a.amount else 0 end) refunds
    from facts f
    cross join lateral jsonb_to_recordset(coalesce(
      case when service_filter is null then f.service_allocations end,
      jsonb_build_array(jsonb_build_object('service',f.service,'amount',f.amount))
    )) a(service text,amount bigint)
    where mode in ('collections','gross','refunds','packages') group by 1,2
  ), paged as (
    select * from facts where mode<>'overview'
    order by case when oldest then occurred_at end asc nulls last,
      case when not coalesce(oldest,false) then occurred_at end desc nulls last,id,kind
    limit case when exporting then 5000 else 25 end offset case when exporting then 0 else (page-1)*25 end
  ), export_rows as (
    select p.*,array_to_string(array[
      workspace_internal.finance_csv_cell(p_start::text),workspace_internal.finance_csv_cell(p_end::text),
      workspace_internal.finance_csv_cell(zone),workspace_internal.finance_csv_cell(mode),
      workspace_internal.finance_csv_cell(p.date_on::text),workspace_internal.finance_csv_cell(p.kind),
      workspace_internal.finance_csv_cell(p.status),workspace_internal.finance_csv_cell(p.student),
      workspace_internal.finance_csv_cell(p.payer),workspace_internal.finance_csv_cell(p.title),
      workspace_internal.finance_csv_cell(p.service),workspace_internal.finance_csv_cell(p.method),
      p.amount::text,workspace_internal.finance_csv_cell(p.currency),
      workspace_internal.finance_csv_cell(p.invoice_id::text),workspace_internal.finance_csv_cell(p.lesson_id::text),
      workspace_internal.finance_csv_cell(p.package_id::text)
    ],',') as line from paged p where exporting
  )
  select jsonb_build_object(
    'count',(select count(*) from facts),'page',page,'timezone',zone,
    'currencies',coalesce((select jsonb_agg(value order by value) from
      (select distinct currency as value from source) c),'[]'),
    'rows',case when exporting then '[]'::jsonb else
      coalesce((select jsonb_agg(to_jsonb(p) order by case when oldest then p.occurred_at end asc nulls last,
        case when not coalesce(oldest,false) then p.occurred_at end desc nulls last,p.id,p.kind) from paged p),'[]') end,
    'totals',coalesce((select jsonb_agg(to_jsonb(t) order by metric,currency) from totals t),'[]'),
    'trend',coalesce((select jsonb_agg(to_jsonb(t) order by date_on,currency) from trend t),'[]'),
    'services',coalesce((select jsonb_agg(to_jsonb(s) order by service,currency) from service_breakdown s),'[]'),
    'reportTotals',coalesce((select jsonb_agg(to_jsonb(t) order by kind,currency) from
      (select kind,currency,sum(amount) amount from facts where mode<>'overview' group by kind,currency)t),'[]'),
    'csv',case when exporting and (select count(*) from facts)<=5000 then
      'period_start,period_end,studio_timezone,report,date,type,status,student,payer,record,service,method,amount_minor_or_credits,currency,invoice_id,lesson_id,package_id'
      || E'\r\n' || coalesce((select string_agg(e.line,E'\r\n' order by case when oldest then e.occurred_at end asc nulls last,
        case when not coalesce(oldest,false) then e.occurred_at end desc nulls last,e.id,e.kind) from export_rows e),'') end
  ) into result;
  return result;
end $$;
revoke all on function public.finance_report(uuid,date,date,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.finance_report(uuid,date,date,jsonb) to authenticated;

