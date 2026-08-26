import {
  BookOpen,
  CalendarDays,
  CheckSquare,
  CircleDollarSign,
  CreditCard,
  FileText,
  FolderOpen,
  Home,
  Mail,
  Menu,
  MessageSquare,
  Repeat2,
  Settings,
  ShieldCheck,
  Trash2,
  UserRound,
  Video,
} from "lucide-react";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import DOMPurify from "dompurify";
import {
  NavLink,
  Link,
  Navigate,
  Route,
  Routes,
  useNavigate,
  useParams,
} from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import {
  Dialog,
  EmptyState,
  ListControls,
  Section,
  Status,
  Toggle,
  usePagedList,
} from "../../components/Primitives";
import { TimezoneSelect } from "../../components/TimezoneSelect";
import {
  portalBookingCommand,
  studioCommand,
} from "../../data/bookingCommands";
import {
  buildAvailability,
  cancelDemoBooking,
  isLateChange,
} from "../../domain/booking";
import {
  formatMoney,
  packageSummary,
  studentBalanceMinor,
} from "../../domain/finance";
import type { Booking, Role, StudioSnapshot } from "../../domain/model";
import { useStudio } from "../../hooks/useStudio";
import { useStudioStore } from "../../state/StudioStore";
import { uploadStudioFile } from "../../data/uploads";
import { applyStudioBranding } from "../../lib/branding";
import { ActorProfilePreview } from "../../components/ActorProfilePreview";
import { AssignmentActivity } from "../../components/AssignmentActivity";
import {
  isJoinableLesson,
  lessonDateLabel,
  sortAssignments,
  splitLessons,
} from "../../domain/lessonExperience";

const studentTabs = [
  ["", "Home", Home],
  ["work", "Current Work", BookOpen],
  ["bookings", "Schedule", CalendarDays],
  ["payments", "Payments", CircleDollarSign],
  ["actor-page", "Actor Page", UserRound],
  ["settings", "Settings", Settings],
] as const;
const guardianTabs = [
  ["", "Overview", Home],
  ["work", "Current Work", BookOpen],
  ["bookings", "Schedule", CalendarDays],
  ["payments", "Payments", CircleDollarSign],
  ["actor-page", "Actor Page", UserRound],
  ["settings", "Settings", Settings],
] as const;

