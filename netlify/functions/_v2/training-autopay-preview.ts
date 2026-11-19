import { z } from "zod";
import { json } from "../_shared/http";
import { serviceClient } from "../_shared/supabase";
import { trainingCheckout } from "../_shared/training-checkout";
import { previewLessonAutopay } from "../../../src/domain/lessonAutopay";
import {
  trainingObligations,
  lessonPaymentState,
} from "../../../src/domain/trainingArrangement";
import type { Invoice } from "../../../src/domain/invoices";

const selectionSchema = z
  .object({
    studentId: z.uuid(),
    scope: z.enum(["existing", "future", "existing_and_future"]),
    leadDays: z.number().int().nonnegative(),
    existingLessonIds: z.array(z.uuid()).max(50),
    maximumLessonMinor: z.number().int().positive(),
  })
  .strict();

const policySchema = z.object({
  chargeAtLocal: z.string(),
  minimumLeadDays: z.number().int(),
  maximumLeadDays: z.number().int(),
  maximumLessonMinor: z.number().int().positive(),
});

export async function trainingAutopayPreview(actor: string, input: unknown) {
  if (Netlify.env.get("TRAINING_AUTOPAY_PREVIEW") !== "true")
    throw new Error(
      "PROVIDER_UNAVAILABLE: Automatic payment preview is unavailable.",
    );
  const selection = selectionSchema.parse(input);
  const allowed = await trainingCheckout<{ studentIds: string[] }>("payers", {
    actor,
    studentIds: [selection.studentId],
  });
  if (!allowed.studentIds.includes(selection.studentId))
    throw new Error("FORBIDDEN");
  const service = serviceClient();
  const student = await service
    .from("students")
    .select("studio_id")
    .eq("id", selection.studentId)
    .is("deleted_at", null)
    .single();
  if (student.error || !student.data) throw new Error("FORBIDDEN");
  const [studio, invoices, lessons] = await Promise.all([
    service
      .from("studios")
      .select("timezone,settings")
      .eq("id", student.data.studio_id)
      .single(),
    service
      .from("studio_invoices")
      .select("*")
      .eq("student_id", selection.studentId)
      .eq("studio_id", student.data.studio_id)
      .in("status", ["open", "partially_paid"]),
    service
      .from("lessons")
      .select(
        "id,starts_at,created_at,status,payment_status,payment_needs_review,invoice_payment_pending",
      )
      .eq("student_id", selection.studentId)
      .eq("studio_id", student.data.studio_id)
      .eq("status", "scheduled")
      .gte("starts_at", new Date().toISOString())
      .order("starts_at")
      .limit(100),
  ]);
  if (studio.error || invoices.error || lessons.error || !studio.data)
    throw (
      studio.error || invoices.error || lessons.error || new Error("NOT_FOUND")
    );
  const configured = policySchema.safeParse(
    studio.data.settings?.trainingAutopay,
  );
  if (
    !configured.success ||
    selection.maximumLessonMinor > configured.data.maximumLessonMinor
  )
    throw new Error(
      "VALIDATION_FAILED: Review the studio's automatic payment limits.",
    );
  const currency = studio.data.settings?.currency ?? "USD";
  const obligations = new Map(
    trainingObligations(invoices.data as Invoice[], selection.studentId).map(
      (item) => [item.lessonId, item],
    ),
  );
  const now = new Date();
  const preview = previewLessonAutopay(
    { ...configured.data, timeZone: studio.data.timezone },
    {
      ...selection,
      currency,
      effectiveAt: now.toISOString(),
    },
    lessons.data.map(
      (lesson): Parameters<typeof previewLessonAutopay>[2][number] => {
        const payment = lessonPaymentState({
          status: lesson.status,
          paymentStatus: lesson.payment_status,
          invoicePaymentPending: lesson.invoice_payment_pending,
          paymentNeedsReview: lesson.payment_needs_review,
        });
        return {
          id: lesson.id,
          startsAt: lesson.starts_at,
          createdAt: lesson.created_at,
          status: lesson.status,
          payment,
          obligation: obligations.get(lesson.id),
        };
      },
    ),
    now,
  );
  return json({
    resource: {
      preview,
      timeZone: studio.data.timezone,
      leadDays: selection.leadDays,
    },
  });
}
