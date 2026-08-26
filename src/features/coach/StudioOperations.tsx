import {
  CalendarDays,
  CheckCircle2,
  CircleDollarSign,
  FileText,
  FolderOpen,
  Search,
  Trash2,
  UserRound,
} from "lucide-react";
import { useState, type FormEvent } from "react";
import DOMPurify from "dompurify";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import {
  Dialog,
  EmptyState,
  ListControls,
  Section,
  Status,
  usePagedList,
} from "../../components/Primitives";
import { LessonCalendar } from "../../components/LessonCalendar";
import { RescheduleLessonForm } from "../../components/RescheduleLessonForm";
import {
  formatMoney,
  packageSummary,
  studentBalanceMinor,
} from "../../domain/finance";
import type {
  ActorProfileStatus,
  DiscountCode,
  IntegrationImport,
  Lesson,
  PackageDefinition,
  StudioSnapshot,
} from "../../domain/model";
import { useStudioStore } from "../../state/StudioStore";
import { studioCommand } from "../../data/bookingCommands";

const studentName = (data: StudioSnapshot, id: string) =>
  data.students.find((item) => item.id === id)?.fullName || "Student";
const sourceLabel = (source?: string) =>
  (
    ({
      studio: "Studio",
      public_booking: "Direct booking",
      google_calendar: "Google Calendar",
      gmail: "Gmail",
      lessonface: "Lessonface",
      wyzant: "Wyzant",
      lessons_com: "Lessons.com",
      acuity: "Acuity",
    }) as Record<string, string>
  )[source || "studio"] ||
  source ||
  "Studio";
