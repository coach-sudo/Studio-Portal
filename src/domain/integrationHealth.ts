export type WorkerStage = {
  stage: string;
  state: "stage_started" | "stage_completed" | "stage_failed";
  errorCategory: string | null;
  at: string;
};
export interface WorkerReceipt {
  jobId: string;
  state: "pending" | "running" | "succeeded" | "failed";
  attempts: number;
  requestedAt: string;
  acceptedAt: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  lastSuccessAt: string | null;
  errorCategory: string | null;
  leaseExpired: boolean;
  stages: WorkerStage[];
  history: Array<{
    jobId: string;
    attempt: number;
    state: string;
    at: string;
    errorCategory: string | null;
  }>;
}
export type WorkerStatus =
  | "disabled"
  | "unknown"
  | "idle"
  | "queued"
  | "accepted"
  | "running"
  | "completed"
  | "failed"
  | "partial";
export interface WorkerHealth {
  enabled: boolean;
  status: WorkerStatus;
  receipt: WorkerReceipt | null;
  recovery: string;
}
export function workerHealth(
  enabled: boolean,
  receipt: WorkerReceipt | null,
  unavailable = false,
): WorkerHealth {
  const status: WorkerStatus = !enabled
    ? "disabled"
    : unavailable
      ? "unknown"
      : !receipt
        ? "idle"
        : receipt.state === "pending"
          ? receipt.acceptedAt
            ? "accepted"
            : "queued"
          : receipt.state === "running"
            ? receipt.leaseExpired
              ? "failed"
              : "running"
            : receipt.state === "succeeded"
              ? "completed"
              : receipt.stages.some(
                    (s) =>
                      s.state === "stage_completed" &&
                      ["calendar_processing", "gmail_processing"].includes(
                        s.stage,
                      ),
                  )
                ? "partial"
                : "failed";
  const permission = receipt?.stages.some(
    (s) => s.errorCategory === "gmail_read_permission",
  );
  const recovery = !enabled
    ? "Processing is disabled by server configuration. Keep it disabled until controlled provider checks pass and production re-enablement is approved."
    : unavailable
      ? "Receipt history could not be read. Refresh status; an administrator must verify the observation migration and service-only RPC permissions."
      : permission
        ? "Gmail read permission was unavailable. Verify read-only Gmail scope with a controlled account before retrying; sending permission alone does not verify intake."
        : status === "partial" || status === "failed"
          ? "Some work may already be committed. Retry the existing receipt after reviewing the failed stage; do not backfill or reset imported records."
          : status === "running"
            ? "Processing has a lease. Follow this receipt until it completes; accepted dispatch does not prove an import."
            : status === "queued"
              ? "Work is queued. The next signed dispatch can retry the same receipt."
              : "Saved outcomes are evidence of recorded processing only. External Calendar and mailbox delivery require separate verification.";
  return { enabled, status, receipt, recovery };
}
export type IntakeDispatch = {
  status: "disabled" | "accepted" | "already_running";
  jobId?: string;
};
export function intakeDispatchNotice(result: IntakeDispatch) {
  if (result.status === "disabled")
    return "Provider intake is disabled. No Calendar or Gmail scan was started.";
  if (result.status === "already_running")
    return "Provider intake is already running. Follow its receipt below for the processing outcome.";
  return "Provider intake dispatch was accepted. Processing has not yet been verified; follow the receipt below.";
}
