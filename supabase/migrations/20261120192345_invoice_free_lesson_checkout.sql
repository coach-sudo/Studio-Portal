-- A direct payment reserves the same lesson obligation that invoice and
-- credit commands inspect. The existing checkout attempt and money ledger
-- remain authoritative. This migration changes no historical records.
alter table public.lessons add column direct_checkout_id uuid
  references training_internal.lesson_checkouts(id) on delete restrict;
alter table public.lessons add constraint direct_checkout_requires_pending
  check (direct_checkout_id is null or (invoice_payment_pending and invoice_id is null));
create index lessons_direct_checkout_idx on public.lessons (direct_checkout_id)
  where direct_checkout_id is not null;
alter table training_internal.lesson_checkouts add column provider_started_at timestamptz;

-- A browser cannot manufacture or clear a direct hold, including on a new row.
create function training_internal.guard_direct_lesson_hold() returns trigger
language plpgsql set search_path='' as $$
begin
  if tg_op='UPDATE' and old.direct_checkout_id is not null and new.direct_checkout_id is not null
    and (new.student_id,new.studio_id,new.service_id,new.status,new.starts_at,new.ends_at,
      new.price_minor,new.paid_minor,new.payment_status,new.package_id,new.invoice_id)
    is distinct from (old.student_id,old.studio_id,old.service_id,old.status,old.starts_at,old.ends_at,
      old.price_minor,old.paid_minor,old.payment_status,old.package_id,old.invoice_id)
    then raise exception 'INVALID_TRANSITION: Resolve the pending lesson payment first.'; end if;
  if current_user in ('anon','authenticated') and
    (new.direct_checkout_id is not null or
      (tg_op='UPDATE' and old.direct_checkout_id is not null)) then
    if tg_op='INSERT' or
      (new.direct_checkout_id,new.invoice_payment_pending,new.student_id,new.studio_id,new.service_id,
       new.status,new.starts_at,new.ends_at,new.payment_needs_review) is distinct from
      (old.direct_checkout_id,old.invoice_payment_pending,old.student_id,old.studio_id,old.service_id,
       old.status,old.starts_at,old.ends_at,old.payment_needs_review) then
      raise exception 'INVALID_TRANSITION: Resolve the pending lesson payment first.';
    end if;
  end if;
  return new;
end $$;
revoke all on function training_internal.guard_direct_lesson_hold() from public,anon,authenticated;
create trigger guard_direct_lesson_hold before insert or update on public.lessons
  for each row execute function training_internal.guard_direct_lesson_hold();

-- Invoice and direct checkout both require an exclusive monetary claim.
-- Credit effects also use the student/lesson locking order before evaluating.

create or replace function credit_internal.evaluate_student_lesson_credit(
  p_student uuid, p_lesson uuid, p_mode text default 'automatic',
  p_allocated jsonb default '{}'::jsonb, p_package uuid default null,
  p_needs_review boolean default null
) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  l public.lessons;
  pkg public.packages;
  enabled boolean;
  reason text;
  state text := 'ineligible';
  reservation_count integer;
  reserved_package uuid;
