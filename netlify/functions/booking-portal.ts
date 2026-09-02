import type { Config, Context } from "@netlify/functions";
import Stripe from "stripe";
import { apiError, correlationId, json } from "./_shared/http";
import { googleAccessToken, googleFreeBusy } from "./_shared/google";
import { serviceClient, userClient } from "./_shared/supabase";
import { queueLessonChangeEmails } from "./_shared/booking-email";
import { cancelConfirmedBooking } from "./_shared/booking-cancellation";

export default async (request: Request, context: Context) => {
  const id = correlationId(request, context.requestId);
  try {
    if (request.method !== "POST") return json({ code: "METHOD_NOT_ALLOWED", message: "Method not allowed.", retryable: false, correlationId: id }, 405);
    const action = context.params.action;
    const body = await request.json() as { studentId?: string; bookingId?: string; startsAt?: string; endsAt?: string; scope?: "occurrence" | "series" };
    const userDb = userClient(request);
    if(action==="payment-method"||action==="billing"){
      if(!body.studentId)throw new Error("VALIDATION_FAILED: studentId is required.");
      const { data: financeAllowed } = await userDb.rpc("can_view_student_finance", { target_student: body.studentId });
      if (!financeAllowed) throw new Error("FORBIDDEN");
      const {data:student,error:studentError}=await userDb.from("students").select("id,studio_id,email,guardian_email,stripe_customer_id").eq("id",body.studentId).single();if(studentError||!student)throw new Error("FORBIDDEN");const stripeKey=Netlify.env.get("STRIPE_SECRET_KEY");if(!stripeKey)throw new Error("Stripe is not configured.");const stripe=new Stripe(stripeKey,{apiVersion:"2026-07-29.dahlia"});let customerId=student.stripe_customer_id as string|undefined;
      if(!customerId){const customer=await stripe.customers.create({email:student.guardian_email||student.email||undefined,metadata:{student_id:student.id,studio_id:student.studio_id}},{idempotencyKey:`student-customer:${student.id}`});customerId=customer.id;const {error:updateError}=await serviceClient().from("students").update({stripe_customer_id:customerId,updated_at:new Date().toISOString()}).eq("id",student.id);if(updateError)throw updateError;}
      const origin=new URL(request.url).origin;
      if(action==="payment-method"){const session=await stripe.checkout.sessions.create({mode:"setup",customer:customerId,client_reference_id:student.id,success_url:`${origin}/portal/settings?payment=updated`,cancel_url:`${origin}/portal/settings?payment=cancelled`,metadata:{student_id:student.id,studio_id:student.studio_id}},{idempotencyKey:request.headers.get("idempotency-key")||`setup:${student.id}:${Math.floor(Date.now()/30000)}`});if(!session.url)throw new Error("Stripe did not return a setup URL.");return json({url:session.url});}
      const session=await stripe.billingPortal.sessions.create({customer:customerId,return_url:`${origin}/portal/settings`});return json({url:session.url});
    }
    if (!body.bookingId) throw new Error("VALIDATION_FAILED: bookingId is required.");
    const { data: booking, error: accessError } = await userDb.from("bookings").select("*").eq("id", body.bookingId).single();
    if (accessError || !booking) throw new Error("FORBIDDEN");
    if (booking.student_id) {
      const { data: canManage } = await userDb.rpc("can_manage_student_lessons", { target_student: booking.student_id });
      if (!canManage) throw new Error("FORBIDDEN");
    }
    const db = serviceClient();

    if (action === "cancel") {
      const result = await cancelConfirmedBooking({
        db,
        booking,
        correlationId: id,
        stripeIdempotencyPrefix: "self-cancel",
      });
      return json({ ...result, correlationId: id });
    }

    if (action === "reschedule" && body.startsAt && body.endsAt) {
      const late = new Date(booking.starts_at).getTime() - Date.now() < Number(booking.policy_snapshot.cancellationWindowHours) * 3_600_000;
      if (late) throw new Error(`VALIDATION_FAILED: Online rescheduling closes ${booking.policy_snapshot.cancellationWindowHours} hours before the lesson. Contact the studio if you need help.`);
      if (booking.reschedule_count >= Number(booking.policy_snapshot.rescheduleLimit)) throw new Error("VALIDATION_FAILED: The self-service reschedule limit has been reached.");
      const token = await googleAccessToken();
      const { data: participants } = await db.from("lesson_participants").select("lesson_id").eq("booking_id", booking.id);
      const lessonIds = (participants ?? []).map((item) => item.lesson_id);
      const { data: lessons } = lessonIds.length ? await db.from("lessons").select("id,starts_at,ends_at").in("id", lessonIds).order("starts_at") : { data: [] };
      const shift = new Date(body.startsAt).getTime() - new Date(booking.starts_at).getTime();
      const targets = body.scope === "series" ? lessons ?? [] : (lessons ?? []).slice(0, 1);
      if(!targets.length)throw new Error("INVALID_TRANSITION");
      const shifted=targets.map((lesson)=>({start:new Date(new Date(lesson.starts_at).getTime()+shift).toISOString(),end:new Date(new Date(lesson.ends_at).getTime()+shift).toISOString()})),providerBusy=await googleFreeBusy(token,shifted[0].start,shifted.at(-1)!.end);
      if(shifted.some((item)=>providerBusy.some((block)=>new Date(item.start)<new Date(block.end)&&new Date(item.end)>new Date(block.start))))throw new Error("SLOT_UNAVAILABLE");
      const { data: hold, error: holdError } = await db.rpc("create_booking_hold", { target_service: booking.service_id, target_offering: null, target_start: body.startsAt, target_end: body.endsAt });
      if (holdError) throw holdError;
      const { data, error } = await db.rpc("reschedule_booking_occurrences",{target_booking:booking.id,expected_version:booking.version,next_start:body.startsAt,next_end:body.endsAt,change_scope:body.scope||"occurrence"});
      if (error){await db.from("booking_holds").update({status:"expired"}).eq("id",hold.id);throw error;}
      await db.from("booking_holds").update({ status: "converted" }).eq("id", hold.id);
      const queued=[];
      for(const target of targets)queued.push(...(await queueLessonChangeEmails(db,target.id,"rescheduled",id)));
      return json({ booking: data, correlationId:id, queuedSideEffects:["calendar_projection",...queued.map((item:any)=>`email:${item.id}`)] });
    }

    if (action === "cancel-series" && booking.series_id) {
      const {data:before,error:readError}=await db.from("recurring_series").select("*").eq("id",booking.series_id).single();if(readError||!before)throw readError||new Error("INVALID_TRANSITION");
      if(before.stripe_subscription_id){const stripeKey=Netlify.env.get("STRIPE_SECRET_KEY");if(!stripeKey)throw new Error("Stripe is not configured.");await new Stripe(stripeKey,{apiVersion:"2026-07-29.dahlia"}).subscriptions.update(before.stripe_subscription_id,{cancel_at_period_end:true});}
      const { data, error } = await db.from("recurring_series").update({ status: "cancel_at_period_end",version:before.version+1, updated_at: new Date().toISOString() }).eq("id", booking.series_id).eq("version",before.version).select().single();
      if (error) throw error;
      await db.from("audit_events").insert({studio_id:before.studio_id,entity_type:"recurring_series",entity_id:before.id,action:"series.cancel_at_period_end",reason:"Student or guardian ended recurring plan",correlation_id:id,source:"booking_portal",before_state:before,after_state:data});
      return json({ series: data });
    }
    throw new Error("VALIDATION_FAILED: Unsupported booking action.");
  } catch (error) { return apiError(error, id); }
};

export const config: Config = { path: "/api/v2/portal/bookings/:action" };
