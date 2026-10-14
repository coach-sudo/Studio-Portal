import { useState } from "react";
import { studioCommand } from "../data/bookingCommands";
import type { Lesson } from "../domain/model";
import {
  lessonChangeReasons,
  type LessonChangeReview as Review,
} from "../domain/lessonChanges";

export function LessonChangeReview({
  lesson,
  action,
  studentContextId,
  times,
  onApplied,
  onCancel,
}: {
  lesson: Lesson;
  action: "cancel" | "reschedule";
  studentContextId?: string;
  times?: { startsAt: string; endsAt: string; allowConflict?: boolean };
  onApplied: () => Promise<void> | void;
  onCancel: () => void;
}) {
  const [scope, setScope] = useState("occurrence"),
    [wholeClass, setWholeClass] = useState(false),
    [useCredit, setUseCredit] = useState(false),
    [reason, setReason] = useState(""),
    [review, setReview] = useState<Review>(),
    [key, setKey] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const payload = {
    action,
    scope,
    wholeClass,
    useCredit,
    studentContextId,
    ...times,
  };
  const change = () => {
    setReview(undefined);
    setKey("");
    setError("");
  };
  const run = async (execute = false) => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const result = await studioCommand("lessons", {
        command: execute ? "execute_change" : "preview_change",
        entityId: lesson.id,
        expectedVersion: lesson.version,
        reason,
        idempotencyKey: execute ? key : crypto.randomUUID(),
        payload: {
          ...payload,
          ...(execute ? { reviewToken: review!.reviewToken } : {}),
        },
      });
      if (execute) await onApplied();
      else {
        setReview(result.resource);
        setKey(crypto.randomUUID());
      }
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "The change could not be completed.",
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <div>
      <label>
        Change scope
        <select
          value={scope}
          disabled={busy}
          onChange={(e) => {
            setScope(e.target.value);
            change();
          }}
        >
          <option value="occurrence">This occurrence</option>
          {lesson.seriesId && (
            <>
              <option value="future">
                All future occurrences from this lesson
              </option>
              <option value="series">Entire series</option>
            </>
          )}
        </select>
      </label>
      {!studentContextId && (
        <label>
          <input
            type="checkbox"
            disabled={busy}
            checked={wholeClass}
            onChange={(e) => {
              setWholeClass(e.target.checked);
              change();
            }}
          />
          Review as a whole-class operation
        </label>
      )}
      {action === "cancel" && (
        <label>
          <input
            type="checkbox"
            disabled={busy}
            checked={useCredit}
            onChange={(e) => {
              setUseCredit(e.target.checked);
              change();
            }}
          />
          Retain covered lesson credits (otherwise return them under the
          existing policy)
        </label>
      )}
      <label>
        Reason
        <textarea
          value={reason}
          maxLength={500}
          disabled={busy}
          onChange={(e) => {
            setReason(e.target.value);
            change();
          }}
        />
      </label>
      {review && (
        <section aria-label="Reviewed occurrences">
          <p>
            {review.count} occurrence{review.count === 1 ? "" : "s"}.{" "}
            {review.stopsFutureGeneration
              ? "Future generation will stop."
              : lesson.seriesId
                ? "Series settings stay unchanged."
                : "Only this lesson changes."}
          </p>
          <p>
            Calendar changes and existing cancellation or schedule-change
            notifications will be queued for these occurrences.
          </p>
          <ul>
            {review.items.map((item) => (
              <li key={item.lessonId}>
                <strong>{item.topic}</strong> —{" "}
                {new Date(item.startsAt).toLocaleString()}
                {item.newStartsAt &&
                  ` → ${new Date(item.newStartsAt).toLocaleString()}`}{" "}
                ({item.status})
                <span>
                  {" "}
                  {item.notificationParticipantCount} participant(s) in the
                  reviewed notification scope.
                </span>
                {item.bookings.some((b) => b.shared) && (
                  <span>
                    {" "}
                    Shared booking and payment history retained while unaffected
                    occurrences remain.
                  </span>
                )}
                {item.reservedCredits > 0 && (
                  <span>
                    {" "}
                    {item.reservedCredits} reserved credit(s):{" "}
                    {review.creditPolicy}.
                  </span>
                )}
                {!item.eligible && (
                  <p role="alert">
                    {lessonChangeReasons[item.reasonCode || ""] ||
                      "This occurrence requires review."}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
      {error && <p role="alert">{error}</p>}
      <div className="form-actions">
        <button disabled={busy} onClick={onCancel}>
          Keep lesson
        </button>
        <button
          disabled={busy || reason.trim().length < 3}
          onClick={() => void run(false)}
        >
          {busy ? "Processing…" : "Review changes"}
        </button>
        {review && (
          <button
            className={action === "cancel" ? "danger-button" : "primary"}
            disabled={busy || review.items.some((i) => !i.eligible)}
            onClick={() => void run(true)}
          >
            Confirm {action === "cancel" ? "cancellation" : "reschedule"}
          </button>
        )}
      </div>
    </div>
  );
}
