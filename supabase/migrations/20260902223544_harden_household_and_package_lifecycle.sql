-- Keep linked-contact display settings and the authorization rows in sync in
-- the same transaction. Disabling a contact revokes all portal/RLS access.
create or replace function public.sync_linked_contact_authorization()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.user_id is null then
    return new;
  end if;

  if not new.portal_enabled then
    delete from public.student_relationships
    where linked_contact_id = new.id
       or (student_id = new.student_id and user_id = new.user_id);

    delete from public.portal_accounts
    where linked_contact_id = new.id
       or (
         student_id = new.student_id
         and user_id = new.user_id
         and account_type = 'guardian'
       );
    return new;
  end if;

  insert into public.student_relationships (
    student_id,
    user_id,
    relationship,
    linked_contact_id,
    can_view_schedule,
    can_manage_lessons,
    can_view_work,
    can_view_finance,
    can_manage_profile
  )
  values (
    new.student_id,
    new.user_id,
    new.relationship_type,
    new.id,
    new.can_view_schedule,
    new.can_manage_lessons,
    new.can_view_work,
    new.can_view_finance,
    new.can_manage_profile
  )
  on conflict (student_id, user_id) do update
  set relationship = excluded.relationship,
      linked_contact_id = excluded.linked_contact_id,
      can_view_schedule = excluded.can_view_schedule,
      can_manage_lessons = excluded.can_manage_lessons,
      can_view_work = excluded.can_view_work,
      can_view_finance = excluded.can_view_finance,
      can_manage_profile = excluded.can_manage_profile;

  update public.portal_accounts
  set linked_contact_id = new.id,
      email = new.email,
      updated_at = now()
  where student_id = new.student_id
    and user_id = new.user_id
    and account_type = 'guardian';

  return new;
end
$$;

revoke all on function public.sync_linked_contact_authorization()
  from public, anon, authenticated;

drop trigger if exists linked_contact_authorization_sync
  on public.linked_contacts;
create trigger linked_contact_authorization_sync
after insert or update of
  user_id,
  email,
  relationship_type,
  portal_enabled,
  can_view_schedule,
  can_manage_lessons,
  can_view_work,
  can_view_finance,
  can_manage_profile
on public.linked_contacts
for each row
execute function public.sync_linked_contact_authorization();

alter table public.package_subscriptions
  add column if not exists renewal_in_flight boolean not null default false,
  add column if not exists renewal_attempt_key text,
  add column if not exists renewal_claimed_at timestamptz;

create index if not exists package_subscriptions_balance_renewal_due_idx
  on public.package_subscriptions(next_billing_at, id)
  where renewal_mode = 'balance_threshold'
    and status = 'active'
    and renewal_in_flight = false;

create or replace function public.claim_package_auto_renewals(
  batch_size integer default 10
)
returns setof public.package_subscriptions
language plpgsql
security definer
set search_path = ''
as $$
begin
  return query
  with due as (
    select ps.id
    from public.package_subscriptions ps
    join public.packages p on p.id = ps.package_id
    where ps.renewal_mode = 'balance_threshold'
      and ps.status = 'active'
      and ps.renewal_in_flight = false
      and ps.stripe_customer_id is not null
      and coalesce(ps.next_billing_at, now()) <= now()
      and public.package_credit_balance(p.id) <= coalesce(ps.balance_threshold, 1)
    order by coalesce(ps.next_billing_at, ps.created_at), ps.id
    for update of ps skip locked
    limit batch_size
  )
  update public.package_subscriptions ps
  set renewal_in_flight = true,
      renewal_claimed_at = now(),
      renewal_attempt_key = coalesce(
        ps.renewal_attempt_key,
        gen_random_uuid()::text
      ),
      updated_at = now()
  from due
  where ps.id = due.id
  returning ps.*;
end
$$;

revoke all on function public.claim_package_auto_renewals(integer)
  from public, anon, authenticated;
grant execute on function public.claim_package_auto_renewals(integer)
  to service_role;

-- Gifts cannot be claimed before the purchaser-selected delivery time, even if
-- a claim URL is shared early.
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
    definition.price_minor,
    definition.currency,
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
