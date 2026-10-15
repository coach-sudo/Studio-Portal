import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { Dialog, ListControls } from "./Primitives";
import { LessonBulkWorkspace } from "./LessonBulkWorkspace";
import {
  previewLessonBulk,
  readLessonBulkCandidates,
} from "../data/lessonBulk";
import { lessonBulkLabels } from "../domain/lessonBulkPresentation";
import type {
  LessonBulkOperation,
  LessonBulkPreviewInput,
} from "../domain/lessonBulk";
import { formatStudioDateTime } from "../domain/presentation";
import { useLessonSelection } from "../hooks/useLessonSelection";
import { supabase } from "../lib/supabase";
import "./LessonBulk.css";

const operations = Object.keys(lessonBulkLabels) as LessonBulkOperation[];
const safePage = (value: string | null) =>
  Math.max(1, Math.min(100000, Math.floor(Number(value)) || 1));

export function LessonBulkList({
  studioId,
  studentId,
  timezone,
}: {
  studioId: string;
  studentId?: string;
  timezone: string;
}) {
  const [identity, setIdentity] = useState<string | null>(null);
  useEffect(() => {
    const subscription = supabase?.auth.onAuthStateChange((_event, session) =>
      setIdentity(session?.user.id ?? null),
    );
    return () => subscription?.data.subscription.unsubscribe();
  }, []);
  // Remount identity-owned state, including in-flight review forms, on account changes.
  return identity ? (
    <AuthenticatedLessonBulkList
      key={`${identity}:${studioId}`}
      identity={identity}
      studioId={studioId}
      studentId={studentId}
      timezone={timezone}
    />
  ) : (
    <p role="status">Checking coach access…</p>
  );
}

