-- Cohesive portal operations: discounts, collaborative lesson boards, and
-- explicit provider verification metadata. All changes are additive.

create table if not exists public.discount_codes (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios(id) on delete cascade,
  code text not null,
  description text not null default '',
  discount_type text not null check (discount_type in ('percent','fixed')),
  amount integer not null check (amount > 0),
  currency text not null default 'USD' check (char_length(currency)=3),
  service_ids uuid[] not null default '{}',
  active boolean not null default true,
  starts_at timestamptz,
  ends_at timestamptz,
  max_redemptions integer check (max_redemptions is null or max_redemptions > 0),
  redemption_count integer not null default 0 check (redemption_count >= 0),
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (studio_id, code)
);
create index if not exists discount_codes_studio_active_idx on public.discount_codes(studio_id,active,ends_at);
alter table public.discount_codes enable row level security;
drop policy if exists discount_codes_coach on public.discount_codes;
create policy discount_codes_coach on public.discount_codes for all to authenticated
  using (public.is_studio_coach(studio_id)) with check (public.is_studio_coach(studio_id));
revoke all on public.discount_codes from anon;
grant select,insert,update,delete on public.discount_codes to authenticated;
grant all on public.discount_codes to service_role;

alter table public.bookings
  add column if not exists discount_code_id uuid references public.discount_codes(id) on delete set null,
  add column if not exists discount_minor bigint not null default 0 check (discount_minor >= 0);

create table if not exists public.discount_redemptions (
  id uuid primary key default gen_random_uuid(),
  discount_code_id uuid not null references public.discount_codes(id) on delete restrict,
  booking_id uuid not null unique references public.bookings(id) on delete cascade,
  amount_minor bigint not null check (amount_minor >= 0),
  created_at timestamptz not null default now()
);
alter table public.discount_redemptions enable row level security;
drop policy if exists discount_redemptions_coach on public.discount_redemptions;
create policy discount_redemptions_coach on public.discount_redemptions for select to authenticated
  using (exists(select 1 from public.discount_codes d where d.id=discount_code_id and public.is_studio_coach(d.studio_id)));
revoke all on public.discount_redemptions from anon;
grant select on public.discount_redemptions to authenticated;
grant all on public.discount_redemptions to service_role;

create or replace function public.claim_booking_discount(target_studio uuid,target_service uuid,target_code text,target_subtotal bigint)
returns table(code_id uuid,discount_minor bigint)
language plpgsql security definer set search_path=''
as $$
declare d public.discount_codes; calculated bigint;
begin
  select * into d from public.discount_codes
  where studio_id=target_studio and upper(code)=upper(trim(target_code)) for update;
  if d.id is null or not d.active or (d.starts_at is not null and d.starts_at>now()) or (d.ends_at is not null and d.ends_at<now())
    or (cardinality(d.service_ids)>0 and not target_service=any(d.service_ids))
    or (d.max_redemptions is not null and d.redemption_count>=d.max_redemptions) then
    raise exception 'DISCOUNT_INVALID';
  end if;
  calculated:=case when d.discount_type='percent' then round(target_subtotal*d.amount/100.0)::bigint else d.amount::bigint end;
  calculated:=greatest(0,least(target_subtotal,calculated));
  update public.discount_codes set redemption_count=redemption_count+1,version=version+1,updated_at=now() where id=d.id;
  return query select d.id,calculated;
end $$;
revoke all on function public.claim_booking_discount(uuid,uuid,text,bigint) from public,anon,authenticated;
grant execute on function public.claim_booking_discount(uuid,uuid,text,bigint) to service_role;

create or replace function public.release_booking_discount(target_code uuid)
returns void language sql security definer set search_path='' as $$
  update public.discount_codes set redemption_count=greatest(0,redemption_count-1),version=version+1,updated_at=now() where id=target_code
$$;
revoke all on function public.release_booking_discount(uuid) from public,anon,authenticated;
grant execute on function public.release_booking_discount(uuid) to service_role;

create table if not exists public.lesson_whiteboards (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios(id) on delete cascade,
  lesson_id uuid not null unique references public.lessons(id) on delete cascade,
  document jsonb not null default '{"version":1,"elements":[]}'::jsonb,
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists lesson_whiteboards_studio_idx on public.lesson_whiteboards(studio_id,updated_at desc);
alter table public.lesson_whiteboards enable row level security;
drop policy if exists lesson_whiteboards_access on public.lesson_whiteboards;
create policy lesson_whiteboards_access on public.lesson_whiteboards for select to authenticated using (
  public.is_studio_coach(studio_id)
  or exists (
    select 1 from public.lessons l
    where l.id=lesson_id and (
      public.can_access_student(l.student_id)
      or exists(select 1 from public.lesson_participants lp where lp.lesson_id=l.id and public.can_access_student(lp.student_id))
    )
  )
);
revoke all on public.lesson_whiteboards from anon;
grant select on public.lesson_whiteboards to authenticated;
grant all on public.lesson_whiteboards to service_role;

alter table public.integration_imports
  add column if not exists verified_at timestamptz,
  add column if not exists verified_by uuid references auth.users(id) on delete set null,
  add column if not exists verification_note text;

grant select on public.discount_codes, public.discount_redemptions, public.lesson_whiteboards to authenticated;
