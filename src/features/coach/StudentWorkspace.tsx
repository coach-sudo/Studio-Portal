import {
  ArrowLeft,
  CalendarDays,
  CheckSquare,
  CircleDollarSign,
  FileText,
  FolderOpen,
  Mail,
  MessageSquare,
  Plus,
  RotateCcw,
  Search,
  Trash2,
  UserRound,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import DOMPurify from "dompurify";
import { useQueryClient } from "@tanstack/react-query";
import {
  Link,
  NavLink,
  Navigate,
  Route,
  Routes,
  useNavigate,
  useParams,
} from "react-router-dom";
import {
  Dialog,
  EmptyState,
  ListControls,
  Section,
  Status,
  Toggle,
  usePagedList,
} from "../../components/Primitives";
import {
  formatMoney,
  packageSummary,
  studentBalanceMinor,
} from "../../domain/finance";
import type {
  Assignment,
  Lesson,
  Material,
  Note,
  Student,
  StudentStatus,
  StudioSnapshot,
} from "../../domain/model";
import { useStudio } from "../../hooks/useStudio";
import { useStudioStore } from "../../state/StudioStore";
import { checkSchedulingConflicts, studioCommand } from "../../data/bookingCommands";
import { uploadStudioFile } from "../../data/uploads";
import { RescheduleLessonForm } from "../../components/RescheduleLessonForm";
import { ActorProfilePreview } from "../../components/ActorProfilePreview";
import {
  formatStudioDate,
  formatStudioDateTime,
} from "../../domain/presentation";
import { useStudioMutation } from "../../hooks/useStudioMutation";

const uid = (prefix: string) => `${prefix}-${crypto.randomUUID()}`;
const now = () => new Date().toISOString();
const belongsToStudent = (data: Data, lesson: Lesson, studentId: string) =>
  lesson.studentId === studentId ||
  data.lessonParticipants.some(
    (participant) =>
      participant.lessonId === lesson.id && participant.studentId === studentId,
  );

export function StudentWorkspace() {
  const { studentId = "" } = useParams();
  const { data, isDemo } = useStudio();
  const store = useStudioStore();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [dialog, setDialog] = useState<
    | "edit"
    | "lesson"
    | "assignment"
    | "material"
    | "actor-material"
    | "note"
    | null
  >(null);
  const [editingNote, setEditingNote] = useState<Note>();
  const [notice, setNotice] = useState("");
  const studentMutation = useStudioMutation();
  const [settingCredentials, setSettingCredentials] = useState(false);
  const [undoInvite, setUndoInvite] = useState<string>();
  const [removingStudent, setRemovingStudent] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const student = data?.students.find((item) => item.id === studentId);
  if (!data) return <div className="loading">Opening student record…</div>;
  if (!student) return <Navigate to="/coach/students" replace />;

  const base = `/coach/students/${student.id}`;
  const studentLessons = data.lessons
    .filter((item) => belongsToStudent(data, item, student.id))
    .sort((a, b) => b.startsAt.localeCompare(a.startsAt));
  const tabs = [
    ["", "Overview"],
    ["lessons", "Lessons"],
    ["work", "Current work"],
    ["notes", "Notes"],
    ["account", "Account"],
    ["payments", "Payments"],
    ["actor-page", "Actor page"],
  ] as const;
  const saveStudent = async (updates: Partial<Student>) => {
    if (studentMutation.isPending()) return;
    setNotice("Saving student details…");
    try {
      await studentMutation.run("student-details", async () => {
        if (isDemo)
          store.transact((draft) =>
            Object.assign(
              draft.students.find((item) => item.id === student.id)!,
              updates,
              { version: student.version + 1, updatedAt: now() },
            ),
          );
        else {
          await studioCommand("students", {
            command: "update",
            entityId: student.id,
            expectedVersion: student.version,
            payload: updates as Record<string, unknown>,
            reason: "Coach updated student record",
          });
          await queryClient.invalidateQueries({ queryKey: ["studio"] });
        }
      });
      setDialog(null);
      setNotice("Student details saved.");
    } catch (reason) {
      setNotice(
        reason instanceof Error
          ? reason.message
          : "Student details could not be saved.",
      );
    }
  };
  const sendPortalInvite = async (accountType: "student" | "guardian", linkedContactId?: string) => {
    if (settingCredentials) return;
    setSettingCredentials(true);
    setNotice("Generating a secure one-time login and queueing the invitation…");
    try {
      if (isDemo) {
        store.transact((draft) => {
          const item = draft.students.find((row) => row.id === student.id)!;
          item.portalUsername ||= item.fullName
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, ".")
            .replace(/^\.|\.$/g, "");
          item.portalEnabled = true;
          item.version += 1;
          item.updatedAt = now();
        });
      } else {
        const result = await studioCommand("students", {
          command: "invite",
          entityId: student.id,
          expectedVersion: student.version,
          payload: { accountType, linkedContactId },
          reason: `Coach granted ${accountType} portal access and sent the invitation`,
        });
        if (result.outboxMessageId) {
          setUndoInvite(result.outboxMessageId);
          window.setTimeout(() => setUndoInvite((current) => current === result.outboxMessageId ? undefined : current), 8_000);
        }
        await queryClient.invalidateQueries({ queryKey: ["studio"] });
      }
      setNotice(
        `${accountType === "guardian" ? "Linked-contact" : "Student"} invitation is sending now. The audited queue remains available as automatic retry protection.`,
      );
    } catch (reason) {
      setNotice(
        reason instanceof Error
          ? reason.message
          : "The portal invitation could not be sent.",
      );
    } finally {
      setSettingCredentials(false);
    }
  };
  const undoPortalInvite = async () => {
    if (!undoInvite) return;
    const messageId = undoInvite;
    setUndoInvite(undefined);
    try {
      await studioCommand("outbox", { command: "cancel_manual", entityId: messageId, expectedVersion: 1, reason: "Coach undid portal invitation email" });
      await queryClient.invalidateQueries({ queryKey: ["studio"] });
      setNotice("Invitation email send undone. Portal access remains available.");
    } catch (reason) { setNotice(reason instanceof Error ? reason.message : "The invitation has already started sending."); }
  };
  const addLesson = async (
    lesson: Lesson,
    recurrence: "none" | "weekly" | "biweekly" = "none",
    occurrenceCount = 1,
  ) => {
    try {
      if (isDemo) store.transact((draft) => draft.lessons.push(lesson));
      else {
        await studioCommand("lessons", {
          command: "create",
          expectedVersion: 0,
          payload: {
            studentId: student.id,
            studentName: student.fullName,
            studentEmail: student.email,
            topic: lesson.topic,
            startsAt: lesson.startsAt,
            endsAt: lesson.endsAt,
            locationType: lesson.locationType,
            locationLabel: lesson.locationLabel,
            recurrence,
            occurrenceCount,
            timezone: data.settings.timezone,
          },
          reason: "Coach created lesson",
        });
        void queryClient.invalidateQueries({ queryKey: ["studio"] });
      }
      setDialog(null);
      setNotice("Lesson added to the schedule.");
    } catch (reason) {
      setNotice(
        reason instanceof Error
          ? reason.message
          : "Lesson could not be created.",
      );
    }
  };
  const addAssignment = async (assignment: Assignment) => {
    try {
      if (isDemo) store.transact((draft) => draft.assignments.push(assignment));
      else {
        await studioCommand("work", {
          command: "create",
          expectedVersion: 0,
          payload: {
            studentId: student.id,
            lessonId: assignment.lessonId,
            title: assignment.title,
            details: assignment.details,
            dueAt: assignment.dueAt,
            activityType: assignment.activityType,
            activityConfig: assignment.activityConfig,
          },
          reason: "Coach assigned practice",
        });
        await queryClient.invalidateQueries({ queryKey: ["studio"] });
      }
      setDialog(null);
      setNotice("Practice assigned and visible in the student workspace.");
    } catch (reason) {
      setNotice(
        reason instanceof Error
          ? reason.message
          : "Practice could not be assigned.",
      );
    }
  };
  const addMaterial = async (material: Material) => {
    try {
      if (isDemo) store.transact((draft) => draft.materials.push(material));
      else {
        await studioCommand("materials", {
          command: "create",
          expectedVersion: 0,
          payload: {
            studentId: student.id,
            title: material.title,
            category: material.category,
            lessonId: material.lessonId,
            externalUrl: material.externalUrl,
            storagePath: material.storagePath,
            role: material.role,
            caption: material.caption,
            mimeType: material.mimeType,
            fileSizeBytes: material.fileSizeBytes,
            mediaKind: material.mediaKind,
            publicEmbed: material.publicEmbed,
          },
          reason: "Coach added student material",
        });
        void queryClient.invalidateQueries({ queryKey: ["studio"] });
      }
      setDialog(null);
      setNotice("Material added to the student record.");
    } catch (reason) {
      setNotice(
        reason instanceof Error
          ? reason.message
          : "Material could not be added.",
      );
    }
  };
  const addNote = async (note: Note) => {
    try {
      const existing = data.notes.find((item) => item.id === note.id);
      if (isDemo)
        store.transact((draft) => {
          const current = draft.notes.find((item) => item.id === note.id);
          if (current) Object.assign(current, note, { version: current.version + 1 });
          else draft.notes.push(note);
        });
      else {
        await studioCommand("notes", {
          command: existing ? "update" : "create",
          entityId: existing?.id,
          expectedVersion: existing?.version ?? 0,
          payload: {
            studentId: student.id,
            lessonId: note.lessonId,
            title: note.title,
            body: note.body,
            bodyHtml: note.bodyHtml,
            richContent: note.richContent,
            status: note.status,
          },
          reason: "Coach created student note",
        });
        void queryClient.invalidateQueries({ queryKey: ["studio"] });
      }
      setDialog(null);
      setEditingNote(undefined);
      setNotice(
        note.status === "published"
          ? "Note published to the student."
          : "Private draft saved.",
      );
    } catch (reason) {
      setNotice(
        reason instanceof Error ? reason.message : "Note could not be saved.",
      );
    }
  };
  const deleteNote = async (note: Note) => {
    if (!window.confirm(`Delete “${note.title}”? This cannot be undone.`))
      return;
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
          reason: "Coach deleted student note",
        });
        await queryClient.invalidateQueries({ queryKey: ["studio"] });
      }
      setNotice("Note deleted.");
    } catch (reason) {
      setNotice(
        reason instanceof Error ? reason.message : "Note could not be deleted.",
      );
    }
  };
  const updateMaterialStatus = async (material: Material) => {
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
      else {
        await studioCommand("materials", {
          command: "update_status",
          entityId: material.id,
          expectedVersion: material.version,
          payload: { status },
          reason: "Coach updated student material status",
        });
        await queryClient.invalidateQueries({ queryKey: ["studio"] });
      }
      setNotice(
        status === "archived"
          ? "Material archived."
          : "Material restored to current work.",
      );
    } catch (reason) {
      setNotice(
        reason instanceof Error
          ? reason.message
          : "Material could not be updated.",
      );
    }
  };
  const deleteMaterial = async (material: Material) => {
    if (
      !window.confirm(
        `Permanently delete “${material.title}”? The uploaded file will also be removed.`,
      )
    )
      return;
    try {
      if (isDemo)
        store.transact((draft) => {
          draft.materials = draft.materials.filter(
            (item) => item.id !== material.id,
          );
        });
      else {
        await studioCommand("materials", {
          command: "delete",
          entityId: material.id,
          expectedVersion: material.version,
          reason: "Coach permanently deleted student material",
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
    }
  };
  const removeStudent = async () => {
    if (removingStudent) return;
    setRemovingStudent(true);
    try {
      if (isDemo)
        store.transact((draft) => {
          draft.students = draft.students.filter(
            (item) => item.id !== student.id,
          );
          draft.lessons = draft.lessons.filter(
            (item) => item.studentId !== student.id,
          );
        });
      else
        await studioCommand("students", {
          command: "remove",
          entityId: student.id,
          expectedVersion: student.version,
          reason: "Coach removed student from the studio",
        });
      await queryClient.invalidateQueries({ queryKey: ["studio"] });
      navigate("/coach/students", { replace: true });
    } catch (reason) {
      setNotice(
        reason instanceof Error
          ? reason.message
          : "Student could not be removed.",
      );
      setConfirmRemove(false);
    } finally {
      setRemovingStudent(false);
    }
  };

  return (
    <div className="page student-record-page">
      <header className="student-record-header">
        <button
          className="back-button"
          onClick={() => navigate("/coach/students")}
        >
          <ArrowLeft />
          Students
        </button>
        <div className="student-record-identity">
          <span className="avatar large">
            {student.fullName
              .split(" ")
              .map((part) => part[0])
              .join("")}
          </span>
          <div>
            <div className="eyebrow">Student record</div>
            <h1>{student.fullName}</h1>
            <p>
              {student.focusArea || "Focus not set"} ·{" "}
              {student.email || student.guardianEmail || "No email on file"}
            </p>
          </div>
          <Status
            tone={
              student.status === "active"
                ? "good"
                : student.status === "lead"
                  ? "warn"
                  : "neutral"
            }
          >
            {student.status}
          </Status>
        </div>
        <div className="record-actions">
          <button onClick={() => setDialog("edit")}>Edit details</button>
          <button onClick={() => setDialog("lesson")}>
            <Plus />
            Add lesson
          </button>
          {student.email && (
            <Link className="button-link" to={`/coach/inbox?student=${encodeURIComponent(student.id)}`}>
              <MessageSquare />
              Message
            </Link>
          )}
          {student.email && (
            <Link className="button-link primary" to={`/coach/inbox?student=${encodeURIComponent(student.id)}&email=1`}>
              <Mail />
              Email
            </Link>
          )}
          <button
            className="danger-button"
            onClick={() => setConfirmRemove(true)}
          >
            <Trash2 />
            Remove student
          </button>
        </div>
      </header>
      {notice && (
        <p className="portal-notice" role="status">
          {notice}
        </p>
      )}
      {undoInvite && <div className="undo-send" role="status"><span>Invitation email queued</span><button onClick={() => void undoPortalInvite()}><RotateCcw />Undo</button></div>}
      <nav className="record-tabs" aria-label={`${student.fullName} sections`}>
        {tabs.map(([path, label]) => (
          <NavLink
            key={path}
            to={`${base}${path ? `/${path}` : ""}`}
            end={!path}
          >
            {label}
          </NavLink>
        ))}
      </nav>
      <Routes>
        <Route
          index
          element={
            <Overview
              data={data}
              student={student}
              onAddAssignment={() => setDialog("assignment")}
              onAddMaterial={() => setDialog("material")}
            />
          }
        />
        <Route
          path="lessons"
          element={<Lessons data={data} student={student} />}
        />
        <Route
          path="lessons/:lessonId"
          element={
            <CoachLessonHub data={data} student={student} isDemo={isDemo} />
          }
        />
        <Route
          path="work"
          element={
            <Work
              data={data}
              student={student}
              onAddAssignment={() => setDialog("assignment")}
              onAddMaterial={() => setDialog("material")}
              onArchiveMaterial={updateMaterialStatus}
              onDeleteMaterial={deleteMaterial}
            />
          }
        />
        <Route
          path="notes"
          element={
            <Notes
              data={data}
              student={student}
              onAdd={() => setDialog("note")}
              onEdit={(note) => {
                setEditingNote(note);
                setDialog("note");
              }}
              onDelete={deleteNote}
            />
          }
        />
        <Route
          path="account"
          element={
            <Account
              data={data}
              student={student}
              isDemo={isDemo}
              onSave={saveStudent}
              onInvite={sendPortalInvite}
              settingCredentials={settingCredentials}
            />
          }
        />
        <Route path="contacts/:contactId" element={<HouseholdContactProfile data={data} student={student} />} />
        <Route
          path="payments"
          element={<Payments data={data} student={student} isDemo={isDemo} />}
        />
        <Route
          path="actor-page"
          element={
            <ActorPage
              data={data}
              student={student}
              isDemo={isDemo}
              onAddMaterial={() => setDialog("actor-material")}
            />
          }
        />
        <Route path="*" element={<Navigate to={base} replace />} />
      </Routes>
      {dialog === "edit" && (
        <StudentEditor
          student={student}
          saving={studentMutation.isPending("student-details")}
          onClose={() => setDialog(null)}
          onSave={saveStudent}
        />
      )}
      {confirmRemove && (
        <Dialog
          title="Remove student from the studio?"
          description="This is different from inactive status."
          onClose={() => setConfirmRemove(false)}
        >
          <div className="workflow-content">
            <p>
              <strong>{student.fullName}</strong> will lose portal access.
              Future lessons will be cancelled and removed from active
              calendars. Past lessons, payments, credits, and audit history stay
              preserved.
            </p>
            <div className="form-actions">
              <button type="button" onClick={() => setConfirmRemove(false)}>
                Keep student
              </button>
              <button
                type="button"
                className="danger-button"
                disabled={removingStudent}
                onClick={() => void removeStudent()}
              >
                {removingStudent ? "Removing…" : "Remove student"}
              </button>
            </div>
          </div>
        </Dialog>
      )}
      {dialog === "lesson" && (
        <LessonForm
          student={student}
          onClose={() => setDialog(null)}
          onSave={addLesson}
        />
      )}
      {dialog === "assignment" && (
        <AssignmentForm
          student={student}
          lessons={studentLessons}
          timezone={data.settings.timezone}
          onClose={() => setDialog(null)}
          onSave={addAssignment}
        />
      )}
      {dialog === "material" && (
        <MaterialForm
          student={student}
          lessons={studentLessons}
          timezone={data.settings.timezone}
          isDemo={isDemo}
          onClose={() => setDialog(null)}
          onSave={addMaterial}
        />
      )}
      {dialog === "actor-material" && (
        <MaterialForm
          student={student}
          lessons={studentLessons}
          timezone={data.settings.timezone}
          isDemo={isDemo}
          fixedRole="actor_material"
          onClose={() => setDialog(null)}
          onSave={addMaterial}
        />
      )}
      {dialog === "note" && (
        <NoteForm
          student={student}
          lessons={studentLessons}
          timezone={data.settings.timezone}
          note={editingNote}
          onClose={() => {
            setDialog(null);
            setEditingNote(undefined);
          }}
          onSave={addNote}
        />
      )}
    </div>
  );
}

type Data = NonNullable<ReturnType<typeof useStudio>["data"]>;
function Overview({
  data,
  student,
  onAddAssignment,
  onAddMaterial,
}: {
  data: Data;
  student: Student;
  onAddAssignment: () => void;
  onAddMaterial: () => void;
}) {
  const upcoming = data.lessons
    .filter(
      (item) =>
        belongsToStudent(data, item, student.id) &&
        item.status === "scheduled" &&
        new Date(item.startsAt).getTime() >= Date.now(),
    )
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt))[0];
  const assignment = data.assignments.find(
    (item) => item.studentId === student.id && item.status !== "completed",
  );
  const current = data.materials.find(
    (item) =>
      item.studentId === student.id &&
      item.role === "current_script" &&
      item.status === "active",
  );
  const pkg = data.packages.find((item) => item.studentId === student.id);
  return (
    <div className="record-overview">
      <div className="record-main">
        <Section title="What matters now" marked>
          <div className="focus-grid">
            <RecordCard
              icon={CalendarDays}
              label="Next lesson"
              value={
                upcoming
                  ? formatStudioDateTime(upcoming.startsAt, data.settings.timezone)
                  : "Nothing scheduled"
              }
              detail={upcoming?.topic || "Add a lesson when ready"}
              link={`${`/coach/students/${student.id}/lessons`}`}
            />
            <RecordCard
              icon={FileText}
              label="Current work"
              value={current?.title || "No active script"}
              detail={
                current?.category || "Add the material they are working on"
              }
              link={`/coach/students/${student.id}/work`}
            />
            <RecordCard
              icon={CheckSquare}
              label="Practice"
              value={assignment?.title || "Caught up"}
              detail={assignment?.details || "No open assignment"}
              link={`/coach/students/${student.id}/work`}
            />
            <RecordCard
              icon={CircleDollarSign}
              label="Account"
              value={
                pkg
                  ? `${packageSummary(pkg, data.creditEntries).remainingCredits} sessions left`
                  : "Pay as you go"
              }
              detail={`Balance ${formatMoney(Math.max(0, studentBalanceMinor(student.id, data.payments)))}`}
              link={`/coach/students/${student.id}/payments`}
            />
          </div>
        </Section>
        <Section title="Goals & coaching context">
          <div className="record-copy">
            <div>
              <span>Goals</span>
              <p>{student.goals || "No goals recorded yet."}</p>
            </div>
            <div>
              <span>Private coach notes</span>
              <p>
                {student.privateNotes || "No private context recorded yet."}
              </p>
            </div>
          </div>
        </Section>
      </div>
      <aside className="record-side">
        <Section title="Contact">
          <dl className="detail-list">
            <div>
              <dt>Email</dt>
              <dd>{student.email || "—"}</dd>
            </div>
            <div>
              <dt>Phone</dt>
              <dd>{student.phone || "—"}</dd>
            </div>
            {student.isMinor && (
              <>
                <div>
                  <dt>Guardian</dt>
                  <dd>{student.guardianName || "—"}</dd>
                </div>
                <div>
                  <dt>Guardian email</dt>
                  <dd>{student.guardianEmail || "—"}</dd>
                </div>
              </>
            )}
            <div>
              <dt>Lead source</dt>
              <dd>{student.leadSource || "—"}</dd>
            </div>
            <div>
              <dt>Last contact</dt>
              <dd>
                {student.lastContactAt
                  ? formatStudioDate(student.lastContactAt, data.settings.timezone)
                  : "—"}
              </dd>
            </div>
          </dl>
        </Section>
        <Section title="Quick add">
          <div className="stack-actions">
            <button onClick={onAddAssignment}>
              <CheckSquare />
              Assign practice
            </button>
            <button onClick={onAddMaterial}>
              <FolderOpen />
              Add material
            </button>
          </div>
        </Section>
      </aside>
    </div>
  );
}
function RecordCard({
  icon: Icon,
  label,
  value,
  detail,
  link,
}: {
  icon: typeof CalendarDays;
  label: string;
  value: string;
  detail: string;
  link: string;
}) {
  return (
    <Link className="record-card" to={link}>
      <Icon />
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </Link>
  );
}
function Lessons({ data, student }: { data: Data; student: Student }) {
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
          {formatStudioDateTime(lesson.startsAt, data.settings.timezone)} · {lesson.locationLabel}
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
      <Section title="Lesson history" aside={<span className="count">{history.length}</span>}>
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
function CoachLessonHub({
  data,
  student,
  isDemo,
}: {
  data: Data;
  student: Student;
  isDemo: boolean;
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
  const [creditQuantity, setCreditQuantity] = useState(1);
  const [creditReason, setCreditReason] = useState("Lesson-specific credit");
  const [paymentStatus, setPaymentStatus] = useState<NonNullable<Lesson["paymentStatus"]>>(lesson?.paymentStatus || "untracked");
  const [lessonPrice, setLessonPrice] = useState(lesson?.priceMinor == null ? "" : String(lesson.priceMinor / 100));
  const [lessonPaid, setLessonPaid] = useState(String((lesson?.paidMinor || 0) / 100));
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
      (total, item) => total + packageSummary(item, data.creditEntries).remainingCredits,
      0,
    );
  const paidByCredit = data.creditEntries.some(
    (item) =>
      item.lessonId === lesson.id &&
      ["reservation", "consumption"].includes(item.kind),
  );
  const durationMinutes = Math.round(
    (new Date(lesson.endsAt).getTime() - new Date(lesson.startsAt).getTime()) / 60_000,
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
        await queryClient.invalidateQueries({ queryKey: ["studio"] });
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
  const rescheduleLesson = async (startsAt: string, endsAt: string, allowConflict = false) => {
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
        await queryClient.invalidateQueries({ queryKey: ["studio"] });
      }
      setLessonAction(null);
      setNotice("Lesson rescheduled. Calendar and student invitation updates are queued.");
    } catch (reason) {
      setNotice(reason instanceof Error ? reason.message : "Lesson could not be rescheduled.");
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
        await queryClient.invalidateQueries({ queryKey: ["studio"] });
      }
      setLessonAction(null);
      setNotice("Lesson details saved. Calendar and student updates are queued.");
    } catch (reason) {
      setNotice(
        reason instanceof Error ? reason.message : "Lesson details could not be saved.",
      );
    } finally {
      setActionBusy("");
    }
  };
  const adjustCredit = async () => {
    if (actionBusy || !creditQuantity || creditReason.trim().length < 3) return;
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
      await queryClient.invalidateQueries({ queryKey: ["studio"] });
      setLessonAction(null);
      setNotice("Credit adjustment saved on this lesson.");
    } catch (reason) {
      setNotice(reason instanceof Error ? reason.message : "Credit could not be adjusted.");
    } finally {
      setActionBusy("");
    }
  };
  const useCredit = async () => {
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
      await queryClient.invalidateQueries({ queryKey: ["studio"] });
      setLessonAction(null);
      setNotice("One credit was used and this lesson is marked paid by credit.");
    } catch (reason) {
      setNotice(reason instanceof Error ? reason.message : "Credit could not be used.");
    } finally {
      setActionBusy("");
    }
  };
  const savePaymentStatus = async () => {
    if (actionBusy) return;
    setActionBusy("payment");
    const priceMinor = lessonPrice === "" ? undefined : Math.round(Number(lessonPrice) * 100);
    const paidMinor = Math.round(Number(lessonPaid || 0) * 100);
    try {
      if (isDemo) store.transact((draft) => { const item = draft.lessons.find((row) => row.id === lesson.id); if (item) { item.paymentStatus = paymentStatus; item.priceMinor = priceMinor; item.paidMinor = paidMinor; item.version += 1; item.updatedAt = new Date().toISOString(); } });
      else { await studioCommand("lessons", { command: "set_payment_status", entityId: lesson.id, expectedVersion: lesson.version, payload: { paymentStatus, priceMinor, paidMinor }, reason: "Coach updated lesson payment status" }); await queryClient.invalidateQueries({ queryKey: ["studio"] }); }
      setLessonAction(null); setNotice("Lesson payment status saved.");
    } catch (reason) { setNotice(reason instanceof Error ? reason.message : "Payment status could not be saved."); }
    finally { setActionBusy(""); }
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
          {formatStudioDateTime(lesson.startsAt, data.settings.timezone)} · {lesson.locationLabel}{" "}
          · {lesson.status}
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
            <button className="primary-button" onClick={() => setLessonAction("reschedule")}>
              <CalendarDays /> Reschedule
            </button>
          )}
        </div>
        <section className="lesson-facts" aria-label="Lesson information">
          <div><small>Date & time</small><strong>{formatStudioDateTime(lesson.startsAt, data.settings.timezone)}</strong></div>
          <div><small>Duration</small><strong>{durationMinutes} minutes</strong></div>
          <div><small>Delivery</small><strong>{lesson.locationLabel}</strong></div>
          <div><small>Lesson work</small><strong>{notes.length} notes · {assignments.length} practice · {materials.length} files</strong></div>
        </section>
        <details className="lesson-admin-disclosure">
          <summary>Payment, credits &amp; lesson administration</summary>
          <div className="lesson-admin-summary">
            <div><small>Source</small><strong>{lesson.sourceProvider?.replaceAll("_", " ") || "Studio"}</strong></div>
            <div><small>Payment</small><strong>{paidByCredit ? "Paid with lesson credit" : (lesson.paymentStatus || "untracked").replaceAll("_", " ")}{lesson.priceMinor != null ? ` · ${formatMoney(lesson.priceMinor)}` : ""}</strong></div>
          </div>
          <div className="form-actions">
            <button onClick={() => setLessonAction("details")}>Edit lesson information</button>
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
            cancellationWindowHours={data.settings.bookingDefaults.cancellationWindowHours}
            busy={actionBusy === "reschedule"}
            onCheckConflicts={(startsAt, endsAt) => isDemo ? Promise.resolve(data.lessons.filter((item) => item.id !== lesson.id && item.status === "scheduled" && item.startsAt < endsAt && item.endsAt > startsAt).map((item) => ({ id: item.id, summary: item.topic, start: item.startsAt, end: item.endsAt }))) : checkSchedulingConflicts(startsAt, endsAt, lesson.id)}
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
              <span>{paidByCredit ? "This lesson is paid by credit" : "No credit used for this lesson"}</span>
            </div>
            <section className="lesson-command-section">
              <p>Positive numbers add credits; negative numbers remove them. The reason stays attached to this lesson.</p>
              <div className="inline-command">
                <label>Credits<input type="number" min="-20" max="20" value={creditQuantity} onChange={(event) => setCreditQuantity(Number(event.target.value))} /></label>
                <label>Reason<input value={creditReason} onChange={(event) => setCreditReason(event.target.value)} /></label>
                <button disabled={Boolean(actionBusy) || !creditQuantity || creditReason.trim().length < 3} onClick={() => void adjustCredit()}>
                  {actionBusy === "credit" ? "Saving…" : "Save adjustment"}
                </button>
              </div>
            </section>
            {!paidByCredit && (
              <button className="primary-button" disabled={Boolean(actionBusy) || availableCredits < 1} onClick={() => void useCredit()}>
                {actionBusy === "use-credit" ? "Applying…" : availableCredits ? "Use 1 credit for this lesson" : "No credit available"}
              </button>
            )}
            <section className="lesson-command-section">
              <h3>Payment status</h3>
              <div className="inline-command payment-status-command">
                <label>Status<select value={paymentStatus} onChange={(event) => setPaymentStatus(event.target.value as typeof paymentStatus)}><option value="untracked">Not tracked</option><option value="due">Due</option><option value="partially_paid">Partially paid</option><option value="paid">Paid</option><option value="waived">Waived</option><option value="refunded">Refunded</option></select></label>
                <label>Lesson price (USD)<input type="number" min="0" step="0.01" value={lessonPrice} onChange={(event) => setLessonPrice(event.target.value)} /></label>
                <label>Amount paid (USD)<input type="number" min="0" step="0.01" value={lessonPaid} onChange={(event) => setLessonPaid(event.target.value)} /></label>
                <button disabled={Boolean(actionBusy)} onClick={() => void savePaymentStatus()}>{actionBusy === "payment" ? "Saving…" : "Save payment status"}</button>
              </div>
            </section>
          </div>
        </Dialog>
      )}
      <div className="lesson-hub-grid">
        <Section title="Notes">
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
                detail="Use the Notes tab to add one for this lesson."
              />
            )}
          </div>
        </Section>
        <Section title="Practice">
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
                detail="Use Current work to assign practice to this lesson."
              />
            )}
          </div>
        </Section>
        <Section title="Attachments">
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
                detail="Use Current work to attach a file or link to this lesson."
              />
            )}
          </div>
        </Section>
        <Section title="Conversation">
          <p className="section-intro">Keep lesson follow-up in the student’s private studio conversation.</p>
          <Link className="button-link primary" to={`/coach/inbox?student=${encodeURIComponent(student.id)}`}><MessageSquare />Open conversation</Link>
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
        <input value={topic} onChange={(event) => setTopic(event.target.value)} required />
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
        <button type="button" disabled={busy} onClick={onCancel}>Cancel</button>
        <button className="primary-button" disabled={busy || !topic.trim() || !locationLabel.trim()}>
          {busy ? "Saving…" : "Save lesson information"}
        </button>
      </div>
    </form>
  );
}
function Work({
  data,
  student,
  onAddAssignment,
  onAddMaterial,
  onArchiveMaterial,
  onDeleteMaterial,
}: {
  data: Data;
  student: Student;
  onAddAssignment: () => void;
  onAddMaterial: () => void;
  onArchiveMaterial: (material: Material) => void;
  onDeleteMaterial: (material: Material) => void;
}) {
  const assignments = data.assignments.filter(
      (i) => i.studentId === student.id,
    ),
    materials = data.materials.filter(
      (i) => i.studentId === student.id && i.role !== "actor_material",
    );
  return (
    <div className="two-section-grid">
      <Section
        title="Practice"
        aside={
          <button onClick={onAddAssignment}>
            <Plus />
            Assign
          </button>
        }
      >
        <div className="table-list">
          {assignments.map((item) => (
            <article key={item.id}>
              <CheckSquare />
              <div>
                <strong>{item.title}</strong>
                <small>
                  {item.details}
                  {item.dueAt
                    ? ` · due ${formatStudioDate(item.dueAt, data.settings.timezone)}`
                    : ""}
                </small>
              </div>
              <Status tone={item.status === "completed" ? "good" : "neutral"}>
                {item.status.replaceAll("_", " ")}
              </Status>
            </article>
          ))}
          {!assignments.length && (
            <EmptyState
              title="No practice assigned"
              detail="Add one focused next step."
            />
          )}
        </div>
      </Section>
      <Section
        title="Scripts & lesson materials"
        aside={
          <button onClick={onAddMaterial}>
            <Plus />
            Add
          </button>
        }
      >
        <div className="table-list">
          {materials.map((item) => (
            <article key={item.id}>
              <FolderOpen />
              <div>
                <strong>{item.title}</strong>
                <small>
                  {item.category} · {item.role.replaceAll("_", " ")}
                </small>
              </div>
              <Status tone={item.status === "active" ? "good" : "neutral"}>
                {item.status}
              </Status>
              {item.externalUrl && (
                <a href={item.externalUrl} target="_blank" rel="noreferrer">
                  Open
                </a>
              )}
              <button type="button" onClick={() => onArchiveMaterial(item)}>
                {item.status === "active" ? "Archive" : "Restore"}
              </button>
              <button
                type="button"
                className="danger-button"
                onClick={() => onDeleteMaterial(item)}
              >
                <Trash2 />
                Delete
              </button>
            </article>
          ))}
          {!materials.length && (
            <EmptyState
              title="No materials yet"
              detail="Add a script, worksheet, or reference."
            />
          )}
        </div>
      </Section>
    </div>
  );
}
function Notes({
  data,
  student,
  onAdd,
  onEdit,
  onDelete,
}: {
  data: Data;
  student: Student;
  onAdd: () => void;
  onEdit: (note: Note) => void;
  onDelete: (note: Note) => void;
}) {
  const [query, setQuery] = useState(""),
    [status, setStatus] = useState("all"),
    [selectedLessonId, setSelectedLessonId] = useState("");
  const notes = data.notes
    .filter((i) => i.studentId === student.id)
    .filter(
      (note) =>
        (status === "all" || note.status === status) &&
        [note.title, note.body, ...(note.tags || [])]
          .join(" ")
          .toLowerCase()
          .includes(query.toLowerCase()),
    )
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const groups = Object.values(
    notes.reduce<Record<string, { lessonId: string; notes: Note[]; updatedAt: string }>>(
      (result, note) => {
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
      },
      {},
    ),
  ).sort((a, b) => {
    const aDate = data.lessons.find((item) => item.id === a.lessonId)?.startsAt || a.updatedAt;
    const bDate = data.lessons.find((item) => item.id === b.lessonId)?.startsAt || b.updatedAt;
    return bDate.localeCompare(aDate);
  });
  const notePage = usePagedList(groups);
  const selected = groups.find((group) => group.lessonId === selectedLessonId);
  return (
    <Section
      title="Coach notes"
      marked
      aside={
        <button onClick={onAdd}>
          <Plus />
          New note
        </button>
      }
    >
      <div className="library-toolbar">
        <label>
          <Search />
          <input
            aria-label="Search this student’s notes"
            placeholder="Search notes…"
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
        label="lessons with notes"
      />
      <div className="lesson-note-index">
        {notePage.visible.map((group) => (
          <button type="button" key={group.lessonId} onClick={() => setSelectedLessonId(group.lessonId)}>
            <CalendarDays />
            <span>
              <strong>
                {group.lessonId
                  ? formatStudioDate(
                      data.lessons.find((item) => item.id === group.lessonId)
                        ?.startsAt || group.updatedAt,
                      data.settings.timezone,
                    )
                  : "General note"}
              </strong>
              <small>
                {data.lessons.find((item) => item.id === group.lessonId)
                  ?.topic || "General coaching"}{" "}
                · {group.notes.length} {group.notes.length === 1 ? "note" : "notes"}
              </small>
            </span>
            <Status tone={group.notes.every((note) => note.status === "published") ? "good" : "neutral"}>
              {group.notes.some((note) => note.status === "draft") ? "has draft" : "published"}
            </Status>
          </button>
        ))}
        {!notes.length && (
          <EmptyState
            title="No notes yet"
            detail="Private drafts stay private; published notes appear for the student."
          />
        )}
      </div>
      {selected && (
        <Dialog
          title={data.lessons.find((item) => item.id === selected.lessonId)?.topic || "Coaching notes"}
          description={
              selected.lessonId
              ? formatStudioDateTime(data.lessons.find((item) => item.id === selected.lessonId)?.startsAt || selected.updatedAt, data.settings.timezone)
              : "General coaching note"
          }
          onClose={() => setSelectedLessonId("")}
        >
          <div className="lesson-note-stack">
            {selected.notes.map((note) => (
              <article key={note.id}>
                <header>
                  <strong>{note.title}</strong>
                  <Status tone={note.status === "published" ? "good" : "neutral"}>{note.status}</Status>
                </header>
                {note.bodyHtml ? (
                  <div className="rich-note-body" dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(note.bodyHtml) }} />
                ) : (
                  <p>{note.body}</p>
                )}
                <div className="row-actions">
                  <button type="button" onClick={() => { setSelectedLessonId(""); onEdit(note); }}>Edit</button>
                  <button type="button" className="danger-button" onClick={() => { onDelete(note); setSelectedLessonId(""); }}><Trash2 />Delete</button>
                </div>
              </article>
            ))}
          </div>
          <div className="form-actions"><button type="button" onClick={() => setSelectedLessonId("")}>Close</button></div>
        </Dialog>
      )}
    </Section>
  );
}
function PortalInvite({
  accountType,
  label,
  email,
  username,
  busy,
  onInvite,
}: {
  accountType: "student" | "guardian";
  label: string;
  email?: string;
  username?: string;
  busy: boolean;
  onInvite: (accountType: "student" | "guardian", linkedContactId?: string) => Promise<void>;
}) {
  return (
    <div className="credential-form">
      <div>
        <strong>{label}</strong>
        <small>
          {email || `Add a ${accountType} email in Edit details first.`}{" "}
          {username ? `Current username: ${username}. ` : ""}
          Sending an invite generates the username and one-time password automatically. The recipient creates a private password at first sign-in.
        </small>
      </div>
      <div className="form-actions">
        <button
          type="button"
          className="primary"
          disabled={busy || !email}
          onClick={() => void onInvite(accountType)}
        >
          {busy
            ? "Sending…"
            : username
              ? `Send new ${accountType} invite`
              : `Send ${accountType} invite`}
        </button>
      </div>
    </div>
  );
}

