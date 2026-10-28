import { CheckCircle2, MoreHorizontal, RefreshCw } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { Dialog, EmptyState, Status } from "../../components/Primitives";
import { TimezoneSelect } from "../../components/TimezoneSelect";
import { formatZonedInput, zonedInputInstants } from "../../domain/zonedInput";
import {
  inspectSchedulingConflicts,
  type SchedulingConflict,
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
  onSave: (
    payload: Record<string, unknown>,
    key?: string,
  ) => Promise<void> | void;
}) {
  const [studentId, setStudentId] = useState(data.students[0]?.id ?? ""),
    [serviceId, setServiceId] = useState(data.bookingServices[0]?.id ?? ""),
    [startsAt, setStartsAt] = useState(() => {
      try {
        return formatZonedInput(
          new Date(Date.now() + 3 * 86400000),
          data.settings.timezone,
        );
      } catch {
        return "";
      }
    }),
    [timezone, setTimezone] = useState(data.settings.timezone || ""),
    [fold, setFold] = useState(""),
    [mode, setMode] = useState("schedule"),
    [outcome, setOutcome] = useState("scheduled"),
    [financial, setFinancial] = useState("record_only"),
    [attendanceConfirmed, setAttendanceConfirmed] = useState(false),
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
    [externalNote, setExternalNote] = useState(""),
    [conflicts, setConflicts] = useState<SchedulingConflict[]>([]),
    [approvedTime, setApprovedTime] = useState(""),
    [checking, setChecking] = useState(false),
    [saving, setSaving] = useState(false);
  const attempt = useRef<{
    request: string;
    key: string;
    form: string;
    payload: Record<string, unknown>;
  } | null>(null);
  useEffect(() => {
    setConflicts([]);
    setApprovedTime("");
  }, [serviceId, location, studentId]);
  const service = data.bookingServices.find((item) => item.id === serviceId);
  const formId = useId();
  const candidates = zonedInputInstants(startsAt, timezone);
  useEffect(() => {
    if (service && !service.locationOptions.includes(location))
      setLocation(service.defaultLocation);
  }, [location, service]);
  return (
    <Dialog
      title="Create a booking"
      description="Coach scheduling and historical recording use separate outcome and notification rules. Every committed record is audited."
      onClose={onClose}
    >
      <form
        className="workflow-form manual-booking-form"
        onSubmit={async (event) => {
          event.preventDefault();
          const instant =
            candidates.length === 1
              ? candidates[0]
              : candidates.find((value) => value === fold);
          const parsedStart = new Date(instant || "");
          if (!instant || Number.isNaN(parsedStart.getTime())) {
            setDateError(
              "Choose a valid clock time and explicit timezone. A skipped DST time cannot be scheduled; a repeated hour needs an occurrence choice.",
            );
            return;
          }
          setDateError("");
          const historical = parsedStart.getTime() <= Date.now();
          if (historical !== (mode === "historical")) {
            setDateError(
              historical
                ? "Use Record Past Lesson to choose its outcome and financial treatment."
                : "Record Past Lesson requires a past time; use Schedule Lesson for this time.",
            );
            return;
          }
          if (
            historical &&
            ["completed", "no_show"].includes(outcome) &&
            !attendanceConfirmed
          ) {
            setDateError("Confirm the actual lesson outcome explicitly.");
            return;
          }
          const form = JSON.stringify([
            studentId,
            serviceId,
            startsAt,
            location,
            locationLabel,
            customPrice,
            markPaid,
            reason,
            timezone,
            fold,
            mode,
            outcome,
            financial,
            attendanceConfirmed,
          ]);
          if (attempt.current?.form === form) {
            setSaving(true);
            try {
              await onSave(attempt.current.payload, attempt.current.key);
            } catch (error) {
              setDateError(
                error instanceof Error
                  ? error.message
                  : "The booking response is unknown. Retry this unchanged request to recover its receipt.",
              );
            } finally {
              setSaving(false);
            }
            return;
          }
          const endsAt = new Date(
            parsedStart.getTime() +
              Number(service?.durationMinutes || 60) * 60_000,
          );
          const timeKey = `${parsedStart.toISOString()}|${endsAt.toISOString()}|${serviceId}|${location}|${studentId}`;
          if (approvedTime !== timeKey) {
            setChecking(true);
            try {
              const preview = isDemo
                ? {
                    conflicts: data.lessons
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
                        source: "studio" as const,
                      })),
                    externalCalendarChecked: false,
                  }
                : await inspectSchedulingConflicts(
                    parsedStart.toISOString(),
                    endsAt.toISOString(),
                    undefined,
                    historical,
                  );
              const found = preview.conflicts;
              setExternalNote(
                historical
                  ? "Historical preview compares local records only. No provider availability check or delivery will run."
                  : isDemo
                    ? "Demo conflict preview uses local fixture lessons only."
                    : preview.externalCalendarChecked
                      ? "Google and local studio conflict checks completed."
                      : "Google is not configured. Only local studio conflicts were checked.",
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
          if (
            conflicts.some((item) => item.source === "studio") &&
            approvedTime === timeKey
          ) {
            setDateError("Studio lessons cannot overlap. Choose another time.");
            return;
          }
          const payload = {
            student_id: studentId,
            service_id: serviceId,
            starts_at: parsedStart.toISOString(),
            location,
            location_label: locationLabel,
            price_minor:
              customPrice === "" ? null : Math.round(Number(customPrice) * 100),
            mark_paid: markPaid,
            reason,
            timezone,
            historical,
            ...(historical
              ? {
                  historical_outcome: outcome,
                  historical_financial: financial,
                  attendance_confirmed: attendanceConfirmed,
                }
              : {}),
            allow_conflict: approvedTime === timeKey,
          };
          const fingerprint = JSON.stringify(payload);
          if (attempt.current?.request !== fingerprint)
            attempt.current = {
              request: fingerprint,
              key: crypto.randomUUID(),
              form,
              payload,
            };
          setSaving(true);
          try {
            await onSave(payload, attempt.current.key);
          } catch (error) {
            setDateError(
              error instanceof Error
                ? error.message
                : "The booking response is unknown. Retry this unchanged request to recover its receipt.",
            );
          } finally {
            setSaving(false);
          }
        }}
      >
        {!data.students.length && (
          <p className="inline-error full">
            Add a student to the roster before creating a coach booking.
          </p>
        )}
        <label className="full" htmlFor={`${formId}-mode`}>
          Entry type
          <select
            id={`${formId}-mode`}
            value={mode}
            onChange={(event) => {
              setMode(event.target.value);
              setDateError("");
              setFold("");
              setConflicts([]);
              setApprovedTime("");
              const offset =
                event.target.value === "historical" ? -86400000 : 3 * 86400000;
              try {
                setStartsAt(
                  formatZonedInput(new Date(Date.now() + offset), timezone),
                );
              } catch {
                setStartsAt("");
              }
            }}
          >
            <option value="schedule">Schedule Lesson</option>
            <option value="historical">Record Past Lesson</option>
          </select>
        </label>
        <p className="full">
          Studio timezone: {data.settings.timezone || "not configured"}. Device
          timezone: {Intl.DateTimeFormat().resolvedOptions().timeZone}. The time
          control uses {timezone || "the timezone you explicitly choose"}.
        </p>
        <label className="full" htmlFor={`${formId}-timezone`}>
          Scheduling timezone
          <TimezoneSelect
            id={`${formId}-timezone`}
            value={timezone}
            onChange={(value) => {
              setTimezone(value);
              setFold("");
              setApprovedTime("");
              setConflicts([]);
            }}
          />
        </label>
        {externalNote && (
          <p className="full" role="status">
            {externalNote}
          </p>
        )}
        <label htmlFor={`${formId}-student`}>
          Student
          <select
            id={`${formId}-student`}
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
        <label htmlFor={`${formId}-service`}>
          Service
          <select
            id={`${formId}-service`}
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
        <label htmlFor={`${formId}-starts`}>
          Starts
          <input
            id={`${formId}-starts`}
            aria-describedby={dateError ? `${formId}-error` : undefined}
            required
            type="datetime-local"
            value={startsAt}
            onChange={(event) => {
              setStartsAt(event.target.value);
              setDateError("");
              setConflicts([]);
              setApprovedTime("");
              setFold("");
            }}
          />
        </label>
        {dateError && (
          <p id={`${formId}-error`} className="inline-error full" role="alert">
            {dateError}
          </p>
        )}
        {candidates.length > 1 && (
          <label className="full" htmlFor={`${formId}-fold`}>
            Repeated hour occurrence
            <select
              id={`${formId}-fold`}
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
        {mode === "historical" && (
          <>
            <label htmlFor={`${formId}-outcome`}>
              Historical outcome
              <select
                id={`${formId}-outcome`}
                value={outcome}
                onChange={(event) => {
                  setOutcome(event.target.value);
                  setAttendanceConfirmed(false);
                }}
              >
                <option value="scheduled">Scheduled</option>
                <option value="completed">Completed</option>
                <option value="cancelled">Cancelled</option>
                <option value="no_show">No-show</option>
              </select>
            </label>
            <label htmlFor={`${formId}-financial`}>
              Historical financial treatment
              <select
                id={`${formId}-financial`}
                value={financial}
                onChange={(event) => setFinancial(event.target.value)}
              >
                <option value="record_only">Record only</option>
                <option value="amount_due">Record amount due</option>
                <option value="payment_received">
                  Record payment received
                </option>
              </select>
            </label>
            {["completed", "no_show"].includes(outcome) && (
              <label
                className="check-row full"
                htmlFor={`${formId}-attendance`}
              >
                <input
                  id={`${formId}-attendance`}
                  type="checkbox"
                  checked={attendanceConfirmed}
                  onChange={(event) =>
                    setAttendanceConfirmed(event.target.checked)
                  }
                />
                I confirm the actual{" "}
                {outcome === "completed" ? "completed lesson" : "no-show"}{" "}
                outcome; it is not inferred from the date.
              </label>
            )}
            <p className="full">
              {financial === "record_only" &&
                "Record only creates no financial obligation. "}
              {outcome === "scheduled" &&
                "Scheduled leaves attendance unknown. "}
              Historical records do not create Calendar events, notifications or
              credit consumption. Any amount due or payment is recorded only
              through the selected financial treatment.
            </p>
          </>
        )}
        <label htmlFor={`${formId}-meeting`}>
          Meeting format
          <select
            id={`${formId}-meeting`}
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
          <label className="full" htmlFor={`${formId}-location`}>
            Location
            <input
              id={`${formId}-location`}
              value={locationLabel}
              onChange={(event) => setLocationLabel(event.target.value)}
              placeholder="Confirm now or leave blank to add later"
            />
          </label>
        )}
        <label htmlFor={`${formId}-price`}>
          Custom price (USD)
          <input
            id={`${formId}-price`}
            type="number"
            disabled={mode === "historical" && financial === "record_only"}
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
        {mode !== "historical" && (
          <label className="check-row" htmlFor={`${formId}-paid`}>
            <input
              id={`${formId}-paid`}
              type="checkbox"
              checked={markPaid}
              onChange={(event) => setMarkPaid(event.target.checked)}
            />
            Mark balance paid manually
          </label>
        )}
        <label className="full" htmlFor={`${formId}-reason`}>
          Override reason
          <input
            id={`${formId}-reason`}
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
                {item.source === "studio"
                  ? "Choose another time; studio lesson overlaps cannot be overridden."
                  : "A coach may override this Google-only conflict with the recorded reason."}
              </p>
            ))}
            <small>
              {conflicts.some((item) => item.source === "studio")
                ? "Local double-booking protection remains active."
                : "Submit again to override this Google-only conflict, or choose another time."}
            </small>
          </div>
        )}
        <div className="form-actions full">
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button
            className="primary"
            disabled={
              !studentId ||
              !serviceId ||
              checking ||
              saving ||
              conflicts.some((item) => item.source === "studio")
            }
          >
            {saving
              ? "Saving booking…"
              : checking
                ? "Checking calendar…"
                : conflicts.length
                  ? "Override Google conflict"
                  : "Create booking"}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
