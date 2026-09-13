-- Campaign recipients are derived from current student and linked-contact
-- addresses. This table keeps one opt-out preference per normalized address.
create table public.mailing_list_contacts (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios(id) on delete cascade,
  email text not null,
  display_name text not null default '',
  unsubscribe_token uuid not null default gen_random_uuid() unique,
  unsubscribed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (studio_id, email),
  check (email = lower(btrim(email)) and email like '%@%')
);

create table public.email_campaigns (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios(id) on delete cascade,
  name text not null,
  subject_template text not null,
  body_template text not null,
  recipient_count integer not null default 0 check (recipient_count >= 0),
  idempotency_key uuid not null,
  created_at timestamptz not null default now(),
  unique (studio_id, idempotency_key)
);

alter table public.outbox_messages
  add column campaign_id uuid references public.email_campaigns(id) on delete set null;
create index outbox_messages_campaign_status_idx
  on public.outbox_messages(campaign_id, status)
  where campaign_id is not null;

alter table public.mailing_list_contacts enable row level security;
alter table public.email_campaigns enable row level security;
create policy mailing_list_coach_read on public.mailing_list_contacts
  for select to authenticated using (public.is_studio_coach(studio_id));
create policy email_campaigns_coach_read on public.email_campaigns
  for select to authenticated using (public.is_studio_coach(studio_id));
revoke all on public.mailing_list_contacts, public.email_campaigns from anon, authenticated;
grant select on public.mailing_list_contacts, public.email_campaigns to authenticated;
grant all on public.mailing_list_contacts, public.email_campaigns to service_role;

create function public.current_campaign_contacts(p_studio_id uuid)
returns table(email text, display_name text)
language sql stable security invoker set search_path = '' as $$
  with source as (
    select lower(btrim(s.email)) as email,
      coalesce(nullif(btrim(s.preferred_name), ''), s.full_name) as display_name,
      3 as priority
    from public.students s
    where s.studio_id = p_studio_id and s.deleted_at is null and s.email is not null
    union all
    select lower(btrim(s.guardian_email)),
      coalesce(nullif(btrim(s.guardian_name), ''), 'Guardian'), 2
    from public.students s
    where s.studio_id = p_studio_id and s.deleted_at is null and s.guardian_email is not null
    union all
    select lower(btrim(lc.email)), lc.full_name, 1
    from public.linked_contacts lc
    join public.students s on s.id = lc.student_id and s.deleted_at is null
    where lc.studio_id = p_studio_id and lc.email is not null
  )
  select distinct on (source.email) source.email, source.display_name
  from source
  where source.email ~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
  order by source.email, source.priority, source.display_name;
$$;

create function public.render_campaign_text(
  p_template text, p_full_name text, p_email text, p_studio_name text,
  p_portal_url text, p_unsubscribe_url text
) returns text language plpgsql immutable security invoker set search_path = '' as $$
declare result text := p_template;
begin
  result := replace(result, '{{firstName}}', split_part(coalesce(nullif(p_full_name, ''), 'there'), ' ', 1));
  result := replace(result, '{{fullName}}', coalesce(nullif(p_full_name, ''), 'there'));
  result := replace(result, '{{email}}', p_email);
  result := replace(result, '{{studioName}}', p_studio_name);
  result := replace(result, '{{portalUrl}}', p_portal_url);
  result := replace(result, '{{unsubscribeUrl}}', p_unsubscribe_url);
  return result;
end;
$$;

