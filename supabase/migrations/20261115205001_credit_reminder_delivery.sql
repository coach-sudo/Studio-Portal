alter table credit_internal.reminder_conditions
  drop constraint reminder_conditions_condition_type_check,
  alter column lesson_id drop not null,
  add column low_package_id uuid,
  add column available_credits integer,
  add column paused_at timestamptz,
  add constraint reminder_condition_subject check (
    (condition_type='uncovered_lesson' and lesson_id is not null and low_package_id is null)
    or (condition_type='low_credit' and lesson_id is null and low_package_id is not null)
  );
create unique index reminder_low_package_idx on credit_internal.reminder_conditions(low_package_id)
  where condition_type='low_credit';
create index reminder_active_student_idx on credit_internal.reminder_conditions (student_id,condition_type,low_package_id)
  where status<>'resolved';
create index reminder_prepaid_bookings_idx on public.bookings (student_id,starts_at)
  where status='confirmed' and payment_policy='credits';

create table credit_internal.reminder_settings (
  studio_id uuid not null references public.studios(id),
  scope text not null check (scope in ('studio','student','package')),
  scope_id uuid not null,
  threshold integer check (threshold between 0 and 100000),
  enabled boolean,
  student_copy boolean,
  primary key(studio_id,scope,scope_id)
);
create table credit_internal.reminder_templates (
  studio_id uuid not null references public.studios(id),
  kind text not null check (kind in ('low_credit','uncovered_lesson','follow_up')),
  version integer not null check (version>0),
  subject text not null,
  body text not null,
  active boolean not null,
  created_at timestamptz not null default now(),
  created_by uuid not null,
  primary key(studio_id,kind,version)
);
create table credit_internal.reminder_scan (
  student_id uuid primary key references public.students(id) on delete cascade,
  checked_at timestamptz not null
);
create table credit_internal.reminder_deliveries (
  id uuid primary key default gen_random_uuid(),
  condition_id uuid not null references credit_internal.reminder_conditions(id),
  cycle_at timestamptz not null,
  student_id uuid not null references public.students(id),
  recipient_user_id uuid not null,
  recipient_contact_id uuid references public.linked_contacts(id) on delete set null,
  recipient_email text,
  is_copy boolean not null default false,
  channel text not null check (channel in ('portal','email')),
  template_kind text not null,
  template_version integer not null,
  subject text not null,
  body text not null,
  action_path text not null,
  status text not null check (status in ('queued','claimed','sending','sent','failed','uncertain','suppressed')),
  status_reason text,
  attempts integer not null default 0,
  due_at timestamptz not null,
  lease_until timestamptz,
  claim_token uuid,
  acknowledged_at timestamptz,
  provider_reference text,
  created_at timestamptz not null default now(),
  unique(condition_id,cycle_at,recipient_user_id,channel)
);
create index reminder_deliveries_due_idx on credit_internal.reminder_deliveries(due_at,id)
  where channel='email' and status in ('queued','failed');
create index reminder_deliveries_history_idx on credit_internal.reminder_deliveries(recipient_user_id,created_at desc)
  where channel='portal' and status='sent';
create table credit_internal.reminder_attempts (
  delivery_id uuid not null references credit_internal.reminder_deliveries(id),
  token uuid not null,
  outcome text not null check(outcome in ('sent','failed','uncertain','suppressed')),
  attempted_at timestamptz not null,
  primary key(delivery_id,token)
);
alter table credit_internal.reminder_settings enable row level security;
alter table credit_internal.reminder_templates enable row level security;
alter table credit_internal.reminder_scan enable row level security;
alter table credit_internal.reminder_deliveries enable row level security;
alter table credit_internal.reminder_attempts enable row level security;
revoke all on credit_internal.reminder_settings,credit_internal.reminder_templates,credit_internal.reminder_scan,
  credit_internal.reminder_deliveries,credit_internal.reminder_attempts from public,anon,authenticated,service_role;

-- A designated payer takes precedence, including when that payer has opted out.
-- Adult self-payers follow the existing payment responsibility rule.
create function credit_internal.reminder_recipient(p_student uuid,p_contact uuid,p_copy boolean default false)
returns jsonb language sql stable set search_path='' as $$
  select case
    when p_copy or p_contact is null then
      case when not s.is_minor and s.portal_enabled and s.user_id is not null
        and s.notification_preferences->'packageBalance' is distinct from 'false'::jsonb
        and (p_copy or not exists(select 1 from public.linked_contacts x where x.student_id=s.id and x.is_primary_payer)
          and nullif(trim(s.email),'') is not null)
      then jsonb_build_object('userId',s.user_id,'contactId',null,'name',s.full_name,'email',lower(trim(s.email))) end
    when c.portal_enabled and c.can_view_finance and c.can_receive_notifications and c.user_id is not null
      and c.notification_preferences->'packageBalance' is distinct from 'false'::jsonb then
      jsonb_build_object('userId',c.user_id,'contactId',c.id,'name',c.full_name,'email',lower(trim(c.email)))
    end
  from public.students s left join public.linked_contacts c on c.id=p_contact and c.student_id=s.id
    and c.studio_id=s.studio_id
  where s.id=p_student and s.deleted_at is null
$$;

create function credit_internal.reminder_policy(p_studio uuid,p_student uuid,p_package uuid)
returns jsonb language sql stable set search_path='' as $$
  select jsonb_build_object('enabled',coalesce(g.enabled,true) and coalesce(s.enabled,p.enabled,true),
    'threshold',coalesce(s.threshold,p.threshold,g.threshold,2),'studentCopy',coalesce(s.student_copy,g.student_copy,false))
  from (select 1) v
  left join credit_internal.reminder_settings g on g.studio_id=p_studio and g.scope='studio' and g.scope_id=p_studio
  left join credit_internal.reminder_settings s on s.studio_id=p_studio and s.scope='student' and s.scope_id=p_student
  left join credit_internal.reminder_settings p on p.studio_id=p_studio and p.scope='package' and p.scope_id=p_package
