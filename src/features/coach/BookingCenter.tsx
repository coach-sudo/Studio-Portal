import {
  CalendarClock,
  CalendarDays,
  CheckCircle2,
  Edit3,
  MoreHorizontal,
  Plus,
  RefreshCw,
  Settings2,
  Users,
} from "lucide-react";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Dialog,
  EmptyState,
  PageHeader,
  Status,
} from "../../components/Primitives";
import {
  bookingAdminCommand,
  loadPlatformHealth,
  type BookingAdminResource,
  type PlatformHealth,
} from "../../data/bookingCommands";
import { cancelDemoBooking, remainingCapacity } from "../../domain/booking";
import { formatMoney } from "../../domain/finance";
import type {
  AvailabilityRule,
  Booking,
  BookingService,
  MeetingProvider,
  RecurringSeries,
  ServiceOffering,
  StudioSnapshot,
} from "../../domain/model";
import { useStudio } from "../../hooks/useStudio";
import { useStudioStore } from "../../state/StudioStore";

type Tab =
  | "overview"
  | "calendar"
  | "services"
  | "availability"
  | "classes"
  | "series";
const tabs: readonly [Tab, string][] = [
  ["overview", "Overview"],
  ["calendar", "Calendar"],
  ["services", "Services"],
  ["availability", "Availability"],
  ["classes", "Classes & courses"],
  ["series", "Recurring"],
];
const uid = (prefix: string) => `${prefix}-${crypto.randomUUID()}`;
const serviceName = (data: StudioSnapshot, id: string) =>
  data.bookingServices.find((item) => item.id === id)?.name ?? "Booking";
const bookingTone = (status: Booking["status"]) =>
  status === "confirmed" || status === "completed"
    ? "good"
    : status === "needs_attention" || status === "late_cancelled"
      ? "warn"
      : status === "cancelled" || status === "expired"
        ? "danger"
        : "neutral";

