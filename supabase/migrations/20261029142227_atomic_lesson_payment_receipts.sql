-- Actual money received is an append-only command, never a status/price edit.
create table lesson_ops.payment_receipts (
 id uuid primary key default gen_random_uuid(), actor_id uuid not null, studio_id uuid not null references public.studios(id),
 key text not null, request_hash text not null, lesson_id uuid not null references public.lessons(id) on delete restrict,
 student_id uuid not null references public.students(id) on delete restrict, booking_id uuid references public.bookings(id) on delete restrict,
 payment_entry_id uuid not null unique references public.payment_entries(id) on delete restrict,
 amount_minor bigint not null check(amount_minor>0), currency text not null check(currency~'^[A-Z]{3}$'),
 method text not null check(method in ('cash','bank')), reason text not null, result jsonb not null,
 created_at timestamptz not null default now(), unique(actor_id,studio_id,key)
);
create index payment_receipts_lesson on lesson_ops.payment_receipts(lesson_id,created_at,id);
alter table lesson_ops.payment_receipts enable row level security;
revoke all on lesson_ops.payment_receipts from public,anon,authenticated,service_role;

create function lesson_ops.payment_context(p_actor uuid,p_lesson uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare l public.lessons; b public.bookings; participant public.lesson_participants; reason text; money_currency text; count_participants bigint; paid bigint; result jsonb;
begin
 select * into l from public.lessons where id=p_lesson;
 if p_actor is null or l.id is null or not exists(select 1 from public.memberships where user_id=p_actor and studio_id=l.studio_id and role='coach') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 select count(*) into count_participants from public.lesson_participants where lesson_id=l.id;
 if count_participants=1 then select * into participant from public.lesson_participants where lesson_id=l.id; end if;
 if participant.booking_id is not null then select * into b from public.bookings where id=participant.booking_id; end if;
 select coalesce(sum(r.amount_minor),0) into paid from lesson_ops.payment_receipts r join public.payment_entries e on e.id=r.payment_entry_id and e.student_id=r.student_id and e.kind='payment' and e.amount_minor=r.amount_minor and e.currency=r.currency where r.lesson_id=l.id;
 select coalesce(nullif(b.currency,''),nullif(s.settings->>'currency','')) into money_currency from public.studios s where s.id=l.studio_id;
 if not exists(select 1 from public.students where id=l.student_id and studio_id=l.studio_id and deleted_at is null) then reason:='student_unavailable';
 elsif l.invoice_id is not null or exists(select 1 from public.studio_invoices i where i.status<>'void' and exists(select 1 from jsonb_array_elements(i.items) item where item->'lessonIds' @> to_jsonb(array[l.id::text]))) then reason:='use_invoice';
 elsif l.invoice_payment_pending then reason:='checkout_pending';
 elsif l.status not in ('scheduled','completed') then reason:='outcome_review';
 elsif coalesce(l.capacity,1)>1 or l.offering_id is not null or l.series_id is not null or count_participants>1 or (count_participants=1 and participant.student_id is distinct from l.student_id) then reason:='allocation_review';
 elsif l.package_id is not null or exists(select 1 from public.package_credit_entries where lesson_id=l.id) then reason:='credit_review';
 elsif exists(select 1 from lesson_ops.datetime_corrections c where c.lesson_id=l.id and c.financial_review_required and not exists(select 1 from lesson_ops.datetime_correction_reviews r where r.correction_id=c.id and r.kind='financial')) then reason:='correction_review';
 elsif b.id is not null and (b.studio_id<>l.studio_id or b.student_id is distinct from l.student_id or b.series_id is not null or b.offering_id is not null or b.status not in ('confirmed','completed') or exists(select 1 from public.lesson_participants where booking_id=b.id and lesson_id<>l.id)) then reason:='allocation_review';
 elsif b.id is not null and (b.payment_policy<>'pay_later' or b.stripe_checkout_session_id is not null or b.stripe_subscription_id is not null or b.payment_status in ('processing','refunded','past_due','failed')) then reason:='provider_review';
 elsif money_currency is null or money_currency!~'^[A-Z]{3}$' then reason:='currency_review';
 elsif l.price_minor is null or l.price_minor<=0 or l.price_minor>9007199254740991 or l.payment_status not in ('due','partially_paid') then reason:='price_or_status_review';
 elsif exists(select 1 from lesson_ops.payment_receipts r left join public.payment_entries e on e.id=r.payment_entry_id and e.student_id=r.student_id and e.kind='payment' and e.amount_minor=r.amount_minor and e.currency=r.currency where r.lesson_id=l.id and (e.id is null or r.student_id<>l.student_id or r.studio_id<>l.studio_id or r.currency is distinct from money_currency)) then reason:='historical_totals_review';
 elsif coalesce(l.paid_minor,0)<>paid or (b.id is not null and (b.paid_minor<>paid or b.total_minor is distinct from l.price_minor)) then reason:='historical_totals_review';
 elsif paid>=l.price_minor then reason:='no_balance';
 end if;
 result:=jsonb_build_object('lessonId',l.id,'version',l.version,'studentId',l.student_id,'participantId',participant.id,'bookingId',b.id,'bookingVersion',b.version,'currency',money_currency,'priceMinor',l.price_minor,'paidMinor',coalesce(l.paid_minor,0),'remainingMinor',greatest(0,coalesce(l.price_minor,0)-coalesce(l.paid_minor,0)),'eligible',reason is null,'reasonCode',reason);
 return result||jsonb_build_object('reviewToken',encode(extensions.digest(jsonb_build_object('actor',p_actor,'context',result)::text,'sha256'),'hex'));
end $$;
revoke all on function lesson_ops.payment_context(uuid,uuid) from public,anon,authenticated,service_role;
create function public.lesson_payment_context(p_lesson uuid) returns jsonb
language sql stable security definer set search_path='' as $$select lesson_ops.payment_context(auth.uid(),p_lesson)$$;
revoke all on function public.lesson_payment_context(uuid) from public,anon,service_role;
grant execute on function public.lesson_payment_context(uuid) to authenticated;

create function public.record_lesson_payment(p_value jsonb,p_key text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); l public.lessons; prior lesson_ops.payment_receipts; context jsonb; request_hash text; amount bigint; paid bigint; payment uuid:=gen_random_uuid(); receipt uuid:=gen_random_uuid(); audit_id uuid:=gen_random_uuid(); booking uuid; result jsonb;
begin
 select * into l from public.lessons where id=(p_value->>'lessonId')::uuid;
 if actor is null or l.id is null or not exists(select 1 from public.memberships where user_id=actor and studio_id=l.studio_id and role='coach') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if p_key is null or length(p_key) not between 8 and 200 or jsonb_typeof(p_value) is distinct from 'object' or length(p_value::text)>10000 or exists(select 1 from jsonb_object_keys(p_value) k where k not in ('lessonId','version','reviewToken','amountMinor','currency','method','reason')) or jsonb_typeof(p_value->'amountMinor') is distinct from 'number' or coalesce(p_value->>'amountMinor','')!~'^[0-9]+$' or coalesce(p_value->>'method','') not in ('cash','bank') or coalesce(length(trim(p_value->>'reason')),0) not between 3 and 1000 or coalesce(length(p_value->>'reviewToken'),0)<>64 then raise exception 'VALIDATION_FAILED: Record a positive received amount, method, reason and reviewed lesson.'; end if;
 amount:=(p_value->>'amountMinor')::bigint;
 if amount<=0 or amount>9007199254740991 then raise exception 'VALIDATION_FAILED'; end if;
 request_hash:=encode(extensions.digest(p_value::text,'sha256'),'hex');
 perform pg_advisory_xact_lock(hashtextextended(actor::text||':'||l.studio_id::text||':lesson-payment:'||p_key,0));
 select * into prior from lesson_ops.payment_receipts where actor_id=actor and studio_id=l.studio_id and key=p_key;
 if found then if prior.request_hash<>request_hash then raise exception 'IDEMPOTENCY_CONFLICT'; end if;return prior.result;end if;
 perform pg_advisory_xact_lock(hashtext(l.studio_id::text));
 perform pg_advisory_xact_lock(hashtextextended(l.studio_id::text||':calendar',0));
 perform 1 from public.students where id=l.student_id for update;
 select * into l from public.lessons where id=l.id for update;
 perform 1 from public.bookings where id in(select booking_id from public.lesson_participants where lesson_id=l.id) order by id for update;
 perform 1 from public.lesson_participants where lesson_id=l.id order by id for update;
 context:=lesson_ops.payment_context(actor,l.id);
 if not (context->>'eligible')::boolean then raise exception 'REVIEW_REQUIRED: %',context->>'reasonCode';end if;
 if (p_value->>'version')::integer is distinct from l.version or p_value->>'reviewToken' is distinct from context->>'reviewToken' then raise exception 'VERSION_CONFLICT: Payment context changed. Review again.';end if;
 if p_value->>'currency' is distinct from context->>'currency' or amount>(context->>'remainingMinor')::bigint then raise exception 'VALIDATION_FAILED: Received amount exceeds the reviewed balance or uses a different currency.';end if;
 paid:=coalesce(l.paid_minor,0)+amount;booking:=(context->>'bookingId')::uuid;
 insert into public.payment_entries(id,student_id,kind,amount_minor,currency,external_reference,reason,created_by)
 values(payment,l.student_id,'payment',amount,context->>'currency','lesson-payment:'||receipt::text,trim(p_value->>'reason'),actor);
 if booking is not null then
  update public.bookings set paid_minor=paid,payment_status=case when paid=total_minor then 'paid' else 'partially_paid' end,version=version+1,updated_at=now() where id=booking and version=(context->>'bookingVersion')::integer;
  if not found then raise exception 'VERSION_CONFLICT';end if;
 end if;
 update public.lessons set paid_minor=paid,payment_status=case when paid=price_minor then 'paid' else 'partially_paid' end,version=version+1,updated_at=now() where id=l.id and version=l.version returning * into l;
 if not found then raise exception 'VERSION_CONFLICT';end if;
 result:=jsonb_build_object('receiptId',receipt,'paymentEntryId',payment,'auditEventId',audit_id,'lessonId',l.id,'studentId',l.student_id,'bookingId',booking,'version',l.version,'amountMinor',amount,'paidMinor',paid,'remainingMinor',l.price_minor-paid,'currency',context->>'currency','queuedSideEffects','[]'::jsonb);
 insert into public.audit_events(id,studio_id,actor_id,entity_type,entity_id,action,reason,correlation_id,source,before_state,after_state) values(audit_id,l.studio_id,actor,'lesson',l.id,'lesson.payment_recorded',trim(p_value->>'reason'),p_key,'coach_portal',context,result);
 insert into lesson_ops.payment_receipts(id,actor_id,studio_id,key,request_hash,lesson_id,student_id,booking_id,payment_entry_id,amount_minor,currency,method,reason,result) values(receipt,actor,l.studio_id,p_key,request_hash,l.id,l.student_id,booking,payment,amount,context->>'currency',p_value->>'method',trim(p_value->>'reason'),result);
 return result;
end $$;
revoke all on function public.record_lesson_payment(jsonb,text) from public,anon,service_role;
grant execute on function public.record_lesson_payment(jsonb,text) to authenticated;

-- RLS visibility is not authority to change accounting directly. Definer
-- invoice/credit/payment commands and trusted server writes retain authority.
create function lesson_ops.guard_direct_lesson_financial_write() returns trigger
language plpgsql set search_path='' as $$begin
 if current_user in ('anon','authenticated') and ((tg_op='INSERT' and (coalesce(new.paid_minor,0)<>0 or new.payment_status in ('paid','partially_paid','paid_by_credit','refunded','waived'))) or (tg_op='UPDATE' and (new.payment_status,new.paid_minor,new.price_minor,new.package_id,new.invoice_id) is distinct from (old.payment_status,old.paid_minor,old.price_minor,old.package_id,old.invoice_id))) then raise exception 'REVIEW_REQUIRED: Use the authoritative payment, invoice or credit command.';end if;
 return new;
end $$;
revoke all on function lesson_ops.guard_direct_lesson_financial_write() from public,anon,authenticated,service_role;
create trigger guard_direct_lesson_financial_write before insert or update on public.lessons for each row execute function lesson_ops.guard_direct_lesson_financial_write();
