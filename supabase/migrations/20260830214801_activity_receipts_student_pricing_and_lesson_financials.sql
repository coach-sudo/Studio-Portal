alter table public.students
  add column if not exists special_pricing_enabled boolean not null default false;

alter table public.student_pricing_rules
  add column if not exists location_price_adjustments jsonb not null default '{}'::jsonb,
  add column if not exists deposit_minor bigint;

alter table public.lessons
  add column if not exists payment_status text not null default 'untracked'
    check (payment_status in ('untracked','due','partially_paid','paid','paid_by_credit','waived','refunded')),
  add column if not exists price_minor bigint,
  add column if not exists paid_minor bigint not null default 0;

create table if not exists public.notification_receipts (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  event_key text not null,
  read_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (user_id, event_key)
);

create index if not exists notification_receipts_user_recent_idx
  on public.notification_receipts (user_id, read_at desc);

alter table public.notification_receipts enable row level security;

drop policy if exists "notification receipts own select" on public.notification_receipts;
create policy "notification receipts own select"
  on public.notification_receipts for select
  to authenticated
  using (user_id = auth.uid());

drop policy if exists "notification receipts own insert" on public.notification_receipts;
create policy "notification receipts own insert"
  on public.notification_receipts for insert
  to authenticated
  with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.memberships m
      where m.user_id = auth.uid() and m.studio_id = notification_receipts.studio_id
    )
  );

drop policy if exists "notification receipts own update" on public.notification_receipts;
create policy "notification receipts own update"
  on public.notification_receipts for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

comment on table public.notification_receipts is
  'Compact per-user read state for the derived activity feed. Source events remain authoritative.';