export function BookingCenter() {
  const { data, isLoading, isDemo } = useStudio();
  const store = useStudioStore();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<Tab>("overview");
  const [dialog, setDialog] = useState<{ type: string; item?: any }>();
  const [notice, setNotice] = useState("");
  const [health, setHealth] = useState<PlatformHealth>({
    mode: "demo",
    supabase: false,
    stripe: false,
    googleCalendar: false,
    gmail: false,
    scheduledWorkers: false,
  });
  useEffect(() => {
    void loadPlatformHealth().then(setHealth);
  }, []);
  if (isLoading || !data)
    return <div className="loading">Opening booking center…</div>;

  async function run(
    resource: BookingAdminResource,
    command: string,
    payload: Record<string, unknown>,
    item: { id: string; version: number } | undefined,
    mutate: (draft: StudioSnapshot) => void,
  ) {
    setNotice("");
    try {
      if (isDemo) store.transact((draft) => mutate(draft));
      else {
        await bookingAdminCommand(resource, {
          command,
          id: item?.id,
          expectedVersion: item?.version,
          payload,
        });
        await queryClient.invalidateQueries({ queryKey: ["studio"] });
      }
      setDialog(undefined);
      setNotice("Saved. The booking workspace has been updated.");
    } catch (reason) {
      setNotice(
        reason instanceof Error
          ? reason.message
          : "The change could not be saved.",
      );
    }
  }

  return (
    <div className="page booking-center">
      <PageHeader
        title="Bookings"
        action={
          <div className="header-actions">
            <a className="button-link" href="/book" target="_blank" rel="noreferrer">
              View public booking page
            </a>
            <button
              className="primary-button"
              onClick={() => setDialog({ type: "manual" })}
            >
              <Plus />
              New booking
            </button>
          </div>
        }
      >
        Services, availability, classes, payments, and every occurrence in one
        place.
      </PageHeader>
      {isDemo && (
        <p className="portal-notice">
          <CheckCircle2 />
          Interactive demo: changes persist across this browser session until
          refresh.
        </p>
      )}
      {notice && (
        <p className="portal-notice" role="status">
          {notice}
        </p>
      )}
      {!data.availabilityRules.length && (
        <p className="portal-notice" role="status">
          <CalendarClock />
          Public booking is waiting for weekly hours. Open Availability and add
          at least one bookable window.
        </p>
      )}
      <nav className="subnav" aria-label="Booking sections">
        {tabs.map(([id, label]) => (
          <button
            key={id}
            className={tab === id ? "active" : ""}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </nav>
      {tab === "overview" && (
        <Overview
          data={data}
          health={health}
          onViewAll={() => setTab("calendar")}
          onBooking={(item) => setDialog({ type: "booking", item })}
        />
      )}
      {tab === "calendar" && (
        <CalendarView
          data={data}
          onBooking={(item) => setDialog({ type: "booking", item })}
        />
      )}
      {tab === "services" && (
        <Services
          data={data}
          onAdd={() => setDialog({ type: "service" })}
          onEdit={(item) => setDialog({ type: "service", item })}
        />
      )}
      {tab === "availability" && (
        <Availability
          data={data}
          onRule={(item) => setDialog({ type: "rule", item })}
          onException={() => setDialog({ type: "exception" })}
          onDeleteRule={(item) =>
            void run("availability", "delete", {}, item, (draft) => {
              draft.availabilityRules = draft.availabilityRules.filter(
                (row) => row.id !== item.id,
              );
            })
          }
          onDeleteException={(item) =>
            void run("exceptions", "delete", {}, item, (draft) => {
              draft.availabilityExceptions =
                draft.availabilityExceptions.filter(
                  (row) => row.id !== item.id,
                );
            })
          }
        />
      )}
      {tab === "classes" && (
        <Classes
          data={data}
          onCreate={() => setDialog({ type: "offering" })}
          onRoster={(item) => setDialog({ type: "roster", item })}
        />
      )}
      {tab === "series" && (
        <Series
          data={data}
          onManage={(item) => setDialog({ type: "series", item })}
        />
      )}
      {dialog?.type === "manual" && (
        <ManualBookingDialog
          data={data}
          onClose={() => setDialog(undefined)}
          onSave={(payload) =>
            run("bookings", "create_manual", payload, undefined, (draft) =>
              createDemoManualBooking(draft, payload),
            )
          }
        />
      )}
      {dialog?.type === "service" && (
        <ServiceDialog
          service={dialog.item}
          settings={data.settings}
          onClose={() => setDialog(undefined)}
          onSave={(value) =>
            run(
              "services",
              dialog.item ? "update" : "create",
              toServiceRow(value, data.studioId),
              dialog.item,
              (draft) => {
                if (dialog.item)
                  Object.assign(
                    draft.bookingServices.find(
                      (item) => item.id === dialog.item.id,
                    )!,
                    value,
                    {
                      version: dialog.item.version + 1,
                      updatedAt: new Date().toISOString(),
                    },
                  );
                else draft.bookingServices.push(value);
              },
            )
          }
        />
      )}
      {dialog?.type === "rule" && (
        <RuleDialog
          rule={dialog.item}
          onClose={() => setDialog(undefined)}
          onSave={(value) => {
            const saved = data.availabilityRules.find(
              (item) => item.id === value.id,
            );
            return run(
              "availability",
              saved ? "update" : "create",
              toRuleRow(value, data.studioId),
              saved,
              (draft) => {
                const existing = draft.availabilityRules.find(
                  (item) => item.id === value.id,
                );
                if (existing)
                  Object.assign(existing, value, {
                    version: existing.version + 1,
                    updatedAt: new Date().toISOString(),
                  });
                else draft.availabilityRules.push(value);
              },
            );
          }}
        />
      )}
      {dialog?.type === "exception" && (
        <ExceptionDialog
          onClose={() => setDialog(undefined)}
          onSave={(value) =>
            run(
              "exceptions",
              "create",
              {
                studio_id: data.studioId,
                starts_at: value.startsAt,
                ends_at: value.endsAt,
                kind: value.kind,
                label: value.label,
              },
              undefined,
              (draft) => draft.availabilityExceptions.push(value),
            )
          }
        />
      )}
      {dialog?.type === "offering" && (
        <OfferingDialog
          services={data.bookingServices.filter(
            (item) => item.category !== "private",
          )}
          onClose={() => setDialog(undefined)}
          onSave={(value) =>
            run(
              "offerings",
              "create_offering",
              {
                studio_id: data.studioId,
                service_id: value.serviceId,
                title: value.title,
                starts_at: value.startsAt,
                enrollment_closes_at: value.enrollmentClosesAt,
                capacity: value.capacity,
                published: value.published,
                occurrence_count: value.lessonIds.length,
                description: value.description,
                meeting_url: value.meetingUrl,
                resource_links: value.resourceLinks,
              },
              undefined,
              (draft) => createDemoOffering(draft, value),
            )
          }
        />
      )}
      {dialog?.type === "roster" && (
        <RosterDialog
          offering={dialog.item}
          data={data}
          onClose={() => setDialog(undefined)}
          onDelete={() => {
            if (!window.confirm(`Delete “${dialog.item.title}” and its unsold occurrences?`)) return;
            void run("offerings", "delete", {}, dialog.item, (draft) => {
              draft.serviceOfferings = draft.serviceOfferings.filter((item) => item.id !== dialog.item.id);
              draft.lessons = draft.lessons.filter((lesson) => !dialog.item.lessonIds.includes(lesson.id));
            });
          }}
        />
      )}
      {dialog?.type === "series" && (
        <SeriesDialog
          series={dialog.item}
          onClose={() => setDialog(undefined)}
          onSave={(status) =>
            run("series", "update", { status }, dialog.item, (draft) => {
              const series = draft.recurringSeries.find(
                (item) => item.id === dialog.item.id,
              )!;
              series.status = status;
              series.version += 1;
              series.updatedAt = new Date().toISOString();
            })
          }
        />
      )}
      {dialog?.type === "booking" && (
        <BookingDialog
          booking={dialog.item}
          data={data}
          onClose={() => setDialog(undefined)}
          onAction={(command, payload = {}) =>
            run("bookings", command, payload, dialog.item, (draft) => {
              if (command === "confirm_location") {
                const booking = draft.bookings.find(
                  (item) => item.id === dialog.item.id,
                )!;
                booking.inPersonLocation = String(payload.location);
                booking.locationConfirmedAt = new Date().toISOString();
                booking.version += 1;
                draft.lessons
                  .filter((lesson) =>
                    draft.lessonParticipants.some(
                      (part) =>
                        part.bookingId === booking.id &&
                        part.lessonId === lesson.id,
                    ),
                  )
                  .forEach(
                    (lesson) =>
                      (lesson.locationLabel = String(payload.location)),
                  );
              } else changeDemoBooking(draft, dialog.item.id, command);
            })
          }
        />
      )}
    </div>
  );
}

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
function Overview({
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
        <Metric
          label="Integration health"
          value={`${readyCount}/4`}
          detail={
            health.mode === "live"
              ? "live services ready"
              : "demo configuration"
          }
          tone={readyCount === 4 ? "green" : "gold"}
        />
      </section>
      <CoachPanel
        title="Booking activity"
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
          {data.bookings.map((booking) => (
            <BookingRow
              key={booking.id}
              booking={booking}
              data={data}
              onOpen={() => onBooking(booking)}
            />
          ))}
        </div>
      </CoachPanel>
      <div className="coach-two-column">
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
        {new Date(booking.startsAt).toLocaleString([], {
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

function CalendarView({
  data,
  onBooking,
}: {
  data: StudioSnapshot;
  onBooking: (item: Booking) => void;
}) {
  const [offset, setOffset] = useState(0);
  const days = useMemo(
    () =>
      Array.from({ length: 7 }, (_, index) => {
        const date = new Date();
        date.setHours(0, 0, 0, 0);
        date.setDate(date.getDate() - date.getDay() + index + offset * 7);
        return date;
      }),
    [offset],
  );
  return (
    <CoachPanel
      title={`${days[0].toLocaleDateString([], { month: "short", day: "numeric" })} – ${days[6].toLocaleDateString([], { month: "short", day: "numeric" })}`}
      aside={
        <div className="calendar-controls">
          <button onClick={() => setOffset(0)}>Today</button>
          <button
            aria-label="Previous week"
            onClick={() => setOffset((value) => value - 1)}
          >
            ‹
          </button>
          <button
            aria-label="Next week"
            onClick={() => setOffset((value) => value + 1)}
          >
            ›
          </button>
        </div>
      }
    >
      <div className="week-calendar">
        {days.map((day) => (
          <section key={day.toISOString()}>
            <header>
              <span>{day.toLocaleDateString([], { weekday: "short" })}</span>
              <strong>{day.getDate()}</strong>
            </header>
            <div>
              {data.lessons
                .filter(
                  (lesson) =>
                    new Date(lesson.startsAt).toDateString() ===
                    day.toDateString(),
                )
                .map((lesson) => {
                  const booking = data.bookings.find((item) =>
                    data.lessonParticipants.some(
                      (part) =>
                        part.lessonId === lesson.id &&
                        part.bookingId === item.id,
                    ),
                  );
                  return (
                    <button
                      key={lesson.id}
                      onClick={() => booking && onBooking(booking)}
                    >
                      <article>
                        <time>
                          {new Date(lesson.startsAt).toLocaleTimeString([], {
                            hour: "numeric",
                            minute: "2-digit",
                          })}
                        </time>
                        <strong>{lesson.topic}</strong>
                        <small>{lesson.locationLabel}</small>
                      </article>
                    </button>
                  );
                })}
            </div>
          </section>
        ))}
      </div>
    </CoachPanel>
  );
}

function ManualBookingDialog({
  data,
  onClose,
  onSave,
}: {
  data: StudioSnapshot;
  onClose: () => void;
  onSave: (payload: Record<string, unknown>) => void;
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
    [dateError, setDateError] = useState("");
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
        onSubmit={(event) => {
          event.preventDefault();
          const parsedStart = new Date(startsAt);
          if (!startsAt || Number.isNaN(parsedStart.getTime())) {
            setDateError("Choose a valid date and time before creating the booking.");
            return;
          }
          setDateError("");
          onSave({
            student_id: studentId,
            service_id: serviceId,
            starts_at: parsedStart.toISOString(),
            location,
            location_label: locationLabel,
            price_minor:
              customPrice === "" ? null : Math.round(Number(customPrice) * 100),
            mark_paid: markPaid,
            reason,
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
            }}
          />
          {dateError && <small className="inline-error" role="alert">{dateError}</small>}
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
        <div className="form-actions full">
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="primary" disabled={!studentId || !serviceId}>
            Create booking
          </button>
        </div>
      </form>
    </Dialog>
  );
}

function Services({
  data,
  onAdd,
  onEdit,
}: {
  data: StudioSnapshot;
  onAdd: () => void;
  onEdit: (item: BookingService) => void;
}) {
  return (
    <CoachPanel
      title="Booking services"
      aside={
        <button className="small-primary" onClick={onAdd}>
          <Plus />
          Add service
        </button>
      }
    >
      <div className="service-admin-grid">
        {data.bookingServices.map((service) => (
          <article key={service.id}>
            <header>
              <span>{service.category.replaceAll("_", " ")}</span>
              <Status tone={service.published ? "good" : "neutral"}>
                {service.published ? "published" : "draft"}
              </Status>
            </header>
            <h3>{service.name}</h3>
            <p>
              {service.durationMinutes} min ·{" "}
              {formatMoney(service.priceMinor, service.currency)} ·{" "}
              {service.locationOptions
                .map((item) => (item === "google_meet" ? "Meet" : "Studio"))
                .join(" / ")}
            </p>
            <div className="policy-chips">
              <span>{service.minimumNoticeHours}h notice</span>
              <span>{service.bufferAfterMinutes}m buffer</span>
              <span>{service.paymentPolicies.length} payment options</span>
            </div>
            <footer>
              <button onClick={() => onEdit(service)}>
                <Edit3 />
                Edit
              </button>
            </footer>
          </article>
        ))}
      </div>
    </CoachPanel>
  );
}

function Availability({
  data,
  onRule,
  onException,
  onDeleteRule,
  onDeleteException,
}: {
  data: StudioSnapshot;
  onRule: (item: AvailabilityRule) => void;
  onException: () => void;
  onDeleteRule: (item: AvailabilityRule) => void;
  onDeleteException: (
    item: StudioSnapshot["availabilityExceptions"][number],
  ) => void;
}) {
  const names = [
    "Sunday",
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
  ];
  return (
    <div className="availability-layout">
      <CoachPanel
        title="Weekly hours"
        aside={
          <span className="status neutral">
            <Settings2 />
            {data.settings.timezone}
          </span>
        }
      >
        <div className="hours-list">
          {names.map((name, index) => {
            const rules = data.availabilityRules
              .filter((item) => item.weekday === index)
              .sort((a, b) => a.startsAtLocal.localeCompare(b.startsAtLocal));
            return (
              <article key={name} className={!rules.length ? "off" : ""}>
                <strong>{name}</strong>
                <div className="availability-windows">
                  {rules.length ? (
                    rules.map((rule) => (
                      <span key={rule.id}>
                        {rule.startsAtLocal} – {rule.endsAtLocal}
                        <button
                          aria-label={`Edit ${name} ${rule.startsAtLocal}`}
                          onClick={() => onRule(rule)}
                        >
                          <Edit3 />
                        </button>
                        <button
                          aria-label={`Delete ${name} ${rule.startsAtLocal}`}
                          onClick={() => onDeleteRule(rule)}
                        >
                          ×
                        </button>
                      </span>
                    ))
                  ) : (
                    <span>Unavailable</span>
                  )}
                </div>
                <button
                  aria-label={`Add ${name}`}
                  onClick={() =>
                    onRule({
                      id: uid("rule"),
                      studioId: data.studioId,
                      weekday: index,
                      startsAtLocal: "12:00",
                      endsAtLocal: "18:00",
                      timezone: data.settings.timezone,
                      active: true,
                      version: 1,
                      updatedAt: new Date().toISOString(),
                    })
                  }
                >
                  <Plus />
                </button>
              </article>
            );
          })}
        </div>
      </CoachPanel>
      <CoachPanel
        title="Blackouts & exceptions"
        aside={
          <button className="small-primary" onClick={onException}>
            <Plus />
            Add
          </button>
        }
      >
        <div className="exception-list">
          {data.availabilityExceptions.map((item) => (
            <article key={item.id}>
              <CalendarDays />
              <div>
                <strong>{item.label}</strong>
                <small>
                  {new Date(item.startsAt).toLocaleDateString()} –{" "}
                  {new Date(item.endsAt).toLocaleDateString()}
                </small>
              </div>
              <Status tone={item.kind === "unavailable" ? "warn" : "good"}>
                {item.kind}
              </Status>
              <button
                aria-label={`Delete ${item.label}`}
                onClick={() => onDeleteException(item)}
              >
                ×
              </button>
            </article>
          ))}
          {!data.availabilityExceptions.length && (
            <EmptyState
              title="No exceptions"
              detail="Blackouts, vacations, and special availability will appear here."
            />
          )}
        </div>
      </CoachPanel>
    </div>
  );
}

function Classes({
  data,
  onCreate,
  onRoster,
}: {
  data: StudioSnapshot;
  onCreate: () => void;
  onRoster: (item: ServiceOffering) => void;
}) {
  return (
    <CoachPanel
      title="Published offerings"
      aside={
        <button className="small-primary" onClick={onCreate}>
          <Plus />
          Create offering
        </button>
      }
    >
      <div className="offering-grid">
        {data.serviceOfferings.map((offering) => {
          const service = data.bookingServices.find(
            (item) => item.id === offering.serviceId,
          );
          const remaining = remainingCapacity(
            offering.capacity,
            offering.enrolled,
          );
          return (
            <article key={offering.id}>
              <div className="offering-date">
                <span>
                  {new Date(offering.startsAt).toLocaleDateString([], {
                    month: "short",
                  })}
                </span>
                <strong>{new Date(offering.startsAt).getDate()}</strong>
              </div>
              <div>
                <span className="eyebrow">
                  {service?.category.replaceAll("_", " ")}
                </span>
                <h3>{offering.title}</h3>
                <p>
                  {new Date(offering.startsAt).toLocaleString([], {
                    weekday: "long",
                    hour: "numeric",
                    minute: "2-digit",
                  })}{" "}
                  ·{" "}
                  {service?.defaultLocation === "google_meet"
                    ? "Google Meet"
                    : "Studio"}
                </p>
                <div className="capacity-bar">
                  <i
                    style={{
                      width: `${(offering.enrolled / offering.capacity) * 100}%`,
                    }}
                  />
                  <span>
                    {offering.enrolled} enrolled · {remaining} spots left
                  </span>
                </div>
              </div>
              <button onClick={() => onRoster(offering)}>Roster ›</button>
            </article>
          );
        })}
      </div>
    </CoachPanel>
  );
}
function Series({
  data,
  onManage,
}: {
  data: StudioSnapshot;
  onManage: (item: RecurringSeries) => void;
}) {
  return (
    <CoachPanel
      title="Recurring students"
      aside={<span className="status good">Rolling 12 weeks</span>}
    >
      <div className="series-list">
        {data.recurringSeries.map((series) => {
          const student = data.students.find(
            (item) => item.id === series.studentId,
          );
          const service = data.bookingServices.find(
            (item) => item.id === series.serviceId,
          );
          return (
            <article key={series.id}>
              <span className="series-icon">
                <CalendarClock />
              </span>
              <div>
                <strong>{student?.fullName ?? "Course cohort"}</strong>
                <small>
                  {service?.name} · {series.cadence} · {series.kind}
                </small>
              </div>
              <div>
                <strong>
                  {series.nextBillingAt
                    ? new Date(series.nextBillingAt).toLocaleDateString()
                    : "Paid upfront"}
                </strong>
                <small>next billing</small>
              </div>
              <Status tone={series.status === "active" ? "good" : "warn"}>
                {series.status.replaceAll("_", " ")}
              </Status>
              <button
                aria-label="Manage series"
                onClick={() => onManage(series)}
              >
                <MoreHorizontal />
              </button>
            </article>
          );
        })}
      </div>
    </CoachPanel>
  );
}

function ServiceDialog({
  service,
  settings,
  onClose,
  onSave,
}: {
  service?: BookingService;
  settings: StudioSnapshot["settings"];
  onClose: () => void;
  onSave: (value: BookingService) => void;
}) {
  const [value, setValue] = useState<BookingService>(() =>
    service
      ? structuredClone(service)
      : {
          id: uid("service"),
          studioId: "studio-stage-story",
          slug: "",
          name: "",
          description: "",
          category: "private",
          durationMinutes: 60,
          priceMinor: settings.lessonRatesMinor[60],
          depositMinor: 0,
          depositType: "none",
          balanceDueTiming: "at_booking",
          autoChargeBalance: false,
          currency: settings.currency,
          capacity: 1,
          locationOptions: (Object.entries(settings.meetingFormats)
            .filter(([, format]) => format.enabled)
            .map(([provider]) => provider) as BookingService["locationOptions"]).filter(
            (provider) => provider === "google_meet" || provider === "in_person",
          ),
          defaultLocation: settings.meetingFormats.google_meet?.enabled
            ? "google_meet"
            : "in_person",
          recurrenceOptions: ["none"],
          paymentPolicies: ["pay_now", "pay_later"],
          bufferBeforeMinutes: settings.bookingDefaults.bufferBeforeMinutes,
          bufferAfterMinutes: settings.bookingDefaults.bufferAfterMinutes,
          bufferByLocation: {},
          locationPriceAdjustments: {
            in_person: settings.bookingDefaults.inPersonUpchargeMinor,
          },
          minimumNoticeHours: settings.bookingDefaults.minimumNoticeHours,
          bookingHorizonDays: settings.bookingDefaults.bookingHorizonDays,
          slotIntervalMinutes: 30,
          policy: {
            cancellationWindowHours:
              settings.bookingDefaults.cancellationWindowHours,
            rescheduleLimit: 1,
            settlement: "original_payment",
            lateSettlement: "none",
          },
          policyVersion: 1,
          published: false,
          version: 1,
          updatedAt: new Date().toISOString(),
        },
  );
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const field = event.currentTarget.querySelector("input")!;
    field.setCustomValidity("");
    const fail = (message: string) => {
      field.setCustomValidity(message);
      field.reportValidity();
    };
    if (!value.locationOptions.length || !value.paymentPolicies.length) {
      fail("Choose at least one delivery and payment option.");
      return;
    }
    if (!value.locationOptions.includes(value.defaultLocation)) {
      fail("Choose a default delivery that is enabled.");
      return;
    }
    if (value.paymentPolicies.includes("deposit") && value.depositMinor <= 0) {
      fail("Set a deposit amount before enabling deposits.");
      return;
    }
    onSave({
      ...value,
      slug:
        value.slug ||
        value.name
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-|-$/g, ""),
      capacity: value.category === "private" ? 1 : value.capacity,
    });
  };
  const toggle = <T extends string>(items: T[], item: T, checked: boolean) =>
    checked
      ? [...new Set([...items, item])]
      : items.filter((current) => current !== item);
  return (
    <Dialog
      title={service ? "Edit service" : "Add service"}
      description="Pricing and policy edits apply only to future bookings."
      onClose={onClose}
    >
      <form className="workflow-form" onSubmit={submit}>
        <label>
          Name
          <input
            required
            value={value.name}
            onChange={(event) =>
              setValue({ ...value, name: event.target.value })
            }
          />
        </label>
        <label>
          Category
          <select
            value={value.category}
            onChange={(event) =>
              setValue({
                ...value,
                category: event.target.value as BookingService["category"],
              })
            }
          >
            <option value="private">Private</option>
            <option value="group_class">Group class</option>
            <option value="course">Course</option>
          </select>
        </label>
        <label className="full">
          Description
          <textarea
            required
            value={value.description}
            onChange={(event) =>
              setValue({ ...value, description: event.target.value })
            }
          />
        </label>
        <label>
          Duration (minutes)
          <input
            type="number"
            min="15"
            max="480"
            required
            value={value.durationMinutes}
            onChange={(event) =>
              setValue({
                ...value,
                durationMinutes: Number(event.target.value),
              })
            }
          />
        </label>
        <label>
          Price (USD)
          <input
            type="number"
            min="0"
            step="0.01"
            required
            value={value.priceMinor / 100}
            onChange={(event) =>
              setValue({
                ...value,
                priceMinor: Math.round(Number(event.target.value) * 100),
              })
            }
          />
        </label>
        <label>
          In-person upcharge (USD)
          <input
            type="number"
            min="0"
            step="0.01"
            value={Number(value.locationPriceAdjustments.in_person || 0) / 100}
            onChange={(event) =>
              setValue({
                ...value,
                locationPriceAdjustments: {
                  ...value.locationPriceAdjustments,
                  in_person: Math.round(Number(event.target.value) * 100),
                },
              })
            }
          />
        </label>
        <label>
          Deposit (USD)
          <input
            type="number"
            min="0"
            max={value.priceMinor / 100}
            step="0.01"
            value={value.depositMinor / 100}
            onChange={(event) =>
              setValue({
                ...value,
                depositMinor: Math.round(Number(event.target.value) * 100),
              })
            }
          />
        </label>
        <label>
          Capacity
          <input
            type="number"
            min="1"
            disabled={value.category === "private"}
            value={value.capacity}
            onChange={(event) =>
              setValue({ ...value, capacity: Number(event.target.value) })
            }
          />
        </label>
        <label>
          Minimum notice (hours)
          <input
            type="number"
            min="0"
            value={value.minimumNoticeHours}
            onChange={(event) =>
              setValue({
                ...value,
                minimumNoticeHours: Number(event.target.value),
              })
            }
          />
        </label>
        <label>
          Booking horizon (days)
          <input
            type="number"
            min="1"
            max="730"
            value={value.bookingHorizonDays}
            onChange={(event) =>
              setValue({
                ...value,
                bookingHorizonDays: Number(event.target.value),
              })
            }
          />
        </label>
        <label>
          Buffer before (minutes)
          <input
            type="number"
            min="0"
            value={value.bufferBeforeMinutes}
            onChange={(event) =>
              setValue({
                ...value,
                bufferBeforeMinutes: Number(event.target.value),
              })
            }
          />
        </label>
        <label>
          Buffer after (minutes)
          <input
            type="number"
            min="0"
            value={value.bufferAfterMinutes}
            onChange={(event) =>
              setValue({
                ...value,
                bufferAfterMinutes: Number(event.target.value),
              })
            }
          />
        </label>
        <label>
          Slot interval (minutes)
          <input
            type="number"
            min="5"
            max="120"
            value={value.slotIntervalMinutes}
            onChange={(event) =>
              setValue({
                ...value,
                slotIntervalMinutes: Number(event.target.value),
              })
            }
          />
        </label>
        <label>
          Cancellation window
          <input
            type="number"
            min="0"
            value={value.policy.cancellationWindowHours}
            onChange={(event) =>
              setValue({
                ...value,
                policy: {
                  ...value.policy,
                  cancellationWindowHours: Number(event.target.value),
                },
              })
            }
          />
        </label>
        <label>
          Self-service reschedules
          <input
            type="number"
            min="0"
            max="10"
            value={value.policy.rescheduleLimit}
            onChange={(event) =>
              setValue({
                ...value,
                policy: {
                  ...value.policy,
                  rescheduleLimit: Number(event.target.value),
                },
              })
            }
          />
        </label>
        <label>
          On-time settlement
          <select
            value={value.policy.settlement}
            onChange={(event) =>
              setValue({
                ...value,
                policy: {
                  ...value.policy,
                  settlement: event.target
                    .value as BookingService["policy"]["settlement"],
                },
              })
            }
          >
            <option value="original_payment">Original payment</option>
            <option value="studio_credit">Studio credit</option>
            <option value="manual">Manual</option>
            <option value="none">None</option>
          </select>
        </label>
        <label>
          Late settlement
          <select
            value={value.policy.lateSettlement}
            onChange={(event) =>
              setValue({
                ...value,
                policy: {
                  ...value.policy,
                  lateSettlement: event.target
                    .value as BookingService["policy"]["lateSettlement"],
                },
              })
            }
          >
            <option value="none">None</option>
            <option value="studio_credit">Studio credit</option>
            <option value="manual">Manual</option>
            <option value="original_payment">Original payment</option>
          </select>
        </label>
        <fieldset className="full option-fieldset">
          <legend>Delivery</legend>
          {(["google_meet", "in_person"] as const).map((item) => (
            <label className="check-row" key={item}>
              <input
                type="checkbox"
                checked={value.locationOptions.includes(item)}
                onChange={(event) =>
                  setValue({
                    ...value,
                    locationOptions: toggle(
                      value.locationOptions,
                      item,
                      event.target.checked,
                    ),
                  })
                }
              />
              {item.replaceAll("_", " ")}
            </label>
          ))}
        </fieldset>
        <label>
          Default delivery
          <select
            value={value.defaultLocation}
            onChange={(event) =>
              setValue({
                ...value,
                defaultLocation: event.target
                  .value as BookingService["defaultLocation"],
              })
            }
          >
            {value.locationOptions.map((item) => (
              <option key={item} value={item}>
                {item.replaceAll("_", " ")}
              </option>
            ))}
          </select>
        </label>
        <fieldset className="full option-fieldset">
          <legend>Recurrence</legend>
          {(["none", "weekly", "biweekly"] as const).map((item) => (
            <label className="check-row" key={item}>
              <input
                type="checkbox"
                checked={value.recurrenceOptions.includes(item)}
                disabled={item === "none"}
                onChange={(event) =>
                  setValue({
                    ...value,
                    recurrenceOptions: toggle(
                      value.recurrenceOptions,
                      item,
                      event.target.checked,
                    ),
                  })
                }
              />
              {item.replaceAll("_", " ")}
            </label>
          ))}
        </fieldset>
        <fieldset className="full option-fieldset">
          <legend>Payment options</legend>
          {(
            [
              "pay_now",
              "pay_later",
              "deposit",
              "credits",
              "installments",
              "subscription",
            ] as const
          ).map((item) => (
            <label className="check-row" key={item}>
              <input
                type="checkbox"
                checked={value.paymentPolicies.includes(item)}
                onChange={(event) =>
                  setValue({
                    ...value,
                    paymentPolicies: toggle(
                      value.paymentPolicies,
                      item,
                      event.target.checked,
                    ),
                  })
                }
              />
              {item.replaceAll("_", " ")}
            </label>
          ))}
        </fieldset>
        <label className="check-row full">
          <input
            type="checkbox"
            checked={value.published}
            onChange={(event) =>
              setValue({ ...value, published: event.target.checked })
            }
          />
          Published in public catalog
        </label>
        <FormActions onClose={onClose} />
      </form>
    </Dialog>
  );
}
function RuleDialog({
  rule,
  onClose,
  onSave,
}: {
  rule: AvailabilityRule;
  onClose: () => void;
  onSave: (value: AvailabilityRule) => void;
}) {
  const [value, setValue] = useState(rule);
  return (
    <Dialog
      title="Weekly availability"
      description="Times are interpreted in the studio timezone and keep their wall time through daylight-saving changes."
      onClose={onClose}
    >
      <form
        className="workflow-form"
        onSubmit={(event) => {
          event.preventDefault();
          onSave(value);
        }}
      >
        <label>
          Day
          <select
            value={value.weekday}
            onChange={(event) =>
              setValue({ ...value, weekday: Number(event.target.value) })
            }
          >
            {[
              "Sunday",
              "Monday",
              "Tuesday",
              "Wednesday",
              "Thursday",
              "Friday",
              "Saturday",
            ].map((name, index) => (
              <option key={name} value={index}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Timezone
          <input value={value.timezone} readOnly />
        </label>
        <label>
          Starts
          <input
            required
            type="time"
            value={value.startsAtLocal}
            onChange={(event) =>
              setValue({ ...value, startsAtLocal: event.target.value })
            }
          />
        </label>
        <label>
          Ends
          <input
            required
            type="time"
            value={value.endsAtLocal}
            onChange={(event) =>
              setValue({ ...value, endsAtLocal: event.target.value })
            }
          />
        </label>
        <FormActions onClose={onClose} />
      </form>
    </Dialog>
  );
}
function ExceptionDialog({
  onClose,
  onSave,
}: {
  onClose: () => void;
  onSave: (value: StudioSnapshot["availabilityExceptions"][number]) => void;
}) {
  const tomorrow = new Date(Date.now() + 86400000);
  const [label, setLabel] = useState("Studio blackout");
  const [start, setStart] = useState(tomorrow.toISOString().slice(0, 16));
  const [end, setEnd] = useState(
    new Date(tomorrow.getTime() + 86400000).toISOString().slice(0, 16),
  );
  return (
    <Dialog title="Add availability exception" onClose={onClose}>
      <form
        className="workflow-form"
        onSubmit={(event) => {
          event.preventDefault();
          onSave({
            id: uid("exception"),
            studioId: "studio-stage-story",
            label,
            startsAt: new Date(start).toISOString(),
            endsAt: new Date(end).toISOString(),
            kind: "unavailable",
            version: 1,
            updatedAt: new Date().toISOString(),
          });
        }}
      >
        <label className="full">
          Label
          <input
            required
            value={label}
            onChange={(event) => setLabel(event.target.value)}
          />
        </label>
        <label>
          Starts
          <input
            required
            type="datetime-local"
            value={start}
            onChange={(event) => setStart(event.target.value)}
          />
        </label>
        <label>
          Ends
          <input
            required
            type="datetime-local"
            min={start}
            value={end}
            onChange={(event) => setEnd(event.target.value)}
          />
        </label>
        <FormActions onClose={onClose} />
      </form>
    </Dialog>
  );
}
function OfferingDialog({
  services,
  onClose,
  onSave,
}: {
  services: BookingService[];
  onClose: () => void;
  onSave: (value: ServiceOffering) => void;
}) {
  const [serviceId, setServiceId] = useState(services[0]?.id ?? "");
  const [title, setTitle] = useState("");
  const [startsAt, setStartsAt] = useState(
    new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 16),
  );
  const [capacity, setCapacity] = useState(8);
  const [description, setDescription] = useState("");
  const [meetingUrl, setMeetingUrl] = useState("");
  const [resourceText, setResourceText] = useState("");
  const selected = services.find((item) => item.id === serviceId);
  const count = selected?.category === "course" ? 6 : 1;
  return (
    <Dialog
      title="Create class or course"
      description="A course creates every canonical occurrence and reserves one student across the full series."
      onClose={onClose}
    >
      <form
        className="workflow-form"
        onSubmit={(event) => {
          event.preventDefault();
          const start = new Date(startsAt);
          onSave({
            id: uid("offering"),
            studioId: selected?.studioId ?? "studio-stage-story",
            serviceId,
            title,
            startsAt: start.toISOString(),
            endsAt: new Date(
              start.getTime() +
                (count - 1) * 7 * 86400000 +
                (selected?.durationMinutes ?? 60) * 60000,
            ).toISOString(),
            enrollmentClosesAt: new Date(
              start.getTime() - 86400000,
            ).toISOString(),
            capacity,
            enrolled: 0,
            lessonIds: Array.from({ length: count }, () => uid("lesson")),
            published: true,
            description,
            meetingUrl: meetingUrl || undefined,
            resourceLinks: resourceText
              .split("\n")
              .map((line) => line.trim())
              .filter(Boolean)
              .map((line) => {
                const [label, ...urlParts] = line.split("|");
                const url = urlParts.join("|").trim() || label.trim();
                return { label: urlParts.length ? label.trim() : "Resource", url };
              }),
            version: 1,
            updatedAt: new Date().toISOString(),
          });
        }}
      >
        <label>
          Service
          <select
            required
            value={serviceId}
            onChange={(event) => setServiceId(event.target.value)}
          >
            {services.map((service) => (
              <option key={service.id} value={service.id}>
                {service.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Capacity
          <input
            type="number"
            min="1"
            value={capacity}
            onChange={(event) => setCapacity(Number(event.target.value))}
          />
        </label>
        <label className="full">
          Offering title
          <input
            required
            value={title}
            onChange={(event) => setTitle(event.target.value)}
          />
        </label>
        <label className="full">
          First occurrence
          <input
            required
            type="datetime-local"
            value={startsAt}
            onChange={(event) => setStartsAt(event.target.value)}
          />
        </label>
        <label className="full">
          Description
          <textarea value={description} onChange={(event) => setDescription(event.target.value)} placeholder="What students should know about this class or course." />
        </label>
        <label className="full">
          Google Meet or class link
          <input type="url" value={meetingUrl} onChange={(event) => setMeetingUrl(event.target.value)} placeholder="https://meet.google.com/…" />
        </label>
        <label className="full">
          Resources
          <textarea value={resourceText} onChange={(event) => setResourceText(event.target.value)} placeholder={"Warm-up | https://…\nScript | https://…"} />
          <small>One resource per line. Use “Label | URL”.</small>
        </label>
        <p className="portal-notice full">
          <CalendarDays />
          {count} occurrence{count === 1 ? "" : "s"} will be created.
        </p>
        <FormActions onClose={onClose} />
      </form>
    </Dialog>
  );
}
function RosterDialog({
  offering,
  data,
  onClose,
  onDelete,
}: {
  offering: ServiceOffering;
  data: StudioSnapshot;
  onClose: () => void;
  onDelete: () => void;
}) {
  const participants = data.lessonParticipants.filter((part) =>
    offering.lessonIds.includes(part.lessonId),
  );
  const unique = [
    ...new Map(participants.map((part) => [part.email, part])).values(),
  ];
  return (
    <Dialog
      title={`${offering.title} roster`}
      description={`${unique.length} of ${offering.capacity} seats reserved.`}
      onClose={onClose}
    >
      <div className="workflow-content">
        {offering.description && <p>{offering.description}</p>}
        {offering.meetingUrl && (
          <a className="button-link" href={offering.meetingUrl} target="_blank" rel="noreferrer">Open Google Meet</a>
        )}
        {!!offering.resourceLinks?.length && (
          <div className="table-list">
            {offering.resourceLinks.map((resource) => (
              <a key={`${resource.label}-${resource.url}`} className="button-link" href={resource.url} target="_blank" rel="noreferrer">{resource.label}</a>
            ))}
          </div>
        )}
        <div className="table-list">
          {unique.map((part) => (
            <article key={part.email}>
              <Users />
              <div>
                <strong>{part.displayName}</strong>
                <small>{part.email}</small>
              </div>
              <Status tone={part.status === "confirmed" ? "good" : "neutral"}>
                {part.status}
              </Status>
            </article>
          ))}
          {!unique.length && (
            <EmptyState
              title="No enrollments yet"
              detail="Confirmed students will appear here."
            />
          )}
        </div>
        <div className="form-actions">
          <button type="button" onClick={onClose}>Close</button>
          <button type="button" className="danger-button" onClick={onDelete} disabled={unique.length > 0}>Delete offering</button>
        </div>
      </div>
    </Dialog>
  );
}
function SeriesDialog({
  series,
  onClose,
  onSave,
}: {
  series: RecurringSeries;
  onClose: () => void;
  onSave: (status: RecurringSeries["status"]) => void;
}) {
  const [status, setStatus] = useState(series.status);
  return (
    <Dialog
      title="Manage recurring series"
      description="Pausing protects existing occurrences. Cancellation ends future unearned occurrences."
      onClose={onClose}
    >
      <form
        className="workflow-form"
        onSubmit={(event) => {
          event.preventDefault();
          onSave(status);
        }}
      >
        <label className="full">
          Series status
          <select
            value={status}
            onChange={(event) =>
              setStatus(event.target.value as RecurringSeries["status"])
            }
          >
            <option value="active">Active</option>
            <option value="paused">Paused</option>
            <option value="cancel_at_period_end">
              Cancel at paid-period end
            </option>
            <option value="cancelled">Cancelled now</option>
          </select>
        </label>
        <FormActions onClose={onClose} />
      </form>
    </Dialog>
  );
}
function BookingDialog({
  booking,
  data,
  onClose,
  onAction,
}: {
  booking: Booking;
  data: StudioSnapshot;
  onClose: () => void;
  onAction: (command: string, payload?: Record<string, unknown>) => void;
}) {
  const [location, setLocation] = useState(
    booking.inPersonLocation ||
      data.settings.meetingFormats.in_person?.location ||
      "",
  );
  return (
    <Dialog
      title={booking.reference}
      description={`${booking.guestName} · ${serviceName(data, booking.serviceId)}`}
      onClose={onClose}
    >
      <div className="workflow-content">
        <dl className="integration-detail">
          <article>
            <div>
              <strong>Schedule</strong>
              <small>
                {new Date(booking.startsAt).toLocaleString()} ·{" "}
                {booking.location.replaceAll("_", " ")}
                {booking.inPersonLocation
                  ? ` · ${booking.inPersonLocation}`
                  : ""}
              </small>
            </div>
            <Status tone={bookingTone(booking.status)}>
              {booking.status.replaceAll("_", " ")}
            </Status>
          </article>
          <article>
            <div>
              <strong>Payment</strong>
              <small>
                {formatMoney(booking.paidMinor, booking.currency)} paid of{" "}
                {formatMoney(booking.totalMinor, booking.currency)}
              </small>
            </div>
            <Status tone={booking.paymentStatus === "paid" ? "good" : "warn"}>
              {booking.paymentStatus.replaceAll("_", " ")}
            </Status>
          </article>
        </dl>
        {booking.location === "in_person" && (
          <label>
            Confirmed lesson location
            <input
              value={location}
              onChange={(event) => setLocation(event.target.value)}
              placeholder="Studio address or meeting place"
            />
            <small>
              Saving updates the lesson and sends a Google Calendar event update
              to the student.
            </small>
          </label>
        )}
        <div className="form-actions">
          {booking.location === "in_person" && (
            <button
              disabled={!location.trim()}
              onClick={() => onAction("confirm_location", { location })}
            >
              Confirm location
            </button>
          )}
          {booking.paidMinor > 0 && booking.paymentStatus !== "refunded" && (
            <button onClick={() => onAction("refund")}>Refund</button>
          )}
          {booking.status === "confirmed" && (
            <button onClick={() => onAction("cancel")}>Cancel</button>
          )}
          <button className="primary" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </Dialog>
  );
}
function FormActions({ onClose }: { onClose: () => void }) {
  return (
    <div className="form-actions">
      <button type="button" onClick={onClose}>
        Cancel
      </button>
      <button className="primary">Save</button>
    </div>
  );
}
function CoachPanel({
  title,
  aside,
  children,
}: {
  title: string;
  aside?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="coach-panel">
      <header>
        <h2>{title}</h2>
        {aside}
      </header>
      {children}
    </section>
  );
}

function toServiceRow(value: BookingService, studioId: string) {
  return {
    studio_id: studioId,
    slug: value.slug,
    name: value.name,
    description: value.description,
    category: value.category,
    duration_minutes: value.durationMinutes,
    price_minor: value.priceMinor,
    deposit_minor: value.depositMinor,
    deposit_type: value.depositType,
    deposit_percentage: value.depositPercentage ?? null,
    balance_due_timing: value.balanceDueTiming,
    balance_due_hours: value.balanceDueHours ?? null,
    auto_charge_balance: value.autoChargeBalance,
    currency: value.currency,
    capacity: value.capacity,
    location_options: value.locationOptions,
    default_location: value.defaultLocation,
    recurrence_options: value.recurrenceOptions,
    payment_policies: value.paymentPolicies,
    buffer_before_minutes: value.bufferBeforeMinutes,
    buffer_after_minutes: value.bufferAfterMinutes,
    buffer_by_location: value.bufferByLocation,
    location_price_adjustments: value.locationPriceAdjustments,
    minimum_notice_hours: value.minimumNoticeHours,
    booking_horizon_days: value.bookingHorizonDays,
    slot_interval_minutes: value.slotIntervalMinutes,
    policy: value.policy,
    policy_version: value.policyVersion,
    published: value.published,
  };
}
function toRuleRow(value: AvailabilityRule, studioId: string) {
  return {
    studio_id: studioId,
    service_id: value.serviceId ?? null,
    weekday: value.weekday,
    starts_at_local: value.startsAtLocal,
    ends_at_local: value.endsAtLocal,
    timezone: value.timezone,
    active: value.active,
  };
}
function createDemoOffering(draft: StudioSnapshot, offering: ServiceOffering) {
  draft.serviceOfferings.push(offering);
  const service = draft.bookingServices.find(
    (item) => item.id === offering.serviceId,
  )!;
  offering.lessonIds.forEach((id, index) => {
    const startsAt = new Date(
      new Date(offering.startsAt).getTime() + index * 7 * 86400000,
    ).toISOString();
    draft.lessons.push({
      id,
      studioId: draft.studioId,
      studentId: "",
      topic: offering.title,
      startsAt,
      endsAt: new Date(
        new Date(startsAt).getTime() + service.durationMinutes * 60000,
      ).toISOString(),
      status: "scheduled",
      locationType:
        service.defaultLocation === "in_person" ? "in_person" : "virtual",
      locationLabel:
        service.defaultLocation === "in_person"
          ? `${draft.settings.studioName} studio`
          : "Google Meet pending",
      serviceId: service.id,
      offeringId: offering.id,
      meetingProvider: service.defaultLocation,
      capacity: offering.capacity,
      version: 1,
      updatedAt: new Date().toISOString(),
    });
  });
}
function createDemoManualBooking(
  draft: StudioSnapshot,
  payload: Record<string, unknown>,
) {
  const service = draft.bookingServices.find(
      (item) => item.id === payload.service_id,
    )!,
    student = draft.students.find((item) => item.id === payload.student_id)!,
    startsAt = String(payload.starts_at),
    endsAt = new Date(
      new Date(startsAt).getTime() + service.durationMinutes * 60000,
    ).toISOString(),
    location = payload.location as MeetingProvider,
    total =
      payload.price_minor == null
        ? service.priceMinor +
          Number(service.locationPriceAdjustments[location] || 0)
        : Number(payload.price_minor),
    bookingId = uid("booking"),
    lessonId = uid("lesson"),
    now = new Date().toISOString();
  draft.bookings.push({
    id: bookingId,
    studioId: draft.studioId,
    reference: `SS-${Math.floor(100000 + Math.random() * 899999)}`,
    serviceId: service.id,
    studentId: student.id,
    guestName: student.fullName,
    guestEmail: student.email || student.guardianEmail || "",
    guardianName: student.guardianName,
    guardianEmail: student.guardianEmail,
    forMinor: student.isMinor,
    startsAt,
    endsAt,
    timezone: student.timezone || draft.settings.timezone,
    location,
    status: "confirmed",
    paymentPolicy: "pay_later",
    paymentStatus: payload.mark_paid ? "paid" : "due",
    totalMinor: total,
    paidMinor: payload.mark_paid ? total : 0,
    currency: service.currency,
    policySnapshot: structuredClone(service.policy),
    adminOverride: { schedule: true },
    rescheduleCount: 0,
    version: 1,
    updatedAt: now,
  });
  draft.lessons.push({
    id: lessonId,
    studioId: draft.studioId,
    studentId: student.id,
    topic: service.name,
    startsAt,
    endsAt,
    status: "scheduled",
    locationType: location === "in_person" ? "in_person" : "virtual",
    locationLabel:
      location === "in_person"
        ? String(payload.location_label || "Location to be confirmed")
        : "Google Meet pending",
    serviceId: service.id,
    meetingProvider: location,
    capacity: 1,
    version: 1,
    updatedAt: now,
  });
  draft.lessonParticipants.push({
    id: uid("participant"),
    lessonId,
    bookingId,
    studentId: student.id,
    displayName: student.fullName,
    email: student.email || student.guardianEmail || "",
    status: "confirmed",
  });
}
function changeDemoBooking(draft: StudioSnapshot, id: string, command: string) {
  const booking = draft.bookings.find((item) => item.id === id)!;
  if (command === "refund") {
    booking.paymentStatus = "refunded";
    if (booking.paidMinor > 0 && booking.studentId)
      draft.payments.push({
        id: uid("refund"),
        studentId: booking.studentId,
        kind: "refund",
        amountMinor: booking.paidMinor,
        currency: booking.currency,
        externalReference: `demo-refund:${booking.id}`,
        reason: `Refund ${booking.reference}`,
        createdAt: new Date().toISOString(),
      });
    booking.version += 1;
    booking.updatedAt = new Date().toISOString();
  }
  if (command === "cancel")
    cancelDemoBooking(draft, booking, { settle: false, late: false });
}