$$;

-- The verified checkout handoff creates an unissued Stripe-backed lot. Issuance
-- attaches the credit entry and the existing expiry webhook removes abandoned lots.
create function credit_internal.pending_credit_renewal(p_student uuid,p_services uuid[],p_minutes integer)
returns boolean language sql stable set search_path='' as $$
  select exists (
    select 1 from public.packages p join credit_internal.package_credit_terms t on t.package_id=p.id
    where p.student_id=p_student and p.stripe_price_id is not null and p.credit_quantity>0
      and t.original_definition_id is not null and t.issuance_entry_id is null
      and t.duration_minutes=p_minutes and t.service_ids && p_services
      and (p.expires_at is null or p.expires_at>now())
  )
$$;
revoke all on function credit_internal.pending_credit_renewal(uuid,uuid[],integer) from public,anon,authenticated,service_role;

create function credit_internal.refresh_low_credit_reminders(p_student uuid,p_at timestamptz)
returns void language plpgsql set search_path='' as $$
declare lot record; member record; policy jsonb; target jsonb; route jsonb; candidate jsonb;
  selected_student uuid; contact uuid; matches integer; conflict boolean; shortage boolean; pending boolean;
  v_status text; reason text; available integer;
begin
  for lot in
    select p.id,p.student_id,p.household_id,p.expires_at,s.studio_id,t.duration_minutes,t.service_ids,
      t.issuance_entry_id,t.allow_household_credits
    from (
      select id from public.packages where student_id=p_student
      union select package_id from credit_internal.credit_pool_members where student_id=p_student
      union select low_package_id from credit_internal.reminder_conditions
        where student_id=p_student and condition_type='low_credit' and status<>'resolved'
    ) owned
    join public.packages p on p.id=owned.id
    left join credit_internal.package_credit_terms t on t.package_id=p.id
    join public.students s on s.id=p_student
    order by p.id
  loop
    if lot.duration_minutes is null or coalesce(cardinality(lot.service_ids),0)=0 or lot.issuance_entry_id is null
      or lot.expires_at<=greatest(now(),p_at) then
      update credit_internal.reminder_conditions set status='resolved',status_reason='lot_unavailable',
        contact_id=null,next_due_at=null,resolved_at=p_at,evaluated_at=p_at
        where low_package_id=lot.id and status<>'resolved';
      continue;
    end if;

    available:=public.package_credit_balance(lot.id);
    target:=null; selected_student:=null; matches:=0; conflict:=available<0; shortage:=false; pending:=false;
    for member in
      select distinct s.id
      from public.students s
      join public.lesson_participants lp on lp.student_id=s.id and lp.status in ('confirmed','reserved')
      join public.bookings b on b.id=lp.booking_id and b.student_id=s.id and b.studio_id=lot.studio_id
      join public.lessons l on l.id=lp.lesson_id and l.studio_id=lot.studio_id
      where s.studio_id=lot.studio_id and s.deleted_at is null and credit_internal.student_may_spend_pool(lot.id,s.id)
        and b.status='confirmed' and b.payment_policy='credits' and b.payment_status not in ('processing','partially_paid')
        and b.paid_minor=0 and l.status='scheduled' and l.starts_at>greatest(now(),p_at)
        and l.service_id=any(lot.service_ids) and l.ends_at-l.starts_at=make_interval(mins=>lot.duration_minutes)
        and (lot.expires_at is null or lot.expires_at>l.starts_at)
      order by s.id
    loop
      policy:=credit_internal.reminder_policy(lot.studio_id,member.id,lot.id);
      if policy->>'enabled'<>'true' or available>(policy->>'threshold')::integer then continue; end if;
      matches:=matches+1;
      if selected_student is null then selected_student:=member.id; end if;
      if credit_internal.pending_credit_renewal(member.id,lot.service_ids,lot.duration_minutes) then
        pending:=true; continue;
      end if;
      if public.student_credit_summary(member.id)->>'needsReview'='true'
        or exists(select 1 from credit_internal.reconciliation_cases r where r.student_id=member.id
          and r.status in ('needs_review','under_review','reopened')
          and coalesce(r.evidence->'present','true'::jsonb)='true'::jsonb) then
        conflict:=true; continue;
      end if;
      -- Shortages provide the action. Give them precedence over a low-lot notice.
      if exists(select 1 from public.lessons l join public.lesson_participants lp
        on lp.lesson_id=l.id and lp.student_id=member.id and lp.status in ('confirmed','reserved')
        where l.studio_id=lot.studio_id and l.status='scheduled'
        and l.starts_at>greatest(now(),p_at)
        and l.service_id=any(lot.service_ids) and l.ends_at-l.starts_at=make_interval(mins=>lot.duration_minutes)
        and credit_internal.credit_lesson_billing_route(member.id,l.id)->>'status'
            in ('authorized','missing_recipient','ambiguous_pool','disputed')) then
        shortage:=true; continue;
      end if;
      contact:=credit_internal.shared_pool_billing_contact(case when lot.household_id is not null then lot.id end,member.id);
      candidate:=credit_internal.reminder_recipient(member.id,contact);
      if candidate is null then conflict:=true; continue; end if;
      if target is not null and target->>'userId'<>candidate->>'userId' then conflict:=true; end if;
      if target is null and selected_student=member.id then target:=candidate; end if;
    end loop;

    if matches=0 or shortage then
      update credit_internal.reminder_conditions set status='resolved',
        status_reason=case when shortage then 'lesson_shortage_precedes' else 'balance_or_activity_changed' end,
        contact_id=null,next_due_at=null,resolved_at=p_at,evaluated_at=p_at
        where low_package_id=lot.id and status<>'resolved';
      continue;
    end if;
    if pending then
      v_status:='blocked'; reason:='processing';
    elsif conflict or target is null then
      v_status:='blocked'; reason:='pool_routing_or_review';
    else
      v_status:='open'; reason:='low_credit';
    end if;
    insert into credit_internal.reminder_conditions as existing (
      studio_id,student_id,condition_type,low_package_id,package_id,contact_id,available_credits,
      status,status_reason,opened_at,evaluated_at,next_due_at
    ) values (
      lot.studio_id,selected_student,'low_credit',lot.id,lot.id,
      case when v_status='open' then (target->>'contactId')::uuid end,available,
      v_status,reason,p_at,p_at,case when v_status='open' then p_at end
    )
    on conflict(low_package_id) where condition_type='low_credit' do update set
      student_id=excluded.student_id,package_id=excluded.package_id,available_credits=excluded.available_credits,
      contact_id=excluded.contact_id,status=excluded.status,status_reason=excluded.status_reason,
      evaluated_at=p_at,resolved_at=null,next_due_at=case
        when excluded.status<>'open' then null
        when existing.last_delivery_at is not null then existing.last_delivery_at+interval '72 hours'
        when existing.status='open' then existing.next_due_at else p_at end;
  end loop;
  update credit_internal.reminder_conditions c set status='resolved',status_reason='lot_unavailable',
    next_due_at=null,contact_id=null,resolved_at=p_at,evaluated_at=p_at
  where c.student_id=p_student and c.condition_type='low_credit' and c.package_id is null and c.status<>'resolved';
