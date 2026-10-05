-- Responsibility is not permission. Existing contacts remain unassigned.
alter table public.linked_contacts
  add column is_primary_payer boolean not null default false,
  add column is_primary_scheduling_contact boolean not null default false,
  add column receives_financial_escalations boolean not null default false;
create unique index linked_contacts_one_primary_payer on public.linked_contacts(student_id) where is_primary_payer;
create unique index linked_contacts_one_primary_scheduler on public.linked_contacts(student_id) where is_primary_scheduling_contact;

create table public.automation_rules (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios(id) on delete cascade,
  rule_key text not null check (rule_key in ('booking_confirmation','lesson_reminder','payment_due','payment_past_due','payment_failed','package_low','package_shortfall','package_expiration','missing_financial_setup','delivery_failure')),
  enabled boolean not null default false,
  mode text not null default 'off' check (mode in ('off','draft','automatic','automatic_with_escalation')),
  trigger text not null,
  conditions jsonb not null default '{}' check (jsonb_typeof(conditions) = 'object'),
  audience text not null,
  timing jsonb not null default '{}' check (jsonb_typeof(timing) = 'object'),
  suppressions jsonb not null default '[]' check (jsonb_typeof(suppressions) = 'array'),
  escalation jsonb not null default '{}' check (jsonb_typeof(escalation) = 'object'),
  template jsonb not null default '{}' check (jsonb_typeof(template) = 'object'),
  priority integer not null default 0 check (priority between 0 and 100),
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (studio_id, rule_key)
);

create table public.automation_runs (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios(id) on delete cascade,
  rule_id uuid not null references public.automation_rules(id),
  entity_type text not null check (entity_type in ('lesson','booking','package','student','outbox')),
  entity_id uuid not null,
  evaluated_at timestamptz not null default now(),
  result text not null check (result in ('not_due','draft','queued','suppressed','unresolved','failed','duplicate')),
  explanation text not null,
  suppressed_reason text,
  outbox_ids uuid[] not null default '{}',
  correlation_id text not null,
  decision jsonb not null default '{}' check (jsonb_typeof(decision) = 'object'),
  decision_key text not null unique
);
create index automation_runs_studio_recent on public.automation_runs(studio_id, evaluated_at desc);
create index automation_runs_rule_recent on public.automation_runs(rule_id, evaluated_at desc);
create index automation_runs_entity on public.automation_runs(entity_type, entity_id, evaluated_at desc);
alter table public.automation_rules enable row level security;
alter table public.automation_runs enable row level security;
-- Hosted projects can have broad default privileges. Set explicit grants, independent of defaults.
revoke all on public.automation_rules, public.automation_runs from public, anon, authenticated;
grant select on public.automation_rules, public.automation_runs to authenticated;
grant select, insert, update, delete on public.automation_rules, public.automation_runs to service_role;
create policy automation_rules_coach_read on public.automation_rules for select to authenticated using (public.is_studio_coach(studio_id));
create policy automation_runs_coach_read on public.automation_runs for select to authenticated using (public.is_studio_coach(studio_id));

alter table public.outbox_messages
  add column html_body text,
  add column suppression_reason text,
  add column recipient_intent text,
  add column automation_rule_id uuid references public.automation_rules(id) on delete set null,
  add column entity_snapshot jsonb not null default '{}' check (jsonb_typeof(entity_snapshot) = 'object');
create index outbox_automation_rule on public.outbox_messages(automation_rule_id) where automation_rule_id is not null;

-- Preserve existing confirmation/reminder/failure/package-warning producers. New PAYG/forecast/coach rules stay off.
create function public.seed_studio_automation_rules(target_studio uuid) returns void
language sql security definer set search_path='' as $$
insert into public.automation_rules (studio_id, rule_key, enabled, mode, trigger, audience, timing, suppressions)
select s.id, r.key,
  r.key in ('booking_confirmation','lesson_reminder','payment_failed','package_low','package_expiration') and coalesce((s.settings->'emailAutomations'->>'enabled')::boolean,true)
    and case when r.key='lesson_reminder' then coalesce((s.settings->'emailAutomations'->>'reminders')::boolean,true)
             when r.key='booking_confirmation' then coalesce((s.settings->'emailAutomations'->>'studentConfirmation')::boolean,true) else true end,
  case when r.key in ('booking_confirmation','lesson_reminder','payment_failed','package_low','package_expiration') and coalesce((s.settings->'emailAutomations'->>'enabled')::boolean,true)
    and case when r.key='lesson_reminder' then coalesce((s.settings->'emailAutomations'->>'reminders')::boolean,true)
             when r.key='booking_confirmation' then coalesce((s.settings->'emailAutomations'->>'studentConfirmation')::boolean,true) else true end then 'automatic' else 'off' end,
  r.trigger, r.audience,
  case when r.key='lesson_reminder' then jsonb_build_object('hoursBefore',coalesce(s.settings->'reminderHours','[72,24,2]'::jsonb))
       when r.key in ('payment_due','payment_past_due') then '{"hoursBefore":[72,24,2]}'::jsonb
       when r.key='package_expiration' then '{"daysBefore":30}'::jsonb else '{}'::jsonb end,
  '["condition_resolved","lesson_cancelled","lesson_rescheduled","preference_disabled","permission_revoked","duplicate"]'::jsonb
