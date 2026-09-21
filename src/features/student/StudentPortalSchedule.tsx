import { useQueryClient } from "@tanstack/react-query";
import { CalendarDays, Repeat2, ShieldCheck, Video } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import "../../components/IdentityActions.css";
import {
  Dialog,
  EmptyState,
  Section,
  Status,
} from "../../components/Primitives";
import { portalBookingCommand } from "../../data/bookingCommands";
import {
  buildAvailability,
  cancelDemoBooking,
  isLateChange,
} from "../../domain/booking";
import { isJoinableLesson, splitLessons } from "../../domain/lessonExperience";
import type { Booking } from "../../domain/model";
import {
  formatStudioDate,
  formatStudioDateTime,
  formatStudioTime,
} from "../../domain/presentation";
import { invalidateStudioDomains } from "../../hooks/useStudio";
import { useStudioStore } from "../../state/StudioStore";

import { type Snapshot } from "./StudentPortal.shared";

export function StudentBookings({
  data,
  isDemo,
  canManageLessons = true,
}: {
  data: Snapshot;
  isDemo: boolean;
  canManageLessons?: boolean;
}) {
  const navigate = useNavigate();
  const store = useStudioStore();
  const queryClient = useQueryClient();
  const [notice, setNotice] = useState("");
  const [selected, setSelected] = useState<Booking>();
  const [mode, setMode] = useState<"manage" | "reschedule">("manage");
  const [nextStart, setNextStart] = useState<string>();
  const [scope, setScope] = useState<"occurrence" | "series">("occurrence");
  const { active: upcomingLessons, history: lessonHistory } = splitLessons(
    data.lessons,
  );
  const service = selected
    ? data.bookingServices.find((item) => item.id === selected.serviceId)
    : undefined;
  const demoPortalSlots = useMemo(
    () =>
      service && selected
        ? buildAvailability({
            service,
            rules: data.availabilityRules,
            exceptions: data.availabilityExceptions,
            lessons: data.lessons.filter(
              (lesson) =>
                !data.lessonParticipants.some(
                  (part) =>
                    part.bookingId === selected.id &&
                    part.lessonId === lesson.id,
                ),
            ),
            visibleSlotsPercent:
              data.settings.bookingDefaults.visibleSlotsPercent,
            from: new Date(),
            days: 21,
          }).slice(0, 8)
        : [],
    [data, selected, service],
  );
  const [slots, setSlots] = useState(demoPortalSlots);
  useEffect(() => {
    setSlots(demoPortalSlots);
    if (isDemo || !service) return;
    fetch(
      `/api/v2/public/booking/availability?serviceId=${encodeURIComponent(service.id)}`,
    )
      .then((response) => (response.ok ? response.json() : Promise.reject()))
      .then((payload: { slots: { startsAt: string; endsAt: string }[] }) =>
        setSlots(
          payload.slots.slice(0, 8).map((item) => ({
            ...item,
            label: formatStudioTime(item.startsAt, data.settings.timezone),
          })),
        ),
      )
      .catch(() =>
        setNotice(
          "Live alternatives are unavailable. Your current booking is unchanged.",
        ),
      );
  }, [demoPortalSlots, isDemo, service]);

  async function change(command: "cancel" | "reschedule") {
    if (!selected) return;
    setNotice("");
    try {
      if (isDemo) {
        store.transact((draft) => {
          const booking = draft.bookings.find(
            (item) => item.id === selected.id,
          )!;
          if (command === "cancel") {
            const late = isLateChange(
              booking.startsAt,
              booking.policySnapshot.cancellationWindowHours,
            );
            cancelDemoBooking(draft, booking, { late });
          } else {
            const slot = slots.find((item) => item.startsAt === nextStart);
            if (
              !slot ||
              booking.rescheduleCount >= booking.policySnapshot.rescheduleLimit
            )
              throw new Error("No self-service reschedule is available.");
            const shift =
              new Date(slot.startsAt).getTime() -
              new Date(booking.startsAt).getTime();
            const participantIds = draft.lessonParticipants
              .filter((part) => part.bookingId === booking.id)
              .map((part) => part.lessonId);
            const lessons = draft.lessons
              .filter((lesson) => participantIds.includes(lesson.id))
              .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
            (scope === "series" ? lessons : lessons.slice(0, 1)).forEach(
              (lesson) => {
                lesson.startsAt = new Date(
                  new Date(lesson.startsAt).getTime() + shift,
                ).toISOString();
                lesson.endsAt = new Date(
                  new Date(lesson.endsAt).getTime() + shift,
                ).toISOString();
                lesson.version += 1;
              },
            );
            booking.startsAt = slot.startsAt;
            booking.endsAt = slot.endsAt;
            booking.rescheduleCount += 1;
          }
          if (command !== "cancel") {
            booking.version += 1;
            booking.updatedAt = new Date().toISOString();
          }
        });
      } else {
        const slot = slots.find((item) => item.startsAt === nextStart);
        await portalBookingCommand(
          selected.id,
          command,
          command === "reschedule" && slot
            ? { startsAt: slot.startsAt, endsAt: slot.endsAt, scope }
            : {},
        );
        void invalidateStudioDomains(queryClient, ["booking", "lessons"]);
      }
      setSelected(undefined);
      setNextStart(undefined);
      setNotice(
        command === "cancel"
          ? "Booking cancelled and the policy settlement has been applied."
          : `${scope === "series" ? "Series" : "Occurrence"} rescheduled.`,
      );
    } catch (reason) {
      setNotice(
        reason instanceof Error
          ? reason.message
          : "The change could not be completed.",
      );
    }
  }

  async function cancelSeries(seriesId: string) {
    const booking = data.bookings.find((item) => item.seriesId === seriesId);
    if (!booking) return;
    try {
      if (isDemo)
        store.transact((draft) => {
          const series = draft.recurringSeries.find(
            (item) => item.id === seriesId,
          )!;
          series.status = "cancel_at_period_end";
          series.version += 1;
        });
      else {
        const response = await fetch("/api/v2/portal/bookings/cancel-series", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${(await (await import("../../lib/supabase")).supabase?.auth.getSession())?.data.session?.access_token ?? ""}`,
          },
          body: JSON.stringify({ bookingId: booking.id }),
        });
        if (!response.ok) throw new Error((await response.json()).message);
        void invalidateStudioDomains(queryClient, ["booking", "finance"]);
      }
      setNotice("The series will end after the current paid period.");
    } catch (reason) {
      setNotice(
        reason instanceof Error
          ? reason.message
          : "The series could not be changed.",
      );
    }
  }

  return (
    <div className="student-page">
      <header className="student-header">
        <div>
          <h1>Schedule</h1>
          <p>
            Every lesson in one place, including studio bookings and imported
            provider appointments.
          </p>
        </div>
        <a className="button-link primary" href="/book">
          <CalendarDays />
          Book a lesson
        </a>
      </header>
      {notice && (
        <div className="portal-notice" role="status">
          <ShieldCheck />
          {notice}
        </div>
      )}
      <Section title="Upcoming" marked>
        <div className="student-bookings">
          {upcomingLessons.map((lesson) => {
            const participant = data.lessonParticipants.find(
              (part) => part.lessonId === lesson.id && part.bookingId,
            );
            const booking = data.bookings.find(
              (item) => item.id === participant?.bookingId,
            );
            const itemService = data.bookingServices.find(
              (item) => item.id === (booking?.serviceId || lesson.serviceId),
            );
            return (
              <article key={lesson.id}>
                <div className="booking-date">
                  <span>
                    {formatStudioDate(lesson.startsAt, data.settings.timezone, {
                      month: "short",
                    })}
                  </span>
                  <strong>
                    {formatStudioDate(lesson.startsAt, data.settings.timezone, {
                      day: "numeric",
                      month: undefined,
                      year: undefined,
                    })}
                  </strong>
                </div>
                <div>
                  <strong>{itemService?.name || lesson.topic}</strong>
                  <small>
                    {formatStudioDateTime(
                      lesson.startsAt,
                      data.settings.timezone,
                      {
                        weekday: "long",
                        month: undefined,
                        day: undefined,
                        year: undefined,
                      },
                    )}{" "}
                    ·{" "}
                    {lesson.meetingProvider === "google_meet" ||
                    lesson.locationType === "virtual"
                      ? "Google Meet"
                      : "In person"}
                  </small>
                  <span>
                    {lesson.seriesId && (
                      <>
                        <Repeat2 />
                        Recurring
                      </>
                    )}
                    {booking ? (
                      <Status
                        tone={
                          booking.paymentStatus === "paid" ? "good" : "warn"
                        }
                      >
                        {booking.paymentStatus.replaceAll("_", " ")}
                      </Status>
                    ) : (
                      <Status tone="neutral">
                        {(lesson.sourceProvider || "studio").replaceAll(
                          "_",
                          " ",
                        )}
                      </Status>
                    )}
                  </span>
                </div>
                <div className="student-booking-actions">
                  {lesson.offeringId && (
                    <Link
                      className="button-link"
                      to={`/portal/classes/${lesson.offeringId}`}
                    >
                      Class page
                    </Link>
                  )}
                  <Link
                    className="button-link"
                    to={`/portal/lessons/${lesson.id}`}
                  >
                    Details
                  </Link>
                  {(lesson.meetingProvider === "google_meet" ||
                    lesson.locationType === "virtual") &&
                    (isJoinableLesson(lesson) && lesson.joinUrl ? (
                      <a
                        className="join-button"
                        href={lesson.joinUrl}
                        target="_blank"
                        rel="noreferrer"
                      >
                        <Video />
                        Join
                      </a>
                    ) : lesson.joinUrl ? (
                      <span className="open-label">Meet link ready</span>
                    ) : (
                      <button
                        disabled
                        title="Meet link is created with the calendar invitation"
                      >
                        <Video />
                        Meet pending
                      </button>
                    ))}
                  {canManageLessons && booking?.status === "confirmed" && (
                    <button
                      disabled={isLateChange(
                        booking.startsAt,
                        booking.policySnapshot.cancellationWindowHours,
                      )}
                      title={
                        isLateChange(
                          booking.startsAt,
                          booking.policySnapshot.cancellationWindowHours,
                        )
                          ? `Online changes close ${booking.policySnapshot.cancellationWindowHours} hours before the lesson`
                          : "Choose another available time"
                      }
                      onClick={() => {
                        setSelected(booking);
                        setMode("reschedule");
                      }}
                    >
                      Reschedule
                    </button>
                  )}
                  {canManageLessons && booking && (
                    <button
                      onClick={() => {
                        setSelected(booking);
                        setMode("manage");
                      }}
                    >
                      Manage
                    </button>
                  )}
                </div>
              </article>
            );
          })}
          {!upcomingLessons.length && (
            <EmptyState
              title="No bookings yet"
              detail="Book a service when you are ready for the next step."
            />
          )}
        </div>
      </Section>
      <Section title="Recurring plans">
        <div className="series-portal">
          {data.recurringSeries.map((series) => (
            <article key={series.id}>
              <Repeat2 />
              <div>
                <strong>
                  {
                    data.bookingServices.find(
                      (item) => item.id === series.serviceId,
                    )?.name
                  }
                </strong>
                <small>
                  {series.cadence} ·{" "}
                  {series.kind === "ongoing"
                    ? "rolling 12-week schedule"
                    : `${series.occurrenceCount ?? 0} occurrences`}
                </small>
              </div>
              <Status tone={series.status === "active" ? "good" : "warn"}>
                {series.status.replaceAll("_", " ")}
              </Status>
              {series.status === "active" && canManageLessons && (
                <button onClick={() => cancelSeries(series.id)}>
                  End plan
                </button>
              )}
            </article>
          ))}
        </div>
      </Section>
      <Section title="Lesson history">
        <div className="table-list">
          {lessonHistory.map((lesson) => (
            <article
              key={lesson.id}
              className="clickable-row"
              onClick={() => navigate(`/portal/lessons/${lesson.id}`)}
            >
              <CalendarDays />
              <div>
                <strong>{lesson.topic}</strong>
                <small>
                  {formatStudioDateTime(
                    lesson.startsAt,
                    data.settings.timezone,
                  )}{" "}
                  · {lesson.locationLabel}
                </small>
              </div>
              <Status tone={lesson.status === "completed" ? "good" : "neutral"}>
                {lesson.status.replaceAll("_", " ")}
              </Status>
              <span className="open-label">Open</span>
            </article>
          ))}
          {!lessonHistory.length && (
            <EmptyState
              title="No lesson history yet"
              detail="Completed lessons will remain here with their published notes and materials."
            />
          )}
        </div>
      </Section>
      {selected && (
        <Dialog
          title={
            mode === "reschedule" ? "Reschedule booking" : selected.reference
          }
          description={`${service?.name ?? "Booking"} · ${formatStudioDateTime(selected.startsAt, data.settings.timezone)}`}
          onClose={() => setSelected(undefined)}
        >
          {mode === "reschedule" ? (
            <div className="workflow-content">
              <div className="slot-list">
                {slots.map((slot) => (
                  <button
                    key={slot.startsAt}
                    className={nextStart === slot.startsAt ? "selected" : ""}
                    onClick={() => setNextStart(slot.startsAt)}
                  >
                    <span>
                      {formatStudioDate(slot.startsAt, data.settings.timezone, {
                        month: "short",
                        day: "numeric",
                        year: undefined,
                      })}
                    </span>
                    <strong>{slot.label}</strong>
                  </button>
                ))}
              </div>
              {selected.seriesId && (
                <label className="check-row">
                  <input
                    type="checkbox"
                    checked={scope === "series"}
                    onChange={(event) =>
                      setScope(event.target.checked ? "series" : "occurrence")
                    }
                  />
                  <span>
                    <strong>Move the entire remaining series</strong>
                    <small>
                      Leave unchecked to change only the next occurrence.
                    </small>
                  </span>
                </label>
              )}
              <div className="form-actions">
                <button onClick={() => setSelected(undefined)}>
                  Keep current
                </button>
                <button
                  className="primary"
                  disabled={!nextStart}
                  onClick={() => change("reschedule")}
                >
                  Confirm new time
                </button>
              </div>
            </div>
          ) : (
            <div className="workflow-content">
              <div className="policy-box">
                <strong>Accepted policy</strong>
                <p>
                  {selected.policySnapshot.cancellationWindowHours}-hour notice.{" "}
                  {isLateChange(
                    selected.startsAt,
                    selected.policySnapshot.cancellationWindowHours,
                  )
                    ? `Online cancellation and rescheduling closed ${selected.policySnapshot.cancellationWindowHours} hours before this lesson. Contact the studio if you need help.`
                    : `Eligible settlement: ${selected.policySnapshot.settlement.replaceAll("_", " ")}.`}
                </p>
              </div>
              <div className="form-actions">
                <button onClick={() => setSelected(undefined)}>
                  Keep booking
                </button>
                {selected.status === "confirmed" &&
                  !isLateChange(
                    selected.startsAt,
                    selected.policySnapshot.cancellationWindowHours,
                  ) && (
                    <button
                      className="primary"
                      onClick={() => change("cancel")}
                    >
                      Cancel booking
                    </button>
                  )}
              </div>
            </div>
          )}
        </Dialog>
      )}
    </div>
  );
}
