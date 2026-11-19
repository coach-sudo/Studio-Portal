-- A Checkout session selects whole lesson obligations across issued invoices.
-- The invoice and payment ledgers remain the settlement authority.
create schema training_internal;
revoke all on schema training_internal from public, anon, authenticated;
alter table public.lessons add column payment_needs_review boolean not null default false;

create table training_internal.lesson_checkouts (
  id uuid primary key,
  payer_user_id uuid not null,
  studio_id uuid not null references public.studios(id),
  currency text not null,
  amount_minor bigint not null check (amount_minor > 0),
  selection jsonb not null,
  allocations jsonb not null,
  return_student_id uuid not null,
  stripe_session_id text unique,
  stripe_payment_intent_id text unique,
  status text not null default 'reserved' check (status in ('reserved','settled','expired','failed','review')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table training_internal.lesson_checkouts enable row level security;

create function training_internal.is_lesson_payer(p_actor uuid, p_student uuid)
returns boolean language sql stable set search_path='' as $$
  select exists (
    select 1 from public.students s
    where s.id=p_student and s.deleted_at is null and p_actor is not null
      and (
        (
          s.user_id=p_actor and s.portal_enabled and not s.is_minor
          and nullif(btrim(s.email),'') is not null
          and not exists (select 1 from public.linked_contacts c
            where c.student_id=s.id and c.is_primary_payer)
        ) or exists (
          select 1 from public.linked_contacts c
          where c.student_id=s.id and c.studio_id=s.studio_id and c.user_id=p_actor
            and c.portal_enabled and c.can_view_finance and c.is_primary_payer
            and nullif(btrim(c.email),'') is not null
            and not exists (select 1 from public.linked_contacts other
              where other.student_id=s.id and other.is_primary_payer and other.id<>c.id)
        )
      )
  );
$$;
revoke all on function training_internal.is_lesson_payer(uuid,uuid) from public,anon,authenticated;

create function training_internal.reserve_lesson_checkout(p_value jsonb)
returns training_internal.lesson_checkouts language plpgsql set search_path='' as $$
declare
  attempt training_internal.lesson_checkouts;
  attempt_id uuid := (p_value->>'id')::uuid;
  actor_id uuid := (p_value->>'actor')::uuid;
  selected_student uuid := (p_value->>'studentId')::uuid;
  selection jsonb;
  selected jsonb;
  invoice public.studio_invoices;
  occurrence public.lessons;
  line jsonb;
  line_count bigint;
  line_due bigint;
  invoice_due bigint;
  selected_total bigint := 0;
  allocations jsonb := '[]';
  group_currency text;
  group_studio uuid;
begin
  if attempt_id is null or actor_id is null or selected_student is null
    or jsonb_typeof(p_value->'items') is distinct from 'array'
    or jsonb_array_length(p_value->'items') not between 1 and 50 then
    raise exception 'VALIDATION_FAILED: Choose at least one eligible lesson.';
  end if;
  select jsonb_agg(i order by i->>'invoiceId',i->>'lineId') into selection
    from jsonb_array_elements(p_value->'items') i;
  if (select count(distinct i->>'lessonId') from jsonb_array_elements(selection) i)
    <> jsonb_array_length(selection) then
    raise exception 'VALIDATION_FAILED: Choose each lesson once.';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('training-checkout:'||attempt_id,0));
  select * into attempt from training_internal.lesson_checkouts where id=attempt_id;
  if found then
    if attempt.payer_user_id<>actor_id or attempt.selection<>selection
      or attempt.return_student_id<>selected_student then raise exception 'FORBIDDEN'; end if;
    if attempt.status='reserved' and exists (
      select 1 from jsonb_array_elements(attempt.allocations) a
      where not training_internal.is_lesson_payer(actor_id,(a->>'studentId')::uuid)
    ) then raise exception 'FORBIDDEN'; end if;
    return attempt;
  end if;

  -- Match the existing invoice and credit serialization boundary.
  perform s.id from public.students s
    where s.id in (
      select inv.student_id from public.studio_invoices inv
      where inv.id in (select (i->>'invoiceId')::uuid from jsonb_array_elements(selection) i)
    ) order by s.id for update;
  perform c.id from public.linked_contacts c
    where c.student_id in (
      select inv.student_id from public.studio_invoices inv
      where inv.id in (select (i->>'invoiceId')::uuid from jsonb_array_elements(selection) i)
    ) order by c.id for share;
  perform inv.id from public.studio_invoices inv
    where inv.id in (select (i->>'invoiceId')::uuid from jsonb_array_elements(selection) i)
    order by inv.id for update;

  for selected in select value from jsonb_array_elements(selection) loop
    select * into invoice from public.studio_invoices where id=(selected->>'invoiceId')::uuid;
    if not found or not training_internal.is_lesson_payer(actor_id,invoice.student_id) then
      raise exception 'FORBIDDEN';
    end if;
    if invoice.version is distinct from (selected->>'invoiceVersion')::integer then
      raise exception 'VERSION_CONFLICT: The balance changed. Review the selection again.';
    end if;
    if invoice.status not in ('open','partially_paid') or invoice.checkout_key is not null then
      raise exception 'INVALID_TRANSITION: This invoice already has a payment or is unavailable.';
    end if;
    group_currency:=coalesce(group_currency,invoice.currency);
    group_studio:=coalesce(group_studio,invoice.studio_id);
    if group_currency<>invoice.currency or group_studio<>invoice.studio_id then
      raise exception 'VALIDATION_FAILED: Select lessons from the same studio and currency.';
    end if;
    select * into occurrence from public.lessons where id=(selected->>'lessonId')::uuid for update;
    if not found or occurrence.student_id<>invoice.student_id or occurrence.studio_id<>invoice.studio_id
      or occurrence.invoice_id is distinct from invoice.id
      or occurrence.status not in ('scheduled','completed')
      or occurrence.payment_status not in ('due','partially_paid')
      or occurrence.invoice_payment_pending or occurrence.payment_needs_review
      or exists (
        select 1 from public.lesson_participants lp join public.bookings b on b.id=lp.booking_id
        where lp.lesson_id=occurrence.id and lp.student_id=invoice.student_id
          and (lp.status='cancelled' or b.status not in ('confirmed','completed')
            or b.payment_status in ('processing','paid','refunded','not_required'))
      ) then raise exception 'INVALID_TRANSITION: A selected lesson needs a payment review.'; end if;

    select count(*), jsonb_agg(i)->0 into line_count,line
    from jsonb_array_elements(invoice.items) i
    where i->>'id'=selected->>'lineId' and i->>'kind'='service'
      and i->'lessonIds'=jsonb_build_array(occurrence.id)
      and i->>'quantity'='1' and not coalesce((i->>'cancelled')::boolean,false);
    if line_count<>1 then raise exception 'VALIDATION_FAILED: Use an exact issued lesson line.'; end if;
    if exists (
      select 1 from public.studio_invoices other cross join lateral jsonb_array_elements(other.items) i
      where other.student_id=invoice.student_id and other.status not in ('draft','void')
        and not coalesce((i->>'cancelled')::boolean,false)
        and i->'lessonIds' ? occurrence.id::text
        and (other.id<>invoice.id or i->>'id'<>line->>'id')
    ) then raise exception 'INVALID_TRANSITION: More than one invoice line is linked to this lesson.'; end if;
    line_due:=(line->>'unitMinor')::bigint-coalesce((line->>'paidMinor')::bigint,0)
      -coalesce((line->>'creditMinor')::bigint,0)-coalesce((line->>'waivedMinor')::bigint,0);
    invoice_due:=invoice.total_minor-invoice.paid_minor-invoice.credit_minor-invoice.waived_minor;
    if line_due is distinct from (selected->>'amountMinor')::bigint or line_due<=0
      or line_due>invoice_due
      or occurrence.paid_minor is distinct from coalesce((line->>'paidMinor')::bigint,0)
      or occurrence.price_minor is distinct from (line->>'unitMinor')::bigint then
      raise exception 'VERSION_CONFLICT: The lesson balance changed. Review the selection again.';
    end if;
    allocations:=allocations||jsonb_build_array(jsonb_build_object(
      'invoiceId',invoice.id,'lineId',line->>'id','lessonId',occurrence.id,
      'studentId',invoice.student_id,'amountMinor',line_due,'invoiceNumber',invoice.number,
      'description',line->>'description','date',line->>'startsOn'
    ));
    selected_total:=selected_total+line_due;
  end loop;
  if not training_internal.is_lesson_payer(actor_id,selected_student)
    or not exists(select 1 from public.students s where s.id=selected_student and s.studio_id=group_studio)
    or selected_total not between 1 and 99999999 then
    raise exception 'VALIDATION_FAILED: Choose a valid lesson checkout total.';
  end if;
  if exists (
    select 1 from public.studio_invoices inv
    join (select (a->>'invoiceId')::uuid as id,sum((a->>'amountMinor')::bigint) as amount
      from jsonb_array_elements(allocations) a group by 1) v on v.id=inv.id
    where v.amount>inv.total_minor-inv.paid_minor-inv.credit_minor-inv.waived_minor
  ) then raise exception 'VALIDATION_FAILED: The selection exceeds an invoice balance.'; end if;

  insert into training_internal.lesson_checkouts(id,payer_user_id,studio_id,currency,amount_minor,selection,allocations,return_student_id)
    values(attempt_id,actor_id,group_studio,group_currency,selected_total,selection,allocations,selected_student)
    returning * into attempt;
  update public.studio_invoices inv set checkout_key='training:'||attempt_id, checkout_amount=v.amount,
    version=inv.version+1,updated_at=now()
    from (select (a->>'invoiceId')::uuid as id,sum((a->>'amountMinor')::bigint) as amount
      from jsonb_array_elements(allocations) a group by 1) v where inv.id=v.id;
  update public.lessons l set invoice_payment_pending=true
    where l.id in (select (a->>'lessonId')::uuid from jsonb_array_elements(allocations) a);

  insert into public.audit_events(studio_id,action,entity_type,entity_id,reason,correlation_id,source,after_state)
    values(group_studio,'training.checkout_reserved','training_checkout',attempt.id,
      'Payer selected whole lesson obligations',attempt.id::text,'student_portal',
      jsonb_build_object('payerUserId',actor_id,'allocations',allocations));
  return attempt;
end
$$;
revoke all on function training_internal.reserve_lesson_checkout(jsonb) from public,anon,authenticated;

create function training_internal.settle_invoice(p_invoice uuid,p_amount bigint,p_method text,p_reference text,p_version integer,p_lines jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare coverage jsonb; inv public.studio_invoices; item jsonb; new_items jsonb:='[]'; allocations jsonb:='[]'; remainder bigint:=p_amount; take bigint; line_due bigint; pkg uuid; def public.package_definitions; lid uuid; balance bigint;
begin
  select * into inv from public.studio_invoices where id=p_invoice;
  if inv.id is null then raise exception 'NOT_FOUND'; end if;
  perform 1 from public.students where id=inv.student_id for update;
  select * into inv from public.studio_invoices where id=p_invoice for update;
  if exists(select 1 from public.invoice_settlements where reference=p_reference and invoice_id=p_invoice) then return to_jsonb(inv); end if;
  if inv.status not in ('open','partially_paid') or p_amount<=0 or p_amount>inv.total_minor-inv.paid_minor-inv.credit_minor-inv.waived_minor then raise exception 'VALIDATION_FAILED: Payment exceeds outstanding balance or invoice is not payable.'; end if;
  if inv.checkout_key is not null and (p_method<>'stripe' or current_setting('app.invoice_checkout_key',true) is distinct from inv.checkout_key) then raise exception 'INVALID_TRANSITION: An online payment is pending. Check or cancel it first.'; end if;
  if p_version is not null and inv.version<>p_version then raise exception 'VERSION_CONFLICT'; end if;
  if p_method='account_credit' then
    select coalesce(sum(case when kind='refund' then amount_minor else -amount_minor end),0) into balance from public.payment_entries where student_id=inv.student_id and currency=inv.currency and account_credit;
    if p_amount>balance then raise exception 'CREDIT_UNAVAILABLE'; end if;
  elsif p_method not in ('stripe','cash','bank') then raise exception 'VALIDATION_FAILED'; end if;
  for item in select value from jsonb_array_elements(inv.items) loop
    line_due:=(item->>'quantity')::bigint*(item->>'unitMinor')::bigint-coalesce((item->>'creditMinor')::bigint,0)-coalesce((item->>'paidMinor')::bigint,0)-coalesce((item->>'waivedMinor')::bigint,0);
    if p_lines is null then
      take:=least(remainder,line_due);
    else
      select coalesce(sum((a->>'amountMinor')::bigint),0) into take
        from jsonb_array_elements(p_lines) a where a->>'lineId'=item->>'id';
      if take<>0 and (take<>line_due or take>remainder or coalesce((item->>'cancelled')::boolean,false)) then
        raise exception 'VERSION_CONFLICT: The reserved lesson line changed.';
      end if;
    end if;
    if take>0 then
      item:=jsonb_set(item,'{paidMinor}',to_jsonb(coalesce((item->>'paidMinor')::bigint,0)+take));
      allocations:=allocations||jsonb_build_array(jsonb_build_object('lineId',item->>'id','amountMinor',take));
      remainder:=remainder-take;
      if item->>'kind'='package' and take=line_due and item->>'packageId' is null then
        select * into def from public.package_definitions where id=(item->>'referenceId')::uuid and studio_id=inv.studio_id;
        if def.id is null then raise exception 'NOT_FOUND: Package definition'; end if;
        insert into public.packages(student_id,definition_id,name,price_minor,currency,expires_at,credit_quantity,auto_apply)
          values(inv.student_id,def.id,item->>'description',(item->>'quantity')::integer*(item->>'unitMinor')::bigint,inv.currency,
            case when item->>'expirationDays' is null then null else now()+make_interval(days=>(item->>'expirationDays')::integer) end,
            coalesce((item->>'creditQuantity')::integer,(item->>'quantity')::integer*def.session_count),coalesce((select auto_apply from public.student_credit_accounts where student_id=inv.student_id),false)) returning id into pkg;
        insert into public.package_credit_entries(package_id,kind,quantity,reason,idempotency_key) values(pkg,'purchase',coalesce((item->>'creditQuantity')::integer,(item->>'quantity')::integer*def.session_count),'Invoice '||inv.number,'invoice-package:'||inv.id::text||':'||(item->>'id'));
        item:=jsonb_set(item,'{packageId}',to_jsonb(pkg::text));
      elsif item->>'kind'='service' then
        for lid in select value::uuid from jsonb_array_elements_text(coalesce(item->'lessonIds','[]')) loop
          update public.lessons set paid_minor=least(coalesce(price_minor,(item->>'unitMinor')::bigint),coalesce(paid_minor,0)+take/greatest(1,jsonb_array_length(item->'lessonIds'))),
          payment_status=case when take=line_due then 'paid' else 'partially_paid' end,version=version+1,updated_at=now()
          where id=lid and student_id=inv.student_id;
          update public.bookings b set paid_minor=(select coalesce(sum(l.paid_minor),0) from public.lessons l join public.lesson_participants lp on lp.lesson_id=l.id where lp.booking_id=b.id),
            payment_status=case when not exists(select 1 from public.lessons l join public.lesson_participants lp on lp.lesson_id=l.id where lp.booking_id=b.id and l.payment_status not in ('paid','paid_by_credit','waived')) then 'paid' else 'partially_paid' end,version=b.version+1,updated_at=now()
            where b.student_id=inv.student_id and b.id in(select booking_id from public.lesson_participants where lesson_id=lid and student_id=inv.student_id);
        end loop;
      end if;
    end if;
    new_items:=new_items||jsonb_build_array(item);
  end loop;
  if p_lines is not null and remainder<>0 then
    raise exception 'VERSION_CONFLICT: The reserved lesson lines are incomplete.';
  end if;
  insert into public.invoice_settlements(invoice_id,amount_minor,method,reference,allocations) values(inv.id,p_amount,p_method,p_reference,allocations);
  -- Dollar credit is spent as an adjustment; externally received payments remain in the existing ledger.
  insert into public.payment_entries(student_id,kind,amount_minor,currency,external_reference,reason,account_credit)
    values(inv.student_id,case when p_method='account_credit' then 'adjustment'::public.payment_entry_kind else 'payment'::public.payment_entry_kind end,p_amount,inv.currency,p_reference,'Invoice '||inv.number||' · '||p_method,p_method='account_credit');
  update public.studio_invoices set items=new_items,paid_minor=paid_minor+p_amount,
    status=case when paid_minor+p_amount+credit_minor+waived_minor=total_minor then 'paid' else 'partially_paid' end,
    version=version+1,updated_at=now() where id=inv.id returning * into inv;
  coverage:=public.reserve_student_upcoming_credits(inv.student_id);
  return (select to_jsonb(i) from public.studio_invoices i where i.id=inv.id)||jsonb_build_object('creditCoverage',coverage);
end $$;

revoke all on function training_internal.settle_invoice(uuid,bigint,text,text,integer,jsonb) from public,anon,authenticated;

-- Preserve the existing public command signature and default allocation for its callers.
create or replace function public.settle_studio_invoice(p_invoice uuid,p_amount bigint,p_method text,p_reference text,p_version integer default null)
returns jsonb language sql security definer set search_path='' as $$
  select training_internal.settle_invoice(p_invoice,p_amount,p_method,p_reference,p_version,null);
$$;

-- The service supplies a verified actor for payer operations. Provider operations
-- are reachable only from the verified webhook or Stripe's retrieved session.
create function public.training_lesson_checkout(p_action text,p_value jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  attempt training_internal.lesson_checkouts;
  actor uuid := (p_value->>'actor')::uuid;
  attempt_id uuid := (p_value->>'id')::uuid;
  provider_session text := p_value->>'session';
  provider_intent text := p_value->>'intent';
  invoice_group record;
  claim text := 'training:'||attempt_id;
  target_status text;
begin
  if p_action='payers' then
    return jsonb_build_object(
      'studentIds',coalesce((
        select jsonb_agg(s) from jsonb_array_elements_text(p_value->'studentIds') s
        where training_internal.is_lesson_payer(actor,s::uuid)
      ),'[]'::jsonb),
      'attempts',coalesce((
        select jsonb_agg(jsonb_build_object('id',a.id,'studentId',a.return_student_id,'status',a.status,'createdAt',a.created_at) order by a.created_at desc)
        from training_internal.lesson_checkouts a
        where a.payer_user_id=actor and a.status in ('reserved','review')
          and (p_value->'studentIds') ? a.return_student_id::text
          and training_internal.is_lesson_payer(actor,a.return_student_id)
      ),'[]'::jsonb)
    );
  end if;
  if p_action='reserve' then
    attempt:=training_internal.reserve_lesson_checkout(p_value);
    return to_jsonb(attempt)-'payer_user_id'-'selection';
  end if;
  if p_action='review' then
    select id into attempt_id from training_internal.lesson_checkouts
      where stripe_payment_intent_id=provider_intent;
    if not found then return null; end if;
    claim:='training:'||attempt_id;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(claim,0));
  select * into attempt from training_internal.lesson_checkouts where id=attempt_id for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if p_action='review' then
    if attempt.status='settled' then
      perform s.id from public.students s where s.id in (
        select (a->>'studentId')::uuid from jsonb_array_elements(attempt.allocations) a
      ) order by s.id for update;
      update training_internal.lesson_checkouts set status='review',updated_at=now()
        where id=attempt_id returning * into attempt;
      update public.lessons set payment_needs_review=true,version=version+1,updated_at=now()
        where id in (select (a->>'lessonId')::uuid from jsonb_array_elements(attempt.allocations) a);
      insert into public.audit_events(studio_id,action,entity_type,entity_id,reason,correlation_id,source,after_state)
        values(attempt.studio_id,'training.checkout_review','training_checkout',attempt.id,
          'Stripe reported a refund or dispute',p_value->>'eventId','stripe',
          jsonb_build_object('stripePaymentIntentId',provider_intent,'allocations',attempt.allocations));
    end if;
    return jsonb_build_object('id',attempt.id,'status',attempt.status);
  end if;
  if p_action='read' then
    if attempt.payer_user_id is distinct from actor
      or (attempt.status='reserved' and exists (
        select 1 from jsonb_array_elements(attempt.allocations) a
        where not training_internal.is_lesson_payer(actor,(a->>'studentId')::uuid)
      )) then raise exception 'FORBIDDEN'; end if;
    return to_jsonb(attempt)-'payer_user_id'-'selection';
  end if;
  if p_action not in ('attach','settle','expire','fail') or provider_session is null
    or p_value->>'currency' is distinct from lower(attempt.currency)
    or (p_value->>'amountMinor')::bigint is distinct from attempt.amount_minor
    or (provider_intent is not null and attempt.stripe_payment_intent_id is not null
      and provider_intent<>attempt.stripe_payment_intent_id)
    or (attempt.stripe_session_id is not null and attempt.stripe_session_id<>provider_session) then
    raise exception 'VERSION_CONFLICT: Stripe session does not match the lesson selection.';
  end if;
  if attempt.status<>'reserved' then
    if p_action='settle' and attempt.status not in ('settled','review') then
      raise exception 'INVALID_TRANSITION: A paid session requires reconciliation.';
    end if;
    return to_jsonb(attempt)-'payer_user_id'-'selection';
  end if;
  if p_action='attach' then
    update training_internal.lesson_checkouts set stripe_session_id=provider_session,
      stripe_payment_intent_id=coalesce(provider_intent,stripe_payment_intent_id),updated_at=now()
      where id=attempt_id returning * into attempt;
    return to_jsonb(attempt)-'payer_user_id'-'selection';
  end if;

  perform s.id from public.students s where s.id in (
    select (a->>'studentId')::uuid from jsonb_array_elements(attempt.allocations) a
  ) order by s.id for update;
  perform i.id from public.studio_invoices i where i.id in (
    select (a->>'invoiceId')::uuid from jsonb_array_elements(attempt.allocations) a
  ) order by i.id for update;

  target_status:=case p_action when 'settle' then 'settled' when 'expire' then 'expired' else 'failed' end;
  for invoice_group in
    select (a->>'invoiceId')::uuid as id,
      sum((a->>'amountMinor')::bigint)::bigint as amount,
      jsonb_agg(a order by a->>'lineId') as items
    from jsonb_array_elements(attempt.allocations) a group by 1 order by 1
  loop
    if not exists (select 1 from public.studio_invoices i
      where i.id=invoice_group.id and i.checkout_key=claim and i.checkout_amount=invoice_group.amount) then
      raise exception 'VERSION_CONFLICT: An invoice reservation changed.';
    end if;
    if p_action='settle' then
      perform set_config('app.invoice_checkout_key',claim,true);
      perform training_internal.settle_invoice(invoice_group.id,invoice_group.amount,'stripe',
        'training-stripe:'||provider_session||':'||invoice_group.id,null,invoice_group.items);
    end if;
    perform public.release_studio_invoice_checkout(invoice_group.id,claim);
  end loop;
  update training_internal.lesson_checkouts set status=target_status,
    stripe_session_id=provider_session,stripe_payment_intent_id=coalesce(provider_intent,stripe_payment_intent_id),
    updated_at=now() where id=attempt_id returning * into attempt;
  insert into public.audit_events(studio_id,action,entity_type,entity_id,reason,correlation_id,source,after_state)
    values(attempt.studio_id,'training.checkout_'||target_status,'training_checkout',attempt.id,
      'Verified Stripe checkout outcome',attempt.id::text,'stripe',
      jsonb_build_object('stripeSessionId',provider_session,'allocations',attempt.allocations));
  return to_jsonb(attempt)-'payer_user_id'-'selection';
end
$$;
revoke all on function public.training_lesson_checkout(text,jsonb) from public,anon,authenticated;
grant execute on function public.training_lesson_checkout(text,jsonb) to service_role;