export function TodayView({
  data,
  isDemo,
}: {
  data: StudioSnapshot;
  isDemo: boolean;
}) {
  const store = useStudioStore(),
    queryClient = useQueryClient(),
    navigate = useNavigate(),
    [notice, setNotice] = useState(""),
    [reviewing, setReviewing] = useState<IntegrationImport>(),
    [rescheduling, setRescheduling] = useState<Lesson>(),
    [rescheduleBusy, setRescheduleBusy] = useState(false),
    [prepBusy, setPrepBusy] = useState("");
  const today = new Date().toDateString();
  const lessons = data.lessons
    .filter(
      (i) =>
        i.status === "scheduled" &&
        new Date(i.startsAt).toDateString() === today,
    )
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  const noteFollowups = data.lessons
    .filter((lesson) => {
      const ended = new Date(lesson.endsAt).getTime();
      return (
        ended <= Date.now() &&
        ended >= Date.now() - 8 * 86400000 &&
        !["cancelled", "late_cancelled"].includes(lesson.status) &&
        !data.notes.some(
          (note) => note.lessonId === lesson.id && note.status === "published",
        )
      );
    })
    .sort((a, b) => a.endsAt.localeCompare(b.endsAt));
  const notePage = usePagedList(noteFollowups);
  const reviewGroups = Object.values(
    data.integrationImports
      .filter((item) => item.status === "needs_review")
      .reduce<Record<string, IntegrationImport[]>>((groups, item) => {
        const key = `${item.detectedSource}:${importSummary(item)}`;
        (groups[key] ||= []).push(item);
        return groups;
      }, {}),
  );
  const importPage = usePagedList(reviewGroups);
  const pendingMaterials = data.materials.filter(
    (item) => item.approvalStatus === "pending_review",
  );
  const pendingActorPages = data.actorProfiles.filter(
    (item) => item.status === "review_requested",
  );
  const helpRequests = data.assignments.filter((item) => item.helpRequested);
  const bookingAttention = data.bookings.filter(
    (item) => item.status === "needs_attention",
  );
  const complete = async (lesson: Lesson) => {
    try {
      if (isDemo)
        store.transact((draft) => {
          const item = draft.lessons.find((i) => i.id === lesson.id)!;
          item.status = "completed";
          item.version += 1;
          item.updatedAt = new Date().toISOString();
        });
      else {
        await studioCommand("lessons", {
          command: "complete",
          entityId: lesson.id,
          expectedVersion: lesson.version,
          reason: "Coach completed lesson",
        });
        await queryClient.invalidateQueries({ queryKey: ["studio"] });
      }
      setNotice(
        "Lesson completed. Add the follow-up from the student record when you are ready.",
      );
    } catch (reason) {
      setNotice(
        reason instanceof Error
          ? reason.message
          : "Lesson could not be completed.",
      );
    }
  };
  const reviewed = async () => {
    setReviewing(undefined);
    await queryClient.invalidateQueries({ queryKey: ["studio"] });
    setNotice(
      "The provider signal was reviewed and the student record was updated.",
    );
  };
  const reschedule = async (startsAt: string, endsAt: string) => {
    if (!rescheduling || rescheduleBusy) return;
    setRescheduleBusy(true);
    try {
      if (isDemo)
        store.transact((draft) => {
          const item = draft.lessons.find((lesson) => lesson.id === rescheduling.id);
          if (!item) return;
          item.startsAt = startsAt;
          item.endsAt = endsAt;
          item.version += 1;
          item.updatedAt = new Date().toISOString();
        });
      else {
        await studioCommand("lessons", {
          command: "reschedule",
          entityId: rescheduling.id,
          expectedVersion: rescheduling.version,
          payload: { startsAt, endsAt },
          reason: "Coach rescheduled lesson from Today",
        });
        await queryClient.invalidateQueries({ queryKey: ["studio"] });
      }
      setRescheduling(undefined);
      setNotice("Lesson rescheduled. Calendar and student invitation updates are queued.");
    } catch (reason) {
      setNotice(reason instanceof Error ? reason.message : "Lesson could not be rescheduled.");
    } finally {
      setRescheduleBusy(false);
    }
  };
  const togglePreparation = async (
    lesson: Lesson,
    key: "planned" | "setupReady" | "materialsReady",
  ) => {
    if (prepBusy) return;
    const preparation = {
      planned: Boolean(lesson.preparation?.planned),
      setupReady: Boolean(lesson.preparation?.setupReady),
      materialsReady: Boolean(lesson.preparation?.materialsReady),
      [key]: !lesson.preparation?.[key],
    };
    setPrepBusy(`${lesson.id}:${key}`);
    try {
      if (isDemo)
        store.transact((draft) => {
          const current = draft.lessons.find((item) => item.id === lesson.id);
          if (!current) return;
          current.preparation = preparation;
          current.version += 1;
          current.updatedAt = new Date().toISOString();
        });
      else {
        await studioCommand("lessons", {
          command: "prepare",
          entityId: lesson.id,
          expectedVersion: lesson.version,
          payload: { preparation },
          reason: "Coach updated today's lesson preparation",
        });
        await queryClient.invalidateQueries({ queryKey: ["studio"] });
      }
    } catch (reason) {
      setNotice(
        reason instanceof Error
          ? reason.message
          : "Preparation could not be saved.",
      );
    } finally {
      setPrepBusy("");
    }
  };
  return (
    <>
      <Section title="Today’s teaching flow" marked>
        {notice && <p className="portal-notice">{notice}</p>}
        <div className="workflow-list">
          {lessons.map((lesson, index) => (
            <article key={lesson.id}>
              <span>{index + 1}</span>
              <div>
                <strong>
                  {studentName(data, lesson.studentId)} · {lesson.topic}
                </strong>
                <small>
                  {new Date(lesson.startsAt).toLocaleString()} ·{" "}
                  {lesson.locationLabel} · {sourceLabel(lesson.sourceProvider)}
                </small>
              </div>
              <Status tone="good">scheduled</Status>
              <div className="row-actions">
                <button onClick={() => setRescheduling(lesson)}>Reschedule</button>
                <button onClick={() => void complete(lesson)}>Complete</button>
              </div>
            </article>
          ))}
          {!lessons.length && (
            <EmptyState
              title="The rest of today is clear"
              detail="Only today’s scheduled lessons appear here. Use Home for the week ahead."
            />
          )}
        </div>
      </Section>
      {lessons.length > 0 && (
        <Section title="Ready to teach" marked>
          <p className="section-intro">
            Three quick checks for today only. Lesson follow-up stays in the
            lesson workspace after teaching.
          </p>
          <div className="lesson-prep-list">
            {lessons.map((lesson) => (
              <article key={`prep-${lesson.id}`}>
                <div>
                  <strong>
                    {new Date(lesson.startsAt).toLocaleTimeString([], {
                      hour: "numeric",
                      minute: "2-digit",
                    })}{" "}
                    · {studentName(data, lesson.studentId)}
                  </strong>
                  <small>{lesson.topic}</small>
                </div>
                {(
                  [
                    ["planned", "Plan"],
                    ["setupReady", "Setup"],
                    ["materialsReady", "Materials"],
                  ] as const
                ).map(([key, label]) => (
                  <label key={key} className="compact-check">
                    <input
                      type="checkbox"
                      checked={Boolean(lesson.preparation?.[key])}
                      disabled={Boolean(prepBusy)}
                      onChange={() => void togglePreparation(lesson, key)}
                    />
                    <span>{label}</span>
                  </label>
                ))}
              </article>
            ))}
          </div>
        </Section>
      )}
      <Section title="Notes due within 48 hours" marked>
        <div className="workflow-list">
          {notePage.visible.map((lesson) => {
            const due = new Date(
                new Date(lesson.endsAt).getTime() + 48 * 60 * 60 * 1000,
              ),
              remaining = due.getTime() - Date.now();
            return (
              <article key={`note-${lesson.id}`}>
                <FileText />
                <div>
                  <strong>
                    {studentName(data, lesson.studentId)} · {lesson.topic}
                  </strong>
                  <small>
                    {remaining > 0
                      ? `${Math.max(1, Math.ceil(remaining / 3_600_000))} hours remaining`
                      : `Overdue since ${due.toLocaleString()}`}
                  </small>
                </div>
                <Status
                  tone={
                    remaining <= 0
                      ? "danger"
                      : remaining < 12 * 3_600_000
                        ? "warn"
                        : "neutral"
                  }
                >
                  {remaining <= 0 ? "overdue" : "due"}
                </Status>
                <button
                  onClick={() =>
                    navigate(`/coach/students/${lesson.studentId}/notes`)
                  }
                >
                  Write note
                </button>
              </article>
            );
          })}
          {!noteFollowups.length && (
            <EmptyState
              title="Lesson notes are caught up"
              detail="A reminder appears here after each lesson and remains until a note is published."
            />
          )}
        </div>
        {noteFollowups.length > 0 && (
          <ListControls
            page={notePage.page}
            pageCount={notePage.pageCount}
            pageSize={notePage.pageSize}
            total={notePage.total}
            onPage={notePage.setPage}
            onPageSize={notePage.setPageSize}
            label="note follow-ups"
          />
        )}
      </Section>
      {reviewGroups.length > 0 && (
        <div id="verification">
          <Section title="Verify imported lessons">
            <p className="section-intro">
              These are provider signals waiting for one clear decision.
              Confirming links the lesson to the student profile; matching
              series can be handled together.
            </p>
            <div className="table-list">
              {importPage.visible.map((group) => {
                const item = group[0];
                return (
                  <article key={item.id}>
                    <CalendarDays />
                    <div>
                      <strong>
                        {sourceLabel(item.detectedSource)}
                        {group.length > 1
                          ? ` · ${group.length} matching lessons`
                          : " lesson"}
                      </strong>
                      <small>
                        {importSummary(item)} ·{" "}
                        {item.studentId
                          ? `suggested: ${studentName(data, item.studentId)} · `
                          : "student not matched · "}
                        {Math.round(item.confidence * 100)}% confidence
                        {item.matchedBy ? ` by ${item.matchedBy}` : ""}
                      </small>
                    </div>
                    <Status tone="warn">needs decision</Status>
                    <button onClick={() => setReviewing(item)}>Verify</button>
                  </article>
                );
              })}
            </div>
            <ListControls
              page={importPage.page}
              pageCount={importPage.pageCount}
              pageSize={importPage.pageSize}
              total={importPage.total}
              onPage={importPage.setPage}
              onPageSize={importPage.setPageSize}
              label="import groups"
            />
          </Section>
        </div>
      )}
      {(pendingMaterials.length > 0 ||
        pendingActorPages.length > 0 ||
        helpRequests.length > 0 ||
        bookingAttention.length > 0) && (
        <Section title="Approve & resolve" marked>
          <p className="section-intro">
            Everything waiting for a coach decision is collected here; the
            full record remains in its natural workspace.
          </p>
          <div className="table-list">
            {pendingMaterials.map((item) => (
              <article key={`material-${item.id}`}>
                <FolderOpen />
                <div>
                  <strong>Review {item.title}</strong>
                  <small>{studentName(data, item.studentId)} · actor material</small>
                </div>
                <Status tone="warn">approval</Status>
                <button onClick={() => navigate("/coach/materials")}>Review</button>
              </article>
            ))}
            {pendingActorPages.map((item) => (
              <article key={`actor-${item.id}`}>
                <UserRound />
                <div>
                  <strong>Review {item.displayName}’s actor page</strong>
                  <small>Requested by the student</small>
                </div>
                <Status tone="warn">approval</Status>
                <button onClick={() => navigate("/coach/actor-pages")}>Review</button>
              </article>
            ))}
            {helpRequests.map((item) => (
              <article key={`help-${item.id}`}>
                <CheckCircle2 />
                <div>
                  <strong>{studentName(data, item.studentId)} asked for help</strong>
                  <small>{item.title}</small>
                </div>
                <Status tone="warn">reply</Status>
                <button
                  onClick={() =>
                    navigate(`/coach/students/${item.studentId}/work`)
                  }
                >
                  Open work
                </button>
              </article>
            ))}
            {bookingAttention.map((item) => (
              <article key={`booking-${item.id}`}>
                <CalendarDays />
                <div>
                  <strong>{item.guestName} · {item.reference}</strong>
                  <small>Booking or integration delivery needs attention</small>
                </div>
                <Status tone="warn">resolve</Status>
                <button onClick={() => navigate("/coach/bookings")}>Open</button>
              </article>
            ))}
          </div>
        </Section>
      )}
      {reviewing && (
        <ImportReviewDialog
          item={reviewing}
          similarCount={
            reviewGroups.find((group) =>
              group.some((entry) => entry.id === reviewing.id),
            )?.length || 1
          }
          data={data}
          onClose={() => setReviewing(undefined)}
          onReviewed={reviewed}
        />
      )}
      {rescheduling && (
        <Dialog
          title="Reschedule lesson"
          description={`${studentName(data, rescheduling.studentId)} · ${rescheduling.topic}`}
          onClose={() => !rescheduleBusy && setRescheduling(undefined)}
        >
          <RescheduleLessonForm
            lesson={rescheduling}
            studentName={studentName(data, rescheduling.studentId)}
            timezone={data.settings.timezone}
            cancellationWindowHours={data.settings.bookingDefaults.cancellationWindowHours}
            busy={rescheduleBusy}
            onCancel={() => setRescheduling(undefined)}
            onSubmit={reschedule}
          />
        </Dialog>
      )}
    </>
  );
}

function importSummary(item: IntegrationImport) {
  const payload = item.payload || {},
    headers = (payload.headers || {}) as Record<string, string>;
  return String(
    payload.summary ||
      headers.subject ||
      payload.snippet ||
      sourceLabel(item.detectedSource),
  );
}

function importEmail(item: IntegrationImport, data: StudioSnapshot) {
  const payload = item.payload || {},
    attendees = Array.isArray(payload.attendees) ? payload.attendees : [];
  const attendeeEmails = attendees.map((attendee) =>
    String((attendee as Record<string, unknown>).email || ""),
  );
  const textEmails =
    JSON.stringify(payload).match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) ||
    [];
  const matches = [...attendeeEmails, ...textEmails].filter(Boolean);
  const coachEmails = new Set(
    [data.settings.contactEmail, ...(data.settings.coachEmails || [])].map(
      (email) => email.toLowerCase(),
    ),
  );
  return (
    matches.find((email) => {
      const normalized = email.toLowerCase();
      return (
        !coachEmails.has(normalized) &&
        !normalized.endsWith("@google.com") &&
        !normalized.includes("calendar-notification") &&
        !normalized.includes("noreply")
      );
    }) || ""
  );
}