end $$;

create or replace function public.refresh_credit_reminder_conditions(p_student uuid,p_at timestamptz default now())
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_studio uuid; lesson record; route jsonb; evaluation jsonb;
  v_status text; v_reason text; v_package uuid; v_contact uuid;
  recipient jsonb; policy jsonb; checked_count integer:=0; open_count integer:=0; blocked_count integer:=0; resolved_count integer;
begin
  if p_at is null or not isfinite(p_at) then raise exception 'VALIDATION_FAILED'; end if;
  select s.studio_id into v_studio from public.students s where s.id=p_student and s.deleted_at is null for share;
  perform pg_advisory_xact_lock(hashtextextended('credit-reminders:'||p_student::text,0));

  for lesson in
    select l.id,l.starts_at,
      (bool_or(b.payment_status='processing') or credit_internal.pending_credit_renewal(
        p_student,array[l.service_id],(extract(epoch from l.ends_at-l.starts_at)/60)::integer)) as payment_pending,
      bool_or(b.payment_status='partially_paid' or b.paid_minor>0) as financial_review
    from public.lessons l
    join public.lesson_participants lp on lp.lesson_id=l.id and lp.student_id=p_student
    join public.bookings b on b.id=lp.booking_id and b.student_id=p_student and b.studio_id=v_studio
    where l.studio_id=v_studio and l.status='scheduled' and l.service_id is not null
      and l.starts_at>greatest(now(),p_at) and lp.status in ('reserved','confirmed')
      and b.status='confirmed' and b.payment_policy='credits'
    group by l.id
    order by l.starts_at,l.id
  loop
    checked_count:=checked_count+1;
    evaluation:=credit_internal.evaluate_student_lesson_credit(p_student,lesson.id,'manual');
    route:=credit_internal.credit_lesson_billing_route(p_student,lesson.id);
    policy:=credit_internal.reminder_policy(v_studio,p_student,(route->>'packageId')::uuid);
    recipient:=case when route->>'status' in ('authorized','missing_recipient') then
      credit_internal.reminder_recipient(p_student,(route->>'contactId')::uuid) end;
    v_package:=null;
    v_contact:=null;
    if evaluation->>'state'='covered' and not lesson.financial_review then
      v_status:='resolved';
    elsif policy->>'enabled'<>'true' then
      v_status:='blocked'; v_reason:='reminders_disabled';
    elsif lesson.payment_pending or evaluation->>'reasonCode'='payment_pending' then
      v_status:='blocked'; v_reason:='processing';
    elsif lesson.financial_review or evaluation->>'state'='review_required' or route->>'status'='disputed' then
      v_status:='blocked'; v_reason:='studio_review';
    elsif route->>'status' in ('authorized','missing_recipient') and recipient is not null then
      v_status:='open'; v_reason:='uncovered';
      v_package:=(route->>'packageId')::uuid; v_contact:=(recipient->>'contactId')::uuid;
    elsif route->>'status' in ('missing_recipient','ambiguous_pool','authorized') then
      v_status:='blocked'; v_reason:=case when route->>'status'='authorized' then 'recipient_preference' else route->>'status' end;
      v_package:=(route->>'packageId')::uuid;
    else
      v_status:='resolved';
    end if;
    if v_status='resolved' then
      -- A valid hold or a compatible available lot needs no demand.
      update credit_internal.reminder_conditions set status='resolved',status_reason='coverage_changed',
        package_id=null,contact_id=null,evaluated_at=p_at,next_due_at=null,resolved_at=p_at
        where student_id=p_student and lesson_id=lesson.id and condition_type='uncovered_lesson' and status<>'resolved';
      continue;
    end if;
    if v_status='open' then open_count:=open_count+1; else blocked_count:=blocked_count+1; end if;
    insert into credit_internal.reminder_conditions as current_condition (
      studio_id,student_id,lesson_id,condition_type,status,status_reason,package_id,contact_id,opened_at,evaluated_at,next_due_at
    ) values (
      v_studio,p_student,lesson.id,'uncovered_lesson',v_status,v_reason,v_package,v_contact,p_at,p_at,
      case when v_status='open' then p_at end
    ) on conflict (student_id,condition_type,lesson_id) do update set
      status=excluded.status,status_reason=excluded.status_reason,package_id=excluded.package_id,
      contact_id=excluded.contact_id,evaluated_at=excluded.evaluated_at,resolved_at=null,
      next_due_at=case
        when excluded.status<>'open' then null
        when current_condition.last_delivery_at is not null then current_condition.last_delivery_at+interval '72 hours'
        when current_condition.status='open' then current_condition.next_due_at
        else excluded.evaluated_at
      end;
  end loop;

  update credit_internal.reminder_conditions as c set status='resolved',status_reason='lesson_no_longer_actionable',
    package_id=null,contact_id=null,evaluated_at=p_at,next_due_at=null,resolved_at=p_at
    where c.student_id=p_student and c.condition_type='uncovered_lesson' and c.status<>'resolved' and not exists(
      select 1 from public.lessons l
      join public.lesson_participants lp on lp.lesson_id=l.id and lp.student_id=p_student
      join public.bookings b on b.id=lp.booking_id and b.student_id=p_student and b.studio_id=v_studio
      where l.id=c.lesson_id and l.studio_id=v_studio and l.status='scheduled' and l.service_id is not null
        and l.starts_at>greatest(now(),p_at) and lp.status in ('reserved','confirmed')
        and b.status='confirmed' and b.payment_policy='credits'
    );
  get diagnostics resolved_count=row_count;
  return jsonb_build_object('evaluated',checked_count,'open',open_count,'blocked',blocked_count,
    'noLongerActionable',resolved_count);
