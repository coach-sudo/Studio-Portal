import { z } from "zod";
import { supabase } from "../lib/supabase";
import type { Json } from "../types/database.generated";

const person = z.object({ id: z.string(), name: z.string() });
const pool = z.object({
  id: z.string(),
  name: z.string(),
  householdId: z.string(),
  householdName: z.string(),
  durationMinutes: z.number(),
  expiresAt: z.string().nullable(),
  services: z.array(z.string()),
  available: z.number(),
  unused: z.number(),
  reserved: z.number(),
  consumed: z.number(),
  members: z.array(person),
  usage: z.array(
    z.object({
      studentId: z.string(),
      studentName: z.string(),
      lessonId: z.string(),
      topic: z.string(),
      startsAt: z.string(),
      reserved: z.number(),
      consumed: z.number(),
    }),
  ),
});
export const sharedPoolsSchema = z.array(pool);
export type SharedCreditPool = z.infer<typeof pool>;
export const coachHouseholdsSchema = z.object({
  households: z.array(
    person.extend({ members: z.array(person), pools: sharedPoolsSchema }),
  ),
  students: z.array(person),
  definitions: z.array(
    person.extend({ shared: z.boolean(), transfer: z.boolean() }),
  ),
  transferLots: z.array(
    person.extend({
      studentId: z.string().nullable(),
      householdId: z.string().nullable(),
    }),
  ),
});
export const householdReplySchema = z.looseObject({
  status: z.enum(["completed", "preview", "stale", "unapplied"]),
  canApply: z.boolean().optional(),
  packageName: z.string().optional(),
  durationMinutes: z.number().nullable().optional(),
  sourceAvailable: z.number().optional(),
  sourceReserved: z.number().optional(),
  sourceAfter: z.number().optional(),
  destinationAfter: z.number().optional(),
  conflicts: z
    .array(z.object({ id: z.string(), topic: z.string() }))
    .optional(),
});

export async function householdCreditCommand(
  studentId: string,
  action: string,
  value: Json = {},
  signal?: AbortSignal,
): Promise<Json> {
  if (!supabase) throw new Error("Household credits are unavailable.");
  const request = supabase.rpc("household_credit_access", {
    p_student: studentId,
    p_action: action,
    p_value: value,
  });
  const result = await (signal ? request.abortSignal(signal) : request);
  if (result.error) {
    const explanation = /^(?:INVALID_TRANSITION|VALIDATION_FAILED): (.+)$/.exec(
      result.error.message,
    );
    throw new Error(
      explanation?.[1] ??
        "This household credit action could not be completed.",
    );
  }
  return result.data;
}