export function StudentPortal({
  role = "student",
}: {
  role?: Extract<Role, "student" | "guardian">;
}) {
  const studentId = role === "guardian" ? "student-sarah" : "student-maya";
  const { data, isLoading, isDemo } = useStudio(role, studentId);
  const base = "/portal";
  const navigatePortal = useNavigate();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  useEffect(() => {
    if (data?.settings.studioName)
      document.title = `${data.settings.studioName} — ${role === "guardian" ? "Guardian" : "Student"} · Coach’D`;
  }, [data?.settings.studioName, role]);
  useEffect(
    () => applyStudioBranding(data?.settings.branding),
    [data?.settings.branding],
  );
  if (isLoading || !data)
    return <div className="loading">Preparing your workspace…</div>;
  const person = data.students[0];
  const tabs = role === "guardian"
    ? guardianTabs
    : person?.isMinor
      ? studentTabs.filter(([to]) => to !== "payments")
      : studentTabs;
  const studentDisplayName =
    person?.preferredName || person?.fullName || "Student";
  const initials =
    (role === "guardian" ? person?.guardianName : studentDisplayName)
      ?.split(" ")
      .map((part) => part[0])
      .join("")
      .slice(0, 2) || "SS";
  return (
    <div className="student-shell">
      <aside>
        <div className="shell-brand">
          {data.settings.branding?.logoUrl && (
            <img src={data.settings.branding.logoUrl} alt="" />
          )}
          <div className="wordmark">{data.settings.studioName}</div>
        </div>
        <nav>
          {tabs.map(([to, label, Icon]) => (
            <NavLink key={to} to={`${base}/${to}`} end={!to}>
              <Icon />
              <span>{label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="identity">
          <span>{initials}</span>
          <div>
            <strong>
              {role === "guardian"
                ? (person?.guardianName ?? "Guardian")
                : studentDisplayName}
            </strong>
            <small>
              {role === "guardian"
                ? `Guardian for ${person?.fullName ?? "student"}`
                : "Student"}
            </small>
          </div>
        </div>
      </aside>
      <main>
        {isDemo && (
          <div className="demo-banner">
            <ShieldCheck />
            Practice, profile, and studio-work changes are saved on this device.
            Live charges remain in preview until Stripe is connected.
          </div>
        )}
        <Routes>
          <Route
            index
            element={
              role === "guardian" ? (
                <GuardianHome data={data} />
              ) : (
                <StudentHome data={data} base={base} />
              )
            }
          />
          <Route path="work" element={<Work data={data} isDemo={isDemo} />} />
          <Route
            path="bookings"
            element={<StudentBookings data={data} isDemo={isDemo} />}
          />
          <Route
            path="lessons"
            element={<Navigate to={`${base}/bookings`} replace />}
          />
          <Route
            path="lessons/:lessonId"
            element={<LessonHub data={data} isDemo={isDemo} />}
          />
          <Route path="notes" element={<StudentNotes data={data} />} />
          <Route
            path="practice"
            element={<Navigate to={`${base}/work`} replace />}
          />
          <Route
            path="materials"
            element={<Navigate to={`${base}/work`} replace />}
          />
          <Route
            path="payments"
            element={role === "guardian" || !person?.isMinor ? <Payments data={data} isDemo={isDemo} /> : <Navigate to={base} replace />}
          />
          <Route
            path="actor-page"
            element={<ActorPage data={data} isDemo={isDemo} />}
          />
          <Route
            path="settings"
            element={<StudentSettings data={data} isDemo={isDemo} role={role} />}
          />
          <Route path="*" element={<Navigate to={base} replace />} />
        </Routes>
      </main>
      <nav className="mobile-nav student-mobile">
        {tabs.slice(0, 4).map(([to, label, Icon]) => (
          <NavLink key={to} to={`${base}/${to}`} end={!to}>
            <Icon />
            <span>{label}</span>
          </NavLink>
        ))}
        {tabs.length > 4 && (
          <button type="button" onClick={() => setMobileMenuOpen(true)}>
            <Menu />
            <span>More</span>
          </button>
        )}
      </nav>
      {mobileMenuOpen && (
        <div
          className="dialog-backdrop"
          onMouseDown={(event) =>
            event.target === event.currentTarget && setMobileMenuOpen(false)
          }
        >
          <section
            className="command-dialog mobile-workspace-menu"
            role="dialog"
            aria-modal="true"
            aria-label="Student portal menu"
          >
            <header>
              <Menu />
              <strong>Portal menu</strong>
              <button
                type="button"
                aria-label="Close portal menu"
                onClick={() => setMobileMenuOpen(false)}
              >
                ×
              </button>
            </header>
            {tabs.map(([to, label, Icon]) => (
              <button
                type="button"
                key={to}
                onClick={() => {
                  navigatePortal(`${base}${to ? `/${to}` : ""}`);
                  setMobileMenuOpen(false);
                }}
              >
                <Icon />
                <span>{label}</span>
              </button>
            ))}
          </section>
        </div>
      )}
    </div>
  );
}

type Snapshot = StudioSnapshot;
type ActorPortfolioDraft = NonNullable<
  Snapshot["actorProfiles"][number]["draftContent"]
>;
function Header({ data }: { data: Snapshot }) {
  return (
    <header className="student-header">
      <h1>Welcome back, {data.displayName}</h1>
      <p>{data.settings.welcomeMessage}</p>
    </header>
  );
}
function PortalRow({
  icon: Icon,
  title,
  detail,
  action,
  onClick,
}: {
  icon: typeof FileText;
  title: string;
  detail: string;
  action: string;
  onClick: () => void;
}) {
  return (
    <div className="portal-row">
      <Icon />
      <div>
        <strong>{title}</strong>
        <small>{detail}</small>
      </div>
      <button onClick={onClick}>
        {action}
        <span>›</span>
      </button>
    </div>
  );
}
function StudentHome({ data, base }: { data: Snapshot; base: string }) {
  const navigate = useNavigate();
  const lesson = splitLessons(data.lessons).active[0];
  const joinable = splitLessons(data.lessons).active.find((item) =>
    isJoinableLesson(item),
  );
  const work = data.materials
    .filter(
      (item) => item.role === "current_script" && item.status === "active",
    )
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
  const practice = sortAssignments(data.assignments).active[0];
  const material = data.materials.find(
    (item) =>
      item.role !== "current_script" &&
      item.role !== "actor_material" &&
      item.status === "active",
  );
  const pkg = data.packages[0];
  return (
    <div className="student-page">
      <Header data={data} />
      <div className="student-quick-actions">
        {joinable?.joinUrl && (
          <a
            className="join-button"
            href={joinable.joinUrl}
            target="_blank"
            rel="noreferrer"
          >
            <Video />
            Join lesson
          </a>
        )}
        {data.settings.showBookingButton && (
          <a href={data.settings.bookingUrl}>
            <CalendarDays />
            Book a lesson
          </a>
        )}
        {data.settings.showContactButtons && (
          <a href={`mailto:${data.settings.contactEmail}`}>
            <Mail />
            Email coach
          </a>
        )}
        {data.settings.showContactButtons && data.settings.contactPhone && (
          <a href={`sms:${data.settings.contactPhone.replace(/[^+\d]/g, "")}`}>
            <MessageSquare />
            Text coach
          </a>
        )}
        {data.settings.showDriveFolder && data.students[0]?.driveFolderUrl && (
          <a
            href={data.students[0].driveFolderUrl}
            target="_blank"
            rel="noreferrer"
          >
            <FolderOpen />
            Drive folder
          </a>
        )}
      </div>
      <Section title="Continue your work" marked>
        {work ? (
          <PortalRow
            icon={FileText}
            title={work.title}
            detail="Pick up where you left off."
            action="Open script"
            onClick={() =>
              work.externalUrl
                ? window.open(work.externalUrl, "_blank", "noopener,noreferrer")
                : navigate(`${base}/work`)
            }
          />
        ) : (
          <EmptyState
            title="No current work yet"
            detail="Your coach will place your active script here."
          />
        )}
      </Section>
      <Section title="Next lesson">
        {lesson ? (
          <PortalRow
            icon={CalendarDays}
            title={lesson.topic}
            detail={`${lessonDateLabel(lesson)} · ${lesson.locationLabel}`}
            action={isJoinableLesson(lesson) ? "Open lesson" : "View lesson"}
            onClick={() => navigate(`${base}/lessons/${lesson.id}`)}
          />
        ) : (
          <EmptyState
            title="No lesson scheduled"
            detail="Book a service when you are ready."
          />
        )}
      </Section>
      <Section title="Your practice" marked>
        {practice ? (
          <PortalRow
            icon={CheckSquare}
            title={practice.title}
            detail={practice.details}
            action="Open"
            onClick={() => navigate(`${base}/practice`)}
          />
        ) : (
          <EmptyState
            title="Practice is complete"
            detail="New assignments will appear after your coach publishes them."
          />
        )}
      </Section>
      <Section title="Your materials" marked>
        {material ? (
          <PortalRow
            icon={FolderOpen}
            title={material.title}
            detail={material.category}
            action="View"
            onClick={() => navigate(`${base}/materials`)}
          />
        ) : (
          <EmptyState
            title="No shared materials"
            detail="Nothing is missing on your side."
          />
        )}
      </Section>
      {pkg && (
        <Section title="Your package" marked>
          <PortalRow
            icon={CircleDollarSign}
            title={pkg.name}
            detail={`${packageSummary(pkg, data.creditEntries).remainingCredits} sessions remaining`}
            action={formatMoney(
              Math.max(
                0,
                studentBalanceMinor(data.students[0].id, data.payments),
              ),
            )}
            onClick={() => navigate(`${base}/payments`)}
          />
        </Section>
      )}
    </div>
  );
}
function GuardianHome({ data }: { data: Snapshot }) {
  const student = data.students[0];
  return (
    <div className="student-page">
      <Header data={data} />
      <Section
        title={`For ${student?.preferredName || student?.fullName || "your student"}`}
        marked
      >
        <div className="table-list">
          <article>
            <CalendarDays />
            <div>
              <strong>
                {
                  data.bookings.filter((item) => item.status === "confirmed")
                    .length
                }{" "}
                upcoming bookings
              </strong>
              <small>Schedule changes use the accepted booking policy.</small>
            </div>
          </article>
          <article>
            <CircleDollarSign />
            <div>
              <strong>
                {formatMoney(
                  Math.max(
                    0,
                    student
                      ? studentBalanceMinor(student.id, data.payments)
                      : 0,
                  ),
                )}{" "}
                balance
              </strong>
              <small>
                Payments and receipts are visible only to linked guardians.
              </small>
            </div>
          </article>
        </div>
      </Section>
    </div>
  );
}

function Work({ data, isDemo }: { data: Snapshot; isDemo: boolean }) {
  const work = data.materials.filter(
      (item) => item.role === "current_script" && item.status === "active",
    ),
    archived = data.materials
      .filter(
        (item) => item.role === "current_script" && item.status === "archived",
      )
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return (
    <div className="student-page">
      <header className="student-header">
        <h1>Current Work</h1>
        <p>Your active scripts and lesson-connected materials.</p>
      </header>
      <Section title="Active script" marked>
        <div className="table-list">
          {work.map((item) => (
            <article key={item.id} className="current-script-card">
              <header>
                <FileText />
                <div>
                  <strong>{item.title}</strong>
                  <small>{item.category}</small>
                </div>
                <Status tone="good">current</Status>
              </header>
              {item.externalUrl && (
                <details className="material-preview">
                  <summary>Read or view here</summary>
                  {item.mediaKind === "image" ? (
                    <img src={item.externalUrl} alt={item.title} />
                  ) : item.mediaKind === "video" ? (
                    <video src={item.externalUrl} controls />
                  ) : item.mediaKind === "audio" ? (
                    <audio src={item.externalUrl} controls />
                  ) : (
                    <object data={item.externalUrl} title={item.title}>
                      <p>This file cannot be previewed in this browser.</p>
                    </object>
                  )}
                  <a className="button-link" href={item.externalUrl} target="_blank" rel="noreferrer">
                    Open full size
                  </a>
                </details>
              )}
            </article>
          ))}
          {!work.length && (
            <EmptyState
              title="No current script"
              detail="Your coach will place the active material here."
            />
          )}
        </div>
      </Section>
      <Practice data={data} isDemo={isDemo} compact />
      <Materials data={data} isDemo={isDemo} embedded />
      <Section title="Script archive">
        <ListControls
          page={1}
          pageCount={1}
          pageSize={Math.max(10, archived.length)}
          total={archived.length}
          onPage={() => undefined}
          onPageSize={() => undefined}
          label="archived scripts"
        />
        <div className="table-list">
          {archived.map((item) => (
            <article key={item.id}>
              <FileText />
              <div>
                <strong>{item.title}</strong>
                <small>
                  {item.category} · archived{" "}
                  {new Date(item.updatedAt).toLocaleDateString()}
                </small>
              </div>
              {item.externalUrl && (
                <a href={item.externalUrl} target="_blank" rel="noreferrer">
                  Open
                </a>
              )}
            </article>
          ))}
          {!archived.length && (
            <EmptyState
              title="No archived scripts"
              detail="When a new current script is uploaded, the previous one moves here automatically."
            />
          )}
        </div>
      </Section>
    </div>
  );
}

function StudentBookings({
  data,
  isDemo,
}: {
  data: Snapshot;
  isDemo: boolean;
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
            label: new Date(item.startsAt).toLocaleTimeString([], {
              hour: "numeric",
              minute: "2-digit",
            }),
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
        void queryClient.invalidateQueries({ queryKey: ["studio"] });
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
        void queryClient.invalidateQueries({ queryKey: ["studio"] });
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
                    {new Date(lesson.startsAt).toLocaleDateString([], {
                      month: "short",
                    })}
                  </span>
                  <strong>{new Date(lesson.startsAt).getDate()}</strong>
                </div>
                <div>
                  <strong>{itemService?.name || lesson.topic}</strong>
                  <small>
                    {new Date(lesson.startsAt).toLocaleString([], {
                      weekday: "long",
                      hour: "numeric",
                      minute: "2-digit",
                    })}{" "}
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
                        tone={booking.paymentStatus === "paid" ? "good" : "warn"}
                      >
                        {booking.paymentStatus.replaceAll("_", " ")}
                      </Status>
                    ) : (
                      <Status tone="neutral">
                        {(lesson.sourceProvider || "studio").replaceAll("_", " ")}
                      </Status>
                    )}
                  </span>
                </div>
                <div className="student-booking-actions">
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
                  {booking?.status === "confirmed" && (
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
                  {booking && (
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
              {series.status === "active" && (
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
                    {new Date(lesson.startsAt).toLocaleString()} ·{" "}
                    {lesson.locationLabel}
                  </small>
                </div>
                <Status
                  tone={lesson.status === "completed" ? "good" : "neutral"}
                >
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
          description={`${service?.name ?? "Booking"} · ${new Date(selected.startsAt).toLocaleString()}`}
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
                      {new Date(slot.startsAt).toLocaleDateString([], {
                        month: "short",
                        day: "numeric",
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

function StudentNotes({ data }: { data: Snapshot }) {
  const [query, setQuery] = useState(""),
    [selectedLessonId, setSelectedLessonId] = useState<string>();
  const filtered = data.notes
    .filter((note) =>
      [note.title, note.body, note.category, ...(note.tags ?? [])]
        .join(" ")
        .toLowerCase()
        .includes(query.toLowerCase()),
    )
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const groups = Object.values(
    filtered.reduce<
      Record<
        string,
        { lessonId: string; notes: Snapshot["notes"]; updatedAt: string }
      >
    >((result, note) => {
      const key = note.lessonId || `general-${note.id}`;
      const group = result[key] || {
        lessonId: note.lessonId,
        notes: [],
        updatedAt: note.updatedAt,
      };
      group.notes.push(note);
      if (note.updatedAt > group.updatedAt) group.updatedAt = note.updatedAt;
      result[key] = group;
      return result;
    }, {}),
  ).sort((a, b) => {
    const aDate =
      data.lessons.find((item) => item.id === a.lessonId)?.startsAt ||
      a.updatedAt;
    const bDate =
      data.lessons.find((item) => item.id === b.lessonId)?.startsAt ||
      b.updatedAt;
    return bDate.localeCompare(aDate);
  });
  const page = usePagedList(groups);
  const selected = groups.find(
    (group) => group.lessonId === selectedLessonId,
  );
  return (
    <div className="student-page">
      <header className="student-header">
        <h1>Notes</h1>
        <p>Published coaching notes, organized by lesson.</p>
      </header>
      <Section title="Lesson notes" marked>
        <div className="library-toolbar">
          <label>
            <FileText />
            <input
              aria-label="Search notes"
              placeholder="Search your notes…"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
        </div>
        <ListControls
          page={page.page}
          pageCount={page.pageCount}
          pageSize={page.pageSize}
          total={page.total}
          onPage={page.setPage}
          onPageSize={page.setPageSize}
          label="lessons with notes"
        />
        <div className="lesson-note-index">
          {page.visible.map((group) => {
            const lesson = data.lessons.find(
              (item) => item.id === group.lessonId,
            );
            return (
              <button
                type="button"
                key={group.lessonId}
                onClick={() => setSelectedLessonId(group.lessonId)}
              >
                <CalendarDays />
                <span>
                  <strong>
                    {lesson
                      ? new Date(lesson.startsAt).toLocaleDateString()
                      : "General note"}
                  </strong>
                  <small>
                    {lesson?.topic || "General coaching"} · {group.notes.length}{" "}
                    {group.notes.length === 1 ? "note" : "notes"}
                  </small>
                </span>
                <Status tone="good">published</Status>
              </button>
            );
          })}
          {!page.total && (
            <EmptyState
              title="No published notes yet"
              detail="Notes appear here as soon as your coach publishes them."
            />
          )}
        </div>
        {selected && (
          <Dialog
            title={
              data.lessons.find((item) => item.id === selected.lessonId)
                ?.topic || "Coaching notes"
            }
            description={
              selected.lessonId
                ? new Date(
                    data.lessons.find(
                      (item) => item.id === selected.lessonId,
                    )?.startsAt || selected.updatedAt,
                  ).toLocaleString()
                : "General coaching note"
            }
            onClose={() => setSelectedLessonId(undefined)}
          >
            <div className="lesson-note-stack">
              {selected.notes.map((note) => (
                <article key={note.id}>
                  <strong>{note.title}</strong>
                  {note.bodyHtml ? (
                    <div
                      className="published-note-body"
                      dangerouslySetInnerHTML={{
                        __html: DOMPurify.sanitize(note.bodyHtml),
                      }}
                    />
                  ) : (
                    <p>{note.body}</p>
                  )}
                </article>
              ))}
            </div>
            <div className="form-actions">
              {selected.lessonId && (
                <Link
                  className="button-link"
                  to={`/portal/lessons/${selected.lessonId}`}
                >
                  Open lesson workspace
                </Link>
              )}
              <button
                type="button"
                onClick={() => setSelectedLessonId(undefined)}
              >
                Close
              </button>
            </div>
          </Dialog>
        )}
      </Section>
    </div>
  );
}

function LessonHub({ data, isDemo }: { data: Snapshot; isDemo: boolean }) {
  const { lessonId = "" } = useParams();
  const lesson = data.lessons.find((item) => item.id === lessonId);
  const store = useStudioStore();
  const queryClient = useQueryClient();
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [assignmentBusy, setAssignmentBusy] = useState("");
  const [notice, setNotice] = useState("");
  const [delivery, setDelivery] = useState<{
    calendar?: { status: string; lastError?: string };
    email?: { status: string; event_key: string }[];
    correlationId?: string;
  }>();
  useEffect(() => {
    let active = true;
    const load = async () => {
      const { supabase } = await import("../../lib/supabase");
      const token = (await supabase?.auth.getSession())?.data.session?.access_token;
      if (!token) return;
      const response = await fetch(
        `/api/v2/portal/lessons/${encodeURIComponent(lessonId)}/delivery`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      if (response.ok && active) setDelivery(await response.json());
    };
    void load();
    const timer = window.setInterval(() => void load(), 5000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [lessonId]);
  if (!lesson) return <Navigate to="/portal/bookings" replace />;
  const notes = data.notes.filter((item) => item.lessonId === lesson.id);
  const assignments = data.assignments.filter(
    (item) => item.lessonId === lesson.id,
  );
  const materials = data.materials.filter(
    (item) => item.lessonId === lesson.id,
  );
  const messages = data.lessonMessages.filter(
    (item) => item.lessonId === lesson.id,
  );
  const offering = data.serviceOfferings.find(
    (item) => item.id === lesson.offeringId,
  );
  const student =
    data.students.find((item) => item.id === lesson.studentId) ??
    data.students[0];
  const sendMessage = async (event: FormEvent) => {
    event.preventDefault();
    const body = message.trim();
    if (!body || !student || busy) return;
    setBusy(true);
    setNotice("");
    try {
      if (isDemo)
        store.transact((draft) =>
          draft.lessonMessages.push({
            id: `message-${crypto.randomUUID()}`,
            lessonId: lesson.id,
            studentId: student.id,
            authorRole: "student",
            body,
            createdAt: new Date().toISOString(),
          }),
        );
      else {
        await studioCommand("messages", {
          command: "create",
          entityId: lesson.id,
          expectedVersion: 0,
          payload: { studentId: student.id, body },
          reason: "Student sent a lesson message",
        });
        void queryClient.invalidateQueries({ queryKey: ["studio"] });
      }
      setMessage("");
      setNotice("Message sent to your coach.");
    } catch (reason) {
      setNotice(
        reason instanceof Error ? reason.message : "Message could not be sent.",
      );
    } finally {
      setBusy(false);
    }
  };
  const updateAssignment = async (
    assignment: Snapshot["assignments"][number],
    command: "complete" | "help",
  ) => {
    if (assignmentBusy) return;
    setAssignmentBusy(assignment.id);
    try {
      if (isDemo)
        store.transact((draft) => {
          const current = draft.assignments.find(
            (item) => item.id === assignment.id,
          );
          if (!current) return;
          if (command === "complete") current.status = "completed";
          else current.helpRequested = true;
          current.version += 1;
          current.updatedAt = new Date().toISOString();
        });
      else {
        await studioCommand("work", {
          command,
          entityId: assignment.id,
          expectedVersion: assignment.version,
          reason:
            command === "complete"
              ? "Student completed lesson practice"
              : "Student requested help from lesson workspace",
        });
        await queryClient.invalidateQueries({ queryKey: ["studio"] });
      }
      setNotice(
        command === "complete"
          ? "Assignment completed and moved to your archive."
          : "Your coach will see this help request in Today.",
      );
    } catch (reason) {
      setNotice(reason instanceof Error ? reason.message : "Assignment could not be updated.");
    } finally {
      setAssignmentBusy("");
    }
  };
  const saveLessonAssignment = async (
    assignment: Snapshot["assignments"][number],
    responses: Record<string, unknown>,
  ) => {
    if (assignmentBusy) return;
    setAssignmentBusy(assignment.id);
    try {
      if (isDemo)
        store.transact((draft) => {
          const current = draft.assignments.find((item) => item.id === assignment.id);
          if (!current) return;
          current.responses = responses;
          current.status = current.status === "assigned" ? "in_progress" : current.status;
          current.progress = Math.max(current.progress || 0, 25);
          current.version += 1;
          current.updatedAt = new Date().toISOString();
        });
      else {
        await studioCommand("work", {
          command: "save_response",
          entityId: assignment.id,
          expectedVersion: assignment.version,
          payload: { responses, progress: Math.max(assignment.progress || 0, 25) },
          reason: "Student saved lesson assignment progress",
        });
        await queryClient.invalidateQueries({ queryKey: ["studio"] });
      }
      setNotice("Assignment progress saved.");
    } catch (reason) {
      setNotice(reason instanceof Error ? reason.message : "Assignment progress could not be saved.");
      throw reason;
    } finally {
      setAssignmentBusy("");
    }
  };
  return (
    <div className="student-page lesson-hub">
      <header className="student-header lesson-hub-header">
        <div>
          <Link className="text-link" to="/portal/bookings">
            ‹ Back to bookings
          </Link>
          <h1>{lesson.topic}</h1>
          <p>
            {new Date(lesson.startsAt).toLocaleString()} ·{" "}
            {lesson.locationLabel}
          </p>
        </div>
        {lesson.joinUrl && isJoinableLesson(lesson) && (
          <a
            className="button-link primary"
            href={lesson.joinUrl}
            target="_blank"
            rel="noreferrer"
          >
            <Video />
            Join Google Meet
          </a>
        )}
      </header>
      {notice && (
        <p className="portal-notice" role="status">
          {notice}
        </p>
      )}
      {delivery &&
        (delivery.calendar?.status !== "not_required" ||
          Boolean(delivery.email?.length)) && (
          <div className="lesson-delivery-receipt" role="status">
            <ShieldCheck />
            <div>
              <strong>Schedule confirmation</strong>
              <small>
                Calendar: {delivery.calendar?.status?.replaceAll("_", " ") || "not required"}
                {delivery.email?.length
                  ? ` · Email: ${delivery.email[0].status.replaceAll("_", " ")}`
                  : ""}
                {delivery.correlationId ? ` · ${delivery.correlationId}` : ""}
              </small>
            </div>
          </div>
        )}
      {offering && (
        <Section title="Class or course information" marked>
          <p>
            {offering.description ||
              "Your enrollment details and shared class resources live here."}
          </p>
          <div className="student-quick-actions">
            {(offering.meetingUrl || lesson.joinUrl) && (
              <a
                className="button-link primary"
                href={offering.meetingUrl || lesson.joinUrl}
                target="_blank"
                rel="noreferrer"
              >
                <Video />
                Open Google Meet
              </a>
            )}
            {offering.resourceLinks?.map((resource) => (
              <a
                className="button-link"
                key={`${resource.label}-${resource.url}`}
                href={resource.url}
                target="_blank"
                rel="noreferrer"
              >
                <FolderOpen />
                {resource.label}
              </a>
            ))}
          </div>
        </Section>
      )}
      <div className="lesson-hub-grid">
        <Section title="Coach notes" marked>
          <div className="note-cards">
            {notes.map((note) => (
              <article key={note.id}>
                <header>
                  <strong>{note.title}</strong>
                  <Status tone="good">published</Status>
                </header>
                {note.bodyHtml ? (
                  <div
                    className="published-note-body"
                    dangerouslySetInnerHTML={{
                      __html: DOMPurify.sanitize(note.bodyHtml),
                    }}
                  />
                ) : (
                  <p>{note.body}</p>
                )}
              </article>
            ))}
            {!notes.length && (
              <EmptyState
                title="No published note yet"
                detail="Your coach’s lesson note will appear here."
              />
            )}
          </div>
        </Section>
        <Section title="Practice & assignments">
          <div className="table-list">
            {assignments.map((item) => (
              <article key={item.id} className="assignment-card">
                <header>
                  <CheckSquare />
                  <div>
                    <strong>{item.title}</strong>
                    <small>{item.dueAt ? `Due ${new Date(item.dueAt).toLocaleDateString()}` : "Attached to this lesson"}</small>
                  </div>
                  <Status tone={item.status === "completed" ? "good" : "neutral"}>{item.status.replaceAll("_", " ")}</Status>
                </header>
                <AssignmentActivity
                  assignment={item}
                  busy={assignmentBusy === item.id}
                  onSave={(responses) => saveLessonAssignment(item, responses)}
                  onComplete={() => void updateAssignment(item, "complete")}
                  onHelp={() => void updateAssignment(item, "help")}
                />
              </article>
            ))}
            {!assignments.length && (
              <EmptyState
                title="No practice attached"
                detail="Assignments connected to this lesson appear here."
              />
            )}
          </div>
        </Section>
        <Section title="Attachments & resources">
          <div className="table-list">
            {materials.map((item) => (
              <article key={item.id}>
                <FolderOpen />
                <div>
                  <strong>{item.title}</strong>
                  <small>{item.category}</small>
                </div>
                {item.externalUrl && (
                  <a href={item.externalUrl} target="_blank" rel="noreferrer">
                    Open
                  </a>
                )}
              </article>
            ))}
            {!materials.length && (
              <EmptyState
                title="No lesson resources"
                detail="Scripts and files attached to this lesson appear here."
              />
            )}
          </div>
        </Section>
        <Section title="Conversation" marked>
          <div className="lesson-conversation">
            {messages.map((item) => (
              <article
                key={item.id}
                className={
                  item.authorRole === "coach"
                    ? "coach-message"
                    : "student-message"
                }
              >
                <strong>
                  {item.authorRole === "coach"
                    ? data.settings.coachName
                    : student?.preferredName || student?.fullName}
                </strong>
                <p>{item.body}</p>
                <small>{new Date(item.createdAt).toLocaleString()}</small>
              </article>
            ))}
            {!messages.length && (
              <EmptyState
                title="No messages yet"
                detail="Ask a lesson-specific question without losing the context."
              />
            )}
          </div>
          <form className="lesson-message-form" onSubmit={sendMessage}>
            <label htmlFor="lesson-message">Message your coach</label>
            <textarea
              id="lesson-message"
              required
              maxLength={4000}
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              placeholder="Ask about this lesson, assignment, or material…"
            />
            <button className="primary" disabled={busy || !message.trim()}>
              {busy ? "Sending…" : "Send message"}
            </button>
          </form>
        </Section>
      </div>
    </div>
  );
}

function Practice({
  data,
  isDemo,
  compact = false,
}: {
  data: Snapshot;
  isDemo: boolean;
  compact?: boolean;
}) {
  const store = useStudioStore();
  const queryClient = useQueryClient();
  const [notice, setNotice] = useState("");
  const [busyId, setBusyId] = useState("");
  const [showCompleted, setShowCompleted] = useState(false);
  const assignments = sortAssignments(data.assignments);
  const assignmentPage = usePagedList(assignments.active);
  const change = async (id: string, command: "complete" | "help") => {
    if (busyId) return;
    const assignment = data.assignments.find((item) => item.id === id);
    if (!assignment) return;
    setBusyId(id);
    try {
      if (isDemo)
        store.transact((draft) => {
          const item = draft.assignments.find((row) => row.id === id)!;
          if (command === "complete") item.status = "completed";
          else item.helpRequested = true;
          item.version += 1;
          item.updatedAt = new Date().toISOString();
        });
      else {
        await studioCommand("work", {
          command,
          entityId: id,
          expectedVersion: assignment.version,
          reason:
            command === "complete"
              ? "Student completed practice"
              : "Student requested practice help",
        });
        void queryClient.invalidateQueries({ queryKey: ["studio"] });
      }
      setNotice(
        command === "complete"
          ? "Practice marked complete."
          : "Your coach will see the help request.",
      );
    } catch (reason) {
      setNotice(
        reason instanceof Error ? reason.message : "Practice update failed.",
      );
    } finally {
      setBusyId("");
    }
  };
  const saveResponse = async (
    assignment: Snapshot["assignments"][number],
    responses: Record<string, unknown>,
  ) => {
    if (busyId) return;
    setBusyId(assignment.id);
    try {
      if (isDemo)
        store.transact((draft) => {
          const item = draft.assignments.find((row) => row.id === assignment.id)!;
          item.responses = responses;
          item.status = item.status === "assigned" ? "in_progress" : item.status;
          item.progress = Math.max(item.progress || 0, 25);
          item.version += 1;
          item.updatedAt = new Date().toISOString();
        });
      else {
        await studioCommand("work", {
          command: "save_response",
          entityId: assignment.id,
          expectedVersion: assignment.version,
          payload: { responses, progress: Math.max(assignment.progress || 0, 25) },
          reason: "Student saved assignment progress",
        });
        await queryClient.invalidateQueries({ queryKey: ["studio"] });
      }
      setNotice("Progress saved.");
    } catch (reason) {
      setNotice(reason instanceof Error ? reason.message : "Progress could not be saved.");
      throw reason;
    } finally {
      setBusyId("");
    }
  };
  return (
    <div className={compact ? "current-work-practice" : "student-page"}>
      {!compact && (
        <header className="student-header">
          <h1>Practice</h1>
          <p>Published assignments you can complete or ask about.</p>
        </header>
      )}
      {notice && <p className="portal-notice">{notice}</p>}
      <Section title="Next practice" marked>
        <ListControls
          page={assignmentPage.page}
          pageCount={assignmentPage.pageCount}
          pageSize={assignmentPage.pageSize}
          total={assignmentPage.total}
          onPage={assignmentPage.setPage}
          onPageSize={assignmentPage.setPageSize}
          label="active assignments"
        />
        <div className="table-list">
          {assignmentPage.visible.map((item) => (
            <article key={item.id} className="assignment-card">
              <header>
                <CheckSquare />
                <div>
                  <strong>{item.title}</strong>
                  <small>
                    {item.dueAt ? `Due ${new Date(item.dueAt).toLocaleString()}` : "No due date"}
                    {item.lessonId && ` · ${data.lessons.find((lesson) => lesson.id === item.lessonId)?.topic || "Lesson"}`}
                  </small>
                </div>
                <Status tone="neutral">{(item.activityType || "instruction").replaceAll("_", " ")}</Status>
              </header>
              <AssignmentActivity
                assignment={item}
                busy={busyId === item.id}
                onSave={(responses) => saveResponse(item, responses)}
                onComplete={() => void change(item.id, "complete")}
                onHelp={() => void change(item.id, "help")}
              />
            </article>
          ))}
          {!assignmentPage.total && (
            <EmptyState
              title="You’re caught up"
              detail="Completed work moves to the archive so the next useful assignment stays clear."
            />
          )}
        </div>
        {assignments.completed.length > 0 && (
          <div className="completed-work-archive">
            <button
              type="button"
              onClick={() => setShowCompleted((value) => !value)}
            >
              {showCompleted ? "Hide" : "Show"} completed work ({assignments.completed.length})
            </button>
            {showCompleted && (
              <div className="table-list">
                {assignments.completed.map((item) => (
                  <article key={item.id}>
                    <CheckSquare />
                    <div>
                      <strong>{item.title}</strong>
                      <small>Completed {new Date(item.updatedAt).toLocaleDateString()}</small>
                    </div>
                    <Status tone="good">completed</Status>
                  </article>
                ))}
              </div>
            )}
          </div>
        )}
      </Section>
    </div>
  );
}
function Materials({
  data,
  isDemo,
  embedded = false,
  actorOnly = false,
}: {
  data: Snapshot;
  isDemo: boolean;
  embedded?: boolean;
  actorOnly?: boolean;
}) {
  const store = useStudioStore(),
    queryClient = useQueryClient(),
    [adding, setAdding] = useState(false),
    [busyId, setBusyId] = useState(""),
    [notice, setNotice] = useState("");
  const materialPage = usePagedList(
    actorOnly
      ? data.materials.filter((item) => item.role === "actor_material")
      : embedded
        ? data.materials.filter(
            (item) =>
              item.role === "lesson_material" || item.role === "library",
          )
        : data.materials.filter((item) => item.role !== "actor_material"),
  );
  const add = async (
    title: string,
    category: string,
    url: string,
    role: "current_script" | "actor_material" | "lesson_material" | "library",
    lessonId?: string,
    file?: File,
  ) => {
    const studentId = data.students[0]?.id;
    if (!studentId) return;
    try {
      if (isDemo)
        store.transact((draft) => {
          if (role === "current_script")
            draft.materials
              .filter(
                (item) =>
                  item.studentId === studentId &&
                  item.role === "current_script" &&
                  item.status === "active",
              )
              .forEach((item) => {
                item.status = "archived";
              });
          draft.materials.push({
            id: `material-${crypto.randomUUID()}`,
            studentId,
            title,
            category,
            externalUrl: url,
            role,
            lessonId: role === "lesson_material" ? lessonId : undefined,
            status: "active",
            approvalStatus:
              role === "actor_material" ? "pending_review" : "not_public",
            version: 1,
            updatedAt: new Date().toISOString(),
          });
        });
      else {
        let storage: Awaited<ReturnType<typeof uploadStudioFile>> | undefined;
        if (file)
          storage = await uploadStudioFile({
            studioId: data.studioId,
            studentId,
            entityType: "material",
            file,
            visibility: "student",
          });
        await studioCommand("materials", {
          command: "create",
          expectedVersion: 0,
          payload: {
            studentId,
            title,
            category,
            externalUrl: url || undefined,
            storagePath: storage?.storagePath,
            mimeType: storage?.mimeType,
            fileSizeBytes: storage?.fileSizeBytes,
            mediaKind: storage?.mimeType.startsWith("image/")
              ? "image"
              : storage?.mimeType.startsWith("video/")
                ? "video"
                : storage?.mimeType.startsWith("audio/")
                  ? "audio"
                  : storage
                    ? "document"
                    : "link",
            role,
            publicEmbed: false,
          },
          reason:
            role === "actor_material"
              ? "Student submitted actor material"
              : "Student added current work material",
        });
      }
      void queryClient.invalidateQueries({ queryKey: ["studio"] });
      setAdding(false);
      setNotice(
        role === "current_script"
          ? "Current script updated. The previous script is now in your archive."
          : "Material submitted to your coach for review.",
      );
    } catch (reason) {
      setNotice(
        reason instanceof Error ? reason.message : "Material upload failed.",
      );
    }
  };
  const updateStatus = async (material: Snapshot["materials"][number]) => {
    if (busyId) return;
    setBusyId(material.id);
    try {
      const status = material.status === "active" ? "archived" : "active";
      if (isDemo)
        store.transact((draft) => {
          const current = draft.materials.find(
            (item) => item.id === material.id,
          );
          if (current) {
            current.status = status;
            current.version += 1;
          }
        });
      else
        await studioCommand("materials", {
          command: "update_status",
          entityId: material.id,
          expectedVersion: material.version,
          payload: { status },
          reason: "Student updated material status",
        });
      await queryClient.invalidateQueries({ queryKey: ["studio"] });
      setNotice(
        status === "archived"
          ? "Material moved to your archive."
          : "Material restored.",
      );
    } catch (reason) {
      setNotice(
        reason instanceof Error
          ? reason.message
          : "Material could not be updated.",
      );
    } finally {
      setBusyId("");
    }
  };
  const remove = async (material: Snapshot["materials"][number]) => {
    if (
      busyId ||
      !window.confirm(
        `Permanently delete “${material.title}”? The uploaded file will also be removed.`,
      )
    )
      return;
    setBusyId(material.id);
    try {
      if (isDemo)
        store.transact((draft) => {
          draft.materials = draft.materials.filter(
            (item) => item.id !== material.id,
          );
        });
      else
        await studioCommand("materials", {
          command: "delete",
          entityId: material.id,
          expectedVersion: material.version,
          reason: "Student permanently deleted own material",
        });
      await queryClient.invalidateQueries({ queryKey: ["studio"] });
      setNotice("Material and uploaded file deleted.");
    } catch (reason) {
      setNotice(
        reason instanceof Error
          ? reason.message
          : "Material could not be deleted.",
      );
    } finally {
      setBusyId("");
    }
  };
  return (
    <div className={embedded ? "embedded-materials" : "student-page"}>
      {!embedded && (
        <header className="student-header">
          <h1>Materials</h1>
          <p>Shared studio materials and actor-page submissions.</p>
        </header>
      )}
      {notice && (
        <p className="portal-notice" role="status">
          {notice}
        </p>
      )}
      <Section
        title={actorOnly ? "Actor-page media" : "Your materials"}
        marked
        aside={<button onClick={() => setAdding(true)}>Submit material</button>}
      >
        <ListControls
          page={materialPage.page}
          pageCount={materialPage.pageCount}
          pageSize={materialPage.pageSize}
          total={materialPage.total}
          onPage={materialPage.setPage}
          onPageSize={materialPage.setPageSize}
          label="materials"
        />
        <div className="table-list">
          {materialPage.visible.map((item) => (
            <article key={item.id}>
              <FolderOpen />
              <div>
                <strong>{item.title}</strong>
                <small>
                  {item.category}
                  {item.approvalStatus !== "not_public"
                    ? ` · public page ${item.approvalStatus.replaceAll("_", " ")}`
                    : ""}
                </small>
              </div>
              <Status
                tone={
                  item.approvalStatus === "approved"
                    ? "good"
                    : item.approvalStatus === "pending_review"
                      ? "warn"
                      : "neutral"
                }
              >
                {item.status}
              </Status>
              {item.externalUrl && (
                <a href={item.externalUrl} target="_blank" rel="noreferrer">
                  Open
                </a>
              )}
              <button
                type="button"
                disabled={busyId === item.id}
                onClick={() => void updateStatus(item)}
              >
                {item.status === "active" ? "Archive" : "Restore"}
              </button>
              <button
                type="button"
                className="danger-button"
                disabled={busyId === item.id}
                onClick={() => void remove(item)}
              >
                <Trash2 />
                Delete
              </button>
            </article>
          ))}
        </div>
      </Section>
      {adding && (
        <MaterialSubmission
          onClose={() => setAdding(false)}
          onSave={add}
          lessons={data.lessons}
          fixedRole={actorOnly ? "actor_material" : undefined}
        />
      )}
    </div>
  );
}
function MaterialSubmission({
  onClose,
  onSave,
  fixedRole,
  lessons,
}: {
  onClose: () => void;
  onSave: (
    title: string,
    category: string,
    url: string,
    role: "current_script" | "actor_material" | "lesson_material" | "library",
    lessonId?: string,
    file?: File,
  ) => void;
  fixedRole?: "actor_material";
  lessons: Snapshot["lessons"];
}) {
  const [title, setTitle] = useState(""),
    [category, setCategory] = useState("Reel"),
    [url, setUrl] = useState(""),
    [role, setRole] = useState<
      "current_script" | "actor_material" | "lesson_material" | "library"
    >(fixedRole || "current_script"),
    [lessonId, setLessonId] = useState(""),
    [file, setFile] = useState<File>();
  return (
    <Dialog
      title="Submit material"
      description="Your coach reviews material before it can appear publicly."
      onClose={onClose}
    >
      <form
        className="workflow-form"
        onSubmit={(event) => {
          event.preventDefault();
          onSave(title, category, url, role, lessonId || undefined, file);
        }}
      >
        <label>
          Title
          <input
            required
            value={title}
            onChange={(event) => setTitle(event.target.value)}
          />
        </label>
        <label>
          Category
          <select
            value={category}
            onChange={(event) => setCategory(event.target.value)}
          >
            <option>Reel</option>
            <option>Headshot</option>
            <option>Gallery photo</option>
            <option>Resume</option>
            <option>Performance clip</option>
          </select>
        </label>
        {!fixedRole && (
          <label>
            Use in portal
            <select
              value={role}
              onChange={(event) => setRole(event.target.value as typeof role)}
            >
              <option value="current_script">Current script</option>
              <option value="lesson_material">Lesson material</option>
              <option value="library">Private material library</option>
              <option value="actor_material">Actor-page submission</option>
            </select>
          </label>
        )}
        {role === "lesson_material" && (
          <label className="full">
            Related lesson
            <select
              required
              value={lessonId}
              onChange={(event) => setLessonId(event.target.value)}
            >
              <option value="" disabled>Select a lesson</option>
              {[...lessons]
                .sort((a, b) => b.startsAt.localeCompare(a.startsAt))
                .map((lesson) => (
                  <option key={lesson.id} value={lesson.id}>
                    {lessonDateLabel(lesson)} · {lesson.topic}
                  </option>
                ))}
            </select>
          </label>
        )}
        <label className="full">
          Share link
          <input
            aria-label="Share link"
            type="url"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            placeholder="https://…"
          />
          <small>
            Use a public YouTube/Vimeo link, or upload the actual file below.
          </small>
        </label>
        <label className="full material-upload">
          Upload file
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp,video/mp4,audio/mpeg,audio/mp4,application/pdf"
            onChange={(event) => setFile(event.target.files?.[0])}
          />
          <small>
            Files stay private to your studio. Only actor-page submissions enter
            public-page review.
          </small>
        </label>
        <div className="form-actions full">
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button
            className="primary"
            disabled={(!url && !file) || (role === "lesson_material" && !lessonId)}
          >
            {role === "current_script"
              ? "Set as current script"
              : role === "actor_material"
                ? "Submit for review"
                : "Upload material"}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
function Payments({ data, isDemo }: { data: Snapshot; isDemo: boolean }) {
  const student = data.students[0];
  const [notice, setNotice] = useState("");
  const [packageBusy, setPackageBusy] = useState("");
  const store = useStudioStore();
  const queryClient = useQueryClient();
  const purchase = async (id: string) => {
    if (isDemo) {
      setNotice("Demo mode does not open a real checkout.");
      return;
    }
    try {
      const result = await studioCommand("finance", {
        command: "checkout_definition",
        expectedVersion: 0,
        payload: { packageDefinitionId: id },
        reason: "Student started package checkout",
      });
      window.location.assign(result.resource.url);
    } catch (reason) {
      setNotice(
        reason instanceof Error
          ? reason.message
          : "Checkout could not be opened.",
      );
    }
  };
  const toggleAutoApply = async (pkg: Snapshot["packages"][number]) => {
    if (packageBusy) return;
    setPackageBusy(pkg.id);
    try {
      if (isDemo)
        store.transact((draft) => {
          const current = draft.packages.find((item) => item.id === pkg.id);
          if (!current) return;
          current.autoApply = !pkg.autoApply;
          current.version += 1;
          current.updatedAt = new Date().toISOString();
        });
      else {
        const result = await studioCommand("packages", {
          command: "toggle_auto_apply",
          entityId: pkg.id,
          expectedVersion: pkg.version,
          payload: { enabled: !pkg.autoApply },
          reason: "Student changed automatic credit preference",
        });
        await queryClient.invalidateQueries({ queryKey: ["studio"] });
        setNotice(
          !pkg.autoApply
            ? `Automatic credits enabled${result.resource.applied ? `; ${result.resource.applied} upcoming lesson${result.resource.applied === 1 ? "" : "s"} updated` : ""}.`
            : "Automatic credits disabled. Existing lesson allocations are unchanged.",
        );
      }
    } catch (reason) {
      setNotice(
        reason instanceof Error
          ? reason.message
          : "The package preference could not be saved.",
      );
    } finally {
      setPackageBusy("");
    }
  };
  return (
    <div className="student-page">
      <header className="student-header">
        <h1>Payments</h1>
        <p>
          Packages, credits, receipts, refunds, and balances from the immutable
          ledger.
        </p>
      </header>
      {notice && (
        <p className="portal-notice" role="status">
          {notice}
        </p>
      )}
      {data.packageDefinitions.some(
        (item) =>
          item.active && item.visibility === "public" && item.directPurchase,
      ) && (
        <Section title="Available packages" marked>
          <div className="table-list">
            {data.packageDefinitions
              .filter(
                (item) =>
                  item.active &&
                  item.visibility === "public" &&
                  item.directPurchase,
              )
              .map((definition) => (
                <article key={definition.id}>
                  <CircleDollarSign />
                  <div>
                    <strong>{definition.name}</strong>
                    <small>
                      {definition.sessionCount} sessions ·{" "}
                      {definition.sessionDurationMinutes} minutes each ·{" "}
                      {formatMoney(definition.priceMinor, definition.currency)}
                    </small>
                  </div>
                  <button onClick={() => void purchase(definition.id)}>
                    Buy package
                  </button>
                </article>
              ))}
          </div>
        </Section>
      )}
      <Section title="Packages" marked>
        <div className="table-list">
          {data.packages.map((pkg) => {
            const expired = Boolean(
              pkg.expiresAt && new Date(pkg.expiresAt) <= new Date(),
            );
            return <article key={pkg.id}>
              <CircleDollarSign />
              <div>
                <strong>{pkg.name}</strong>
                <small>
                  {packageSummary(pkg, data.creditEntries).remainingCredits}{" "}
                  credits · {formatMoney(pkg.priceMinor, pkg.currency)}
                  {pkg.expiresAt &&
                    ` · ${expired ? "expired" : "expires"} ${new Date(pkg.expiresAt).toLocaleDateString()}`}
                </small>
              </div>
              <Status tone={expired ? "danger" : "good"}>
                {expired ? "expired" : "active"}
              </Status>
              {!expired && packageSummary(pkg, data.creditEntries).remainingCredits > 0 && (
                <Toggle
                  checked={Boolean(pkg.autoApply)}
                  label="Auto-apply"
                  detail="Use this package for eligible upcoming lessons."
                  onChange={() => void toggleAutoApply(pkg)}
                />
              )}
            </article>;
          })}
        </div>
      </Section>
      <Section title="Receipts & adjustments">
        <div className="table-list">
          {data.payments.map((entry) => (
            <article key={entry.id}>
              <FileText />
              <div>
                <strong>{entry.reason}</strong>
                <small>
                  {new Date(entry.createdAt).toLocaleDateString()} ·{" "}
                  {entry.externalReference ?? "Studio ledger"}
                </small>
              </div>
              <strong>
                {entry.kind === "refund" ? "+" : "−"}
                {formatMoney(entry.amountMinor, entry.currency)}
              </strong>
            </article>
          ))}
        </div>
      </Section>
      {student && (
        <p className="portal-notice">
          Current balance:{" "}
          {formatMoney(
            Math.max(0, studentBalanceMinor(student.id, data.payments)),
          )}
        </p>
      )}
    </div>
  );
}
function StudentSettings({
  data,
  isDemo,
  role,
}: {
  data: Snapshot;
  isDemo: boolean;
  role: Extract<Role, "student" | "guardian">;
}) {
  const student = data.students[0],
    store = useStudioStore(),
    queryClient = useQueryClient();
  const [form, setForm] = useState({
      preferredName: student?.preferredName || "",
      pronouns: student?.pronouns || "",
      email: student?.email || "",
      phone: student?.phone || "",
      timezone: student?.timezone || data.settings.timezone,
      compactView:
        student?.portalPreferences?.compactView ??
        data.settings.portalDefaults.compactView,
      showProgress:
        student?.portalPreferences?.showProgress ??
        data.settings.portalDefaults.showProgress,
      emailReminders: student?.portalPreferences?.emailReminders ?? true,
    }),
    [notice, setNotice] = useState(""),
    [saving, setSaving] = useState(false),
    [loginPassword, setLoginPassword] = useState(""),
    [loginBusy, setLoginBusy] = useState(false),
    [stripeBusy, setStripeBusy] = useState<"payment-method" | "billing" | "">(
      "",
    );
  if (!student) return <div className="loading">Opening settings…</div>;
  const save = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    try {
      const updates = {
        preferredName: form.preferredName,
        pronouns: form.pronouns,
        email: form.email,
        phone: form.phone,
        timezone: form.timezone,
        portalPreferences: {
          compactView: form.compactView,
          showProgress: form.showProgress,
          emailReminders: form.emailReminders,
        },
      };
      if (isDemo)
        store.transact((draft) =>
          Object.assign(draft.students[0], updates, {
            version: student.version + 1,
            updatedAt: new Date().toISOString(),
          }),
        );
      else {
        await studioCommand("students", {
          command: "update_self",
          entityId: student.id,
          expectedVersion: student.version,
          payload: updates,
          reason: "Student updated portal settings",
        });
        void queryClient.invalidateQueries({ queryKey: ["studio"] });
      }
      setNotice("Your settings were saved.");
    } catch (reason) {
      setNotice(
        reason instanceof Error
          ? reason.message
          : "Settings could not be saved.",
      );
    } finally {
      setSaving(false);
    }
  };
  const stripeAction = async (action: "payment-method" | "billing") => {
    if (stripeBusy) return;
    setStripeBusy(action);
    setNotice(
      action === "payment-method"
        ? "Opening Stripe’s secure card setup…"
        : "Opening secure billing…",
    );
    try {
      const { supabase } = await import("../../lib/supabase"),
        token = (await supabase?.auth.getSession())?.data.session?.access_token,
        response = await fetch(`/api/v2/portal/bookings/${action}`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token || ""}`,
            "Idempotency-Key": crypto.randomUUID(),
          },
          body: JSON.stringify({ studentId: student.id }),
        }),
        result = await response.json();
      if (!response.ok) throw new Error(result.message);
      window.location.assign(result.url);
    } catch (reason) {
      setNotice(
        reason instanceof Error
          ? reason.message
          : "Stripe could not be opened.",
      );
      setStripeBusy("");
    }
  };
  const saveLogin = async (event: FormEvent) => {
    event.preventDefault();
    if (loginBusy) return;
    setLoginBusy(true);
    setNotice("Updating your secure login…");
    try {
      if (isDemo) {
        store.transact((draft) => {
          draft.students[0].version += 1;
        });
      } else {
        const { supabase } = await import("../../lib/supabase");
        if (!supabase) throw new Error("Secure login is unavailable.");
        if (loginPassword) {
          if (
            loginPassword.length < 12 ||
            !/[a-z]/.test(loginPassword) ||
            !/[A-Z]/.test(loginPassword) ||
            !/\d/.test(loginPassword) ||
            !/[^A-Za-z0-9]/.test(loginPassword)
          )
            throw new Error(
              "Password must be 12+ characters with upper/lowercase letters, a number, and a symbol.",
            );
          const { error } = await supabase.auth.updateUser({
            password: loginPassword,
          });
          if (error) throw error;
        }
        void queryClient.invalidateQueries({ queryKey: ["studio"] });
      }
      setLoginPassword("");
      setNotice("Your private password was updated.");
    } catch (reason) {
      setNotice(
        reason instanceof Error
          ? reason.message
          : "Login settings could not be saved.",
      );
    } finally {
      setLoginBusy(false);
    }
  };
  return (
    <div className="student-page">
      <header className="student-header">
        <h1>Settings</h1>
        <p>Contact details, payment methods, and your portal experience.</p>
      </header>
      {notice && (
        <p className="portal-notice" role="status">
          {notice}
        </p>
      )}
      <Section title="Contact & portal" marked>
        <form className="settings-form" onSubmit={save}>
          <label>
            Preferred name
            <input
              value={form.preferredName}
              onChange={(event) =>
                setForm({ ...form, preferredName: event.target.value })
              }
            />
          </label>
          <label>
            Pronouns
            <input
              value={form.pronouns}
              onChange={(event) =>
                setForm({ ...form, pronouns: event.target.value })
              }
            />
          </label>
          <label>
            Email
            <input
              required
              type="email"
              value={form.email}
              onChange={(event) =>
                setForm({ ...form, email: event.target.value })
              }
            />
          </label>
          <label>
            Phone
            <input
              value={form.phone}
              onChange={(event) =>
                setForm({ ...form, phone: event.target.value })
              }
            />
          </label>
          <label>
            Timezone
            <TimezoneSelect
              value={form.timezone}
              onChange={(timezone) => setForm({ ...form, timezone })}
            />
          </label>
          <div className="settings-list full">
            <Toggle
              checked={form.compactView}
              label="Compact view"
              detail="Fit more work on each screen."
              onChange={(compactView) => setForm({ ...form, compactView })}
            />
            <Toggle
              checked={form.showProgress}
              label="Show progress"
              detail="Include practice progress in your workspace."
              onChange={(showProgress) => setForm({ ...form, showProgress })}
            />
            <Toggle
              checked={form.emailReminders}
              label="Email reminders"
              detail="Receive the lesson reminders configured by the studio."
              onChange={(emailReminders) =>
                setForm({ ...form, emailReminders })
              }
            />
          </div>
          <div className="form-actions full">
            <button className="primary" disabled={saving}>
              {saving ? "Saving…" : "Save settings"}
            </button>
          </div>
        </form>
      </Section>
      <Section title="Password & security">
        <form className="settings-form" onSubmit={saveLogin}>
          <label>
            New password
            <input
              type="password"
              minLength={12}
              autoComplete="new-password"
              required
              value={loginPassword}
              onChange={(event) => setLoginPassword(event.target.value)}
            />
            <small>
              Use 12+ characters with upper/lowercase letters, a number, and a
              symbol.
            </small>
          </label>
          <div className="form-actions full">
            <button className="primary" disabled={loginBusy}>
              {loginBusy ? "Saving login…" : "Save login"}
            </button>
          </div>
        </form>
      </Section>
      {(role === "guardian" || !student.isMinor) && <Section title="Payment method">
        <div className="data-summary">
          <CreditCard />
          <div>
            <strong>
              {student.paymentMethodSummary || "No saved payment method"}
            </strong>
            <small>
              Card details are stored by Stripe, never by this studio portal.
            </small>
          </div>
        </div>
        <div className="form-actions">
          <button
            disabled={Boolean(stripeBusy)}
            onClick={() => void stripeAction("payment-method")}
          >
            {stripeBusy === "payment-method"
              ? "Opening Stripe…"
              : student.stripeCustomerId
                ? "Add another payment method"
                : "Add payment method"}
          </button>
          {student.stripeCustomerId && (
            <button
              disabled={Boolean(stripeBusy)}
              onClick={() => void stripeAction("billing")}
            >
              {stripeBusy === "billing" ? "Opening…" : "Manage billing"}
            </button>
          )}
        </div>
      </Section>}
    </div>
  );
}

function ActorPage({ data, isDemo }: { data: Snapshot; isDemo: boolean }) {
  const store = useStudioStore();
  const queryClient = useQueryClient();
  const profile = data.actorProfiles[0];
  const [editing, setEditing] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [notice, setNotice] = useState("");
  if (!profile)
    return (
      <PortalList
        title="Actor Page"
        description="Create and submit a profile for coach review."
        items={[]}
      />
    );
  const save = async (
    displayName: string,
    bio: string,
    portfolio: ActorPortfolioDraft,
    submit: boolean,
  ) => {
    try {
      if (isDemo)
        store.transact((draft) => {
          const item = draft.actorProfiles.find(
            (row) => row.id === profile.id,
          )!;
          item.displayName = displayName;
          item.bio = bio;
          item.draftContent = portfolio;
          item.status = submit ? "review_requested" : "draft";
          item.version += 1;
          item.updatedAt = new Date().toISOString();
        });
      else {
        await studioCommand("actor-pages", {
          command: "save",
          entityId: profile.id,
          expectedVersion: profile.version,
          reason: submit
            ? "Student submitted actor profile"
            : "Student saved actor profile",
          payload: {
            displayName,
            bio,
            portfolio,
            status: submit ? "review_requested" : "draft",
          },
        });
        void queryClient.invalidateQueries({ queryKey: ["studio"] });
      }
      setEditing(false);
      setNotice(
        submit
          ? "Actor page submitted for coach review."
          : "Actor page draft saved.",
      );
    } catch (reason) {
      setNotice(
        reason instanceof Error ? reason.message : "Actor page save failed.",
      );
    }
  };
  return (
    <div className="student-page">
      <header className="student-header">
        <h1>Actor Page</h1>
        <p>Edit a draft and submit it for coach review before publishing.</p>
      </header>
      {notice && <p className="portal-notice">{notice}</p>}
      <Section title="Profile" marked>
        <div className="table-list">
          <article>
            <UserRound />
            <div>
              <strong>{profile.displayName}</strong>
              <small>
                /actors/{profile.slug} · {profile.bio}
              </small>
            </div>
            <Status tone={profile.status === "published" ? "good" : "warn"}>
              {profile.status.replaceAll("_", " ")}
            </Status>
            <button onClick={() => setEditing(true)}>Edit</button>
            <button onClick={() => setPreviewing(true)}>Preview draft</button>
            {profile.status === "published" && (
              <a
                className="button-link"
                href={`/actors/${profile.slug}`}
                target="_blank"
                rel="noreferrer"
              >
                View live page
              </a>
            )}
          </article>
        </div>
      </Section>
      <p className="section-intro">
        Actor-page uploads live here—not in Current Work. Your coach reviews
        each headshot, gallery image, reel, performance clip, and PDF résumé
        before it appears publicly.
      </p>
      <Materials data={data} isDemo={isDemo} embedded actorOnly />
      {previewing && (
        <Dialog
          title="Private actor-page preview"
          description="Preview the current draft before sending it for review."
          onClose={() => setPreviewing(false)}
        >
          <ActorProfilePreview
            profile={profile}
            materials={data.materials.filter((item) => item.role === "actor_material")}
            studioName={data.settings.studioName}
            logoUrl={data.settings.branding.logoUrl}
          />
        </Dialog>
      )}
      {editing && (
        <ActorDialog
          profile={profile}
          onClose={() => setEditing(false)}
          onSave={(displayName, bio, portfolio, submit) =>
            void save(displayName, bio, portfolio, submit)
          }
          materials={data.materials.filter(
            (item) =>
              item.role === "actor_material" && item.mediaKind === "image",
          )}
        />
      )}
    </div>
  );
}
function ActorDialog({
  profile,
  onClose,
  onSave,
  materials,
}: {
  profile: Snapshot["actorProfiles"][number];
  onClose: () => void;
  onSave: (
    name: string,
    bio: string,
    portfolio: ActorPortfolioDraft,
    submit: boolean,
  ) => void;
  materials: Snapshot["materials"];
}) {
  const [name, setName] = useState(profile.displayName);
  const [bio, setBio] = useState(profile.bio);
  const [portfolio, setPortfolio] = useState({
    headline: profile.draftContent?.headline || "",
    unionStatus: profile.draftContent?.unionStatus || "Non-union",
    location: profile.draftContent?.location || "",
    playingAge: profile.draftContent?.playingAge || "",
    height: profile.draftContent?.height || "",
    eyeColor: profile.draftContent?.eyeColor || "",
    hairColor: profile.draftContent?.hairColor || "",
    website: profile.draftContent?.website || "",
    representation: profile.draftContent?.representation || "",
    accentColor: profile.draftContent?.accentColor || "#c46b56",
    contactEmail: profile.draftContent?.contactEmail || "",
    contactPhone: profile.draftContent?.contactPhone || "",
    showEmail: Boolean(profile.draftContent?.showEmail),
    showPhone: Boolean(profile.draftContent?.showPhone),
    primaryHeadshotMaterialId:
      profile.draftContent?.primaryHeadshotMaterialId || "",
  });
  const [submit, setSubmit] = useState(false);
  const save = (event: FormEvent) => {
    event.preventDefault();
    onSave(name, bio, portfolio, submit);
  };
  return (
    <Dialog title="Edit actor profile" onClose={onClose}>
      <form className="workflow-form" onSubmit={save}>
        <label className="full">
          Display name
          <input
            required
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <label className="full">
          Professional headline
          <input
            value={portfolio.headline}
            onChange={(event) =>
              setPortfolio({ ...portfolio, headline: event.target.value })
            }
            placeholder="Actor · Singer · Teaching artist"
          />
        </label>
        <label>
          Union status
          <select
            value={portfolio.unionStatus}
            onChange={(event) =>
              setPortfolio({ ...portfolio, unionStatus: event.target.value })
            }
          >
            <option>Non-union</option>
            <option>SAG-AFTRA Eligible</option>
            <option>SAG-AFTRA</option>
            <option>AEA Candidate</option>
            <option>AEA</option>
            <option>Other</option>
          </select>
        </label>
        <label>
          Base location
          <input
            value={portfolio.location}
            onChange={(event) =>
              setPortfolio({ ...portfolio, location: event.target.value })
            }
            placeholder="New York, NY"
          />
        </label>
        <label>
          Playing age
          <input
            value={portfolio.playingAge}
            onChange={(event) =>
              setPortfolio({ ...portfolio, playingAge: event.target.value })
            }
            placeholder="18–25"
          />
        </label>
        <label>
          Height
          <input
            value={portfolio.height}
            onChange={(event) =>
              setPortfolio({ ...portfolio, height: event.target.value })
            }
            placeholder={`5' 8\"`}
          />
        </label>
        <label>
          Eye color
          <input
            value={portfolio.eyeColor}
            onChange={(event) =>
              setPortfolio({ ...portfolio, eyeColor: event.target.value })
            }
          />
        </label>
        <label>
          Hair color
          <input
            value={portfolio.hairColor}
            onChange={(event) =>
              setPortfolio({ ...portfolio, hairColor: event.target.value })
            }
          />
        </label>
        <label>
          Representation
          <input
            value={portfolio.representation}
            onChange={(event) =>
              setPortfolio({ ...portfolio, representation: event.target.value })
            }
          />
        </label>
        <label>
          Personal accent color
          <input
            type="color"
            value={portfolio.accentColor}
            onChange={(event) =>
              setPortfolio({ ...portfolio, accentColor: event.target.value })
            }
          />
        </label>
        <label className="full">
          Professional website
          <input
            type="url"
            value={portfolio.website}
            onChange={(event) =>
              setPortfolio({ ...portfolio, website: event.target.value })
            }
            placeholder="https://…"
          />
        </label>
        <label>
          Public email
          <input
            type="email"
            value={portfolio.contactEmail}
            onChange={(event) =>
              setPortfolio({ ...portfolio, contactEmail: event.target.value })
            }
          />
        </label>
        <label>
          Public phone
          <input
            type="tel"
            value={portfolio.contactPhone}
            onChange={(event) =>
              setPortfolio({ ...portfolio, contactPhone: event.target.value })
            }
          />
        </label>
        <label className="check-row">
          <input
            type="checkbox"
            checked={portfolio.showEmail}
            onChange={(event) =>
              setPortfolio({ ...portfolio, showEmail: event.target.checked })
            }
          />
          Show Email button
        </label>
        <label className="check-row">
          <input
            type="checkbox"
            checked={portfolio.showPhone}
            onChange={(event) =>
              setPortfolio({ ...portfolio, showPhone: event.target.checked })
            }
          />
          Show Call button
        </label>
        <label className="full">
          Main headshot
          <select
            value={portfolio.primaryHeadshotMaterialId}
            onChange={(event) =>
              setPortfolio({
                ...portfolio,
                primaryHeadshotMaterialId: event.target.value,
              })
            }
          >
            <option value="">Use first approved headshot</option>
            {materials.map((item) => (
              <option key={item.id} value={item.id}>
                {item.title}
              </option>
            ))}
          </select>
          <small>All other approved photos appear in the gallery.</small>
        </label>
        <label className="full">
          Bio
          <textarea
            required
            value={bio}
            onChange={(event) => setBio(event.target.value)}
          />
        </label>
        <label className="check-row full">
          <input
            type="checkbox"
            checked={submit}
            onChange={(event) => setSubmit(event.target.checked)}
          />
          Submit for coach review
        </label>
        <div className="form-actions">
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="primary">Save</button>
        </div>
      </form>
    </Dialog>
  );
}

function PortalList({
  title,
  description,
  items,
}: {
  title: string;
  description: string;
  items: { title: string; detail: string; status: string; url?: string }[];
}) {
  const [notice, setNotice] = useState("");
  return (
    <div className="student-page">
      <header className="student-header">
        <h1>{title}</h1>
        <p>{description}</p>
      </header>
      {notice && <p className="portal-notice">{notice}</p>}
      <Section title={title} marked>
        <div className="table-list">
          {items.map((item, index) => (
            <article key={`${item.title}-${index}`}>
              <FileText />
              <div>
                <strong>{item.title}</strong>
                <small>{item.detail}</small>
              </div>
              <Status
                tone={
                  item.status.includes("complete") || item.status === "active"
                    ? "good"
                    : "neutral"
                }
              >
                {item.status.replaceAll("_", " ")}
              </Status>
              <button
                onClick={() =>
                  item.url
                    ? window.open(item.url, "_blank", "noopener,noreferrer")
                    : setNotice(
                        `${item.title} does not have a downloadable link yet.`,
                      )
                }
              >
                Open
              </button>
            </article>
          ))}
          {!items.length && (
            <EmptyState
              title={`No ${title.toLowerCase()} yet`}
              detail="Nothing is required from you right now."
            />
          )}
        </div>
      </Section>
    </div>
  );
}