end $$;
create function credit_internal.default_reminder_template(p_kind text) returns jsonb
language sql immutable set search_path='' as $$
  select case p_kind when 'low_credit' then jsonb_build_object(
    'subject','Lesson credits for {{student_first_name}}',
    'body','Hi {{billing_contact_name}}, {{student_first_name}} has {{available_credits}} available credits in {{package_name}}. You can review renewal options in Credits & Lessons.')
  when 'uncovered_lesson' then jsonb_build_object(
    'subject','A lesson needs a credit',
    'body','Hi {{billing_contact_name}}, {{student_first_name}} has a lesson on {{lesson_date}} that needs one eligible {{credit_type}} credit. The lesson is still scheduled. You can review renewal options in Credits & Lessons.')
  when 'follow_up' then jsonb_build_object(
    'subject','A follow-up about lesson credits',
    'body','Hi {{billing_contact_name}}, {{student_first_name}} still has a credit item to review in Credits & Lessons.')
  end || jsonb_build_object('kind',p_kind,'version',0,'active',true)
$$;

create function credit_internal.actual_reminder_template(p_studio uuid,p_kind text) returns jsonb
language sql stable set search_path='' as $$
  select coalesce((select jsonb_build_object('kind',t.kind,'version',t.version,'subject',t.subject,
    'body',t.body,'active',t.active) from credit_internal.reminder_templates t
    where t.studio_id=p_studio and t.kind=p_kind order by t.version desc limit 1),
    credit_internal.default_reminder_template(p_kind))
$$;

create function credit_internal.render_credit_reminder(p_subject text,p_body text,p_variables jsonb)
returns jsonb language plpgsql immutable set search_path='' as $$
declare k text; val text; subject_text text:=p_subject; body_text text:=p_body;
begin
  if coalesce(length(trim(p_subject)),0) not between 1 and 140 or coalesce(length(trim(p_body)),0) not between 1 and 1800
    or p_subject ~ '[\r\n]' then raise exception 'VALIDATION_FAILED: Enter a subject and a message within the length limits.'; end if;
  if regexp_replace(p_subject||' '||p_body,'\{\{[a-z_]+\}\}','', 'g')~'\{\{|\}\}' then
    raise exception 'VALIDATION_FAILED: Check the spelling and braces of reminder variables.';
  end if;
  for k in select distinct m[1] from regexp_matches(p_subject||' '||p_body,'\{\{([a-z_]+)\}\}','g') m loop
    val:=p_variables->>k;
    if val is null then raise exception 'VALIDATION_FAILED: Unknown reminder variable %.',k; end if;
    subject_text:=replace(subject_text,'{{'||k||'}}',replace(replace(val,chr(13),' '),chr(10),' '));
    body_text:=replace(body_text,'{{'||k||'}}',val);
  end loop;
  return jsonb_build_object('subject',subject_text,'body',body_text);
end $$;

create function credit_internal.reminder_preview_variables() returns jsonb
language sql immutable set search_path='' as $$
  select jsonb_build_object('student_first_name','Jordan','billing_contact_name','Morgan',
    'package_name','Scene Study package','credit_type','60-minute Scene Study',
    'available_credits','2','lesson_date','December 3','credits_required','1',
    'renewal_link','/portal/credits','studio_name','Example Studio')
$$;
create function credit_internal.reminder_template_variables(
  p_condition credit_internal.reminder_conditions,p_recipient jsonb,p_path text
) returns jsonb language sql stable set search_path='' as $$
  select jsonb_build_object(
    'student_first_name',split_part(coalesce(nullif(s.preferred_name,''),s.full_name),' ',1),
    'billing_contact_name',coalesce(p_recipient->>'name','there'),
    'package_name',coalesce(p.name,'lesson package'),
    'credit_type',coalesce((extract(epoch from l.ends_at-l.starts_at)/60)::int,t.duration_minutes)::text||'-minute '||coalesce(svc.name,'lesson'),
    'available_credits',coalesce(p_condition.available_credits::text,'unavailable'),
    'lesson_date',coalesce(to_char(l.starts_at at time zone z.timezone,'FMMonth FMDD'),'the next scheduled lesson'),
    'credits_required',case when p_condition.lesson_id is not null then '1' else 'see renewal options' end,'renewal_link',p_path,'studio_name',z.name
  )
  from public.students s join public.studios z on z.id=s.studio_id
  left join public.lessons l on l.id=p_condition.lesson_id
  left join public.booking_services svc on svc.id=l.service_id and svc.studio_id=z.id
  left join public.packages p on p.id=p_condition.package_id
  left join credit_internal.package_credit_terms t on t.package_id=p.id
  where s.id=p_condition.student_id
