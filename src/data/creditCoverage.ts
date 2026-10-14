import { z } from "zod";
import { creditCoverageSchema } from "../domain/creditCoverage";
import { supabase } from "../lib/supabase";

const requestSchema = z.object({
  studentId: z.string().uuid(),
  page: z.number().int().min(1).max(1000000).default(1),
  pageSize: z.number().int().min(1).max(100).default(25),
  previewEnable: z.boolean().default(false),
});

/** Read-only: previewEnable simulates allocation and never saves the preference. */
export async function loadCreditCoverage(
  request: z.input<typeof requestSchema>,
  signal?: AbortSignal,
) {
  const input = requestSchema.parse(request);
  if (!supabase) throw new Error("Database configuration is unavailable.");
  const query = supabase.rpc("student_credit_coverage", {
    p_student: input.studentId,
    p_page: input.page,
    p_page_size: input.pageSize,
    p_preview_enable: input.previewEnable,
  });
  const result = await (signal ? query.abortSignal(signal) : query);
  if (result.error) throw new Error(result.error.message);
  const coverage = creditCoverageSchema.parse(result.data);
  if (
    coverage.studentId !== input.studentId ||
    coverage.page !== input.page ||
    coverage.pageSize !== input.pageSize ||
    coverage.previewEnable !== input.previewEnable
  )
    throw new Error(
      "Coverage response does not match the requested student or view.",
    );
  return coverage;
}
