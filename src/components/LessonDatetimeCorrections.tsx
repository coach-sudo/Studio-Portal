import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
} from "react";
import type { Lesson } from "../domain/model";
import { formatZonedInput, zonedInputInstants } from "../domain/zonedInput";
import {
  correctionPreviewSchema,
  correctionHistorySchema,
  correctionReasons,
  type CorrectionPreview,
  type CorrectionHistory,
} from "../domain/lessonCorrections";
import { studioCommand } from "../data/bookingCommands";
import { Dialog } from "./Primitives";
import { TimezoneSelect } from "./TimezoneSelect";
import "./LessonDatetimeCorrections.css";

const message = (error: unknown) =>
  error instanceof Error
    ? error.message
    : "The correction could not be completed. Your input is retained.";
const wallTime = (instant: string, zone: string) => {
  try {
    return formatZonedInput(instant, zone);
  } catch {
    return "";
  }
};
export function LessonDatetimeCorrections({
  lesson,
  timezone,
  onApplied,
  onFinancialReview,
}: {
  lesson: Lesson;
  timezone: string;
  onApplied: () => Promise<void> | void;
  onFinancialReview?: () => void;
}) {
  const [open, setOpen] = useState(false),
    [history, setHistory] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={(event) => {
          // WebKit does not focus buttons on pointer activation. Capture this
          // opener explicitly so Escape can restore a useful focus target.
          event.currentTarget.focus();
          setHistory(false);
          setOpen(true);
        }}
      >
        Correct lesson date/time
      </button>
      {open && (
        <Dialog
          key={history ? "history" : "correction"}
          className="corrections-dialog"
          title={
            history
              ? "Correction history and reviews"
              : "Correct lesson date/time"
          }
          description="One occurrence only. Attendance, creation time and accounting stay unchanged. Calendar and notifications are not sent."
          onClose={() => setOpen(false)}
        >
          {history ? (
            <CorrectionHistoryPanel
              lesson={lesson}
              onBack={() => setHistory(false)}
              onFinancialReview={
                onFinancialReview
                  ? () => {
                      setOpen(false);
                      onFinancialReview();
                    }
                  : undefined
              }
            />
          ) : (
            <>
              <LessonDatetimeCorrectionForm
                lesson={lesson}
                timezone={timezone}
                onCancel={() => setOpen(false)}
                onApplied={async () => {
                  await onApplied();
                  setOpen(false);
                }}
              />
              <div className="workflow-content">
                <button type="button" onClick={() => setHistory(true)}>
                  View correction history and reviews
                </button>
              </div>
            </>
          )}
        </Dialog>
      )}
    </>
  );
}