const notificationLabels = {
  lessonReminders: "Lesson reminders",
  scheduleChanges: "Reschedules and cancellations",
  lessonContent: "Notes and lesson materials",
  assignments: "Assignments and practice",
  packageBalance: "Package balance and expiration",
  payments: "Payments and receipts",
  accountAccess: "Account access",
} as const;

function LinkedContacts({ data, student, busy, onInvite }: {
  data: Data;
  student: Student;
  busy: boolean;
  onInvite: (accountType: "student" | "guardian", linkedContactId?: string) => Promise<void>;
}) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<Data["linkedContacts"][number]>();
  const [adding, setAdding] = useState(false);
  const [notice, setNotice] = useState("");
  const contacts = data.linkedContacts.filter((contact) => contact.studentId === student.id && contact.portalEnabled);
  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    const preferences = Object.fromEntries(Object.keys(notificationLabels).map((key) => [key, values.get(`notify-${key}`) === "on"]));
    setNotice("Saving linked contact…");
    try {
      await studioCommand("students", {
        command: "save_linked_contact",
        entityId: student.id,
        expectedVersion: editing?.version || 0,
        payload: {
          contactId: editing?.id,
          fullName: values.get("fullName"),
          email: values.get("email"),
          relationshipType: values.get("relationshipType"),
          relationshipLabel: values.get("relationshipLabel"),
          canViewSchedule: values.get("canViewSchedule") === "on",
          canManageLessons: values.get("canManageLessons") === "on",
          canViewWork: values.get("canViewWork") === "on",
          canManageProfile: values.get("canManageProfile") === "on",
          canViewFinance: values.get("canViewFinance") === "on",
          canReceiveNotifications: values.get("canReceiveNotifications") === "on",
          notificationPreferences: preferences,
        },
        reason: "Coach configured linked household access",
      });
      await queryClient.invalidateQueries({ queryKey: ["studio"] });
      setAdding(false); setEditing(undefined); setNotice("Linked contact saved.");
    } catch (reason) { setNotice(reason instanceof Error ? reason.message : "Linked contact could not be saved."); }
  };
  const disable = async (contact: Data["linkedContacts"][number]) => {
    setNotice("Removing access…");
    try {
      await studioCommand("students", { command:"remove_linked_contact", entityId:student.id, expectedVersion:contact.version, payload:{ contactId:contact.id }, reason:"Coach removed linked household access" });
      await queryClient.invalidateQueries({ queryKey:["studio"] });
      setNotice("Linked contact access and optional notifications were disabled.");
    } catch (reason) { setNotice(reason instanceof Error ? reason.message : "Access could not be removed."); }
  };
  const invitation = (contact: Data["linkedContacts"][number]) => data.outbox
    .filter((item) => item.studentId === student.id && item.recipient.toLowerCase() === contact.email.toLowerCase() && item.subject.toLowerCase().includes("portal login"))
    .sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt))[0];
  return <Section title="Household access" marked aside={<button type="button" onClick={()=>{setEditing(undefined);setAdding(true);}}>Add contact</button>}>
    <p className="section-intro">Add guardians for minors or support people for students of any age. Each person gets only the schedule, work, profile, payment, and notification access you choose.</p>
    {notice && <p className="portal-notice" role="status">{notice}</p>}
    <div className="table-list">{contacts.map((contact)=>{const delivery=invitation(contact); return <article key={contact.id}><UserRound/><div><strong>{contact.fullName}</strong><small>{contact.relationshipLabel || contact.relationshipType.replaceAll("_"," ")} · {contact.email}</small></div><Status tone={delivery?.status === "failed" ? "danger" : delivery?.status === "sent" ? "good" : "warn"}>{delivery?.status === "failed" ? "Needs retry" : delivery?.status === "sent" ? "Sent" : delivery ? "Sending" : "Not invited"}</Status><Link className="button-link" to={`/coach/students/${student.id}/contacts/${contact.id}`}>Open profile</Link><button onClick={()=>setEditing(contact)}>Edit access</button><button className="primary-button" disabled={busy} onClick={()=>void onInvite("guardian",contact.id)}>{delivery?.status === "failed" ? "Retry invite" : "Send invite"}</button><button className="danger-button" onClick={()=>void disable(contact)}>Remove</button></article>;})}</div>
    {!contacts.length && !adding && <EmptyState title="No linked contacts" detail="Adult students can have support people too; access is never limited to minor guardians."/>}
    {(adding || editing) && <Dialog title={editing ? `Edit ${editing.fullName}` : "Add linked contact"} description="Access and optional email preferences can be changed at any time." onClose={()=>{setAdding(false);setEditing(undefined);}}><form className="workflow-form" onSubmit={save}>
      <label>Name<input name="fullName" required defaultValue={editing?.fullName}/></label><label>Email<input name="email" type="email" required defaultValue={editing?.email}/></label>
      <label>Relationship<select name="relationshipType" defaultValue={editing?.relationshipType || (student.isMinor ? "guardian" : "support_person")}><option value="guardian">Guardian</option><option value="support_person">Support person</option><option value="other">Other</option></select></label><label>Custom relationship label<input name="relationshipLabel" defaultValue={editing?.relationshipLabel} placeholder="Parent, manager, spouse…"/></label>
      <fieldset className="full option-fieldset"><legend>Portal permissions</legend>{[["canViewSchedule","View schedule",true],["canManageLessons","Manage or reschedule lessons",false],["canViewWork","View work and notes",true],["canManageProfile","Manage profile",false],["canViewFinance","View payments",student.isMinor]].map(([name,label,fallback])=><label className="check-row" key={String(name)}><input name={String(name)} type="checkbox" defaultChecked={editing ? Boolean(editing[name as keyof typeof editing]) : Boolean(fallback)}/>{String(label)}</label>)}</fieldset>
      <fieldset className="full option-fieldset"><legend>Notifications</legend><label className="check-row"><input name="canReceiveNotifications" type="checkbox" defaultChecked={editing?.canReceiveNotifications ?? true}/>Receive optional notifications</label>{Object.entries(notificationLabels).map(([key,label])=><label className="check-row" key={key}><input name={`notify-${key}`} type="checkbox" defaultChecked={editing?.notificationPreferences?.[key as keyof typeof editing.notificationPreferences] ?? (key !== "payments" && key !== "packageBalance" || student.isMinor)}/>{label}{["accountAccess","scheduleChanges","payments"].includes(key)&&<small>Critical messages cannot be disabled when applicable.</small>}</label>)}</fieldset>
      <div className="form-actions full"><button type="button" onClick={()=>{setAdding(false);setEditing(undefined);}}>Cancel</button><button className="primary">Save contact</button></div>
    </form></Dialog>}
  </Section>;
}

