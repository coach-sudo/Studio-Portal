import { useQueryClient } from "@tanstack/react-query";
import DOMPurify from "dompurify";
import {
  CalendarDays,
  CheckSquare,
  FileText,
  FolderOpen,
  MessageSquare,
  ShieldCheck,
  Video,
} from "lucide-react";
import { useEffect, useState } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import { AssignmentActivity } from "../../components/AssignmentActivity";
import "../../components/IdentityActions.css";
import {
  Dialog,
  EmptyState,
  ListControls,
  Section,
  Status,
  usePagedList,
} from "../../components/Primitives";
import { studioCommand } from "../../data/bookingCommands";
import { portalPageSize, shouldShowPagination } from "../../data/pagination";
import { mapNoteRow } from "../../data/studioMappers";
import { formatMoney } from "../../domain/finance";
import { selectLessonDelivery } from "../../domain/lessonExperience";
import {
  formatStudioDate,
  formatStudioDateTime,
} from "../../domain/presentation";
import { usePaginatedStudioRows } from "../../hooks/usePaginatedStudioRows";
import {
  invalidateStudioDomains,
  queryLayerV2Enabled,
} from "../../hooks/useStudio";
import { useStudioStore } from "../../state/StudioStore";

import { type Snapshot } from "./StudentPortal.shared";

