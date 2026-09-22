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
export type CommandInput = z.infer<typeof commandSchema>;

const uuid = z.string().uuid();
const dateTime = z.string().datetime();
const commandPayloadSchemas = {
  "students:create": z
    .object({
      fullName: z.string().trim().min(2).max(120),
      email: z.string().trim().email().optional().or(z.literal("")),
      phone: z.string().trim().max(30).optional(),
      focusArea: z.string().trim().max(200).optional(),
      leadSource: z.string().trim().max(120).optional(),
      isMinor: z.boolean().optional(),
      guardianName: z.string().trim().max(120).optional(),
      guardianEmail: z.string().trim().email().optional().or(z.literal("")),
    })
    .passthrough(),
  "lessons:create": z
    .object({
      studentId: uuid,
      startsAt: dateTime,
      endsAt: dateTime,
      recurrence: z.enum(["none", "weekly", "biweekly"]).optional(),
      occurrenceCount: z.number().int().min(1).max(52).optional(),
    })
    .passthrough()
    .refine((value) => Date.parse(value.endsAt) > Date.parse(value.startsAt), {
      path: ["endsAt"],
      message: "Lesson end must be after its start.",
    }),
  "lessons:reschedule": z
    .object({ startsAt: dateTime, endsAt: dateTime })
    .passthrough()
    .refine((value) => Date.parse(value.endsAt) > Date.parse(value.startsAt), {
      path: ["endsAt"],
      message: "Lesson end must be after its start.",
    }),
  "messages:send": z
    .object({
      body: z.string().max(4_000).default(""),
      conversationId: uuid.optional(),
      studentId: uuid.optional(),
      offeringId: uuid.optional(),
      attachmentIds: z.array(uuid).max(20).optional(),
    })
    .passthrough()
    .refine(
      (value) =>
        value.body.trim().length > 0 || Boolean(value.attachmentIds?.length),
      { path: ["body"], message: "A message or attachment is required." },
    ),
  "finance:adjust_account_credit": z
    .object({
      amountMinor: z
        .number()
        .int()
        .safe()
        .refine((value) => value !== 0),
      reason: z.string().trim().min(3).max(500),
      currency: z.string().trim().length(3).optional(),
    })
    .passthrough(),
  "finance:checkout": z.object({ packageId: uuid }).passthrough(),
} satisfies Record<string, z.ZodType<Record<string, unknown>>>;

export function parseCommand(domain: string, value: unknown): CommandInput {
  const command = commandSchema.parse(value);
  const schema =
    commandPayloadSchemas[
      `${domain}:${command.command}` as keyof typeof commandPayloadSchemas
    ];
  return schema
    ? { ...command, payload: schema.parse(command.payload) }
    : command;
}

export const bookingAdminCommandSchema = z.object({
  command: z.string().min(1).max(80),
  id: uuid.optional(),
  expectedVersion: z.number().int().min(0).optional(),
  payload: z.record(z.string(), z.unknown()).default({}),
});

export const bookingPortalCommandSchema = z.object({
  studentId: uuid.optional(),
  bookingId: uuid.optional(),
  startsAt: dateTime.optional(),
  endsAt: dateTime.optional(),
  scope: z.enum(["occurrence", "series"]).optional(),
});

export const portalLoginSchema = z.object({
  username: z
    .string()
    .trim()
    .regex(/^[a-z][a-z0-9._-]{2,31}$/),
  password: z.string().min(8).max(200),
});

export const packageGiftCommandSchema = z
  .object({
    definitionId: uuid.optional(),
    purchaserName: z.string().trim().max(120).optional(),
    purchaserEmail: z.string().trim().email().optional(),
    recipientName: z.string().trim().max(120).optional(),
    recipientEmail: z.string().trim().email().optional(),
    message: z.string().max(500).optional(),
    deliveryDate: dateTime.optional(),
    token: z.string().max(500).optional(),
    email: z.string().trim().email().optional(),
    fullName: z.string().trim().max(120).optional(),
    createPortalProfile: z.boolean().optional(),
    autoApply: z.boolean().optional(),
  })
  .passthrough();

export const publicManageBookingSchema = z.object({
  command: z.enum(["cancel", "reschedule"]),
  startsAt: dateTime.optional(),
  endsAt: dateTime.optional(),
  scope: z.enum(["occurrence", "series"]).optional(),
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
    createPortalProfile: z.boolean().default(false),
    timezone: z.string().min(3).max(80),
    occurrenceCount: z.number().int().min(2).max(52).optional(),
    discountCode: z.string().trim().min(3).max(40).optional(),
    referralCode: z
      .string()
      .trim()
      .regex(/^[a-fA-F0-9]{16}$/)
      .transform((value) => value.toUpperCase())
      .optional(),
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
