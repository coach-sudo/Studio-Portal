import { CalendarDays, ChevronLeft, ChevronRight, Search } from "lucide-react";
import { useMemo, useState } from "react";
import type { Lesson } from "../domain/model";
import "./LessonCalendar.css";

export type CalendarView = "day" | "week" | "month" | "year";

const dateKey = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
const addDays = (date: Date, days: number) => {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
};
const startOfWeek = (date: Date) => addDays(date, -date.getDay());
const startOfMonthGrid = (date: Date) =>
  startOfWeek(new Date(date.getFullYear(), date.getMonth(), 1));
const sameMonth = (left: Date, right: Date) =>
  left.getMonth() === right.getMonth() &&
  left.getFullYear() === right.getFullYear();

export function LessonCalendar({
  lessons,
  timezone,
  studentName,
  sourceName,
  onOpen,
}: {
  lessons: Lesson[];
  timezone: string;
  studentName: (studentId: string) => string;
  sourceName: (source?: string) => string;
  onOpen: (lesson: Lesson) => void;
}) {
  const [view, setView] = useState<CalendarView>("month");
  const [anchor, setAnchor] = useState(new Date());
  const [query, setQuery] = useState("");
  const [showCancelled, setShowCancelled] = useState(false);
  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return lessons
      .filter(
        (lesson) =>
          showCancelled ||
          !["cancelled", "late_cancelled"].includes(lesson.status),
      )
      .filter(
        (lesson) =>
          !needle ||
          [
            lesson.topic,
            lesson.locationLabel,
            lesson.status,
            sourceName(lesson.sourceProvider),
            studentName(lesson.studentId),
          ]
            .join(" ")
            .toLowerCase()
            .includes(needle),
      )
      .sort((left, right) => left.startsAt.localeCompare(right.startsAt));
  }, [lessons, query, showCancelled, sourceName, studentName]);
  const byDay = useMemo(() => {
    const groups = new Map<string, Lesson[]>();
    for (const lesson of visible) {
      const key = dateKey(new Date(lesson.startsAt));
      groups.set(key, [...(groups.get(key) || []), lesson]);
    }
    return groups;
  }, [visible]);

  const move = (amount: number) => {
    const next = new Date(anchor);
    if (view === "day") next.setDate(next.getDate() + amount);
    if (view === "week") next.setDate(next.getDate() + amount * 7);
    if (view === "month") next.setMonth(next.getMonth() + amount);
    if (view === "year") next.setFullYear(next.getFullYear() + amount);
    setAnchor(next);
  };
  const title =
    view === "day"
      ? anchor.toLocaleDateString(undefined, {
          weekday: "long",
          month: "long",
          day: "numeric",
          year: "numeric",
        })
      : view === "week"
        ? `${startOfWeek(anchor).toLocaleDateString(undefined, { month: "short", day: "numeric" })} – ${addDays(startOfWeek(anchor), 6).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}`
        : view === "month"
          ? anchor.toLocaleDateString(undefined, {
              month: "long",
              year: "numeric",
            })
          : String(anchor.getFullYear());
  const formatTime = (lesson: Lesson) =>
    new Date(lesson.startsAt).toLocaleTimeString(undefined, {
      hour: "numeric",
      minute: "2-digit",
      timeZone: timezone,
    });
  const eventButton = (lesson: Lesson) => (
    <button
      key={lesson.id}
      type="button"
      className={`calendar-event ${lesson.status}`}
      onClick={() => onOpen(lesson)}
    >
      <time>{formatTime(lesson)}</time>
      <strong>{studentName(lesson.studentId)}</strong>
      <span>{lesson.topic}</span>
    </button>
  );
  const dayCell = (day: Date, muted = false) => {
    const events = byDay.get(dateKey(day)) || [];
    return (
      <section
        key={dateKey(day)}
        className={`calendar-day ${muted ? "muted" : ""} ${dateKey(day) === dateKey(new Date()) ? "today" : ""}`}
      >
        <button
          type="button"
          className="calendar-date"
          onClick={() => {
            setAnchor(day);
            setView("day");
          }}
          aria-label={`Open ${day.toLocaleDateString()}`}
        >
          {day.getDate()}
        </button>
        <div className="calendar-events">
          {events.slice(0, 4).map(eventButton)}
          {events.length > 4 && (
            <button
              type="button"
              className="calendar-more"
              onClick={() => {
                setAnchor(day);
                setView("day");
              }}
            >
              +{events.length - 4} more
            </button>
          )}
        </div>
      </section>
    );
  };

  return (
    <div className="lesson-calendar">
      <div className="calendar-toolbar">
        <label className="calendar-search">
          <Search />
          <input
            aria-label="Search lessons"
            placeholder="Search lessons, students, source…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <label className="calendar-cancelled">
          <input
            type="checkbox"
            checked={showCancelled}
            onChange={(event) => setShowCancelled(event.target.checked)}
          />{" "}
          Show cancelled
        </label>
        <div className="calendar-view-switcher" aria-label="Calendar view">
          {(["day", "week", "month", "year"] as CalendarView[]).map((item) => (
            <button
              type="button"
              key={item}
              className={view === item ? "selected" : ""}
              onClick={() => setView(item)}
            >
              {item}
            </button>
          ))}
        </div>
      </div>
      {query && (
        <div className="calendar-search-results">
          <strong>
            {visible.length} matching lesson{visible.length === 1 ? "" : "s"}
          </strong>
          {visible.slice(0, 8).map((lesson) => (
            <button
              type="button"
              key={lesson.id}
              onClick={() => {
                setAnchor(new Date(lesson.startsAt));
                onOpen(lesson);
              }}
            >
              <CalendarDays />
              <span>
                {studentName(lesson.studentId)} · {lesson.topic}
                <small>
                  {new Date(lesson.startsAt).toLocaleString()} ·{" "}
                  {sourceName(lesson.sourceProvider)}
                </small>
              </span>
            </button>
          ))}
        </div>
      )}
      <div className="calendar-navigation">
        <div>
          <button
            type="button"
            aria-label={`Previous ${view}`}
            onClick={() => move(-1)}
          >
            <ChevronLeft />
          </button>
          <button type="button" onClick={() => setAnchor(new Date())}>
            Today
          </button>
          <button
            type="button"
            aria-label={`Next ${view}`}
            onClick={() => move(1)}
          >
            <ChevronRight />
          </button>
        </div>
        <h3>{title}</h3>
        <span>{visible.length} lessons</span>
      </div>
      {view === "month" && (
        <>
          <div className="calendar-weekdays">
            {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => (
              <span key={day}>{day}</span>
            ))}
          </div>
          <div className="calendar-month-grid">
            {Array.from({ length: 42 }, (_, index) => {
              const day = addDays(startOfMonthGrid(anchor), index);
              return dayCell(day, !sameMonth(day, anchor));
            })}
          </div>
        </>
      )}
      {view === "week" && (
        <>
          <div className="calendar-weekdays">
            {Array.from({ length: 7 }, (_, index) =>
              addDays(startOfWeek(anchor), index),
            ).map((day) => (
              <span key={dateKey(day)}>
                {day.toLocaleDateString(undefined, {
                  weekday: "short",
                  month: "short",
                  day: "numeric",
                })}
              </span>
            ))}
          </div>
          <div className="calendar-week-grid">
            {Array.from({ length: 7 }, (_, index) =>
              dayCell(addDays(startOfWeek(anchor), index)),
            )}
          </div>
        </>
      )}
      {view === "day" && (
        <div className="calendar-agenda">
          {(byDay.get(dateKey(anchor)) || []).map(eventButton)}
          {!(byDay.get(dateKey(anchor)) || []).length && (
            <p>No lessons on this day.</p>
          )}
        </div>
      )}
      {view === "year" && (
        <div className="calendar-year-grid">
          {Array.from({ length: 12 }, (_, month) => {
            const date = new Date(anchor.getFullYear(), month, 1);
            const events = visible.filter((lesson) => {
              const when = new Date(lesson.startsAt);
              return (
                when.getFullYear() === date.getFullYear() &&
                when.getMonth() === month
              );
            });
            return (
              <button
                type="button"
                key={month}
                onClick={() => {
                  setAnchor(date);
                  setView("month");
                }}
              >
                <strong>
                  {date.toLocaleDateString(undefined, { month: "long" })}
                </strong>
                <span>
                  {events.length} lesson{events.length === 1 ? "" : "s"}
                </span>
                <i>
                  {events.slice(0, 18).map((event) => (
                    <b key={event.id} className={event.status} />
                  ))}
                </i>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
