import type { SupabaseClient } from "@supabase/supabase-js";
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
  const { db, booking, correlationId } = input;
  if (booking.status !== "confirmed") throw new Error("INVALID_TRANSITION");
  const { data, error } = await db.rpc("cancel_booking_credit", {
    p_booking: booking.id,
    p_version: booking.version,
    p_use: false,
    p_student_action: true,
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
          booking.student_id
            ? { studentId: booking.student_id, bookingId: booking.id }
            : undefined,
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
