import type { Config, Context } from "@netlify/functions";
import Stripe from "stripe";
import { apiError, correlationId, json } from "./_shared/http";
import { serviceClient } from "./_shared/supabase";
import { ensureBookingPortalAccess } from "./_shared/portal-access";
import { queueBookingEmails, queueLessonChangeEmails, queuePaymentFailedEmail } from "./_shared/booking-email";
import { dispatchOutbox } from "./_shared/outbox-dispatch";

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
      const giftId=object.metadata?.package_gift_id;
      if(giftId){
        const {data:gift,error:giftError}=await db.from("package_gifts").select("*,package_definitions(*)").eq("id",giftId).single();
        if(giftError||!gift)throw giftError||new Error("Package gift not found.");
        const definition=Array.isArray(gift.package_definitions)?gift.package_definitions[0]:gift.package_definitions;
        let {data:recipient}=await db.from("students").select("id").eq("studio_id",gift.studio_id).ilike("email",gift.recipient_email).is("deleted_at",null).limit(1).maybeSingle();
        if(!recipient){const legacy=await db.from("students").select("id").eq("studio_id",gift.studio_id).ilike("guardian_email",gift.recipient_email).is("deleted_at",null).limit(1).maybeSingle();recipient=legacy.data;}
        if(!recipient){const {data:contact}=await db.from("linked_contacts").select("student_id").eq("studio_id",gift.studio_id).ilike("email",gift.recipient_email).eq("portal_enabled",true).limit(1).maybeSingle();if(contact)recipient={id:contact.student_id};}
        await db.from("package_gifts").update({status:"purchased",updated_at:new Date().toISOString()}).eq("id",gift.id).eq("status","pending_payment");
        const deliversLater=Boolean(gift.deliver_at&&new Date(gift.deliver_at)>new Date());
        if(recipient&&!deliversLater){const claimed=await db.rpc("claim_package_gift",{target_gift:gift.id,target_student:recipient.id,apply_automatically:false});if(claimed.error)throw claimed.error;}
        const claimUrl=`${Netlify.env.get("URL")||new URL(request.url).origin}/gift/claim/${object.metadata?.claim_token}`;
        await db.from("outbox_messages").upsert({studio_id:gift.studio_id,channel:"email",recipient:gift.recipient_email,subject:`${gift.purchaser_name} sent you a Coach'D lesson package`,body:[`Hello ${gift.recipient_name},`,"",`${gift.purchaser_name} sent you ${definition.name}.`,gift.message?`Message: ${gift.message}`:"",recipient?(deliversLater?"The credits will be added to your portal on the delivery date.":"The credits are already in your portal."):`Claim your gift: ${claimUrl}`,"","Gifts never create recurring charges."].filter(Boolean).join("\n"),status:"queued",send_at:gift.deliver_at||new Date().toISOString(),event_key:"package.gift",dedupe_key:`package-gift:${gift.id}:delivery`,priority:85},{onConflict:"dedupe_key",ignoreDuplicates:true});
        return done({packageGift:true});
      }
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
        try { const access=await ensureBookingPortalAccess(db, bookingId, new URL(request.url).origin);const accounts=Array.isArray((access as any).accounts)?(access as any).accounts:[access];const ids=accounts.map((account:any)=>account?.outboxMessageId).filter(Boolean);if(ids.length)context.waitUntil(dispatchOutbox({ids})); } catch (inviteError) { await db.from("recommendations").upsert({ studio_id: (await db.from("bookings").select("studio_id").eq("id", bookingId).single()).data?.studio_id, entity_type: "booking", entity_id: bookingId, reason_code: "portal_invitation_failed", title: "Portal invitation needs retry", explanation: "The booking is confirmed, but Supabase could not send or link portal access.", evidence: [String(inviteError)], urgency: 4, suggested_action: "retry_portal_invitation", requires_confirmation: false, status: "open", dedupe_key: `booking:${bookingId}:portal-invite` }, { onConflict: "dedupe_key" }); }
        return done(data as Record<string, unknown>);
      }
      const studentId = object.metadata?.student_id, packageId = object.metadata?.package_id;
      if (!studentId || !packageId) throw new Error("VALIDATION_FAILED: Checkout metadata is incomplete.");
      const packageSubscriptionId = object.metadata?.package_subscription_id;
      let data: unknown = { subscriptionCheckout: object.mode === "subscription" };
      if (!(packageSubscriptionId && object.mode === "subscription")) {
        const processed = await db.rpc("process_stripe_checkout", { event_id: event.id, event_type: event.type, event_payload: event as unknown as Record<string, unknown>, session_id: object.id, student_id: studentId, package_id: packageId, amount_minor: object.amount_total || 0, currency: object.currency || "usd" });
        if (processed.error) throw processed.error;
        data = processed.data;
      }
      if (packageSubscriptionId) {
        const stripeSubscriptionId = object.subscription ? String(object.subscription) : null;
        await db.from("package_subscriptions").update({
          status: "active",
          stripe_customer_id: object.customer ? String(object.customer) : null,
          stripe_subscription_id: stripeSubscriptionId,
          next_billing_at: stripeSubscriptionId ? new Date(((object.subscription_details?.current_period_end || 0) * 1000) || Date.now()).toISOString() : null,
          updated_at: new Date().toISOString(),
        }).eq("id", packageSubscriptionId);
        if (object.customer)
          await db.from("students").update({ stripe_customer_id: String(object.customer), updated_at: new Date().toISOString() }).eq("id", studentId);
      }
      return done(data as Record<string, unknown>);
    }

    if (event.type === "invoice.payment_failed" || event.type === "invoice.paid") {
      const subscriptionId = String(object.parent?.subscription_details?.subscription || object.subscription || "");
      const metadata = { ...(object.metadata || {}), ...(object.parent?.subscription_details?.metadata || {}) };
      let bookingId = metadata.booking_id as string | undefined;
      if (!bookingId && subscriptionId) {
        const subscription = await stripe.subscriptions.retrieve(subscriptionId);
        bookingId = subscription.metadata.booking_id;
        Object.assign(metadata, subscription.metadata);
      }
      const packageSubscriptionId = String(metadata.package_subscription_id || "");
      if (packageSubscriptionId) {
        const { data: packageSubscription, error: packageSubscriptionError } = await db.from("package_subscriptions").select("*,package_definitions(session_count,currency,name)").eq("id", packageSubscriptionId).single();
        if (packageSubscriptionError || !packageSubscription) throw packageSubscriptionError || new Error("Package subscription not found.");
        if (event.type === "invoice.payment_failed") {
          await db.from("package_subscriptions").update({ status: "past_due", last_invoice_id: object.id, renewal_in_flight: false, renewal_attempt_key: null, renewal_claimed_at: null, updated_at: new Date().toISOString() }).eq("id", packageSubscription.id);
          const { data: student } = await db.from("students").select("email,guardian_email,full_name,is_minor").eq("id", packageSubscription.student_id).single();
          const recipient = student?.is_minor ? student.guardian_email || student.email : student?.email || student?.guardian_email;
          if (recipient) await db.from("outbox_messages").upsert({ studio_id: packageSubscription.studio_id, student_id: packageSubscription.student_id, channel: "email", recipient, subject: "Your Coach'D package renewal needs attention", body: "We could not collect your package renewal. Your existing earned lesson credits remain available. Please update your payment method in the portal.", status: "queued", send_at: new Date().toISOString(), event_key: "package.renewal_failed", dedupe_key: `package-subscription:${packageSubscription.id}:invoice:${object.id}:failed`, priority: 90 }, { onConflict: "dedupe_key", ignoreDuplicates: true });
        } else {
          const definition = Array.isArray(packageSubscription.package_definitions) ? packageSubscription.package_definitions[0] : packageSubscription.package_definitions;
          await db.from("package_credit_entries").upsert({ package_id: packageSubscription.package_id, kind: "purchase", quantity: Number(definition?.session_count || 1), reason: `Package renewal · ${object.id}`, idempotency_key: `package-subscription-invoice:${object.id}` }, { onConflict: "idempotency_key", ignoreDuplicates: true });
          await db.from("package_subscriptions").update({ status: "active", last_invoice_id: object.id, next_billing_at: object.lines?.data?.[0]?.period?.end ? new Date(Number(object.lines.data[0].period.end) * 1000).toISOString() : null, renewal_in_flight: false, renewal_attempt_key: null, renewal_claimed_at: null, updated_at: new Date().toISOString() }).eq("id", packageSubscription.id);
          if (Number(object.amount_paid || 0) > 0) await db.from("payment_entries").upsert({ student_id: packageSubscription.student_id, package_id: packageSubscription.package_id, kind: "payment", amount_minor: Number(object.amount_paid), currency: String(object.currency || definition?.currency || "USD").toUpperCase(), external_reference: object.id, reason: "Package subscription renewal" }, { onConflict: "external_reference", ignoreDuplicates: true });
        }
        return done({ packageSubscription: true });
      }
      if (event.type === "invoice.paid" && bookingId && metadata.hold_id) {
        const { data: current } = await db.from("bookings").select("status").eq("id", bookingId).maybeSingle();
        if (current && current.status !== "confirmed") {
          const { error } = await db.rpc("confirm_booking", { target_booking: bookingId, target_hold: metadata.hold_id, amount_paid: object.amount_paid || 0, provider_reference: object.id });
          if (error) throw error;
          await queueBookingEmails(db, bookingId, metadata.manage_token, new URL(request.url).origin);
          const access=await ensureBookingPortalAccess(db, bookingId, new URL(request.url).origin);const accounts=Array.isArray((access as any).accounts)?(access as any).accounts:[access];const ids=accounts.map((account:any)=>account?.outboxMessageId).filter(Boolean);if(ids.length)context.waitUntil(dispatchOutbox({ids}));
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
      if (status) {
        const { data: packageSubscription } = await db.from("package_subscriptions").update({ status, next_billing_at: object.items?.data?.[0]?.current_period_end ? new Date(Number(object.items.data[0].current_period_end) * 1000).toISOString() : null, updated_at: new Date().toISOString() }).eq("stripe_subscription_id", String(object.id)).select("id").maybeSingle();
        if (!packageSubscription) await db.from("recurring_series").update({ status, updated_at: new Date().toISOString() }).eq("stripe_subscription_id", String(object.id));
      }
      return done();
    }
    if(event.type==="setup_intent.succeeded"){
      const customerId=typeof object.customer==="string"?object.customer:object.customer?.id,paymentMethodId=typeof object.payment_method==="string"?object.payment_method:object.payment_method?.id;if(customerId&&paymentMethodId){const method=await stripe.paymentMethods.retrieve(paymentMethodId),card=method.card,summary=card?{label:`${card.brand.toUpperCase()} ending in ${card.last4}`,brand:card.brand,last4:card.last4,expires:`${card.exp_month}/${card.exp_year}`}:{label:"Payment method saved"};const {error:updateError}=await db.from("students").update({payment_method_summary:summary,updated_at:new Date().toISOString()}).eq("stripe_customer_id",customerId);if(updateError)throw updateError;}return done();
    }
    if (event.type === "customer.subscription.deleted") {
      const subscriptionId = String(object.id);
      const { data: packageSubscription } = await db.from("package_subscriptions").update({ status: "cancelled", updated_at: new Date().toISOString() }).eq("stripe_subscription_id", subscriptionId).select("id").maybeSingle();
      if (packageSubscription) return done({ packageSubscription: true });
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
      if(object.metadata?.package_gift_id){await db.from("package_gifts").update({status:"expired",updated_at:new Date().toISOString()}).eq("id",object.metadata.package_gift_id).eq("status","pending_payment");return done({packageGift:true});}
      if(object.metadata?.package_id){
        const packageId=String(object.metadata.package_id),packageSubscriptionId=String(object.metadata.package_subscription_id||"");
        if(packageSubscriptionId)await db.from("package_subscriptions").delete().eq("id",packageSubscriptionId).eq("status","pending");
        const {count}=await db.from("package_credit_entries").select("id",{count:"exact",head:true}).eq("package_id",packageId);
        if(!count)await db.from("packages").delete().eq("id",packageId);
        return done({packageCheckout:true});
      }
      const {data:expiredBooking}=await db.from("bookings").select("hold_ids").eq("stripe_checkout_session_id",object.id).maybeSingle();if(expiredBooking?.hold_ids?.length)await db.from("booking_holds").update({status:"expired"}).in("id",expiredBooking.hold_ids);else await db.from("booking_holds").update({ status: "expired" }).eq("checkout_session_id", object.id);
      await db.from("bookings").update({ status: "expired", payment_status: "failed", updated_at: new Date().toISOString() }).eq("stripe_checkout_session_id", object.id);
      return done();
    }
    if (event.type === "charge.refunded" || event.type === "refund.updated") {
      const refund = event.type === "refund.updated" ? object : object.refunds?.data?.find((item: any) => item.status === "succeeded") ?? object.refunds?.data?.[0];
      const bookingId = refund?.metadata?.booking_id;
      const giftId=refund?.metadata?.package_gift_id||object.metadata?.package_gift_id;
      if(giftId&&(!refund.status||refund.status==="succeeded")){const reversed=await db.rpc("refund_package_gift",{target_gift:giftId});if(reversed.error)throw reversed.error;return done({packageGift:true});}
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
