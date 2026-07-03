import type { Config, Context } from "@netlify/functions";
import Stripe from "stripe";
import { apiError, correlationId, json } from "./_shared/http";
import { serviceClient } from "./_shared/supabase";

export default async (request: Request, context: Context) => {
  const id=correlationId(request,context.requestId);
  try {
    if(request.method!=="POST") return json({code:"METHOD_NOT_ALLOWED",message:"Method not allowed.",retryable:false,correlationId:id},405);
    const key=Netlify.env.get("STRIPE_SECRET_KEY"); const secret=Netlify.env.get("STRIPE_WEBHOOK_SECRET");
    if(!key||!secret) throw new Error("Stripe webhook is not configured.");
    const stripe=new Stripe(key,{apiVersion:"2026-02-25.clover" as never}); const raw=await request.text();
    const event=stripe.webhooks.constructEvent(raw,request.headers.get("stripe-signature")||"",secret);
    if(event.type!=="checkout.session.completed") return json({ok:true,ignored:event.type});
    const session=event.data.object as Stripe.Checkout.Session; const studentId=session.metadata?.student_id; const packageId=session.metadata?.package_id;
    if(!studentId||!packageId||!session.id) throw new Error("VALIDATION_FAILED: Checkout metadata is incomplete.");
    const db=serviceClient(); const {data,error}=await db.rpc("process_stripe_checkout",{event_id:event.id,event_type:event.type,event_payload:event as unknown as Record<string,unknown>,session_id:session.id,student_id:studentId,package_id:packageId,amount_minor:session.amount_total||0,currency:session.currency||"usd"});
    if(error) throw error; return json({ok:true,...(data as object)});
  } catch(error){return apiError(error,id);}
};
export const config:Config={path:"/api/v2/stripe-webhook"};
