import { z } from "zod";
export const commandSchema = z.object({
  command: z.string().min(1),
  idempotencyKey: z.string().min(8).max(200),
  expectedVersion: z.number().int().min(0),
  reason: z.string().min(3).max(500),
  entityType: z
    .enum(["student", "lesson", "note", "assignment", "material"])
    .optional(),
  entityId: z.string().uuid().optional(),
  nextStatus: z.string().optional(),
  payload: z.record(z.string(), z.unknown()).default({}),
});
export const publicBookingSchema = z
  .object({
    serviceId: z.string().min(1),
    offeringId: z.string().uuid().optional(),
    startsAt: z.string().datetime(),
    endsAt: z.string().datetime(),
    location: z.enum(["google_meet", "in_person"]),
    recurrence: z.enum(["none", "weekly", "biweekly"]),
    paymentPolicy: z.enum([
      "pay_now",
      "pay_later",
      "deposit",
      "credits",
      "installments",
      "subscription",
    ]),
    guestName: z.string().trim().min(2).max(120),
    guestEmail: z
      .string()
      .email()
      .transform((value) => value.toLowerCase()),
    guestPhone: z.string().trim().min(7).max(30).optional(),
    forMinor: z.boolean().default(false),
    guardianName: z.string().trim().min(2).max(120).optional(),
    guardianEmail: z.string().email().optional(),
    timezone: z.string().min(3).max(80),
    occurrenceCount: z.number().int().min(2).max(52).optional(),
    discountCode: z.string().trim().min(3).max(40).optional(),
    termsAccepted: z.literal(true),
    termsVersion: z.literal("2026-08-20"),
  })
  .superRefine((value, ctx) => {
    if (value.forMinor && !value.guardianName)
      ctx.addIssue({
        code: "custom",
        path: ["guardianName"],
        message: "Guardian name is required.",
      });
    if (value.forMinor && !value.guardianEmail)
      ctx.addIssue({
        code: "custom",
        path: ["guardianEmail"],
        message: "Guardian email is required.",
      });
    if (
      value.recurrence === "none" &&
      ["installments", "subscription"].includes(value.paymentPolicy)
    )
      ctx.addIssue({
        code: "custom",
        path: ["paymentPolicy"],
        message: "Recurring billing requires a recurring booking.",
      });
  });
