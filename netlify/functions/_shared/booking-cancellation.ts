import type { SupabaseClient } from "@supabase/supabase-js";
import Stripe from "stripe";
import { queueLessonChangeEmails } from "./booking-email";

type BookingForCancellation = {
  id: string;
  reference: string;
  studio_id: string;
  student_id?: string | null;
  starts_at: string;
  status: string;
  payment_policy: string;
  payment_status: string;
  paid_minor: number;
  currency: string;
  policy_snapshot: Record<string, unknown>;
  version: number;
  stripe_checkout_session_id?: string | null;
};

export async function cancelConfirmedBooking(input: {
  db: SupabaseClient;
  booking: BookingForCancellation;
  correlationId: string;
  stripeIdempotencyPrefix: string;
}) {
  const { db, booking, correlationId, stripeIdempotencyPrefix } = input;
  if (booking.status !== "confirmed") throw new Error("INVALID_TRANSITION");
  const windowHours = Number(booking.policy_snapshot.cancellationWindowHours || 0);
  const late = new Date(booking.starts_at).getTime() - Date.now() < windowHours * 3_600_000;
  if (late)
    throw new Error(
      `VALIDATION_FAILED: Online cancellation closes ${windowHours} hours before the lesson. Contact the studio if you need help.`,
    );

  let refundReference: string | null = null;
  let refundAmount = 0;
  const settlement = String(booking.policy_snapshot.settlement || "original_payment");
  // Provider money moves first. The following RPC atomically applies every
  // authoritative local consequence only after Stripe accepted the refund.
  if (
    settlement === "original_payment" &&
    booking.paid_minor > 0 &&
    booking.stripe_checkout_session_id
  ) {
    const stripeKey = Netlify.env.get("STRIPE_SECRET_KEY");
    if (!stripeKey) throw new Error("Stripe is not configured.");
    const stripe = new Stripe(stripeKey, { apiVersion: "2026-07-29.dahlia" });
    const session = await stripe.checkout.sessions.retrieve(
      booking.stripe_checkout_session_id,
    );
    const paymentIntent =
      typeof session.payment_intent === "string"
        ? session.payment_intent
        : session.payment_intent?.id;
    if (!paymentIntent)
      throw new Error(
        "PAYMENT_PROVIDER_ERROR: The original payment could not be located. No cancellation was applied.",
      );
    const refund = await stripe.refunds.create(
      {
        payment_intent: paymentIntent,
        amount: booking.paid_minor,
        metadata: { booking_id: booking.id },
      },
      {
        idempotencyKey: `${stripeIdempotencyPrefix}:${booking.id}:${booking.version}`,
      },
    );
    refundReference = refund.id;
    refundAmount = Number(refund.amount || booking.paid_minor);
  }

  const { data, error } = await db.rpc("finalize_booking_cancellation", {
    target_booking: booking.id,
    expected_version: booking.version,
    target_status: "cancelled",
    refund_reference: refundReference,
    refund_amount: refundAmount,
    correlation_id: correlationId,
  });
  if (error) throw error;

  const lessonIds = Array.isArray(data?.lessonIds)
    ? (data.lessonIds as string[])
    : [];
  const queued: Array<{ id: string }> = [];
  for (const lessonId of lessonIds) {
    try {
      queued.push(
        ...((await queueLessonChangeEmails(
          db,
          lessonId,
          "cancelled",
          correlationId,
        )) as Array<{ id: string }>),
      );
    } catch (emailError) {
      await db.from("recommendations").upsert(
        {
          studio_id: booking.studio_id,
          entity_type: "lesson",
          entity_id: lessonId,
          reason_code: "lesson_change_email_failed",
          title: "Cancellation email needs retry",
          explanation:
            "The booking is cancelled, but its notification could not be queued.",
          evidence: [String(emailError), correlationId],
          urgency: 4,
          suggested_action: "retry_outbox",
          requires_confirmation: false,
          status: "open",
          dedupe_key: `lesson:${lessonId}:cancel-email`,
        },
        { onConflict: "dedupe_key" },
      );
    }
  }
  return {
    booking: data.booking,
    lessonIds,
    queuedSideEffects: [
      "calendar_projection",
      ...queued.map((item) => `email:${item.id}`),
    ],
  };
}
