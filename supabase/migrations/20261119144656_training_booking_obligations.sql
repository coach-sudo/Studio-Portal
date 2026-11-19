-- Preserve the original per-booking charge while exposing the exact lessons
-- to the same invoice ledger used by one-time and automatic payments.
create function training_internal.invoice_confirmed_booking(p_booking uuid)
returns jsonb language plpgsql set search_path='' as $$
declare
  b public.bookings;
  studio public.studios;
  student public.students;
  service public.booking_services;
  contact public.linked_contacts;
  l public.lessons;
  saved jsonb;
  invoice_items jsonb:='[]';
  count_lessons integer;
  rank integer:=0;
  price bigint;
  day_of_lesson date;
  command_key text:='training-pay-later:'||p_booking;
begin
  select * into b from public.bookings where id=p_booking;
  if b.student_id is null or b.status<>'confirmed' or b.payment_policy<>'pay_later'
    or b.offering_id is not null or b.total_minor<=0 or b.paid_minor<>0 then return null; end if;
  perform 1 from public.students where id=b.student_id for update;
  select * into b from public.bookings where id=p_booking for update;
  select * into studio from public.studios where id=b.studio_id;
  if studio.settings #> '{bookingDefaults,allowLearnerLessonInvoices}' is distinct from 'true'::jsonb
    or b.currency is distinct from coalesce(studio.settings->>'currency','USD') then return null; end if;
  select * into student from public.students where id=b.student_id and studio_id=b.studio_id and deleted_at is null;
  if not found then return null; end if;
  perform c.id from public.linked_contacts c where c.student_id=student.id order by c.id for share;
  select * into contact from public.linked_contacts c where c.student_id=student.id
    and training_internal.is_lesson_payer(c.user_id,student.id) and c.is_primary_payer;
  if not found and not training_internal.is_lesson_payer(student.user_id,student.id) then return null; end if;
  select * into service from public.booking_services where id=b.service_id and studio_id=b.studio_id;
  if not found or service.category<>'private' then return null; end if;
  select to_jsonb(i) into saved from public.studio_invoices i where i.idempotency_key=command_key;
  if found then return jsonb_build_object('invoiceId',saved->>'id'); end if;
  select count(*) into count_lessons from public.lesson_participants lp
    where lp.booking_id=b.id and lp.student_id=student.id and lp.status='confirmed';
  if count_lessons not between 1 and 50
    or b.pricing_snapshot->>'unitPriceMinor' is null or b.pricing_snapshot->>'subtotalMinor' is null
    or b.pricing_snapshot->>'discountMinor' is null
    or (b.pricing_snapshot->>'subtotalMinor')::bigint<>count_lessons*(b.pricing_snapshot->>'unitPriceMinor')::bigint
    or (b.pricing_snapshot->>'discountMinor')::bigint<>b.discount_minor
    or (b.pricing_snapshot->>'subtotalMinor')::bigint-b.discount_minor<>b.total_minor then return null; end if;
  for l in select lesson.* from public.lessons lesson join public.lesson_participants lp on lp.lesson_id=lesson.id
    where lp.booking_id=b.id and lp.student_id=student.id and lp.status='confirmed'
    order by lesson.starts_at,lesson.id for update of lesson
  loop
    if l.student_id is distinct from student.id or l.studio_id<>studio.id or l.service_id is distinct from service.id
      or l.status<>'scheduled' or l.starts_at<=now() or l.invoice_id is not null
      or l.payment_status not in ('untracked','due','paid_by_credit') or l.paid_minor<>0
      or l.ends_at-l.starts_at<>b.ends_at-b.starts_at then return null; end if;
    rank:=rank+1;
    -- Distribute the stored discount once across the original held dates.
    -- Remainder cents go to the earliest dates, so the totals reconcile.
    price:=b.total_minor/count_lessons+case when rank<=b.total_minor%count_lessons then 1 else 0 end;
    day_of_lesson:=(l.starts_at at time zone studio.timezone)::date;
    invoice_items:=invoice_items||jsonb_build_array(jsonb_build_object(
      'id',gen_random_uuid(),'kind','service','referenceId',service.id,'description',l.topic,
      'lessonIds',jsonb_build_array(l.id),'quantity',1,'unitMinor',price,
      'startsOn',day_of_lesson,'endsOn',day_of_lesson,'paidMinor',0,'creditMinor',0
    ));
  end loop;
  saved:=public.save_studio_invoice(jsonb_build_object(
    'student_id',student.id,'studio_id',studio.id,'status','open','currency',b.currency,
    'issue_date',(now() at time zone studio.timezone)::date,'due_date',(b.starts_at at time zone studio.timezone)::date,
    'introduction','','notes','','footer','','branding',jsonb_build_object('studioName',studio.name),
    'recipient',jsonb_strip_nulls(jsonb_build_object('name',coalesce(contact.full_name,student.full_name),
      'email',coalesce(contact.email,student.email),'studentName',case when contact.id is not null then student.full_name end)),
    'items',invoice_items
  ),command_key,0);
  update public.audit_events set reason='Recorded verified lesson obligations when confirming a pay-later booking',
    source='booking_platform' where studio_id=studio.id and action='invoice.saved'
    and correlation_id=command_key and entity_id=(saved->>'id')::uuid;
  return jsonb_build_object('invoiceId',saved->>'id');
end
$$;

create function public.training_confirm_pay_later(p_booking uuid,p_hold uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  result jsonb;
  financial jsonb;
begin
  result:=public.confirm_booking(p_booking,p_hold,0,'invoice:'||p_booking);
  if (result->>'duplicate')::boolean then
    select jsonb_build_object('invoiceId',i.id) into financial from public.studio_invoices i
      where i.idempotency_key='training-pay-later:'||p_booking;
  else
    financial:=training_internal.invoice_confirmed_booking(p_booking);
  end if;
  return result||jsonb_build_object('financial',financial);
end
$$;
revoke all on function public.training_confirm_pay_later(uuid,uuid) from public,anon,authenticated;
grant execute on function public.training_confirm_pay_later(uuid,uuid) to service_role;