function HouseholdContactProfile({ data, student }: { data: Data; student: Student }) {
  const { contactId = "" } = useParams();
  const contact = data.linkedContacts.find((item) => item.id === contactId && item.studentId === student.id);
  if (!contact) return <Navigate to={`/coach/students/${student.id}/account`} replace />;
  const access = [
    ["Schedule", contact.canViewSchedule],
    ["Manage lessons", contact.canManageLessons],
    ["Work and notes", contact.canViewWork],
    ["Manage profile", contact.canManageProfile],
    ["Payments", contact.canViewFinance],
  ] as const;
  return <div className="two-section-grid household-profile">
    <Section title={contact.fullName} marked>
      <p className="section-intro">{contact.relationshipLabel || contact.relationshipType.replaceAll("_", " ")} for {student.preferredName || student.fullName}</p>
      <dl className="profile-grid"><div><dt>Email</dt><dd>{contact.email}</dd></div><div><dt>Timezone</dt><dd>{contact.timezone || "Uses device timezone"}</dd></div><div><dt>Portal access</dt><dd>{contact.portalEnabled ? "Enabled" : "Disabled"}</dd></div><div><dt>Notifications</dt><dd>{contact.canReceiveNotifications ? "Enabled" : "Optional messages off"}</dd></div></dl>
      <div className="form-actions"><Link className="button-link primary" to={`/coach/inbox?student=${encodeURIComponent(student.id)}`}><MessageSquare />Message household</Link><Link className="button-link" to={`/coach/inbox?student=${encodeURIComponent(student.id)}&recipient=${encodeURIComponent(contact.email)}&email=1`}><Mail />Email {contact.fullName.split(" ")[0]}</Link><Link className="button-link" to={`/coach/students/${student.id}/account`}>Edit access</Link></div>
    </Section>
    <Section title="Access & notifications">
      <div className="permission-summary">{access.map(([label, enabled]) => <div key={label}><span>{label}</span><Status tone={enabled ? "good" : "neutral"}>{enabled ? "Allowed" : "Hidden"}</Status></div>)}</div>
      <h3>Receives</h3>
      <div className="policy-chips">{Object.entries(notificationLabels).filter(([key]) => contact.notificationPreferences?.[key as keyof typeof contact.notificationPreferences]).map(([key, label]) => <span key={key}>{label}</span>)}</div>
    </Section>
  </div>;
}

