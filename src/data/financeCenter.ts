import type { SupabaseClient } from "@supabase/supabase-js";
import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { supabase } from "../lib/supabase";
import { usePrivateIdentity } from "../hooks/usePrivateIdentity";
import { studioDateKey } from "../domain/presentation";

export const reports = {
  collections: "Collections",
  gross: "Gross collections",
  refunds: "Refunds",
  receivables: "Outstanding balances",
  overdue: "Overdue balances",
  scheduled: "Scheduled authorized collections",
  packages: "Package purchases",
  credits: "Credit activity",
} as const;
export type ReportName = keyof typeof reports;
export type ReportFilters = {
  group: ReportName | "overview";
  currency?: string;
  search?: string;
  status?: string;
  kind?: string;
  student?: string;
  service?: string;
  sort?: string;
  filterDates?: boolean;
  page?: number;
};
export type DateRange = { start: string; end: string };

const measure = z.object({ currency: z.string(), amount: z.number().int() });
const reportSchema = z.object({
  count: z.number(),
  page: z.number(),
  timezone: z.string(),
  currencies: z.array(z.string()).default([]),
  totals: z.array(measure.extend({ metric: z.string() })),
  trend: z.array(
    z.object({
      date_on: z.string(),
      currency: z.string(),
      gross: z.number(),
      refunds: z.number(),
    }),
  ),
  services: z.array(
    z.object({
      service: z.string(),
      currency: z.string(),
      gross: z.number(),
      refunds: z.number(),
    }),
  ),
  reportTotals: z.array(measure.extend({ kind: z.string() })),
  csv: z.string().nullable(),
  rows: z
    .array(
      measure.extend({
        id: z.string().uuid(),
        kind: z.string(),
        date_on: z.string().nullable(),
        student: z.string(),
        payer: z.string().nullable(),
        title: z.string(),
        status: z.string(),
        method: z.string().nullable(),
        service: z.string().nullable(),
        href: z.string().startsWith("/coach/"),
      }),
    )
    .max(25),
});
export type FinanceReport = z.infer<typeof reportSchema>;

export const issueLabels = {
  overdue_invoice: "Overdue invoice",
  failed_payment: "Automatic payment failed",
  invoice_delivery: "Invoice email failed",
  payer_review: "Payer authorization needs review",
  credit_reconciliation: "Package reconciliation",
  package_expiring: "Credits expiring soon",
} as const;

const issueSchema = z.object({
  id: z.string().uuid(),
  student_id: z.string().uuid(),
  student: z.string().nullable(),
  kind: z.enum([
    "overdue_invoice",
    "failed_payment",
    "invoice_delivery",
    "payer_review",
    "credit_reconciliation",
    "package_expiring",
  ]),
  severity: z.number(),
  title: z.string(),
  href: z.string().startsWith("/coach/"),
  evidence: z.object({
    amount: z.number().optional(),
    currency: z.string().optional(),
    dueDate: z.string().optional(),
    expiresAt: z.string().optional(),
    quantity: z.number().optional(),
    failedAt: z.string().optional(),
    attemptedAt: z.string().optional(),
  }),
  state: z.enum(["open", "acknowledged", "snoozed", "dismissed", "resolved"]),
  version: z.number(),
  first_seen: z.string(),
  changed_at: z.string(),
  snoozed_until: z.string().nullable(),
  history: z.array(
    z.object({
      id: z.number(),
      action: z.string(),
      reason: z.string().nullable(),
      at: z.string(),
    }),
  ),
});
export type FinanceIssue = z.infer<typeof issueSchema>;
export type AttentionFilters = {
  queue?: string;
  kind?: string;
  severity?: string;
  student?: string;
  id?: string;
  page?: number;
  preview?: boolean;
};
const attentionSchema = z.object({
  count: z.number(),
  items: z.array(issueSchema).max(25),
});
export type AttentionAction = {
  action: "acknowledge" | "snooze" | "dismiss";
  id: string;
  version: number;
  until?: string;
  reason?: string;
};
const reportKey = "finance-report";
export const attentionKey = "finance-attention";

async function call<T>(
  name: string,
  args: Record<string, unknown>,
  schema: z.ZodType<T>,
  signal?: AbortSignal,
) {
  if (!supabase) throw new Error("Finance connection unavailable.");
  const request = (supabase as SupabaseClient).rpc(name, args);
  const { data, error } = await (signal
    ? request.abortSignal(signal)
    : request);
  if (error)
    throw new Error(
      "Finance could not complete this request. Refresh and try again.",
    );
  return schema.parse(data);
}
export function fetchReport(
  studio: string,
  range: DateRange,
  filters: ReportFilters,
  signal?: AbortSignal,
  exporting = false,
) {
  return call(
    "finance_report",
    {
      p_studio: studio,
      p_start: range.start,
      p_end: range.end,
      p_filters: { ...filters, export: exporting },
    },
    reportSchema,
    signal,
  );
}
export function useFinanceReport(
  studio: string,
  range: DateRange,
  filters: ReportFilters,
  isDemo: boolean,
  enabled = true,
) {
  const identity = usePrivateIdentity();
  return useQuery({
    queryKey: [reportKey, identity, studio, range, filters],
    queryFn: ({ signal }) => fetchReport(studio, range, filters, signal),
    enabled: enabled && !isDemo && !!identity,
    staleTime: 30_000,
  });
}
export function useFinanceAttention(
  studio: string,
  filters: AttentionFilters,
  isDemo: boolean,
) {
  const identity = usePrivateIdentity();
  return useQuery({
    queryKey: [attentionKey, identity, studio, filters],
    queryFn: ({ signal }) =>
      call(
        "finance_attention",
        {
          p_studio: studio,
          p_request: filters,
        },
        attentionSchema,
        signal,
      ),
    enabled: !isDemo && !!identity,
    staleTime: 20_000,
  });
}
export async function changeAttention(studio: string, action: AttentionAction) {
  const response = await call(
    "finance_attention",
    {
      p_studio: studio,
      p_request: action,
    },
    z.union([z.object({ stale: z.literal(true) }), attentionSchema]),
  );
  return "stale" in response;
}

const utcDay = (day: string) => new Date(day + "T12:00:00Z");
const key = (date: Date) => date.toISOString().slice(0, 10);
export function financePeriod(
  period: string,
  zone: string,
  now = new Date(),
): DateRange {
  const today = studioDateKey(now, zone);
  const day = utcDay(today);
  if (period === "last-month") {
    const currentStart = utcDay(today.slice(0, 7) + "-01");
    currentStart.setUTCDate(0);
    const end = key(currentStart);
    return { start: end.slice(0, 7) + "-01", end };
  }
  const days = period === "last-90" ? 90 : period === "last-30" ? 30 : 0;
  day.setUTCDate(days ? day.getUTCDate() - days + 1 : 1);
  return { start: key(day), end: today };
}
export function validFinanceRange(range: DateRange) {
  if (
    ![range.start, range.end].every(
      (date) =>
        /^\d{4}-\d{2}-\d{2}$/.test(date) &&
        Number.isFinite(utcDay(date).getTime()) &&
        key(utcDay(date)) === date,
    )
  )
    return false;
  const days =
    (utcDay(range.end).getTime() - utcDay(range.start).getTime()) / 86_400_000;
  return days >= 0 && days <= 365;
}

export function financeView(params: URLSearchParams) {
  const view = params.get("view");
  if (
    view === "overview" ||
    view === "payments" ||
    view === "packages" ||
    view === "attention"
  )
    return view;
  return params.has("invoice") || params.has("billLesson")
    ? "payments"
    : "overview";
}
