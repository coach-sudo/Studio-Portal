-- Additive package billing, household access, notification, and profile-photo
-- structures. Existing package and guardian fields remain available during the
-- compatibility period and no historical records are removed.

alter table public.package_definitions
  add column if not exists pricing_service_id uuid references public.booking_services(id) on delete set null,
  add column if not exists pricing_service_version integer,
  add column if not exists base_price_minor bigint check(base_price_minor is null or base_price_minor >= 0),
  add column if not exists discount_type text not null default 'fixed' check(discount_type in ('none','fixed','percent')),
  add column if not exists discount_basis_points integer not null default 0 check(discount_basis_points between 0 and 10000),
  add column if not exists delivery_format text check(delivery_format in ('google_meet','in_person')),
  add column if not exists giftable boolean not null default false,
  add column if not exists pricing_status text not null default 'legacy' check(pricing_status in ('current','changed','syncing','failed','legacy'));

create table if not exists public.package_billing_options (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios(id) on delete cascade,
  definition_id uuid not null references public.package_definitions(id) on delete cascade,
  renewal_mode text not null check(renewal_mode in ('one_time','weekly','biweekly','monthly','balance_threshold')),
  balance_threshold integer check(balance_threshold is null or balance_threshold >= 0),
  stripe_price_id text unique,
  active boolean not null default true,
  version integer not null default 1 check(version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(definition_id,renewal_mode)
);

create table if not exists public.package_subscriptions (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  definition_id uuid not null references public.package_definitions(id) on delete restrict,
  billing_option_id uuid not null references public.package_billing_options(id) on delete restrict,
  package_id uuid references public.packages(id) on delete set null,
  stripe_customer_id text,
  stripe_subscription_id text unique,
  renewal_mode text not null check(renewal_mode in ('weekly','biweekly','monthly','balance_threshold')),
  balance_threshold integer,
  auto_apply boolean not null default false,
  status text not null default 'pending' check(status in ('pending','active','past_due','paused','cancel_at_period_end','cancelled')),
  next_billing_at timestamptz,
  last_invoice_id text,
  accepted_at timestamptz not null default now(),
  version integer not null default 1 check(version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.package_gifts (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios(id) on delete cascade,
  definition_id uuid not null references public.package_definitions(id) on delete restrict,
  purchaser_user_id uuid references auth.users(id) on delete set null,
  purchaser_name text not null,
  purchaser_email text not null,
  recipient_name text not null,
  recipient_email text not null,
  message text not null default '',
  deliver_at timestamptz,
  claim_token_hash text not null unique,
  stripe_checkout_session_id text unique,
  package_id uuid references public.packages(id) on delete set null,
  claimed_student_id uuid references public.students(id) on delete set null,
  status text not null default 'pending_payment' check(status in ('pending_payment','purchased','delivered','claimed','expired','refunded')),
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.linked_contacts (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  full_name text not null,
  email text not null,
  relationship_type text not null default 'support_person' check(relationship_type in ('guardian','support_person','other')),
  relationship_label text not null default '',
  can_view_schedule boolean not null default true,
  can_manage_lessons boolean not null default false,
  can_view_work boolean not null default true,
  can_manage_profile boolean not null default false,
  can_view_finance boolean not null default false,
  can_receive_notifications boolean not null default true,
  notification_preferences jsonb not null default '{"lessonReminders":true,"scheduleChanges":true,"lessonContent":true,"assignments":true,"packageBalance":true,"payments":true,"accountAccess":true}'::jsonb,
  portal_enabled boolean not null default true,
  version integer not null default 1 check(version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists linked_contacts_student_email_unique
  on public.linked_contacts(student_id,lower(email));
create index if not exists linked_contacts_user_idx on public.linked_contacts(user_id) where user_id is not null;
create index if not exists package_billing_options_definition_idx on public.package_billing_options(definition_id,active);
create index if not exists package_subscriptions_student_status_idx on public.package_subscriptions(student_id,status);
create index if not exists package_gifts_recipient_status_idx on public.package_gifts(lower(recipient_email),status);

alter table public.student_relationships
  add column if not exists linked_contact_id uuid references public.linked_contacts(id) on delete set null,
  add column if not exists can_view_schedule boolean not null default true,
  add column if not exists can_manage_lessons boolean not null default false,
  add column if not exists can_view_work boolean not null default true;

alter table public.students
  add column if not exists notification_preferences jsonb not null default '{"lessonReminders":true,"scheduleChanges":true,"lessonContent":true,"assignments":true,"packageBalance":false,"payments":false,"accountAccess":true}'::jsonb,
  add column if not exists profile_photo_asset_id uuid references public.file_assets(id) on delete set null,
  add column if not exists profile_photo_position jsonb not null default '{"x":50,"y":50}'::jsonb;

alter table public.memberships
  add column if not exists profile_photo_asset_id uuid references public.file_assets(id) on delete set null,
  add column if not exists profile_photo_position jsonb not null default '{"x":50,"y":50}'::jsonb;

alter table public.outbox_messages
  add column if not exists priority smallint not null default 50 check(priority between 0 and 100);

-- Portal accounts continue to use the existing guardian account role for linked
-- adults, while the linked contact carries the human-facing relationship label.
-- Replace the former one-guardian-per-student constraint with one student account
-- plus any number of linked-contact accounts.
alter table public.portal_accounts
  add column if not exists linked_contact_id uuid references public.linked_contacts(id) on delete cascade;
alter table public.portal_accounts drop constraint if exists portal_accounts_student_id_account_type_key;
alter table public.portal_accounts drop constraint if exists portal_accounts_user_id_student_id_account_type_key;
create unique index if not exists portal_accounts_student_account_unique
  on public.portal_accounts(student_id) where account_type='student';
create unique index if not exists portal_accounts_linked_contact_unique
  on public.portal_accounts(linked_contact_id) where linked_contact_id is not null;

-- Preserve existing guardian contacts while making the new linked-contact model
-- authoritative for future access and notification preferences.
insert into public.linked_contacts(
  studio_id,student_id,user_id,full_name,email,relationship_type,
  can_view_schedule,can_manage_lessons,can_view_work,can_manage_profile,
  can_view_finance,can_receive_notifications
)
select s.studio_id,s.id,r.user_id,coalesce(nullif(s.guardian_name,''),'Guardian'),s.guardian_email,
       case when s.is_minor then 'guardian' else 'support_person' end,
       true,true,true,true,true,true
from public.students s
left join lateral (
  select sr.user_id from public.student_relationships sr
  where sr.student_id=s.id and sr.relationship='guardian'
  order by sr.created_at limit 1
) r on true
where nullif(s.guardian_email,'') is not null
on conflict do nothing;

update public.portal_accounts pa
set linked_contact_id=lc.id
from public.linked_contacts lc
where pa.account_type='guardian'
  and pa.student_id=lc.student_id
  and lower(pa.email)=lower(lc.email)
  and pa.linked_contact_id is null;

update public.student_relationships sr
set linked_contact_id=lc.id,
    can_view_schedule=lc.can_view_schedule,
    can_manage_lessons=lc.can_manage_lessons,
    can_view_work=lc.can_view_work
from public.linked_contacts lc
where sr.student_id=lc.student_id and sr.user_id=lc.user_id and sr.linked_contact_id is null;

alter table public.package_billing_options enable row level security;
alter table public.package_subscriptions enable row level security;
alter table public.package_gifts enable row level security;
alter table public.linked_contacts enable row level security;

create policy package_billing_options_access on public.package_billing_options for select to authenticated
  using(public.is_studio_coach(studio_id) or exists(
    select 1 from public.package_definitions d
    where d.id=definition_id and d.active and d.visibility='public'
  ));
create policy package_billing_options_coach on public.package_billing_options for all to authenticated
  using(public.is_studio_coach(studio_id)) with check(public.is_studio_coach(studio_id));

create policy package_subscriptions_access on public.package_subscriptions for select to authenticated
  using(public.is_studio_coach(studio_id) or public.can_access_student(student_id));
create policy package_subscriptions_coach on public.package_subscriptions for all to authenticated
  using(public.is_studio_coach(studio_id)) with check(public.is_studio_coach(studio_id));

create policy package_gifts_coach on public.package_gifts for select to authenticated
  using(public.is_studio_coach(studio_id));
create policy package_gifts_purchaser on public.package_gifts for select to authenticated
  using(purchaser_user_id=(select auth.uid()));

create policy linked_contacts_access on public.linked_contacts for select to authenticated
  using(public.is_studio_coach(studio_id) or user_id=(select auth.uid()) or exists(
    select 1 from public.students s where s.id=student_id and s.user_id=(select auth.uid())
  ));

create or replace function public.can_view_student_schedule(target_student uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.students s where s.id=target_student and (
    s.user_id=(select auth.uid()) or public.is_studio_coach(s.studio_id) or exists(
      select 1 from public.student_relationships r where r.student_id=s.id and r.user_id=(select auth.uid()) and r.can_view_schedule
    )
  ))
$$;
create or replace function public.can_view_student_work(target_student uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.students s where s.id=target_student and (
    s.user_id=(select auth.uid()) or public.is_studio_coach(s.studio_id) or exists(
      select 1 from public.student_relationships r where r.student_id=s.id and r.user_id=(select auth.uid()) and r.can_view_work
    )
  ))
$$;
create or replace function public.can_manage_student_profile(target_student uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.students s where s.id=target_student and (
    s.user_id=(select auth.uid()) or public.is_studio_coach(s.studio_id) or exists(
      select 1 from public.student_relationships r where r.student_id=s.id and r.user_id=(select auth.uid()) and r.can_manage_profile
    )
  ))
$$;
create or replace function public.can_manage_student_lessons(target_student uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.students s where s.id=target_student and (
    s.user_id=(select auth.uid()) or public.is_studio_coach(s.studio_id) or exists(
      select 1 from public.student_relationships r where r.student_id=s.id and r.user_id=(select auth.uid()) and r.can_manage_lessons
    )
  ))
$$;
grant execute on function public.can_view_student_schedule(uuid),public.can_view_student_work(uuid),public.can_manage_student_profile(uuid),public.can_manage_student_lessons(uuid) to authenticated;

drop policy if exists lessons_access on public.lessons;
create policy lessons_access on public.lessons for select to authenticated using(
  public.is_studio_coach(studio_id) or public.can_view_student_schedule(student_id) or exists(
    select 1 from public.lesson_participants lp where lp.lesson_id=id and lp.student_id is not null and public.can_view_student_schedule(lp.student_id)
  )
);
drop policy if exists bookings_access on public.bookings;
create policy bookings_access on public.bookings for select to authenticated using(public.is_studio_coach(studio_id) or (student_id is not null and public.can_view_student_schedule(student_id)));
drop policy if exists notes_visible on public.notes;
create policy notes_visible on public.notes for select to authenticated using(public.can_view_student_work(student_id) and (status='published' or exists(select 1 from public.students s where s.id=student_id and public.is_studio_coach(s.studio_id))));
drop policy if exists assignments_access on public.assignments;
create policy assignments_access on public.assignments for select to authenticated using(public.can_view_student_work(student_id));
drop policy if exists assignments_student_update on public.assignments;
create policy assignments_student_update on public.assignments for update to authenticated using(exists(select 1 from public.students s where s.id=student_id and s.user_id=(select auth.uid()))) with check(exists(select 1 from public.students s where s.id=student_id and s.user_id=(select auth.uid())));
drop policy if exists materials_access on public.materials;
create policy materials_access on public.materials for select to authenticated using(owner_student_id is not null and public.can_view_student_work(owner_student_id));
drop policy if exists material_links_access on public.material_links;
create policy material_links_access on public.material_links for select to authenticated using((student_id is not null and public.can_view_student_work(student_id)) or exists(select 1 from public.lessons l where l.id=lesson_id and public.can_view_student_work(l.student_id)));
drop policy if exists actor_profiles_access on public.actor_profiles;
create policy actor_profiles_access on public.actor_profiles for select to authenticated using(public.can_manage_student_profile(student_id) or exists(select 1 from public.students s where s.id=student_id and s.user_id=(select auth.uid())));
drop policy if exists actor_profiles_related_write on public.actor_profiles;
create policy actor_profiles_related_write on public.actor_profiles for update to authenticated using(public.can_manage_student_profile(student_id)) with check(public.can_manage_student_profile(student_id));

revoke all on public.package_billing_options,public.package_subscriptions,public.package_gifts,public.linked_contacts from anon;
grant select on public.package_billing_options,public.package_subscriptions,public.linked_contacts to authenticated;
grant select on public.package_gifts to authenticated;
grant all on public.package_billing_options,public.package_subscriptions,public.package_gifts,public.linked_contacts to service_role;

comment on table public.package_billing_options is 'Allowed one-time and recurring purchase modes for a calculated package definition.';
comment on table public.package_subscriptions is 'Package-credit renewals, intentionally separate from recurring lesson series subscriptions.';
comment on table public.linked_contacts is 'Pre-invite and active household contacts with granular portal and notification permissions.';

create or replace function public.claim_package_gift(target_gift uuid,target_student uuid,apply_automatically boolean default false)
returns jsonb language plpgsql security definer set search_path='' as $$
declare gift public.package_gifts; definition public.package_definitions; created_package public.packages;
begin
  select * into gift from public.package_gifts where id=target_gift for update;
  if not found then raise exception 'GIFT_NOT_FOUND'; end if;
  if gift.status='claimed' then
    if gift.claimed_student_id<>target_student then raise exception 'GIFT_ALREADY_CLAIMED'; end if;
    return jsonb_build_object('packageId',gift.package_id,'duplicate',true);
  end if;
  if gift.status not in ('purchased','delivered') or gift.expires_at<=now() then raise exception 'GIFT_NOT_AVAILABLE'; end if;
  select * into definition from public.package_definitions where id=gift.definition_id;
  insert into public.packages(student_id,name,price_minor,currency,expires_at,credit_quantity,definition_id,auto_apply)
  values(target_student,'Gift · '||definition.name,definition.price_minor,definition.currency,
    case when definition.expiration_days is null then null else now()+make_interval(days=>definition.expiration_days) end,
    definition.session_count,definition.id,apply_automatically)
  returning * into created_package;
  insert into public.package_credit_entries(package_id,kind,quantity,reason,idempotency_key)
  values(created_package.id,'purchase',definition.session_count,'Package gift','package-gift:'||gift.id::text||':delivery');
  update public.package_gifts set package_id=created_package.id,claimed_student_id=target_student,status='claimed',updated_at=now() where id=gift.id;
  return jsonb_build_object('packageId',created_package.id,'duplicate',false);
end $$;
revoke all on function public.claim_package_gift(uuid,uuid,boolean) from public,anon,authenticated;
grant execute on function public.claim_package_gift(uuid,uuid,boolean) to service_role;

create or replace function public.refund_package_gift(target_gift uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare gift public.package_gifts; balance integer:=0;
begin
  select * into gift from public.package_gifts where id=target_gift for update;
  if not found then raise exception 'GIFT_NOT_FOUND'; end if;
  if gift.status='refunded' then return jsonb_build_object('duplicate',true); end if;
  if gift.package_id is not null then
    select coalesce(sum(quantity),0)::integer into balance from public.package_credit_entries where package_id=gift.package_id;
    if balance>0 then insert into public.package_credit_entries(package_id,kind,quantity,reason,idempotency_key)
      values(gift.package_id,'expiration',-balance,'Package gift refunded','package-gift:'||gift.id::text||':refund')
      on conflict(idempotency_key) do nothing; end if;
  end if;
  update public.package_gifts set status='refunded',updated_at=now() where id=gift.id;
  return jsonb_build_object('duplicate',false,'creditsReversed',greatest(balance,0));
end $$;
revoke all on function public.refund_package_gift(uuid) from public,anon,authenticated;
grant execute on function public.refund_package_gift(uuid) to service_role;

create or replace function public.claim_package_auto_renewals(batch_size integer default 10)
returns setof public.package_subscriptions
language plpgsql security definer set search_path=''
as $$
begin
  return query
  with due as (
    select ps.id
    from public.package_subscriptions ps
    join public.packages p on p.id=ps.package_id
    where ps.renewal_mode='balance_threshold'
      and ps.status='active'
      and ps.stripe_customer_id is not null
      and coalesce(ps.next_billing_at,now())<=now()
      and public.package_credit_balance(p.id)<=coalesce(ps.balance_threshold,1)
    order by coalesce(ps.next_billing_at,ps.created_at),ps.id
    for update of ps skip locked
    limit batch_size
  )
  update public.package_subscriptions ps
     set next_billing_at=now()+interval '15 minutes',updated_at=now()
  from due where ps.id=due.id
  returning ps.*;
end $$;

revoke all on function public.claim_package_auto_renewals(integer) from public,anon,authenticated;
grant execute on function public.claim_package_auto_renewals(integer) to service_role;

create or replace function public.claim_booking_reminders(batch_size integer default 50)
returns setof public.outbox_messages
language plpgsql security definer set search_path=''
as $$
begin
  return query
  with claimed as (
    select id from public.outbox_messages
    where status in ('approved','queued','failed')
      and send_at<=now() and coalesce(next_attempt_at,now())<=now()
    order by priority desc,send_at,id
    for update skip locked limit batch_size
  )
  update public.outbox_messages o
     set status='sending',attempts=attempts+1,updated_at=now()
  from claimed where o.id=claimed.id returning o.*;
end $$;

revoke all on function public.claim_booking_reminders(integer) from public,anon,authenticated;
grant execute on function public.claim_booking_reminders(integer) to service_role;