create function public.queue_email_campaign(
  p_studio_id uuid, p_idempotency_key uuid, p_name text,
  p_subject_template text, p_body_template text, p_base_url text
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  campaign public.email_campaigns;
  studio_name text;
  queued_count integer;
begin
  if char_length(btrim(p_name)) not between 2 and 120
    or char_length(btrim(p_subject_template)) not between 2 and 200
    or char_length(btrim(p_body_template)) not between 2 and 10000
    or p_base_url !~ '^https://[^/]+$' then
    raise exception 'Invalid campaign details';
  end if;
  select s.name into studio_name from public.studios s where s.id = p_studio_id;
  if studio_name is null then raise exception 'Studio not found'; end if;

  insert into public.email_campaigns(studio_id, name, subject_template, body_template, idempotency_key)
  values (p_studio_id, btrim(p_name), btrim(p_subject_template), btrim(p_body_template), p_idempotency_key)
  on conflict (studio_id, idempotency_key) do nothing
  returning * into campaign;
  if campaign.id is null then
    select * into campaign from public.email_campaigns
    where studio_id = p_studio_id and idempotency_key = p_idempotency_key;
    return jsonb_build_object('id', campaign.id, 'recipientCount', campaign.recipient_count, 'alreadyQueued', true);
  end if;

  insert into public.mailing_list_contacts(studio_id, email, display_name)
  select p_studio_id, current_contacts.email, current_contacts.display_name
  from public.current_campaign_contacts(p_studio_id) current_contacts
  on conflict (studio_id, email) do update
    set display_name = excluded.display_name, updated_at = now();

  insert into public.outbox_messages(
    studio_id, channel, recipient, subject, body, status, send_at,
    next_attempt_at, event_key, dedupe_key, priority, campaign_id
  )
  select p_studio_id, 'email', contact.email,
    public.render_campaign_text(p_subject_template, contact.display_name, contact.email,
      studio_name, p_base_url || '/portal', p_base_url || '/unsubscribe/' || contact.unsubscribe_token::text),
    public.render_campaign_text(p_body_template, contact.display_name, contact.email,
      studio_name, p_base_url || '/portal', p_base_url || '/unsubscribe/' || contact.unsubscribe_token::text)
      || case when position('{{unsubscribeUrl}}' in p_body_template) > 0 then ''
        else E'\n\nUnsubscribe from studio email campaigns: ' || p_base_url || '/unsubscribe/' || contact.unsubscribe_token::text end,
    'queued', now(), now(), 'campaign.email',
    'campaign:' || campaign.id::text || ':' || contact.email, 70, campaign.id
  from public.mailing_list_contacts contact
  join public.current_campaign_contacts(p_studio_id) current_contacts on current_contacts.email = contact.email
  where contact.studio_id = p_studio_id and contact.unsubscribed_at is null
  on conflict (dedupe_key) where dedupe_key is not null do nothing;
  get diagnostics queued_count = row_count;
  if queued_count = 0 then raise exception 'No subscribed contacts are available'; end if;
  update public.email_campaigns set recipient_count = queued_count where id = campaign.id;
  return jsonb_build_object('id', campaign.id, 'recipientCount', queued_count, 'alreadyQueued', false);
end;
$$;

create function public.campaign_delivery_stats(p_studio_id uuid)
returns table(
  id uuid, name text, subject_template text, recipient_count integer,
  created_at timestamptz, queued_count bigint, sent_count bigint,
  failed_count bigint, cancelled_count bigint
) language sql stable security invoker set search_path = '' as $$
  select c.id, c.name, c.subject_template, c.recipient_count, c.created_at,
    count(o.id) filter (where o.status in ('queued', 'sending')),
    count(o.id) filter (where o.status = 'sent'),
    count(o.id) filter (where o.status = 'failed'),
    count(o.id) filter (where o.status = 'cancelled')
  from public.email_campaigns c
  left join public.outbox_messages o on o.campaign_id = c.id
  where c.studio_id = p_studio_id
  group by c.id
  order by c.created_at desc
  limit 20;
$$;

revoke all on function public.current_campaign_contacts(uuid) from public, anon, authenticated;
revoke all on function public.render_campaign_text(text, text, text, text, text, text) from public, anon, authenticated;
revoke all on function public.queue_email_campaign(uuid, uuid, text, text, text, text) from public, anon, authenticated;
revoke all on function public.campaign_delivery_stats(uuid) from public, anon, authenticated;
grant execute on function public.current_campaign_contacts(uuid) to service_role;
grant execute on function public.render_campaign_text(text, text, text, text, text, text) to service_role;
grant execute on function public.queue_email_campaign(uuid, uuid, text, text, text, text) to service_role;
grant execute on function public.campaign_delivery_stats(uuid) to service_role;
