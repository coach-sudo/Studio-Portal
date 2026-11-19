import { useUrlValue } from "../../hooks/useWorkspaceLocation";
import { RecordUnavailable } from "../../components/RecordRoute";
import { useQueryClient } from "@tanstack/react-query";
import { CalendarDays, Repeat2, ShieldCheck, Video } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import "../../components/IdentityActions.css";
import { readApiClientError } from "../../data/apiClientError";
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
import { selectLessonDelivery } from "../../domain/lessonExperience";
import type { Booking } from "../../domain/model";
import {
  trainingArrangement,
  trainingPaymentLabel,
} from "../../domain/trainingArrangement";
import { lessonPaymentPath } from "../../domain/lessonPaymentLink";
import { portalContextLink } from "../../domain/coachingContext";
import { hasRecurringPackageOffer } from "../../domain/packagePresentation";
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
  showFinance = true,
}: {
  data: Snapshot;
  isDemo: boolean;
  canManageLessons?: boolean;
  showFinance?: boolean;
}) {
  const store = useStudioStore();
  const queryClient = useQueryClient();
  const [notice, setNotice] = useState("");
  const [bookingId, setBookingId] = useUrlValue("booking");
  const studentId = data.students[0]?.id ?? "";
  const arrangement = trainingArrangement(data, studentId);
  const selected = data.bookings.find((b) => b.id === bookingId);
  const setSelected = (booking?: Booking) => setBookingId(booking?.id || "");
  const [mode, setMode] = useState<"manage" | "reschedule">("manage");
  const [nextStart, setNextStart] = useState<string>();
  const [scope, setScope] = useState<"occurrence" | "series">("occurrence");
  const { upcoming, history, coachScheduledCount } = arrangement;
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
    if (isDemo || !service || mode !== "reschedule") return;
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
  }, [demoPortalSlots, isDemo, service, mode]);

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
        if (!response.ok)
          throw await readApiClientError(
            response,
            "The recurring series could not be updated.",
          );
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

  if (bookingId && !selected)
    return <RecordUnavailable fallback="/portal/bookings" />;
  return (
    <div className="student-page">
      <header className="student-header">
        <div>
          <h1>Schedule</h1>
        </div>
        {canManageLessons && (
          <a className="button-link primary" href="/book">
            <CalendarDays />
            Book a lesson
          </a>
        )}
        {showFinance &&
          hasRecurringPackageOffer(
            data.packageDefinitions,
            data.packageBillingOptions,
          ) && (
            <Link
              className="button-link"
              to={portalContextLink(
                "/portal/payments?recurring=packages",
                studentId,
              )}
            >
              Make Recurring
            </Link>
          )}
      </header>
      {notice && (
        <div className="portal-notice" role="status">
          <ShieldCheck />
          {notice}
        </div>
      )}
      <Section title="Upcoming" marked>
        {upcoming.length > 0 && (
          <p>
            {upcoming.length === coachScheduledCount
              ? "Your coach has scheduled "
              : "You have "}
            {upcoming.length} confirmed upcoming{" "}
            {upcoming.length === 1 ? "lesson" : "lessons"}.
            {coachScheduledCount > 0 &&
              coachScheduledCount < upcoming.length &&
              ` Your coach scheduled ${coachScheduledCount} of them.`}
          </p>
        )}
        <div className="student-bookings">
          {upcoming.map(
            ({ lesson, booking, payment, series, seriesNeedsReview }) => {
              const delivery = selectLessonDelivery(lesson);
              const itemService = data.bookingServices.find(
                (item) => item.id === (booking?.serviceId || lesson.serviceId),
              );
              return (
                <article key={lesson.id}>
                  <div className="booking-date">
                    <span>
                      {formatStudioDate(
                        lesson.startsAt,
                        data.settings.timezone,
                        {
                          month: "short",
                          day: undefined,
                          year: undefined,
                        },
                      )}
                    </span>
                    <strong>
                      {formatStudioDate(
                        lesson.startsAt,
                        data.settings.timezone,
                        {
                          day: "numeric",
                          month: undefined,
                          year: undefined,
                        },
                      )}
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
                      {Math.round(
                        (Date.parse(lesson.endsAt) -
                          Date.parse(lesson.startsAt)) /
                          60000,
                      )}{" "}
                      min ·{" "}
                      {lesson.meetingProvider === "google_meet" ||
                      lesson.locationType === "virtual"
                        ? "Google Meet"
                        : "In person"}
                    </small>
                    <span>
                      {series && (
                        <>
                          <Repeat2 aria-hidden="true" />
                          Recurring
                        </>
                      )}
                      {seriesNeedsReview && (
                        <Status tone="warn">Series under review</Status>
                      )}
                      {showFinance && (
                        <Status tone={payment === "paid" ? "good" : "warn"}>
                          {trainingPaymentLabel[payment]}
                        </Status>
                      )}
                    </span>
                  </div>
                  <div className="student-booking-actions">
                    {lesson.offeringId && (
                      <Link
                        className="button-link"
                        to={portalContextLink(
                          `/portal/classes/${lesson.offeringId}`,
                          studentId,
                        )}
                      >
                        Class page
                      </Link>
                    )}
                    <Link
                      className="button-link"
                      to={portalContextLink(
                        `/portal/lessons/${lesson.id}`,
                        studentId,
                      )}
                    >
                      Details
                    </Link>
                    {showFinance &&
                      payment === "unpaid" &&
                      lesson.invoiceId && (
                        <Link
                          className="button-link"
                          to={lessonPaymentPath(studentId, lesson.id)}
                        >
                          Pay for this lesson
                        </Link>
                      )}
                    {(lesson.meetingProvider === "google_meet" ||
                      lesson.locationType === "virtual") &&
                      (delivery.state === "available" && lesson.joinUrl ? (
                        <a
                          className="join-button"
                          href={lesson.joinUrl}
                          target="_blank"
                          rel="noreferrer"
                        >
                          <Video />
                          {delivery.actionLabel}
                        </a>
                      ) : delivery.state === "ready" ? (
                        <span className="open-label">{delivery.label}</span>
                      ) : (
                        <span className="lesson-delivery-status" role="status">
                          <Video />
                          {delivery.label}
                        </span>
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
                            ? "Contact the studio to reschedule inside the notice window."
                            : undefined
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
            },
          )}
          {!upcoming.length && (
            <EmptyState
              title="No bookings yet"
              detail="Book a service when you are ready for the next step."
            />
          )}
        </div>
      </Section>
      {data.recurringSeries.some(
        (series) => series.studentId === studentId,
      ) && (
        <Section title="Recurring plans">
          <div className="series-portal">
            {data.recurringSeries
              .filter((series) => series.studentId === studentId)
              .map((series) => (
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
                      {
                        arrangement.upcoming.filter(
                          (item) => item.series?.id === series.id,
                        ).length
                      }{" "}
                      confirmed upcoming
                    </small>
                  </div>
                  <Status tone={series.status === "active" ? "good" : "warn"}>
                    {series.status.replaceAll("_", " ")}
                  </Status>
                  {series.status === "active" &&
                    series.studentCanModify &&
                    canManageLessons &&
                    data.bookings.some(
                      (booking) =>
                        booking.studentId === studentId &&
                        booking.seriesId === series.id,
                    ) && (
                      <button onClick={() => cancelSeries(series.id)}>
                        End plan
                      </button>
                    )}
                </article>
              ))}
          </div>
        </Section>
      )}
      <Section title="Lesson history">
        <div className="table-list">
          {history.map(({ lesson, payment }) => {
            return (
              <Link
                key={lesson.id}
                className="clickable-row lesson-history-row"
                to={portalContextLink(
                  `/portal/lessons/${lesson.id}`,
                  studentId,
                )}
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
                <span className="form-actions">
                  <Status
                    tone={lesson.status === "completed" ? "good" : "neutral"}
                  >
                    {lesson.status.replaceAll("_", " ")}
                  </Status>
                  {showFinance && (
                    <Status tone={payment === "paid" ? "good" : "warn"}>
                      {trainingPaymentLabel[payment]}
                    </Status>
                  )}
                </span>
                <span className="open-label">Open</span>
              </Link>
            );
          })}
          {!history.length && (
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
                    ? "Late cancellation: the booking policy retains amounts already paid."
                    : "On-time cancellation: payment adjustments follow the booking policy."}
                </p>
              </div>
              <div className="form-actions">
                <button onClick={() => setSelected(undefined)}>
                  Keep booking
                </button>
                {selected.status === "confirmed" && (
                  <button className="primary" onClick={() => change("cancel")}>
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
import "../../styles/booking.css";