begin
  if p_mode not in ('automatic', 'enable_preview', 'manual')
     or jsonb_typeof(p_allocated) is distinct from 'object' then
    raise exception 'VALIDATION_FAILED: Invalid coverage evaluation mode.' using errcode = '22023';
  end if;
  select x.* into l from public.lessons x join public.students s on s.id = p_student
    where x.id = p_lesson and x.studio_id = s.studio_id
      and (x.student_id = p_student or exists(
        select 1 from public.lesson_participants lp where lp.lesson_id = x.id
          and lp.student_id = p_student and lp.status in ('reserved', 'confirmed')));
  if l.id is null then
    return jsonb_build_object('state', 'ineligible', 'reasonCode', 'lesson_ineligible', 'eligible', false);
  end if;
  select coalesce(sum(t.qty), 0)::integer, (array_agg(t.package_id order by t.package_id))[1]
    into reservation_count, reserved_package
    from (select e.package_id, greatest(0, -sum(e.quantity))::integer qty
      from public.package_credit_entries e join public.packages p on p.id = e.package_id
      where e.lesson_id = l.id and p.student_id = p_student
      group by e.package_id having sum(e.quantity) < 0) t;

  -- A date correction preserves accounting. Only an explicit manual credit
  -- command may allocate coverage to a corrected record afterward.
  if p_mode<>'manual' and exists(select 1 from lesson_ops.datetime_corrections c where c.lesson_id=l.id) then
    return jsonb_build_object('state','review_required','reasonCode','reconciliation_required','eligible',false,'existingReservation',reservation_count>0);
  end if;
  if l.status <> 'scheduled' and not (p_mode = 'manual' and l.status = 'completed') then
    reason := 'lesson_ineligible';
  elsif l.direct_checkout_id is not null or exists(select 1 from public.studio_invoices i cross join jsonb_array_elements(i.items) x
    where i.student_id = p_student and i.checkout_key is not null
      and x->'lessonIds' @> to_jsonb(array[l.id::text])) then
    reason := 'payment_pending';
    if reservation_count > 0 then state := 'review_required'; end if;
  elsif reservation_count > 1 then
    select * into pkg from public.packages where id = reserved_package;
    return jsonb_build_object('state', 'review_required', 'reasonCode', 'reconciliation_required',
      'eligible', false, 'existingReservation', true, 'packageId', pkg.id, 'expiresAt', pkg.expires_at);
  elsif reservation_count = 1 then
    select * into pkg from public.packages where id = reserved_package;
    if l.status = 'scheduled' and pkg.expires_at <= greatest(now(), l.starts_at) then
      return jsonb_build_object('state', 'review_required', 'reasonCode', 'expires_before_lesson',
        'eligible', false, 'existingReservation', true, 'packageId', pkg.id, 'expiresAt', pkg.expires_at);
    end if;
    if (l.student_id = p_student and (l.paid_minor > 0 or l.payment_status in ('paid', 'partially_paid', 'waived', 'refunded')))
       or exists(select 1 from public.lesson_participants lp join public.bookings b on b.id = lp.booking_id
         where lp.lesson_id = l.id and b.student_id = p_student and b.payment_policy <> 'credits'
           and b.payment_status in ('paid', 'partially_paid', 'processing')) then
      return jsonb_build_object('state', 'review_required', 'reasonCode', 'reconciliation_required',
        'eligible', false, 'existingReservation', true, 'packageId', pkg.id, 'expiresAt', pkg.expires_at);
    end if;
    return jsonb_build_object('state', 'covered', 'reasonCode', 'already_reserved',
      'eligible', false, 'existingReservation', true, 'packageId', pkg.id, 'expiresAt', pkg.expires_at);
  elsif coalesce(p_needs_review, (public.student_credit_summary(p_student)->>'needsReview')::boolean) then
    reason := 'reconciliation_required'; state := 'review_required';
  elsif exists(select 1 from public.package_credit_entries e join public.packages p on p.id=e.package_id
    where p.student_id=p_student and e.lesson_id=l.id group by e.lesson_id having sum(e.quantity)>0) then
    reason := 'reconciliation_required'; state := 'review_required';
  elsif l.student_id = p_student and l.payment_status = 'partially_paid' then
    reason := 'partially_paid';
  elsif l.student_id = p_student and (l.payment_status = 'paid' or l.paid_minor > 0) then
    reason := 'cash_paid';
  elsif l.student_id = p_student and l.payment_status in ('waived', 'refunded') then
    reason := 'lesson_ineligible';
  else
    select case when b.payment_status = 'processing' then 'payment_pending'
        when b.payment_status = 'partially_paid' then 'partially_paid' else 'cash_paid' end
      into reason from public.lesson_participants lp join public.bookings b on b.id = lp.booking_id
      where lp.lesson_id = l.id and b.student_id = p_student and b.payment_policy <> 'credits'
        and b.payment_status in ('paid', 'partially_paid', 'processing')
      order by case b.payment_status when 'processing' then 0 when 'partially_paid' then 1 else 2 end, b.id
      limit 1;
    if reason is null then
      select case when exists(select 1 from public.student_credit_accounts where student_id=p_student)
        then (select auto_apply from public.student_credit_accounts where student_id=p_student) else false end into enabled;
      if p_mode <> 'manual' and l.source_provider is not null and l.source_provider not in ('studio','public_booking') then
        reason := 'reconciliation_required'; state := 'review_required';
      elsif p_mode = 'automatic' and enabled is null then
        reason := 'mixed_settings_review'; state := 'review_required';
      elsif p_mode = 'automatic' and enabled = false then
        reason := 'auto_disabled';
      else
        select p.* into pkg from public.packages p
          where p.student_id = p_student
            and (p_package is null or p.id = p_package)
            and (p_mode <> 'automatic' or coalesce(enabled, p.auto_apply))
            and (p.expires_at is null or p.expires_at > greatest(now(), l.starts_at))
            and public.package_credit_balance(p.id) - coalesce((p_allocated->>p.id::text)::integer, 0) > 0
          order by p.expires_at nulls last, p.created_at, p.id limit 1;
        if pkg.id is not null then
          return jsonb_build_object('state', 'eligible_unreserved', 'reasonCode', 'eligible',
            'eligible', true, 'packageId', pkg.id, 'expiresAt', pkg.expires_at);
        end if;
        if p_mode = 'automatic' and enabled is null and exists(
          select 1 from public.packages p where p.student_id = p_student and not p.auto_apply
            and (p_package is null or p.id = p_package)
            and (p.expires_at is null or p.expires_at > greatest(now(), l.starts_at))
            and public.package_credit_balance(p.id) - coalesce((p_allocated->>p.id::text)::integer, 0) > 0) then
          reason := 'mixed_settings_review'; state := 'review_required';
        elsif exists(select 1 from public.packages p where p.student_id = p_student
          and (p_package is null or p.id = p_package)
          and (p_mode <> 'automatic' or coalesce(enabled, p.auto_apply))
          and p.expires_at > now() and p.expires_at <= l.starts_at
          and public.package_credit_balance(p.id) - coalesce((p_allocated->>p.id::text)::integer, 0) > 0) then
          reason := 'expires_before_lesson';
        else
          reason := 'no_available_credits';
        end if;
      end if;
    end if;
  end if;
  return jsonb_build_object('state', state, 'reasonCode', reason, 'eligible', false);
end;
$$;
-- Recheck the coach's reviewed terms inside the existing invoice transaction.
-- Legacy booking, payer, and studio invoice callers retain their existing contract.
create or replace function public.save_studio_invoice(p_value jsonb,p_key text,p_version integer default 0) returns jsonb
language plpgsql security definer set search_path='' as $$
declare inv public.studio_invoices; sid uuid:=(p_value->>'student_id')::uuid; studio uuid:=(p_value->>'studio_id')::uuid; item jsonb; lid uuid; total bigint:=0; line_total bigint; old public.studio_invoices; new_items jsonb:='[]'; original jsonb; is_draft boolean:=p_value->>'status'='draft';
  exact_lessons boolean:=coalesce((p_value->>'exactLessons')::boolean,false);
  reviewed_lesson public.lessons;
  student_version integer;
  current_contacts jsonb;
  seen_lessons uuid[]:='{}';
  booking_links integer;
