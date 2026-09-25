import { useQueryClient } from "@tanstack/react-query";
import DOMPurify from "dompurify";
import {
  ArrowLeft,
  Mail,
  MessageSquare,
  MoreHorizontal,
  Plus,
  RotateCcw,
  Trash2,
} from "lucide-react";
import {
  lazy,
  Suspense,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import {
  Link,
  NavLink,
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useParams,
} from "react-router-dom";
import { Dialog, Status, Toggle } from "../../components/Primitives";
import { studioCommand } from "../../data/bookingCommands";
import { uploadStudioFile } from "../../data/uploads";
import type {
  Assignment,
  Lesson,
  Material,
  Note,
  Student,
  StudentStatus,
} from "../../domain/model";
import { formatStudioDateTime } from "../../domain/presentation";
import { invalidateStudioDomains, useStudioRoute } from "../../hooks/useStudio";
import { useStudioMutation } from "../../hooks/useStudioMutation";
import { useStudioStore } from "../../state/StudioStore";

import { belongsToStudent, now, uid } from "./StudentWorkspace.shared";
import { studentWorkspaceDomains } from "./routeDomains";
const Account = lazy(() =>
  import("./StudentWorkspaceAccount").then((module) => ({
    default: module.Account,
  })),
);
const HouseholdContactProfile = lazy(() =>
  import("./StudentWorkspaceAccount").then((module) => ({
    default: module.HouseholdContactProfile,
  })),
);
const ActorPage = lazy(() =>
  import("./StudentWorkspaceActorPage").then((module) => ({
    default: module.ActorPage,
  })),
);
const CoachLessonHub = lazy(() =>
  import("./StudentWorkspaceLessons").then((module) => ({
    default: module.CoachLessonHub,
  })),
);
const Lessons = lazy(() =>
  import("./StudentWorkspaceLessons").then((module) => ({
    default: module.Lessons,
  })),
);
const Notes = lazy(() =>
  import("./StudentWorkspaceNotes").then((module) => ({
    default: module.Notes,
  })),
);
const Overview = lazy(() =>
  import("./StudentWorkspaceOverview").then((module) => ({
    default: module.Overview,
  })),
);
const Payments = lazy(() =>
  import("./StudentWorkspacePayments").then((module) => ({
    default: module.Payments,
  })),
);
const Work = lazy(() =>
  import("./StudentWorkspaceWork").then((module) => ({
    default: module.Work,
  })),
);

export function StudentWorkspace() {
  const { studentId = "" } = useParams();
  const location = useLocation();
  const { data, isDemo } = useStudioRoute(
    "coach",
    undefined,
    studentWorkspaceDomains(location.pathname),
  );
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
  const [recordMenuOpen, setRecordMenuOpen] = useState(false);
  const [workflowLessonId, setWorkflowLessonId] = useState<string>();
  const student = data?.students.find((item) => item.id === studentId);
  useEffect(() => {
    const tabs = document.querySelector<HTMLElement>(".record-tabs");
    const active = tabs?.querySelector<HTMLElement>("a.active");
    if (tabs && active)
      tabs.scrollLeft = Math.max(
        0,
        active.offsetLeft -
          tabs.offsetLeft -
          (tabs.clientWidth - active.clientWidth) / 2,
      );
  }, [location.pathname]);
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
          await invalidateStudioDomains(queryClient, ["students"]);
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
  const sendPortalInvite = async (
    accountType: "student" | "guardian",
    linkedContactId?: string,
  ) => {
    if (settingCredentials) return;
    setSettingCredentials(true);
    setNotice(
      "Generating a secure one-time login and queueing the invitation…",
    );
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
          window.setTimeout(
            () =>
              setUndoInvite((current) =>
                current === result.outboxMessageId ? undefined : current,
              ),
            8_000,
          );
        }
        await invalidateStudioDomains(queryClient, ["students", "messaging"]);
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
      await studioCommand("outbox", {
        command: "cancel_manual",
        entityId: messageId,
        expectedVersion: 1,
        reason: "Coach undid portal invitation email",
      });
      await invalidateStudioDomains(queryClient, ["messaging"]);
      setNotice(
        "Invitation email send undone. Portal access remains available.",
      );
    } catch (reason) {
      setNotice(
        reason instanceof Error
          ? reason.message
          : "The invitation has already started sending.",
      );
    }
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
        void invalidateStudioDomains(queryClient, ["lessons"]);
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
        await invalidateStudioDomains(queryClient, ["work"]);
      }
      setDialog(null);
      setWorkflowLessonId(undefined);
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
        void invalidateStudioDomains(queryClient, ["work"]);
      }
      setDialog(null);
      setWorkflowLessonId(undefined);
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
          if (current)
            Object.assign(current, note, { version: current.version + 1 });
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
        void invalidateStudioDomains(queryClient, ["work"]);
      }
      setDialog(null);
      setWorkflowLessonId(undefined);
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
        await invalidateStudioDomains(queryClient, ["work"]);
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
        await invalidateStudioDomains(queryClient, ["work"]);
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
        await invalidateStudioDomains(queryClient, ["work"]);
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
      await invalidateStudioDomains(queryClient, ["students"]);
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
          <button onClick={() => setDialog("lesson")}>
            <Plus />
            Add lesson
          </button>
          {student.email && (
            <Link
              className="button-link"
              to={`/coach/inbox?student=${encodeURIComponent(student.id)}`}
            >
              <MessageSquare />
              Message
            </Link>
          )}
          {student.email && (
            <button onClick={() => setRecordMenuOpen(true)}>
              <MoreHorizontal />
              More actions
            </button>
          )}
          {!student.email && (
            <button onClick={() => setRecordMenuOpen(true)}>
              <MoreHorizontal />
              More actions
            </button>
          )}
        </div>
      </header>
      {notice && (
        <p className="portal-notice" role="status">
          {notice}
        </p>
      )}
      {undoInvite && (
        <div className="undo-send" role="status">
          <span>Invitation email queued</span>
          <button onClick={() => void undoPortalInvite()}>
            <RotateCcw />
            Undo
          </button>
        </div>
      )}
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
      <Suspense
        fallback={
          <div className="loading" role="status">
            Opening this section…
          </div>
        }
      >
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
              <CoachLessonHub
                data={data}
                student={student}
                isDemo={isDemo}
                onAddNote={(lessonId) => {
                  setWorkflowLessonId(lessonId);
                  setDialog("note");
                }}
                onAddAssignment={(lessonId) => {
                  setWorkflowLessonId(lessonId);
                  setDialog("assignment");
                }}
                onAddMaterial={(lessonId) => {
                  setWorkflowLessonId(lessonId);
                  setDialog("material");
                }}
              />
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
          <Route
            path="contacts/:contactId"
            element={
              <HouseholdContactProfile
                data={data}
                student={student}
                busy={settingCredentials}
                onInvite={sendPortalInvite}
              />
            }
          />
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
      </Suspense>
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
      {recordMenuOpen && (
        <Dialog
          title="Student actions"
          description={`Secondary actions for ${student.preferredName || student.fullName}.`}
          onClose={() => setRecordMenuOpen(false)}
        >
          <div className="stack-actions student-overflow-actions">
            <button
              onClick={() => {
                setRecordMenuOpen(false);
                setDialog("edit");
              }}
            >
              Edit details
            </button>
            {student.email && (
              <Link
                className="button-link"
                to={`/coach/inbox?student=${encodeURIComponent(student.id)}&email=1`}
                onClick={() => setRecordMenuOpen(false)}
              >
                <Mail />
                Email
              </Link>
            )}
            <button
              className="danger-button"
              onClick={() => {
                setRecordMenuOpen(false);
                setConfirmRemove(true);
              }}
            >
              <Trash2 />
              Remove student
            </button>
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
          initialLessonId={workflowLessonId}
          onClose={() => {
            setDialog(null);
            setWorkflowLessonId(undefined);
          }}
          onSave={addAssignment}
        />
      )}
      {dialog === "material" && (
        <MaterialForm
          student={student}
          lessons={studentLessons}
          timezone={data.settings.timezone}
          isDemo={isDemo}
          initialLessonId={workflowLessonId}
          onClose={() => {
            setDialog(null);
            setWorkflowLessonId(undefined);
          }}
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
          initialLessonId={workflowLessonId}
          onClose={() => {
            setDialog(null);
            setWorkflowLessonId(undefined);
            setEditingNote(undefined);
          }}
          onSave={addNote}
        />
      )}
    </div>
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
  initialLessonId,
  onClose,
  onSave,
}: {
  student: Student;
  lessons: Lesson[];
  timezone: string;
  note?: Note;
  initialLessonId?: string;
  onClose: () => void;
  onSave: (a: Assignment) => void;
}) {
  const [title, setTitle] = useState(""),
    [details, setDetails] = useState(""),
    [dueAt, setDueAt] = useState(""),
    [activityType, setActivityType] =
      useState<NonNullable<Assignment["activityType"]>>("instruction"),
    [activityItems, setActivityItems] = useState(""),
    [lessonId, setLessonId] = useState(initialLessonId || lessons[0]?.id || "");
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
                ? {
                    prompts: activityItems
                      .split("\n")
                      .map((item) => item.trim())
                      .filter(Boolean),
                  }
                : activityType === "multiple_choice"
                  ? {
                      options: activityItems
                        .split("\n")
                        .map((item) => item.trim())
                        .filter(Boolean),
                    }
                  : activityType === "checklist"
                    ? {
                        items: activityItems
                          .split("\n")
                          .map((item) => item.trim())
                          .filter(Boolean),
                      }
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
                {formatStudioDateTime(lesson.startsAt, timezone)} ·{" "}
                {lesson.topic}
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
          <select
            value={activityType}
            onChange={(event) =>
              setActivityType(
                event.target.value as NonNullable<Assignment["activityType"]>,
              )
            }
          >
            <option value="instruction">Action or reading</option>
            <option value="qa">Questions &amp; answers</option>
            <option value="journal">Journal prompt</option>
            <option value="multiple_choice">Multiple choice</option>
            <option value="checklist">Action checklist</option>
          </select>
        </label>
        {(["qa", "multiple_choice", "checklist"] as const).includes(
          activityType as "qa" | "multiple_choice" | "checklist",
        ) && (
          <label className="full">
            {activityType === "qa"
              ? "Questions"
              : activityType === "multiple_choice"
                ? "Choices"
                : "Checklist items"}
            <textarea
              required
              value={activityItems}
              onChange={(event) => setActivityItems(event.target.value)}
              placeholder="Enter one item per line"
            />
            <small>
              One per line. Students can save their progress and return later.
            </small>
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
  initialLessonId,
}: {
  student: Student;
  lessons: Lesson[];
  timezone: string;
  isDemo: boolean;
  onClose: () => void;
  onSave: (m: Material) => void;
  fixedRole?: Material["role"];
  initialLessonId?: string;
}) {
  const [title, setTitle] = useState(""),
    [category, setCategory] = useState("Script"),
    [url, setUrl] = useState(""),
    [role, setRole] = useState<Material["role"]>(
      fixedRole || (initialLessonId ? "lesson_material" : "current_script"),
    ),
    [lessonId, setLessonId] = useState(initialLessonId || lessons[0]?.id || ""),
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
                  {formatStudioDateTime(lesson.startsAt, timezone)} ·{" "}
                  {lesson.topic}
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
  initialLessonId,
  onClose,
  onSave,
}: {
  student: Student;
  lessons: Lesson[];
  timezone: string;
  note?: Note;
  initialLessonId?: string;
  onClose: () => void;
  onSave: (n: Note) => void;
}) {
  const [title, setTitle] = useState(note?.title || "Lesson note"),
    [body, setBody] = useState(note?.bodyHtml || note?.body || ""),
    [published, setPublished] = useState(note?.status === "published"),
    [lessonId, setLessonId] = useState(
      note?.lessonId || initialLessonId || lessons[0]?.id || "",
    );
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
    <Dialog
      title={note ? "Edit note" : "New note"}
      description={student.fullName}
      onClose={onClose}
    >
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
                {formatStudioDateTime(lesson.startsAt, timezone)} ·{" "}
                {lesson.topic}
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