export function StudentNotes({
  data,
  isDemo,
}: {
  data: Snapshot;
  isDemo: boolean;
}) {
  const [query, setQuery] = useState(""),
    [selectedLessonId, setSelectedLessonId] = useState<string>();
  const [serverPage, setServerPage] = useState(1);
  const [serverPageSize, setServerPageSize] = useState(portalPageSize);
  const serverPaging = queryLayerV2Enabled && !isDemo;
  const remoteNotes = usePaginatedStudioRows(
    {
      domain: "work",
      table: "notes",
      page: serverPage,
      pageSize: serverPageSize,
      search: query.trim() ? { column: "title", value: query } : undefined,
      filters: { status: "published" },
      sort: { column: "updated_at", ascending: false },
    },
    serverPaging,
  );
  useEffect(() => setServerPage(1), [query]);
  const notes = serverPaging
    ? (remoteNotes.data?.items ?? []).map((row) => mapNoteRow(row))
    : data.notes;
  const filtered = notes
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
  const localPage = usePagedList(groups, portalPageSize);
  const page = serverPaging
    ? {
        visible: groups,
        page: serverPage,
        setPage: setServerPage,
        pageSize: serverPageSize,
        setPageSize: setServerPageSize,
        pageCount: Math.max(
          1,
          Math.ceil((remoteNotes.data?.total ?? 0) / serverPageSize),
        ),
        total: remoteNotes.data?.total ?? 0,
      }
    : localPage;
  const selected = groups.find((group) => group.lessonId === selectedLessonId);
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
        {shouldShowPagination(page.total, page.pageSize) && (
          <ListControls
            page={page.page}
            pageCount={page.pageCount}
            pageSize={page.pageSize}
            total={page.total}
            onPage={page.setPage}
            onPageSize={page.setPageSize}
            label="notes"
          />
        )}
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
                      ? formatStudioDate(
                          lesson.startsAt,
                          data.settings.timezone,
                        )
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
                ? formatStudioDateTime(
                    data.lessons.find((item) => item.id === selected.lessonId)
                      ?.startsAt || selected.updatedAt,
                    data.settings.timezone,
                  )
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

export function LessonHub({
  data,
  isDemo,
  showFinance,
}: {
  data: Snapshot;
  isDemo: boolean;
  showFinance: boolean;
}) {
  const { lessonId = "" } = useParams();
  const lesson = data.lessons.find((item) => item.id === lessonId);
  const store = useStudioStore();
  const queryClient = useQueryClient();
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
      const token = (await supabase?.auth.getSession())?.data.session
        ?.access_token;
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
  const deliveryPresentation = selectLessonDelivery(lesson, {
    calendarStatus: delivery?.calendar?.status,
  });
  const notes = data.notes.filter((item) => item.lessonId === lesson.id);
  const assignments = data.assignments.filter(
    (item) => item.lessonId === lesson.id,
  );
  const materials = data.materials.filter(
    (item) => item.lessonId === lesson.id,
  );
  const offering = data.serviceOfferings.find(
    (item) => item.id === lesson.offeringId,
  );
  const participant = data.lessonParticipants.find(
    (item) => item.lessonId === lesson.id && item.bookingId,
  );
  const booking = data.bookings.find(
    (item) => item.id === participant?.bookingId,
  );
  const student =
    data.students.find((item) => item.id === lesson.studentId) ??
    data.students[0];
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
        await invalidateStudioDomains(queryClient, ["work"]);
      }
      setNotice(
        command === "complete"
          ? "Assignment completed and moved to your archive."
          : "Your coach will see this help request in Today.",
      );
    } catch (reason) {
      setNotice(
        reason instanceof Error
          ? reason.message
          : "Assignment could not be updated.",
      );
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
          const current = draft.assignments.find(
            (item) => item.id === assignment.id,
          );
          if (!current) return;
          current.responses = responses;
          current.status =
            current.status === "assigned" ? "in_progress" : current.status;
          current.progress = Math.max(current.progress || 0, 25);
          current.version += 1;
          current.updatedAt = new Date().toISOString();
        });
      else {
        await studioCommand("work", {
          command: "save_response",
          entityId: assignment.id,
          expectedVersion: assignment.version,
          payload: {
            responses,
            progress: Math.max(assignment.progress || 0, 25),
          },
          reason: "Student saved lesson assignment progress",
        });
        await invalidateStudioDomains(queryClient, ["work"]);
      }
      setNotice("Assignment progress saved.");
    } catch (reason) {
      setNotice(
        reason instanceof Error
          ? reason.message
          : "Assignment progress could not be saved.",
      );
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
            {formatStudioDateTime(lesson.startsAt, data.settings.timezone)} ·{" "}
            {lesson.locationLabel}
          </p>
        </div>
        <div className="lesson-immediate-actions">
          {lesson.joinUrl && deliveryPresentation.state === "available" && (
            <a
              className="button-link primary"
              href={lesson.joinUrl}
              target="_blank"
              rel="noreferrer"
            >
              <Video />
              {deliveryPresentation.actionLabel}
            </a>
          )}
          <Link className="button-link" to="/portal/bookings">
            <CalendarDays />
            Manage schedule
          </Link>
        </div>
      </header>
      {notice && <p className="portal-notice">{notice}</p>}
      {(lesson.locationType === "virtual" ||
        lesson.meetingProvider === "google_meet") && (
        <details className="lesson-delivery-receipt" role="status">
          <summary>
            <ShieldCheck />
            <strong>{deliveryPresentation.label}</strong>
          </summary>
          <div>
            <small>{deliveryPresentation.detail}</small>
          </div>
        </details>
      )}
      {offering && (
        <Section title="Class information" marked>
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
      <section
        className="lesson-work-surface"
        aria-labelledby="lesson-work-title"
      >
        <h2 id="lesson-work-title">Lesson work</h2>
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
                      <small>
                        {item.dueAt
                          ? `Due ${formatStudioDate(item.dueAt, data.settings.timezone)}`
                          : "Attached to this lesson"}
                      </small>
                    </div>
                    <Status
                      tone={item.status === "completed" ? "good" : "neutral"}
                    >
                      {item.status.replaceAll("_", " ")}
                    </Status>
                  </header>
                  <AssignmentActivity
                    assignment={item}
                    busy={assignmentBusy === item.id}
                    onSave={(responses) =>
                      saveLessonAssignment(item, responses)
                    }
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
            <p className="section-intro">
              Continue privately with your coach without leaving the studio.
            </p>
            <Link className="button-link primary" to="/portal/inbox">
              <MessageSquare />
              Message coach
            </Link>
          </Section>
        </div>
      </section>
      <details className="lesson-admin-details">
        <summary>Administrative details</summary>
        <dl>
          <div>
            <dt>Status</dt>
            <dd>{lesson.status.replaceAll("_", " ")}</dd>
          </div>
          <div>
            <dt>Source</dt>
            <dd>{(lesson.sourceProvider || "studio").replaceAll("_", " ")}</dd>
          </div>
          <div>
            <dt>Recurrence</dt>
            <dd>{lesson.seriesId ? "Recurring lesson" : "One-time lesson"}</dd>
          </div>
          {showFinance && booking && (
            <>
              <div>
                <dt>Payment</dt>
                <dd>{booking.paymentStatus.replaceAll("_", " ")}</dd>
              </div>
              <div>
                <dt>Lesson price</dt>
                <dd>{formatMoney(booking.totalMinor, booking.currency)}</dd>
              </div>
            </>
          )}
        </dl>
      </details>
    </div>
  );
}