function AuthenticatedLessonBulkList({
  identity,
  studioId,
  studentId,
  timezone,
}: {
  identity: string;
  studioId: string;
  studentId?: string;
  timezone: string;
}) {
  const [params, setParams] = useSearchParams();
  const page = safePage(params.get("lessonPage"));
  const size = [10, 25, 50, 100].includes(Number(params.get("lessonSize")))
    ? Number(params.get("lessonSize"))
    : 25;
  const query = (params.get("lessonQuery") || "").slice(0, 120);
  const status = params.get("lessonStatus") || "";
  const includeArchived = params.get("lessonArchived") === "true";
  const [archiveInput, setArchiveInput] = useState(includeArchived);
  useEffect(() => setArchiveInput(includeArchived), [includeArchived]);
  const filterPending = archiveInput !== includeArchived;
  const filter = useMemo<NonNullable<LessonBulkPreviewInput["filter"]>>(
    () => ({
      ...(studentId ? { studentId } : {}),
      ...(query ? { query } : {}),
      ...(["scheduled", "completed", "cancelled", "late_cancelled"].includes(
        status,
      )
        ? {
            statuses: [
              status as
                "scheduled" | "completed" | "cancelled" | "late_cancelled",
            ],
          }
        : {}),
      includeArchived,
      sort: "starts_at",
    }),
    [studentId, query, status, includeArchived],
  );
  const selection = useLessonSelection(
    JSON.stringify([identity, studioId, filter]),
  );
  const [operation, setOperation] = useState<LessonBulkOperation | null>(null);
  useEffect(() => setOperation(null), [filter]);
  const recentKey = `lesson-bulk-recent:${identity}:${studioId}:${studentId || "studio"}`;
  const [recent, setRecent] = useState(() => {
    try {
      return sessionStorage.getItem(recentKey);
    } catch {
      return null;
    }
  });
  useEffect(() => {
    try {
      setRecent(sessionStorage.getItem(recentKey));
    } catch {
      setRecent(null);
    }
  }, [recentKey]);
  const q = useQuery({
    queryKey: [
      "lesson-bulk",
      identity,
      studioId,
      "candidates",
      filter,
      page,
      size,
    ],
    queryFn: () => readLessonBulkCandidates(filter, (page - 1) * size, size),
    retry: false,
  });
  const items = (!q.error && q.data?.items) || [];
  const total = (!q.error && q.data?.count) || 0;
  const allVisible =
    items.length > 0 && items.every((item) => selection.isSelected(item.id));
  const someVisible = items.some((item) => selection.isSelected(item.id));
  const checkbox = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (checkbox.current)
      checkbox.current.indeterminate = someVisible && !allVisible;
  }, [someVisible, allVisible]);
  const changeParams = (
    values: Record<string, string>,
    filterChanged = false,
  ) =>
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        for (const [key, value] of Object.entries(values))
          value ? next.set(key, value) : next.delete(key);
        if (filterChanged) next.delete("lessonPage");
        return next;
      },
      { replace: true, preventScrollReset: true },
    );
  const jobId = params.get("lessonBatch");
  const openJob = (id: string, expected?: number) =>
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        next.set("lessonBatch", id);
        if (expected !== undefined)
          next.set("lessonExpected", String(expected));
        return next;
      },
      { preventScrollReset: true },
    );
  const closeJob = () =>
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        next.delete("lessonBatch");
        next.delete("lessonExpected");
        return next;
      },
      { replace: true, preventScrollReset: true },
    );
  useEffect(() => {
    if (!jobId) return;
    setRecent(jobId);
    try {
      sessionStorage.setItem(recentKey, jobId);
    } catch {
      /* Optional shortcut; URL remains usable. */
    }
  }, [jobId, recentKey]);
  // Dialog history is URL driven. Back removes the batch parameter and closes it.
  return (
    <div className="lesson-bulk-list" aria-label="Lesson list">
      <div className="bulk-filters">
        <label>
          Search lesson titles
          <input
            type="search"
            value={query}
            maxLength={120}
            onChange={(e) =>
              changeParams({ lessonQuery: e.target.value }, true)
            }
          />
        </label>
        <label>
          Status
          <select
            value={status}
            onChange={(e) =>
              changeParams({ lessonStatus: e.target.value }, true)
            }
          >
            <option value="">All statuses</option>
            <option value="scheduled">Scheduled</option>
            <option value="completed">Completed</option>
            <option value="cancelled">Cancelled</option>
            <option value="late_cancelled">Late cancelled</option>
          </select>
        </label>
        <label className="bulk-check">
          <input
            type="checkbox"
            checked={archiveInput}
            disabled={filterPending}
            onChange={(e) => {
              setArchiveInput(e.target.checked);
              changeParams({ lessonArchived: String(e.target.checked) }, true);
            }}
          />
          Include archived
        </label>
        {recent && (
          <button onClick={() => openJob(recent)}>Reopen latest batch</button>
        )}
      </div>
      <p className="visually-hidden" role="status" aria-live="polite">
        {selection.announcement}
      </p>
      {selection.count > 0 && (
        <div
          className="bulk-toolbar"
          role="region"
          aria-label="Selected lesson actions"
        >
          <strong>
            {selection.count} selected
            {selection.value.mode === "matching"
              ? " across matching results"
              : ""}
          </strong>
          <button onClick={selection.clear}>Clear selection</button>
          <label>
            Action
            <select
              aria-label="Bulk lesson action"
              disabled={filterPending}
              defaultValue=""
              onChange={(e) => {
                if (e.target.value)
                  setOperation(e.target.value as LessonBulkOperation);
                e.target.value = "";
              }}
            >
              <option value="" disabled>
                Choose action…
              </option>
              {operations.map((op) => (
                <option value={op} key={op}>
                  {lessonBulkLabels[op]}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}
      <div className="bulk-selection-line">
        <label className="bulk-check">
          <input
            ref={checkbox}
            type="checkbox"
            checked={allVisible}
            disabled={!items.length || q.isFetching || filterPending}
            onChange={(e) =>
              selection.toggle(
                items.map((item) => item.id),
                e.target.checked,
              )
            }
          />
          Select all visible
        </label>
        {total > 0 && (
          <button
            disabled={total > 5000 || q.isFetching || filterPending}
            onClick={() => selection.allMatching(total)}
          >
            Select all {total} matching lessons
          </button>
        )}
        {total > 5000 && (
          <span>Narrow the filters to select at most 5,000 lessons.</span>
        )}
        {selection.value.mode === "matching" && (
          <span>
            Matching IDs are frozen when you review. Excluded:{" "}
            {selection.value.excluded.size}.
          </span>
        )}
      </div>
      {q.isPending && <p role="status">Loading lessons…</p>}
      {q.error && (
        <div role="alert">
          <p>Lessons could not be loaded.</p>
          <button onClick={() => void q.refetch()}>
            Retry loading lessons
          </button>
        </div>
      )}
      {q.data && !q.error && (
        <>
          <ListControls
            page={page}
            pageSize={size}
            pageCount={Math.max(1, Math.ceil(total / size))}
            total={total}
            onPage={(n) => changeParams({ lessonPage: String(n) })}
            onPageSize={(n) =>
              changeParams({ lessonSize: String(n), lessonPage: "1" })
            }
            label="lessons"
          />
          <ul
            className="bulk-lesson-rows"
            aria-label="Selectable lessons"
            aria-busy={q.isFetching}
          >
            {items.map((item) => (
              <li key={item.id}>
                <label className="bulk-row-select">
                  <input
                    type="checkbox"
                    disabled={filterPending}
                    aria-label={`Select ${item.topic}`}
                    checked={selection.isSelected(item.id)}
                    onChange={(e) =>
                      selection.toggle([item.id], e.target.checked)
                    }
                  />
                </label>
                <div className="bulk-lesson-identity">
                  <Link
                    to={
                      studentId || item.student_id
                        ? `/coach/students/${studentId || item.student_id}/lessons/${item.id}`
                        : `/coach/bookings?view=calendar&lesson=${item.id}`
                    }
                  >
                    <strong>{item.topic}</strong>
                  </Link>
                  <small>
                    {!studentId &&
                      `${item.studentNames.join(", ") || "Class"} · `}
                    {formatStudioDateTime(item.starts_at, timezone)}
                  </small>
                </div>
                <span className="bulk-lesson-status">
                  {item.coachArchivedAt ? "Archived · " : ""}
                  {item.status.replaceAll("_", " ")}
                  {item.series_id ? " · Recurring" : ""}
                </span>
              </li>
            ))}
          </ul>
          {!items.length && (
            <p>
              {total
                ? "No lessons on this page. Return to an earlier page."
                : "No matching lessons."}
              {page > 1 && (
                <button onClick={() => changeParams({ lessonPage: "1" })}>
                  First page
                </button>
              )}
            </p>
          )}
          <p className="bulk-result-count">{total} matching lessons</p>
        </>
      )}
      {operation && (
        <BulkReviewForm
          key={`${operation}:${JSON.stringify(filter)}`}
          operation={operation}
          filter={filter}
          studentId={studentId}
          selection={selection.value}
          selectedCount={selection.count}
          onClose={() => setOperation(null)}
          onReviewed={(id) => {
            setOperation(null);
            openJob(id, selection.count);
          }}
        />
      )}
      {jobId && (
        <LessonBulkWorkspace
          key={jobId}
          jobId={jobId}
          expectedSelectionCount={
            Number(params.get("lessonExpected")) || undefined
          }
          identity={identity}
          studioId={studioId}
          timezone={timezone}
          onClose={closeJob}
          onAccepted={selection.clear}
          onReviewAgain={() => {
            closeJob();
            void q.refetch();
          }}
        />
      )}
    </div>
  );
}

function BulkReviewForm({
  operation,
  filter,
  studentId,
  selection,
  selectedCount,
  onClose,
  onReviewed,
}: {
  operation: LessonBulkOperation;
  filter: NonNullable<LessonBulkPreviewInput["filter"]>;
  studentId?: string;
  selection: ReturnType<typeof useLessonSelection>["value"];
  selectedCount: number;
  onClose: () => void;
  onReviewed: (id: string) => void;
}) {
  const [reason, setReason] = useState("");
  const [scope, setScope] = useState<"selected" | "future" | "series">(
    "selected",
  );
  const [wholeClass, setWholeClass] = useState(false),
    [useCredit, setUseCredit] = useState(false);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const requestKey = useRef<{ signature: string; key: string } | null>(null);
  const createReview = async () => {
    if (busy) return;
    const input: LessonBulkPreviewInput = {
      operation,
      scope,
      filter,
      studentContextId: studentId,
      wholeClass,
      useCredit,
      ...(selection.mode === "matching"
        ? { selectionMode: "matching", excludedIds: [...selection.excluded] }
        : { selectionMode: "ids", selectedIds: [...selection.ids] }),
    };
    const signature = JSON.stringify([input, reason.trim()]);
    if (requestKey.current?.signature !== signature)
      requestKey.current = { signature, key: crypto.randomUUID() };
    setBusy(true);
    setError("");
    try {
      const result = await previewLessonBulk(
        input,
        reason.trim(),
        requestKey.current.key,
      );
      onReviewed(result.jobId);
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Review could not be created. Retry to recover the same review.",
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog title={lessonBulkLabels[operation]} onClose={onClose}>
      <form
        className="lesson-bulk-workspace"
        onSubmit={(e) => {
          e.preventDefault();
          void createReview();
        }}
      >
        <p>
          <strong>
            {selectedCount} selected
            {selection.mode === "matching" ? " across matching results" : ""}.
          </strong>{" "}
          Eligibility and exact consequences are checked next.
        </p>
        <label>
          Scope
          <select
            disabled={busy}
            value={scope}
            onChange={(e) => setScope(e.target.value as typeof scope)}
          >
            <option value="selected">Selected occurrences only</option>
            {selection.mode === "ids" && (
              <>
                <option value="future">
                  All future occurrences from selected lessons
                </option>
                <option value="series">Entire series</option>
              </>
            )}
          </select>
        </label>
        {scope !== "selected" && (
          <p role="status">
            The next review will show the expanded IDs and count.{" "}
            {operation === "cancel" &&
              "Confirming will also stop future generation for the reviewed series."}
          </p>
        )}
        {!studentId && (
          <label className="bulk-check">
            <input
              type="checkbox"
              disabled={busy}
              checked={wholeClass}
              onChange={(e) => setWholeClass(e.target.checked)}
            />
            Review as whole-class operation
          </label>
        )}
        {operation === "cancel" && (
          <label className="bulk-check">
            <input
              type="checkbox"
              disabled={busy}
              checked={useCredit}
              onChange={(e) => setUseCredit(e.target.checked)}
            />
            Retain covered lesson credits
          </label>
        )}
        <label>
          Reason
          <textarea
            required
            minLength={3}
            maxLength={500}
            value={reason}
            disabled={busy}
            onChange={(e) => setReason(e.target.value)}
          />
        </label>
        {operation === "delete" && (
          <p>
            Permanent deletion physically removes eligible mistakes. Protected
            records stay intact.
          </p>
        )}
        {operation === "void" && (
          <p>
            Void preserves cancelled erroneous records and their history. It
            does not reverse payments.
          </p>
        )}
        {error && <p role="alert">{error}</p>}
        <div className="bulk-actions">
          <button
            className="primary"
            disabled={busy || reason.trim().length < 3 || !selectedCount}
          >
            {busy ? "Checking eligibility…" : "Review batch"}
          </button>
          <button type="button" disabled={busy} onClick={onClose}>
            Back
          </button>
        </div>
      </form>
    </Dialog>
  );
}