begin
  perform 1 from public.students where id=sid and studio_id=studio and deleted_at is null for update;
  if not found then raise exception 'FORBIDDEN'; end if;
  select * into inv from public.studio_invoices where idempotency_key=p_key;
  if inv.id is not null then return to_jsonb(inv); end if;
  if exact_lessons and not is_draft then
    select version into student_version from public.students where id=sid;
    select coalesce(jsonb_object_agg(c.id,c.version),'{}') into current_contacts
    from (select id,version from public.linked_contacts where student_id=sid order by id for share) c;
    if student_version is distinct from (p_value->'payerReview'->>'studentVersion')::integer
      or current_contacts is distinct from p_value->'payerReview'->'contacts'
    then raise exception 'VERSION_CONFLICT: Review the current payer before issuing.';
    end if;
  end if;
  if p_value->>'id' is not null then
    select * into old from public.studio_invoices where id=(p_value->>'id')::uuid and studio_id=studio and student_id=sid for update;
    if old.id is null or old.status<>'draft' then raise exception 'INVALID_TRANSITION'; end if;
    if old.version<>p_version then raise exception 'VERSION_CONFLICT'; end if;
  end if;
  if jsonb_array_length(p_value->'items')<1 or jsonb_array_length(p_value->'items')>50 then raise exception 'VALIDATION_FAILED'; end if;
  for item in select value from jsonb_array_elements(p_value->'items') loop
    if (item->>'quantity')::integer not between 1 and 500 or (item->>'unitMinor')::bigint<0 then raise exception 'VALIDATION_FAILED'; end if;
    line_total:=(item->>'quantity')::bigint*(item->>'unitMinor')::bigint;
    if line_total>100000000 then raise exception 'VALIDATION_FAILED'; end if;
    if item->>'kind'='package' then
      if line_total=0 then raise exception 'VALIDATION_FAILED: Package invoices need a positive price.'; end if;
      if not exists(select 1 from public.package_definitions where id=(item->>'referenceId')::uuid and studio_id=studio) then raise exception 'FORBIDDEN'; end if;
    elsif item->>'kind'='service' then
      if not exists(select 1 from public.booking_services where id=(item->>'referenceId')::uuid and studio_id=studio) then raise exception 'FORBIDDEN'; end if;
    else raise exception 'VALIDATION_FAILED'; end if;
    if exact_lessons and (item->>'kind'<>'service' or jsonb_array_length(item->'lessonIds')<>1) then
      raise exception 'VALIDATION_FAILED: Choose one verified lesson per line.';
    end if;
    for lid in select value::uuid from jsonb_array_elements_text(item->'lessonIds') loop
      if (item->>'quantity')::integer<>1 or jsonb_array_length(item->'lessonIds')<>1 or item->>'kind'<>'service' then raise exception 'VALIDATION_FAILED: Use one invoice line per linked lesson.'; end if;
      if exists(select 1 from public.lessons where id=lid and student_id=sid and studio_id=studio
        and direct_checkout_id is not null) then
        raise exception 'INVALID_TRANSITION: A lesson payment is already pending. Check the payment first.';
      end if;
      if exact_lessons then
        if lid=any(seen_lessons) then
          raise exception 'VALIDATION_FAILED: Each lesson can appear only once.';
        end if;
        seen_lessons:=array_append(seen_lessons,lid);
        select * into reviewed_lesson from public.lessons
          where id=lid and student_id=sid and studio_id=studio for update;
        if not found or reviewed_lesson.version is distinct from (item->>'lessonVersion')::integer
          or reviewed_lesson.service_id is distinct from (item->>'referenceId')::uuid
          or reviewed_lesson.price_minor is distinct from (item->>'unitMinor')::bigint
          or reviewed_lesson.price_minor<=0 or reviewed_lesson.paid_minor<>0
          or reviewed_lesson.status not in ('scheduled','completed') or reviewed_lesson.payment_status<>'due'
          or reviewed_lesson.source_provider is distinct from 'studio'
          or reviewed_lesson.package_id is not null or reviewed_lesson.invoice_id is not null
          or reviewed_lesson.invoice_payment_pending or reviewed_lesson.payment_needs_review
          or exists(select 1 from public.package_credit_entries e join public.packages p on p.id=e.package_id
            where e.lesson_id=lid and p.student_id=sid group by e.package_id having sum(e.quantity)<0)
          or exists(select 1 from public.studio_invoices i cross join lateral jsonb_array_elements(i.items) x
            where i.student_id=sid and i.status<>'void' and i.id is distinct from old.id
              and not coalesce((x->>'cancelled')::boolean,false) and x->'lessonIds' ? lid::text)
        then raise exception 'VERSION_CONFLICT: Review the current lesson and linked invoices before continuing.';
        end if;
        select count(*) into booking_links from public.lesson_participants
          where lesson_id=lid and booking_id is not null;
        if booking_links>0 then
          if booking_links<>1 then raise exception 'VERSION_CONFLICT: This lesson has multiple booking obligations.'; end if;
          perform 1 from public.lesson_participants p
          join public.bookings b on b.id=p.booking_id
          where p.lesson_id=lid and p.student_id=sid and p.status in ('confirmed','attended')
            and b.student_id=sid and b.studio_id=studio and b.service_id=reviewed_lesson.service_id
            and b.admin_override->'createdByCoach'='true'::jsonb
            and b.currency=p_value->>'currency' and b.total_minor=reviewed_lesson.price_minor
            and b.paid_minor=0 and b.payment_policy='pay_later' and b.payment_status='due'
            and b.status in ('confirmed','completed') and b.offering_id is null and b.series_id is null
            and not coalesce(b.auto_charge_balance,false)
            and b.stripe_checkout_session_id is null and b.stripe_subscription_id is null
          for update of b,p;
          if not found or exists (select 1 from public.lesson_participants p
            join public.lesson_participants another on another.booking_id=p.booking_id and another.id<>p.id
            where p.lesson_id=lid)
          then raise exception 'VERSION_CONFLICT: Review the booking balance before invoicing this lesson.';
          end if;
        end if;
        item:=(item-'lessonVersion')||jsonb_build_object('verifiedLesson',true);
      end if;
      if not exists(select 1 from public.lessons where id=lid and student_id=sid and studio_id=studio and (service_id is null or service_id=(item->>'referenceId')::uuid) and status not in ('cancelled','late_cancelled') and paid_minor=0 and payment_status not in ('paid','waived','refunded','partially_paid')) then raise exception 'VALIDATION_FAILED: Choose an unpaid matching lesson.'; end if;
      if exists(select 1 from public.lesson_participants lp join public.bookings b on b.id=lp.booking_id where lp.lesson_id=lid and b.student_id=sid and b.payment_policy<>'credits' and (b.paid_minor>0 or b.payment_status in ('paid','partially_paid','processing','not_required'))) then raise exception 'VALIDATION_FAILED: This booking already has payment coverage.'; end if;
      if not is_draft and exists(select 1 from public.studio_invoices i cross join jsonb_array_elements(i.items) x
        where i.student_id=sid and i.status not in ('draft','void') and x->'lessonIds' @> to_jsonb(array[lid::text])) then raise exception 'INVALID_TRANSITION: Lesson already invoiced.'; end if;
      select jsonb_build_object('priceMinor',price_minor,'paymentStatus',payment_status,'serviceId',service_id) into original from public.lessons where id=lid;
      item:=jsonb_set(item,'{originalLesson}',original);
      if not is_draft then update public.lessons set service_id=coalesce(service_id,(item->>'referenceId')::uuid),price_minor=(item->>'unitMinor')::bigint,payment_status=case when payment_status='paid_by_credit' then payment_status when line_total=0 then 'waived' else 'due' end,version=version+1,updated_at=now() where id=lid; end if;
    end loop;
    new_items:=new_items||jsonb_build_array(item);
    total:=total+line_total;
  end loop;
  if old.id is not null then
    update public.studio_invoices set status=case when is_draft then 'draft' when total=0 then 'paid' else 'open' end,
      issue_date=(p_value->>'issue_date')::date,due_date=(p_value->>'due_date')::date,introduction=p_value->>'introduction',notes=p_value->>'notes',footer=p_value->>'footer',
      items=new_items,total_minor=total,branding=p_value->'branding',recipient=p_value->'recipient',currency=p_value->>'currency',version=version+1,updated_at=now(),idempotency_key=p_key where id=old.id returning * into inv;
  else
    insert into public.studio_invoices(studio_id,student_id,number,status,currency,issue_date,due_date,introduction,notes,footer,branding,recipient,items,total_minor,idempotency_key)
    values(studio,sid,'INV-'||to_char(now(),'YYYY')||'-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,10)),case when is_draft then 'draft' when total=0 then 'paid' else 'open' end,
      p_value->>'currency',(p_value->>'issue_date')::date,(p_value->>'due_date')::date,p_value->>'introduction',p_value->>'notes',p_value->>'footer',p_value->'branding',p_value->'recipient',new_items,total,p_key) returning * into inv;
  end if;
  insert into public.audit_events(studio_id,action,entity_type,entity_id,reason,correlation_id,source,after_state)
    values(studio,'invoice.saved','invoice',inv.id,'Coach saved invoice',p_key,'coach_portal',to_jsonb(inv));
  if not is_draft then
    for item in select value from jsonb_array_elements(inv.items) loop
      for lid in select value::uuid from jsonb_array_elements_text(item->'lessonIds') loop
        update public.lessons set invoice_id=inv.id where id=lid;
        perform public.sync_invoice_lesson_credit(lid,sid);
      end loop;
    end loop;
  end if;
  return (select to_jsonb(i) from public.studio_invoices i where i.id=inv.id);
