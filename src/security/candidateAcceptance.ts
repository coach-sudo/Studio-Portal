import { z } from "zod";
import { allowedHostedRequest, hostedAcceptance } from "./hostedAcceptance";

// A new deploy ID is supplied only after a separately authorized deployment.
// There is deliberately no wildcard-host or production-context fallback.
export const candidateTargetSchema = z
  .object({
    site: z.literal("d83ff6cb-f57b-4741-8c3c-3eaae7adab19"),
    project: z.literal(hostedAcceptance.project),
    studio: z.literal(hostedAcceptance.studio),
    student: z.literal(hostedAcceptance.student),
    deployment: z.string().regex(/^[a-f0-9]{24}$/),
    commit: z.string().regex(/^[a-f0-9]{40}$/),
    context: z.literal("deploy-preview"),
    origin: z.string(),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (
      v.origin !== `https://${v.deployment}--coachd-staging.netlify.app` ||
      v.deployment === "6ad23d4f8b10c10447224155"
    )
      ctx.addIssue({
        code: "custom",
        message: "Expected a new exact immutable staging origin",
      });
  });
export type CandidateTarget = z.infer<typeof candidateTargetSchema>;
export type EndpointClass =
  "read-only" | "approval-required" | "provider-prohibited";

const readLessonCommands = new Set([
  "bulk_candidates",
  "bulk_progress",
  "record_history",
]);
const proposedCommands: Record<string, Set<string>> = {
  "/api/v2/lessons": new Set([
    "create",
    "update_details",
    "preview_change",
    "execute_change",
    "preview_bulk",
    "execute_bulk",
    "retry_bulk",
  ]),
  "/api/v2/credits": new Set([
    "grant",
    "set_total",
    "set_auto",
    "apply_upcoming",
  ]),
};

/** Assessment only. This function NEVER authorizes a hosted business write. */
export function classifyCandidateEndpoint(
  target: CandidateTarget,
  method: string,
  value: string,
  body?: { command?: string; payload?: { action?: string } },
): EndpointClass {
  candidateTargetSchema.parse(target);
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.port ||
    url.pathname.includes("%")
  )
    return "provider-prohibited";
  if (url.origin === target.origin && url.pathname === "/api/v2/lessons") {
    if (method !== "POST") return "provider-prohibited";
    if (!url.search && !url.hash && readLessonCommands.has(body?.command || ""))
      return "read-only";
    // Rescheduling calls googleAccessToken/googleFreeBusy before executing SQL.
    if (body?.command === "execute_change" && body.payload?.action !== "cancel")
      return "provider-prohibited";
  }
  if (allowedHostedRequest(method, value, target)) return "read-only";
  if (
    url.origin !== target.origin ||
    url.pathname.includes("%") ||
    url.search ||
    url.hash ||
    url.username ||
    url.password ||
    url.port
  )
    return "provider-prohibited";
  return method === "POST" &&
    proposedCommands[url.pathname]?.has(body?.command || "")
    ? "approval-required"
    : "provider-prohibited";
}

export function allowedCandidateRead(
  target: CandidateTarget,
  method: string,
  value: string,
  body?: { command?: string },
) {
  return classifyCandidateEndpoint(target, method, value, body) === "read-only";
}
