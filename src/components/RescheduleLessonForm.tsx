import { AlertTriangle, CalendarClock, Clock3 } from "lucide-react";
import {
  useId,
  useMemo,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { formatZonedInput, zonedInputInstants } from "../domain/zonedInput";
import type { Lesson } from "../domain/model";
import "./RescheduleLessonForm.css";

function wallParts(value: string, timeZone: string) {
  const [date, time] = formatZonedInput(value, timeZone).split("T");
  return { date, time };
}

function shiftedDate(value: string, timeZone: string, days: number) {
  const original = wallParts(value, timeZone);
  const [year, month, day] = original.date.split("-").map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, day + days));
  return [
    shifted.getUTCFullYear(),
    String(shifted.getUTCMonth() + 1).padStart(2, "0"),
    String(shifted.getUTCDate()).padStart(2, "0"),
  ].join("-");
}

function display(value: Date | string, timeZone: string) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(typeof value === "string" ? new Date(value) : value);
}

export function RescheduleLessonForm({
  lesson,
  studentName,
  timezone,
  cancellationWindowHours,
  busy,
  onCancel,
  onSubmit,
  onCheckConflicts,
  renderReview,
}: {
  lesson: Lesson;
  studentName: string;
  timezone: string;
  cancellationWindowHours: number;
  busy: boolean;
  onCancel: () => void;
  onSubmit: (
    startsAt: string,
    endsAt: string,
    allowConflict?: boolean,
  ) => Promise<void> | void;
  onCheckConflicts?: (
    startsAt: string,
    endsAt: string,
  ) => Promise<
    Array<{ id: string; summary: string; start: string; end: string }>
  >;
  renderReview?: (
    times: { startsAt: string; endsAt: string; allowConflict: boolean },
    back: () => void,
  ) => ReactNode;
}) {
  const [reviewTimes, setReviewTimes] = useState<{
    startsAt: string;
    endsAt: string;
    allowConflict: boolean;
  }>();
  const initial = wallParts(lesson.startsAt, timezone);
  const [date, setDate] = useState(initial.date);
  const [time, setTime] = useState(initial.time);
  const [conflicts, setConflicts] = useState<
    Array<{ id: string; summary: string; start: string; end: string }>
  >([]);
  const [approvedTime, setApprovedTime] = useState("");
  const [checking, setChecking] = useState(false);
  const [checkError, setCheckError] = useState("");
  const originalDuration = Math.max(
    1,
    Math.round(
      (new Date(lesson.endsAt).getTime() -
        new Date(lesson.startsAt).getTime()) /
        60_000,
    ),
  );
  const [durationMinutes, setDurationMinutes] = useState(originalDuration);
  const validDuration =
    Number.isInteger(durationMinutes) &&
    durationMinutes >= 15 &&
    durationMinutes <= 720;
  const foldId = useId();
  const [fold, setFold] = useState(lesson.startsAt);
  const candidates = useMemo(
    () => zonedInputInstants(date + "T" + time, timezone),
    [date, time, timezone],
  );
  const nextInstant =
    candidates.length === 1
      ? candidates[0]
      : candidates.find((value) => value === fold);
  const nextStart = nextInstant ? new Date(nextInstant) : undefined;
  const nextEnd =
    nextStart && validDuration
      ? new Date(nextStart.getTime() + durationMinutes * 60_000)
      : undefined;
  const unchanged =
    nextStart?.getTime() === new Date(lesson.startsAt).getTime() &&
    durationMinutes === originalDuration;
  const inPast = Boolean(nextStart && nextStart.getTime() <= Date.now());
  const insidePolicy =
    new Date(lesson.startsAt).getTime() - Date.now() <
    cancellationWindowHours * 3_600_000;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!nextStart || !nextEnd || !validDuration || unchanged || inPast || busy)
      return;
    const key = `${nextStart.toISOString()}|${nextEnd.toISOString()}`;
    if (onCheckConflicts && approvedTime !== key) {
      setChecking(true);
      setCheckError("");
      try {
        const found = await onCheckConflicts(
          nextStart.toISOString(),
          nextEnd.toISOString(),
        );
        setConflicts(found);
        if (found.length) {
          setApprovedTime(key);
          return;
        }
      } catch (reason) {
        setCheckError(
          reason instanceof Error
            ? reason.message
            : "Calendar could not be checked. Nothing was changed.",
        );
        return;
      } finally {
        setChecking(false);
      }
    }
    if (renderReview) {
      setReviewTimes({
        startsAt: nextStart.toISOString(),
        endsAt: nextEnd.toISOString(),
        allowConflict: conflicts.length > 0 && approvedTime === key,
      });
      return;
    }
    await onSubmit(
      nextStart.toISOString(),
      nextEnd.toISOString(),
      conflicts.length > 0 && approvedTime === key,
    );
  };

  if (reviewTimes && renderReview)
    return renderReview(reviewTimes, () => setReviewTimes(undefined));
  return (
    <form className="reschedule-form" onSubmit={submit}>
      <div className="reschedule-current">
        <CalendarClock />
        <div>
          <small>Currently scheduled</small>
          <strong>{display(lesson.startsAt, timezone)}</strong>
          <span>
            {studentName} · {originalDuration} minutes · {lesson.locationLabel}
          </span>
        </div>
      </div>

      <div className="reschedule-quick" aria-label="Quick date choices">
        <span>Keep the same time and move to:</span>
        <div>
          {[
            [1, "Next day"],
            [7, "Next week"],
            [14, "Two weeks later"],
          ].map(([days, label]) => (
            <button
              type="button"
              key={String(days)}
              disabled={busy}
              onClick={() => {
                setDate(shiftedDate(lesson.startsAt, timezone, Number(days)));
                setConflicts([]);
                setFold("");
                setApprovedTime("");
              }}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="reschedule-fields">
        <label>
          New date
          <input
            type="date"
            value={date}
            min={wallParts(new Date().toISOString(), timezone).date}
            disabled={busy}
            onChange={(event) => {
              setDate(event.target.value);
              setConflicts([]);
              setFold("");
              setApprovedTime("");
            }}
          />
        </label>
        <label>
          New time
          <input
            type="time"
            step="900"
            value={time}
            disabled={busy}
            onChange={(event) => {
              setTime(event.target.value);
              setConflicts([]);
              setFold("");
              setApprovedTime("");
            }}
          />
        </label>
      </div>

      {candidates.length > 1 && (
        <label htmlFor={foldId}>
          Repeated hour occurrence
          <select
            id={foldId}
            required
            value={fold}
            onChange={(event) => setFold(event.target.value)}
          >
            <option value="">Choose the intended occurrence</option>
            {candidates.map((value, index) => (
              <option key={value} value={value}>
                {index === 0 ? "First" : "Second"} occurrence — {value} UTC
              </option>
            ))}
          </select>
        </label>
      )}
      {!nextStart && date && time && (
        <p role="alert">
          Choose a valid time in {timezone}; skipped DST times are invalid and
          repeated hours require an occurrence choice.
        </p>
      )}
      <label>
        Duration (minutes)
        <input
          type="number"
          min={15}
          max={720}
          step={15}
          value={durationMinutes}
          disabled={busy}
          onChange={(e) => {
            setDurationMinutes(Number(e.target.value));
            setConflicts([]);
            setFold("");
            setApprovedTime("");
          }}
        />
      </label>
      {nextStart && nextEnd && !unchanged && !inPast && (
        <div className="reschedule-preview" role="status">
          <Clock3 />
          <span>
            <small>New lesson time</small>
            <strong>{display(nextStart, timezone)}</strong>
            <small>Ends {display(nextEnd, timezone)}</small>
          </span>
        </div>
      )}
      {unchanged && (
        <p className="field-help">Choose a different date or time.</p>
      )}
      {inPast && (
        <p className="form-error">The new lesson time must be in the future.</p>
      )}
      {checkError && (
        <p className="form-error" role="alert">
          {checkError}
        </p>
      )}
      {conflicts.length > 0 && (
        <div className="calendar-conflict" role="alert">
          <AlertTriangle />
          <div>
            <strong>Calendar conflict</strong>
            {conflicts.map((item) => (
              <p key={`${item.id}-${item.start}`}>
                You have “{item.summary}” from{" "}
                {new Date(item.start).toLocaleTimeString([], {
                  hour: "numeric",
                  minute: "2-digit",
                })}
                –
                {new Date(item.end).toLocaleTimeString([], {
                  hour: "numeric",
                  minute: "2-digit",
                })}{" "}
                that day. Do you still want to reschedule for this time?
              </p>
            ))}
            <small>Confirm again to override the conflict.</small>
          </div>
        </div>
      )}
      <p
        className={
          insidePolicy ? "reschedule-policy warning" : "reschedule-policy"
        }
      >
        {insidePolicy
          ? "This lesson is inside the " +
            cancellationWindowHours +
            "-hour change window. Coach changes are allowed, but the student’s late-change policy may apply."
          : "The " +
            cancellationWindowHours +
            "-hour change policy is currently satisfied."}{" "}
        Calendar updates and permitted notifications are queued after
        confirmation. Their synchronization status remains visible separately.
      </p>

      <div className="form-actions reschedule-actions">
        <button
          type="button"
          className="text-button"
          disabled={busy}
          onClick={onCancel}
        >
          Keep current time
        </button>
        <button
          type="submit"
          disabled={
            busy ||
            checking ||
            !nextStart ||
            !validDuration ||
            unchanged ||
            inPast
          }
        >
          {busy || checking
            ? "Checking calendar…"
            : conflicts.length
              ? "Reschedule anyway"
              : "Confirm new time"}
        </button>
      </div>
    </form>
  );
}
