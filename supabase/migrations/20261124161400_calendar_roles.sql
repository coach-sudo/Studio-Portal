create table calendar_oauth_internal.roles (
  studio_id uuid primary key references public.studios(id) on delete cascade,
  outgoing text not null,
  availability text[] not null,
  incoming text[] not null
);
alter table calendar_oauth_internal.roles enable row level security;
revoke all on calendar_oauth_internal.roles from public,anon,authenticated,service_role;

create function public.calendar_roles(p_studio uuid)
returns jsonb language sql stable security definer set search_path='' as $$
  select jsonb_build_object('outgoing',outgoing,'availability',availability,'incoming',incoming)
  from calendar_oauth_internal.roles where studio_id=p_studio
$$;

create function public.save_calendar_roles(p_studio uuid,p_actor uuid,p_default text,p_outgoing text,p_availability text[],p_incoming text[])
returns boolean language plpgsql security definer set search_path='' as $$
declare current_outgoing text;
begin
  perform 1 from public.studios where id=p_studio for update;
  if not found or not exists(select 1 from public.memberships where studio_id=p_studio and user_id=p_actor and role='coach')
    then raise exception 'FORBIDDEN'; end if;
  select outgoing into current_outgoing from calendar_oauth_internal.roles where studio_id=p_studio;
  if p_outgoing is distinct from coalesce(current_outgoing,p_default) and exists(
    select 1 from public.calendar_projections p join public.lessons l on l.id=p.lesson_id
    where l.studio_id=p_studio and (p.external_event_id is not null or p.attempts>0)
  ) then return false; end if;
  insert into calendar_oauth_internal.roles values(p_studio,p_outgoing,p_availability,p_incoming)
  on conflict(studio_id) do update set outgoing=excluded.outgoing,availability=excluded.availability,incoming=excluded.incoming;
  return true;
end $$;
revoke all on function public.calendar_roles(uuid),public.save_calendar_roles(uuid,uuid,text,text,text[],text[]) from public,anon,authenticated;
grant execute on function public.calendar_roles(uuid),public.save_calendar_roles(uuid,uuid,text,text,text[],text[]) to service_role;
