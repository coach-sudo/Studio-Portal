import { CalendarClock, Clock3 } from "lucide-react";
import { useMemo, useState, type FormEvent } from "react";
import { zonedDateTimeToUtc } from "../domain/booking";
import type { Lesson } from "../domain/model";
import "./RescheduleLessonForm.css";

function wallParts(value: string, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(value));
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value || "";
  return {
    date: [part("year"), part("month"), part("day")].join("-"),
    time: [part("hour"), part("minute")].join(":"),
  };
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

function asUtc(date: string, time: string, timeZone: string) {
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  if (![year, month, day, hour, minute].every(Number.isFinite)) return;
  return zonedDateTimeToUtc({ year, month, day, hour, minute }, timeZone);
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
}: {
  lesson: Lesson;
  studentName: string;
  timezone: string;
  cancellationWindowHours: number;
  busy: boolean;
  onCancel: () => void;
  onSubmit: (startsAt: string, endsAt: string) => Promise<void> | void;
}) {
  const initial = wallParts(lesson.startsAt, timezone);
  const [date, setDate] = useState(initial.date);
  const [time, setTime] = useState(initial.time);
  const durationMinutes = Math.max(
    1,
    Math.round(
      (new Date(lesson.endsAt).getTime() -
        new Date(lesson.startsAt).getTime()) /
        60_000,
    ),
  );
  const nextStart = useMemo(
    () => asUtc(date, time, timezone),
    [date, time, timezone],
  );
  const nextEnd = nextStart
    ? new Date(nextStart.getTime() + durationMinutes * 60_000)
    : undefined;
  const unchanged = nextStart?.getTime() === new Date(lesson.startsAt).getTime();
  const inPast = Boolean(nextStart && nextStart.getTime() <= Date.now());
  const insidePolicy =
    new Date(lesson.startsAt).getTime() - Date.now() <
    cancellationWindowHours * 3_600_000;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!nextStart || !nextEnd || unchanged || inPast || busy) return;
    void onSubmit(nextStart.toISOString(), nextEnd.toISOString());
  };

  return (
    <form className="reschedule-form" onSubmit={submit}>
      <div className="reschedule-current">
        <CalendarClock />
        <div>
          <small>Currently scheduled</small>
          <strong>{display(lesson.startsAt, timezone)}</strong>
          <span>
            {studentName} · {durationMinutes} minutes · {lesson.locationLabel}
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
              onClick={() =>
                setDate(shiftedDate(lesson.startsAt, timezone, Number(days)))
              }
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
            onChange={(event) => setDate(event.target.value)}
          />
        </label>
        <label>
          New time
          <input
            type="time"
            step="900"
            value={time}
            disabled={busy}
            onChange={(event) => setTime(event.target.value)}
          />
        </label>
      </div>

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
      {unchanged && <p className="field-help">Choose a different date or time.</p>}
      {inPast && <p className="form-error">The new lesson time must be in the future.</p>}
      <p className={insidePolicy ? "reschedule-policy warning" : "reschedule-policy"}>
        {insidePolicy
          ? "This lesson is inside the " +
            cancellationWindowHours +
            "-hour change window. Coach changes are allowed, but the student’s late-change policy may apply."
          : "The " +
            cancellationWindowHours +
            "-hour change policy is currently satisfied."}{" "}
        The duration stays the same. Google Calendar and the student invitation
        update automatically after the new time is confirmed.
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
        <button type="submit" disabled={busy || !nextStart || unchanged || inPast}>
          {busy ? "Checking calendar…" : "Confirm new time"}
        </button>
      </div>
    </form>
  );
}
