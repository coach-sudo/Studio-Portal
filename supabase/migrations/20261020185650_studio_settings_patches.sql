create function workspace_internal.apply_settings_patch(p_current jsonb,p_patch jsonb,p_base jsonb) returns jsonb
language plpgsql immutable security invoker set search_path='' as $$
declare result jsonb:=coalesce(p_current,'{}');item record;
begin
 for item in select * from jsonb_each(p_patch) loop
  if item.key in ('__proto__','constructor','prototype') then raise exception 'VALIDATION_FAILED'; end if;
  if jsonb_typeof(item.value)='object' then
   result:=jsonb_set(result,array[item.key],workspace_internal.apply_settings_patch(case when jsonb_typeof(result->item.key)='object' then result->item.key else '{}' end,item.value,coalesce(p_base->item.key,'{}')));
  else
   if p_base is not null and result?item.key and p_base?item.key and result->item.key is distinct from p_base->item.key and result->item.key is distinct from item.value then raise exception 'VERSION_CONFLICT: A changed setting was updated in another session.'; end if;
   if item.value='null'::jsonb then result:=result-item.key; else result:=jsonb_set(result,array[item.key],item.value); end if;
  end if;
 end loop;
 return result;
end $$;
revoke all on function workspace_internal.apply_settings_patch(jsonb,jsonb,jsonb) from public,anon,authenticated;

create function public.command_patch_studio_settings(p_patch jsonb,p_base jsonb,p_key text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=(select auth.uid());studio public.studios;before_state jsonb;next_settings jsonb;receipt workspace_internal.operation_receipts;request jsonb:=jsonb_build_object('command','settings.patch','patch',p_patch,'base',p_base);result jsonb;
begin
 select s.* into studio from public.studios s where public.is_studio_coach(s.id) order by s.id limit 1 for update;
 if actor is null or studio.id is null then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 select * into receipt from workspace_internal.operation_receipts where actor_id=actor and key=p_key;
 if found then if receipt.request<>request then raise exception 'IDEMPOTENCY_CONFLICT'; end if; return receipt.result; end if;
 if jsonb_typeof(p_patch)<>'object' or length(p_patch::text)>150000 or length(coalesce(p_key,''))<8 then raise exception 'VALIDATION_FAILED'; end if;
 if exists(select 1 from jsonb_object_keys(p_patch) k where k not in ('studioName','studioTagline','coachName','coachTitle','contactEmail','contactPhone','timezone','currency','bookingUrl','portalLabel','welcomeMessage','dailyPopup','campaignTemplates','showContactButtons','showBookingButton','showDriveFolder','reminderHours','lessonRatesMinor','bookingDefaults','meetingFormats','coachEmails','branding','bookingCopy','bookingPage','actorPageCta','referralProgram','emailAutomations','portalDefaults')) then raise exception 'VALIDATION_FAILED: Unsupported setting.'; end if;
 before_state:=to_jsonb(studio);
 next_settings:=workspace_internal.apply_settings_patch(studio.settings,p_patch,p_base);
 if p_patch?'studioName' and nullif(trim(next_settings->>'studioName'),'') is null then raise exception 'VALIDATION_FAILED'; end if;
 next_settings:=next_settings||jsonb_build_object('studioName',coalesce(next_settings->>'studioName',studio.name));
 if not exists(select 1 from pg_timezone_names where name=coalesce(next_settings->>'timezone',studio.timezone)) then raise exception 'VALIDATION_FAILED: Check studio name and timezone.'; end if;
 if next_settings?'currency' and next_settings->>'currency' !~ '^[A-Z]{3}$' then raise exception 'VALIDATION_FAILED'; end if;
 if p_patch?'lessonRatesMinor' and exists(select 1 from jsonb_each_text(next_settings->'lessonRatesMinor') r where r.value !~ '^[0-9]+$' or length(r.value)>9) then raise exception 'VALIDATION_FAILED: Rates must be non-negative minor units.'; end if;
 if p_patch?'reminderHours' and (jsonb_typeof(next_settings->'reminderHours')<>'array' or jsonb_array_length(next_settings->'reminderHours')>10 or exists(select 1 from jsonb_array_elements_text(next_settings->'reminderHours')v where v !~ '^[0-9]+(\.[0-9]+)?$' or v::numeric<=0 or v::numeric>720)) then raise exception 'VALIDATION_FAILED: Check reminder hours.'; end if;
 update public.studios set name=trim(next_settings->>'studioName'),timezone=coalesce(next_settings->>'timezone',timezone),settings=next_settings,updated_at=now() where id=studio.id returning * into studio;
 if p_patch#>'{bookingDefaults,inPersonUpchargeMinor}' is not null then
  if next_settings#>>'{bookingDefaults,inPersonUpchargeMinor}' !~ '^[0-9]+$' then raise exception 'VALIDATION_FAILED'; end if;
  -- This is a default, not a command to overwrite service-specific overrides or issued prices.
 end if;
 insert into public.audit_events(studio_id,actor_id,action,entity_type,entity_id,reason,correlation_id,source,before_state,after_state) values(studio.id,actor,'studio.settings_updated','studio',studio.id,'Coach saved changed settings',p_key,'coach_portal',before_state,to_jsonb(studio));
 result:=jsonb_build_object('resource',to_jsonb(studio),'queuedSideEffects','[]'::jsonb);
 insert into workspace_internal.operation_receipts(actor_id,key,studio_id,request,result) values(actor,p_key,studio.id,request,result);
 return result;
end $$;
revoke all on function public.command_patch_studio_settings(jsonb,jsonb,text) from public,anon;
grant execute on function public.command_patch_studio_settings(jsonb,jsonb,text) to authenticated;
