import type { Config } from "@netlify/functions";
import { googleAccessToken } from "./_shared/google";
import { serviceClient } from "./_shared/supabase";
export default async()=>{
  const db=serviceClient(); const {data:items,error}=await db.rpc("claim_calendar_projections",{batch_size:10}); if(error) throw error; if(!items?.length)return Response.json({ok:true,processed:0});
  const token=await googleAccessToken(); const calendar=encodeURIComponent(Netlify.env.get("GOOGLE_CALENDAR_ID")||"primary"); let projected=0;
  for(const item of items){const p=item.projection,l=item.lesson;try{const body={summary:l.topic,start:{dateTime:l.starts_at},end:{dateTime:l.ends_at},location:l.location_label,description:l.join_url||""};const url=p.external_event_id?`https://www.googleapis.com/calendar/v3/calendars/${calendar}/events/${encodeURIComponent(p.external_event_id)}`:`https://www.googleapis.com/calendar/v3/calendars/${calendar}/events`;const response=await fetch(url,{method:p.external_event_id?"PATCH":"POST",headers:{Authorization:`Bearer ${token}`,"Content-Type":"application/json"},body:JSON.stringify(body)});const result=await response.json() as {id?:string;etag?:string};if(!response.ok)throw new Error(JSON.stringify(result));await db.from("calendar_projections").update({external_event_id:result.id||p.external_event_id,external_version:result.etag,projected_version:l.version,status:"projected",last_projected_at:new Date().toISOString(),last_error:null}).eq("id",p.id);projected++;}catch(error){await db.from("calendar_projections").update({status:"failed",last_error:String(error)}).eq("id",p.id);}}
  return Response.json({ok:true,processed:items.length,projected});
};
export const config:Config={schedule:"*/5 * * * *"};
