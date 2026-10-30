-- Invoice identity, not transport event identity, fences the financial effect.
create table workspace_internal.financial_command_cutovers (
 name text primary key, started_at timestamptz not null default now()
);
insert into workspace_internal.financial_command_cutovers(name) values('booking_installments');
create table workspace_internal.stripe_booking_invoice_receipts (
 invoice_id text primary key, booking_id uuid not null references public.bookings(id) on delete restrict,
 request_hash text not null, result jsonb not null, created_at timestamptz not null default now()
);
create table workspace_internal.stripe_booking_invoice_effects (
 invoice_id text primary key references workspace_internal.stripe_booking_invoice_receipts(invoice_id) on delete restrict,
 subscription_id text not null, customer_id text, currency text not null,
 rounding_minor bigint not null check(rounding_minor>=0), rounding_reference text,
 cancel_required boolean not null, cancel_done boolean not null default false,
 notify_booking uuid references public.bookings(id) on delete restrict, manage_token text,
 notify_done boolean not null default false,
 status text not null default 'pending' check(status in ('pending','processing','completed','review_required')),
 claim_token uuid, lease_until timestamptz, attempts integer not null default 0,
 first_attempt_at timestamptz, last_attempt_at timestamptz, completed_at timestamptz,
 failure_category text check(failure_category in ('provider','notification','unknown_outcome'))
);
alter table workspace_internal.financial_command_cutovers enable row level security;
alter table workspace_internal.stripe_booking_invoice_receipts enable row level security;
alter table workspace_internal.stripe_booking_invoice_effects enable row level security;
revoke all on workspace_internal.financial_command_cutovers,workspace_internal.stripe_booking_invoice_receipts,workspace_internal.stripe_booking_invoice_effects from public,anon,authenticated,service_role;
create index stripe_legacy_invoice_identity on public.webhook_events ((payload#>>'{data,object,id}'),received_at) where provider='stripe' and event_type='invoice.paid';

create function public.settle_stripe_booking_invoice(p_value jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare invoice text:=p_value->>'invoiceId'; subscription text:=p_value->>'subscriptionId';
 amount bigint:=(p_value->>'amountMinor')::bigint; currency text:=upper(p_value->>'currency');
 target uuid:=(p_value->>'bookingId')::uuid; b public.bookings; prior workspace_internal.stripe_booking_invoice_receipts;
 request_hash text:=encode(extensions.digest(p_value::text,'sha256'),'hex'); result jsonb; initial boolean; confirmed jsonb; count_paid integer; audit_id uuid;
begin
 if invoice is null or invoice !~ '^in_[A-Za-z0-9_]+$' or subscription is null or subscription !~ '^sub_[A-Za-z0-9_]+$' or amount is null or amount<0 or currency is null or currency !~ '^[A-Z]{3}$' or jsonb_typeof(p_value) is distinct from 'object' or length(p_value::text)>10000 then raise exception 'VALIDATION_FAILED'; end if;
 perform pg_advisory_xact_lock(hashtextextended('stripe-booking-invoice:'||invoice,0));
 select * into prior from workspace_internal.stripe_booking_invoice_receipts where invoice_id=invoice;
 if found then
  if prior.request_hash<>request_hash then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
  return prior.result;
 end if;
 -- A pre-cutover partial write cannot be inferred/repaired safely from a retry.
 if exists(select 1 from public.payment_entries where external_reference=invoice)
 or exists(select 1 from public.webhook_events e where e.provider='stripe' and e.event_type='invoice.paid' and e.payload#>>'{data,object,id}'=invoice and e.received_at<(select started_at from workspace_internal.financial_command_cutovers where name='booking_installments')) then
  raise exception 'REVIEW_REQUIRED: Legacy invoice requires reconciled booking and ledger evidence.';
 end if;
 select * into b from public.bookings where id=target;
 if b.id is null or b.payment_policy<>'installments' or upper(b.currency)<>currency or b.installment_count is null then raise exception 'VALIDATION_FAILED: Invoice does not match the booking agreement.'; end if;
 perform pg_advisory_xact_lock(hashtext(b.studio_id::text));
 select * into b from public.bookings where id=target;
 if b.stripe_subscription_id is distinct from subscription and not(b.stripe_subscription_id is null and b.installments_paid=0 and b.paid_minor=0) then raise exception 'VALIDATION_FAILED: Invoice subscription does not match the booking.'; end if;
 if amount=0 then raise exception 'REVIEW_REQUIRED: Zero-value installment needs agreement review.'; end if;
 if b.stripe_customer_id is not null and b.stripe_customer_id is distinct from nullif(p_value->>'customerId','') then raise exception 'VALIDATION_FAILED: Invoice customer does not match the booking.'; end if;
 if b.student_id is not null then perform 1 from public.students where id=b.student_id for update; end if;
 -- Initial confirmation stays inside this transaction and retains its existing policy.
 initial:=b.status in ('held','pending_payment');
 if initial then
  if nullif(p_value->>'holdId','') is null then raise exception 'REVIEW_REQUIRED: Initial payment needs the original hold.'; end if;
  if not exists(select 1 from public.booking_holds h where h.id=(p_value->>'holdId')::uuid and h.id=any(b.hold_ids) and h.studio_id=b.studio_id and h.service_id=b.service_id and h.starts_at=b.starts_at and h.ends_at=b.ends_at) then raise exception 'REVIEW_REQUIRED: Initial payment needs the original matching hold.'; end if;
  confirmed:=public.confirm_booking(b.id,(p_value->>'holdId')::uuid,amount,invoice);
 end if;
 select * into b from public.bookings where id=target for update;
 if b.student_id is null or b.status not in ('confirmed','needs_attention') then raise exception 'REVIEW_REQUIRED: Payment needs review against the existing booking state.'; end if;
 count_paid:=b.installments_paid+1;
 if not initial and amount>0 then
  insert into public.payment_entries(student_id,kind,amount_minor,currency,external_reference,reason)
   values(b.student_id,'payment',amount,currency,invoice,'Booking installment');
 end if;
 update public.bookings set paid_minor=case when initial then paid_minor else paid_minor+amount end,
  installments_paid=count_paid,payment_status=case when count_paid>=installment_count then 'paid' else 'partially_paid' end,
  status='confirmed',stripe_subscription_id=subscription,stripe_customer_id=coalesce(stripe_customer_id,nullif(p_value->>'customerId','')),version=version+1,updated_at=now() where id=b.id returning * into b;
 if b.series_id is not null then
  update public.recurring_series set stripe_subscription_id=subscription where id=b.series_id and stripe_subscription_id is null;
 end if;
 insert into public.audit_events(studio_id,action,entity_type,entity_id,reason,correlation_id,source,after_state)
 values(b.studio_id,'booking.installment_settled','booking',b.id,'Signed Stripe invoice settled once',invoice,'stripe_webhook',jsonb_build_object('invoiceId',invoice,'amountMinor',amount,'paidMinor',b.paid_minor,'installmentsPaid',count_paid,'initialConfirmation',initial)) returning id into audit_id;
 result:=jsonb_build_object('bookingId',b.id,'invoiceId',invoice,'paidMinor',b.paid_minor,'installmentsPaid',count_paid,'auditEventId',audit_id);
 insert into workspace_internal.stripe_booking_invoice_receipts(invoice_id,booking_id,request_hash,result) values(invoice,b.id,request_hash,result);
 insert into workspace_internal.stripe_booking_invoice_effects(invoice_id,subscription_id,customer_id,currency,rounding_minor,cancel_required,notify_booking,manage_token,notify_done,cancel_done)
 values(invoice,subscription,nullif(p_value->>'customerId',''),currency,
  case when count_paid=b.installment_count-1 then b.installment_remainder_minor else 0 end,
  count_paid>=b.installment_count,case when initial then b.id end,case when initial then nullif(p_value->>'manageToken','') end,not initial,count_paid<b.installment_count);
 return result;
end $$;
revoke all on function public.settle_stripe_booking_invoice(jsonb) from public,anon,authenticated;
grant execute on function public.settle_stripe_booking_invoice(jsonb) to service_role;

create function public.claim_stripe_booking_invoice_effect(p_invoice text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare e workspace_internal.stripe_booking_invoice_effects;
begin
 select * into e from workspace_internal.stripe_booking_invoice_effects where invoice_id=p_invoice for update;
 if not found then raise exception 'NOT_FOUND'; end if;
 if (e.rounding_minor=0 or e.rounding_reference is not null) and e.cancel_done and e.notify_done then
  update workspace_internal.stripe_booking_invoice_effects set status='completed',completed_at=coalesce(completed_at,now()),claim_token=null,lease_until=null where invoice_id=p_invoice;
  return jsonb_build_object('status','completed');
 end if;
 if e.status in ('completed','review_required') then return jsonb_build_object('status',e.status); end if;
 if e.status='processing' and e.lease_until>now() then return jsonb_build_object('status','running'); end if;
 update workspace_internal.stripe_booking_invoice_effects set status='processing',claim_token=gen_random_uuid(),lease_until=now()+interval '5 minutes',attempts=attempts+1,first_attempt_at=coalesce(first_attempt_at,now()),last_attempt_at=now(),failure_category=null where invoice_id=p_invoice returning * into e;
 return to_jsonb(e);
end $$;
create function public.finish_stripe_booking_invoice_effect(p_invoice text,p_token uuid,p_step text,p_reference text default null) returns boolean
language plpgsql security definer set search_path='' as $$
declare e workspace_internal.stripe_booking_invoice_effects;
begin
 select * into e from workspace_internal.stripe_booking_invoice_effects where invoice_id=p_invoice for update;
 if not found or e.status<>'processing' or e.claim_token is distinct from p_token or e.lease_until<=now() then return false; end if;
 if p_step='rounding' and nullif(p_reference,'') is not null then update workspace_internal.stripe_booking_invoice_effects set rounding_reference=p_reference where invoice_id=p_invoice;
 elsif p_step='cancel' then update workspace_internal.stripe_booking_invoice_effects set cancel_done=true where invoice_id=p_invoice;
 elsif p_step='notify' then update workspace_internal.stripe_booking_invoice_effects set notify_done=true,manage_token=null where invoice_id=p_invoice;
 elsif p_step in ('provider','notification','unknown_outcome') then
  update workspace_internal.stripe_booking_invoice_effects set status=case when p_step='unknown_outcome' then 'review_required' else 'pending' end,failure_category=p_step,claim_token=null,lease_until=null where invoice_id=p_invoice;
  return true;
 else raise exception 'VALIDATION_FAILED'; end if;
 update workspace_internal.stripe_booking_invoice_effects set status='completed',completed_at=now(),claim_token=null,lease_until=null
 where invoice_id=p_invoice and (rounding_minor=0 or rounding_reference is not null) and cancel_done and notify_done;
 return true;
end $$;
revoke all on function public.claim_stripe_booking_invoice_effect(text),public.finish_stripe_booking_invoice_effect(text,uuid,text,text) from public,anon,authenticated;
grant execute on function public.claim_stripe_booking_invoice_effect(text),public.finish_stripe_booking_invoice_effect(text,uuid,text,text) to service_role;