end $$;

create function lesson_ops.payment_context(p_actor uuid,p_lesson uuid,p_direct boolean,p_attempt uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare l public.lessons; b public.bookings; participant public.lesson_participants; reason text; money_currency text; count_participants bigint; paid bigint; result jsonb;
begin
 select * into l from public.lessons where id=p_lesson;
  if p_actor is null or l.id is null or
   (not p_direct and not exists(select 1 from public.memberships where user_id=p_actor and studio_id=l.studio_id and role='coach')) or
   (p_direct and p_attempt is null and not training_internal.is_lesson_payer(p_actor,l.student_id)) or
   (p_direct and p_attempt is not null and l.direct_checkout_id is distinct from p_attempt)
 then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 select count(*) into count_participants from public.lesson_participants where lesson_id=l.id;
 if count_participants=1 then select * into participant from public.lesson_participants where lesson_id=l.id; end if;
 if participant.booking_id is not null then select * into b from public.bookings where id=participant.booking_id; end if;
 select coalesce(sum(r.amount_minor),0) into paid from lesson_ops.payment_receipts r join public.payment_entries e on e.id=r.payment_entry_id and e.student_id=r.student_id and e.kind='payment' and e.amount_minor=r.amount_minor and e.currency=r.currency where r.lesson_id=l.id;
 select coalesce(nullif(b.currency,''),nullif(s.settings->>'currency','')) into money_currency from public.studios s where s.id=l.studio_id;
 if not exists(select 1 from public.students where id=l.student_id and studio_id=l.studio_id and deleted_at is null) then reason:='student_unavailable';
 elsif l.invoice_id is not null or exists(select 1 from public.studio_invoices i where i.status<>'void' and exists(select 1 from jsonb_array_elements(i.items) item where item->'lessonIds' @> to_jsonb(array[l.id::text]))) then reason:='use_invoice';
 elsif l.invoice_payment_pending and p_attempt is null then reason:='checkout_pending';
  elsif p_direct and (l.source_provider is distinct from 'studio' or l.payment_needs_review or l.service_id is null) then reason:='price_or_status_review';
 elsif l.status not in ('scheduled','completed') then reason:='outcome_review';
 elsif coalesce(l.capacity,1)>1 or l.offering_id is not null or l.series_id is not null or count_participants>1 or (count_participants=1 and participant.student_id is distinct from l.student_id) then reason:='allocation_review';
 elsif l.package_id is not null or exists(select 1 from public.package_credit_entries where lesson_id=l.id) then reason:='credit_review';
 elsif exists(select 1 from lesson_ops.datetime_corrections c where c.lesson_id=l.id and c.financial_review_required and not exists(select 1 from lesson_ops.datetime_correction_reviews r where r.correction_id=c.id and r.kind='financial')) then reason:='correction_review';
 elsif b.id is not null and (b.studio_id<>l.studio_id or b.student_id is distinct from l.student_id or b.series_id is not null or b.offering_id is not null or b.status not in ('confirmed','completed') or exists(select 1 from public.lesson_participants where booking_id=b.id and lesson_id<>l.id)) then reason:='allocation_review';
 elsif b.id is not null and (b.payment_policy<>'pay_later' or b.stripe_checkout_session_id is not null or b.stripe_subscription_id is not null or b.payment_status in ('processing','refunded','past_due','failed')) then reason:='provider_review';
 elsif p_direct and b.id is not null and (
   b.admin_override->'createdByCoach' is distinct from 'true'::jsonb
   or b.service_id is distinct from l.service_id
   or b.auto_charge_balance or b.payment_status not in ('due','partially_paid')
   or participant.status not in ('confirmed','attended')) then reason:='provider_review';
 elsif p_direct and not exists(select 1 from public.booking_services svc where svc.id=l.service_id
   and svc.studio_id=l.studio_id and svc.currency=money_currency) then reason:='price_or_status_review';
 elsif money_currency is null or money_currency!~'^[A-Z]{3}$' then reason:='currency_review';
 elsif l.price_minor is null or l.price_minor<=0 or l.price_minor>9007199254740991 or l.payment_status not in ('due','partially_paid') then reason:='price_or_status_review';
 elsif exists(select 1 from lesson_ops.payment_receipts r left join public.payment_entries e on e.id=r.payment_entry_id and e.student_id=r.student_id and e.kind='payment' and e.amount_minor=r.amount_minor and e.currency=r.currency where r.lesson_id=l.id and (e.id is null or r.student_id<>l.student_id or r.studio_id<>l.studio_id or r.currency is distinct from money_currency)) then reason:='historical_totals_review';
 elsif coalesce(l.paid_minor,0)<>paid or (b.id is not null and (b.paid_minor<>paid or b.total_minor is distinct from l.price_minor)) then reason:='historical_totals_review';
 elsif paid>=l.price_minor then reason:='no_balance';
 end if;
 result:=jsonb_build_object('lessonId',l.id,'version',l.version,'studentId',l.student_id,'participantId',participant.id,'bookingId',b.id,'bookingVersion',b.version,'currency',money_currency,'priceMinor',l.price_minor,'paidMinor',coalesce(l.paid_minor,0),'remainingMinor',greatest(0,coalesce(l.price_minor,0)-coalesce(l.paid_minor,0)),'eligible',reason is null,'reasonCode',reason);
 return result||jsonb_build_object('reviewToken',encode(extensions.digest(jsonb_build_object('actor',p_actor,'context',result)::text,'sha256'),'hex'));
end $$;
revoke all on function lesson_ops.payment_context(uuid,uuid,boolean,uuid) from public,anon,authenticated,service_role;
create or replace function lesson_ops.payment_context(p_actor uuid,p_lesson uuid) returns jsonb
language sql stable security definer set search_path='' as $$
  select lesson_ops.payment_context(p_actor,p_lesson,false,null)
$$;

-- The return student is a navigation context, not an authorization grant.
create function training_internal.direct_lesson_quote(p_actor uuid,p_lesson uuid,p_attempt uuid)
returns jsonb language sql stable set search_path='' as $$
  select c.value || jsonb_build_object(
    'description',l.topic,
    'date',(l.starts_at at time zone st.timezone)::date,
    'studioId',l.studio_id,
    'studentName',s.full_name,
    'terms',encode(extensions.digest(jsonb_build_object(
      'review',c.value->>'reviewToken','startsAt',l.starts_at,'endsAt',l.ends_at,
      'owner',s.user_id,'minor',s.is_minor,'email',s.email,'portal',s.portal_enabled,
      'payers',coalesce((
        select jsonb_agg(jsonb_build_array(a.id,a.user_id,a.email,a.portal_enabled,a.can_view_finance) order by a.id)
        from public.linked_contacts a where a.student_id=s.id and a.is_primary_payer
      ),'[]'::jsonb)
    )::text,'sha256'),'hex')
  )
  from public.lessons l join public.students s on s.id=l.student_id
  join public.studios st on st.id=l.studio_id
  cross join lateral (select lesson_ops.payment_context(p_actor,l.id,true,p_attempt) value) c
  where l.id=p_lesson
$$;
revoke all on function training_internal.direct_lesson_quote(uuid,uuid,uuid) from public,anon,authenticated;

create function training_internal.direct_lesson_options(p_actor uuid,p_value jsonb)
returns jsonb language plpgsql stable set search_path='' as $$
declare
  allowed uuid[];
  focus uuid:=(p_value->>'studentId')::uuid;
  lesson uuid:=(p_value->>'lessonId')::uuid;
  studio uuid;
  rows jsonb;
begin
  if not training_internal.is_lesson_payer(p_actor,focus) then return '[]'::jsonb; end if;
  select studio_id into studio from public.students where id=focus;
  select array_agg(s.id) into allowed from public.students s
    where s.studio_id=studio and (p_value->'studentIds') ? s.id::text
      and training_internal.is_lesson_payer(p_actor,s.id);
  select coalesce(jsonb_agg(x.value order by x.starts_at,x.id),'[]'::jsonb) into rows from (
    select l.starts_at,l.id,quote.value from public.lessons l
    cross join lateral (select training_internal.direct_lesson_quote(p_actor,l.id,null) value) quote
    where l.student_id=any(allowed) and l.studio_id=studio
      and (lesson is null or l.id=lesson) and l.status in ('scheduled','completed')
      and l.payment_status in ('due','partially_paid')
      and (not coalesce((p_value->>'upcomingOnly')::boolean,false) or (l.status='scheduled' and l.ends_at>=now()))
      and quote.value->>'eligible'='true'
      and (quote.value->>'remainingMinor')::bigint between 1 and 99999999
    order by l.starts_at,l.id limit 51
  ) x;
  return rows;
end $$;
revoke all on function training_internal.direct_lesson_options(uuid,jsonb) from public,anon,authenticated;

create function training_internal.lock_direct_lesson_rows(p_selection jsonb)
returns void language plpgsql set search_path='' as $$
begin
  perform s.id from public.students s
    where s.id in(select (x->>'studentId')::uuid from jsonb_array_elements(p_selection) x)
    order by s.id for update;
  perform c.id from public.linked_contacts c
    where c.student_id in(select (x->>'studentId')::uuid from jsonb_array_elements(p_selection) x)
    order by c.id for share;
  perform l.id from public.lessons l
    where l.id in(select (x->>'lessonId')::uuid from jsonb_array_elements(p_selection) x)
    order by l.id for update;
  perform b.id from public.bookings b
    where b.id in(select p.booking_id from public.lesson_participants p
      where p.lesson_id in(select (x->>'lessonId')::uuid from jsonb_array_elements(p_selection) x))
    order by b.id for update;
  perform p.id from public.lesson_participants p
    where p.lesson_id in(select (x->>'lessonId')::uuid from jsonb_array_elements(p_selection) x)
    order by p.id for update;
end $$;
revoke all on function training_internal.lock_direct_lesson_rows(jsonb) from public,anon,authenticated;

create function training_internal.reserve_direct_lessons(p_value jsonb)
returns training_internal.lesson_checkouts language plpgsql set search_path='' as $$
declare
  id_value uuid:=(p_value->>'id')::uuid;
  actor uuid:=(p_value->>'actor')::uuid;
  focus uuid:=(p_value->>'studentId')::uuid;
  normalized jsonb;
  item jsonb;
  quote jsonb;
  target public.lessons;
  attempt training_internal.lesson_checkouts;
  allocations jsonb:='[]';
  studio uuid;
  currency text;
  total bigint:=0;
begin
  if id_value is null or not training_internal.is_lesson_payer(actor,focus)
    or jsonb_typeof(p_value->'items') is distinct from 'array'
    or jsonb_array_length(p_value->'items') not between 1 and 50
    then raise exception 'VALIDATION_FAILED: Select eligible lessons to pay.'; end if;
  select jsonb_agg(x order by x->>'lessonId') into normalized from jsonb_array_elements(p_value->'items') x;
  if jsonb_array_length(normalized)<>(select count(distinct x->>'lessonId') from jsonb_array_elements(normalized) x)
    then raise exception 'VALIDATION_FAILED: Select each lesson once.'; end if;

  perform pg_advisory_xact_lock(hashtextextended('training:'||id_value,0));
  -- Serialize both reservation entry points even for a concurrently reused ID.
  perform pg_advisory_xact_lock(hashtextextended('training-checkout:'||id_value,0));
  select * into attempt from training_internal.lesson_checkouts where id=id_value;
  if found then
    if attempt.payer_user_id<>actor or attempt.selection<>normalized or attempt.return_student_id<>focus
      or attempt.allocations->0->>'kind' is distinct from 'direct'
      or (attempt.status='reserved' and exists(select 1 from jsonb_array_elements(attempt.allocations) a
        where not training_internal.is_lesson_payer(actor,(a->>'studentId')::uuid)))
      then raise exception 'FORBIDDEN'; end if;
    return attempt;
  end if;

  perform training_internal.lock_direct_lesson_rows(normalized||jsonb_build_array(jsonb_build_object('studentId',focus)));
  if not training_internal.is_lesson_payer(actor,focus) then raise exception 'FORBIDDEN'; end if;
  select studio_id into studio from public.students where id=focus;
  for item in select value from jsonb_array_elements(normalized) loop
    select * into target from public.lessons where id=(item->>'lessonId')::uuid;
    if not found or target.student_id is distinct from (item->>'studentId')::uuid
      or target.studio_id is distinct from studio
      or not training_internal.is_lesson_payer(actor,target.student_id)
      then raise exception 'FORBIDDEN'; end if;
    quote:=training_internal.direct_lesson_quote(actor,target.id,null);
    if quote->>'eligible' is distinct from 'true'
      or quote->>'terms' is distinct from item->>'terms'
      or (quote->>'remainingMinor')::bigint is distinct from (item->>'amountMinor')::bigint
      or quote->>'currency' is distinct from item->>'currency'
      then raise exception 'VERSION_CONFLICT: A lesson or its payment terms changed. Review the current balance.'; end if;
    currency:=coalesce(currency,quote->>'currency');
    if currency is distinct from quote->>'currency'
      then raise exception 'VALIDATION_FAILED: Select lessons in one currency.'; end if;
    total:=total+(quote->>'remainingMinor')::bigint;
    allocations:=allocations||jsonb_build_array(jsonb_build_object(
      'kind','direct','lessonId',target.id,'studentId',target.student_id,
      'amountMinor',(quote->>'remainingMinor')::bigint,'description',quote->>'description',
      'date',quote->>'date','terms',quote->>'terms',
      'bookingId',quote->>'bookingId','participantId',quote->>'participantId',
      'priceMinor',quote->>'priceMinor','paidMinor',quote->>'paidMinor'));
  end loop;
  if total not between 1 and 99999999 then raise exception 'VALIDATION_FAILED: Invalid checkout amount.'; end if;

  insert into training_internal.lesson_checkouts(id,payer_user_id,studio_id,currency,amount_minor,selection,allocations,return_student_id)
    values(id_value,actor,studio,currency,total,normalized,allocations,focus) returning * into attempt;
  update public.lessons l set direct_checkout_id=attempt.id,invoice_payment_pending=true
    where l.id in(select (a->>'lessonId')::uuid from jsonb_array_elements(allocations) a);
  insert into public.audit_events(studio_id,actor_id,action,entity_type,entity_id,reason,correlation_id,source,after_state)
    values(studio,actor,'training.checkout_reserved','training_checkout',attempt.id,
      'Payer reserved verified lesson balances',attempt.id::text,'student_portal',jsonb_build_object('allocations',allocations));
  return attempt;
end $$;
revoke all on function training_internal.reserve_direct_lessons(jsonb) from public,anon,authenticated;

-- Call only after locking the attempt, then lock its obligated students and
-- lessons. A lost provider reply does not authorize releasing a hold.
create function training_internal.finish_direct_lessons(p_attempt training_internal.lesson_checkouts,p_status text)
returns void language plpgsql set search_path='' as $$
declare
  item jsonb;
  quote jsonb;
  lesson uuid;
  booking uuid;
  paid bigint;
  changed integer;
begin
  perform training_internal.lock_direct_lesson_rows(p_attempt.selection);
  if p_status='settled' then
    for item in select value from jsonb_array_elements(p_attempt.allocations) loop
      lesson:=(item->>'lessonId')::uuid;
      quote:=training_internal.direct_lesson_quote(p_attempt.payer_user_id,lesson,p_attempt.id);
      if quote->>'eligible' is distinct from 'true'
        or quote->>'bookingId' is distinct from item->>'bookingId'
        or quote->>'participantId' is distinct from item->>'participantId'
        or quote->>'priceMinor' is distinct from item->>'priceMinor'
        or quote->>'paidMinor' is distinct from item->>'paidMinor'
        or quote->>'currency' is distinct from p_attempt.currency
        or (quote->>'remainingMinor')::bigint is distinct from (item->>'amountMinor')::bigint
        then raise exception 'VERSION_CONFLICT: A paid lesson needs settlement review.'; end if;
      paid:=(quote->>'priceMinor')::bigint;
      booking:=(quote->>'bookingId')::uuid;
      insert into public.payment_entries(student_id,kind,amount_minor,currency,external_reference,reason,created_by)
        values((item->>'studentId')::uuid,'payment',(item->>'amountMinor')::bigint,p_attempt.currency,
          'lesson-checkout:'||p_attempt.id||':'||lesson,'Online lesson payment',p_attempt.payer_user_id);
      update public.lessons set paid_minor=paid,payment_status='paid',version=version+1,updated_at=now(),
        direct_checkout_id=null,invoice_payment_pending=false
        where id=lesson and direct_checkout_id=p_attempt.id;
      if not found then raise exception 'VERSION_CONFLICT: Lesson reservation changed.'; end if;
      if booking is not null then
        update public.bookings set paid_minor=paid,payment_status='paid',version=version+1,updated_at=now()
          where id=booking and version=(quote->>'bookingVersion')::integer;
        if not found then raise exception 'VERSION_CONFLICT: Booking reservation changed.'; end if;
      end if;
    end loop;
  else
    update public.lessons l set direct_checkout_id=null,invoice_payment_pending=false
      where l.direct_checkout_id=p_attempt.id;
    get diagnostics changed=row_count;
    if changed<>jsonb_array_length(p_attempt.allocations)
      then raise exception 'VERSION_CONFLICT: Lesson reservation changed.'; end if;
  end if;
end $$;
revoke all on function training_internal.finish_direct_lessons(training_internal.lesson_checkouts,text)
  from public,anon,authenticated;

-- A checkout never handed to the provider can be recovered without Stripe.
-- Check the start marker while holding the same lock used by begin.
create function training_internal.expire_unstarted_direct_lesson(p_actor uuid,p_student uuid)
returns void language plpgsql set search_path='' as $$
declare attempt training_internal.lesson_checkouts;
begin
  if not training_internal.is_lesson_payer(p_actor,p_student) then return; end if;
  select a.* into attempt from training_internal.lesson_checkouts a
    where a.status='reserved' and a.allocations->0->>'kind'='direct'
      and a.provider_started_at is null and a.stripe_session_id is null
      and a.created_at<now()-interval '15 minutes'
      and exists(select 1 from public.lessons l
        where l.direct_checkout_id=a.id and l.student_id=p_student)
    order by a.created_at,a.id limit 1;
  if not found or not pg_try_advisory_xact_lock(hashtextextended('training:'||attempt.id,0))
    then return; end if;
  select * into attempt from training_internal.lesson_checkouts a
    where a.id=attempt.id and a.status='reserved' and a.provider_started_at is null
      and a.stripe_session_id is null for update;
  if not found then return; end if;
  perform training_internal.finish_direct_lessons(attempt,'expired');
  update training_internal.lesson_checkouts set status='expired',updated_at=now() where id=attempt.id;
end $$;
revoke all on function training_internal.expire_unstarted_direct_lesson(uuid,uuid) from public,anon,authenticated;


create or replace function public.training_lesson_checkout(p_action text,p_value jsonb)
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
  allocation jsonb;
  direct_quote jsonb;
  direct boolean;
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
          and not exists (select 1 from training_internal.lesson_autopay_attempts scheduled
            where scheduled.id=a.id)
      ),'[]'::jsonb)
    );
  end if;
  -- The worker owns these reservations, including the interval before Stripe attaches an intent.
  if p_action in ('reserve','read') and exists (
    select 1 from training_internal.lesson_autopay_attempts scheduled where scheduled.id=attempt_id
  ) then raise exception 'NOT_FOUND'; end if;
  if p_action='direct_options' then
    perform training_internal.expire_unstarted_direct_lesson(actor,(p_value->>'studentId')::uuid);
    return training_internal.direct_lesson_options(actor,p_value);
  end if;
  if p_action='reserve_direct' then
    attempt:=training_internal.reserve_direct_lessons(p_value);
    return to_jsonb(attempt)-'payer_user_id'-'selection';
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
  direct:=coalesce(attempt.allocations->0->>'kind'='direct',false);
  if direct and p_action in ('begin_direct_provider','cancel_unstarted') then
    if attempt.payer_user_id is distinct from actor then raise exception 'FORBIDDEN'; end if;
    if attempt.status<>'reserved' then return to_jsonb(attempt)-'payer_user_id'-'selection'; end if;
    if p_action='cancel_unstarted' then
      if attempt.provider_started_at is not null or attempt.stripe_session_id is not null
        then return to_jsonb(attempt)-'payer_user_id'-'selection'; end if;
      perform training_internal.finish_direct_lessons(attempt,'expired');
      update training_internal.lesson_checkouts set status='expired',updated_at=now()
        where id=attempt.id returning * into attempt;
      return to_jsonb(attempt)-'payer_user_id'-'selection';
    end if;
    perform training_internal.lock_direct_lesson_rows(
      attempt.selection||jsonb_build_array(jsonb_build_object('studentId',attempt.return_student_id)));
    if not training_internal.is_lesson_payer(actor,attempt.return_student_id) then raise exception 'FORBIDDEN'; end if;
    for allocation in select value from jsonb_array_elements(attempt.allocations) loop
      if not training_internal.is_lesson_payer(actor,(allocation->>'studentId')::uuid)
        then raise exception 'FORBIDDEN'; end if;
      direct_quote:=training_internal.direct_lesson_quote(actor,(allocation->>'lessonId')::uuid,attempt.id);
      if direct_quote->>'eligible' is distinct from 'true'
        or direct_quote->>'terms' is distinct from allocation->>'terms'
        then raise exception 'VERSION_CONFLICT: The lesson or payer changed. Review the payment again.'; end if;
    end loop;
    if attempt.provider_started_at is null then
      update training_internal.lesson_checkouts set provider_started_at=now(),updated_at=now()
        where id=attempt.id returning * into attempt;
    end if;
    return to_jsonb(attempt)-'payer_user_id'-'selection';
  end if;
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
  if direct and attempt.provider_started_at is null
    then raise exception 'INVALID_TRANSITION: The checkout was not opened with the provider.'; end if;
  if direct and p_action='settle' and provider_intent is null
    then raise exception 'VALIDATION_FAILED: The provider payment identity is required.'; end if;
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
  if direct then
    perform training_internal.finish_direct_lessons(attempt,target_status);
  else
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
  end if;
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
