import { z } from "zod";

const id = z.string().uuid();
const contact = z.object({
  fullName: z.string().trim().min(2).max(120),
  email: z.string().trim().email(),
  sourceContactId: id.optional(),
  sourceVersion: z.number().int().optional(),
  relationshipType: z.enum(["guardian", "support_person", "other"]),
  relationshipLabel: z.string().max(120).optional(),
  isPrimaryPayer: z.boolean(),
  isPrimarySchedulingContact: z.boolean(),
  canViewWork: z.boolean(),
  canViewSchedule: z.boolean(),
  canViewFinance: z.boolean(),
  canManageLessons: z.boolean(),
  canManageProfile: z.boolean(),
  canReceiveNotifications: z.boolean(),
  portalEnabled: z.boolean(),
});
export const setupActionSchema = z.discriminatedUnion("kind", [
  z.object({
    id,
    kind: z.literal("details"),
    payload: z.object({
      fullName: z.string().trim().min(2).max(120),
      focusArea: z.string().max(200),
      goals: z.string().max(10000),
      isMinor: z.boolean(),
      email: z.union([z.literal(""), z.string().trim().email()]).optional(),
      phone: z.string().max(80).optional(),
    }),
  }),
  z.object({ id, kind: z.literal("contact"), payload: contact }),
  z.object({
    id,
    kind: z.literal("lesson"),
    payload: z
      .object({
        topic: z.string().trim().min(1).max(200),
        startsAt: z.string().datetime(),
        endsAt: z.string().datetime(),
        recurrence: z.enum(["none", "weekly", "biweekly"]),
        occurrenceCount: z.number().int().min(1).max(52),
        timezone: z.string().min(1),
        locationType: z.enum(["in_person", "virtual"]),
        locationLabel: z.string().max(500),
      })
      .refine((v) => Date.parse(v.endsAt) > Date.parse(v.startsAt), {
        message: "Lesson must end after it starts",
      }),
  }),
  z.object({
    id,
    kind: z.literal("package"),
    payload: z.object({
      definitionId: id,
      expectedPriceMinor: z.number().int().nonnegative().optional(),
      expectedCurrency: z.string().optional(),
      definitionVersion: z.number().int().optional(),
    }),
  }),
  z.object({
    id,
    kind: z.literal("access"),
    payload: z.object({
      portalEnabled: z.boolean(),
      consentConfirmed: z.boolean(),
    }),
  }),
  z.object({
    id,
    kind: z.literal("invitation"),
    payload: z.object({
      accountType: z.enum(["student", "guardian"]),
      linkedContactId: id.optional(),
      consentConfirmed: z.boolean(),
      expectedRecipient: z.string().email().optional(),
      contactVersion: z.number().int().optional(),
    }),
  }),
]);
export const studentSetupSchema = z.object({
  step: z.number().int().min(0).max(5),
  actions: z.array(setupActionSchema).max(20),
});
export type SetupAction = z.infer<typeof setupActionSchema>;
export type StudentSetupDraft = z.infer<typeof studentSetupSchema>;
export type SetupResult = {
  status: "running" | "succeeded" | "failed" | "needs_review";
  message?: string;
  key: string;
  result?: unknown;
};
export interface StudentSetupState {
  version: number;
  draft: Partial<StudentSetupDraft>;
  results: Record<string, SetupResult>;
  review?: {
    id: string;
    expiresAt: string;
    studentVersion: number;
    actions: SetupAction[];
  } | null;
}
export const setupActionLabel = (a: SetupAction) =>
  ({
    details: "Student details",
    contact: "Household contact",
    lesson: "Schedule lesson",
    package: "Assign package",
    access: "Portal access",
    invitation: "Send portal invitation",
  })[a.kind];
