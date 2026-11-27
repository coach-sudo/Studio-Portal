-- OAuth grants and PKCE challenges are server-only. The refresh credential
-- stays in Vault and is readable only through the service role.
create schema gmail_delivery_oauth_internal;
revoke all on schema gmail_delivery_oauth_internal from public,anon,authenticated,service_role;

create table gmail_delivery_oauth_internal.pending (
  state_hash text primary key,
  browser_hash text not null,
  verifier text not null,
  studio_id uuid not null references public.studios(id) on delete cascade,
  actor_id uuid not null references auth.users(id) on delete cascade,
  expires_at timestamptz not null default now()+interval '10 minutes',
  unique(studio_id,actor_id)
);
create table gmail_delivery_oauth_internal.grants (
  studio_id uuid primary key references public.studios(id) on delete cascade,
  secret_id uuid not null,
  account_email text not null,
  client_id text not null,
  authenticated_at timestamptz not null default now()
);
alter table gmail_delivery_oauth_internal.pending enable row level security;
alter table gmail_delivery_oauth_internal.grants enable row level security;
revoke all on all tables in schema gmail_delivery_oauth_internal from public,anon,authenticated,service_role;

create function public.begin_gmail_delivery_oauth(p_studio uuid,p_actor uuid,p_state text,p_browser text,p_verifier text)
returns void language plpgsql security definer set search_path='' as $$
begin
  if not exists(select 1 from public.memberships where studio_id=p_studio and user_id=p_actor and role='coach')
    then raise exception 'FORBIDDEN'; end if;
  insert into gmail_delivery_oauth_internal.pending(studio_id,actor_id,state_hash,browser_hash,verifier)
    values(p_studio,p_actor,p_state,p_browser,p_verifier)
    on conflict(studio_id,actor_id) do update set state_hash=excluded.state_hash,
      browser_hash=excluded.browser_hash,verifier=excluded.verifier,expires_at=excluded.expires_at;
end $$;

create function public.consume_gmail_delivery_oauth(p_state text,p_browser text)
returns jsonb language sql security definer set search_path='' as $$
  with consumed as (
    delete from gmail_delivery_oauth_internal.pending
    where state_hash=p_state and browser_hash=p_browser and expires_at>now()
    returning studio_id,actor_id,verifier
  )
  select to_jsonb(consumed) from consumed
$$;

create function public.save_gmail_delivery_oauth(p_studio uuid,p_actor uuid,p_email text,p_client text,p_refresh text)
returns void language plpgsql security definer set search_path='' as $$
declare previous uuid;
begin
  perform 1 from public.studios where id=p_studio for update;
  if not found or not exists(select 1 from public.memberships where studio_id=p_studio and user_id=p_actor and role='coach')
    then raise exception 'FORBIDDEN'; end if;
  select secret_id into previous from gmail_delivery_oauth_internal.grants where studio_id=p_studio;
  if previous is null then
    insert into gmail_delivery_oauth_internal.grants(studio_id,secret_id,account_email,client_id)
    values(p_studio,vault.create_secret(p_refresh),p_email,p_client);
  else
    perform vault.update_secret(previous,p_refresh);
    update gmail_delivery_oauth_internal.grants set account_email=p_email,client_id=p_client,authenticated_at=now() where studio_id=p_studio;
  end if;
end $$;

create function public.gmail_delivery_oauth_refresh(p_studio uuid,p_email text,p_client text)
returns text language sql stable security definer set search_path='' as $$
  select s.decrypted_secret from gmail_delivery_oauth_internal.grants g
  join vault.decrypted_secrets s on s.id=g.secret_id
  where g.studio_id=p_studio and g.account_email=p_email and g.client_id=p_client
$$;
revoke all on function public.begin_gmail_delivery_oauth(uuid,uuid,text,text,text),public.consume_gmail_delivery_oauth(text,text),
  public.save_gmail_delivery_oauth(uuid,uuid,text,text,text),public.gmail_delivery_oauth_refresh(uuid,text,text) from public,anon,authenticated;
grant execute on function public.begin_gmail_delivery_oauth(uuid,uuid,text,text,text),public.consume_gmail_delivery_oauth(text,text),
  public.save_gmail_delivery_oauth(uuid,uuid,text,text,text),public.gmail_delivery_oauth_refresh(uuid,text,text) to service_role;

create function public.gmail_delivery_oauth_status(p_studio uuid,p_client text default null)
returns jsonb language sql stable security definer set search_path='' as $$
  select jsonb_build_object('account',account_email,'authorizedAt',authenticated_at,
    'clientMatches',(client_id=p_client) is true)
  from gmail_delivery_oauth_internal.grants
  where studio_id=p_studio
$$;
revoke all on function public.gmail_delivery_oauth_status(uuid,text) from public,anon,authenticated;
grant execute on function public.gmail_delivery_oauth_status(uuid,text) to service_role;
