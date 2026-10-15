import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "../lib/supabase";
import type { LibraryResource } from "../domain/library";

export const financialOverviewSchema = z.object({
  studentId: z.string().uuid(),
  evaluatedAt: z.string(),
  balances: z.array(
    z.object({
      currency: z.string().length(3),
      dueMinor: z.number().int().nonnegative(),
      dollarCreditMinor: z.number().int(),
    }),
  ),
  reviewRequired: z.boolean(),
  pendingPayments: z.number().int().nonnegative(),
  unpaidInvoices: z.number().int().nonnegative(),
  activePackages: z.number().int().nonnegative(),
  expiringPackages: z.number().int().nonnegative(),
});
export const workspaceSummarySchema = z.object({
  studentId: z.string().uuid(),
  evaluatedAt: z.string(),
  nextLesson: z
    .object({ id: z.string().uuid(), topic: z.string(), startsAt: z.string() })
    .nullable(),
  latestNote: z
    .object({
      id: z.string().uuid(),
      lessonId: z.string().uuid(),
      title: z.string(),
      takeaway: z.string().max(300),
      status: z.string(),
    })
    .nullable(),
  work: z
    .array(
      z.object({
        id: z.string().uuid(),
        assignmentId: z.string().uuid(),
        lessonId: z.string().uuid().nullable(),
        title: z.string(),
        role: z.string(),
      }),
    )
    .max(5),
  practice: z
    .array(
      z.object({
        id: z.string().uuid(),
        lessonId: z.string().uuid().nullable(),
        title: z.string(),
        helpRequested: z.boolean(),
      }),
    )
    .max(5),
  questions: z.number().int().nonnegative(),
  approvals: z.number().int().nonnegative(),
  finance: financialOverviewSchema,
});
async function read(name: string, studentId: string, signal?: AbortSignal) {
  if (!supabase) throw new Error("Database unavailable.");
  const query = (supabase as SupabaseClient).rpc(name, {
    p_student: studentId,
  });
  const response = await (signal ? query.abortSignal(signal) : query);
  if (response.error) throw new Error(response.error.message);
  if (response.data?.studentId !== studentId)
    throw new Error("Student context unavailable.");
  return response.data;
}
export async function loadWorkspaceSummary(
  studentId: string,
  signal?: AbortSignal,
) {
  return workspaceSummarySchema.parse(
    await read("student_workspace_summary", studentId, signal),
  );
}
export async function loadFinancialOverview(
  studentId: string,
  signal?: AbortSignal,
) {
  return financialOverviewSchema.parse(
    await read("student_financial_overview", studentId, signal),
  );
}

export async function loadWorkspaceResource(
  studentId: string,
  resourceId: string,
  assignmentId: string,
  signal?: AbortSignal,
) {
  for (const id of [studentId, resourceId, assignmentId])
    z.string().uuid().parse(id);
  if (!supabase) throw new Error("Database unavailable.");
  const query = (supabase as SupabaseClient).rpc("student_workspace_resource", {
    p_student: studentId,
    p_resource: resourceId,
    p_assignment: assignmentId,
  });
  const result = await (signal ? query.abortSignal(signal) : query);
  if (
    result.error ||
    result.data?.id !== resourceId ||
    result.data?.assignmentId !== assignmentId
  )
    throw new Error("Resource unavailable in this student context.");
  return result.data as LibraryResource;
}