export function LessonDatetimeCorrectionForm({
  lesson,
  timezone,
  onCancel,
  onApplied,
}: {
  lesson: Lesson;
  timezone: string;
  onCancel: () => void;
  onApplied: () => Promise<void> | void;
}) {
  const id = useId();
  const [zone, setZone] = useState(timezone),
    [starts, setStarts] = useState(() => wallTime(lesson.startsAt, timezone)),
    [ends, setEnds] = useState(() => wallTime(lesson.endsAt, timezone));
  const [startFold, setStartFold] = useState(lesson.startsAt),
    [endFold, setEndFold] = useState(lesson.endsAt);
  const [reason, setReason] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(() =>
      wallTime(lesson.startsAt, timezone)
        ? ""
        : "Choose an explicit valid correction timezone.",
    );
  const [review, setReview] = useState<CorrectionPreview>(),
    [prepared, setPrepared] = useState<Record<string, unknown>>();
  const [financial, setFinancial] = useState(false),
    [outcome, setOutcome] = useState(false);
  const keys = useRef(new Map<string, string>());
  const instants = (wall: string, fold: string) => {
    const values = zonedInputInstants(wall, zone);
    return values.length === 1 ? values[0] : values.find((x) => x === fold);
  };
  const run = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setError("");
    const start = instants(starts, startFold),
      end = instants(ends, endFold);
    if (!start || !end || Date.parse(end) <= Date.parse(start)) {
      setError(
        "Choose valid start and end times. A DST gap does not exist; a repeated hour needs an occurrence choice.",
      );
      return;
    }
    setBusy(true);
    try {
      const payload = review
        ? {
            ...prepared,
            reviewToken: review.reviewToken,
            financialAcknowledged: financial,
            outcomeAcknowledged: outcome,
          }
        : { startsAt: start, endsAt: end, timezone: zone };
      const expectedVersion = review?.version ?? lesson.version;
      const signature = JSON.stringify({
        payload,
        reason,
        version: expectedVersion,
      });
      const key = keys.current.get(signature) || crypto.randomUUID();
      keys.current.set(signature, key);
      const result = await studioCommand("lessons", {
        command: review ? "correct_datetime" : "preview_datetime_correction",
        entityId: lesson.id,
        expectedVersion,
        idempotencyKey: key,
        reason,
        payload,
      });
      if (review) await onApplied();
      else {
        setReview(correctionPreviewSchema.parse(result.resource));
        setPrepared(payload);
      }
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  };
  const timeField = (
    label: string,
    wall: string,
    fold: string,
    setWall: (s: string) => void,
    setFold: (s: string) => void,
  ) => {
    const values = zonedInputInstants(wall, zone),
      field = id + label;
    return (
      <div>
        <label htmlFor={field}>
          {label}
          <input
            id={field}
            required
            type="datetime-local"
            value={wall}
            onChange={(e) => {
              setWall(e.target.value);
              setFold("");
            }}
          />
        </label>
        {values.length > 1 && (
          <>
            <label htmlFor={field + "-fold"}>
              {label} repeated-hour occurrence
              <select
                id={field + "-fold"}
                required
                value={values.includes(fold) ? fold : ""}
                onChange={(e) => setFold(e.target.value)}
              >
                <option value="">Choose occurrence</option>
                {values.map((value, i) => (
                  <option key={value} value={value}>
                    {i === 0 ? "First" : "Second"} occurrence
                  </option>
                ))}
              </select>
            </label>
            <small>UTC choices: {values.join(" or ")}</small>
          </>
        )}
      </div>
    );
  };
  return (
    <form className="workflow-form" onSubmit={run}>
      {error && (
        <p className="inline-error" role="alert">
          {error}
        </p>
      )}
      {!review ? (
        <>
          <div className="full">
            <span>Correction timezone</span>
            <TimezoneSelect
              id={id + "-zone"}
              ariaLabel="Correction timezone"
              defaultToDevice={false}
              value={zone}
              onChange={(next) => {
                const a = instants(starts, startFold) || lesson.startsAt,
                  b = instants(ends, endFold) || lesson.endsAt;
                setZone(next);
                setStarts(wallTime(a, next));
                setEnds(wallTime(b, next));
                setStartFold(a);
                setEndFold(b);
                setError("");
              }}
            />
          </div>
          {timeField("Starts", starts, startFold, setStarts, setStartFold)}
          {timeField("Ends", ends, endFold, setEnds, setEndFold)}
          <label className="full" htmlFor={id + "-reason"}>
            Correction reason
            <input
              id={id + "-reason"}
              required
              minLength={3}
              maxLength={2000}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </label>
          <p className="full">
            This records a correction, preserving the {lesson.status} outcome.
            Use Reschedule Upcoming Lesson for an ordinary scheduling move.
          </p>
        </>
      ) : (
        <>
          <div className="full">
            <strong>Review this occurrence</strong>
            <p>
              {starts.replace("T", " ")} – {ends.replace("T", " ")} ({zone}).
              Outcome stays {review.status}.
            </p>
            <p>
              {review.participantCount} participants · {review.bookingCount}{" "}
              bookings · {review.invoiceCount} invoices ·{" "}
              {review.creditEntryCount} credit entries.
            </p>
            {review.sharedBooking && (
              <p>
                A shared booking retains its series anchor; only this occurrence
                changes.
              </p>
            )}
            {!review.eligible && (
              <p role="alert">
                {correctionReasons[review.reasonCode || ""] ||
                  "Linked records require review before this correction."}
              </p>
            )}
          </div>
          {review.financialReviewRequired && (
            <label className="check-row full" htmlFor={id + "-financial"}>
              <input
                id={id + "-financial"}
                type="checkbox"
                checked={financial}
                onChange={(e) => setFinancial(e.target.checked)}
              />
              I acknowledge that financial history stays unchanged and linked
              records require review.
            </label>
          )}
          {review.completedInFuture && (
            <label className="check-row full" htmlFor={id + "-outcome"}>
              <input
                id={id + "-outcome"}
                type="checkbox"
                checked={outcome}
                onChange={(e) => setOutcome(e.target.checked)}
              />
              Preserve the recorded completed outcome at this future date.
            </label>
          )}
          <p className="full">
            No credits, payments, Calendar events or messages are created.
            Automatic credit use is held for this corrected lesson; use Credits
            &amp; payment for explicit changes.
            {review.providerReviewRequired &&
              " Calendar/source review will be required."}
          </p>
        </>
      )}
      <div className="form-actions full">
        <button type="button" disabled={busy} onClick={onCancel}>
          Cancel
        </button>
        {review && (
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              setReview(undefined);
              setFinancial(false);
              setOutcome(false);
            }}
          >
            Edit correction
          </button>
        )}
        <button
          className="primary"
          disabled={
            busy ||
            (!!review &&
              (!review.eligible ||
                (review.financialReviewRequired && !financial) ||
                (review.completedInFuture && !outcome)))
          }
        >
          {busy
            ? "Working…"
            : review
              ? "Apply correction"
              : "Preview correction"}
        </button>
      </div>
    </form>
  );
}

