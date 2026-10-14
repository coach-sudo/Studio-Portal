import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Dialog, ListControls, Status } from "./Primitives";
import {
  executeLessonBulk,
  readLessonBulkProgress,
  readLessonRecordHistory,
  retryLessonBulk,
} from "../data/lessonBulk";
import {
  lessonBulkLabels,
  lessonBulkReason,
} from "../domain/lessonBulkPresentation";
import { formatStudioDateTime } from "../domain/presentation";
import { formatMoney } from "../domain/finance";
import { invalidateStudioDomains } from "../hooks/useStudio";
import type { LessonBulkProgress } from "../domain/lessonBulk";

const states: Record<string, string> = {
  pending: "Waiting",
  processing: "Processing",
  succeeded: "Completed",
  blocked: "Blocked",
  skipped: "Skipped",
  conflicted: "Conflicted",
  failed: "Failed",
};

export function LessonBulkWorkspace({
  jobId,
  identity,
  studioId,
  timezone,
  expectedSelectionCount,
  onClose,
  onReviewAgain,
  onAccepted,
}: {
  jobId: string;
  identity: string;
  studioId: string;
  timezone: string;
  expectedSelectionCount?: number;
  onClose: () => void;
  onReviewAgain: () => void;
  onAccepted: () => void;
}) {
  const client = useQueryClient();
  const [page, setPage] = useState(1),
    [size, setSize] = useState(25);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [historyId, setHistoryId] = useState<string>();
  const retryKey = useRef<string | null>(null);
  const observed = useRef(-1);
  const query = useQuery({
    queryKey: [
      "lesson-bulk",
      identity,
      studioId,
      "progress",
      jobId,
      page,
      size,
    ],
    queryFn: () => readLessonBulkProgress(jobId, (page - 1) * size, size),
    enabled: !!identity,
    retry: false,
    refetchInterval: (q) =>
      q.state.data?.state !== "reviewed" &&
      (q.state.data?.counts.pending ||
        q.state.data?.counts.synchronizationPending ||
        q.state.data?.counts.failed)
        ? 4000
        : false,
  });
  const progress = query.error ? undefined : query.data;
  useEffect(() => {
    if (
      !progress ||
      progress.state === "reviewed" ||
      observed.current === progress.counts.succeeded
    )
      return;
    observed.current = progress.counts.succeeded;
    void invalidateStudioDomains(client, [
      "lessons",
      "booking",
      "finance",
      "messaging",
      "work",
    ]);
    for (const key of [
      "lesson-bulk",
      "credit-account",
      "invoices",
      "credit-coverage",
    ])
      void client.invalidateQueries({ queryKey: [key] });
  }, [progress, client]);
  const run = async (retry = false) => {
    if (!progress || busy) return;
    setBusy(true);
    setError("");
    const review = { jobId, reviewToken: progress.reviewContext.reviewToken };
    try {
      if (retry) {
        retryKey.current ||= crypto.randomUUID();
        const result = await retryLessonBulk(review, retryKey.current);
        retryKey.current = null;
        setNotice(
          `${result.retried} failed items queued for another attempt. Successful and conflicted items are unchanged.`,
        );
      } else {
        await executeLessonBulk(review, `bulk-execute:${jobId}`);
        onAccepted();
        setNotice(
          "Batch accepted. Waiting for processing; no completion is implied.",
        );
      }
      await client.invalidateQueries({
        queryKey: ["lesson-bulk", identity, studioId, "progress", jobId],
      });
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "The request could not be confirmed. Refresh status or retry the same request.",
      );
      void query.refetch();
    } finally {
      setBusy(false);
    }
  };
  const reviewed = progress?.state === "reviewed";
  const expired = !!progress && Date.parse(progress.expiresAt) <= Date.now();
  return (
    <Dialog
      title={
        progress
          ? `${lessonBulkLabels[progress.operation]} · ${reviewed ? "Review" : "Results"}`
          : "Lesson batch"
      }
      onClose={onClose}
    >
      <div className="lesson-bulk-workspace">
        {query.isPending && <p role="status">Loading the reviewed batch…</p>}
        {query.error && (
          <div role="alert">
            <p>
              This batch is unavailable or could not be loaded. No new operation
              was submitted.
            </p>
            <button onClick={() => void query.refetch()}>Retry loading</button>
          </div>
        )}
        {error && (
          <p role="alert" className="inline-notice danger">
            {error}
          </p>
        )}
        {notice && <p role="status">{notice}</p>}
        {progress && (
          <>
            <div aria-live="polite" aria-atomic="true" className="bulk-counts">
              {reviewed ? (
                <>
                  <strong>{progress.counts.total} reviewed</strong>
                  <span>{progress.counts.eligible} eligible</span>
                  <span>{progress.counts.blocked} blocked</span>
                </>
              ) : (
                <>
                  <strong>
                    {progress.counts.succeeded} completed of{" "}
                    {progress.counts.total}
                  </strong>
                  <span>{progress.counts.waiting} waiting</span>
                  <span>{progress.counts.processing} processing</span>
                  <span>{progress.counts.skipped} skipped / blocked</span>
                  <span>{progress.counts.conflicted} conflicted</span>
                  <span>{progress.counts.failed} failed</span>
                  <span>
                    {progress.counts.synchronizationPending} external
                    synchronization pending
                  </span>
                </>
              )}
            </div>
            <p>
              <strong>
                Scope:{" "}
                {progress.scope === "selected"
                  ? "Selected occurrences"
                  : progress.scope === "future"
                    ? "All future occurrences from selected lessons"
                    : "Entire series"}
                .
              </strong>
              {progress.reviewContext.stopsFutureGeneration
                ? " Stops future generation for the reviewed series."
                : " Future generation stays unchanged."}
            </p>
            {progress.reviewContext.selectionMode === "matching" && (
              <p>
                The reviewed matching set is frozen across all pages. Later
                matches are excluded.
              </p>
            )}
            {reviewed &&
              expectedSelectionCount !== undefined &&
              expectedSelectionCount !== progress.counts.total && (
                <p role="status">
                  <strong>
                    The reviewed count differs from your initial selection (
                    {expectedSelectionCount}).
                  </strong>{" "}
                  Matching records or the requested recurring scope changed the
                  set. Confirm only the {progress.counts.total} records in this
                  review.
                </p>
              )}
            {progress.reviewContext.wholeClass && (
              <p>
                <strong>Whole-class operation:</strong> all participants of each
                eligible class are affected.
              </p>
            )}
            <details>
              <summary>Reason and operation details</summary>
              <p>{progress.reviewContext.reason}</p>
              <p>
                {progress.operation === "cancel"
                  ? `Covered credits: ${progress.reviewContext.useCredit ? "retained" : "returned under the existing expiry policy"}. Cancellation notifications and calendar changes apply only to affected occurrences.`
                  : progress.operation === "delete"
                    ? "Eligible records are physically removed. Their immutable deletion snapshot and audit remain. No student email is sent."
                    : progress.operation === "void"
                      ? "Voiding preserves the record, dependencies and history. No payments are reversed or emails sent."
                      : "Archive and restore change coach list visibility. Student history, finances and calendars stay intact. No email is sent."}
              </p>
              <p>Batch ID: {jobId}</p>
              <p>
                Review expires{" "}
                {formatStudioDateTime(progress.expiresAt, timezone)}.
              </p>
            </details>
            {reviewed && (
              <div className="bulk-confirm">
                {expired ? (
                  <p role="status">
                    This review expired. Review the current records again.
                  </p>
                ) : (
                  <p>
                    {progress.operation === "delete"
                      ? `${progress.counts.eligible} eligible records will be permanently deleted. ${progress.counts.blocked} blocked records will be kept.`
                      : `${progress.counts.eligible} eligible records will be processed. ${progress.counts.blocked} blocked records will be kept.`}
                  </p>
                )}
                <button
                  className={
                    progress.operation === "delete"
                      ? "danger-button"
                      : "primary"
                  }
                  disabled={busy || expired || !progress.counts.eligible}
                  onClick={() => void run()}
                >
                  {busy
                    ? "Submitting…"
                    : progress.operation === "delete"
                      ? `Permanently delete ${progress.counts.eligible} eligible lessons`
                      : `Confirm ${lessonBulkLabels[progress.operation].toLowerCase()} (${progress.counts.eligible} eligible)`}
                </button>
                <button disabled={busy} onClick={onReviewAgain}>
                  Change selection or review again
                </button>
              </div>
            )}
            {!reviewed && (
              <div className="bulk-actions">
                <button
                  disabled={busy || !progress.counts.failed}
                  onClick={() => void run(true)}
                >
                  Retry {progress.counts.failed} failed items
                </button>
                <button disabled={busy} onClick={() => void query.refetch()}>
                  Refresh status
                </button>
                {(progress.counts.conflicted > 0 ||
                  progress.counts.blocked > 0) && (
                  <button onClick={onReviewAgain}>
                    Return to lessons for a new review
                  </button>
                )}
                <p>
                  You can close this view and reopen this batch from the same
                  URL.
                </p>
              </div>
            )}
            <ListControls
              page={page}
              pageSize={size}
              pageCount={Math.max(1, Math.ceil(progress.counts.total / size))}
              total={progress.counts.total}
              onPage={setPage}
              onPageSize={setSize}
              label="reviewed lessons"
            />
            <ul className="bulk-review-list" aria-label="Reviewed lessons">
              {progress.items.map((item) => (
                <BulkResultRow
                  key={item.id}
                  item={item}
                  reviewed={reviewed}
                  timezone={timezone}
                  onHistory={() => setHistoryId(item.lessonId)}
                />
              ))}
            </ul>
            {progress.counts.conflicted > 0 && (
              <p>
                Conflicted records were not changed. A fresh review is required;
                retry cannot approve them.
              </p>
            )}
          </>
        )}
        {historyId && (
          <LessonHistory
            lessonId={historyId}
            identity={identity}
            studioId={studioId}
            timezone={timezone}
            onClose={() => setHistoryId(undefined)}
          />
        )}
      </div>
    </Dialog>
  );
}

