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
          or exists(select 1 from public.lesson_participants p
            where p.lesson_id=lid and p.student_id=sid and p.booking_id is not null)
          or exists(select 1 from public.studio_invoices i cross join lateral jsonb_array_elements(i.items) x
            where i.student_id=sid and i.status<>'void' and i.id is distinct from old.id
              and not coalesce((x->>'cancelled')::boolean,false) and x->'lessonIds' ? lid::text)
        then raise exception 'VERSION_CONFLICT: Review the current lesson and linked invoices before continuing.';
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