$$;

create function credit_internal.stage_reminder_deliveries(p_condition credit_internal.reminder_conditions,p_at timestamptz)
returns integer language plpgsql set search_path='' as $$
declare policy jsonb; payer jsonb; recipient jsonb; template jsonb; rendered jsonb; kind text; path text;
  user_id uuid; email text; copied boolean; staged integer:=0; count_rows integer;
begin
  policy:=credit_internal.reminder_policy(p_condition.studio_id,p_condition.student_id,p_condition.package_id);
  payer:=credit_internal.reminder_recipient(p_condition.student_id,p_condition.contact_id);
  if payer is null or policy->>'enabled'<>'true' or p_condition.paused_at is not null then return 0; end if;
  kind:=case when p_condition.last_delivery_at is null then p_condition.condition_type else 'follow_up' end;
  template:=credit_internal.actual_reminder_template(p_condition.studio_id,kind);
  if template->>'active'<>'true' then return 0; end if;
  path:='/portal/credits?student='||p_condition.student_id::text
    ||coalesce('&lesson='||p_condition.lesson_id::text,'');
  for copied in select false union all select true where policy->>'studentCopy'='true' loop
    recipient:=case when copied then credit_internal.reminder_recipient(p_condition.student_id,null,true) else payer end;
    if recipient is null or (copied and (recipient->>'userId'=payer->>'userId'
      or (recipient->>'email' is not null and recipient->>'email'=payer->>'email'))) then continue; end if;
    user_id:=(recipient->>'userId')::uuid;
    email:=nullif(trim(recipient->>'email'),'');
    if copied then
      -- Copies omit shared balances and billing details, even when the adult can view their own lessons.
      rendered:=jsonb_build_object('subject','Review your lesson credits',
        'body','There is a lesson credit item in your portal. Your billing contact can review renewal options.');
    else
      rendered:=credit_internal.render_credit_reminder(template->>'subject',template->>'body',
        credit_internal.reminder_template_variables(p_condition,recipient,path));
    end if;
    insert into credit_internal.reminder_deliveries(condition_id,cycle_at,student_id,recipient_user_id,
      recipient_contact_id,recipient_email,is_copy,channel,template_kind,template_version,subject,body,action_path,
      status,status_reason,due_at,acknowledged_at)
    select p_condition.id,p_condition.next_due_at,p_condition.student_id,user_id,
      (recipient->>'contactId')::uuid,case when channel='email' then email end,copied,channel,kind,
      (template->>'version')::integer,rendered->>'subject',rendered->>'body',path,
      case when channel='portal' then 'sent'
        when coalesce(email,'') !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then 'suppressed' else 'queued' end,
      case when channel='email' and coalesce(email,'') !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then 'email_unavailable' end,
      p_at,case when channel='portal' then p_at end
    from (values ('portal'),('email')) as channels(channel)
    on conflict(condition_id,cycle_at,recipient_user_id,channel) do nothing;
    get diagnostics count_rows=row_count;
    staged:=staged+count_rows;
  end loop;
  if staged>0 then
    update credit_internal.reminder_conditions set last_delivery_at=p_at,next_due_at=p_at+interval '72 hours'
      where id=p_condition.id;
  end if;
  return staged;
end $$;

create function public.scan_credit_reminders(p_limit integer default 8,p_at timestamptz default now())
returns jsonb language plpgsql security definer set search_path='' as $$
declare sid uuid; condition credit_internal.reminder_conditions; scanned integer:=0; queued integer:=0;
begin
  if not pg_try_advisory_xact_lock(hashtextextended('studio-credit-reminder-scan',0)) then
    return jsonb_build_object('scanned',0,'staged',0);
  end if;
  if p_at is null or not isfinite(p_at) then raise exception 'VALIDATION_FAILED'; end if;
  for sid in
    select s.id from public.students s left join credit_internal.reminder_scan r on r.student_id=s.id
    where (s.deleted_at is null and exists(
      select 1 from public.bookings b where b.student_id=s.id and b.status='confirmed'
        and b.payment_policy='credits' and b.starts_at>greatest(now(),p_at)
    )) or exists(select 1 from credit_internal.reminder_conditions c where c.student_id=s.id and c.status<>'resolved')
    order by r.checked_at nulls first,s.id limit greatest(1,least(coalesce(p_limit,8),30))
  loop
    perform public.refresh_credit_reminder_conditions(sid,p_at);
    perform credit_internal.refresh_low_credit_reminders(sid,p_at);
    insert into credit_internal.reminder_scan values(sid,p_at)
      on conflict(student_id) do update set checked_at=excluded.checked_at;
    scanned:=scanned+1;
  end loop;
  for condition in
    select c.* from credit_internal.reminder_conditions c
    where c.status='open' and c.paused_at is null and c.next_due_at<=p_at and c.evaluated_at=p_at
      and not exists(select 1 from credit_internal.reminder_deliveries d where d.condition_id=c.id
        and d.status in ('queued','claimed','sending','failed','uncertain'))
    order by c.next_due_at,c.id limit 30 for update skip locked
  loop
    queued:=queued+credit_internal.stage_reminder_deliveries(condition,p_at);
  end loop;
  return jsonb_build_object('scanned',scanned,'staged',queued);
end $$;

