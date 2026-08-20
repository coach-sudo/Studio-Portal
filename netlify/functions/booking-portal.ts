import type { Config, Context } from "@netlify/functions";
import Stripe from "stripe";
import { apiError, correlationId, json } from "./_shared/http";
import { googleAccessToken, googleFreeBusy } from "./_shared/google";
import { serviceClient, userClient } from "./_shared/supabase";

export default async (request: Request, context: Context) => {
  const id = correlationId(request, context.requestId);
  try {
    if (request.method !== "POST") return json({ code: "METHOD_NOT_ALLOWED", message: "Method not allowed.", retryable: false, correlationId: id }, 405);
    const action = context.params.action;
    const body = await request.json() as { studentId?: string; bookingId?: string; startsAt?: string; endsAt?: string; scope?: "occurrence" | "series" };
    const userDb = userClient(request);
    if(action==="payment-method"||action==="billing"){
      if(!body.studentId)throw new Error("VALIDATION_FAILED: studentId is required.");
      const {data:student,error:studentError}=await userDb.from("students").select("id,studio_id,email,guardian_email,stripe_customer_id").eq("id",body.studentId).single();if(studentError||!student)throw new Error("FORBIDDEN");const stripeKey=Netlify.env.get("STRIPE_SECRET_KEY");if(!stripeKey)throw new Error("Stripe is not configured.");const stripe=new Stripe(stripeKey,{apiVersion:"2026-07-29.dahlia"});let customerId=student.stripe_customer_id as string|undefined;
      if(!customerId){const customer=await stripe.customers.create({email:student.guardian_email||student.email||undefined,metadata:{student_id:student.id,studio_id:student.studio_id}},{idempotencyKey:`student-customer:${student.id}`});customerId=customer.id;const {error:updateError}=await serviceClient().from("students").update({stripe_customer_id:customerId,updated_at:new Date().toISOString()}).eq("id",student.id);if(updateError)throw updateError;}
      const origin=new URL(request.url).origin;
      if(action==="payment-method"){const session=await stripe.checkout.sessions.create({mode:"setup",customer:customerId,payment_method_types:["card"],client_reference_id:student.id,success_url:`${origin}/student/settings?payment=updated`,cancel_url:`${origin}/student/settings?payment=cancelled`,metadata:{student_id:student.id,studio_id:student.studio_id}},{idempotencyKey:request.headers.get("idempotency-key")||`setup:${student.id}:${Math.floor(Date.now()/30000)}`});if(!session.url)throw new Error("Stripe did not return a setup URL.");return json({url:session.url});}
      const session=await stripe.billingPortal.sessions.create({customer:customerId,return_url:`${origin}/student/settings`});return json({url:session.url});
    }
    if (!body.bookingId) throw new Error("VALIDATION_FAILED: bookingId is required.");
    const { data: booking, error: accessError } = await userDb.from("bookings").select("*").eq("id", body.bookingId).single();
    if (accessError || !booking) throw new Error("FORBIDDEN");
    const db = serviceClient();

    if (action === "cancel") {
      if(booking.status!=="confirmed")throw new Error("INVALID_TRANSITION");
      const late = new Date(booking.starts_at).getTime() - Date.now() < Number(booking.policy_snapshot.cancellationWindowHours) * 3_600_000;
      const status = late ? "late_cancelled" : "cancelled";
      const { data: participants } = await db.from("lesson_participants").select("lesson_id").eq("booking_id", booking.id);
      const lessonIds = (participants ?? []).map((item) => item.lesson_id);
      if (lessonIds.length) {
        await Promise.all([
          db.from("lessons").update({ status, updated_at: new Date().toISOString() }).in("id", lessonIds),
          db.from("lesson_participants").update({ status: "cancelled" }).eq("booking_id", booking.id),
          db.from("calendar_projections").update({ status: "queued", last_error: null }).in("lesson_id", lessonIds),
        ]);
      }
      if(booking.offering_id)await db.rpc("release_offering_seat",{target_offering:booking.offering_id});
      let paymentStatus = booking.payment_status;
      if(!late&&booking.payment_policy==="credits"){
        const {data:reservations}=await db.from("package_credit_entries").select("id,package_id,quantity").eq("idempotency_key",`booking-credit:${booking.id}`);
        for(const reservation of reservations||[])await db.from("package_credit_entries").insert({package_id:reservation.package_id,kind:"release",quantity:Math.abs(reservation.quantity),reason:`Booking cancellation ${booking.reference}`,idempotency_key:`booking-credit-release:${booking.id}:${reservation.id}`});
        paymentStatus="refunded";
      }
      if(!late&&booking.policy_snapshot.settlement==="studio_credit"&&booking.paid_minor>0&&booking.student_id){await db.from("payment_entries").insert({student_id:booking.student_id,kind:"refund",amount_minor:booking.paid_minor,currency:booking.currency,external_reference:`studio-credit:${booking.id}:${booking.version}`,reason:`Studio account credit for ${booking.reference}`});paymentStatus="refunded";}
      if (!late && booking.policy_snapshot.settlement === "original_payment" && booking.paid_minor > 0 && booking.stripe_checkout_session_id) {
        const stripeKey = Netlify.env.get("STRIPE_SECRET_KEY");
        if (!stripeKey) throw new Error("Stripe is not configured.");
        const stripe = new Stripe(stripeKey, { apiVersion: "2026-07-29.dahlia" });
        const session = await stripe.checkout.sessions.retrieve(booking.stripe_checkout_session_id);
        const paymentIntent = typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id;
        if (paymentIntent) {
          const refund = await stripe.refunds.create({ payment_intent: paymentIntent, amount: booking.paid_minor, metadata: { booking_id: booking.id } }, { idempotencyKey: `self-cancel:${booking.id}:${booking.version}` });
          if (booking.student_id) await db.from("payment_entries").insert({ student_id: booking.student_id, kind: "refund", amount_minor: booking.paid_minor, currency: booking.currency, external_reference: refund.id, reason: `Booking cancellation ${booking.reference}` });
          paymentStatus = "refunded";
        }
      }
      const { data, error } = await db.from("bookings").update({ status, payment_status: paymentStatus, version: booking.version + 1, updated_at: new Date().toISOString() }).eq("id", booking.id).eq("version", booking.version).select().single();
      if (error) throw error;
      await db.from("audit_events").insert({studio_id:booking.studio_id,entity_type:"booking",entity_id:booking.id,action:"booking.self_cancelled",reason:late?"Late self-service cancellation":"Permitted self-service cancellation",correlation_id:id,source:"booking_portal",before_state:booking,after_state:data});
      return json({ booking: data });
    }

    if (action === "reschedule" && body.startsAt && body.endsAt) {
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
      return json({ booking: data });
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
