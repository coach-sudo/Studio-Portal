import { useEffect, useId, useRef, useState } from "react";
import { Dialog } from "../../components/Primitives";
import { RichWritingArea } from "../../components/RichWritingArea";
import { cleanWritingHtml } from "../../lib/writingHtml";
import { ApiClientError } from "../../data/apiClientError";
import { recordLink } from "../../app/recordLinks";
import type { Lesson, Note, Student } from "../../domain/model";
import { useUnsavedWorkspaceChanges } from "../../hooks/useWorkspaceLocation";
import { formatStudioDateTime } from "../../domain/presentation";
import "./LessonNoteComposer.css";

export function LessonNoteComposer({
  student,
  lessons,
  timezone,
  note,
  attachments,
  initialLessonId,
  onClose,
  onSave,
  onAttach,
}: {
  student: Student;
  lessons: Lesson[];
  timezone: string;
  note?: Note;
  attachments: Array<{ id: string; title: string }>;
  initialLessonId?: string;
  onClose: () => void;
  onSave: (note: Note, creating: boolean) => Promise<Note>;
  onAttach: (note: Note) => void;
}) {
  const fieldId = useId();
  const [saved, setSaved] = useState(note);
  const [newId] = useState(() => crypto.randomUUID());
  const [title, setTitle] = useState(note?.title || "Lesson note");
  const [lessonId, setLessonId] = useState(
    note?.lessonId || initialLessonId || lessons[0]?.id || "",
  );
  const [body, setBody] = useState({
    html: note?.bodyHtml ? cleanWritingHtml(note.bodyHtml, true) : "",
    text: note?.body || "",
  });
  const lesson = lessons.find((item) => item.id === lessonId);
  const [savedBody, setSavedBody] = useState(body);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState(false);
  const [review, setReview] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [retry, setRetry] = useState<{ note: Note; creating: boolean } | null>(
    null,
  );
  const inFlight = useRef(false);
  const workspace = useRef<HTMLFormElement>(null);
  const dirty =
    title !== (saved?.title || "Lesson note") ||
    lessonId !== (saved?.lessonId || initialLessonId || lessons[0]?.id || "") ||
    body.html !== savedBody.html ||
    body.text !== savedBody.text;
  const canDiscard = useUnsavedWorkspaceChanges(dirty || busy || !!retry);
  const valid =
    (!!lesson || !!saved?.lessonId) && !!title.trim() && !!body.text.trim();
  const published = saved?.status === "published";
  const locked = busy || !!retry;
  const allowWriting = !locked && !review;

  useEffect(() => {
    const viewport = window.visualViewport;
    const dialog = workspace.current?.closest<HTMLElement>(
      ".lesson-note-composer",
    );
    if (!viewport || !dialog) return;
    const resize = () => {
      dialog.style.setProperty(
        "--writing-viewport-height",
        `${viewport.height}px`,
      );
      dialog.style.setProperty(
        "--writing-viewport-top",
        `${viewport.offsetTop}px`,
      );
    };
    resize();
    viewport.addEventListener("resize", resize);
    viewport.addEventListener("scroll", resize);
    return () => {
      viewport.removeEventListener("resize", resize);
      viewport.removeEventListener("scroll", resize);
    };
  }, []);

  const persist = async (status: Note["status"]) => {
    if (
      inFlight.current ||
      (!retry && (!valid || (status === "published" && !lesson))) ||
      conflict
    )
      return;
    const attempt = retry ?? {
      creating: !saved,
      note: {
        ...saved,
        id: saved?.id || newId,
        studentId: student.id,
        lessonId,
        title: title.trim(),
        body: body.text.trim(),
        bodyHtml: body.html || undefined,
        status,
        version: saved?.version || 1,
        updatedAt: new Date().toISOString(),
      },
    };
    inFlight.current = true;
    setBusy(true);
    setError("");
    try {
      const result = await onSave(attempt.note, attempt.creating);
      setSaved(result);
      setTitle(result.title);
      setSavedBody(body);
      setRetry(null);
      setReview(false);
    } catch (reason) {
      const versionConflict =
        reason instanceof ApiClientError && reason.code === "VERSION_CONFLICT";
      const uncertain =
        !(reason instanceof ApiClientError) ||
        reason.retryable ||
        reason.status >= 500;
      setConflict(versionConflict);
      setRetry(!versionConflict && uncertain ? attempt : null);
      setError(
        versionConflict
          ? "A newer version exists. Your writing is still here. Open the latest version in another tab to reconcile your changes."
          : uncertain
            ? "The server did not confirm the change. Retry to recover the same request."
            : reason.message,
      );
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };
  const close = () => {
    if (inFlight.current) return;
    if (review) {
      setReview(false);
      return;
    }
    if (canDiscard()) onClose();
  };

  return (
    <Dialog
      title={expanded ? "Expanded editor" : saved ? "Edit note" : "New note"}
      className="lesson-note-composer"
      description={student.fullName}
      onClose={close}
    >
      <form
        ref={workspace}
        className="lesson-note-workspace"
        onSubmit={(event) => event.preventDefault()}
      >
        <aside className="lesson-note-context" hidden={expanded}>
          <h3>Lesson context</h3>
          <p>{student.fullName}</p>
          {saved && lesson ? (
            <p className="lesson-note-topic">{lesson.topic}</p>
          ) : (
            <label htmlFor={fieldId + "-lesson"}>
              Related lesson
              <select
                id={fieldId + "-lesson"}
                value={lessonId}
                disabled={!!saved || !allowWriting}
                onChange={(event) => setLessonId(event.target.value)}
              >
                <option value="">Select a lesson</option>
                {lessons.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.topic} ·{" "}
                    {formatStudioDateTime(item.startsAt, timezone)}
                  </option>
                ))}
              </select>
            </label>
          )}
          {lesson && (
            <p className="lesson-note-datetime">
              {formatStudioDateTime(lesson.startsAt, timezone)}
            </p>
          )}
          {saved && !lesson && (
            <p>
              Lesson details are unavailable. Reopen from the lesson before
              publishing.
            </p>
          )}
        </aside>
        <div className="lesson-note-main">
          <div hidden={review} className="lesson-note-writing">
            <label className="lesson-note-title" htmlFor={fieldId + "-title"}>
              Title
              <input
                id={fieldId + "-title"}
                value={title}
                required
                readOnly={!allowWriting}
                onChange={(event) => setTitle(event.target.value)}
              />
            </label>
            <RichWritingArea
              label="Note"
              preserveInlineStyles
              initialHtml={note?.bodyHtml}
              initialText={note?.body}
              disabled={!allowWriting}
              onChange={setBody}
              actions={
                <>
                  {!dirty && saved && (
                    <button
                      type="button"
                      disabled={locked}
                      onClick={() => onAttach(saved)}
                    >
                      Attach resource
                    </button>
                  )}
                  <button
                    type="button"
                    aria-pressed={expanded}
                    onClick={() => setExpanded(!expanded)}
                  >
                    {expanded ? "Show lesson context" : "Expand"}
                  </button>
                </>
              }
            />
          </div>
          {review && (
            <section
              className="lesson-note-review"
              aria-labelledby="lesson-note-review-title"
            >
              <h3 id="lesson-note-review-title">Review publication</h3>
              <p>
                The note will be visible to {student.fullName} and authorized
                household members for {lesson?.topic}.
              </p>
              <h4>{title}</h4>
              {body.html ? (
                <div
                  className="rich-editor-body"
                  dangerouslySetInnerHTML={{ __html: body.html }}
                />
              ) : (
                <p className="lesson-note-plain">{body.text}</p>
              )}
              {attachments.length > 0 && (
                <>
                  <h4>Attached resources</h4>
                  <ul>
                    {attachments.map(({ id, title }) => (
                      <li key={id}>{title}</li>
                    ))}
                  </ul>
                </>
              )}
            </section>
          )}
        </div>
        <footer className="lesson-note-footer">
          <div>
            <span role="status">
              {busy
                ? "Saving…"
                : dirty
                  ? "Unsaved changes"
                  : saved
                    ? published
                      ? "Published to student"
                      : "Private draft saved"
                    : "New private draft"}
            </span>
            {error && <p role="alert">{error}</p>}
            {conflict && (
              <a
                href={recordLink("coach", {
                  kind: "note",
                  id: saved?.id || newId,
                  studentId: student.id,
                })}
                target="_blank"
                rel="noopener noreferrer"
              >
                Open latest note
              </a>
            )}
          </div>
          <div className="form-actions">
            {retry ? (
              <button
                type="button"
                className="primary"
                disabled={busy}
                onClick={() => void persist(retry.note.status)}
              >
                Retry{" "}
                {retry.note.status === "published" ? "publication" : "save"}
              </button>
            ) : review ? (
              <>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setReview(false)}
                >
                  Back to writing
                </button>
                <button
                  type="button"
                  className="primary"
                  disabled={busy || conflict || !valid || !lesson}
                  onClick={() => void persist("published")}
                >
                  {published ? "Publish changes" : "Publish note"}
                </button>
              </>
            ) : (
              <>
                {!published && (
                  <button
                    type="button"
                    disabled={!valid || busy || conflict || (!dirty && !!saved)}
                    onClick={() => void persist("draft")}
                  >
                    Save draft
                  </button>
                )}
                <button
                  type="button"
                  className="primary"
                  disabled={!valid || !lesson || busy || conflict}
                  onClick={() => setReview(true)}
                >
                  Review publication
                </button>
              </>
            )}
          </div>
        </footer>
      </form>
    </Dialog>
  );
}
