import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "../lib/supabase";
import { z } from "zod";

const total = z.object({
  metric: z.string(),
  currency: z.string(),
  unit: z.enum(["money", "credits", "records"]),
  amount: z.number(),
  count: z.number(),
});
export const financialDashboardSchema = z.object({
  reviewCount: z.number().int().nonnegative().default(0),
  month: z.string(),
  timezone: z.string(),
  from: z.string(),
  until: z.string(),
  evaluatedAt: z.string(),
  totals: z.array(total),
  items: z
    .array(
      z.object({
        metric: z.string(),
        currency: z.string(),
        unit: z.string(),
        amount: z.number(),
        id: z.string().uuid(),
        student_id: z.string().uuid(),
        title: z.string(),
        href: z.string().startsWith("/coach/"),
        occurred_at: z.string().nullable(),
        state: z.string(),
      }),
    )
    .max(25),
  count: z.number(),
  page: z.number(),
});
export type FinancialDashboard = z.infer<typeof financialDashboardSchema>;
export const activitySchema = z.object({
  items: z
    .array(
      z.object({
        id: z.string().uuid(),
        happened_at: z.string(),
        kind: z.string(),
        title: z.string(),
        state: z.string(),
        href: z.string().regex(/^\/(coach|portal)\//),
        attention: z.boolean(),
      }),
    )
    .max(25),
  count: z.number(),
  page: z.number(),
});
async function read(
  name: string,
  args: Record<string, unknown>,
  signal?: AbortSignal,
) {
  if (!supabase) throw new Error("Studio unavailable");
  const query = (supabase as SupabaseClient).rpc(name, args);
  const r = await (signal ? query.abortSignal(signal) : query);
  if (r.error) throw new Error(r.error.message);
  return r.data;
}
export async function loadFinancialDashboard(
  month: string,
  metric?: string,
  currency?: string,
  page = 1,
  signal?: AbortSignal,
) {
  return financialDashboardSchema.parse(
    await read(
      "studio_financial_dashboard",
      {
        p_month: month + "-01",
        p_metric: metric || null,
        p_currency: currency || null,
        p_page: page,
      },
      signal,
    ),
  );
}
export async function loadCommunicationActivity(
  page = 1,
  attention = false,
  search = "",
  signal?: AbortSignal,
  kind = "",
) {
  return activitySchema.parse(
    await read(
      "communication_activity",
      { p_page: page, p_attention: attention, p_search: search, p_kind: kind },
      signal,
    ),
  );
}
export async function loadHouseholdAccess(
  studentId: string,
  signal?: AbortSignal,
) {
  return z
    .object({
      items: z
        .array(
          z.object({
            account_type: z.string(),
            linked_contact_id: z.string().nullable(),
            activation: z.enum(["signed_in", "provisioned"]),
            last_signed_in_at: z.string().nullable(),
            access_enabled: z.boolean(),
            must_change_password: z.boolean(),
          }),
        )
        .max(100),
    })
    .parse(
      await read("household_access_states", { p_student: studentId }, signal),
    );
}