function ImportReviewDialog({
  item,
  similarCount,
  data,
  onClose,
  onReviewed,
}: {
  item: IntegrationImport;
  similarCount: number;
  data: StudioSnapshot;
  onClose: () => void;
  onReviewed: () => Promise<void>;
}) {
  const candidate = (item.payload?.candidate || {}) as {
      startsAt?: string;
      endsAt?: string;
      locationLabel?: string;
    },
    [mode, setMode] = useState<"existing" | "create">(
      item.studentId ? "existing" : "create",
    ),
    [studentId, setStudentId] = useState(item.studentId || ""),
    [name, setName] = useState(""),
    [email, setEmail] = useState(importEmail(item, data)),
    [merge, setMerge] = useState(false),
    [note, setNote] = useState(""),
    [saving, setSaving] = useState(false),
    [error, setError] = useState("");
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setError("");
    try {
      await studioCommand("integrations", {
        command: "review_import",
        entityId: item.id,
        expectedVersion: 0,
        payload: {
          action: mode,
          applySimilar: similarCount > 1,
          studentId: mode === "existing" ? studentId : undefined,
          fullName: mode === "create" ? name : undefined,
          email: mode === "create" ? email : undefined,
          mergeStudentId:
            merge && item.studentId && item.studentId !== studentId
              ? item.studentId
              : undefined,
          note,
        },
        reason: "Coach reviewed provider lesson",
      });
      await onReviewed();
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "The lesson could not be verified.",
      );
    } finally {
      setSaving(false);
    }
  };
  const ignore = async () => {
    if (saving) return;
    setSaving(true);
    setError("");
    try {
      await studioCommand("integrations", {
        command: "review_import",
        entityId: item.id,
        expectedVersion: 0,
        payload: { action: "ignore", applySimilar: similarCount > 1, note },
        reason: "Coach ignored provider lesson",
      });
      await onReviewed();
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "The provider item could not be ignored.",
      );
    } finally {
      setSaving(false);
    }
  };
  return (
    <Dialog
      title="Verify imported lesson"
      description={`${sourceLabel(item.detectedSource)} · ${importSummary(item)}${similarCount > 1 ? ` · ${similarCount} matching occurrences` : ""}`}
      onClose={onClose}
    >
      <form className="workflow-form" onSubmit={submit}>
        {error && (
          <p className="inline-error" role="alert">
            {error}
          </p>
        )}
        {candidate.startsAt && (
          <div className="import-evidence full">
            <strong>Lesson detected</strong>
            <span>
              {new Date(candidate.startsAt).toLocaleString()} –{" "}
              {candidate.endsAt
                ? new Date(candidate.endsAt).toLocaleTimeString([], {
                    hour: "numeric",
                    minute: "2-digit",
                  })
                : "end time unavailable"}
            </span>
            <small>
              {candidate.locationLabel || "Provider booking"}. Confirming
              creates or links this lesson in the selected student profile.
            </small>
          </div>
        )}
        <div className="settings-list full">
          <button
            type="button"
            role="switch"
            aria-checked={mode === "existing"}
            className={`setting-toggle toggle-button ${mode === "existing" ? "on" : ""}`}
            onClick={() => setMode("existing")}
          >
            <span>
              <strong>Link an existing student</strong>
              <small>Use one current record and avoid a duplicate.</small>
            </span>
            <i aria-hidden="true">
              <b />
            </i>
          </button>
          <button
            type="button"
            role="switch"
            aria-checked={mode === "create"}
            className={`setting-toggle toggle-button ${mode === "create" ? "on" : ""}`}
            onClick={() => setMode("create")}
          >
            <span>
              <strong>Create an interested student</strong>
              <small>Save a new lead from this provider signal.</small>
            </span>
            <i aria-hidden="true">
              <b />
            </i>
          </button>
        </div>
        {mode === "existing" ? (
          <>
            <label className="full">
              Student
              <select
                required
                value={studentId}
                onChange={(event) => {
                  setStudentId(event.target.value);
                  setMerge(false);
                }}
              >
                <option value="">Choose a student</option>
                {[...data.students]
                  .sort((a, b) => a.fullName.localeCompare(b.fullName))
                  .map((student) => (
                    <option key={student.id} value={student.id}>
                      {student.fullName} ·{" "}
                      {student.email || student.guardianEmail || "no email"}
                    </option>
                  ))}
              </select>
            </label>
            {item.studentId && studentId && item.studentId !== studentId && (
              <label className="check-row full">
                <input
                  type="checkbox"
                  checked={merge}
                  onChange={(event) => setMerge(event.target.checked)}
                />
                <span>
                  <strong>
                    Merge {studentName(data, item.studentId)} into this record
                  </strong>
                  <small>
                    Lessons, notes, materials, payments, relationships, and
                    portal access move to the selected student.
                  </small>
                </span>
              </label>
            )}
          </>
        ) : (
          <>
            <label>
              Full name
              <input
                required
                autoFocus
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </label>
            <label>
              Email
              <input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </label>
          </>
        )}
        <label className="full">
          Verification note (optional)
          <input
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="What you checked or corrected"
          />
        </label>
        <div className="form-actions full">
          <button type="button" disabled={saving} onClick={() => void ignore()}>
            Ignore{similarCount > 1 ? ` ${similarCount} signals` : " signal"}
          </button>
          <button type="button" disabled={saving} onClick={onClose}>
            Cancel
          </button>
          <button className="primary" disabled={saving}>
            {saving
              ? "Saving…"
              : mode === "create"
                ? `Create & attach lesson${similarCount > 1 ? `s (${similarCount})` : ""}`
                : `Confirm student & lesson${similarCount > 1 ? `s (${similarCount})` : ""}`}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
export function LessonsView({
  data,
  isDemo,
}: {
  data: StudioSnapshot;
  isDemo: boolean;
}) {
  const navigate = useNavigate(),
    store = useStudioStore(),
    queryClient = useQueryClient(),
    [selected, setSelected] = useState<Lesson>(),
    [panel, setPanel] = useState<"details" | "reschedule" | "credits">("details"),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(""),
    [confirmCancel, setConfirmCancel] = useState(false),
    [cadence, setCadence] = useState<"weekly" | "biweekly">("weekly"),
    [occurrences, setOccurrences] = useState(6),
    [creditQuantity, setCreditQuantity] = useState(1),
    [creditReason, setCreditReason] = useState("Lesson-specific credit");
  const openLesson = (lesson: Lesson) => {
    setSelected(lesson);
    setPanel("details");
    setConfirmCancel(false);
  };
  const update = async (status: "completed" | "cancelled") => {
    if (!selected || busy) return;
    setBusy(status);
    try {
      if (isDemo)
        store.transact((draft) => {
          const item = draft.lessons.find((i) => i.id === selected.id)!;
          item.status = status;
          item.version += 1;
          item.updatedAt = new Date().toISOString();
        });
      else {
        await studioCommand("lessons", {
          command: status === "completed" ? "complete" : "cancel",
          entityId: selected.id,
          expectedVersion: selected.version,
          reason: `Coach marked lesson ${status}`,
        });
        await queryClient.invalidateQueries({ queryKey: ["studio"] });
      }
      setSelected(undefined);
      setNotice(
        status === "cancelled"
          ? "Lesson cancelled and removed from the active calendar. Calendar notifications are being updated."
          : "Lesson marked completed.",
      );
    } catch (reason) {
      setNotice(
        reason instanceof Error
          ? reason.message
          : "Lesson could not be updated.",
      );
    } finally {
      setBusy("");
    }
  };
  const move = async (startsAt: string, endsAt: string) => {
    if (!selected || busy) return;
    setBusy("reschedule");
    try {
      if (isDemo)
        store.transact((draft) => {
          const item = draft.lessons.find((i) => i.id === selected.id)!;
          item.startsAt = startsAt;
          item.endsAt = endsAt;
          item.version += 1;
        });
      else {
        await studioCommand("lessons", {
          command: "reschedule",
          entityId: selected.id,
          expectedVersion: selected.version,
          payload: { startsAt, endsAt },
          reason: "Coach rescheduled lesson",
        });
        await queryClient.invalidateQueries({ queryKey: ["studio"] });
      }
      setSelected(undefined);
      setNotice("Lesson rescheduled. Calendar and student invitation updates are queued.");
    } catch (reason) {
      setNotice(
        reason instanceof Error
          ? reason.message
          : "Lesson could not be rescheduled.",
      );
    } finally {
      setBusy("");
    }
  };
  const makeRecurring = async () => {
    if (!selected || busy) return;
    setBusy("recurring");
    try {
      if (isDemo)
        store.transact((draft) => {
          const base = draft.lessons.find(
            (lesson) => lesson.id === selected.id,
          )!;
          const seriesId = `series-${crypto.randomUUID()}`;
          base.seriesId = seriesId;
          base.version += 1;
          for (let index = 1; index < occurrences; index += 1) {
            const days = (cadence === "biweekly" ? 14 : 7) * index;
            draft.lessons.push({
              ...base,
              id: `lesson-${crypto.randomUUID()}`,
              seriesId,
              startsAt: new Date(
                new Date(base.startsAt).getTime() + days * 86400000,
              ).toISOString(),
              endsAt: new Date(
                new Date(base.endsAt).getTime() + days * 86400000,
              ).toISOString(),
              version: 1,
              updatedAt: new Date().toISOString(),
            });
          }
        });
      else {
        await studioCommand("lessons", {
          command: "make_recurring",
          entityId: selected.id,
          expectedVersion: selected.version,
          payload: {
            cadence,
            occurrenceCount: occurrences,
            timezone: data.settings.timezone,
          },
          reason: "Coach created recurring lesson series",
        });
        await queryClient.invalidateQueries({ queryKey: ["studio"] });
      }
      setSelected(undefined);
      setNotice(`${occurrences} ${cadence} lessons added as one series.`);
    } catch (reason) {
      setNotice(
        reason instanceof Error
          ? reason.message
          : "Recurring lessons could not be created.",
      );
    } finally {
      setBusy("");
    }
  };
  const adjustLessonCredit = async () => {
    if (!selected || !creditQuantity || creditReason.trim().length < 3 || busy)
      return;
    setBusy("credit");
    try {
      if (isDemo) {
        store.transact((draft) => {
          let pkg = draft.packages.find(
            (item) =>
              item.studentId === selected.studentId &&
              item.name === "Studio lesson credits",
          );
          if (!pkg) {
            pkg = {
              id: `package-${crypto.randomUUID()}`,
              studentId: selected.studentId,
              name: "Studio lesson credits",
              priceMinor: 0,
              currency: "USD",
              version: 1,
              updatedAt: new Date().toISOString(),
            };
            draft.packages.push(pkg);
          }
          draft.creditEntries.push({
            id: `credit-${crypto.randomUUID()}`,
            packageId: pkg.id,
            lessonId: selected.id,
            kind: "adjustment",
            quantity: creditQuantity,
            reason: creditReason,
            createdAt: new Date().toISOString(),
          });
        });
      } else {
        await studioCommand("credits", {
          command: "grant",
          expectedVersion: 0,
          payload: {
            studentId: selected.studentId,
            lessonId: selected.id,
            quantity: creditQuantity,
            reason: creditReason,
          },
          reason: "Coach adjusted credit for a specific lesson",
        });
        await queryClient.invalidateQueries({ queryKey: ["studio"] });
      }
      setNotice(`Credit adjustment attached to ${selected.topic}.`);
    } catch (reason) {
      setNotice(
        reason instanceof Error
          ? reason.message
          : "Lesson credit could not be adjusted.",
      );
    } finally {
      setBusy("");
    }
  };
  const payWithCredit = async () => {
    if (!selected || busy) return;
    setBusy("pay-credit");
    try {
      if (isDemo) {
        store.transact((draft) => {
          const pkg = draft.packages
            .filter((item) => item.studentId === selected.studentId)
            .find(
              (item) =>
                packageSummary(item, draft.creditEntries).remainingCredits >
                0,
            );
          if (!pkg) throw new Error("This student does not have an available credit.");
          draft.creditEntries.push({
            id: `credit-${crypto.randomUUID()}`,
            packageId: pkg.id,
            lessonId: selected.id,
            kind: "consumption",
            quantity: -1,
            reason: `Paid by credit for ${selected.topic}`,
            createdAt: new Date().toISOString(),
          });
          const lesson = draft.lessons.find((item) => item.id === selected.id);
          if (lesson) lesson.packageId = pkg.id;
        });
      } else {
        await studioCommand("credits", {
          command: "use_for_lesson",
          entityId: selected.id,
          expectedVersion: selected.version,
          payload: { reason: `Paid by credit for ${selected.topic}` },
          reason: "Coach marked lesson paid by credit",
        });
        await queryClient.invalidateQueries({ queryKey: ["studio"] });
      }
      setSelected(undefined);
      setNotice("One credit was used and the lesson is marked paid by credit.");
    } catch (reason) {
      setNotice(
        reason instanceof Error
          ? reason.message
          : "The lesson could not be paid by credit.",
      );
    } finally {
      setBusy("");
    }
  };
  const selectedStudent = selected
    ? data.students.find((student) => student.id === selected.studentId)
    : undefined;
  const availableCredits = selectedStudent
    ? data.packages
        .filter((pkg) => pkg.studentId === selectedStudent.id)
        .reduce(
          (total, pkg) =>
            total + packageSummary(pkg, data.creditEntries).remainingCredits,
          0,
        )
    : 0;
  const paidByCredit = selected
    ? data.creditEntries.some(
        (entry) =>
          entry.lessonId === selected.id &&
          ["reservation", "consumption"].includes(entry.kind),
      )
    : false;
  const selectedNotes = selected
    ? data.notes.filter((item) => item.lessonId === selected.id).length
    : 0;
  const selectedPractice = selected
    ? data.assignments.filter((item) => item.lessonId === selected.id).length
    : 0;
  const selectedMaterials = selected
    ? data.materials.filter((item) => item.lessonId === selected.id).length
    : 0;
  const selectedDuration = selected
    ? Math.round((new Date(selected.endsAt).getTime() - new Date(selected.startsAt).getTime()) / 60_000)
    : 0;
  return (
    <Section title="Lesson calendar" marked>
      {notice && <p className="portal-notice">{notice}</p>}
      <p className="section-intro">
        Day, week, month, and year views share one searchable schedule.
        Cancelled lessons stay out of the way unless you choose to show them.
      </p>
      <LessonCalendar
        lessons={data.lessons}
        timezone={data.settings.timezone}
        studentName={(id) => studentName(data, id)}
        sourceName={sourceLabel}
        onOpen={openLesson}
      />
      {selected && (
        <Dialog
          title={
            panel === "reschedule"
              ? "Reschedule lesson"
              : panel === "credits"
                ? "Lesson credits"
                : selected.topic
          }
          description={`${studentName(data, selected.studentId)} · ${new Date(selected.startsAt).toLocaleString()} · ${sourceLabel(selected.sourceProvider)}`}
          onClose={() => setSelected(undefined)}
        >
          {panel === "reschedule" ? (
            <RescheduleLessonForm
              lesson={selected}
              studentName={studentName(data, selected.studentId)}
              timezone={data.settings.timezone}
              cancellationWindowHours={data.settings.bookingDefaults.cancellationWindowHours}
              busy={busy === "reschedule"}
              onCancel={() => setPanel("details")}
              onSubmit={move}
            />
          ) : (
          <div className="workflow-content lesson-command-center">
            <div className="lesson-command-summary">
              <Status
                tone={
                  selected.status === "completed"
                    ? "good"
                    : selected.status === "scheduled"
                      ? "neutral"
                      : "warn"
                }
              >
                {selected.status}
              </Status>
              <span>{selected.locationLabel}</span>
              <span>
                {selected.seriesId ? "Recurring series" : "Single lesson"}
              </span>
              <span>
                {paidByCredit
                  ? "Paid by credit"
                  : `${availableCredits} credits available`}
              </span>
            </div>
            <div className="form-actions">
              {panel === "credits" && (
                <button className="text-button" onClick={() => setPanel("details")}>
                  Back to lesson details
                </button>
              )}
              {panel === "details" && selected.status === "scheduled" && (
                <button className="primary" onClick={() => setPanel("reschedule")}>
                  Reschedule
                </button>
              )}
              {panel === "details" && (
                <button className="text-button" onClick={() => setPanel("credits")}>
                  Adjust credits
                </button>
              )}
              <button
                className="text-button"
                onClick={() =>
                  navigate(
                    `/coach/students/${selected.studentId}/lessons/${selected.id}`,
                  )
                }
              >
                Open lesson workspace
              </button>
              <button
                className="text-button"
                onClick={() =>
                  navigate(`/coach/students/${selected.studentId}/lessons`)
                }
              >
                Student history
              </button>
            </div>
            {panel === "details" && (
              <section className="lesson-facts" aria-label="Lesson information">
                <div>
                  <small>Date & time</small>
                  <strong>{new Date(selected.startsAt).toLocaleString()}</strong>
                </div>
                <div><small>Duration</small><strong>{selectedDuration} minutes</strong></div>
                <div><small>Delivery</small><strong>{selected.locationLabel}</strong></div>
                <div><small>Source</small><strong>{sourceLabel(selected.sourceProvider)}</strong></div>
                <div>
                  <small>Lesson work</small>
                  <strong>{selectedNotes} notes · {selectedPractice} practice · {selectedMaterials} files</strong>
                </div>
                <div>
                  <small>Payment</small>
                  <strong>{paidByCredit ? "Paid with lesson credit" : selected.packageId ? "Package attached" : "No credit applied"}</strong>
                </div>
              </section>
            )}
            {panel === "details" && selected.status === "scheduled" && !selected.seriesId && (
              <section className="lesson-command-section">
                <h3>Make recurring</h3>
                <p>Create the remaining occurrences in one DST-safe series.</p>
                <div className="inline-command">
                  <label>
                    Rhythm
                    <select
                      value={cadence}
                      onChange={(event) =>
                        setCadence(event.target.value as typeof cadence)
                      }
                    >
                      <option value="weekly">Weekly</option>
                      <option value="biweekly">Every other week</option>
                    </select>
                  </label>
                  <label>
                    Total lessons
                    <input
                      type="number"
                      min="2"
                      max="52"
                      value={occurrences}
                      onChange={(event) =>
                        setOccurrences(Number(event.target.value))
                      }
                    />
                  </label>
                  <button
                    disabled={
                      Boolean(busy) || occurrences < 2 || occurrences > 52
                    }
                    onClick={() => void makeRecurring()}
                  >
                    {busy === "recurring" ? "Creating…" : "Create series"}
                  </button>
                </div>
              </section>
            )}
            {panel === "credits" && <section className="lesson-command-section">
              <h3>Credits & payment</h3>
              <p>
                Adjust the student’s balance and attach the reason to this lesson.
                Positive numbers add credits; negative numbers remove them.
              </p>
              <div className="inline-command">
                <label>
                  Credits
                  <input
                    type="number"
                    min="-20"
                    max="20"
                    value={creditQuantity}
                    onChange={(event) =>
                      setCreditQuantity(Number(event.target.value))
                    }
                  />
                </label>
                <label>
                  Reason
                  <input
                    value={creditReason}
                    onChange={(event) => setCreditReason(event.target.value)}
                  />
                </label>
                <button
                  disabled={
                    Boolean(busy) ||
                    !creditQuantity ||
                    creditReason.trim().length < 3
                  }
                  onClick={() => void adjustLessonCredit()}
                >
                  {busy === "credit" ? "Saving…" : "Add adjustment"}
                </button>
              </div>
              {!paidByCredit && (
                <button
                  className="primary"
                  disabled={Boolean(busy) || availableCredits < 1}
                  onClick={() => void payWithCredit()}
                >
                  {busy === "pay-credit"
                    ? "Applying…"
                    : availableCredits > 0
                      ? "Use 1 credit for this lesson"
                      : "No credit available"}
                </button>
              )}
            </section>}
            {panel === "details" && selected.status === "scheduled" && (
              <div className="form-actions lesson-final-actions">
                <button
                  className="primary"
                  disabled={Boolean(busy)}
                  onClick={() => void update("completed")}
                >
                  {busy === "completed" ? "Saving…" : "Mark complete"}
                </button>
                {confirmCancel ? (
                  <>
                    <span>
                      This removes it from active calendars and sends the
                      cancellation to Google.
                    </span>
                    <button
                      className="danger-button"
                      disabled={Boolean(busy)}
                      onClick={() => void update("cancelled")}
                    >
                      {busy === "cancelled"
                        ? "Cancelling…"
                        : "Confirm cancellation"}
                    </button>
                    <button onClick={() => setConfirmCancel(false)}>
                      Keep lesson
                    </button>
                  </>
                ) : (
                  <button
                    className="danger-button"
                    onClick={() => setConfirmCancel(true)}
                  >
                    Cancel & remove lesson
                  </button>
                )}
              </div>
            )}
          </div>
          )}
        </Dialog>
      )}
    </Section>
  );
}
export function NotesView({
  data,
  isDemo = false,
}: {
  data: StudioSnapshot;
  isDemo?: boolean;
}) {
  const navigate = useNavigate(),
    store = useStudioStore(),
    queryClient = useQueryClient();
  const [query, setQuery] = useState(""),
    [status, setStatus] = useState("all"),
    [notice, setNotice] = useState(""),
    [deleting, setDeleting] = useState(""),
    [selected, setSelected] = useState<StudioSnapshot["notes"][number]>();
  const filtered = [...data.notes]
    .filter(
      (note) =>
        (status === "all" || note.status === status) &&
        [
          note.title,
          note.body,
          studentName(data, note.studentId),
          ...(note.tags || []),
        ]
          .join(" ")
          .toLowerCase()
          .includes(query.toLowerCase()),
    )
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const notePage = usePagedList(filtered);
  const remove = async (note: StudioSnapshot["notes"][number]) => {
    if (
      deleting ||
      !window.confirm(`Delete “${note.title}”? This cannot be undone.`)
    )
      return;
    setDeleting(note.id);
    try {
      if (isDemo)
        store.transact((draft) => {
          draft.notes = draft.notes.filter((item) => item.id !== note.id);
        });
      else {
        await studioCommand("notes", {
          command: "delete",
          entityId: note.id,
          expectedVersion: note.version,
          reason: "Coach deleted note",
        });
        await queryClient.invalidateQueries({ queryKey: ["studio"] });
      }
      setNotice("Note deleted.");
    } catch (reason) {
      setNotice(
        reason instanceof Error ? reason.message : "Note could not be deleted.",
      );
    } finally {
      setDeleting("");
    }
  };
  return (
    <Section title="Notes across the studio" marked>
      {notice && <p className="portal-notice">{notice}</p>}
      <div className="library-toolbar">
        <label>
          <Search />
          <input
            aria-label="Search notes"
            placeholder="Search notes or students…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <select
          aria-label="Note status"
          value={status}
          onChange={(event) => setStatus(event.target.value)}
        >
          <option value="all">All statuses</option>
          <option value="draft">Drafts</option>
          <option value="published">Published</option>
        </select>
      </div>
      <ListControls
        page={notePage.page}
        pageCount={notePage.pageCount}
        pageSize={notePage.pageSize}
        total={notePage.total}
        onPage={notePage.setPage}
        onPageSize={notePage.setPageSize}
        label="notes"
      />
      <div className="lesson-note-index">
        {notePage.visible.map((note) => (
          <button type="button" key={note.id} onClick={() => setSelected(note)}>
            <CalendarDays />
            <span>
              <strong>
                {note.lessonId
                  ? new Date(
                      data.lessons.find((item) => item.id === note.lessonId)
                        ?.startsAt || note.updatedAt,
                    ).toLocaleDateString()
                  : "General note"}
              </strong>
              <small>
                {studentName(data, note.studentId)} ·{" "}
                {data.lessons.find((item) => item.id === note.lessonId)
                  ?.topic || note.title}{" "}
                · {note.title}
              </small>
            </span>
            <Status tone={note.status === "published" ? "good" : "neutral"}>
              {note.status}
            </Status>
          </button>
        ))}
        {!filtered.length && (
          <EmptyState
            title="No notes yet"
            detail="Open a student record to save a private draft or publish follow-up."
          />
        )}
      </div>
      {selected && (
        <Dialog
          title={selected.title}
          description={`${studentName(data, selected.studentId)} · ${selected.lessonId ? new Date(data.lessons.find((item) => item.id === selected.lessonId)?.startsAt || selected.updatedAt).toLocaleString() : "General note"}`}
          onClose={() => setSelected(undefined)}
        >
          {selected.bodyHtml ? (
            <div
              className="rich-note-body"
              dangerouslySetInnerHTML={{
                __html: DOMPurify.sanitize(selected.bodyHtml),
              }}
            />
          ) : (
            <p>{selected.body}</p>
          )}
          <div className="form-actions">
            <button
              type="button"
              onClick={() => {
                setSelected(undefined);
                navigate(`/coach/students/${selected.studentId}/notes`);
              }}
            >
              Open student notes
            </button>
            <button
              type="button"
              className="danger-button"
              disabled={deleting === selected.id}
              onClick={() => {
                void remove(selected);
                setSelected(undefined);
              }}
            >
              <Trash2 />
              Delete note
            </button>
          </div>
        </Dialog>
      )}
    </Section>
  );
}
export function MaterialsView({
  data,
  isDemo,
}: {
  data: StudioSnapshot;
  isDemo: boolean;
}) {
  const navigate = useNavigate(),
    store = useStudioStore(),
    queryClient = useQueryClient(),
    [notice, setNotice] = useState(""),
    [deleting, setDeleting] = useState("");
  const archive = async (id: string) => {
    const current = data.materials.find((item) => item.id === id)!;
    try {
      if (isDemo)
        store.transact((draft) => {
          const item = draft.materials.find((i) => i.id === id)!;
          item.status = item.status === "active" ? "archived" : "active";
          item.version += 1;
        });
      else {
        await studioCommand("materials", {
          command: "update_status",
          entityId: id,
          expectedVersion: current.version,
          payload: {
            status: current.status === "active" ? "archived" : "active",
          },
          reason: "Coach updated material status",
        });
        await queryClient.invalidateQueries({ queryKey: ["studio"] });
      }
      setNotice("Material status updated.");
    } catch (reason) {
      setNotice(
        reason instanceof Error
          ? reason.message
          : "Material could not be updated.",
      );
    }
  };
  const review = async (
    id: string,
    status: "approved" | "changes_requested",
  ) => {
    const current = data.materials.find((item) => item.id === id)!;
    try {
      if (isDemo)
        store.transact((draft) => {
          const item = draft.materials.find((row) => row.id === id)!;
          item.approvalStatus = status;
          item.publicEmbed = status === "approved";
          item.version += 1;
        });
      else {
        await studioCommand("materials", {
          command: "approve",
          entityId: id,
          expectedVersion: current.version,
          payload: { status, publicEmbed: status === "approved" },
          reason: `Coach ${status} actor material`,
        });
        await queryClient.invalidateQueries({ queryKey: ["studio"] });
      }
      setNotice(`Material ${status.replaceAll("_", " ")}.`);
    } catch (reason) {
      setNotice(
        reason instanceof Error ? reason.message : "Material review failed.",
      );
    }
  };
  const remove = async (id: string) => {
    const current = data.materials.find((item) => item.id === id);
    if (
      !current ||
      deleting ||
      !window.confirm(
        `Permanently delete “${current.title}”? The uploaded file will also be removed and this cannot be undone.`,
      )
    )
      return;
    setDeleting(id);
    try {
      if (isDemo)
        store.transact((draft) => {
          draft.materials = draft.materials.filter((item) => item.id !== id);
        });
      else {
        await studioCommand("materials", {
          command: "delete",
          entityId: id,
          expectedVersion: current.version,
          reason: "Coach permanently deleted material",
        });
        await queryClient.invalidateQueries({ queryKey: ["studio"] });
      }
      setNotice("Material and uploaded file deleted.");
    } catch (reason) {
      setNotice(
        reason instanceof Error
          ? reason.message
          : "Material could not be deleted.",
      );
    } finally {
      setDeleting("");
    }
  };
  return (
    <Section title="Material library" marked>
      {notice && <p className="portal-notice">{notice}</p>}
      <div className="table-list">
        {data.materials.map((item) => (
          <article key={item.id}>
            <FolderOpen />
            <div>
              <strong>{item.title}</strong>
              <small>
                {studentName(data, item.studentId)} · {item.category} ·{" "}
                {item.role.replaceAll("_", " ")}
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
            <button
              onClick={() =>
                navigate(
                  `/coach/students/${item.studentId}/${item.role === "actor_material" ? "actor-page" : "work"}`,
                )
              }
            >
              Student
            </button>
            {item.approvalStatus === "pending_review" && (
              <>
                <button onClick={() => void review(item.id, "approved")}>
                  Approve for actor page
                </button>
                <button
                  onClick={() => void review(item.id, "changes_requested")}
                >
                  Request changes
                </button>
              </>
            )}
            <button onClick={() => void archive(item.id)}>
              {item.status === "active" ? "Archive" : "Restore"}
            </button>
            <button
              className="danger-button"
              disabled={deleting === item.id}
              onClick={() => void remove(item.id)}
            >
              <Trash2 />
              {deleting === item.id ? "Deleting…" : "Delete"}
            </button>
          </article>
        ))}
      </div>
    </Section>
  );
}
export function FinanceView({
  data,
  isDemo,
}: {
  data: StudioSnapshot;
  isDemo: boolean;
}) {
  const navigate = useNavigate(),
    store = useStudioStore(),
    queryClient = useQueryClient(),
    [dialog, setDialog] = useState<PackageDefinition | "new">(),
    [discountDialog, setDiscountDialog] = useState<DiscountCode | "new">(),
    [notice, setNotice] = useState("");
  const saveDiscount = async (value: DiscountCode) => {
    try {
      if (isDemo)
        store.transact((draft) => {
          const current = draft.discountCodes.find(
            (item) => item.id === value.id,
          );
          if (current)
            Object.assign(current, value, {
              version: current.version + 1,
              updatedAt: new Date().toISOString(),
            });
          else draft.discountCodes.push(value);
        });
      else {
        await studioCommand("discounts", {
          command: data.discountCodes.some((item) => item.id === value.id)
            ? "update"
            : "create",
          entityId: data.discountCodes.some((item) => item.id === value.id)
            ? value.id
            : undefined,
          expectedVersion:
            data.discountCodes.find((item) => item.id === value.id)?.version ??
            0,
          payload: value as unknown as Record<string, unknown>,
          reason: "Coach configured a booking discount",
        });
        await queryClient.invalidateQueries({ queryKey: ["studio"] });
      }
      setDiscountDialog(undefined);
      setNotice("Discount code saved and available to the booking checkout.");
    } catch (reason) {
      setNotice(
        reason instanceof Error
          ? reason.message
          : "Discount code could not be saved.",
      );
    }
  };
  const save = async (value: PackageDefinition) => {
    try {
      if (isDemo)
        store.transact((draft) => {
          const existing = draft.packageDefinitions.find(
            (item) => item.id === value.id,
          );
          if (existing)
            Object.assign(existing, value, {
              version: existing.version + 1,
              updatedAt: new Date().toISOString(),
            });
          else draft.packageDefinitions.push(value);
        });
      else {
        await studioCommand("packages", {
          command: data.packageDefinitions.some((item) => item.id === value.id)
            ? "update"
            : "create",
          entityId: data.packageDefinitions.some((item) => item.id === value.id)
            ? value.id
            : undefined,
          expectedVersion:
            data.packageDefinitions.find((item) => item.id === value.id)
              ?.version ?? 0,
          payload: value as unknown as Record<string, unknown>,
          reason: "Coach configured lesson package",
        });
        await queryClient.invalidateQueries({ queryKey: ["studio"] });
      }
      setDialog(undefined);
      setNotice("Package catalog saved.");
    } catch (reason) {
      setNotice(
        reason instanceof Error
          ? reason.message
          : "Package could not be saved.",
      );
    }
  };
  return (
    <div>
      {notice && (
        <p className="portal-notice" role="status">
          {notice}
        </p>
      )}
      <div className="two-section-grid">
        <Section
          title="Package catalog"
          marked
          aside={<button onClick={() => setDialog("new")}>Add package</button>}
        >
          <div className="table-list">
            {data.packageDefinitions.map((definition) => (
              <article key={definition.id}>
                <CircleDollarSign />
                <div>
                  <strong>{definition.name}</strong>
                  <small>
                    {definition.sessionCount} ×{" "}
                    {definition.sessionDurationMinutes} minutes ·{" "}
                    {formatMoney(definition.priceMinor, definition.currency)}
                  </small>
                </div>
                <Status
                  tone={
                    definition.active
                      ? definition.visibility === "public"
                        ? "good"
                        : "warn"
                      : "neutral"
                  }
                >
                  {definition.active ? definition.visibility : "archived"}
                </Status>
                <button onClick={() => setDialog(definition)}>Edit</button>
              </article>
            ))}
            {!data.packageDefinitions.length && (
              <EmptyState
                title="No package products"
                detail="Create reusable 4-, 6-, 8-, 10-, or custom-session packages here."
              />
            )}
          </div>
        </Section>
        <Section title="Student packages">
          <div className="table-list">
            {data.packages.map((pkg) => (
              <article key={pkg.id}>
                <CircleDollarSign />
                <div>
                  <strong>
                    {studentName(data, pkg.studentId)} · {pkg.name}
                  </strong>
                  <small>{formatMoney(pkg.priceMinor, pkg.currency)}</small>
                </div>
                <Status
                  tone={
                    packageSummary(pkg, data.creditEntries).remainingCredits <=
                    1
                      ? "warn"
                      : "good"
                  }
                >
                  {packageSummary(pkg, data.creditEntries).remainingCredits}{" "}
                  left
                </Status>
                <button
                  onClick={() =>
                    navigate(`/coach/students/${pkg.studentId}/payments`)
                  }
                >
                  Open
                </button>
              </article>
            ))}
            {!data.packages.length && (
              <EmptyState
                title="No student packages"
                detail="Purchased or coach-assigned package balances will appear here."
              />
            )}
          </div>
        </Section>
        <Section title="Balances">
          <div className="table-list">
            {data.students.map((student) => (
              <article key={student.id}>
                <CheckCircle2 />
                <div>
                  <strong>{student.fullName}</strong>
                  <small>Payments, refunds, and adjustments</small>
                </div>
                <strong>
                  {formatMoney(studentBalanceMinor(student.id, data.payments))}
                </strong>
                <button
                  onClick={() =>
                    navigate(`/coach/students/${student.id}/payments`)
                  }
                >
                  Open
                </button>
              </article>
            ))}
            {!data.students.length && (
              <EmptyState
                title="No balances yet"
                detail="Add a student to begin tracking charges, payments, refunds, and adjustments."
              />
            )}
          </div>
        </Section>
        <Section
          title="Coupons & discounts"
          marked
          aside={
            <button onClick={() => setDiscountDialog("new")}>
              Create code
            </button>
          }
        >
          <div className="table-list">
            {data.discountCodes.map((code) => (
              <article key={code.id}>
                <CircleDollarSign />
                <div>
                  <strong>{code.code}</strong>
                  <small>
                    {code.description || "Booking discount"} ·{" "}
                    {code.discountType === "percent"
                      ? `${code.amount}%`
                      : formatMoney(code.amount, code.currency)}{" "}
                    · {code.redemptionCount} used
                  </small>
                </div>
                <Status tone={code.active ? "good" : "neutral"}>
                  {code.active ? "active" : "inactive"}
                </Status>
                <button onClick={() => setDiscountDialog(code)}>Edit</button>
              </article>
            ))}
            {!data.discountCodes.length && (
              <EmptyState
                title="No discount codes"
                detail="Create optional codes that can apply to every service or selected services."
              />
            )}
          </div>
        </Section>
      </div>
      {dialog && (
        <PackageDefinitionDialog
          value={dialog === "new" ? undefined : dialog}
          data={data}
          onClose={() => setDialog(undefined)}
          onSave={(value) => void save(value)}
        />
      )}
      {discountDialog && (
        <DiscountDialog
          value={discountDialog === "new" ? undefined : discountDialog}
          data={data}
          onClose={() => setDiscountDialog(undefined)}
          onSave={(value) => void saveDiscount(value)}
        />
      )}
    </div>
  );
}

function DiscountDialog({
  value,
  data,
  onClose,
  onSave,
}: {
  value?: DiscountCode;
  data: StudioSnapshot;
  onClose: () => void;
  onSave: (value: DiscountCode) => void;
}) {
  const [form, setForm] = useState<DiscountCode>(() =>
    value
      ? structuredClone(value)
      : {
          id: `discount-${crypto.randomUUID()}`,
          studioId: data.studioId,
          code: "",
          description: "",
          discountType: "percent",
          amount: 10,
          currency: "USD",
          serviceIds: [],
          active: true,
          redemptionCount: 0,
          version: 1,
          updatedAt: new Date().toISOString(),
        },
  );
  const toggle = (id: string, checked: boolean) =>
    setForm({
      ...form,
      serviceIds: checked
        ? [...new Set([...form.serviceIds, id])]
        : form.serviceIds.filter((item) => item !== id),
    });
  return (
    <Dialog
      title={value ? `Edit ${value.code}` : "Create discount code"}
      description="Codes are validated on the server and snapshotted on each booking."
      onClose={onClose}
    >
      <form
        className="workflow-form"
        onSubmit={(event) => {
          event.preventDefault();
          onSave({ ...form, code: form.code.toUpperCase() });
        }}
      >
        <label>
          Code
          <input
            required
            minLength={3}
            value={form.code}
            onChange={(event) =>
              setForm({
                ...form,
                code: event.target.value
                  .toUpperCase()
                  .replace(/[^A-Z0-9_-]/g, ""),
              })
            }
            placeholder="WELCOME10"
          />
        </label>
        <label>
          Discount
          <select
            value={form.discountType}
            onChange={(event) =>
              setForm({
                ...form,
                discountType: event.target
                  .value as DiscountCode["discountType"],
              })
            }
          >
            <option value="percent">Percentage</option>
            <option value="fixed">Fixed USD amount</option>
          </select>
        </label>
        <label>
          Amount
          <input
            required
            type="number"
            min="1"
            max={form.discountType === "percent" ? 100 : 100000}
            value={
              form.discountType === "fixed" ? form.amount / 100 : form.amount
            }
            onChange={(event) =>
              setForm({
                ...form,
                amount:
                  form.discountType === "fixed"
                    ? Math.round(Number(event.target.value) * 100)
                    : Number(event.target.value),
              })
            }
          />
        </label>
        <label>
          Maximum uses
          <input
            type="number"
            min="1"
            value={form.maxRedemptions || ""}
            onChange={(event) =>
              setForm({
                ...form,
                maxRedemptions: event.target.value
                  ? Number(event.target.value)
                  : undefined,
              })
            }
          />
        </label>
        <label className="full">
          Description
          <input
            value={form.description}
            onChange={(event) =>
              setForm({ ...form, description: event.target.value })
            }
          />
        </label>
        <fieldset className="full option-fieldset">
          <legend>Eligible services</legend>
          <small>
            Leave every service unchecked to apply the code studio-wide.
          </small>
          {data.bookingServices.map((service) => (
            <label className="check-row" key={service.id}>
              <input
                type="checkbox"
                checked={form.serviceIds.includes(service.id)}
                onChange={(event) => toggle(service.id, event.target.checked)}
              />
              {service.name}
            </label>
          ))}
        </fieldset>
        <label className="check-row full">
          <input
            type="checkbox"
            checked={form.active}
            onChange={(event) =>
              setForm({ ...form, active: event.target.checked })
            }
          />
          Active
        </label>
        <div className="form-actions full">
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="primary">Save discount</button>
        </div>
      </form>
    </Dialog>
  );
}

function PackageDefinitionDialog({
  value,
  data,
  onClose,
  onSave,
}: {
  value?: PackageDefinition;
  data: StudioSnapshot;
  onClose: () => void;
  onSave: (value: PackageDefinition) => void;
}) {
  const [form, setForm] = useState<PackageDefinition>(() =>
      value
        ? structuredClone(value)
        : {
            id: `package-definition-${crypto.randomUUID()}`,
            studioId: data.studioId,
            name: "",
            description: "",
            sessionCount: 4,
            sessionDurationMinutes: 60,
            priceMinor: 0,
            discountMinor: 0,
            currency: "USD",
            expirationDays: 180,
            eligibleServiceIds: [],
            meetingProviders: ["google_meet", "in_person"],
            recurringEligible: true,
            visibility: "private",
            directPurchase: false,
            active: true,
            version: 1,
            updatedAt: new Date().toISOString(),
          },
    ),
    toggle = (items: string[], item: string, checked: boolean) =>
      checked
        ? [...new Set([...items, item])]
        : items.filter((current) => current !== item);
  return (
    <Dialog
      title={value ? "Edit package" : "Add package"}
      description="Package pricing is independent from single-session pricing. Stripe prices are created automatically for direct-purchase packages."
      onClose={onClose}
    >
      <form
        className="workflow-form"
        onSubmit={(event) => {
          event.preventDefault();
          onSave(form);
        }}
      >
        <label>
          Name
          <input
            required
            value={form.name}
            onChange={(event) => setForm({ ...form, name: event.target.value })}
          />
        </label>
        <label>
          Sessions
          <input
            required
            type="number"
            min="1"
            value={form.sessionCount}
            onChange={(event) =>
              setForm({ ...form, sessionCount: Number(event.target.value) })
            }
          />
        </label>
        <label>
          Session duration
          <input
            required
            type="number"
            min="15"
            step="15"
            value={form.sessionDurationMinutes}
            onChange={(event) =>
              setForm({
                ...form,
                sessionDurationMinutes: Number(event.target.value),
              })
            }
          />
        </label>
        <label>
          Package price (USD)
          <input
            required
            type="number"
            min="0"
            step="0.01"
            value={form.priceMinor / 100}
            onChange={(event) =>
              setForm({
                ...form,
                priceMinor: Math.round(Number(event.target.value) * 100),
              })
            }
          />
        </label>
        <label>
          Expires after days
          <input
            type="number"
            min="1"
            value={form.expirationDays ?? ""}
            onChange={(event) =>
              setForm({
                ...form,
                expirationDays: event.target.value
                  ? Number(event.target.value)
                  : undefined,
              })
            }
          />
        </label>
        <label>
          Visibility
          <select
            value={form.visibility}
            onChange={(event) =>
              setForm({
                ...form,
                visibility: event.target
                  .value as PackageDefinition["visibility"],
              })
            }
          >
            <option value="private">Private</option>
            <option value="public">Public</option>
          </select>
        </label>
        <label className="full">
          Description
          <textarea
            value={form.description}
            onChange={(event) =>
              setForm({ ...form, description: event.target.value })
            }
          />
        </label>
        <fieldset className="full option-fieldset">
          <legend>Eligible services</legend>
          {data.bookingServices.map((service) => (
            <label className="check-row" key={service.id}>
              <input
                type="checkbox"
                checked={form.eligibleServiceIds.includes(service.id)}
                onChange={(event) =>
                  setForm({
                    ...form,
                    eligibleServiceIds: toggle(
                      form.eligibleServiceIds,
                      service.id,
                      event.target.checked,
                    ),
                  })
                }
              />
              {service.name}
            </label>
          ))}
        </fieldset>
        <fieldset className="full option-fieldset">
          <legend>Meeting formats</legend>
          {(["google_meet", "in_person"] as const).map((provider) => (
            <label className="check-row" key={provider}>
              <input
                type="checkbox"
                checked={form.meetingProviders.includes(provider)}
                onChange={(event) =>
                  setForm({
                    ...form,
                    meetingProviders: toggle(
                      form.meetingProviders,
                      provider,
                      event.target.checked,
                    ) as PackageDefinition["meetingProviders"],
                  })
                }
              />
              {provider.replaceAll("_", " ")}
            </label>
          ))}
        </fieldset>
        <label className="check-row">
          <input
            type="checkbox"
            checked={form.recurringEligible}
            onChange={(event) =>
              setForm({ ...form, recurringEligible: event.target.checked })
            }
          />
          Allow recurring lessons
        </label>
        <label className="check-row">
          <input
            type="checkbox"
            checked={form.directPurchase}
            onChange={(event) =>
              setForm({ ...form, directPurchase: event.target.checked })
            }
          />
          Student can buy directly
        </label>
        <label className="check-row full">
          <input
            type="checkbox"
            checked={form.active}
            onChange={(event) =>
              setForm({ ...form, active: event.target.checked })
            }
          />
          Active package
        </label>
        <div className="form-actions full">
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="primary">Save package</button>
        </div>
      </form>
    </Dialog>
  );
}
export function ActorPagesView({
  data,
  isDemo,
}: {
  data: StudioSnapshot;
  isDemo: boolean;
}) {
  const store = useStudioStore(),
    navigate = useNavigate(),
    queryClient = useQueryClient(),
    [notice, setNotice] = useState("");
  const change = async (id: string, status: ActorProfileStatus) => {
    const profile = data.actorProfiles.find((item) => item.id === id)!;
    try {
      if (isDemo)
        store.transact((draft) => {
          const item = draft.actorProfiles.find((i) => i.id === id)!;
          item.status = status;
          item.version += 1;
          item.updatedAt = new Date().toISOString();
        });
      else {
        await studioCommand("actor-pages", {
          command: "review",
          entityId: id,
          expectedVersion: profile.version,
          payload: { status },
          reason: "Coach reviewed actor page",
        });
        await queryClient.invalidateQueries({ queryKey: ["studio"] });
      }
      setNotice(`Actor page marked ${status.replaceAll("_", " ")}.`);
    } catch (reason) {
      setNotice(
        reason instanceof Error
          ? reason.message
          : "Actor page could not be updated.",
      );
    }
  };
  return (
    <Section title="Publishing workflow" marked>
      {notice && <p className="portal-notice">{notice}</p>}
      <div className="table-list">
        {data.actorProfiles.map((profile) => (
          <article key={profile.id}>
            <UserRound />
            <div>
              <strong>{profile.displayName}</strong>
              <small>
                /actors/{profile.slug} · {studentName(data, profile.studentId)}
              </small>
            </div>
            <Status tone={profile.status === "published" ? "good" : "warn"}>
              {profile.status.replaceAll("_", " ")}
            </Status>
            <button
              onClick={() =>
                navigate(`/coach/students/${profile.studentId}/actor-page`)
              }
            >
              Open
            </button>
            {profile.status === "review_requested" && (
              <button onClick={() => void change(profile.id, "approved")}>
                Approve
              </button>
            )}
            {profile.status !== "published" && (
              <button onClick={() => void change(profile.id, "published")}>
                Publish
              </button>
            )}
            {profile.status === "published" && (
              <>
                <a
                  className="button-link"
                  href={`/actors/${profile.slug}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  View live page
                </a>
                <button
                  onClick={() => void change(profile.id, "changes_requested")}
                >
                  Unpublish
                </button>
              </>
            )}
          </article>
        ))}
        {!data.actorProfiles.length && (
          <EmptyState
            title="No actor pages"
            detail="Create a draft from an eligible student record."
          />
        )}
      </div>
    </Section>
  );
}
