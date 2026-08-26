import type { Config, Context } from "@netlify/functions";
import Stripe from "stripe";
import { apiError, correlationId, json } from "./_shared/http";
import { serviceClient } from "./_shared/supabase";
import { ensureBookingPortalAccess } from "./_shared/portal-access";
import { queueBookingEmails, queueLessonChangeEmails, queuePaymentFailedEmail } from "./_shared/booking-email";

export default async (request: Request, context: Context) => {
  const id = correlationId(request, context.requestId);
  let eventId: string | undefined;
  try {
    if (request.method !== "POST") return json({ code: "METHOD_NOT_ALLOWED", message: "Method not allowed.", retryable: false, correlationId: id }, 405);
    const key = Netlify.env.get("STRIPE_SECRET_KEY"), secret = Netlify.env.get("STRIPE_WEBHOOK_SECRET");
    if (!key || !secret) throw new Error("Stripe webhook is not configured.");
    const stripe = new Stripe(key, { apiVersion: "2026-07-29.dahlia" });
    const raw = await request.text();
    const event = stripe.webhooks.constructEvent(raw, request.headers.get("stripe-signature") || "", secret);
    const db = serviceClient(), object: any = event.data.object;
    eventId = event.id;
    const { data: existing } = await db.from("webhook_events").select("status").eq("id", event.id).maybeSingle();
    if (existing?.status === "processed") return json({ ok: true, duplicate: true });
    if (existing) await db.from("webhook_events").update({ status: "processing", error: null, processed_at: null, payload: event as unknown as Record<string, unknown> }).eq("id", event.id);
    else {
      const { error } = await db.from("webhook_events").insert({ id: event.id, provider: "stripe", event_type: event.type, payload: event as unknown as Record<string, unknown>, status: "processing" });
      if (error) throw error;
    }
    const done = async (payload: Record<string, unknown> = {}) => { await db.from("webhook_events").update({ status: "processed", processed_at: new Date().toISOString(), error: null }).eq("id", event.id); return json({ ok: true, ...payload }); };

    if (event.type === "checkout.session.completed") {
      // Payment-method Checkout sessions are completed by the subsequent
      // setup_intent event; they are never package purchases.
      if (object.mode === "setup") return done({ setup: true });
      const bookingId = object.metadata?.booking_id, holdId = object.metadata?.hold_id;
      if (bookingId && holdId) {
        const amount = object.mode === "subscription" ? 0 : object.amount_total || 0;
        const { data, error } = await db.rpc("confirm_booking", { target_booking: bookingId, target_hold: holdId, amount_paid: amount, provider_reference: object.id });
        if (error) throw error;
        if (object.subscription) {
          const subscriptionId = String(object.subscription);
          const { data: booking } = await db.from("bookings").update({ stripe_subscription_id: subscriptionId }).eq("id", bookingId).select("series_id").single();
          if (booking?.series_id) await db.from("recurring_series").update({ stripe_subscription_id: subscriptionId }).eq("id", booking.series_id);
        }
        const manageToken = object.metadata?.manage_token;
        if(object.customer){const {data:confirmed}=await db.from("bookings").update({stripe_customer_id:String(object.customer)}).eq("id",bookingId).select("student_id").single();if(confirmed?.student_id)await db.from("students").update({stripe_customer_id:String(object.customer),updated_at:new Date().toISOString()}).eq("id",confirmed.student_id);}
        await queueBookingEmails(db,bookingId,manageToken,new URL(request.url).origin);
        try { await ensureBookingPortalAccess(db, bookingId, new URL(request.url).origin); } catch (inviteError) { await db.from("recommendations").upsert({ studio_id: (await db.from("bookings").select("studio_id").eq("id", bookingId).single()).data?.studio_id, entity_type: "booking", entity_id: bookingId, reason_code: "portal_invitation_failed", title: "Portal invitation needs retry", explanation: "The booking is confirmed, but Supabase could not send or link portal access.", evidence: [String(inviteError)], urgency: 4, suggested_action: "retry_portal_invitation", requires_confirmation: false, status: "open", dedupe_key: `booking:${bookingId}:portal-invite` }, { onConflict: "dedupe_key" }); }
        return done(data as Record<string, unknown>);
      }
      const studentId = object.metadata?.student_id, packageId = object.metadata?.package_id;
      if (!studentId || !packageId) throw new Error("VALIDATION_FAILED: Checkout metadata is incomplete.");
      const { data, error } = await db.rpc("process_stripe_checkout", { event_id: event.id, event_type: event.type, event_payload: event as unknown as Record<string, unknown>, session_id: object.id, student_id: studentId, package_id: packageId, amount_minor: object.amount_total || 0, currency: object.currency || "usd" });
      if (error) throw error;
      return done(data as Record<string, unknown>);
    }

    if (event.type === "invoice.payment_failed" || event.type === "invoice.paid") {
      const subscriptionId = String(object.parent?.subscription_details?.subscription || object.subscription || "");
      const metadata = object.parent?.subscription_details?.metadata ?? {};
      let bookingId = metadata.booking_id as string | undefined;
      if (!bookingId && subscriptionId) {
        const subscription = await stripe.subscriptions.retrieve(subscriptionId);
        bookingId = subscription.metadata.booking_id;
        Object.assign(metadata, subscription.metadata);
      }
      if (event.type === "invoice.paid" && bookingId && metadata.hold_id) {
        const { data: current } = await db.from("bookings").select("status").eq("id", bookingId).maybeSingle();
        if (current && current.status !== "confirmed") {
          const { error } = await db.rpc("confirm_booking", { target_booking: bookingId, target_hold: metadata.hold_id, amount_paid: object.amount_paid || 0, provider_reference: object.id });
          if (error) throw error;
          await queueBookingEmails(db, bookingId, metadata.manage_token, new URL(request.url).origin);
          await ensureBookingPortalAccess(db, bookingId, new URL(request.url).origin);
        }
      }
      if (subscriptionId) {
        const status = event.type === "invoice.paid" ? "paid" : "past_due";
        const { data: series } = await db.from("recurring_series").select("id,studio_id").eq("stripe_subscription_id", subscriptionId).maybeSingle();
        if (series) {
          await db.from("bookings").update({ payment_status: status, status: status === "past_due" ? "needs_attention" : "confirmed", updated_at: new Date().toISOString() }).eq("series_id", series.id);
          await db.from("recommendations").upsert({ studio_id: series.studio_id, entity_type: "recurring_series", entity_id: series.id, reason_code: status === "past_due" ? "subscription_past_due" : "subscription_recovered", title: status === "past_due" ? "Subscription payment needs attention" : "Subscription payment recovered", explanation: status === "past_due" ? "Stripe could not collect the recurring payment. Future occurrences are protected for seven days." : "The recurring payment is current again.", evidence: [`Stripe invoice ${object.id}`], urgency: status === "past_due" ? 5 : 2, suggested_action: "review_subscription", requires_confirmation: true, status: status === "past_due" ? "open" : "resolved", dedupe_key: `subscription:${subscriptionId}:payment` }, { onConflict: "dedupe_key" });
          if (status === "past_due") await db.from("outbox_messages").insert({ studio_id: series.studio_id, booking_id: bookingId ?? null, channel: "email", recipient: Netlify.env.get("GOOGLE_ACCOUNT_EMAIL") || "coach@stageandstory.local", subject: "A recurring payment failed", body: `Stripe invoice ${object.id} failed. The seven-day grace period has started.`, status: "queued", send_at: new Date().toISOString() });
        }
        const { data: linked } = bookingId ? await db.from("bookings").select("id,studio_id,student_id,guest_email,guardian_email,currency,paid_minor,installments_paid,installment_count,installment_remainder_minor,payment_policy").eq("id", bookingId).maybeSingle() : await db.from("bookings").select("id,studio_id,student_id,guest_email,guardian_email,currency,paid_minor,installments_paid,installment_count,installment_remainder_minor,payment_policy").eq("stripe_subscription_id", subscriptionId).maybeSingle();
        if (linked) {
          if (event.type === "invoice.payment_failed") {
            await db.from("bookings").update({ payment_status: "past_due", status: "needs_attention", updated_at: new Date().toISOString() }).eq("id", linked.id);
            await queuePaymentFailedEmail(db,linked.id);
          } else {
            const amount = Number(object.amount_paid || 0);
            if (linked.payment_policy === "installments") {
              const paidCount = linked.installments_paid + 1;
              await db.from("bookings").update({ payment_status: paidCount >= (linked.installment_count || 1) ? "paid" : "partially_paid", status: "confirmed", paid_minor: linked.paid_minor + amount, installments_paid: paidCount, updated_at: new Date().toISOString() }).eq("id", linked.id);
              if(linked.installment_count&&paidCount===linked.installment_count-1&&linked.installment_remainder_minor>0&&object.customer)await stripe.invoiceItems.create({customer:String(object.customer),subscription:subscriptionId,amount:linked.installment_remainder_minor,currency:String(object.currency||linked.currency).toLowerCase(),description:"Final installment rounding adjustment"});
              if (linked.installment_count && paidCount >= linked.installment_count) await stripe.subscriptions.cancel(subscriptionId);
            } else await db.from("bookings").update({ payment_status: "paid", status: "confirmed", paid_minor: amount, updated_at: new Date().toISOString() }).eq("id", linked.id);
            if (linked.student_id && amount > 0) await db.from("payment_entries").upsert({ student_id: linked.student_id, kind: "payment", amount_minor: amount, currency: String(object.currency || linked.currency).toUpperCase(), external_reference: object.id, reason: linked.payment_policy === "installments" ? "Booking installment" : "Subscription payment" }, { onConflict: "external_reference", ignoreDuplicates: true });
          }
        }
      }
      return done();
    }

    if (event.type === "customer.subscription.updated") {
      const status = object.cancel_at_period_end ? "cancel_at_period_end" : object.status === "active" ? "active" : undefined;
      if (status) await db.from("recurring_series").update({ status, updated_at: new Date().toISOString() }).eq("stripe_subscription_id", String(object.id));
      return done();
    }
    if(event.type==="setup_intent.succeeded"){
      const customerId=typeof object.customer==="string"?object.customer:object.customer?.id,paymentMethodId=typeof object.payment_method==="string"?object.payment_method:object.payment_method?.id;if(customerId&&paymentMethodId){const method=await stripe.paymentMethods.retrieve(paymentMethodId),card=method.card,summary=card?{label:`${card.brand.toUpperCase()} ending in ${card.last4}`,brand:card.brand,last4:card.last4,expires:`${card.exp_month}/${card.exp_year}`}:{label:"Payment method saved"};const {error:updateError}=await db.from("students").update({payment_method_summary:summary,updated_at:new Date().toISOString()}).eq("stripe_customer_id",customerId);if(updateError)throw updateError;}return done();
    }
    if (event.type === "customer.subscription.deleted") {
      const subscriptionId = String(object.id);
      const { data: linked } = await db.from("bookings").select("id,payment_policy,installments_paid,installment_count").eq("stripe_subscription_id", subscriptionId).maybeSingle();
      const installmentsComplete = Boolean(linked?.payment_policy === "installments" && linked.installment_count && linked.installments_paid >= linked.installment_count);
      const cutoffSeconds = Number(object.ended_at || object.cancel_at || object.items?.data?.[0]?.current_period_end || Math.floor(Date.now() / 1000));
      const { data: termination, error: terminationError } = await db.rpc("finalize_subscription_termination", {
        subscription_id: subscriptionId,
        cutoff: new Date(cutoffSeconds * 1000).toISOString(),
        installments_complete: installmentsComplete,
      });
      if (terminationError) throw terminationError;
      for (const lessonId of Array.isArray(termination?.lessonIds) ? termination.lessonIds : [])
        await queueLessonChangeEmails(db, lessonId, "cancelled", id);
      return done({ installmentsComplete });
    }
    if (event.type === "checkout.session.expired") {
      const {data:expiredBooking}=await db.from("bookings").select("hold_ids").eq("stripe_checkout_session_id",object.id).maybeSingle();if(expiredBooking?.hold_ids?.length)await db.from("booking_holds").update({status:"expired"}).in("id",expiredBooking.hold_ids);else await db.from("booking_holds").update({ status: "expired" }).eq("checkout_session_id", object.id);
      await db.from("bookings").update({ status: "expired", payment_status: "failed", updated_at: new Date().toISOString() }).eq("stripe_checkout_session_id", object.id);
      return done();
    }
    if (event.type === "charge.refunded" || event.type === "refund.updated") {
      const refund = event.type === "refund.updated" ? object : object.refunds?.data?.find((item: any) => item.status === "succeeded") ?? object.refunds?.data?.[0];
      const bookingId = refund?.metadata?.booking_id;
      if (bookingId && (!refund.status || refund.status === "succeeded")) {
        const { data: booking } = await db.from("bookings").update({ payment_status: "refunded", updated_at: new Date().toISOString() }).eq("id", bookingId).select("student_id,currency,reference").maybeSingle();
        if (booking?.student_id) await db.from("payment_entries").upsert({ student_id: booking.student_id, kind: "refund", amount_minor: Number(refund.amount || object.amount_refunded || 0), currency: String(refund.currency || object.currency || booking.currency).toUpperCase(), external_reference: refund.id, reason: `Stripe refund ${booking.reference}` }, { onConflict: "external_reference", ignoreDuplicates: true });
      }
      return done();
    }
    return done({ ignored: event.type });
  } catch (error) {
    if (eventId) { try { await serviceClient().from("webhook_events").update({ status: "failed", error: String(error), processed_at: new Date().toISOString() }).eq("id", eventId); } catch { /* preserve original error */ } }
    return apiError(error, id);
  }
};

export const config: Config = { path: "/api/v2/stripe-webhook" };
