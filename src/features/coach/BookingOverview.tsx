import { CheckCircle2, MoreHorizontal, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import { Dialog, EmptyState, Status } from "../../components/Primitives";
import {
  checkSchedulingConflicts,
  type PlatformHealth,
} from "../../data/bookingCommands";
import { remainingCapacity } from "../../domain/booking";
import { formatMoney } from "../../domain/finance";
import type {
  Booking,
  MeetingProvider,
  StudioSnapshot,
} from "../../domain/model";
import {
  formatStudioDateTime,
  formatStudioTime,
} from "../../domain/presentation";

import { bookingTone, serviceName } from "./BookingCenter.shared";
import { CoachPanel } from "./BookingPanel";

function Metric({
  label,
  value,
  detail,
  tone,
}: {
  label: string;
  value: string;
  detail: string;
  tone?: string;
}) {
  return (
    <article className={`booking-metric ${tone ?? ""}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </article>
  );
}
export function Overview({
  data,
  health,
  onViewAll,
  onBooking,
}: {
  data: StudioSnapshot;
  health: PlatformHealth;
  onViewAll: () => void;
  onBooking: (item: Booking) => void;
}) {
  const confirmed = data.bookings.filter((item) => item.status === "confirmed");
  const revenue = data.bookings.reduce((sum, item) => sum + item.paidMinor, 0);
  const seats = data.serviceOfferings.reduce(
    (sum, item) => sum + remainingCapacity(item.capacity, item.enrolled),
    0,
  );
  const readyCount = [
    health.supabase,
    health.stripe,
    health.googleCalendar,
    health.gmail,
  ].filter(Boolean).length;
  const recentBookings = [...data.bookings]
    .filter(
      (item) =>
        !["expired", "cancelled", "late_cancelled"].includes(item.status),
    )
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, 3);
  const integrationsReady = readyCount === 4;
  return (
    <>
      <section className="metric-grid">
        <Metric
          label="Upcoming"
          value={String(confirmed.length)}
          detail="confirmed bookings"
        />
        <Metric
          label="Booked revenue"
          value={formatMoney(revenue, "USD")}
          detail="across current bookings"
          tone="gold"
        />
        <Metric
          label="Class seats"
          value={String(seats)}
          detail="remaining across offerings"
        />
        {!integrationsReady && (
          <Metric
            label="Integration health"
            value={`${readyCount}/4`}
            detail={
              health.mode === "live" ? "services ready" : "demo configuration"
            }
            tone="gold"
          />
        )}
      </section>
      <CoachPanel
        title="Recent bookings"
        aside={<button onClick={onViewAll}>View calendar</button>}
      >
        <div className="booking-table">
          <div className="booking-table-head">
            <span>Student</span>
            <span>Service</span>
            <span>When</span>
            <span>Payment</span>
            <span>Status</span>
            <span />
          </div>
          {recentBookings.map((booking) => (
            <BookingRow
              key={booking.id}
              booking={booking}
              data={data}
              onOpen={() => onBooking(booking)}
            />
          ))}
          {!recentBookings.length && (
            <EmptyState
              title="No active bookings yet"
              detail="Confirmed and in-progress bookings will appear here."
            />
          )}
        </div>
      </CoachPanel>
      <div className={`coach-two-column${integrationsReady ? " single" : ""}`}>
        <CoachPanel title="Needs attention">
          <div className="attention-card">
            <RefreshCw />
            <div>
              <strong>
                {data.bookings.some((item) => item.status === "needs_attention")
                  ? "A booking needs attention"
                  : "No booking failures are open"}
              </strong>
              <small>
                Failed projections, expiring holds, and delinquent subscriptions
                appear here.
              </small>
            </div>
            <Status
              tone={
                data.bookings.some((item) => item.status === "needs_attention")
                  ? "warn"
                  : "good"
              }
            >
              {data.bookings.some((item) => item.status === "needs_attention")
                ? "review"
                : "clear"}
            </Status>
          </div>
        </CoachPanel>
        {!integrationsReady && (
          <CoachPanel title="Integration setup">
            <div className="setup-list">
              <HealthLine ready={health.supabase}>Supabase database</HealthLine>
              <HealthLine ready={health.googleCalendar}>
                Google Calendar &amp; Meet
              </HealthLine>
              <HealthLine ready={health.stripe}>Stripe payments</HealthLine>
              <HealthLine ready={health.gmail}>Gmail delivery</HealthLine>
            </div>
          </CoachPanel>
        )}
      </div>
    </>
  );
}
function HealthLine({
  ready,
  children,
}: {
  ready: boolean;
  children: React.ReactNode;
}) {
  return (
    <span>
      {ready ? <CheckCircle2 /> : <RefreshCw />}
      {children}
    </span>
  );
}
function BookingRow({
  booking,
  data,
  onOpen,
}: {
  booking: Booking;
  data: StudioSnapshot;
  onOpen: () => void;
}) {
  return (
    <article className="booking-table-row">
      <div>
        <span className="avatar tiny">
          {booking.guestName
            .split(" ")
            .map((part) => part[0])
            .slice(0, 2)
            .join("")}
        </span>
        <strong>{booking.guestName}</strong>
      </div>
      <span>{serviceName(data, booking.serviceId)}</span>
      <span>
        {formatStudioDateTime(booking.startsAt, data.settings.timezone, {
          month: "short",
          day: "numeric",
          hour: "numeric",
          minute: "2-digit",
        })}
      </span>
      <span>{booking.paymentStatus.replaceAll("_", " ")}</span>
      <Status tone={bookingTone(booking.status)}>
        {booking.status.replaceAll("_", " ")}
      </Status>
      <button aria-label={`Open ${booking.reference}`} onClick={onOpen}>
        <MoreHorizontal />
      </button>
    </article>
  );
}

export function ManualBookingDialog({
  data,
  isDemo,
  onClose,
  onSave,
}: {
  data: StudioSnapshot;
  isDemo: boolean;
  onClose: () => void;
  onSave: (payload: Record<string, unknown>) => Promise<void> | void;
}) {
  const [studentId, setStudentId] = useState(data.students[0]?.id ?? ""),
    [serviceId, setServiceId] = useState(data.bookingServices[0]?.id ?? ""),
    [startsAt, setStartsAt] = useState(
      new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 16),
    ),
    [location, setLocation] = useState<MeetingProvider>(
      data.bookingServices[0]?.defaultLocation ?? "google_meet",
    ),
    [locationLabel, setLocationLabel] = useState(
      data.settings.meetingFormats.in_person?.location ?? "",
    ),
    [customPrice, setCustomPrice] = useState(""),
    [markPaid, setMarkPaid] = useState(false),
    [reason, setReason] = useState("Coach-created booking"),
    [dateError, setDateError] = useState(""),
    [conflicts, setConflicts] = useState<
      Array<{ id: string; summary: string; start: string; end: string }>
    >([]),
    [approvedTime, setApprovedTime] = useState(""),
    [checking, setChecking] = useState(false);
  const service = data.bookingServices.find((item) => item.id === serviceId);
  useEffect(() => {
    if (service && !service.locationOptions.includes(location))
      setLocation(service.defaultLocation);
  }, [location, service]);
  return (
    <Dialog
      title="Create a booking"
      description="Coach bookings may override public notice and price rules. The action is audited and still creates calendar and email work."
      onClose={onClose}
    >
      <form
        className="workflow-form"
        onSubmit={async (event) => {
          event.preventDefault();
          const parsedStart = new Date(startsAt);
          if (!startsAt || Number.isNaN(parsedStart.getTime())) {
            setDateError(
              "Choose a valid date and time before creating the booking.",
            );
            return;
          }
          setDateError("");
          const endsAt = new Date(
            parsedStart.getTime() +
              Number(service?.durationMinutes || 60) * 60_000,
          );
          const timeKey = `${parsedStart.toISOString()}|${endsAt.toISOString()}`;
          if (approvedTime !== timeKey) {
            setChecking(true);
            try {
              const found = isDemo
                ? data.lessons
                    .filter(
                      (lesson) =>
                        lesson.status === "scheduled" &&
                        new Date(lesson.startsAt) < endsAt &&
                        new Date(lesson.endsAt) > parsedStart,
                    )
                    .map((lesson) => ({
                      id: lesson.id,
                      summary: lesson.topic,
                      start: lesson.startsAt,
                      end: lesson.endsAt,
                    }))
                : await checkSchedulingConflicts(
                    parsedStart.toISOString(),
                    endsAt.toISOString(),
                  );
              setConflicts(found);
              if (found.length) {
                setApprovedTime(timeKey);
                return;
              }
            } catch (reason) {
              setDateError(
                reason instanceof Error
                  ? reason.message
                  : "Calendar could not be checked. Nothing was scheduled.",
              );
              return;
            } finally {
              setChecking(false);
            }
          }
          await onSave({
            student_id: studentId,
            service_id: serviceId,
            starts_at: parsedStart.toISOString(),
            location,
            location_label: locationLabel,
            price_minor:
              customPrice === "" ? null : Math.round(Number(customPrice) * 100),
            mark_paid: markPaid,
            reason,
            allow_conflict: approvedTime === timeKey,
          });
        }}
      >
        {!data.students.length && (
          <p className="inline-error full">
            Add a student to the roster before creating a coach booking.
          </p>
        )}
        <label>
          Student
          <select
            required
            value={studentId}
            onChange={(event) => setStudentId(event.target.value)}
          >
            <option value="" disabled>
              Choose student
            </option>
            {data.students.map((student) => (
              <option key={student.id} value={student.id}>
                {student.fullName}
              </option>
            ))}
          </select>
        </label>
        <label>
          Service
          <select
            required
            value={serviceId}
            onChange={(event) => {
              const next = data.bookingServices.find(
                (item) => item.id === event.target.value,
              );
              setServiceId(event.target.value);
              if (next) setLocation(next.defaultLocation);
            }}
          >
            <option value="" disabled>
              Choose service
            </option>
            {data.bookingServices.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Starts
          <input
            required
            type="datetime-local"
            min={new Date().toISOString().slice(0, 16)}
            value={startsAt}
            onChange={(event) => {
              setStartsAt(event.target.value);
              setDateError("");
              setConflicts([]);
              setApprovedTime("");
            }}
          />
          {dateError && (
            <small className="inline-error" role="alert">
              {dateError}
            </small>
          )}
        </label>
        <label>
          Meeting format
          <select
            value={location}
            onChange={(event) =>
              setLocation(event.target.value as MeetingProvider)
            }
          >
            {service?.locationOptions.map((item) => (
              <option key={item} value={item}>
                {item.replaceAll("_", " ")}
              </option>
            ))}
          </select>
        </label>
        {location === "in_person" && (
          <label className="full">
            Location
            <input
              value={locationLabel}
              onChange={(event) => setLocationLabel(event.target.value)}
              placeholder="Confirm now or leave blank to add later"
            />
          </label>
        )}
        <label>
          Custom price (USD)
          <input
            type="number"
            min="0"
            step="0.01"
            value={customPrice}
            onChange={(event) => setCustomPrice(event.target.value)}
            placeholder={
              service
                ? String(
                    (service.priceMinor +
                      Number(service.locationPriceAdjustments[location] || 0)) /
                      100,
                  )
                : ""
            }
          />
          <small>Leave blank to use the current service price.</small>
        </label>
        <label className="check-row">
          <input
            type="checkbox"
            checked={markPaid}
            onChange={(event) => setMarkPaid(event.target.checked)}
          />
          Mark balance paid manually
        </label>
        <label className="full">
          Override reason
          <input
            required
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
        </label>
        {conflicts.length > 0 && (
          <div className="calendar-conflict full" role="alert">
            <strong>Calendar conflict</strong>
            {conflicts.map((item) => (
              <p key={`${item.id}-${item.start}`}>
                You have “{item.summary}” from{" "}
                {formatStudioTime(item.start, data.settings.timezone)}–
                {formatStudioTime(item.end, data.settings.timezone)} that day.
                Do you still want to schedule for this time?
              </p>
            ))}
            <small>
              Submit again to schedule anyway, or choose another time.
            </small>
          </div>
        )}
        <div className="form-actions full">
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button
            className="primary"
            disabled={!studentId || !serviceId || checking}
          >
            {checking
              ? "Checking calendar…"
              : conflicts.length
                ? "Schedule anyway"
                : "Create booking"}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
