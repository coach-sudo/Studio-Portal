-- A payer may issue an exact lesson invoice from terms already saved by the
-- studio. This command neither charges nor sends an invoice email.
create function public.training_prepare_lesson_invoice(p_action text,p_value jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  payer_id uuid:=(p_value->>'actor')::uuid;
  target_student_id uuid:=(p_value->>'studentId')::uuid;
  lesson_id uuid:=(p_value->>'lessonId')::uuid;
  student public.students;
  occurrence public.lessons;
  studio public.studios;
  service public.booking_services;
  existing public.studio_invoices;
  saved jsonb;
  quote jsonb;
  price bigint;
  lesson_date date;
  today date;
  line_id uuid;
  command_key text;
  contact public.linked_contacts;
begin
  if p_action not in ('quote','issue') or payer_id is null or target_student_id is null or lesson_id is null then
    raise exception 'VALIDATION_FAILED';
  end if;
  if p_action='issue' then
    perform 1 from public.students s where s.id=target_student_id for update;
    perform c.id from public.linked_contacts c where c.student_id=target_student_id
      order by c.id for share;
    select * into occurrence from public.lessons l where l.id=lesson_id for update;
  else
    select * into occurrence from public.lessons l where l.id=lesson_id;
  end if;
  if not found or occurrence.student_id is distinct from target_student_id
    or not training_internal.is_lesson_payer(payer_id,target_student_id) then
    raise exception 'FORBIDDEN';
  end if;
  select * into studio from public.studios s where s.id=occurrence.studio_id;
  if studio.settings #> '{bookingDefaults,allowLearnerLessonInvoices}' is distinct from 'true'::jsonb
    then return null; end if;

  if occurrence.invoice_id is not null then
    select * into existing from public.studio_invoices i
      where i.id=occurrence.invoice_id and i.student_id=target_student_id
        and i.status not in ('draft','void')
        and exists (select 1 from jsonb_array_elements(i.items) l
          where not coalesce((l->>'cancelled')::boolean,false) and l->'lessonIds'=jsonb_build_array(lesson_id));
    if found then return jsonb_build_object('invoiceId',existing.id); end if;
    return null;
  end if;
  -- Unpriced, imported, covered, held and provider-managed lessons stay with
  -- their original scheduling and financial workflows.
  command_key:='training-verified-lesson:'||occurrence.id;
  if occurrence.status not in ('scheduled','completed') or occurrence.source_provider<>'studio'
    or occurrence.payment_status<>'due' or occurrence.paid_minor<>0
    or occurrence.package_id is not null or occurrence.invoice_payment_pending or occurrence.payment_needs_review
    or occurrence.price_minor is null or occurrence.price_minor not between 1 and 99999999
    or occurrence.service_id is null
    or exists (select 1 from public.lesson_participants p
      where p.lesson_id=occurrence.id and p.student_id=target_student_id and p.booking_id is not null)
    or exists(select 1 from public.studio_invoices inv where inv.idempotency_key=command_key)
    then return null; end if;
  select * into service from public.booking_services s
    where s.id=occurrence.service_id and s.studio_id=occurrence.studio_id;
  if not found or occurrence.ends_at-occurrence.starts_at<>make_interval(mins=>service.duration_minutes)
    or service.currency is distinct from coalesce(studio.settings->>'currency','USD')
    then return null; end if;
  price:=occurrence.price_minor;
  lesson_date:=(occurrence.starts_at at time zone studio.timezone)::date;
  quote:=jsonb_build_object('version',occurrence.version,'amountMinor',price,'currency',service.currency,
    'description',service.name,'date',lesson_date);
  if p_action='quote' then return quote; end if;
  if (p_value->>'version')::integer is distinct from occurrence.version
    or (p_value->>'amountMinor')::bigint is distinct from price then
    raise exception 'VERSION_CONFLICT: Review the current lesson price before continuing.';
  end if;

  select * into student from public.students s where s.id=target_student_id;
  select * into contact from public.linked_contacts c where c.student_id=target_student_id
    and c.user_id=payer_id and c.is_primary_payer;
  today:=(now() at time zone studio.timezone)::date;
  line_id:=gen_random_uuid();
  saved:=public.save_studio_invoice(jsonb_build_object(
    'student_id',student.id,'studio_id',studio.id,'status','open','currency',service.currency,
    'issue_date',today,'due_date',today,'introduction','','notes','','footer','',
    'branding',jsonb_build_object('studioName',studio.name),
    'recipient',jsonb_strip_nulls(jsonb_build_object('name',coalesce(contact.full_name,student.full_name),
      'email',coalesce(contact.email,student.email),'studentName',case when contact.id is not null then student.full_name end)),
    'items',jsonb_build_array(jsonb_build_object(
      'id',line_id,'kind','service','referenceId',service.id,'description',service.name,
      'quantity',1,'unitMinor',price,'startsOn',lesson_date,'endsOn',lesson_date,
      'lessonIds',jsonb_build_array(occurrence.id),'paidMinor',0,'creditMinor',0
    ))
  ),command_key,0);
  update public.audit_events set reason='Authorized payer issued invoice from verified lesson terms',
    actor_id=payer_id,source='student_portal',after_state=coalesce(after_state,'{}'::jsonb)||jsonb_build_object('payerUserId',payer_id)
    where studio_id=studio.id and action='invoice.saved' and correlation_id=command_key
      and entity_id=(saved->>'id')::uuid;
  return jsonb_build_object('invoiceId',saved->>'id');
end
$$;
revoke all on function public.training_prepare_lesson_invoice(text,jsonb) from public,anon,authenticated;
grant execute on function public.training_prepare_lesson_invoice(text,jsonb) to service_role;
