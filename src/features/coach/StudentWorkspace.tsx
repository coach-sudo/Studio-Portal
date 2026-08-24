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
  Search,
  Trash2,
  UserRound,
} from "lucide-react";
import { useMemo, useRef, useState, type FormEvent } from "react";
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
import { studioCommand } from "../../data/bookingCommands";
import { uploadStudioFile } from "../../data/uploads";
import { LessonWhiteboard } from "../../components/LessonWhiteboard";

const uid = (prefix: string) => `${prefix}-${crypto.randomUUID()}`;
const now = () => new Date().toISOString();

export function StudentWorkspace() {
  const { studentId = "" } = useParams();
  const { data, isDemo } = useStudio();
  const store = useStudioStore();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [dialog, setDialog] = useState<
    "edit" | "lesson" | "assignment" | "material" | "actor-material" | "note" | null
  >(null);
  const [notice, setNotice] = useState("");
  const [savingStudent, setSavingStudent] = useState(false);
  const [invitingStudent, setInvitingStudent] = useState(false);
  const [settingCredentials, setSettingCredentials] = useState(false);
  const student = data?.students.find((item) => item.id === studentId);
  if (!data) return <div className="loading">Opening student record…</div>;
  if (!student) return <Navigate to="/coach/students" replace />;

  const base = `/coach/students/${student.id}`;
  const studentLessons = data.lessons
    .filter((item) =>
      item.studentId === student.id ||
      data.lessonParticipants.some(
        (participant) =>
          participant.lessonId === item.id && participant.studentId === student.id,
      ),
    )
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
    if (savingStudent) return;
    setSavingStudent(true);
    setNotice("Saving student details…");
    try {
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
      setDialog(null);
      setNotice("Student details saved.");
    } catch (reason) {
      setNotice(
        reason instanceof Error
          ? reason.message
          : "Student details could not be saved.",
      );
    } finally {
      setSavingStudent(false);
    }
  };
  const inviteStudent = async () => {
    if (invitingStudent) return;
    setInvitingStudent(true);
    setNotice("Sending the portal invitation…");
    try {
      if (isDemo)
        store.transact((draft) => {
          const item = draft.students.find((row) => row.id === student.id)!;
          item.portalEnabled = true;
          item.version += 1;
          item.updatedAt = now();
        });
      else {
        await studioCommand("students", {
          command: "invite",
          entityId: student.id,
          expectedVersion: student.version,
          reason: "Coach sent student portal invitation",
        });
        void queryClient.invalidateQueries({ queryKey: ["studio"] });
      }
      setNotice(
        `Portal invitation sent to ${student.isMinor ? student.guardianEmail : student.email}.`,
      );
    } catch (reason) {
      setNotice(
        reason instanceof Error
          ? reason.message
          : "Portal invitation could not be sent.",
      );
    } finally {
      setInvitingStudent(false);
    }
  };
  const setPortalCredentials = async (username: string, password: string) => {
    if (settingCredentials) return;
    setSettingCredentials(true);
    setNotice("Creating secure portal credentials…");
    try {
      if (isDemo) {
        store.transact((draft) => {
          const item = draft.students.find((row) => row.id === student.id)!;
          item.portalUsername = username;
          item.portalEnabled = true;
          item.version += 1;
          item.updatedAt = now();
        });
      } else {
        await studioCommand("students", {
          command: "set_credentials",
          entityId: student.id,
          expectedVersion: student.version,
          payload: { username, password },
          reason: "Coach created or reset portal credentials",
        });
        void queryClient.invalidateQueries({ queryKey: ["studio"] });
      }
      setNotice(`Portal login is ready for username ${username}.`);
    } catch (reason) {
      setNotice(
        reason instanceof Error
          ? reason.message
          : "Portal credentials could not be created.",
      );
      throw reason;
    } finally {
      setSettingCredentials(false);
    }
  };
  const addLesson = async (lesson: Lesson) => {
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
      if (isDemo) store.transact((draft) => draft.notes.push(note));
      else {
        await studioCommand("notes", {
          command: "create",
          expectedVersion: 0,
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
    if (!window.confirm(`Delete “${note.title}”? This cannot be undone.`)) return;
    try { if (isDemo) store.transact((draft) => { draft.notes = draft.notes.filter((item) => item.id !== note.id); }); else { await studioCommand("notes", { command: "delete", entityId: note.id, expectedVersion: note.version, reason: "Coach deleted student note" }); await queryClient.invalidateQueries({ queryKey: ["studio"] }); } setNotice("Note deleted."); }
    catch (reason) { setNotice(reason instanceof Error ? reason.message : "Note could not be deleted."); }
  };

  return (
    <div className="page student-record-page">
      <header className="student-record-header">
        <button className="back-button" onClick={() => navigate("/coach/students")}>
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
            <a className="button-link primary" href={`mailto:${student.email}`}>
              <Mail />
              Email
            </a>
          )}
        </div>
      </header>
      {notice && (
        <p className="portal-notice" role="status">
          {notice}
        </p>
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
          element={<CoachLessonHub data={data} student={student} isDemo={isDemo} />}
        />
        <Route
          path="work"
          element={
            <Work
              data={data}
              student={student}
              onAddAssignment={() => setDialog("assignment")}
              onAddMaterial={() => setDialog("material")}
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
              onDelete={deleteNote}
            />
          }
        />
        <Route
          path="account"
          element={<Account student={student} onSave={saveStudent} onInvite={inviteStudent} inviting={invitingStudent} onSetCredentials={setPortalCredentials} settingCredentials={settingCredentials} />}
        />
        <Route
          path="payments"
          element={<Payments data={data} student={student} isDemo={isDemo} />}
        />
        <Route
          path="actor-page"
          element={<ActorPage data={data} student={student} isDemo={isDemo} onAddMaterial={()=>setDialog("actor-material")} />}
        />
        <Route path="*" element={<Navigate to={base} replace />} />
      </Routes>
      {dialog === "edit" && (
        <StudentEditor
          student={student}
          saving={savingStudent}
          onClose={() => setDialog(null)}
          onSave={saveStudent}
        />
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
          onClose={() => setDialog(null)}
          onSave={addAssignment}
        />
      )}
      {dialog === "material" && (
        <MaterialForm
          student={student}
          lessons={studentLessons}
          isDemo={isDemo}
          onClose={() => setDialog(null)}
          onSave={addMaterial}
        />
      )}
      {dialog === "actor-material" && (
        <MaterialForm student={student} lessons={studentLessons} isDemo={isDemo} fixedRole="actor_material" onClose={() => setDialog(null)} onSave={addMaterial} />
      )}
      {dialog === "note" && (
        <NoteForm
          student={student}
          lessons={studentLessons}
          onClose={() => setDialog(null)}
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
      (item) => item.studentId === student.id && item.status === "scheduled",
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
                  ? new Date(upcoming.startsAt).toLocaleString()
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
                  ? new Date(student.lastContactAt).toLocaleDateString()
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
  const lessons = data.lessons
    .filter((item) => item.studentId === student.id)
    .sort((a, b) => b.startsAt.localeCompare(a.startsAt));
  return (
    <Section title="Lesson history" marked>
      <div className="table-list">
        {lessons.map((lesson) => (
          <Link className="student-roster-row" key={lesson.id} to={`/coach/students/${student.id}/lessons/${lesson.id}`}>
            <CalendarDays />
            <div>
              <strong>{lesson.topic}</strong>
              <small>
                {new Date(lesson.startsAt).toLocaleString()} ·{" "}
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
        ))}
        {!lessons.length && (
          <EmptyState
            title="No lessons yet"
            detail="Add the first lesson from the student header."
          />
        )}
      </div>
    </Section>
  );
}
function CoachLessonHub({ data, student, isDemo }: { data: Data; student: Student; isDemo: boolean }) {
  const { lessonId = "" } = useParams();
  const queryClient = useQueryClient();
  const store = useStudioStore();
  const lesson = data.lessons.find((item) => item.id === lessonId);
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState("");
  if (!lesson) return <Navigate to={`/coach/students/${student.id}/lessons`} replace />;
  const notes = data.notes.filter((item) => item.lessonId === lesson.id);
  const assignments = data.assignments.filter((item) => item.lessonId === lesson.id);
  const materials = data.materials.filter((item) => item.lessonId === lesson.id);
  const messages = data.lessonMessages.filter((item) => item.lessonId === lesson.id);
  const send = async (event: FormEvent) => {
    event.preventDefault();
    if (!message.trim() || sending) return;
    setSending(true);
    try {
      await studioCommand("messages", {
        command: "create",
        expectedVersion: 0,
        payload: { lessonId: lesson.id, studentId: student.id, body: message.trim() },
        reason: "Coach sent a lesson message",
      });
      setMessage("");
      setNotice("Message shared in the student lesson workspace.");
      void queryClient.invalidateQueries({ queryKey: ["studio"] });
    } catch (reason) {
      setNotice(reason instanceof Error ? reason.message : "Message could not be sent.");
    } finally {
      setSending(false);
    }
  };
  return (
    <div>
      <Link className="back-button" to={`/coach/students/${student.id}/lessons`}><ArrowLeft /> Lesson history</Link>
      <Section title={lesson.topic} marked>
        <p className="section-intro">{new Date(lesson.startsAt).toLocaleString()} · {lesson.locationLabel} · {lesson.status}</p>
        {lesson.joinUrl && <a className="button-link" href={lesson.joinUrl} target="_blank" rel="noreferrer">Open Google Meet</a>}
      </Section>
      {notice && <p className="portal-notice" role="status">{notice}</p>}
      <LessonWhiteboard data={data} lesson={lesson} student={student} isDemo={isDemo} onDemoChange={(board)=>store.transact((draft)=>{const current=draft.lessonWhiteboards.find((item)=>item.lessonId===lesson.id);if(current)Object.assign(current,board);else draft.lessonWhiteboards.push(board);})}/>
      <div className="lesson-hub-grid">
        <Section title="Notes"><div className="note-cards">{notes.map((note) => <article key={note.id}><header><strong>{note.title}</strong><Status tone={note.status === "published" ? "good" : "neutral"}>{note.status}</Status></header><div className="published-note-body" dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(note.bodyHtml || note.body) }} /></article>)}{!notes.length && <EmptyState title="No lesson notes" detail="Use the Notes tab to add one for this lesson." />}</div></Section>
        <Section title="Practice"><div className="table-list">{assignments.map((item) => <article key={item.id}><CheckSquare /><div><strong>{item.title}</strong><small>{item.details}</small></div><Status tone={item.helpRequested ? "warn" : "neutral"}>{item.helpRequested ? "help requested" : item.status.replaceAll("_", " ")}</Status></article>)}{!assignments.length && <EmptyState title="No linked practice" detail="Use Current work to assign practice to this lesson." />}</div></Section>
        <Section title="Attachments"><div className="table-list">{materials.map((item) => <article key={item.id}><FolderOpen /><div><strong>{item.title}</strong><small>{item.category}</small></div>{item.externalUrl && <a className="button-link" href={item.externalUrl} target="_blank" rel="noreferrer">Open</a>}</article>)}{!materials.length && <EmptyState title="No attachments" detail="Use Current work to attach a file or link to this lesson." />}</div></Section>
        <Section title="Conversation"><div className="note-cards">{messages.map((item) => <article key={item.id}><header><strong>{item.authorRole === "coach" ? "Coach" : student.preferredName || student.fullName}</strong><small>{new Date(item.createdAt).toLocaleString()}</small></header><p>{item.body}</p></article>)}</div><form className="credential-form" onSubmit={send}><label>Message<textarea value={message} onChange={(event) => setMessage(event.target.value)} placeholder="Follow up about this lesson…" /></label><button className="primary-button" disabled={sending || !message.trim()}>{sending ? "Sending…" : "Send to student"}</button></form></Section>
      </div>
    </div>
  );
}
function Work({
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
  const assignments = data.assignments.filter(
      (i) => i.studentId === student.id,
    ),
    materials = data.materials.filter((i) => i.studentId === student.id && i.role !== "actor_material");
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
                    ? ` · due ${new Date(item.dueAt).toLocaleDateString()}`
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
  onDelete,
}: {
  data: Data;
  student: Student;
  onAdd: () => void;
  onDelete: (note: Note) => void;
}) {
  const [query, setQuery] = useState(""), [status, setStatus] = useState("all"), [selected,setSelected]=useState<Note>();
  const notes = data.notes
    .filter((i) => i.studentId === student.id)
    .filter((note) => (status === "all" || note.status === status) && [note.title,note.body,...(note.tags||[])].join(" ").toLowerCase().includes(query.toLowerCase()))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const notePage = usePagedList(notes);
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
      <div className="library-toolbar"><label><Search /><input aria-label="Search this student’s notes" placeholder="Search notes…" value={query} onChange={(event) => setQuery(event.target.value)} /></label><select aria-label="Note status" value={status} onChange={(event) => setStatus(event.target.value)}><option value="all">All statuses</option><option value="draft">Drafts</option><option value="published">Published</option></select></div>
      <ListControls page={notePage.page} pageCount={notePage.pageCount} pageSize={notePage.pageSize} total={notePage.total} onPage={notePage.setPage} onPageSize={notePage.setPageSize} label="notes" />
      <div className="lesson-note-index">
        {notePage.visible.map((note) => (
          <button type="button" key={note.id} onClick={()=>setSelected(note)}><CalendarDays/><span><strong>{note.lessonId?new Date(data.lessons.find(item=>item.id===note.lessonId)?.startsAt||note.updatedAt).toLocaleDateString():"General note"}</strong><small>{data.lessons.find(item=>item.id===note.lessonId)?.topic||note.title} · {note.title}</small></span><Status tone={note.status === "published" ? "good" : "neutral"}>{note.status}</Status></button>
        ))}
        {!notes.length && (
          <EmptyState
            title="No notes yet"
            detail="Private drafts stay private; published notes appear for the student."
          />
        )}
      </div>
      {selected&&<Dialog title={selected.title} description={selected.lessonId?`${new Date(data.lessons.find(item=>item.id===selected.lessonId)?.startsAt||selected.updatedAt).toLocaleString()} · ${data.lessons.find(item=>item.id===selected.lessonId)?.topic||"Lesson"}`:"General coaching note"} onClose={()=>setSelected(undefined)}>{selected.bodyHtml?<div className="rich-note-body" dangerouslySetInnerHTML={{__html:DOMPurify.sanitize(selected.bodyHtml)}}/>:<p>{selected.body}</p>}<div className="form-actions"><button type="button" className="danger-button" onClick={()=>{onDelete(selected);setSelected(undefined);}}><Trash2/>Delete note</button><button type="button" onClick={()=>setSelected(undefined)}>Close</button></div></Dialog>}
    </Section>
  );
}
function Account({
  student,
  onSave,
  onInvite,
  inviting,
  onSetCredentials,
  settingCredentials,
}: {
  student: Student;
  onSave: (updates: Partial<Student>) => void;
  onInvite: () => Promise<void>;
  inviting: boolean;
  onSetCredentials: (username: string, password: string) => Promise<void>;
  settingCredentials: boolean;
}) {
  const usernameBase = student.fullName.toLowerCase().replace(/[^a-z0-9]+/g, ".").replace(/^\.|\.$/g, "");
  const defaultUsername = student.portalUsername || (/^[a-z]/.test(usernameBase) ? usernameBase : `actor.${usernameBase}`).slice(0, 32);
  const [username, setUsername] = useState(defaultUsername);
  const [password, setPassword] = useState("");
  const toggle = (field: "portalEnabled" | "actorPageEligible") =>
    onSave({ [field]: !student[field] });
  return (
    <div className="two-section-grid">
      <Section title="Access & visibility" marked>
        <div className="settings-list">
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
          <div className="setting-toggle">
            <span>
              <strong>Portal invitation</strong>
              <small>
                Send a secure Supabase invitation to the student or guardian email on file.
              </small>
            </span>
            <button type="button" disabled={inviting} onClick={() => void onInvite()}>
              {inviting ? "Sending…" : student.portalEnabled ? "Resend invite" : "Send invite"}
            </button>
          </div>
          <form
            className="credential-form"
            onSubmit={(event) => {
              event.preventDefault();
              void onSetCredentials(username, password)
                .then(() => setPassword(""))
                .catch(() => undefined);
            }}
          >
            <div>
              <strong>Username &amp; password</strong>
              <small>Create or reset a reliable login. Use 12+ characters with upper/lowercase letters, a number, and a symbol. Share it securely; it is never stored by the studio.</small>
            </div>
            <label>
              Username
              <input required minLength={3} maxLength={32} pattern="[A-Za-z][A-Za-z0-9._-]{2,31}" autoComplete="off" value={username} onChange={(event) => setUsername(event.target.value.toLowerCase())} />
            </label>
            <label>
              Temporary password
              <input required minLength={12} type="password" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} />
            </label>
            <button className="primary" disabled={settingCredentials}>
              {settingCredentials ? "Creating login…" : student.portalUsername ? "Reset login" : "Create login"}
            </button>
          </form>
        </div>
      </Section>
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
    [creditQuantity, setCreditQuantity] = useState(1),
    [creditReason, setCreditReason] = useState("Courtesy lesson credit"),
    [notice, setNotice] = useState("");
  const grantCredit = async (event: FormEvent) => { event.preventDefault(); try { if(isDemo){store.transact((draft)=>{let pkg=draft.packages.find((item)=>item.studentId===student.id&&item.name==="Studio lesson credits");if(!pkg){pkg={id:uid("package"),studentId:student.id,name:"Studio lesson credits",priceMinor:0,currency:"USD",version:1,updatedAt:now()};draft.packages.push(pkg);}draft.creditEntries.push({id:uid("credit"),packageId:pkg.id,kind:"adjustment",quantity:creditQuantity,reason:creditReason,createdAt:now()});});}else{await studioCommand("credits",{command:"grant",expectedVersion:0,payload:{studentId:student.id,quantity:creditQuantity,reason:creditReason},reason:"Coach adjusted student credits"});await queryClient.invalidateQueries({queryKey:["studio"]});}setCrediting(false);setNotice(`${creditQuantity>0?"Added":"Removed"} ${Math.abs(creditQuantity)} lesson credit${Math.abs(creditQuantity)===1?"":"s"}.`);}catch(reason){setNotice(reason instanceof Error?reason.message:"Credits could not be updated.");} };
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
            <div className="header-actions"><button onClick={() => setCrediting(true)}>Adjust credits</button><button disabled={!data.packageDefinitions.some((item) => item.active)} onClick={() => setAssigning(true)}>Assign package</button></div>
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
          <div className="table-list">
            {payments.map((p) => (
              <article key={p.id}>
                <CircleDollarSign />
                <div>
                  <strong>{p.reason}</strong>
                  <small>{new Date(p.createdAt).toLocaleDateString()}</small>
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
      {crediting && <Dialog title="Adjust lesson credits" description={`Add or remove credits for ${student.preferredName||student.fullName}. Every adjustment is recorded in the ledger.`} onClose={()=>setCrediting(false)}><form className="workflow-form" onSubmit={grantCredit}><label>Credits<input required type="number" min="-100" max="100" step="1" value={creditQuantity} onChange={event=>setCreditQuantity(Number(event.target.value))}/><small>Use a negative number to correct a balance.</small></label><label className="full">Reason<input required minLength={3} value={creditReason} onChange={event=>setCreditReason(event.target.value)}/></label><div className="form-actions full"><button type="button" onClick={()=>setCrediting(false)}>Cancel</button><button className="primary" disabled={!creditQuantity||creditReason.trim().length<3}>Save credit adjustment</button></div></form></Dialog>}
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
  onAddMaterial:()=>void;
}) {
  const store = useStudioStore();
  const queryClient = useQueryClient();
  const profile = data.actorProfiles.find((i) => i.studentId === student.id);
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
  const actorMaterials=data.materials.filter(item=>item.studentId===student.id&&item.role==="actor_material");
  return (
    <div className="student-page"><Section title="Actor page" marked>
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
          {profile.status === "published" && (
            <a href={`/actors/${profile.slug}`} target="_blank" rel="noreferrer">
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
    </Section><Section title="Headshots, gallery, reel & résumé" aside={<button onClick={onAddMaterial}><Plus/>Add actor material</button>}><p className="section-intro">These uploads are reserved for the public actor page and its review workflow.</p><div className="table-list">{actorMaterials.map(item=><article key={item.id}><FolderOpen/><div><strong>{item.title}</strong><small>{item.category} · {item.approvalStatus.replaceAll("_"," ")}</small></div>{item.externalUrl&&<a href={item.externalUrl} target="_blank" rel="noreferrer">Open</a>}</article>)}{!actorMaterials.length&&<EmptyState title="No actor-page media" detail="Add the main headshot, gallery photos, reel, and résumé here."/>}</div></Section></div>
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
  return <Toggle checked={checked} label={title} detail={detail} onChange={onChange} />;
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
          Portal access, login credentials, and actor-page eligibility are managed
          in the Account tab so there is one authoritative control for each.
        </p>
        <div className="form-actions full">
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="primary" disabled={saving}>{saving ? "Saving…" : "Save details"}</button>
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
  onSave: (l: Lesson) => void;
}) {
  const [topic, setTopic] = useState("Private coaching"),
    [start, setStart] = useState(""),
    [duration, setDuration] = useState(60),
    [location, setLocation] = useState<"virtual" | "in_person">("virtual"),
    [locationLabel, setLocationLabel] = useState("");
  return (
    <Dialog title="Add lesson" description={student.fullName} onClose={onClose}>
      <form
        className="workflow-form"
        onSubmit={(e) => {
          e.preventDefault();
          const startsAt = new Date(start).toISOString();
          onSave({
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
          });
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
        <div className="form-actions full">
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="primary">Add lesson</button>
        </div>
      </form>
    </Dialog>
  );
}
function AssignmentForm({
  student,
  lessons,
  onClose,
  onSave,
}: {
  student: Student;
  lessons: Lesson[];
  onClose: () => void;
  onSave: (a: Assignment) => void;
}) {
  const [title, setTitle] = useState(""),
    [details, setDetails] = useState(""),
    [dueAt, setDueAt] = useState(""),
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
            version: 1,
            updatedAt: now(),
          });
        }}
      >
        <label className="full">
          Related lesson
          <select required value={lessonId} onChange={(event) => setLessonId(event.target.value)}>
            <option value="" disabled>Select a lesson</option>
            {lessons.map((lesson) => (
              <option key={lesson.id} value={lesson.id}>
                {new Date(lesson.startsAt).toLocaleString()} · {lesson.topic}
              </option>
            ))}
          </select>
          {!lessons.length && <small>Add a lesson before assigning practice.</small>}
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
          <button className="primary" disabled={!lessonId}>Assign</button>
        </div>
      </form>
    </Dialog>
  );
}
function MaterialForm({
  student,
  lessons,
  isDemo,
  onClose,
  onSave,
  fixedRole,
}: {
  student: Student;
  lessons: Lesson[];
  isDemo: boolean;
  onClose: () => void;
  onSave: (m: Material) => void;
  fixedRole?: Material["role"];
}) {
  const [title, setTitle] = useState(""),
    [category, setCategory] = useState("Script"),
    [url, setUrl] = useState(""),
    [role, setRole] = useState<Material["role"]>(fixedRole||"current_script"),
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
                    entityType: fixedRole==="actor_material"?"material":"lesson",
                    entityId: fixedRole==="actor_material"?undefined:lessonId,
                    file,
                    visibility: "student",
                  })
                : undefined;
            onSave({
              id: uid("material"),
              studentId: student.id,
              lessonId: fixedRole==="actor_material"?undefined:lessonId,
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
        {fixedRole!=="actor_material"&&<label className="full">
          Related lesson
          <select required value={lessonId} onChange={(event) => setLessonId(event.target.value)}>
            <option value="" disabled>Select a lesson</option>
            {lessons.map((lesson) => (
              <option key={lesson.id} value={lesson.id}>
                {new Date(lesson.startsAt).toLocaleString()} · {lesson.topic}
              </option>
            ))}
          </select>
          {!lessons.length && <small>Add a lesson before attaching materials.</small>}
        </label>}
        <label>
          Title
          <input
            required
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </label>
        {!fixedRole&&<label>
          Category
          <input
            value={category}
            onChange={(e) => setCategory(e.target.value)}
          />
        </label>}
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
          <button className="primary" disabled={uploading || (!lessonId&&fixedRole!=="actor_material") || (fixedRole==="actor_material"&&!url&&!file)}>
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
  onClose,
  onSave,
}: {
  student: Student;
  lessons: Lesson[];
  onClose: () => void;
  onSave: (n: Note) => void;
}) {
  const [title, setTitle] = useState("Lesson note"),
    [body, setBody] = useState(""),
    [published, setPublished] = useState(false),
    [lessonId, setLessonId] = useState(lessons[0]?.id ?? "");
  const editorRef = useRef<HTMLDivElement>(null);
  const format = (command: string, value?: string) => {
    editorRef.current?.focus();
    document.execCommand(command, false, value);
    setBody(editorRef.current?.innerHTML || "");
  };
  return (
    <Dialog title="New note" description={student.fullName} onClose={onClose}>
      <form
        className="workflow-form"
        onSubmit={(e) => {
          e.preventDefault();
          onSave({
            id: uid("note"),
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
            version: 1,
            updatedAt: now(),
          });
        }}
      >
        <label className="full">
          Related lesson
          <select required value={lessonId} onChange={(event) => setLessonId(event.target.value)}>
            <option value="" disabled>Select a lesson</option>
            {lessons.map((lesson) => (
              <option key={lesson.id} value={lesson.id}>
                {new Date(lesson.startsAt).toLocaleString()} · {lesson.topic}
              </option>
            ))}
          </select>
          {!lessons.length && <small>Add a lesson before writing a lesson note.</small>}
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
            <button type="button" onClick={() => format("insertUnorderedList")} aria-label="Bulleted list">
              • List
            </button>
            <button type="button" onClick={() => format("insertOrderedList")} aria-label="Numbered list">
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
            Save note
          </button>
        </div>
      </form>
    </Dialog>
  );
}
