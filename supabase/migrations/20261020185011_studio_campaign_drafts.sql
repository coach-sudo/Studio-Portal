create table workspace_internal.campaign_drafts (
 id uuid primary key,studio_id uuid not null references public.studios(id),actor_id uuid not null,version integer not null default 1,
 value jsonb not null,review jsonb,result jsonb,created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
alter table workspace_internal.campaign_drafts enable row level security;
revoke all on workspace_internal.campaign_drafts from public,anon,authenticated,service_role;
alter table public.email_campaigns add column content jsonb,add column scheduled_at timestamptz,add column audience_snapshot jsonb;

create function public.manage_campaign_draft(p_actor uuid,p_draft uuid,p_command text,p_value jsonb,p_version integer,p_key text,p_origin text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare studio uuid; draft workspace_internal.campaign_drafts; audience jsonb; selected jsonb; campaign public.email_campaigns; recipient record; entry public.mailing_list_contacts;
 review_id uuid; queued integer:=0; send_time timestamptz; studio_name text; outcome jsonb; request jsonb:=jsonb_build_object('draft',p_draft,'command',p_command,'value',p_value); receipt workspace_internal.operation_receipts;
begin
 select studio_id into studio from public.memberships where user_id=p_actor and role='coach' order by id limit 1;
 if studio is null then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if p_command='list' then return jsonb_build_object('items',coalesce((select jsonb_agg(to_jsonb(x)) from(select id,version,value,review,result,updated_at from workspace_internal.campaign_drafts where studio_id=studio order by updated_at desc,id limit 25)x),'[]')); end if;
 perform pg_advisory_xact_lock(hashtextextended(studio::text||':campaign:'||p_draft::text,0));
 select * into draft from workspace_internal.campaign_drafts where id=p_draft and studio_id=studio for update;
 if p_command='read' then if draft.id is null then raise exception 'NOT_FOUND'; end if; return to_jsonb(draft); end if;
 if p_command='queue' then
  select * into receipt from workspace_internal.operation_receipts where actor_id=p_actor and key=p_key;
  if found then if receipt.request<>request then raise exception 'IDEMPOTENCY_CONFLICT'; end if; return receipt.result; end if;
 end if;
 if coalesce(draft.version,0)<>p_version then raise exception 'VERSION_CONFLICT'; end if;
 if draft.result is not null then raise exception 'REVIEW_REQUIRED: This draft was already queued. Start a distinct draft for another campaign.'; end if;
 if p_command='save' then
  if p_draft is null or length(p_value::text)>250000 or char_length(trim(p_value->>'name')) not between 2 and 120 or char_length(trim(p_value->>'subject')) not between 2 and 200 or jsonb_typeof(p_value->'content')<>'object' or jsonb_typeof(p_value->'recipientEmails')<>'array' or jsonb_array_length(p_value->'recipientEmails')>5000 then raise exception 'VALIDATION_FAILED'; end if;
  insert into workspace_internal.campaign_drafts(id,studio_id,actor_id,value) values(p_draft,studio,p_actor,p_value) on conflict(id) do update set value=excluded.value,version=campaign_drafts.version+1,review=null,updated_at=now() returning * into draft;
  return to_jsonb(draft);
 end if;
 if draft.id is null or p_origin !~ '^https://[^/]+$' then raise exception 'VALIDATION_FAILED'; end if;
 selected:=draft.value->'recipientEmails';
 -- Resolve the same current, consented audience at review and queue. Never expand a frozen audience.
 select coalesce(jsonb_agg(jsonb_build_object('email',c.email,'name',c.display_name) order by c.email),'[]') into audience
  from public.current_campaign_contacts(studio) c left join public.mailing_list_contacts m on m.studio_id=studio and m.email=c.email
  where m.unsubscribed_at is null and (jsonb_array_length(selected)=0 or selected ? c.email)
   and not exists(select 1 from public.linked_contacts lc where lc.studio_id=studio and lower(lc.email)=c.email and not lc.can_receive_notifications
    and not exists(select 1 from public.linked_contacts allowed where allowed.studio_id=studio and lower(allowed.email)=c.email and allowed.can_receive_notifications));
 if jsonb_array_length(audience)=0 or jsonb_array_length(audience)>5000 then raise exception 'REVIEW_REQUIRED: Choose between 1 and 5000 eligible recipients.'; end if;
 send_time:=coalesce(nullif(draft.value->>'sendAt','')::timestamptz,now());
 if p_command='review' then
  if nullif(draft.value->>'sendAt','') is not null and send_time<=now()+interval '1 minute' then raise exception 'VALIDATION_FAILED: Schedule at least one minute in the future.'; end if;
  update workspace_internal.campaign_drafts set review=jsonb_build_object('id',gen_random_uuid(),'actorId',p_actor,'version',version,'contentHash',md5(value::text),'audience',audience,'origin',p_origin,'expiresAt',now()+interval '30 minutes'),updated_at=now() where id=p_draft returning * into draft;
  return to_jsonb(draft);
 elsif p_command<>'queue' then raise exception 'VALIDATION_FAILED'; end if;
 if draft.review is null or draft.review->>'id' is distinct from p_value->>'reviewId' or draft.review->>'actorId' is distinct from p_actor::text or draft.review->>'origin' is distinct from p_origin or draft.review->>'contentHash' is distinct from md5(draft.value::text) or (draft.review->>'expiresAt')::timestamptz<=now() then raise exception 'REVIEW_EXPIRED'; end if;
 if draft.review->'audience'<>audience then raise exception 'REVIEW_REQUIRED: Audience or consent changed. Review again before sending.'; end if;
 if length(coalesce(p_key,''))<8 then raise exception 'VALIDATION_FAILED'; end if;
 select name into studio_name from public.studios where id=studio;
 insert into public.email_campaigns(studio_id,idempotency_key,name,subject_template,body_template,content,scheduled_at,audience_snapshot)
  values(studio,p_key::uuid,draft.value->>'name',draft.value->>'subject',draft.value->>'textTemplate',draft.value->'content',send_time,audience) returning * into campaign;
 for recipient in select * from jsonb_to_recordset(audience) as x(email text,name text) loop
  insert into public.mailing_list_contacts(studio_id,email,display_name) values(studio,recipient.email,recipient.name)
   on conflict(studio_id,email) do update set display_name=excluded.display_name returning * into entry;
  if entry.unsubscribed_at is not null then raise exception 'REVIEW_REQUIRED: Recipient consent changed.'; end if;
  insert into public.outbox_messages(studio_id,channel,recipient,subject,body,status,send_at,next_attempt_at,event_key,dedupe_key,priority,campaign_id,entity_snapshot)
   values(studio,'email',recipient.email,public.render_campaign_text(draft.value->>'subject',recipient.name,recipient.email,studio_name,p_origin||'/portal',p_origin||'/unsubscribe/'||entry.unsubscribe_token),
    public.render_campaign_text(draft.value->>'textTemplate',recipient.name,recipient.email,studio_name,p_origin||'/portal',p_origin||'/unsubscribe/'||entry.unsubscribe_token),'queued',send_time,send_time,'campaign.email','campaign:'||campaign.id||':'||recipient.email,70,campaign.id,
    jsonb_build_object('approvedAt',now(),'campaignContent',draft.value->'content','campaignValues',jsonb_build_object('firstName',split_part(recipient.name,' ',1),'fullName',recipient.name,'email',recipient.email,'studioName',studio_name,'portalUrl',p_origin||'/portal','unsubscribeUrl',p_origin||'/unsubscribe/'||entry.unsubscribe_token)));
  queued:=queued+1;
 end loop;
 update public.email_campaigns set recipient_count=queued where id=campaign.id;
 outcome:=jsonb_build_object('id',campaign.id,'recipientCount',queued,'sendAt',send_time,'alreadyQueued',false);
 update workspace_internal.campaign_drafts set result=outcome,updated_at=now() where id=p_draft;
 insert into workspace_internal.operation_receipts(actor_id,key,studio_id,request,result) values(p_actor,p_key,studio,request,outcome);
 insert into public.audit_events(studio_id,actor_id,action,entity_type,entity_id,reason,correlation_id,source,after_state) values(studio,p_actor,'campaign.queued','campaign',campaign.id,'Reviewed campaign audience and content',p_key,'coach_portal',jsonb_build_object('draftId',p_draft,'recipientCount',queued,'sendAt',send_time));
 return outcome;
end $$;
revoke all on function public.manage_campaign_draft(uuid,uuid,text,jsonb,integer,text,text) from public,anon,authenticated;
grant execute on function public.manage_campaign_draft(uuid,uuid,text,jsonb,integer,text,text) to service_role;

create function public.campaign_recipient_eligible(p_studio uuid,p_email text) returns boolean language sql stable security invoker set search_path='' as $$
 select exists(select 1 from public.current_campaign_contacts(p_studio)c where c.email=lower(p_email)) and not exists(select 1 from public.mailing_list_contacts m where m.studio_id=p_studio and m.email=lower(p_email) and m.unsubscribed_at is not null)
 and not exists(select 1 from public.linked_contacts lc where lc.studio_id=p_studio and lower(lc.email)=lower(p_email) and not lc.can_receive_notifications and not exists(select 1 from public.linked_contacts allowed where allowed.studio_id=p_studio and lower(allowed.email)=lower(p_email) and allowed.can_receive_notifications));
$$;
revoke all on function public.campaign_recipient_eligible(uuid,text) from public,anon,authenticated;
grant execute on function public.campaign_recipient_eligible(uuid,text) to service_role;

create function public.campaign_history(p_actor uuid,p_page integer default 1,p_search text default '') returns jsonb language plpgsql stable security definer set search_path='' as $$
declare studio uuid;result jsonb;
begin
 select studio_id into studio from public.memberships where user_id=p_actor and role='coach' order by id limit 1;
 if studio is null then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if p_page<1 or p_page>100000 then raise exception 'VALIDATION_FAILED'; end if;
 with selected as materialized(select * from public.email_campaigns where studio_id=studio and (p_search='' or name ilike '%'||left(p_search,120)||'%' or subject_template ilike '%'||left(p_search,120)||'%')),
 rows as (select c.id,c.name,c.subject_template,c.recipient_count,c.created_at,c.scheduled_at,
 (select count(*) from public.outbox_messages o where o.campaign_id=c.id and o.status in ('queued','sending')) queued_count,
 (select count(*) from public.outbox_messages o where o.campaign_id=c.id and o.status='sent') sent_count,
 (select count(*) from public.outbox_messages o where o.campaign_id=c.id and o.status='failed') failed_count,
 (select count(*) from public.outbox_messages o where o.campaign_id=c.id and o.status='cancelled') cancelled_count
 from selected c order by c.created_at desc,c.id limit 20 offset (p_page-1)*20)
 select jsonb_build_object('items',coalesce((select jsonb_agg(to_jsonb(r)) from rows r),'[]'),'count',(select count(*) from selected)) into result;
 return result;
end $$;
revoke all on function public.campaign_history(uuid,integer,text) from public,anon,authenticated;
grant execute on function public.campaign_history(uuid,integer,text) to service_role;
