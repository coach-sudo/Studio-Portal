import DOMPurify from "dompurify";
import { CalendarDays, Plus, Search, Trash2 } from "lucide-react";
import { useState } from "react";
import {
  Dialog,
  EmptyState,
  ListControls,
  Section,
  Status,
  usePagedList,
} from "../../components/Primitives";
import type { Note, Student } from "../../domain/model";
import {
  formatStudioDate,
  formatStudioDateTime,
} from "../../domain/presentation";

import { type Data } from "./StudentWorkspace.shared";

export function Notes({
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
    notes.reduce<
      Record<string, { lessonId: string; notes: Note[]; updatedAt: string }>
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
          <button
            type="button"
            key={group.lessonId}
            onClick={() => setSelectedLessonId(group.lessonId)}
          >
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
                · {group.notes.length}{" "}
                {group.notes.length === 1 ? "note" : "notes"}
              </small>
            </span>
            <Status
              tone={
                group.notes.every((note) => note.status === "published")
                  ? "good"
                  : "neutral"
              }
            >
              {group.notes.some((note) => note.status === "draft")
                ? "has draft"
                : "published"}
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
          title={
            data.lessons.find((item) => item.id === selected.lessonId)?.topic ||
            "Coaching notes"
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
          onClose={() => setSelectedLessonId("")}
        >
          <div className="lesson-note-stack">
            {selected.notes.map((note) => (
              <article key={note.id}>
                <header>
                  <strong>{note.title}</strong>
                  <Status
                    tone={note.status === "published" ? "good" : "neutral"}
                  >
                    {note.status}
                  </Status>
                </header>
                {note.bodyHtml ? (
                  <div
                    className="rich-note-body"
                    dangerouslySetInnerHTML={{
                      __html: DOMPurify.sanitize(note.bodyHtml),
                    }}
                  />
                ) : (
                  <p>{note.body}</p>
                )}
                <div className="row-actions">
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedLessonId("");
                      onEdit(note);
                    }}
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    className="danger-button"
                    onClick={() => {
                      onDelete(note);
                      setSelectedLessonId("");
                    }}
                  >
                    <Trash2 />
                    Delete
                  </button>
                </div>
              </article>
            ))}
          </div>
          <div className="form-actions">
            <button type="button" onClick={() => setSelectedLessonId("")}>
              Close
            </button>
          </div>
        </Dialog>
      )}
    </Section>
  );
}
