import type { Config, Context } from "@netlify/functions";
import Stripe from "stripe";
import { commandSchema } from "./_shared/schemas";
import { apiError, correlationId, json } from "./_shared/http";
import { userClient } from "./_shared/supabase";

const domains = new Set(["students","lessons","work","finance","actor-pages","reader-requests","outbox","integrations","recommendations"]);
export default async (request: Request, context: Context) => {
  const id = correlationId(request, context.requestId);
  try {
    const domain = context.params.domain;
    if (!domains.has(domain)) return json({ code:"NOT_FOUND", message:"Unknown API domain.", retryable:false, correlationId:id },404);
    if (request.method === "GET") return json({ ok:true, domain, message:"Reads use Supabase RLS-backed query models.", correlationId:id });
    if (request.method !== "POST") return json({ code:"METHOD_NOT_ALLOWED", message:"Method not allowed.", retryable:false, correlationId:id },405);
    const input = commandSchema.parse(await request.json());
    const db = userClient(request);
    if (domain === "lessons" && input.command === "complete") {
      const {data,error}=await db.rpc("command_complete_lesson",{lesson_id:input.entityId,expected_version:input.expectedVersion,reason:input.reason,idempotency_key:input.idempotencyKey,correlation_id:id});
      if(error) throw error; return json(data);
    }
    if (domain === "outbox" && input.command === "approve") {
      const {data,error}=await db.rpc("command_approve_outbox",{message_id:input.entityId,expected_version:input.expectedVersion,reason:input.reason,idempotency_key:input.idempotencyKey,correlation_id:id});
      if(error) throw error; return json(data);
    }
    if (domain === "finance" && input.command === "checkout") {
      const packageId=String(input.payload.packageId||"");
      const {data:pkg,error:pkgError}=await db.from("packages").select("id,student_id,name,stripe_price_id").eq("id",packageId).single();
      if(pkgError||!pkg?.stripe_price_id) throw new Error("VALIDATION_FAILED: Package price is not configured.");
      const stripeKey=Netlify.env.get("STRIPE_SECRET_KEY"); if(!stripeKey) throw new Error("Stripe is not configured.");
      const stripe=new Stripe(stripeKey,{apiVersion:"2026-02-25.clover" as never});
      const origin=new URL(request.url).origin;
      const checkout=await stripe.checkout.sessions.create({mode:"payment",line_items:[{price:pkg.stripe_price_id,quantity:1}],client_reference_id:`${pkg.student_id}:${pkg.id}`,success_url:`${origin}/portal/payments?checkout=processing`,cancel_url:`${origin}/portal/payments?checkout=cancelled`,metadata:{student_id:pkg.student_id,package_id:pkg.id,idempotency_key:input.idempotencyKey}});
      return json({resource:{id:checkout.id,url:checkout.url},recommendations:[],auditEventId:null,queuedSideEffects:["stripe_webhook"]});
    }
    if (input.command === "transition" && input.entityType && input.entityId && input.nextStatus) {
      const {data,error}=await db.rpc("command_transition",{entity_type:input.entityType,entity_id:input.entityId,expected_version:input.expectedVersion,next_status:input.nextStatus,reason:input.reason,idempotency_key:input.idempotencyKey,correlation_id:id});
      if(error) throw error; return json(data);
    }
    return json({code:"UNKNOWN_COMMAND",message:"Unknown command for this domain.",retryable:false,correlationId:id},422);
  } catch(error) { return apiError(error,id); }
};
export const config: Config={path:"/api/v2/:domain"};
