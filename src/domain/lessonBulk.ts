import { z } from "zod";

export const lessonBulkFilter = z
  .object({
    studentId: z.string().uuid().optional(),
    seriesId: z.string().uuid().optional(),
    statuses: z
      .array(z.enum(["scheduled", "completed", "cancelled", "late_cancelled"]))
      .max(4)
      .optional(),
    from: z.string().datetime().optional(),
    to: z.string().datetime().optional(),
    query: z.string().max(120).optional(),
    includeArchived: z.boolean().optional(),
    sort: z.literal("starts_at").optional(),
    page: z.number().int().nonnegative().optional(),
    view: z.string().max(40).optional(),
  })
  .strict();
export const lessonBulkPreviewRequest = z
  .object({
    operation: z.enum(["cancel", "archive", "restore", "void", "delete"]),
    scope: z.enum(["selected", "future", "series"]).default("selected"),
    selectionMode: z.enum(["ids", "matching"]).default("ids"),
    selectedIds: z.array(z.string().uuid()).min(1).max(5000).optional(),
    excludedIds: z.array(z.string().uuid()).max(5000).default([]),
    filter: lessonBulkFilter.default({}),
    studentContextId: z.string().uuid().optional(),
    wholeClass: z.boolean().default(false),
    useCredit: z.boolean().default(false),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.selectionMode === "ids" && !v.selectedIds)
      ctx.addIssue({ code: "custom", message: "Select lesson IDs." });
    if (v.selectionMode === "matching" && v.scope !== "selected")
      ctx.addIssue({
        code: "custom",
        message: "Review expanded series separately.",
      });
    if (v.wholeClass && (v.studentContextId || v.filter.studentId))
      ctx.addIssue({
        code: "custom",
        message: "Whole-class operations require studio context.",
      });
    if (
      v.filter.studentId &&
      v.studentContextId &&
      v.filter.studentId !== v.studentContextId
    )
      ctx.addIssue({
        code: "custom",
        message: "Student context must match the filter.",
      });
  });
export const lessonBulkExecutionRequest = z
  .object({
    jobId: z.string().uuid(),
    reviewToken: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
export const lessonBulkProgressRequest = z
  .object({
    jobId: z.string().uuid(),
    offset: z.number().int().min(0).default(0),
    limit: z.number().int().min(1).max(100).default(50),
  })
  .strict();
export const lessonBulkCandidateRequest = z
  .object({
    filter: lessonBulkFilter.default({}),
    offset: z.number().int().min(0).default(0),
    limit: z.number().int().min(1).max(100).default(50),
  })
  .strict();
export type LessonBulkPreviewInput = z.input<typeof lessonBulkPreviewRequest>;
export type LessonBulkOperation = z.infer<
  typeof lessonBulkPreviewRequest
>["operation"];
export interface LessonBulkPreview {
  jobId: string;
  reviewToken: string;
  expiresAt: string;
  operation: LessonBulkOperation;
  scope: "selected" | "future" | "series";
  count: number;
  eligible: number;
  blocked: number;
  stopsFutureGeneration: boolean;
  creditPolicy: "return" | "retain";
  notificationPolicy: string;
}
export interface LessonBulkAssessment {
  lessonId: string;
  version: number;
  topic: string;
  startsAt: string;
  status: string;
  eligible: boolean;
  reasonCode: string | null;
  dependencies: Record<string, { count: number; fingerprint?: string }>;
  calendarEffect: boolean;
  notificationEffect: boolean;
  reservedCredits: number;
  creditPolicy: "return" | "retain";
}
export interface LessonBulkProgress {
  jobId: string;
  operation: LessonBulkOperation;
  scope: string;
  expiresAt: string;
  state: "reviewed" | "running" | "completed" | "needs_attention";
  counts: {
    total: number;
    eligible: number;
    blocked: number;
    succeeded: number;
    skipped: number;
    conflicted: number;
    failed: number;
    pending: number;
    synchronizationPending: number;
  };
  items: {
    id: string;
    lessonId: string;
    version: number;
    status: string;
    assessment: LessonBulkAssessment;
    reasonCode: string | null;
    result: unknown;
    attempts: number;
    retryable: boolean;
  }[];
  offset: number;
  limit: number;
}
