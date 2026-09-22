import { useQueryClient } from "@tanstack/react-query";
import DOMPurify from "dompurify";
import {
  ArrowLeft,
  CalendarDays,
  CheckSquare,
  CircleDollarSign,
  FolderOpen,
  MessageSquare,
  Plus,
  Trash2,
} from "lucide-react";
import { useState, type FormEvent } from "react";
import { Link, Navigate, useNavigate, useParams } from "react-router-dom";
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
import { formatMoney, packageSummary } from "../../domain/finance";
import type { Lesson, Student } from "../../domain/model";
import { formatStudioDateTime } from "../../domain/presentation";
import { invalidateStudioDomains } from "../../hooks/useStudio";
import { useStudioStore } from "../../state/StudioStore";

import { belongsToStudent, type Data } from "./StudentWorkspace.shared";

export function Lessons({ data, student }: { data: Data; student: Student }) {
  const currentTime = Date.now();
  const lessons = data.lessons.filter((item) =>
    belongsToStudent(data, item, student.id),
  );
  const upcoming = lessons
    .filter(
      (lesson) =>
        lesson.status === "scheduled" &&
        new Date(lesson.startsAt).getTime() >= currentTime,
    )
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  const history = lessons
    .filter((lesson) => !upcoming.some((item) => item.id === lesson.id))
    .sort((a, b) => b.startsAt.localeCompare(a.startsAt));
  const upcomingPage = usePagedList(upcoming);
  const historyPage = usePagedList(history);
  const renderLesson = (lesson: Lesson) => (
    <Link
      className="student-roster-row"
      key={lesson.id}
      to={`/coach/students/${student.id}/lessons/${lesson.id}`}
    >
      <CalendarDays />
      <div>
        <strong>{lesson.topic}</strong>
        <small>
          {formatStudioDateTime(lesson.startsAt, data.settings.timezone)} ·{" "}
          {lesson.locationLabel}
        </small>
      </div>
      <Status
        tone={
          lesson.status === "completed"
            ? "good"
            : lesson.status === "scheduled"
              ? "neutral"
              : "warn"
        }
      >
        {lesson.status}
      </Status>
      <span className="open-label">Open</span>
    </Link>
  );
  return (
    <div>
      <Section title="Upcoming lessons" marked>
        {upcomingPage.total > 10 && (
          <ListControls
            page={upcomingPage.page}
            pageCount={upcomingPage.pageCount}
            pageSize={upcomingPage.pageSize}
            total={upcomingPage.total}
            onPage={upcomingPage.setPage}
            onPageSize={upcomingPage.setPageSize}
            label="upcoming lessons"
          />
        )}
        <div className="table-list">
          {upcomingPage.visible.map(renderLesson)}
          {!upcoming.length && (
            <EmptyState
              title="Nothing upcoming"
              detail="Add a lesson from the student header when the next date is ready."
            />
          )}
        </div>
      </Section>
      <Section
        title="Lesson history"
        aside={<span className="count">{history.length}</span>}
      >
        {historyPage.total > 10 && (
          <ListControls
            page={historyPage.page}
            pageCount={historyPage.pageCount}
            pageSize={historyPage.pageSize}
            total={historyPage.total}
            onPage={historyPage.setPage}
            onPageSize={historyPage.setPageSize}
            label="past lessons"
          />
        )}
        <div className="table-list">
          {historyPage.visible.map(renderLesson)}
          {!history.length && (
            <EmptyState
              title="No lesson history"
              detail="Completed and cancelled lessons will be kept here."
            />
          )}
        </div>
      </Section>
    </div>
  );
}
export function CoachLessonHub({
  data,
  student,
  isDemo,
  onAddNote,
  onAddAssignment,
  onAddMaterial,
}: {
  data: Data;
  student: Student;
  isDemo: boolean;
  onAddNote: (lessonId: string) => void;
  onAddAssignment: (lessonId: string) => void;
  onAddMaterial: (lessonId: string) => void;
}) {
  const { lessonId = "" } = useParams();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const store = useStudioStore();
  const lesson = data.lessons.find((item) => item.id === lessonId);
  const [notice, setNotice] = useState("");
  const [cancelling, setCancelling] = useState(false);
  const [lessonAction, setLessonAction] = useState<
    "details" | "reschedule" | "credits" | null
  >(null);
  const [actionBusy, setActionBusy] = useState("");
  const [creditQuantityText, setCreditQuantityText] = useState("1");
  const creditQuantity = Number(creditQuantityText);
  const validCreditQuantity =
    creditQuantityText.trim() !== "" &&
    Number.isInteger(creditQuantity) &&
    creditQuantity !== 0 &&
    Math.abs(creditQuantity) <= 20;
  const [creditReason, setCreditReason] = useState("Lesson-specific credit");
  const [paymentStatus, setPaymentStatus] = useState<
    NonNullable<Lesson["paymentStatus"]>
  >(lesson?.paymentStatus || "untracked");
  const [lessonPrice, setLessonPrice] = useState(
    lesson?.priceMinor == null ? "" : String(lesson.priceMinor / 100),
  );
  const [lessonPaid, setLessonPaid] = useState(
    String((lesson?.paidMinor || 0) / 100),
  );
  if (!lesson)
    return <Navigate to={`/coach/students/${student.id}/lessons`} replace />;
  const notes = data.notes.filter((item) => item.lessonId === lesson.id);
  const assignments = data.assignments.filter(
    (item) => item.lessonId === lesson.id,
  );
  const materials = data.materials.filter(
    (item) => item.lessonId === lesson.id,
  );
  const availableCredits = data.packages
    .filter((item) => item.studentId === student.id)
    .reduce(
      (total, item) =>
        total + packageSummary(item, data.creditEntries).remainingCredits,
      0,
    );
  const paidByCredit = data.creditEntries.some(
    (item) =>
      item.lessonId === lesson.id &&
      ["reservation", "consumption"].includes(item.kind),
  );
  const durationMinutes = Math.round(
    (new Date(lesson.endsAt).getTime() - new Date(lesson.startsAt).getTime()) /
      60_000,
  );
  const cancelLesson = async () => {
    if (
      cancelling ||
      !window.confirm(
        "Cancel and remove this lesson from active calendars? Google Calendar will be updated.",
      )
    )
      return;
    setCancelling(true);
    try {
      if (isDemo)
        store.transact((draft) => {
          const current = draft.lessons.find((item) => item.id === lesson.id);
          if (current) {
            current.status = "cancelled";
            current.version += 1;
          }
        });
      else {
        await studioCommand("lessons", {
          command: "cancel",
          entityId: lesson.id,
          expectedVersion: lesson.version,
          reason: "Coach cancelled lesson from lesson workspace",
        });
        await invalidateStudioDomains(queryClient, ["lessons"]);
      }
      navigate(`/coach/students/${student.id}/lessons`);
    } catch (reason) {
      setNotice(
        reason instanceof Error
          ? reason.message
          : "Lesson could not be cancelled.",
      );
    } finally {
      setCancelling(false);
    }
  };
  const rescheduleLesson = async (
    startsAt: string,
    endsAt: string,
    allowConflict = false,
  ) => {
    if (actionBusy) return;
    setActionBusy("reschedule");
    try {
      if (isDemo)
        store.transact((draft) => {
          const current = draft.lessons.find((item) => item.id === lesson.id);
          if (!current) return;
          current.startsAt = startsAt;
          current.endsAt = endsAt;
          current.version += 1;
          current.updatedAt = new Date().toISOString();
        });
      else {
        await studioCommand("lessons", {
          command: "reschedule",
          entityId: lesson.id,
          expectedVersion: lesson.version,
          payload: { startsAt, endsAt, allowConflict },
          reason: "Coach rescheduled lesson from student workspace",
        });
        await invalidateStudioDomains(queryClient, ["lessons"]);
      }
      setLessonAction(null);
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
      setActionBusy("");
    }
  };
  const updateLessonDetails = async (
    topic: string,
    locationLabel: string,
    joinUrl: string,
  ) => {
    if (actionBusy) return;
    setActionBusy("details");
    try {
      if (isDemo)
        store.transact((draft) => {
          const current = draft.lessons.find((item) => item.id === lesson.id);
          if (!current) return;
          current.topic = topic;
          current.locationLabel = locationLabel;
          current.joinUrl = joinUrl || undefined;
          current.version += 1;
          current.updatedAt = new Date().toISOString();
        });
      else {
        await studioCommand("lessons", {
          command: "update_details",
          entityId: lesson.id,
          expectedVersion: lesson.version,
          payload: { topic, locationLabel, joinUrl: joinUrl || null },
          reason: "Coach updated lesson details from student workspace",
        });
        await invalidateStudioDomains(queryClient, ["lessons"]);
      }
      setLessonAction(null);
      setNotice(
        "Lesson details saved. Calendar and student updates are queued.",
      );
    } catch (reason) {
      setNotice(
        reason instanceof Error
          ? reason.message
          : "Lesson details could not be saved.",
      );
    } finally {
      setActionBusy("");
    }
  };
  const adjustCredit = async () => {
    if (actionBusy || !validCreditQuantity || creditReason.trim().length < 3)
      return;
    setActionBusy("credit");
    try {
      await studioCommand("credits", {
        command: "grant",
        expectedVersion: 0,
        payload: {
          studentId: student.id,
          lessonId: lesson.id,
          quantity: creditQuantity,
          reason: creditReason.trim(),
        },
        reason: "Coach adjusted credit from lesson workspace",
      });
      await invalidateStudioDomains(queryClient, ["lessons", "finance"]);
      setLessonAction(null);
      setNotice("Credit adjustment saved on this lesson.");
    } catch (reason) {
      setNotice(
        reason instanceof Error
          ? reason.message
          : "Credit could not be adjusted.",
      );
    } finally {
      setActionBusy("");
    }
  };
  const applyCredit = async () => {
    if (actionBusy || availableCredits < 1 || paidByCredit) return;
    setActionBusy("use-credit");
    try {
      await studioCommand("credits", {
        command: "use_for_lesson",
        entityId: lesson.id,
        expectedVersion: lesson.version,
        payload: { reason: `Paid by credit for ${lesson.topic}` },
        reason: "Coach marked lesson paid by credit from lesson workspace",
      });
      await invalidateStudioDomains(queryClient, ["lessons", "finance"]);
      setLessonAction(null);
      setNotice(
        "One credit was used and this lesson is marked paid by credit.",
      );
    } catch (reason) {
      setNotice(
        reason instanceof Error ? reason.message : "Credit could not be used.",
      );
    } finally {
      setActionBusy("");
    }
  };
  const savePaymentStatus = async () => {
    if (actionBusy) return;
    setActionBusy("payment");
    const priceMinor =
      lessonPrice === "" ? undefined : Math.round(Number(lessonPrice) * 100);
    const paidMinor = Math.round(Number(lessonPaid || 0) * 100);
    try {
      if (isDemo)
        store.transact((draft) => {
          const item = draft.lessons.find((row) => row.id === lesson.id);
          if (item) {
            item.paymentStatus = paymentStatus;
            item.priceMinor = priceMinor;
            item.paidMinor = paidMinor;
            item.version += 1;
            item.updatedAt = new Date().toISOString();
          }
        });
      else {
        await studioCommand("lessons", {
          command: "set_payment_status",
          entityId: lesson.id,
          expectedVersion: lesson.version,
          payload: { paymentStatus, priceMinor, paidMinor },
          reason: "Coach updated lesson payment status",
        });
        await invalidateStudioDomains(queryClient, ["lessons", "finance"]);
      }
      setLessonAction(null);
      setNotice("Lesson payment status saved.");
    } catch (reason) {
      setNotice(
        reason instanceof Error
          ? reason.message
          : "Payment status could not be saved.",
      );
    } finally {
      setActionBusy("");
    }
  };
  return (
    <div>
      <Link
        className="back-button"
        to={`/coach/students/${student.id}/lessons`}
      >
        <ArrowLeft /> Lesson history
      </Link>
      <Section title={lesson.topic} marked>
        <p className="section-intro">
          {formatStudioDateTime(lesson.startsAt, data.settings.timezone)} ·{" "}
          {lesson.locationLabel} · {lesson.status}
        </p>
        <div className="form-actions lesson-primary-actions">
          {lesson.joinUrl && (
            <a
              className="button-link"
              href={lesson.joinUrl}
              target="_blank"
              rel="noreferrer"
            >
              Open Google Meet
            </a>
          )}
          {lesson.status === "scheduled" && (
            <button
              className="primary-button"
              onClick={() => setLessonAction("reschedule")}
            >
              <CalendarDays /> Reschedule
            </button>
          )}
        </div>
        <section className="lesson-facts" aria-label="Lesson information">
          <div>
            <small>Date & time</small>
            <strong>
              {formatStudioDateTime(lesson.startsAt, data.settings.timezone)}
            </strong>
          </div>
          <div>
            <small>Duration</small>
            <strong>{durationMinutes} minutes</strong>
          </div>
          <div>
            <small>Delivery</small>
            <strong>{lesson.locationLabel}</strong>
          </div>
          <div>
            <small>Lesson work</small>
            <strong>
              {notes.length} notes · {assignments.length} practice ·{" "}
              {materials.length} files
            </strong>
          </div>
        </section>
        <details className="lesson-admin-disclosure">
          <summary>Payment, credits &amp; lesson administration</summary>
          <div className="lesson-admin-summary">
            <div>
              <small>Source</small>
              <strong>
                {lesson.sourceProvider?.replaceAll("_", " ") || "Studio"}
              </strong>
            </div>
            <div>
              <small>Payment</small>
              <strong>
                {paidByCredit
                  ? "Paid with lesson credit"
                  : (lesson.paymentStatus || "untracked").replaceAll("_", " ")}
                {lesson.priceMinor != null
                  ? ` · ${formatMoney(lesson.priceMinor)}`
                  : ""}
              </strong>
            </div>
          </div>
          <div className="form-actions">
            <button onClick={() => setLessonAction("details")}>
              Edit lesson information
            </button>
            <button onClick={() => setLessonAction("credits")}>
              <CircleDollarSign /> Credits &amp; payment
            </button>
            {lesson.status === "scheduled" && (
              <button
                className="danger-button"
                disabled={cancelling}
                onClick={() => void cancelLesson()}
              >
                <Trash2 />
                {cancelling ? "Cancelling…" : "Cancel lesson"}
              </button>
            )}
          </div>
        </details>
      </Section>
      {notice && (
        <p className="portal-notice" role="status">
          {notice}
        </p>
      )}
      {lessonAction === "details" && (
        <Dialog
          title="Edit lesson information"
          description="Update the topic, confirmed location, or joining link."
          onClose={() => !actionBusy && setLessonAction(null)}
        >
          <LessonDetailsForm
            lesson={lesson}
            busy={actionBusy === "details"}
            onCancel={() => setLessonAction(null)}
            onSave={updateLessonDetails}
          />
        </Dialog>
      )}
      {lessonAction === "reschedule" && (
        <Dialog
          title="Reschedule lesson"
          description={`${student.preferredName || student.fullName} · ${lesson.topic}`}
          onClose={() => !actionBusy && setLessonAction(null)}
        >
          <RescheduleLessonForm
            lesson={lesson}
            studentName={student.preferredName || student.fullName}
            timezone={data.settings.timezone}
            cancellationWindowHours={
              data.settings.bookingDefaults.cancellationWindowHours
            }
            busy={actionBusy === "reschedule"}
            onCheckConflicts={(startsAt, endsAt) =>
              isDemo
                ? Promise.resolve(
                    data.lessons
                      .filter(
                        (item) =>
                          item.id !== lesson.id &&
                          item.status === "scheduled" &&
                          item.startsAt < endsAt &&
                          item.endsAt > startsAt,
                      )
                      .map((item) => ({
                        id: item.id,
                        summary: item.topic,
                        start: item.startsAt,
                        end: item.endsAt,
                      })),
                  )
                : checkSchedulingConflicts(startsAt, endsAt, lesson.id)
            }
            onCancel={() => setLessonAction(null)}
            onSubmit={rescheduleLesson}
          />
        </Dialog>
      )}
      {lessonAction === "credits" && (
        <Dialog
          title="Lesson credits"
          description={`${student.preferredName || student.fullName} · ${lesson.topic}`}
          onClose={() => !actionBusy && setLessonAction(null)}
        >
          <div className="workflow-content lesson-command-center">
            <div className="lesson-command-summary">
              <span>{availableCredits} credits available</span>
              <span>
                {paidByCredit
                  ? "This lesson is paid by credit"
                  : "No credit used for this lesson"}
              </span>
            </div>
            <section className="lesson-command-section">
              <p>
                Positive numbers add credits; negative numbers remove them. The
                reason stays attached to this lesson.
              </p>
              <div className="inline-command">
                <label>
                  Credits
                  <input
                    type="text"
                    inputMode="numeric"
                    value={creditQuantityText}
                    onChange={(event) =>
                      setCreditQuantityText(event.target.value)
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
                    Boolean(actionBusy) ||
                    !validCreditQuantity ||
                    creditReason.trim().length < 3
                  }
                  onClick={() => void adjustCredit()}
                >
                  {actionBusy === "credit" ? "Saving…" : "Save adjustment"}
                </button>
              </div>
            </section>
            {!paidByCredit && (
              <button
                className="primary-button"
                disabled={Boolean(actionBusy) || availableCredits < 1}
                onClick={() => void applyCredit()}
              >
                {actionBusy === "use-credit"
                  ? "Applying…"
                  : availableCredits
                    ? "Use 1 credit for this lesson"
                    : "No credit available"}
              </button>
            )}
            <section className="lesson-command-section">
              <h3>Payment status</h3>
              <div className="inline-command payment-status-command">
                <label>
                  Status
                  <select
                    value={paymentStatus}
                    onChange={(event) =>
                      setPaymentStatus(
                        event.target.value as typeof paymentStatus,
                      )
                    }
                  >
                    <option value="untracked">Not tracked</option>
                    <option value="due">Due</option>
                    <option value="partially_paid">Partially paid</option>
                    <option value="paid">Paid</option>
                    <option value="waived">Waived</option>
                    <option value="refunded">Refunded</option>
                  </select>
                </label>
                <label>
                  Lesson price (USD)
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={lessonPrice}
                    onChange={(event) => setLessonPrice(event.target.value)}
                  />
                </label>
                <label>
                  Amount paid (USD)
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={lessonPaid}
                    onChange={(event) => setLessonPaid(event.target.value)}
                  />
                </label>
                <button
                  disabled={Boolean(actionBusy)}
                  onClick={() => void savePaymentStatus()}
                >
                  {actionBusy === "payment" ? "Saving…" : "Save payment status"}
                </button>
              </div>
            </section>
          </div>
        </Dialog>
      )}
      <div className="lesson-hub-grid">
        <Section
          title="Notes"
          aside={
            <button onClick={() => onAddNote(lesson.id)}>
              <Plus /> Add note
            </button>
          }
        >
          <div className="note-cards">
            {notes.map((note) => (
              <article key={note.id}>
                <header>
                  <strong>{note.title}</strong>
                  <Status
                    tone={note.status === "published" ? "good" : "neutral"}
                  >
                    {note.status}
                  </Status>
                </header>
                <div
                  className="published-note-body"
                  dangerouslySetInnerHTML={{
                    __html: DOMPurify.sanitize(note.bodyHtml || note.body),
                  }}
                />
              </article>
            ))}
            {!notes.length && (
              <EmptyState
                title="No lesson notes"
                detail="Capture a private draft or publish a note from this lesson."
              />
            )}
          </div>
        </Section>
        <Section
          title="Practice"
          aside={
            <button onClick={() => onAddAssignment(lesson.id)}>
              <Plus /> Assign practice
            </button>
          }
        >
          <div className="table-list">
            {assignments.map((item) => (
              <article key={item.id}>
                <CheckSquare />
                <div>
                  <strong>{item.title}</strong>
                  <small>{item.details}</small>
                </div>
                <Status tone={item.helpRequested ? "warn" : "neutral"}>
                  {item.helpRequested
                    ? "help requested"
                    : item.status.replaceAll("_", " ")}
                </Status>
              </article>
            ))}
            {!assignments.length && (
              <EmptyState
                title="No linked practice"
                detail="Give the student a clear next action from this lesson."
              />
            )}
          </div>
        </Section>
        <Section
          title="Attachments"
          aside={
            <button onClick={() => onAddMaterial(lesson.id)}>
              <Plus /> Attach resource
            </button>
          }
        >
          <div className="table-list">
            {materials.map((item) => (
              <article key={item.id}>
                <FolderOpen />
                <div>
                  <strong>{item.title}</strong>
                  <small>{item.category}</small>
                </div>
                {item.externalUrl && (
                  <a
                    className="button-link"
                    href={item.externalUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Open
                  </a>
                )}
              </article>
            ))}
            {!materials.length && (
              <EmptyState
                title="No attachments"
                detail="Attach a private file or link without leaving the lesson."
              />
            )}
          </div>
        </Section>
        <Section title="Conversation">
          <p className="section-intro">
            Keep lesson follow-up in the student’s private studio conversation.
          </p>
          <Link
            className="button-link primary"
            to={`/coach/inbox?student=${encodeURIComponent(student.id)}`}
          >
            <MessageSquare />
            Open conversation
          </Link>
        </Section>
      </div>
    </div>
  );
}

function LessonDetailsForm({
  lesson,
  busy,
  onCancel,
  onSave,
}: {
  lesson: Lesson;
  busy: boolean;
  onCancel: () => void;
  onSave: (topic: string, locationLabel: string, joinUrl: string) => void;
}) {
  const [topic, setTopic] = useState(lesson.topic);
  const [locationLabel, setLocationLabel] = useState(lesson.locationLabel);
  const [joinUrl, setJoinUrl] = useState(lesson.joinUrl || "");
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!topic.trim() || !locationLabel.trim() || busy) return;
    onSave(topic.trim(), locationLabel.trim(), joinUrl.trim());
  };
  return (
    <form className="workflow-form" onSubmit={submit}>
      <label className="full">
        Lesson topic
        <input
          value={topic}
          onChange={(event) => setTopic(event.target.value)}
          required
        />
      </label>
      <label className="full">
        Location or delivery label
        <input
          value={locationLabel}
          onChange={(event) => setLocationLabel(event.target.value)}
          placeholder="Google Meet or confirmed studio address"
          required
        />
      </label>
      <label className="full">
        Join link (optional)
        <input
          type="url"
          value={joinUrl}
          onChange={(event) => setJoinUrl(event.target.value)}
          placeholder="https://meet.google.com/…"
        />
      </label>
      <div className="form-actions full">
        <button type="button" disabled={busy} onClick={onCancel}>
          Cancel
        </button>
        <button
          className="primary-button"
          disabled={busy || !topic.trim() || !locationLabel.trim()}
        >
          {busy ? "Saving…" : "Save lesson information"}
        </button>
      </div>
    </form>
  );
}
