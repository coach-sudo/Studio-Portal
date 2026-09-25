import { useQueryClient } from "@tanstack/react-query";
import { CheckSquare, FolderOpen, Trash2 } from "lucide-react";
import { useState } from "react";
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
import { uploadStudioFile } from "../../data/uploads";
import {
  lessonDateLabel,
  sortAssignments,
} from "../../domain/lessonExperience";
import {
  formatStudioDate,
  formatStudioDateTime,
} from "../../domain/presentation";
import { invalidateStudioDomains } from "../../hooks/useStudio";
import { useStudioStore } from "../../state/StudioStore";

import { type Snapshot } from "./StudentPortal.shared";

export function Practice({
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
        void invalidateStudioDomains(queryClient, ["work"]);
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
          const item = draft.assignments.find(
            (row) => row.id === assignment.id,
          )!;
          item.responses = responses;
          item.status =
            item.status === "assigned" ? "in_progress" : item.status;
          item.progress = Math.max(item.progress || 0, 25);
          item.version += 1;
          item.updatedAt = new Date().toISOString();
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
          reason: "Student saved assignment progress",
        });
        await invalidateStudioDomains(queryClient, ["work"]);
      }
      setNotice("Progress saved.");
    } catch (reason) {
      setNotice(
        reason instanceof Error
          ? reason.message
          : "Progress could not be saved.",
      );
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
      {notice && (
        <p className="portal-notice" role="status">
          {notice}
        </p>
      )}
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
                    {item.dueAt
                      ? `Due ${formatStudioDateTime(item.dueAt, data.settings.timezone)}`
                      : "No due date"}
                    {item.lessonId &&
                      ` · ${data.lessons.find((lesson) => lesson.id === item.lessonId)?.topic || "Lesson"}`}
                  </small>
                </div>
                <Status tone="neutral">
                  {(item.activityType || "instruction").replaceAll("_", " ")}
                </Status>
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
              {showCompleted ? "Hide" : "Show"} completed work (
              {assignments.completed.length})
            </button>
            {showCompleted && (
              <div className="table-list">
                {assignments.completed.map((item) => (
                  <article key={item.id}>
                    <CheckSquare />
                    <div>
                      <strong>{item.title}</strong>
                      <small>
                        Completed{" "}
                        {formatStudioDate(
                          item.updatedAt,
                          data.settings.timezone,
                        )}
                      </small>
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
export function Materials({
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
      void invalidateStudioDomains(queryClient, ["work"]);
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
      await invalidateStudioDomains(queryClient, ["work"]);
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
      await invalidateStudioDomains(queryClient, ["work"]);
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
              <option value="" disabled>
                Select a lesson
              </option>
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
            disabled={
              (!url && !file) || (role === "lesson_material" && !lessonId)
            }
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