from public.studios s cross join (values
  ('booking_confirmation','booking_confirmed','lesson_confirmation'),
  ('lesson_reminder','before_lesson','lesson_reminder'),
  ('payment_due','before_lesson','payment_due'),
  ('payment_past_due','balance_past_due','payment_past_due'),
  ('payment_failed','payment_failed','payment_failed'),
  ('package_low','package_balance','package_low'),
  ('package_shortfall','package_forecast','package_shortfall'),
  ('package_expiration','package_expiration','package_expiration'),
  ('missing_financial_setup','financial_review','coach'),
  ('delivery_failure','delivery_failed','coach')
) as r(key, trigger, audience)
where s.id=target_studio
on conflict (studio_id,rule_key) do nothing;
$$;
revoke all on function public.seed_studio_automation_rules(uuid) from public,anon,authenticated;
grant execute on function public.seed_studio_automation_rules(uuid) to service_role;
select public.seed_studio_automation_rules(id) from public.studios;
create function public.initialize_studio_automation_rules() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  perform public.seed_studio_automation_rules(new.id);
  return new;
end $$;
revoke all on function public.initialize_studio_automation_rules() from public,anon,authenticated;
grant execute on function public.initialize_studio_automation_rules() to service_role;
create trigger initialize_studio_automation_rules after insert on public.studios for each row execute function public.initialize_studio_automation_rules();

-- Invalidate queued decisions immediately on authoritative lesson changes. Never delete history.
create function public.suppress_obsolete_lesson_automation() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if new.status in ('cancelled','late_cancelled') or new.starts_at is distinct from old.starts_at or new.ends_at is distinct from old.ends_at then
    update public.outbox_messages
    set status='cancelled', suppression_reason=case when new.status in ('cancelled','late_cancelled') then 'lesson_cancelled' else 'lesson_rescheduled' end,
      updated_at=now(), version=version+1
    where lesson_id=new.id and status in ('draft','approved','queued','failed')
      and (recipient_intent in ('lesson_reminder','payment_due','payment_past_due','payment_failed') or event_key like '%reminder%');
  elsif new.payment_status in ('paid','paid_by_credit','waived') or (
    new.package_id is not null and new.package_id is distinct from old.package_id
    and exists(select 1 from public.package_credit_entries e where e.lesson_id=new.id and e.package_id=new.package_id group by e.package_id having sum(e.quantity)<0)
  ) then
    update public.outbox_messages set status='cancelled', suppression_reason='financial_condition_resolved', updated_at=now(), version=version+1
    where lesson_id=new.id and status in ('draft','approved','queued','failed')
      and (recipient_intent in ('payment_due','payment_past_due','payment_failed') or event_key like 'payment.%');
  end if;
  return new;
end $$;
revoke all on function public.suppress_obsolete_lesson_automation() from public,anon,authenticated;
grant execute on function public.suppress_obsolete_lesson_automation() to service_role;
create trigger suppress_obsolete_lesson_automation after update of status,starts_at,ends_at,payment_status,package_id on public.lessons
  for each row execute function public.suppress_obsolete_lesson_automation();

create function public.suppress_resolved_booking_automation() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if new.payment_status in ('paid','not_required') and new.payment_status is distinct from old.payment_status then
    update public.outbox_messages set status='cancelled', suppression_reason='payment_received', updated_at=now(), version=version+1
    where booking_id=new.id and status in ('draft','approved','queued','failed')
      and (recipient_intent in ('payment_due','payment_past_due','payment_failed') or event_key like 'payment.%');
  end if;
  return new;
end $$;
revoke all on function public.suppress_resolved_booking_automation() from public,anon,authenticated;
grant execute on function public.suppress_resolved_booking_automation() to service_role;
create trigger suppress_resolved_booking_automation after update of payment_status on public.bookings
  for each row execute function public.suppress_resolved_booking_automation();
