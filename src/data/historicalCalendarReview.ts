import { studioCommand } from "./bookingCommands";
import { supabase } from "../lib/supabase";
import {
  historicalSourceSchema,
  historicalPreviewSchema,
  historicalReceiptSchema,
  historicalHistorySchema,
  historicalLessonSchema,
  historicalProposalSchema,
  type HistoricalProposal,
  type HistoricalDecision,
} from "../domain/historicalCalendarReview";
const command = (
  name: string,
  payload: Record<string, unknown>,
  key?: string,
  actorId?: string,
) =>
  studioCommand(
    "integrations",
    {
      command: name,
      payload,
      expectedVersion: 0,
      idempotencyKey: key,
      reason: "Coach reviews one historical Calendar source",
    },
    actorId,
  );
export async function loadHistoricalSource(
  candidateId: string,
  strict = false,
  actorId?: string,
) {
  const result = await command(
    strict
      ? "preview_historical_calendar_review"
      : "preview_historical_calendar_reopening",
    { candidateId },
    undefined,
    actorId,
  );
  const value = historicalSourceSchema.parse(result.resource);
  if (value.candidateId !== candidateId)
    throw Error(
      "The source response belongs to another candidate. Refresh before continuing.",
    );
  return value;
}
export async function previewHistoricalReconciliation(
  candidateId: string,
  proposal: HistoricalProposal,
  actorId?: string,
) {
  proposal = historicalProposalSchema.parse(proposal);
  const result = await command(
    "preview_historical_calendar_reconciliation",
    {
      candidateId,
      proposal,
    },
    undefined,
    actorId,
  );
  const value = historicalPreviewSchema.parse(result.resource);
  if (
    value.candidateId !== candidateId ||
    JSON.stringify(value.proposal) !== JSON.stringify(proposal)
  )
    throw Error(
      "The preview does not match this exact request. Refresh before continuing.",
    );
  return value;
}
export type HistoricalPending = {
  candidateId: string;
  key: string;
  actorId?: string;
} & (
  | { kind: "canonical"; proposal: HistoricalProposal; stamp: string }
  | { kind: "decision"; decision: HistoricalDecision }
);
export async function saveHistoricalReview(value: HistoricalPending) {
  if (
    value.kind === "decision" &&
    value.decision.candidateId !== value.candidateId
  )
    throw Error(
      "The retained decision belongs to another source. No request was sent.",
    );
  const result = await command(
    value.kind === "canonical"
      ? "historical_calendar_reconciliation"
      : "historical_calendar_review",
    value.kind === "canonical"
      ? {
          candidateId: value.candidateId,
          proposal: value.proposal,
          stamp: value.stamp,
        }
      : { ...value.decision },
    value.key,
    value.actorId,
  );
  const receipt = historicalReceiptSchema.parse(result);
  if (receipt.resource.candidateId !== value.candidateId)
    throw Error(
      "The returned receipt belongs to another source. Retry the original request unchanged.",
    );
  if (value.kind === "canonical") {
    const r = receipt.resource,
      p = value.proposal;
    if (
      r.studentId !== p.studentId ||
      r.linked !== true ||
      r.created !== (p.action === "create") ||
      !r.lessonId ||
      (p.action === "link" && r.lessonId !== p.lessonId) ||
      (p.action === "create" && r.recordedOutcome !== "scheduled")
    )
      throw Error(
        "The canonical receipt does not match the original student, lesson and outcome. Recover the unchanged request.",
      );
  } else {
    const expected = {
      reopen: "review",
      not_lesson: "not_lesson",
      skip: "skipped",
    }[value.decision.action];
    if (receipt.resource.disposition !== expected)
      throw Error(
        "The receipt does not match this source decision. Recover the unchanged request.",
      );
  }
  return receipt;
}
export async function loadHistoricalHistory(
  candidateId: string,
  beforeVersion?: number,
) {
  const result = await command("historical_calendar_decision_history", {
    candidateId,
    ...(beforeVersion ? { beforeVersion } : {}),
  });
  return historicalHistorySchema.parse(result.resource);
}
export async function loadHistoricalLesson(id: string) {
  if (!supabase) throw Error("The database is unavailable.");
  const result = await supabase
    .from("lessons")
    .select("id,version,topic,starts_at,ends_at,status")
    .eq("id", id)
    .single();
  if (result.error || !result.data)
    throw Error(
      "This lesson is unavailable. Refresh and choose an accessible original record.",
    );
  const row = result.data;
  if (row.id !== id)
    throw Error("The lesson response does not match your selection.");
  return historicalLessonSchema.parse({
    id: row.id,
    version: row.version,
    topic: row.topic,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    status: row.status,
  });
}