create function public.claim_credit_reminder_email(p_limit integer default 4,p_at timestamptz default now())
returns jsonb language plpgsql security definer set search_path='' as $$
declare claimed jsonb;
begin
  if p_at is null or not isfinite(p_at) then raise exception 'VALIDATION_FAILED'; end if;
  with expired as (
    update credit_internal.reminder_deliveries set status='uncertain',status_reason='delivery_acknowledgement_missing',lease_until=null
    where channel='email' and status='sending' and lease_until<=p_at returning id,claim_token
  )
  insert into credit_internal.reminder_attempts(delivery_id,token,outcome,attempted_at)
    select id,claim_token,'uncertain',p_at from expired on conflict do nothing;
  with work as (
    select id from credit_internal.reminder_deliveries
    where channel='email' and (((status='queued' or status='failed') and due_at<=p_at)
      or (status='claimed' and lease_until<=p_at)) and attempts<4
    order by due_at,id limit greatest(1,least(coalesce(p_limit,4),12)) for update skip locked
  ), marked as (
    update credit_internal.reminder_deliveries d set status='claimed',claim_token=gen_random_uuid(),
      lease_until=p_at+interval '5 minutes' from work where work.id=d.id
    returning d.id,d.claim_token
  )
  select coalesce(jsonb_agg(jsonb_build_object('id',id,'token',claim_token)), '[]') into claimed from marked;
  return claimed;
end $$;

create function public.begin_credit_reminder_email(p_delivery uuid,p_token uuid,p_at timestamptz default now())
returns jsonb language plpgsql security definer set search_path='' as $$
declare message credit_internal.reminder_deliveries; condition credit_internal.reminder_conditions;
  route jsonb; template jsonb; policy jsonb;
begin
  if p_at is null or not isfinite(p_at) then raise exception 'VALIDATION_FAILED'; end if;
  perform pg_advisory_xact_lock(hashtextextended('studio-credit-reminder-scan',0));
  select * into message from credit_internal.reminder_deliveries where id=p_delivery and claim_token=p_token and status='claimed';
  if not found or message.lease_until<=p_at then return null; end if;
  perform public.refresh_credit_reminder_conditions(message.student_id,p_at);
  perform credit_internal.refresh_low_credit_reminders(message.student_id,p_at);
  select * into condition from credit_internal.reminder_conditions where id=message.condition_id for update;
  select * into message from credit_internal.reminder_deliveries where id=p_delivery
    and claim_token=p_token and status='claimed' and lease_until>p_at for update;
  if not found then return null; end if;
  policy:=credit_internal.reminder_policy(condition.studio_id,condition.student_id,condition.package_id);
  template:=credit_internal.actual_reminder_template(condition.studio_id,message.template_kind);
  route:=credit_internal.reminder_recipient(condition.student_id,
    case when not message.is_copy then condition.contact_id end,message.is_copy);
  if condition.status<>'open' or condition.paused_at is not null or condition.student_id is distinct from message.student_id
    or policy->>'enabled'<>'true' or (message.is_copy and policy->>'studentCopy'<>'true')
    or template->>'active'<>'true' or (template->>'version')::integer<>message.template_version
    or (route->>'userId')::uuid is distinct from message.recipient_user_id
    or (route->>'contactId')::uuid is distinct from message.recipient_contact_id
    or route->>'email' is distinct from message.recipient_email then
    update credit_internal.reminder_deliveries set status='suppressed',status_reason='eligibility_changed',lease_until=null
      where id=p_delivery;
    insert into credit_internal.reminder_attempts values(p_delivery,p_token,'suppressed',p_at);
    return null;
  end if;
  update credit_internal.reminder_deliveries set status='sending',attempts=attempts+1 where id=p_delivery;
  return jsonb_build_object('recipient',message.recipient_email,'subject',message.subject,
    'body',message.body,'actionPath',message.action_path);
end $$;

create function public.finish_credit_reminder_email(
  p_delivery uuid,p_token uuid,p_outcome text,p_at timestamptz default now(),p_reference text default null
) returns boolean language plpgsql security definer set search_path='' as $$
declare message credit_internal.reminder_deliveries; settled text;
begin
  if p_at is null or not isfinite(p_at) or coalesce(p_outcome,'') not in ('sent','retry_before_send','uncertain','cancel_before_send')
    or (p_outcome='sent' and coalesce(length(trim(p_reference)),0)=0) then raise exception 'VALIDATION_FAILED'; end if;
  select * into message from credit_internal.reminder_deliveries where id=p_delivery and claim_token=p_token;
  if not found then return false; end if;
  perform 1 from credit_internal.reminder_conditions where id=message.condition_id for update;
  select * into message from credit_internal.reminder_deliveries where id=p_delivery and claim_token=p_token for update;
  if not found then return false; end if;
  if message.status='sent' and p_outcome='sent' then return true; end if;
  -- Retry only where the provider send endpoint was never called.
  if p_outcome='retry_before_send' and message.status='claimed' then settled:='failed';
  elsif p_outcome='cancel_before_send' and message.status='sending' then settled:='suppressed';
  elsif p_outcome='sent' and message.status in ('sending','uncertain') then settled:='sent';
  elsif p_outcome='uncertain' and message.status='sending' then settled:='uncertain';
  else return false; end if;
  update credit_internal.reminder_deliveries set status=settled,
    attempts=attempts+case when settled='failed' then 1 else 0 end,
    status_reason=case settled when 'failed' then 'provider_not_reached' when 'suppressed' then 'stopped_before_send' when 'uncertain' then 'delivery_acknowledgement_missing' end,
    lease_until=null,due_at=case when settled='failed' then p_at+interval '15 minutes' else due_at end,
    acknowledged_at=case when settled='sent' then p_at end,
    provider_reference=case when settled='sent' then left(p_reference,160) end
    where id=p_delivery;
  insert into credit_internal.reminder_attempts values(p_delivery,p_token,settled,p_at)
    on conflict(delivery_id,token) do update set outcome=excluded.outcome,attempted_at=excluded.attempted_at;
  if settled='sent' then
    update credit_internal.reminder_conditions set last_delivery_at=greatest(last_delivery_at,p_at),
      next_due_at=case when status='open' then greatest(last_delivery_at,p_at)+interval '72 hours' end
      where id=message.condition_id;
  end if;
  return true;
