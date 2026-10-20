import { useRef, useState } from "react";
import type { Lesson } from "../domain/model";
import {
  calendarSlot,
  moveCalendarLesson,
  resizeCalendarLesson,
  type CalendarProposal,
} from "../domain/calendarProposals";
import {
  calendarDateKey,
  formatCalendarDateKey,
  formatStudioTime,
  studioDateKey,
} from "../domain/presentation";
import "./InteractiveCalendarGrid.css";
const firstHour = 0,
  lastHour = 24,
  slotHeight = 24;
export function InteractiveCalendarGrid({
  days,
  lessons,
  timezone,
  studentName,
  onOpen,
  onPropose,
}: {
  days: Date[];
  lessons: Lesson[];
  timezone: string;
  studentName: (id: string) => string;
  onOpen: (lesson: Lesson) => void;
  onPropose: (proposal: CalendarProposal) => void;
}) {
  const [error, setError] = useState(""),
    resizing = useRef<{ lesson: Lesson; y: number } | undefined>(undefined);
  const propose = (fn: () => CalendarProposal) => {
    try {
      setError("");
      onPropose(fn());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Time unavailable");
    }
  };
  const minute = (instant: string) => {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(new Date(instant));
    return (
      Number(parts.find((x) => x.type === "hour")?.value) * 60 +
      Number(parts.find((x) => x.type === "minute")?.value)
    );
  };
  return (
    <>
      {error && <p role="alert">{error}</p>}
      <p className="calendar-grid-help">
        {timezone} · Drag to propose a move; use an event’s resize handle to
        propose a new duration. Open an event for keyboard and mobile editing.
      </p>
      <div className="time-calendar-scroll">
        <div
          className="time-calendar"
          style={{
            gridTemplateColumns: `56px repeat(${days.length},minmax(140px,1fr))`,
          }}
        >
          <div className="time-calendar-axis" aria-hidden="true">
            {Array.from({ length: lastHour - firstHour }, (_, i) => (
              <span key={i} style={{ top: i * 4 * slotHeight }}>
                {String(firstHour + i).padStart(2, "0")}:00
              </span>
            ))}
          </div>
          {days.map((day) => {
            const date = calendarDateKey(day),
              events = lessons.filter(
                (l) =>
                  studioDateKey(l.startsAt, timezone) === date &&
                  !["cancelled", "late_cancelled"].includes(l.status),
              );
            return (
              <section
                key={date}
                className="time-calendar-day"
                aria-label={formatCalendarDateKey(date, {
                  weekday: "long",
                  month: "short",
                  day: "numeric",
                })}
              >
                <header>
                  {formatCalendarDateKey(date, {
                    weekday: "short",
                    day: "numeric",
                  })}
                </header>
                <div
                  className="time-calendar-track"
                  style={{ height: (lastHour - firstHour) * 4 * slotHeight }}
                >
                  {Array.from(
                    { length: (lastHour - firstHour) * 4 },
                    (_, i) => {
                      const minutes = firstHour * 60 + i * 15;
                      return (
                        <button
                          key={i}
                          className="time-calendar-slot"
                          tabIndex={i === 0 ? 0 : -1}
                          aria-label={`Create lesson ${date} ${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")} ${timezone}`}
                          style={{ top: i * slotHeight, height: slotHeight }}
                          onKeyDown={(e) => {
                            if (["ArrowDown", "ArrowUp"].includes(e.key)) {
                              e.preventDefault();
                              const target =
                                e.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>(
                                  ".time-calendar-slot",
                                )[
                                  Math.min(
                                    (lastHour - firstHour) * 4 - 1,
                                    Math.max(
                                      0,
                                      i + (e.key === "ArrowDown" ? 1 : -1),
                                    ),
                                  )
                                ];
                              target?.focus();
                            }
                          }}
                          onClick={() =>
                            propose(() => {
                              const startsAt = calendarSlot(
                                date,
                                minutes,
                                timezone,
                              );
                              return {
                                kind: "create",
                                startsAt,
                                endsAt: new Date(
                                  Date.parse(startsAt) + 3600000,
                                ).toISOString(),
                              };
                            })
                          }
                          onDragOver={(e) => {
                            if (
                              e.dataTransfer.types.includes(
                                "application/x-studio-lesson",
                              )
                            )
                              e.preventDefault();
                          }}
                          onDrop={(e) => {
                            e.preventDefault();
                            const id = e.dataTransfer.getData(
                                "application/x-studio-lesson",
                              ),
                              lesson = lessons.find((l) => l.id === id);
                            if (lesson?.status === "scheduled")
                              propose(() =>
                                moveCalendarLesson(
                                  lesson,
                                  date,
                                  minutes,
                                  timezone,
                                ),
                              );
                          }}
                        />
                      );
                    },
                  )}
                  {events.map((lesson) => {
                    const start = minute(lesson.startsAt),
                      duration =
                        (Date.parse(lesson.endsAt) -
                          Date.parse(lesson.startsAt)) /
                        60000;
                    return (
                      <article
                        key={lesson.id}
                        className={`time-calendar-event ${lesson.status}`}
                        style={{
                          top: Math.max(
                            0,
                            ((start - firstHour * 60) / 15) * slotHeight,
                          ),
                          minHeight: 48,
                          height: Math.max(48, (duration / 15) * slotHeight),
                        }}
                        draggable={lesson.status === "scheduled"}
                        onDragStart={(e) => {
                          e.dataTransfer.effectAllowed = "move";
                          e.dataTransfer.setData(
                            "application/x-studio-lesson",
                            lesson.id,
                          );
                        }}
                      >
                        <button
                          className="time-calendar-open"
                          onClick={() => onOpen(lesson)}
                        >
                          <time>
                            {formatStudioTime(lesson.startsAt, timezone)}
                          </time>
                          <strong>{studentName(lesson.studentId)}</strong>
                          <span>{lesson.topic}</span>
                        </button>
                        {lesson.status === "scheduled" && (
                          <button
                            className="time-calendar-resize"
                            aria-label={`Resize ${lesson.topic}`}
                            onPointerDown={(e) => {
                              e.preventDefault();
                              resizing.current = { lesson, y: e.clientY };
                              e.currentTarget.setPointerCapture(e.pointerId);
                            }}
                            onPointerUp={(e) => {
                              const original = resizing.current;
                              resizing.current = undefined;
                              if (
                                original &&
                                Math.abs(e.clientY - original.y) > 5
                              )
                                propose(() =>
                                  resizeCalendarLesson(
                                    original.lesson,
                                    ((e.clientY - original.y) / slotHeight) *
                                      15,
                                  ),
                                );
                            }}
                            onKeyDown={(e) => {
                              if (
                                e.key === "ArrowDown" ||
                                e.key === "ArrowUp"
                              ) {
                                e.preventDefault();
                                propose(() =>
                                  resizeCalendarLesson(
                                    lesson,
                                    e.key === "ArrowDown" ? 15 : -15,
                                  ),
                                );
                              }
                            }}
                          >
                            ⋯
                          </button>
                        )}
                      </article>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>
      </div>
    </>
  );
}
