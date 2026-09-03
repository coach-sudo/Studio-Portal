import { createHash, randomBytes } from "node:crypto";
import type { Config, Context } from "@netlify/functions";
import Stripe from "stripe";
import { apiError, correlationId, json } from "./_shared/http";
import { serviceClient } from "./_shared/supabase";
import { provisionPortalAccount } from "./_shared/portal-access";
import { dispatchOutbox } from "./_shared/outbox-dispatch";

const hash = (value: string) => createHash("sha256").update(value).digest("hex");
async function rateLimit(request: Request, action: string) {
  const address=request.headers.get("x-nf-client-connection-ip")||request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()||"unknown";
  const {data,error}=await serviceClient().rpc("claim_public_rate_limit",{target_key:`package-gift:${action}:${hash(address)}`,target_limit:action==="create"?8:20,target_window_seconds:600});
  if(error)throw error;if(!data)throw new Error("RATE_LIMITED");
}

export default async (request:Request,context:Context)=>{
  const id=correlationId(request,context.requestId);
  try{
    const action=context.params.action||"catalog",db=serviceClient();
    if(request.method==="GET"&&action==="catalog"){
      const definitionId=new URL(request.url).searchParams.get("definitionId")||"";
      const {data,error}=await db.from("package_definitions").select("id,studio_id,name,description,session_count,session_duration_minutes,price_minor,currency,expiration_days,pricing_service_id,delivery_format,giftable,active,visibility,direct_purchase,studios(name,settings)").eq("id",definitionId).eq("active",true).eq("visibility","public").eq("direct_purchase",true).single();
      if(error||!data)throw new Error("SERVICE_NOT_FOUND");
      return json({package:{id:data.id,name:data.name,description:data.description,sessionCount:data.session_count,sessionDurationMinutes:data.session_duration_minutes,priceMinor:Number(data.price_minor),currency:data.currency,deliveryFormat:data.delivery_format,giftable:Boolean(data.giftable)},studio:Array.isArray(data.studios)?data.studios[0]:data.studios});
    }
    if(request.method!=="POST")return json({code:"METHOD_NOT_ALLOWED",message:"Method not allowed.",retryable:false,correlationId:id},405);
    await rateLimit(request,action);
    const body=await request.json() as Record<string,unknown>;
    if(action==="create"){
      const definitionId=String(body.definitionId||""),purchaserName=String(body.purchaserName||"").trim(),purchaserEmail=String(body.purchaserEmail||"").trim().toLowerCase(),recipientName=String(body.recipientName||"").trim(),recipientEmail=String(body.recipientEmail||"").trim().toLowerCase();
      if(purchaserName.length<2||recipientName.length<2||!purchaserEmail.includes("@")||!recipientEmail.includes("@"))throw new Error("VALIDATION_FAILED: Complete the purchaser and recipient details.");
      const {data:definition,error}=await db.from("package_definitions").select("id,studio_id,name,price_minor,currency,stripe_price_id,giftable,active,visibility,direct_purchase").eq("id",definitionId).single();
      if(error||!definition||!definition.giftable||!definition.active||definition.visibility!=="public"||!definition.direct_purchase||!definition.stripe_price_id)throw new Error("SERVICE_NOT_FOUND");
      const token=randomBytes(32).toString("base64url"),origin=Netlify.env.get("URL")||new URL(request.url).origin,expiresAt=new Date(Date.now()+90*86_400_000).toISOString();
      const {data:gift,error:giftError}=await db.from("package_gifts").insert({studio_id:definition.studio_id,definition_id:definition.id,purchaser_name:purchaserName,purchaser_email:purchaserEmail,recipient_name:recipientName,recipient_email:recipientEmail,message:String(body.message||"").slice(0,500),deliver_at:body.deliveryDate?new Date(String(body.deliveryDate)).toISOString():null,claim_token_hash:hash(token),expires_at:expiresAt}).select("id").single();
      if(giftError)throw giftError;
      const key=Netlify.env.get("STRIPE_SECRET_KEY");if(!key)throw new Error("Stripe is not configured.");
      const checkout=await new Stripe(key,{apiVersion:"2026-07-29.dahlia"}).checkout.sessions.create({mode:"payment",customer_email:purchaserEmail,line_items:[{price:definition.stripe_price_id,quantity:1}],client_reference_id:gift.id,success_url:`${origin}/gift/thanks`,cancel_url:`${origin}/gift/${definition.id}?checkout=cancelled`,payment_intent_data:{metadata:{billing_kind:"package_gift",package_gift_id:gift.id}},metadata:{billing_kind:"package_gift",package_gift_id:gift.id,claim_token:token,definition_id:definition.id,studio_id:definition.studio_id,integration_identifier:"coachd_package_gifts"}},{idempotencyKey:request.headers.get("idempotency-key")||`gift:${gift.id}`});
      await db.from("package_gifts").update({stripe_checkout_session_id:checkout.id,updated_at:new Date().toISOString()}).eq("id",gift.id);
      return json({url:checkout.url});
    }
    if(action==="claim"){
      const token=String(body.token||""),email=String(body.email||"").trim().toLowerCase(),fullName=String(body.fullName||"").trim();
      if(token.length<30||!email.includes("@")||fullName.length<2)throw new Error("VALIDATION_FAILED: Complete the claim details.");
      const {data:gift,error}=await db.from("package_gifts").select("*,package_definitions(*)").eq("claim_token_hash",hash(token)).single();
      if(error||!gift||gift.recipient_email.toLowerCase()!==email||!["purchased","delivered"].includes(gift.status)||new Date(gift.expires_at)<=new Date()||(gift.deliver_at&&new Date(gift.deliver_at)>new Date()))throw new Error("FORBIDDEN");
      let {data:student}=await db.from("students").select("id,version").eq("studio_id",gift.studio_id).ilike("email",email).is("deleted_at",null).limit(1).maybeSingle();
      if(!student){const legacy=await db.from("students").select("id,version").eq("studio_id",gift.studio_id).ilike("guardian_email",email).is("deleted_at",null).limit(1).maybeSingle();student=legacy.data;}
      if(!student){const {data:contact}=await db.from("linked_contacts").select("student_id").eq("studio_id",gift.studio_id).ilike("email",email).eq("portal_enabled",true).limit(1).maybeSingle();if(contact){const linked=await db.from("students").select("id,version").eq("id",contact.student_id).single();student=linked.data;}}
      if(!student){const created=await db.from("students").insert({studio_id:gift.studio_id,full_name:fullName,email,status:"lead",portal_enabled:Boolean(body.createPortalProfile)}).select("id,version").single();if(created.error)throw created.error;student=created.data;}
      const claimed=await db.rpc("claim_package_gift",{target_gift:gift.id,target_student:student.id,apply_automatically:Boolean(body.autoApply)});if(claimed.error)throw claimed.error;
      if(body.createPortalProfile){const account=await provisionPortalAccount(db,{studioId:gift.studio_id,studentId:student.id,accountType:"student",resetExisting:false});if(account.outboxMessageId)context.waitUntil(dispatchOutbox({ids:[account.outboxMessageId]}));}
      return json({claimed:true,duplicate:Boolean(claimed.data?.duplicate),portalRequested:Boolean(body.createPortalProfile)});
    }
    throw new Error("VALIDATION_FAILED: Unknown gift action.");
  }catch(error){return apiError(error,id);}
};
export const config:Config={path:"/api/v2/public/package-gifts/:action"};