end $$;

revoke all on function public.scan_credit_reminders(integer,timestamptz),
  public.claim_credit_reminder_email(integer,timestamptz),
  public.begin_credit_reminder_email(uuid,uuid,timestamptz),
  public.finish_credit_reminder_email(uuid,uuid,text,timestamptz,text)
  from public,anon,authenticated;
grant execute on function public.scan_credit_reminders(integer,timestamptz),
  public.claim_credit_reminder_email(integer,timestamptz),
  public.begin_credit_reminder_email(uuid,uuid,timestamptz),
  public.finish_credit_reminder_email(uuid,uuid,text,timestamptz,text) to service_role;
create function public.manage_credit_reminders(p_student uuid,p_action text,p_value jsonb default '{}')
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  actor uuid:=auth.uid(); studio uuid; kind text:=p_value->>'kind'; scope_type text:=p_value->>'scope';
  target uuid:=(p_value->>'targetId')::uuid; threshold_value integer; enabled_value boolean; copy_value boolean;
  template jsonb; prior jsonb; result jsonb; version_num integer; changed uuid;
  audit_reason text:=trim(p_value->>'reason'); condition credit_internal.reminder_conditions;
begin
  select studio_id into studio from public.students where id=p_student and deleted_at is null;
  if actor is null or studio is null or not public.is_studio_coach(studio) then
    raise exception 'FORBIDDEN' using errcode='42501';
  end if;
  if p_action='configuration' then
    return jsonb_build_object(
      'settings',coalesce((select jsonb_agg(jsonb_build_object('scope',r.scope,'targetId',r.scope_id,
        'threshold',r.threshold,'enabled',r.enabled,'studentCopy',r.student_copy))
        from credit_internal.reminder_settings r where r.studio_id=studio),'[]'),
      'packages',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'name',p.name,
        'owner',coalesce(s.full_name,h.name)) order by p.name,p.id)
        from public.packages p left join public.students s on s.id=p.student_id
        left join credit_internal.credit_households h on h.id=p.household_id
        where (s.studio_id=studio or h.studio_id=studio) and (p.expires_at is null or p.expires_at>now())),'[]'),
      'templates',(select jsonb_agg(credit_internal.actual_reminder_template(studio,k))
        from (values ('low_credit'),('uncovered_lesson'),('follow_up')) x(k)),
      'history',coalesce((select jsonb_agg(rec order by (rec->>'version')::integer desc,rec->>'kind') from (
        select jsonb_build_object('kind',r.kind,'version',r.version,'subject',r.subject,'body',r.body,'active',r.active,'createdAt',r.created_at) rec
        from credit_internal.reminder_templates r where r.studio_id=studio order by r.created_at desc limit 36) x),'[]'));
  elsif p_action='attention' then
    return coalesce((select jsonb_agg(x.entry order by x.sort,x.updated desc,x.id) from (
      select c.id,c.evaluated_at updated,
        case when d.status in ('failed','uncertain') then 0 when c.status='blocked' then 1 else 2 end sort,
        jsonb_build_object('id',c.id,'studentId',c.student_id,'studentName',s.full_name,
          'householdId',p.household_id,'packageId',c.package_id,'packageName',p.name,'lessonId',c.lesson_id,'lessonName',l.topic,
          'kind',c.condition_type,'status',c.status,'reason',c.status_reason,'paused',c.paused_at is not null,
          'nextDueAt',c.next_due_at,'lastDeliveryAt',c.last_delivery_at,
          'delivery',case when d.id is not null then jsonb_build_object('id',d.id,'status',d.status,
             'reason',d.status_reason,'attempts',d.attempts) end,
          'history',coalesce((select jsonb_agg(h.entry order by h.created_at desc) from (
            select x.created_at,jsonb_build_object('channel',x.channel,'status',x.status,'reason',x.status_reason,
              'at',coalesce(x.acknowledged_at,x.created_at),'attempts',x.attempts,'templateVersion',x.template_version) entry
            from credit_internal.reminder_deliveries x where x.condition_id=c.id
            order by x.created_at desc,x.id limit 8) h),'[]')) entry
      from credit_internal.reminder_conditions c join public.students s on s.id=c.student_id
      left join public.packages p on p.id=c.package_id left join public.lessons l on l.id=c.lesson_id
      left join lateral (select d.* from credit_internal.reminder_deliveries d
        where d.condition_id=c.id and d.channel='email' and d.status in ('failed','uncertain','suppressed')
        order by case d.status when 'uncertain' then 0 when 'failed' then 1 else 2 end,d.created_at desc limit 1) d on true
      where c.studio_id=studio and (c.status<>'resolved' or d.status in ('failed','uncertain'))
      order by sort,updated desc,c.id limit 150
    ) x),'[]');
  elsif p_action in ('preview_template','save_template') then
    if coalesce(kind,'') not in ('low_credit','uncovered_lesson','follow_up') then raise exception 'VALIDATION_FAILED'; end if;
    result:=credit_internal.render_credit_reminder(p_value->>'subject',p_value->>'body',credit_internal.reminder_preview_variables());
    if p_action='preview_template' then return result; end if;
    if jsonb_typeof(p_value->'active') is distinct from 'boolean' then raise exception 'VALIDATION_FAILED'; end if;
    perform pg_advisory_xact_lock(hashtextextended(studio::text||':reminder-template:'||kind,0));
    prior:=credit_internal.actual_reminder_template(studio,kind);
    version_num:=(prior->>'version')::integer;
    if version_num is distinct from (p_value->>'version')::integer then
      raise exception 'VERSION_CONFLICT: Reload the latest template before saving.';
    end if;
    insert into credit_internal.reminder_templates(studio_id,kind,version,subject,body,active,created_by)
      values(studio,kind,version_num+1,trim(p_value->>'subject'),trim(p_value->>'body'),(p_value->>'active')::boolean,actor);
    result:=credit_internal.actual_reminder_template(studio,kind);
    changed:=studio; audit_reason:='Coach saved a reminder template version';
  elsif p_action='save_settings' then
    if scope_type='studio' then target:=studio;
    elsif scope_type='student' then
      if not exists(select 1 from public.students s where s.id=target and s.studio_id=studio and s.deleted_at is null)
        then raise exception 'FORBIDDEN' using errcode='42501'; end if;
    elsif scope_type='package' then
      if not exists(select 1 from public.packages p left join public.students s on s.id=p.student_id
          left join credit_internal.credit_households h on h.id=p.household_id
          where p.id=target and coalesce(s.studio_id,h.studio_id)=studio) then raise exception 'FORBIDDEN' using errcode='42501'; end if;
    else raise exception 'VALIDATION_FAILED'; end if;
    threshold_value:=(p_value->>'threshold')::integer;
    enabled_value:=(p_value->>'enabled')::boolean; copy_value:=(p_value->>'studentCopy')::boolean;
    if (threshold_value is not null and threshold_value not between 0 and 100000)
      or (scope_type='package' and copy_value is not null) then raise exception 'VALIDATION_FAILED'; end if;
    perform pg_advisory_xact_lock(hashtextextended(studio::text||':reminder-settings:'||scope_type||':'||target::text,0));
    select to_jsonb(r) into prior from credit_internal.reminder_settings r
      where r.studio_id=studio and r.scope=scope_type and r.scope_id=target;
    insert into credit_internal.reminder_settings values(studio,scope_type,target,threshold_value,enabled_value,copy_value)
      on conflict(studio_id,scope,scope_id) do update set threshold=excluded.threshold,
        enabled=excluded.enabled,student_copy=excluded.student_copy returning to_jsonb(reminder_settings) into result;
    changed:=target; audit_reason:='Coach updated reminder settings';
  elsif p_action in ('pause','resume','dismiss_delivery') then
    if coalesce(length(audit_reason),0) not between 3 and 500 then
      raise exception 'VALIDATION_FAILED: Enter a reason for this reminder change.';
    end if;
    select * into condition from credit_internal.reminder_conditions
      where id=target and studio_id=studio for update;
    if not found then raise exception 'FORBIDDEN' using errcode='42501'; end if;
    prior:=jsonb_build_object('pausedAt',condition.paused_at);
    if p_action='dismiss_delivery' then
      update credit_internal.reminder_deliveries set status='suppressed',status_reason='coach_dismissed'
        where id=(p_value->>'deliveryId')::uuid and condition_id=condition.id and status in ('failed','uncertain') returning id into changed;
      if changed is null then raise exception 'INVALID_TRANSITION: Refresh delivery history.'; end if;
      result:=jsonb_build_object('deliveryId',changed,'status','suppressed');
    else
      update credit_internal.reminder_conditions set paused_at=case when p_action='pause' then now() end
        where id=target returning jsonb_build_object('pausedAt',paused_at) into result;
    end if;
    changed:=target;
  else raise exception 'VALIDATION_FAILED'; end if;
  insert into public.audit_events(studio_id,actor_id,action,entity_type,entity_id,reason,correlation_id,source,before_state,after_state)
    values(studio,actor,'credit_reminders.'||p_action,'credit_reminder',changed,audit_reason,gen_random_uuid()::text,'coach_portal',prior,result);
  return result;