function CorrectionHistoryPanel({
  lesson,
  onBack,
  onFinancialReview,
}: {
  lesson: Lesson;
  onBack: () => void;
  onFinancialReview?: () => void;
}) {
  const [data, setData] = useState<CorrectionHistory>(),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [selected, setSelected] = useState<{
      id: string;
      kind: "financial" | "provider";
    }>(),
    [note, setNote] = useState("");
  const keys = useRef(new Map<string, string>()),
    id = useId(),
    sequence = useRef(0);
  const load = useCallback(
    async (cursor: CorrectionHistory["nextCursor"] = null) => {
      const request = ++sequence.current;
      setBusy(true);
      setError("");
      try {
        const result = await studioCommand("lessons", {
          command: "datetime_correction_history",
          entityId: lesson.id,
          expectedVersion: lesson.version,
          reason: "Coach reads correction history",
          payload: { cursor: cursor ?? undefined },
        });
        const next = correctionHistorySchema.parse(result.resource);
        if (request === sequence.current)
          setData((current) =>
            cursor && current
              ? { ...next, items: [...current.items, ...next.items] }
              : next,
          );
      } catch (e) {
        if (request === sequence.current) setError(message(e));
      } finally {
        if (request === sequence.current) setBusy(false);
      }
    },
    [lesson.id, lesson.version],
  );
  const cancelPending = useCallback(() => {
    sequence.current++;
  }, []);
  useEffect(() => {
    void load();
    return cancelPending;
  }, [load, cancelPending]);
  const record = async (e: FormEvent) => {
    e.preventDefault();
    if (!selected || !data) return;
    setBusy(true);
    setError("");
    try {
      const payload = { correctionId: selected.id, kind: selected.kind, note },
        signature = JSON.stringify({ payload, version: data.lessonVersion }),
        key = keys.current.get(signature) || crypto.randomUUID();
      keys.current.set(signature, key);
      await studioCommand("lessons", {
        command: "review_datetime_correction",
        entityId: lesson.id,
        expectedVersion: data.lessonVersion,
        reason: note,
        idempotencyKey: key,
        payload,
      });
      setSelected(undefined);
      setNote("");
      await load();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="workflow-content">
      {error && <p role="alert">{error}</p>}
      <button type="button" onClick={onBack}>
        Back to correction
      </button>
      <button type="button" disabled={busy} onClick={() => void load()}>
        {busy ? "Loading…" : "Refresh history"}
      </button>
      {data && (
        <>
          <p>
            {data.total} corrections · {data.financialReviewsPending} financial
            reviews · {data.providerReviewsPending} Calendar/source reviews
            pending.
          </p>
          {onFinancialReview && (
            <button type="button" onClick={onFinancialReview}>
              Open Credits &amp; payment
            </button>
          )}
          <p>
            Reviews record coach observations. They do not verify provider
            delivery, change accounting or resume automatic credit use.
            Automatic source date/outcome changes to corrected records require
            explicit coach review.
          </p>
          {data.items.map((row) => (
            <article key={row.id}>
              <strong>
                {row.original.startsAt} → {row.corrected.startsAt}
              </strong>
              <p>
                {row.reason} · Recorded {row.recordedAt}
              </p>
              {row.financialReviewRequired && (
                <button
                  type="button"
                  onClick={() => setSelected({ id: row.id, kind: "financial" })}
                >
                  Record financial review
                </button>
              )}
              {row.providerReviewRequired && (
                <button
                  type="button"
                  onClick={() => setSelected({ id: row.id, kind: "provider" })}
                >
                  Record Calendar/source review
                </button>
              )}
            </article>
          ))}
          {data.hasMore && (
            <button
              type="button"
              disabled={busy}
              onClick={() => void load(data.nextCursor)}
            >
              Load more corrections
            </button>
          )}
          {!data.total && <p>No date/time corrections have been recorded.</p>}
        </>
      )}
      {selected && (
        <form onSubmit={record}>
          <label htmlFor={id + "-review"}>
            {selected.kind === "financial" ? "Financial" : "Calendar/source"}{" "}
            review note
            <textarea
              id={id + "-review"}
              required
              minLength={3}
              maxLength={2000}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </label>
          <button type="button" onClick={() => setSelected(undefined)}>
            Cancel review
          </button>
          <button disabled={busy}>Record reviewed</button>
        </form>
      )}
    </div>
  );
}
