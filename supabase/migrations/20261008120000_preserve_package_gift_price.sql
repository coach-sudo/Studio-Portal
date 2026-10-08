-- Preserve the existing claim API, tables, access checks, credits, and idempotency.
create or replace function public.claim_package_gift(
  target_gift uuid,
  target_student uuid,
  apply_automatically boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  gift public.package_gifts;
  definition public.package_definitions;
  created_package public.packages;
  paid_price bigint;
  paid_currency text;
begin
  select * into gift
  from public.package_gifts
  where id = target_gift
  for update;

  if not found then raise exception 'GIFT_NOT_FOUND'; end if;
  if gift.status = 'claimed' then
    if gift.claimed_student_id <> target_student then
      raise exception 'GIFT_ALREADY_CLAIMED';
    end if;
    return jsonb_build_object('packageId', gift.package_id, 'duplicate', true);
  end if;
  if gift.status not in ('purchased', 'delivered')
     or gift.expires_at <= now()
     or (gift.deliver_at is not null and gift.deliver_at > now()) then
    raise exception 'GIFT_NOT_AVAILABLE';
  end if;

  select * into definition
  from public.package_definitions
  where id = gift.definition_id;

  -- Signed webhook receipts retain the quote even when the catalog changes before delivery.
  select
    coalesce((payload #>> '{data,object,metadata,package_price_minor}')::bigint,
             (payload #>> '{data,object,amount_total}')::bigint),
    upper(coalesce(payload #>> '{data,object,metadata,package_currency}',
                   payload #>> '{data,object,currency}'))
  into paid_price, paid_currency
  from public.webhook_events
  where provider = 'stripe'
    and event_type in ('checkout.session.completed', 'checkout.session.async_payment_succeeded')
    and payload #>> '{data,object,metadata,package_gift_id}' = gift.id::text
    and payload #>> '{data,object,id}' = gift.stripe_checkout_session_id
    and payload #>> '{data,object,payment_status}' = 'paid'
  limit 1;

  insert into public.packages (
    student_id,
    name,
    price_minor,
    currency,
    expires_at,
    credit_quantity,
    definition_id,
    auto_apply
  )
  values (
    target_student,
    'Gift · ' || definition.name,
    coalesce(paid_price, definition.price_minor),
    coalesce(paid_currency, definition.currency),
    case
      when definition.expiration_days is null then null
      else now() + make_interval(days => definition.expiration_days)
    end,
    definition.session_count,
    definition.id,
    apply_automatically
  )
  returning * into created_package;

  insert into public.package_credit_entries (
    package_id,
    kind,
    quantity,
    reason,
    idempotency_key
  )
  values (
    created_package.id,
    'purchase',
    definition.session_count,
    'Package gift',
    'package-gift:' || gift.id::text || ':delivery'
  );

  update public.package_gifts
  set package_id = created_package.id,
      claimed_student_id = target_student,
      status = 'claimed',
      updated_at = now()
  where id = gift.id;

  return jsonb_build_object('packageId', created_package.id, 'duplicate', false);
end
$$;

revoke all on function public.claim_package_gift(uuid, uuid, boolean)
  from public, anon, authenticated;
grant execute on function public.claim_package_gift(uuid, uuid, boolean)
  to service_role;