function Account({
  data,
  student,
  isDemo,
  onSave,
  onInvite,
  settingCredentials,
}: {
  data: Data;
  student: Student;
  isDemo: boolean;
  onSave: (updates: Partial<Student>) => Promise<void> | void;
  onInvite: (accountType: "student" | "guardian", linkedContactId?: string) => Promise<void>;
  settingCredentials: boolean;
}) {
  const store = useStudioStore();
  const queryClient = useQueryClient();
  const [savingRate, setSavingRate] = useState("");
  const [rateNotice, setRateNotice] = useState("");
  const [profileBusy,setProfileBusy]=useState(false);
  const toggle = (field: "portalEnabled" | "actorPageEligible") =>
    onSave({ [field]: !student[field] });
  const saveRate = async (serviceId: string, form: HTMLFormElement) => {
    const values = new FormData(form), service = data.bookingServices.find((item) => item.id === serviceId);
    if (!service) return;
    const priceMinor = Math.round(Number(values.get("price")) * 100), depositMinor = Math.round(Number(values.get("deposit") || 0) * 100);
    const locationPriceAdjustments = Object.fromEntries(service.locationOptions.map((location) => [location, Math.round(Number(values.get(`location-${location}`) || 0) * 100)]));
    setSavingRate(serviceId); setRateNotice("");
    try {
      if (isDemo) store.transact((draft) => { const existing = draft.studentPricingRules.find((row) => row.studentId === student.id && row.serviceId === serviceId); if (existing) Object.assign(existing, { priceMinor, depositMinor, locationPriceAdjustments, version: existing.version + 1, updatedAt: now() }); else draft.studentPricingRules.push({ id: uid("rate"), studioId: draft.studioId, studentId: student.id, serviceId, priceMinor, depositMinor, locationPriceAdjustments, reason: "Student-specific pricing", startsAt: now(), active: true, version: 1, updatedAt: now() }); });
      else { await studioCommand("pricing", { command: "upsert_student_rate", expectedVersion: 0, payload: { studentId: student.id, serviceId, priceMinor, depositMinor, locationPriceAdjustments, reason: "Student-specific pricing" }, reason: "Coach saved student-specific pricing" }); await queryClient.invalidateQueries({ queryKey: ["studio"] }); }
      setRateNotice(`${service.name} pricing saved.`);
    } catch (reason) { setRateNotice(reason instanceof Error ? reason.message : "Special pricing could not be saved."); }
    finally { setSavingRate(""); }
  };
  const updateProfilePhoto = async (file?: File) => {
    if (!file || profileBusy) return;
    setProfileBusy(true); setRateNotice("Uploading profile photo…");
    try {
      if (!file.type.startsWith("image/") || file.size > 5*1024*1024) throw new Error("Choose a JPG, PNG, or WebP image smaller than 5 MB.");
      if (isDemo) setRateNotice("Profile-photo upload is available in production mode.");
      else {
        const uploaded=await uploadStudioFile({studioId:data.studioId,studentId:student.id,entityType:"student",entityId:student.id,file,visibility:"private"});
        await onSave({profilePhotoAssetId:uploaded.id,profilePhotoPosition:{x:50,y:50}});
        setRateNotice("Student profile photo saved.");
      }
    } catch(reason){setRateNotice(reason instanceof Error?reason.message:"Profile photo could not be saved.");}
    finally{setProfileBusy(false);}
  };
  return (
    <div className="two-section-grid">
      <Section title="Access & visibility" marked>
        <div className="settings-list">
          <div className="profile-identity-card"><span>{student.profilePhotoUrl?<img src={student.profilePhotoUrl} alt=""/>:student.fullName.split(" ").map((part)=>part[0]).join("").slice(0,2)}</span><div><strong>Portal profile photo</strong><small>Private identity photo. Actor-page headshots stay separate.</small><label className="button-link">{profileBusy?"Uploading…":"Upload photo"}<input hidden disabled={profileBusy} type="file" accept="image/jpeg,image/png,image/webp" onChange={(event)=>void updateProfilePhoto(event.target.files?.[0])}/></label>{student.profilePhotoAssetId&&<button type="button" className="text-button" onClick={()=>void onSave({profilePhotoAssetId:undefined})}>Remove photo</button>}</div></div>
          <SettingToggle
            title="Student workspace"
            detail="Allow this student or guardian to access shared lessons, practice, and materials."
            checked={student.portalEnabled}
            onChange={() => toggle("portalEnabled")}
          />
          <SettingToggle
            title="Actor page eligible"
            detail="Allow an approved public actor page for this student."
            checked={student.actorPageEligible}
            onChange={() => toggle("actorPageEligible")}
          />
          <PortalInvite
            accountType="student"
            label="Student login"
            email={student.email}
            username={student.portalUsername}
            busy={settingCredentials}
            onInvite={onInvite}
          />
          <SettingToggle
            title="Special pricing"
            detail="Use student-specific prices and delivery add-ons when this student books while signed in."
            checked={Boolean(student.specialPricingEnabled)}
            onChange={() => void onSave({ specialPricingEnabled: !student.specialPricingEnabled })}
          />
        </div>
      </Section>
      <LinkedContacts data={data} student={student} busy={settingCredentials} onInvite={onInvite} />
      {student.specialPricingEnabled && <Section title="Student-specific pricing" marked>
        <p className="section-intro">Only services you customize are overridden. Everything else continues to use the public booking price.</p>
        {rateNotice && <p className="portal-notice" role="status">{rateNotice}</p>}
        <div className="special-pricing-list">
          {data.bookingServices.map((service) => { const rule = data.studentPricingRules.find((item) => item.studentId === student.id && item.serviceId === service.id && item.active); return <details key={service.id}>
            <summary><span><strong>{service.name}</strong><small>{rule ? `${formatMoney(rule.priceMinor)} custom base price` : `${formatMoney(service.priceMinor)} studio price`}</small></span><span>{rule ? "Customized" : "Use studio price"}</span></summary>
            <form onSubmit={(event) => { event.preventDefault(); void saveRate(service.id, event.currentTarget); }} className="pricing-rule-form">
              <label>Base price (USD)<input name="price" type="number" min="0" step="0.01" defaultValue={(rule?.priceMinor ?? service.priceMinor) / 100} /></label>
              <label>Deposit (USD)<input name="deposit" type="number" min="0" step="0.01" defaultValue={(rule?.depositMinor ?? service.depositMinor) / 100} /></label>
              {service.locationOptions.map((location) => <label key={location}>{location.replaceAll("_", " ")} add-on (USD)<input name={`location-${location}`} type="number" step="0.01" defaultValue={Number(rule?.locationPriceAdjustments?.[location] ?? service.locationPriceAdjustments[location] ?? 0) / 100} /></label>)}
              <button className="primary-button" disabled={Boolean(savingRate)}>{savingRate === service.id ? "Saving…" : `Save ${service.name} pricing`}</button>
            </form>
          </details>; })}
        </div>
      </Section>}
      <Section title="Studio details">
        <dl className="detail-list">
          <div>
            <dt>Status</dt>
            <dd>{student.status}</dd>
          </div>
          <div>
            <dt>Default lesson rate</dt>
            <dd>
              {student.defaultRateMinor
                ? formatMoney(student.defaultRateMinor)
                : "Studio default"}
            </dd>
          </div>
          <div>
            <dt>Drive folder</dt>
            <dd>
              {student.driveFolderUrl ? (
                <a
                  href={student.driveFolderUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  Open folder
                </a>
              ) : (
                "Not connected"
              )}
            </dd>
          </div>
          <div>
            <dt>Tags</dt>
            <dd>{student.tags?.join(", ") || "—"}</dd>
          </div>
        </dl>
      </Section>
    </div>
  );
}
function Payments({
  data,
  student,
  isDemo,
}: {
  data: Data;
  student: Student;
  isDemo: boolean;
}) {
  const pkgs = data.packages.filter((i) => i.studentId === student.id),
    payments = data.payments.filter((i) => i.studentId === student.id);
  const store = useStudioStore(),
    queryClient = useQueryClient(),
    [assigning, setAssigning] = useState(false),
    [definitionId, setDefinitionId] = useState(
      data.packageDefinitions.find((item) => item.active)?.id ?? "",
    ),
    [crediting, setCrediting] = useState(false),
    [adjustingBalance, setAdjustingBalance] = useState(false),
    [balanceAmount, setBalanceAmount] = useState("0.00"),
    [balanceReason, setBalanceReason] = useState("Studio account credit"),
    [creditQuantity, setCreditQuantity] = useState(1),
    [creditReason, setCreditReason] = useState("Courtesy lesson credit"),
    [notice, setNotice] = useState("");
  const adjustBalance = async (event: FormEvent) => {
    event.preventDefault();
    const amountMinor = Math.round(Number(balanceAmount) * 100);
    if (!amountMinor || balanceReason.trim().length < 3) return;
    try {
      if (isDemo) {
        store.transact((draft) => {
          draft.payments.push({
            id: uid("payment"),
            studentId: student.id,
            kind: amountMinor > 0 ? "refund" : "adjustment",
            amountMinor: Math.abs(amountMinor),
            currency: "USD",
            reason: balanceReason.trim(),
            createdAt: now(),
          });
        });
      } else {
        await studioCommand("finance", {
          command: "adjust_account_credit",
          entityId: student.id,
          expectedVersion: 0,
          payload: { amountMinor, currency: "USD", reason: balanceReason.trim() },
          reason: "Coach adjusted student dollar balance",
        });
        await queryClient.invalidateQueries({ queryKey: ["studio"] });
      }
      setAdjustingBalance(false);
      setBalanceAmount("0.00");
      setNotice(`${amountMinor > 0 ? "Added" : "Removed"} ${formatMoney(Math.abs(amountMinor))} ${amountMinor > 0 ? "of account credit" : "from the account balance"}.`);
    } catch (reason) {
      setNotice(reason instanceof Error ? reason.message : "The account balance could not be adjusted.");
    }
  };
  const grantCredit = async (event: FormEvent) => {
    event.preventDefault();
    try {
      if (isDemo) {
        store.transact((draft) => {
          let pkg = draft.packages.find(
            (item) =>
              item.studentId === student.id &&
              item.name === "Studio lesson credits",
          );
          if (!pkg) {
            pkg = {
              id: uid("package"),
              studentId: student.id,
              name: "Studio lesson credits",
              priceMinor: 0,
              currency: "USD",
              version: 1,
              updatedAt: now(),
            };
            draft.packages.push(pkg);
          }
          draft.creditEntries.push({
            id: uid("credit"),
            packageId: pkg.id,
            kind: "adjustment",
            quantity: creditQuantity,
            reason: creditReason,
            createdAt: now(),
          });
        });
      } else {
        await studioCommand("credits", {
          command: "grant",
          expectedVersion: 0,
          payload: {
            studentId: student.id,
            quantity: creditQuantity,
            reason: creditReason,
          },
          reason: "Coach adjusted student credits",
        });
        await queryClient.invalidateQueries({ queryKey: ["studio"] });
      }
      setCrediting(false);
      setNotice(
        `${creditQuantity > 0 ? "Added" : "Removed"} ${Math.abs(creditQuantity)} lesson credit${Math.abs(creditQuantity) === 1 ? "" : "s"}.`,
      );
    } catch (reason) {
      setNotice(
        reason instanceof Error
          ? reason.message
          : "Credits could not be updated.",
      );
    }
  };
  const assign = async (event: FormEvent) => {
    event.preventDefault();
    const definition = data.packageDefinitions.find(
      (item) => item.id === definitionId,
    );
    if (!definition) return;
    try {
      if (isDemo)
        store.transact((draft) => {
          const packageId = uid("package");
          draft.packages.push({
            id: packageId,
            studentId: student.id,
            name: definition.name,
            priceMinor: definition.priceMinor,
            currency: definition.currency,
            expiresAt: definition.expirationDays
              ? new Date(
                  Date.now() + definition.expirationDays * 86400000,
                ).toISOString()
              : undefined,
            version: 1,
            updatedAt: now(),
          });
          draft.creditEntries.push({
            id: uid("credit"),
            packageId,
            kind: "adjustment",
            quantity: definition.sessionCount,
            reason: "Coach assigned package",
            createdAt: now(),
          });
        });
      else {
        await studioCommand("packages", {
          command: "assign",
          expectedVersion: 0,
          payload: {
            definitionId,
            studentId: student.id,
            reason: "Coach assigned package",
          },
          reason: "Coach assigned package",
        });
        await queryClient.invalidateQueries({ queryKey: ["studio"] });
      }
      setAssigning(false);
      setNotice("Package assigned with its full credit balance.");
    } catch (reason) {
      setNotice(
        reason instanceof Error
          ? reason.message
          : "Package could not be assigned.",
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
          title="Packages"
          marked
          aside={
            <div className="header-actions">
              <button onClick={() => setCrediting(true)}>Adjust credits</button>
              <button onClick={() => setAdjustingBalance(true)}>Adjust dollar balance</button>
              <button
                disabled={!data.packageDefinitions.some((item) => item.active)}
                onClick={() => setAssigning(true)}
              >
                Assign package
              </button>
            </div>
          }
        >
          <div className="table-list">
            {pkgs.map((pkg) => (
              <article key={pkg.id}>
                <CircleDollarSign />
                <div>
                  <strong>{pkg.name}</strong>
                  <small>{formatMoney(pkg.priceMinor, pkg.currency)}</small>
                </div>
                <Status tone="good">
                  {packageSummary(pkg, data.creditEntries).remainingCredits}{" "}
                  left
                </Status>
              </article>
            ))}
            {!pkgs.length && (
              <EmptyState
                title="No package"
                detail="This student is currently pay as you go."
              />
            )}
          </div>
        </Section>
        <Section title="Payments & adjustments">
          <div className="metric-strip compact-metrics">
            <div><small>Available studio balance</small><strong>{formatMoney(Math.max(0, studentBalanceMinor(student.id, data.payments)))}</strong></div>
            <div><small>Lesson credits</small><strong>{pkgs.reduce((total, pkg) => total + packageSummary(pkg, data.creditEntries).remainingCredits, 0)}</strong></div>
          </div>
          <div className="table-list">
            {payments.map((p) => (
              <article key={p.id}>
                <CircleDollarSign />
                <div>
                  <strong>{p.reason}</strong>
                  <small>{formatStudioDate(p.createdAt, data.settings.timezone)}</small>
                </div>
                <strong>{formatMoney(p.amountMinor, p.currency)}</strong>
              </article>
            ))}
            {!payments.length && (
              <EmptyState
                title="No ledger entries"
                detail="Payments and adjustments will appear here."
              />
            )}
          </div>
        </Section>
      </div>
      {assigning && (
        <Dialog
          title="Assign package"
          description="This grants the package’s complete lesson-credit balance to this student."
          onClose={() => setAssigning(false)}
        >
          <form className="workflow-form" onSubmit={assign}>
            <label className="full">
              Package
              <select
                required
                value={definitionId}
                onChange={(event) => setDefinitionId(event.target.value)}
              >
                {data.packageDefinitions
                  .filter((item) => item.active)
                  .map((definition) => (
                    <option key={definition.id} value={definition.id}>
                      {definition.name} · {definition.sessionCount} sessions
                    </option>
                  ))}
              </select>
            </label>
            <div className="form-actions full">
              <button type="button" onClick={() => setAssigning(false)}>
                Cancel
              </button>
              <button className="primary">Assign credits</button>
            </div>
          </form>
        </Dialog>
      )}
      {crediting && (
        <Dialog
          title="Adjust lesson credits"
          description={`Add or remove credits for ${student.preferredName || student.fullName}. Every adjustment is recorded in the ledger.`}
          onClose={() => setCrediting(false)}
        >
          <form className="workflow-form" onSubmit={grantCredit}>
            <label>
              Credits
              <input
                required
                type="number"
                min="-100"
                max="100"
                step="1"
                value={creditQuantity}
                onChange={(event) =>
                  setCreditQuantity(Number(event.target.value))
                }
              />
              <small>Use a negative number to correct a balance.</small>
            </label>
            <label className="full">
              Reason
              <input
                required
                minLength={3}
                value={creditReason}
                onChange={(event) => setCreditReason(event.target.value)}
              />
            </label>
            <div className="form-actions full">
              <button type="button" onClick={() => setCrediting(false)}>
                Cancel
              </button>
              <button
                className="primary"
                disabled={!creditQuantity || creditReason.trim().length < 3}
              >
                Save credit adjustment
              </button>
            </div>
          </form>
        </Dialog>
      )}
      {adjustingBalance && (
        <Dialog
          title="Adjust dollar balance"
          description="This is money on the account, separate from lesson credits. Positive amounts add studio credit; negative amounts correct or remove it."
          onClose={() => setAdjustingBalance(false)}
        >
          <form className="workflow-form" onSubmit={adjustBalance}>
            <label>
              Amount (USD)
              <input required type="number" step="0.01" min="-10000" max="10000" value={balanceAmount} onChange={(event) => setBalanceAmount(event.target.value)} />
              <small>Examples: 25.00 adds $25; -10.00 removes $10.</small>
            </label>
            <label className="full">
              Reason
              <input required minLength={3} value={balanceReason} onChange={(event) => setBalanceReason(event.target.value)} />
            </label>
            <div className="form-actions full">
              <button type="button" onClick={() => setAdjustingBalance(false)}>Cancel</button>
              <button className="primary" disabled={!Number(balanceAmount) || balanceReason.trim().length < 3}>Save dollar adjustment</button>
            </div>
          </form>
        </Dialog>
      )}
    </div>
  );
}
function ActorPage({
  data,
  student,
  isDemo,
  onAddMaterial,
}: {
  data: Data;
  student: Student;
  isDemo: boolean;
  onAddMaterial: () => void;
}) {
  const store = useStudioStore();
  const queryClient = useQueryClient();
  const profile = data.actorProfiles.find((i) => i.studentId === student.id);
  const [previewing, setPreviewing] = useState(false);
  const create = async () => {
    if (isDemo)
      store.transact((draft) => {
        const target = draft.students.find((item) => item.id === student.id)!;
        target.actorPageEligible = true;
        draft.actorProfiles.push({
          id: uid("actor"),
          studentId: student.id,
          slug: student.fullName
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-|-$/g, ""),
          displayName: student.fullName,
          bio: "",
          status: "draft",
          version: 1,
          updatedAt: now(),
        });
      });
    else {
      if (!student.actorPageEligible)
        await studioCommand("students", {
          command: "update",
          entityId: student.id,
          expectedVersion: student.version,
          payload: { actorPageEligible: true },
          reason: "Coach enabled actor page",
        });
      await studioCommand("actor-pages", {
        command: "create",
        expectedVersion: 0,
        payload: { studentId: student.id },
        reason: "Coach created actor page draft",
      });
      await queryClient.invalidateQueries({ queryKey: ["studio"] });
    }
  };
  const actorMaterials = data.materials.filter(
    (item) => item.studentId === student.id && item.role === "actor_material",
  );
  return (
    <div className="student-page">
      <Section title="Actor page" marked>
        {profile ? (
          <div className="profile-preview">
            <UserRound />
            <div>
              <span>/actors/{profile.slug}</span>
              <h2>{profile.displayName}</h2>
              <p>{profile.bio}</p>
            </div>
            <Status tone={profile.status === "published" ? "good" : "warn"}>
              {profile.status.replaceAll("_", " ")}
            </Status>
            <Link to="/coach/actor-pages">Open publishing workflow</Link>
            <button className="text-button" onClick={() => setPreviewing(true)}>
              Preview draft
            </button>
            {profile.status === "published" && (
              <a
                href={`/actors/${profile.slug}`}
                target="_blank"
                rel="noreferrer"
              >
                View live page
              </a>
            )}
          </div>
        ) : (
          <div>
            <EmptyState
              title="No actor page yet"
              detail="Start a private draft, then the student can add their bio and submit it for review."
            />
            <button className="primary-button" onClick={() => void create()}>
              <Plus />
              Create draft
            </button>
          </div>
        )}
      </Section>
      <Section
        title="Headshots, gallery, reel & résumé"
        aside={
          <button onClick={onAddMaterial}>
            <Plus />
            Add actor material
          </button>
        }
      >
        <p className="section-intro">
          These uploads are reserved for the public actor page and its review
          workflow.
        </p>
        <div className="table-list">
          {actorMaterials.map((item) => (
            <article key={item.id}>
              <FolderOpen />
              <div>
                <strong>{item.title}</strong>
                <small>
                  {item.category} · {item.approvalStatus.replaceAll("_", " ")}
                </small>
              </div>
              {item.externalUrl && (
                <a href={item.externalUrl} target="_blank" rel="noreferrer">
                  Open
                </a>
              )}
            </article>
          ))}
          {!actorMaterials.length && (
            <EmptyState
              title="No actor-page media"
              detail="Add the main headshot, gallery photos, reel, and résumé here."
            />
          )}
        </div>
      </Section>
      {previewing && profile && (
        <Dialog
          title="Private actor-page preview"
          description="This uses the current draft and is not a public link."
          onClose={() => setPreviewing(false)}
        >
          <ActorProfilePreview
            profile={profile}
            materials={actorMaterials}
            studioName={data.settings.studioName}
            logoUrl={data.settings.branding.logoUrl}
          />
        </Dialog>
      )}
    </div>
  );
}
function SettingToggle({
  title,
  detail,
  checked,
  onChange,
}: {
  title: string;
  detail: string;
  checked: boolean;
  onChange: () => void;
}) {
  return (
    <Toggle
      checked={checked}
      label={title}
      detail={detail}
      onChange={onChange}
    />
  );
}

function StudentEditor({
  student,
  saving,
  onClose,
  onSave,
}: {
  student: Student;
  saving: boolean;
  onClose: () => void;
  onSave: (u: Partial<Student>) => void;
}) {
  const [form, setForm] = useState({
    fullName: student.fullName,
    preferredName: student.preferredName || "",
    email: student.email || "",
    phone: student.phone || "",
    isMinor: student.isMinor,
    guardianName: student.guardianName || "",
    guardianEmail: student.guardianEmail || "",
    status: student.status,
    focusArea: student.focusArea || "",
    goals: student.goals || "",
    privateNotes: student.privateNotes || "",
    leadSource: student.leadSource || "",
    driveFolderUrl: student.driveFolderUrl || "",
    tagsText: student.tags?.join(", ") || "",
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    onSave({
      fullName: form.fullName.trim(),
      preferredName: form.preferredName.trim(),
      email: form.email.trim(),
      phone: form.phone.trim(),
      isMinor: form.isMinor,
      guardianName: form.isMinor ? form.guardianName.trim() : "",
      guardianEmail: form.isMinor ? form.guardianEmail.trim() : "",
      status: form.status,
      focusArea: form.focusArea.trim(),
      goals: form.goals.trim(),
      privateNotes: form.privateNotes.trim(),
      leadSource: form.leadSource.trim(),
      driveFolderUrl: form.driveFolderUrl.trim(),
      tags: form.tagsText
        .split(",")
        .map((i) => i.trim())
        .filter(Boolean),
    });
  };
  return (
    <Dialog
      title={`Edit ${student.fullName}`}
      description="Contact, coaching context, and studio status."
      onClose={onClose}
    >
      <form className="workflow-form" onSubmit={submit}>
        <label>
          Full name
          <input
            required
            value={form.fullName}
            onChange={(e) => setForm({ ...form, fullName: e.target.value })}
          />
        </label>
        <label>
          Preferred name
          <input
            value={form.preferredName || ""}
            onChange={(e) =>
              setForm({ ...form, preferredName: e.target.value })
            }
          />
        </label>
        <label>
          Email
          <input
            type="email"
            value={form.email || ""}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
          />
        </label>
        <Toggle
          checked={form.isMinor}
          label="Student is under 18"
          detail="Portal and payment access belongs to a guardian."
          onChange={(isMinor) => setForm({ ...form, isMinor })}
        />
        {form.isMinor && (
          <>
            <label>
              Guardian name
              <input
                required
                value={form.guardianName || ""}
                onChange={(e) =>
                  setForm({ ...form, guardianName: e.target.value })
                }
              />
            </label>
            <label>
              Guardian email
              <input
                required
                type="email"
                value={form.guardianEmail || ""}
                onChange={(e) =>
                  setForm({ ...form, guardianEmail: e.target.value })
                }
              />
            </label>
          </>
        )}
        <label>
          Phone
          <input
            value={form.phone || ""}
            onChange={(e) => setForm({ ...form, phone: e.target.value })}
          />
        </label>
        <label>
          Status
          <select
            value={form.status}
            onChange={(e) =>
              setForm({ ...form, status: e.target.value as StudentStatus })
            }
          >
            {["lead", "active", "paused", "alumni", "inactive"].map((i) => (
              <option key={i}>{i}</option>
            ))}
          </select>
        </label>
        <label>
          Focus area
          <input
            value={form.focusArea || ""}
            onChange={(e) => setForm({ ...form, focusArea: e.target.value })}
          />
        </label>
        <label className="full">
          Goals
          <textarea
            value={form.goals || ""}
            onChange={(e) => setForm({ ...form, goals: e.target.value })}
          />
        </label>
        <label className="full">
          Private coach notes
          <textarea
            value={form.privateNotes || ""}
            onChange={(e) => setForm({ ...form, privateNotes: e.target.value })}
          />
        </label>
        <label>
          Lead source
          <input
            value={form.leadSource || ""}
            onChange={(e) => setForm({ ...form, leadSource: e.target.value })}
          />
        </label>
        <label>
          Tags
          <input
            value={form.tagsText}
            onChange={(e) => setForm({ ...form, tagsText: e.target.value })}
          />
        </label>
        <label className="full">
          Google Drive folder
          <input
            type="url"
            value={form.driveFolderUrl || ""}
            onChange={(e) =>
              setForm({ ...form, driveFolderUrl: e.target.value })
            }
            placeholder="https://drive.google.com/drive/folders/…"
          />
          <small>
            Shown in this student's portal when Drive folders are enabled in
            studio settings.
          </small>
        </label>
        <p className="portal-notice full">
          Portal access, login credentials, and actor-page eligibility are
          managed in the Account tab so there is one authoritative control for
          each.
        </p>
        <div className="form-actions full">
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="primary" disabled={saving}>
            {saving ? "Saving…" : "Save details"}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
function LessonForm({
  student,
  onClose,
  onSave,
}: {
  student: Student;
  onClose: () => void;
  onSave: (
    l: Lesson,
    recurrence: "none" | "weekly" | "biweekly",
    occurrenceCount: number,
  ) => void;
}) {
  const [topic, setTopic] = useState("Private coaching"),
    [start, setStart] = useState(""),
    [duration, setDuration] = useState(60),
    [location, setLocation] = useState<"virtual" | "in_person">("virtual"),
    [recurrence, setRecurrence] = useState<"none" | "weekly" | "biweekly">(
      "none",
    ),
    [occurrenceCount, setOccurrenceCount] = useState(6),
    [locationLabel, setLocationLabel] = useState("");
  return (
    <Dialog title="Add lesson" description={student.fullName} onClose={onClose}>
      <form
        className="workflow-form"
        onSubmit={(e) => {
          e.preventDefault();
          const startsAt = new Date(start).toISOString();
          onSave(
            {
              id: uid("lesson"),
              studioId: student.studioId,
              studentId: student.id,
              topic,
              startsAt,
              endsAt: new Date(
                new Date(startsAt).getTime() + duration * 60000,
              ).toISOString(),
              status: "scheduled",
              locationType: location,
              locationLabel:
                location === "virtual"
                  ? "Google Meet pending"
                  : locationLabel || "Location to be confirmed",
              version: 1,
              updatedAt: now(),
            },
            recurrence,
            recurrence === "none" ? 1 : occurrenceCount,
          );
        }}
      >
        <label className="full">
          Lesson focus
          <input
            required
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
          />
        </label>
        <label>
          Start
          <input
            required
            type="datetime-local"
            value={start}
            onChange={(e) => setStart(e.target.value)}
          />
        </label>
        <label>
          Duration
          <select
            value={duration}
            onChange={(e) => setDuration(Number(e.target.value))}
          >
            <option value={30}>30 minutes</option>
            <option value={60}>60 minutes</option>
            <option value={90}>90 minutes</option>
          </select>
        </label>
        <label>
          Location
          <select
            value={location}
            onChange={(e) => setLocation(e.target.value as typeof location)}
          >
            <option value="virtual">Google Meet</option>
            <option value="in_person">In person</option>
          </select>
        </label>
        {location === "in_person" && (
          <label className="full">
            In-person location
            <input
              value={locationLabel}
              onChange={(event) => setLocationLabel(event.target.value)}
              placeholder="Address or meeting place (optional)"
            />
          </label>
        )}
        <label>
          Repeat
          <select
            value={recurrence}
            onChange={(event) =>
              setRecurrence(event.target.value as typeof recurrence)
            }
          >
            <option value="none">Does not repeat</option>
            <option value="weekly">Weekly</option>
            <option value="biweekly">Every other week</option>
          </select>
        </label>
        {recurrence !== "none" && (
          <label>
            Total lessons
            <input
              type="number"
              min="2"
              max="52"
              value={occurrenceCount}
              onChange={(event) =>
                setOccurrenceCount(Number(event.target.value))
              }
            />
            <small>
              Includes the first lesson. Times stay fixed in the studio timezone
              through daylight-saving changes.
            </small>
          </label>
        )}
        <div className="form-actions full">
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button
            className="primary"
            disabled={
              recurrence !== "none" &&
              (occurrenceCount < 2 || occurrenceCount > 52)
            }
          >
            {recurrence === "none"
              ? "Add lesson"
              : `Add ${occurrenceCount} lessons`}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
function AssignmentForm({
  student,
  lessons,
  timezone,
  note,
  onClose,
  onSave,
}: {
  student: Student;
  lessons: Lesson[];
  timezone: string;
  note?: Note;
  onClose: () => void;
  onSave: (a: Assignment) => void;
}) {
  const [title, setTitle] = useState(""),
    [details, setDetails] = useState(""),
    [dueAt, setDueAt] = useState(""),
    [activityType, setActivityType] = useState<NonNullable<Assignment["activityType"]>>("instruction"),
    [activityItems, setActivityItems] = useState(""),
    [lessonId, setLessonId] = useState(lessons[0]?.id ?? "");
  return (
    <Dialog
      title="Assign practice"
      description={student.fullName}
      onClose={onClose}
    >
      <form
        className="workflow-form"
        onSubmit={(e) => {
          e.preventDefault();
          onSave({
            id: uid("assignment"),
            studentId: student.id,
            lessonId,
            title,
            details,
            dueAt: dueAt ? new Date(dueAt).toISOString() : undefined,
            status: "assigned",
            helpRequested: false,
            activityType,
            activityConfig:
              activityType === "qa"
                ? { prompts: activityItems.split("\n").map((item) => item.trim()).filter(Boolean) }
                : activityType === "multiple_choice"
                  ? { options: activityItems.split("\n").map((item) => item.trim()).filter(Boolean) }
                  : activityType === "checklist"
                    ? { items: activityItems.split("\n").map((item) => item.trim()).filter(Boolean) }
                    : {},
            responses: {},
            version: 1,
            updatedAt: now(),
          });
        }}
      >
        <label className="full">
          Related lesson
          <select
            required
            value={lessonId}
            onChange={(event) => setLessonId(event.target.value)}
          >
            <option value="" disabled>
              Select a lesson
            </option>
            {lessons.map((lesson) => (
              <option key={lesson.id} value={lesson.id}>
                {formatStudioDateTime(lesson.startsAt, timezone)} · {lesson.topic}
              </option>
            ))}
          </select>
          {!lessons.length && (
            <small>Add a lesson before assigning practice.</small>
          )}
        </label>
        <label className="full">
          Title
          <input
            required
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </label>
        <label className="full">
          Instructions
          <textarea
            required
            value={details}
            onChange={(e) => setDetails(e.target.value)}
          />
        </label>
        <label>
          Activity format
          <select value={activityType} onChange={(event) => setActivityType(event.target.value as NonNullable<Assignment["activityType"]>)}>
            <option value="instruction">Action or reading</option>
            <option value="qa">Questions &amp; answers</option>
            <option value="journal">Journal prompt</option>
            <option value="multiple_choice">Multiple choice</option>
            <option value="checklist">Action checklist</option>
          </select>
        </label>
        {(["qa", "multiple_choice", "checklist"] as const).includes(activityType as "qa" | "multiple_choice" | "checklist") && (
          <label className="full">
            {activityType === "qa" ? "Questions" : activityType === "multiple_choice" ? "Choices" : "Checklist items"}
            <textarea
              required
              value={activityItems}
              onChange={(event) => setActivityItems(event.target.value)}
              placeholder="Enter one item per line"
            />
            <small>One per line. Students can save their progress and return later.</small>
          </label>
        )}
        <label>
          Due date
          <input
            type="date"
            value={dueAt}
            onChange={(e) => setDueAt(e.target.value)}
          />
        </label>
        <div className="form-actions full">
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="primary" disabled={!lessonId}>
            Assign
          </button>
        </div>
      </form>
    </Dialog>
  );
}
function MaterialForm({
  student,
  lessons,
  timezone,
  isDemo,
  onClose,
  onSave,
  fixedRole,
}: {
  student: Student;
  lessons: Lesson[];
  timezone: string;
  isDemo: boolean;
  onClose: () => void;
  onSave: (m: Material) => void;
  fixedRole?: Material["role"];
}) {
  const [title, setTitle] = useState(""),
    [category, setCategory] = useState("Script"),
    [url, setUrl] = useState(""),
    [role, setRole] = useState<Material["role"]>(fixedRole || "current_script"),
    [lessonId, setLessonId] = useState(lessons[0]?.id ?? ""),
    [file, setFile] = useState<File>(),
    [uploading, setUploading] = useState(false);
  return (
    <Dialog
      title="Add material"
      description={student.fullName}
      onClose={onClose}
    >
      <form
        className="workflow-form"
        onSubmit={async (e) => {
          e.preventDefault();
          setUploading(true);
          try {
            const uploaded =
              !isDemo && file
                ? await uploadStudioFile({
                    studioId: student.studioId,
                    studentId: student.id,
                    entityType:
                      fixedRole === "actor_material" ? "material" : "lesson",
                    entityId:
                      fixedRole === "actor_material" ? undefined : lessonId,
                    file,
                    visibility: "student",
                  })
                : undefined;
            onSave({
              id: uid("material"),
              studentId: student.id,
              lessonId: fixedRole === "actor_material" ? undefined : lessonId,
              title,
              category,
              externalUrl: url || undefined,
              storagePath: uploaded?.storagePath,
              mimeType: uploaded?.mimeType,
              fileSizeBytes: uploaded?.fileSizeBytes,
              mediaKind: uploaded?.mimeType.startsWith("image/")
                ? "image"
                : uploaded?.mimeType.startsWith("video/")
                  ? "video"
                  : uploaded?.mimeType.startsWith("audio/")
                    ? "audio"
                    : uploaded
                      ? "document"
                      : "link",
              role,
              status: "active",
              approvalStatus: "not_public",
              version: 1,
              updatedAt: now(),
            });
          } finally {
            setUploading(false);
          }
        }}
      >
        {role === "lesson_material" && (
          <label className="full">
            Related lesson
            <select
              required
              value={lessonId}
              onChange={(event) => setLessonId(event.target.value)}
            >
              <option value="" disabled>
                Select a lesson
              </option>
              {lessons.map((lesson) => (
                <option key={lesson.id} value={lesson.id}>
                  {formatStudioDateTime(lesson.startsAt, timezone)} · {lesson.topic}
                </option>
              ))}
            </select>
            {!lessons.length && (
              <small>Add a lesson before attaching materials.</small>
            )}
          </label>
        )}
        <label>
          Title
          <input
            required
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </label>
        {!fixedRole && (
          <label>
            Category
            <input
              value={category}
              onChange={(e) => setCategory(e.target.value)}
            />
          </label>
        )}
        <label>
          Role
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as Material["role"])}
          >
            <option value="current_script">Current script</option>
            <option value="lesson_material">Lesson material</option>
            <option value="library">Library</option>
            <option value="actor_material">Actor material</option>
          </select>
        </label>
        <label className="full">
          Link
          <input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://…"
          />
        </label>
        <label className="full material-upload">
          Upload file
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp,video/mp4,audio/mpeg,audio/mp4,application/pdf,text/plain"
            onChange={(event) => setFile(event.target.files?.[0])}
          />
          <small>Files stay private unless approved for an actor page.</small>
        </label>
        <div className="form-actions full">
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button
            className="primary"
            disabled={
              uploading ||
              (role === "lesson_material" && !lessonId) ||
              (fixedRole === "actor_material" && !url && !file)
            }
          >
            {uploading ? "Uploading…" : "Add material"}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
function NoteForm({
  student,
  lessons,
  timezone,
  note,
  onClose,
  onSave,
}: {
  student: Student;
  lessons: Lesson[];
  timezone: string;
  note?: Note;
  onClose: () => void;
  onSave: (n: Note) => void;
}) {
  const [title, setTitle] = useState(note?.title || "Lesson note"),
    [body, setBody] = useState(note?.bodyHtml || note?.body || ""),
    [published, setPublished] = useState(note?.status === "published"),
    [lessonId, setLessonId] = useState(note?.lessonId || lessons[0]?.id || "");
  const editorRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!editorRef.current) return;
    editorRef.current.innerHTML = DOMPurify.sanitize(
      note?.bodyHtml || note?.body || "",
    );
  }, [note?.id]);
  const format = (command: string, value?: string) => {
    editorRef.current?.focus();
    document.execCommand(command, false, value);
    setBody(editorRef.current?.innerHTML || "");
  };
  return (
    <Dialog title={note ? "Edit note" : "New note"} description={student.fullName} onClose={onClose}>
      <form
        className="workflow-form"
        onSubmit={(e) => {
          e.preventDefault();
          onSave({
            id: note?.id || uid("note"),
            studentId: student.id,
            lessonId,
            title,
            body: (
              editorRef.current?.innerText ||
              editorRef.current?.textContent ||
              ""
            ).trim(),
            bodyHtml: DOMPurify.sanitize(body, {
              ALLOWED_TAGS: [
                "p",
                "div",
                "br",
                "strong",
                "b",
                "em",
                "i",
                "u",
                "a",
                "ul",
                "ol",
                "li",
                "span",
              ],
              ALLOWED_ATTR: ["href", "target", "rel", "style"],
            }),
            status: published ? "published" : "draft",
            version: note?.version || 1,
            updatedAt: now(),
          });
        }}
      >
        <label className="full">
          Related lesson
          <select
            required
            value={lessonId}
            onChange={(event) => setLessonId(event.target.value)}
          >
            <option value="" disabled>
              Select a lesson
            </option>
            {lessons.map((lesson) => (
              <option key={lesson.id} value={lesson.id}>
                {formatStudioDateTime(lesson.startsAt, timezone)} · {lesson.topic}
              </option>
            ))}
          </select>
          {!lessons.length && (
            <small>Add a lesson before writing a lesson note.</small>
          )}
        </label>
        <label className="full">
          Title
          <input
            required
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </label>
        <label className="full" htmlFor="note-editor">
          Note
        </label>
        <div className="rich-editor full">
          <div
            className="rich-toolbar"
            role="toolbar"
            aria-label="Note formatting"
          >
            <button type="button" onClick={() => format("bold")}>
              <strong>B</strong>
            </button>
            <button type="button" onClick={() => format("italic")}>
              <em>I</em>
            </button>
            <button type="button" onClick={() => format("underline")}>
              <u>U</u>
            </button>
            <button type="button" onClick={() => format("justifyLeft")}>
              Left
            </button>
            <button type="button" onClick={() => format("justifyCenter")}>
              Center
            </button>
            <button type="button" onClick={() => format("justifyRight")}>
              Right
            </button>
            <button
              type="button"
              onClick={() => format("insertUnorderedList")}
              aria-label="Bulleted list"
            >
              • List
            </button>
            <button
              type="button"
              onClick={() => format("insertOrderedList")}
              aria-label="Numbered list"
            >
              1. List
            </button>
            <button
              type="button"
              onClick={() => {
                const href = window.prompt("Link URL");
                if (href) format("createLink", href);
              }}
            >
              Link
            </button>
          </div>
          <div
            id="note-editor"
            ref={editorRef}
            className="rich-editor-body"
            contentEditable
            role="textbox"
            aria-label="Note"
            aria-multiline="true"
            data-placeholder="Write coaching notes…"
            onInput={(event) => setBody(event.currentTarget.innerHTML)}
          />
        </div>
        <label className="check-row full">
          <input
            type="checkbox"
            checked={published}
            onChange={(e) => setPublished(e.target.checked)}
          />
          <span>
            <strong>Publish to student</strong>
            <small>Leave off to keep this as a private coach draft.</small>
          </span>
        </label>
        <div className="form-actions full">
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="primary" disabled={!body.trim() || !lessonId}>
            {note ? "Save changes" : "Save note"}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
