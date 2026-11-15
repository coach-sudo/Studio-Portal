import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { supabase } from "../lib/supabase";
import { usePrivateIdentity } from "../hooks/usePrivateIdentity";
import type { Json } from "../types/database.generated";

export const templateKinds = [
  "low_credit",
  "uncovered_lesson",
  "follow_up",
] as const;
export const reminderLabels = {
  low_credit: "Low credits",
  uncovered_lesson: "Lesson needs credit",
  follow_up: "Three-day follow-up",
};

const templateSchema = z.object({
  kind: z.enum(templateKinds),
  version: z.number(),
  subject: z.string(),
  body: z.string(),
  active: z.boolean(),
});
export type ReminderTemplate = z.infer<typeof templateSchema>;
export const renderedTemplateSchema = templateSchema.pick({
  subject: true,
  body: true,
});
const scopeSchema = z.enum(["studio", "student", "package"]);
export type ReminderScope = z.infer<typeof scopeSchema>;
export const reminderConfigurationSchema = z.object({
  settings: z.array(
    z.object({
      scope: scopeSchema,
      targetId: z.string(),
      threshold: z.number().nullable(),
      enabled: z.boolean().nullable(),
      studentCopy: z.boolean().nullable(),
    }),
  ),
  packages: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      owner: z.string().nullable(),
    }),
  ),
  templates: z.array(templateSchema),
  history: z.array(templateSchema.extend({ createdAt: z.string() })),
});
const deliverySchema = z.object({
  status: z.string(),
  reason: z.string().nullable(),
  attempts: z.number(),
});
export const reminderAttentionSchema = z.array(
  z.object({
    id: z.string(),
    studentId: z.string(),
    studentName: z.string(),
    householdId: z.string().nullable(),
    packageId: z.string().nullable(),
    packageName: z.string().nullable(),
    lessonId: z.string().nullable(),
    lessonName: z.string().nullable(),
    kind: z.enum(["low_credit", "uncovered_lesson"]),
    status: z.enum(["open", "blocked", "resolved"]),
    reason: z.string(),
    paused: z.boolean(),
    nextDueAt: z.string().nullable(),
    lastDeliveryAt: z.string().nullable(),
    delivery: deliverySchema.extend({ id: z.string() }).nullable(),
    history: z.array(
      deliverySchema.extend({
        channel: z.enum(["email", "portal"]),
        at: z.string(),
        templateVersion: z.number(),
      }),
    ),
  }),
);

const historySchema = z.array(
  z.object({
    id: z.string(),
    subject: z.string(),
    body: z.string(),
    path: z.string().startsWith("/portal/credits?"),
    at: z.string(),
    studentName: z.string(),
    requiresAction: z.boolean(),
  }),
);

export async function reminderCommand(
  studentId: string,
  action: string,
  value: Json = {},
  signal?: AbortSignal,
) {
  if (!supabase) throw new Error("Credit reminders are unavailable.");
  const request = supabase.rpc("manage_credit_reminders", {
    p_student: studentId,
    p_action: action,
    p_value: value,
  });
  const result = await (signal ? request.abortSignal(signal) : request);
  if (result.error) {
    const match =
      /^(?:VALIDATION_FAILED|VERSION_CONFLICT|INVALID_TRANSITION): (.+)$/.exec(
        result.error.message,
      );
    throw new Error(
      match?.[1] || "This reminder action could not be completed.",
    );
  }
  return result.data;
}

export function useCreditReminderHistory(studentIds: string[], enabled = true) {
  const identity = usePrivateIdentity();
  const ids = [...new Set(studentIds)].sort();
  return useQuery({
    queryKey: ["credit-reminder-history", identity, ids],
    enabled: enabled && !!supabase && !!identity && ids.length > 0,
    staleTime: 60_000,
    retry: false,
    queryFn: async ({ signal }) => {
      if (!supabase) throw new Error("Credit reminders are unavailable.");
      const result = await supabase
        .rpc("credit_reminder_history", { p_students: ids })
        .abortSignal(signal);
      if (result.error) throw new Error("Reminder history is unavailable.");
      return historySchema.parse(result.data);
    },
  });
}
