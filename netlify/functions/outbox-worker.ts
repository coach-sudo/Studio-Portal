import type { Config } from "@netlify/functions";
import { googleAccessToken, sendGmail } from "./_shared/google";
import { serviceClient } from "./_shared/supabase";
export default async()=>{
  const db=serviceClient(); const {data:messages,error}=await db.rpc("claim_booking_reminders",{batch_size:20}); if(error) throw error;
  if(!messages?.length) return Response.json({ok:true,processed:0}); let token:string;
  try{token=await googleAccessToken();}catch(error){for(const message of messages){await db.from("outbox_messages").update({status:"failed",last_error:String(error),next_attempt_at:new Date(Date.now()+15*60000).toISOString()}).eq("id",message.id);}return Response.json({ok:false,error:String(error)},{status:503});}
  let sent=0; for(const message of messages){try{const result=await sendGmail(token,message);await db.from("delivery_attempts").insert({outbox_message_id:message.id,provider:"gmail",provider_reference:result.id,response:result,succeeded:true});await db.from("outbox_messages").update({status:"sent",last_error:null,updated_at:new Date().toISOString()}).eq("id",message.id);sent++;}catch(error){await db.from("delivery_attempts").insert({outbox_message_id:message.id,provider:"gmail",response:{},succeeded:false,error:String(error)});await db.from("outbox_messages").update({status:"failed",last_error:String(error),next_attempt_at:new Date(Date.now()+Math.min(60,message.attempts*10)*60000).toISOString()}).eq("id",message.id);}}
  return Response.json({ok:true,processed:messages.length,sent});
};
export const config:Config={schedule:"*/5 * * * *"};