function BulkResultRow({
  item,
  reviewed,
  timezone,
  onHistory,
}: {
  item: LessonBulkProgress["items"][number];
  reviewed: boolean;
  timezone: string;
  onHistory: () => void;
}) {
  const a = item.assessment;
  return (
    <li className="bulk-review-row">
      <div className="bulk-row-heading">
        <div>
          <strong>{a.topic || "Unavailable lesson"}</strong>
          <small>
            {item.studentNames.join(", ") || "Student context unavailable"} ·{" "}
            {a.startsAt
              ? formatStudioDateTime(a.startsAt, timezone)
              : "Date unavailable"}
          </small>
        </div>
        <Status
          tone={
            item.status === "succeeded"
              ? "good"
              : ["blocked", "failed", "conflicted"].includes(item.status)
                ? "warn"
                : "neutral"
          }
        >
          {reviewed && item.status === "pending"
            ? "Eligible"
            : states[item.status] || item.status}
        </Status>
      </div>
      {item.reasonCode && <p>{lessonBulkReason(item.reasonCode)}</p>}
      <details>
        <summary>Consequences and history</summary>
        {!reviewed && (
          <p>
            {item.attempts} processing attempts
            {item.nextRetryAt
              ? ` · Automatic retry available after ${formatStudioDateTime(item.nextRetryAt, timezone)}`
              : ""}
            .
          </p>
        )}
        <p>
          {a.status} {a.seriesId ? "· Recurring occurrence" : ""}{" "}
          {a.class ? "· Shared class" : ""}{" "}
          {a.providerLinked ? "· Provider linked" : ""}
        </p>
        {a.bookings?.map((b) => (
          <p key={b.id}>
            {b.shared
              ? `Shared booking: ${b.unaffectedActive} unaffected active occurrences remain valid.`
              : "Booking linked to this occurrence."}
          </p>
        ))}
        <p>
          {a.reservedCredits || 0} reserved credits ·{" "}
          {a.financialConsequences?.creditSettlement === "none"
            ? "No credit change"
            : a.creditPolicy === "retain"
              ? "Retain covered credits"
              : "Return eligible credits under the existing expiry policy"}
        </p>
        <p>Payment history preserved. No automatic cash refund.</p>
        {a.financialConsequences?.invoiceLines?.map((line, i) => (
          <p key={`${line.invoiceId}:${i}`}>
            Invoice {line.invoiceId}:{" "}
            {formatMoney(line.paidMinor, line.currency)} paid is preserved;{" "}
            {formatMoney(line.unpaidWaiverMinor, line.currency)} unpaid is
            waived.
          </p>
        ))}
        <p>
          {a.calendarEffect
            ? "Calendar synchronization required for this occurrence."
            : "No calendar change."}{" "}
          {a.notificationEffect
            ? "Cancellation notice to affected participants."
            : "No student email."}
        </p>
        {Object.entries(a.dependencies || {})
          .filter(([, v]) => v.count > 0)
          .map(([name, v]) => (
            <p key={name}>
              {name}: {v.count} linked records
            </p>
          ))}
        <div className="bulk-actions">
          {!(
            item.status === "succeeded" &&
            (item.result as { deleted?: boolean } | null)?.deleted
          ) && (
            <Link
              to={
                a.class ||
                item.reasonCode === "class_scope_required" ||
                !a.studentIds?.[0]
                  ? `/coach/bookings?view=calendar&lesson=${item.lessonId}`
                  : `/coach/students/${a.studentIds[0]}/lessons/${item.lessonId}`
              }
            >
              {a.class || item.reasonCode === "class_scope_required"
                ? "Open class"
                : "Open lesson"}
            </Link>
          )}
          <button onClick={onHistory}>View record history</button>
        </div>
      </details>
    </li>
  );
}

