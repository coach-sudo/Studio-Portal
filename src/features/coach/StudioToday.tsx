import { useQueryClient } from "@tanstack/react-query";
import {
  CalendarDays,
  CheckCircle2,
  FileText,
  FolderOpen,
  UserRound,
} from "lucide-react";
import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import {
  Dialog,
  EmptyState,
  ListControls,
  Section,
  Status,
  usePagedList,
} from "../../components/Primitives";
import { RescheduleLessonForm } from "../../components/RescheduleLessonForm";
import {
  checkSchedulingConflicts,
  studioCommand,
} from "../../data/bookingCommands";
import { staleReviewPayload } from "../../domain/intakeRecency";
import type {
  IntegrationImport,
  Lesson,
  StudioSnapshot,
} from "../../domain/model";
import {
  formatStudioDateTime,
  formatStudioTime,
  studioDateKey,
} from "../../domain/presentation";
import { invalidateStudioDomains } from "../../hooks/useStudio";
import { useStudioStore } from "../../state/StudioStore";

import { sourceLabel, studentName } from "./StudioOperations.shared";

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
  const today = studioDateKey(new Date(), data.settings.timezone);
  const lessons = data.lessons
    .filter(
      (i) =>
        i.status === "scheduled" &&
        studioDateKey(i.startsAt, data.settings.timezone) === today,
    )
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  const now = Date.now();
  const featuredLessonId =
    lessons.find(
      (lesson) =>
        new Date(lesson.startsAt).getTime() <= now &&
        new Date(lesson.endsAt).getTime() >= now,
    )?.id ||
    lessons.find((lesson) => new Date(lesson.startsAt).getTime() >= now)?.id;
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
      .filter(
        (item) =>
          item.status === "needs_review" && !staleReviewPayload(item.payload),
      )
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
        await invalidateStudioDomains(queryClient, ["lessons"]);
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
    await invalidateStudioDomains(queryClient, ["students", "administration"]);
    setNotice(
      "The provider signal was reviewed and the student record was updated.",
    );
  };
  const reschedule = async (
    startsAt: string,
    endsAt: string,
    allowConflict = false,
  ) => {
    if (!rescheduling || rescheduleBusy) return;
    setRescheduleBusy(true);
    try {
      if (isDemo)
        store.transact((draft) => {
          const item = draft.lessons.find(
            (lesson) => lesson.id === rescheduling.id,
          );
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
          payload: { startsAt, endsAt, allowConflict },
          reason: "Coach rescheduled lesson from Today",
        });
        await invalidateStudioDomains(queryClient, ["lessons"]);
      }
      setRescheduling(undefined);
      setNotice(
        "Lesson rescheduled. Calendar and student invitation updates are queued.",
      );
    } catch (reason) {
      setNotice(
        reason instanceof Error
          ? reason.message
          : "Lesson could not be rescheduled.",
      );
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
        await invalidateStudioDomains(queryClient, ["lessons"]);
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
      <Section title="Today’s lessons" marked>
        {notice && <p className="portal-notice">{notice}</p>}
        <div className="workflow-list">
          {lessons.map((lesson, index) => {
            const isActive =
              new Date(lesson.startsAt).getTime() <= now &&
              new Date(lesson.endsAt).getTime() >= now;
            const isFeatured = lesson.id === featuredLessonId;
            return (
              <article
                key={lesson.id}
                className={`today-lesson-row${isFeatured ? " featured" : ""}`}
              >
                <span>{index + 1}</span>
                <div className="today-lesson-copy">
                  <strong>
                    {studentName(data, lesson.studentId)} · {lesson.topic}
                  </strong>
                  <small>
                    {formatStudioTime(lesson.startsAt, data.settings.timezone)}{" "}
                    · {lesson.locationLabel} ·{" "}
                    {sourceLabel(lesson.sourceProvider)}
                  </small>
                  <div
                    className="today-prep-checks"
                    aria-label={`Preparation for ${studentName(data, lesson.studentId)}`}
                  >
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
                  </div>
                </div>
                <Status
                  tone={isActive ? "warn" : isFeatured ? "good" : "neutral"}
                >
                  {isActive ? "in progress" : isFeatured ? "next" : "scheduled"}
                </Status>
                <div className="row-actions">
                  <button onClick={() => setRescheduling(lesson)}>
                    Reschedule
                  </button>
                  <button onClick={() => void complete(lesson)}>
                    Complete
                  </button>
                </div>
              </article>
            );
          })}
          {!lessons.length && (
            <EmptyState
              title="The rest of today is clear"
              detail="Only today’s scheduled lessons appear here. Use Home for the week ahead."
            />
          )}
        </div>
      </Section>
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
                      : `Overdue since ${formatStudioDateTime(due, data.settings.timezone)}`}
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
            Everything waiting for a coach decision is collected here; the full
            record remains in its natural workspace.
          </p>
          <div className="table-list">
            {pendingMaterials.map((item) => (
              <article key={`material-${item.id}`}>
                <FolderOpen />
                <div>
                  <strong>Review {item.title}</strong>
                  <small>
                    {studentName(data, item.studentId)} · actor material
                  </small>
                </div>
                <Status tone="warn">approval</Status>
                <button onClick={() => navigate("/coach/materials")}>
                  Review
                </button>
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
                <button onClick={() => navigate("/coach/actor-pages")}>
                  Review
                </button>
              </article>
            ))}
            {helpRequests.map((item) => (
              <article key={`help-${item.id}`}>
                <CheckCircle2 />
                <div>
                  <strong>
                    {studentName(data, item.studentId)} asked for help
                  </strong>
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
                  <strong>
                    {item.guestName} · {item.reference}
                  </strong>
                  <small>Booking or integration delivery needs attention</small>
                </div>
                <Status tone="warn">resolve</Status>
                <button onClick={() => navigate("/coach/bookings")}>
                  Open
                </button>
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
            cancellationWindowHours={
              data.settings.bookingDefaults.cancellationWindowHours
            }
            busy={rescheduleBusy}
            onCheckConflicts={(startsAt, endsAt) =>
              isDemo
                ? Promise.resolve(
                    data.lessons
                      .filter(
                        (lesson) =>
                          lesson.id !== rescheduling.id &&
                          lesson.status === "scheduled" &&
                          lesson.startsAt < endsAt &&
                          lesson.endsAt > startsAt,
                      )
                      .map((lesson) => ({
                        id: lesson.id,
                        summary: lesson.topic,
                        start: lesson.startsAt,
                        end: lesson.endsAt,
                      })),
                  )
                : checkSchedulingConflicts(startsAt, endsAt, rescheduling.id)
            }
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
              {formatStudioDateTime(candidate.startsAt, data.settings.timezone)}{" "}
              –{" "}
              {candidate.endsAt
                ? formatStudioTime(candidate.endsAt, data.settings.timezone)
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
