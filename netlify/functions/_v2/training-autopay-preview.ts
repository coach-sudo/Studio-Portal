import { z } from "zod";
import { AppError, json } from "../_shared/http";
import { typedServiceClient } from "../_shared/supabase";
import { trainingCheckout } from "../_shared/training-checkout";
import {
  previewLessonAutopay,
  type AutopayOccurrence,
  type AutopayPreviewOptions,
} from "../../../src/domain/lessonAutopay";
import {
  trainingObligations,
  lessonPaymentState,
} from "../../../src/domain/trainingArrangement";
import type { Invoice } from "../../../src/domain/invoices";
import { studioDateKey } from "../../../src/domain/presentation";

export const autopaySelectionObject = z
  .object({
    studentId: z.uuid(),
    scope: z.enum(["existing", "future", "existing_and_future"]),
    leadDays: z.number().int().nonnegative(),
    existingLessonIds: z.array(z.uuid()).max(50),
    maximumLessonMinor: z.number().int().positive(),
  })
  .strict();

const selectionSchema = autopaySelectionObject.refine(
  ({ scope, existingLessonIds }) =>
    scope === "future"
      ? existingLessonIds.length === 0
      : existingLessonIds.length > 0,
  "Choose the existing lessons to include, or choose future lessons only.",
);

const policySchema = z.object({
  chargeAtLocal: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  minimumLeadDays: z.number().int().nonnegative(),
  maximumLeadDays: z.number().int().nonnegative(),
  maximumLessonMinor: z.number().int().positive(),
});

const settingsSchema = z.object({
  trainingAutopay: policySchema,
  currency: z
    .string()
    .regex(/^[A-Z]{3}$/)
    .default("USD"),
});

export async function loadPreview(
  actor: string,
  studentId: string,
  now: Date,
  requirePayer = false,
) {
  if (Netlify.env.get("TRAINING_AUTOPAY_PREVIEW") !== "true") return null;
  const allowed = await trainingCheckout<{ studentIds: string[] }>("payers", {
    actor,
    studentIds: [studentId],
  });
  if (!allowed.studentIds.includes(studentId)) {
    if (requirePayer) throw AppError.forbidden();
    return null;
  }
  const service = typedServiceClient();
  const student = await service
    .from("students")
    .select("studio_id")
    .eq("id", studentId)
    .is("deleted_at", null)
    .single();
  if (student.error || !student.data) throw new Error("FORBIDDEN");
  const studioId = student.data.studio_id;
  const studio = await service
    .from("studios")
    .select("timezone,settings")
    .eq("id", studioId)
    .single();
  if (studio.error || !studio.data)
    throw studio.error || new Error("NOT_FOUND");
  const configured = settingsSchema.safeParse(studio.data.settings);
  if (!configured.success) return null;
  const { trainingAutopay, currency } = configured.data;
  if (trainingAutopay.minimumLeadDays > trainingAutopay.maximumLeadDays)
    return null;
  const policy = { ...trainingAutopay, timeZone: studio.data.timezone };
  const [invoices, lessons] = await Promise.all([
    service
      .from("studio_invoices")
      .select("*")
      .eq("student_id", studentId)
      .eq("studio_id", studioId)
      .in("status", ["open", "partially_paid"])
      .overrideTypes<Invoice[], { merge: false }>(),
    service
      .from("lessons")
      .select(
        "id,starts_at,created_at,status,payment_status,payment_needs_review,invoice_payment_pending,invoice_id,lesson_participants(student_id,status,booking_id,bookings!lesson_participants_booking_id_fkey(studio_id,student_id,status,payment_status))",
      )
      .eq("student_id", studentId)
      .eq("studio_id", studioId)
      .eq("status", "scheduled")
      .gt("starts_at", now.toISOString())
      .order("starts_at")
      .order("id")
      .limit(101),
  ]);
  if (invoices.error || lessons.error) throw invoices.error || lessons.error;
  const obligations = new Map(
    trainingObligations(invoices.data, studentId).map((item) => [
      item.lessonId,
      item,
    ]),
  );
  const occurrences: AutopayOccurrence[] = lessons.data
    .slice(0, 100)
    .map((lesson) => {
      const obligation = obligations.get(lesson.id);
      const participants = lesson.lesson_participants.filter(
        (part) => part.student_id === studentId && part.booking_id,
      );
      const booking = participants[0]?.bookings;
      const ambiguousBooking =
        participants.length > 1 ||
        (participants.length === 1 &&
          (!booking ||
            booking.studio_id !== studioId ||
            booking.student_id !== studentId ||
            participants[0].status === "cancelled" ||
            !["confirmed", "completed"].includes(booking.status)));
      return {
        id: lesson.id,
        startsAt: lesson.starts_at,
        createdAt: lesson.created_at,
        status: lesson.status,
        payment: ambiguousBooking
          ? "review"
          : lessonPaymentState(
              {
                status: lesson.status,
                paymentStatus: lesson.payment_status,
                invoicePaymentPending: lesson.invoice_payment_pending,
                paymentNeedsReview: lesson.payment_needs_review,
              },
              booking
                ? {
                    status: booking.status,
                    paymentStatus: booking.payment_status,
                  }
                : undefined,
            ),
        obligation:
          lesson.invoice_id === obligation?.invoiceId ? obligation : undefined,
      };
    });
  return { policy, currency, occurrences, hasMore: lessons.data.length > 100 };
}

export async function trainingAutopayOptions(actor: string, input: unknown) {
  const { studentId } = z.object({ studentId: z.uuid() }).strict().parse(input);
  const source = await loadPreview(actor, studentId, new Date());
  if (!source) return json({ resource: null });
  const { policy, currency, occurrences, hasMore } = source;
  const resource: AutopayPreviewOptions = {
    policy,
    currency,
    hasMore,
    lessons: occurrences.flatMap(({ id, startsAt, payment, obligation }) =>
      payment === "unpaid" &&
      obligation?.eligible &&
      obligation.currency === currency
        ? [
            {
              id,
              date: studioDateKey(startsAt, policy.timeZone),
              amountMinor: obligation.amountMinor,
            },
          ]
        : [],
    ),
  };
  return json({ resource });
}

export async function trainingAutopayPreview(actor: string, input: unknown) {
  const selection = selectionSchema.parse(input);
  const now = new Date();
  const source = await loadPreview(actor, selection.studentId, now, true);
  if (
    !source ||
    selection.maximumLessonMinor > source.policy.maximumLessonMinor ||
    selection.leadDays < source.policy.minimumLeadDays ||
    selection.leadDays > source.policy.maximumLeadDays
  )
    throw new Error(
      "VALIDATION_FAILED: Review the studio's automatic payment availability and limits.",
    );
  const { policy, currency, occurrences } = source;
  // The preview has no enrollment cutoff. Every lesson already read is an
  // existing lesson, even when application and database clocks differ.
  if (selection.scope === "future") return json({ resource: { preview: [] } });
  const preview = previewLessonAutopay(
    policy,
    {
      ...selection,
      scope: "existing",
      currency,
      effectiveAt: now.toISOString(),
    },
    occurrences,
    now,
  );
  return json({ resource: { preview } });
}