end $$;

create function public.credit_reminder_history(p_students uuid[])
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
  if auth.uid() is null or coalesce(cardinality(p_students),0) not between 1 and 50 then
    raise exception 'FORBIDDEN' using errcode='42501';
  end if;
  return coalesce((select jsonb_agg(x.data order by x.at desc,x.id) from (
    select d.id,d.created_at at,jsonb_build_object('id',d.id,'subject',d.subject,'body',d.body,'path',d.action_path,
      'at',d.created_at,'studentName',s.full_name,'requiresAction',c.status='open' and c.student_id=d.student_id) data
    from credit_internal.reminder_deliveries d join credit_internal.reminder_conditions c on c.id=d.condition_id
    join public.students s on s.id=d.student_id and s.deleted_at is null
    where d.recipient_user_id=auth.uid() and d.channel='portal' and d.status='sent' and d.student_id=any(p_students)
      and ((d.recipient_contact_id is null and s.user_id=auth.uid() and s.portal_enabled and not s.is_minor)
        or exists(select 1 from public.linked_contacts l where l.id=d.recipient_contact_id and
          l.student_id=s.id and l.studio_id=s.studio_id and l.user_id=auth.uid() and l.portal_enabled and l.can_view_finance))
    order by d.created_at desc,d.id limit 50
  ) x),'[]');
end $$;

revoke all on function public.manage_credit_reminders(uuid,text,jsonb),public.credit_reminder_history(uuid[])
  from public,anon,authenticated;
grant execute on function public.manage_credit_reminders(uuid,text,jsonb),public.credit_reminder_history(uuid[])
  to authenticated;
revoke all on function credit_internal.reminder_policy(uuid,uuid,uuid),credit_internal.reminder_recipient(uuid,uuid,boolean),
  credit_internal.refresh_low_credit_reminders(uuid,timestamptz),credit_internal.default_reminder_template(text),
  credit_internal.actual_reminder_template(uuid,text),credit_internal.render_credit_reminder(text,text,jsonb),
  credit_internal.reminder_preview_variables(), credit_internal.reminder_template_variables(credit_internal.reminder_conditions,jsonb,text),
  credit_internal.stage_reminder_deliveries(credit_internal.reminder_conditions,timestamptz)
  from public,anon,authenticated,service_role;