function LessonHistory({
  lessonId,
  identity,
  studioId,
  timezone,
  onClose,
}: {
  lessonId: string;
  identity: string;
  studioId: string;
  timezone: string;
  onClose: () => void;
}) {
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(25);
  const q = useQuery({
    queryKey: [
      "lesson-bulk",
      identity,
      studioId,
      "history",
      lessonId,
      page,
      size,
    ],
    queryFn: () => readLessonRecordHistory(lessonId, (page - 1) * size, size),
    retry: false,
  });
  return (
    <Dialog title="Lesson record history" onClose={onClose}>
      {q.isPending && <p role="status">Loading history…</p>}
      {q.error && <p role="alert">History is unavailable.</p>}
      {q.data && !q.error && (
        <div className="lesson-bulk-workspace">
          <h3>
            {(q.data.lesson || q.data.deletion?.snapshot.lesson)?.topic ||
              "Lesson unavailable"}
          </h3>
          {q.data.deletion && (
            <>
              <p>
                <strong>Permanently deleted.</strong> The audit and deletion
                snapshot are retained.
              </p>
              <p>{q.data.deletion.reason}</p>
              <p>
                Actor: {q.data.deletion.actor_id} · Batch:{" "}
                {q.data.deletion.job_id}
              </p>
            </>
          )}
          {q.data.state?.archived_at && (
            <p>
              Archived{" "}
              {formatStudioDateTime(q.data.state.archived_at, timezone)}.
            </p>
          )}
          {q.data.state?.voided_at && <p>Voided: {q.data.state.void_reason}</p>}
          <ListControls
            page={page}
            pageSize={size}
            pageCount={Math.ceil(q.data.auditCount / size)}
            total={q.data.auditCount}
            onPage={setPage}
            onPageSize={setSize}
            label="audit events"
          />
          <ul>
            {q.data.audit.map((event) => (
              <li key={event.id}>
                {event.action} ·{" "}
                {formatStudioDateTime(event.created_at, timezone)}
              </li>
            ))}
          </ul>
        </div>
      )}
    </Dialog>
  );
}
