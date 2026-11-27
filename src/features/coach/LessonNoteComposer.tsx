import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Dialog } from "../../components/Primitives";
import { RichWritingArea } from "../../components/RichWritingArea";
import { cleanWritingHtml } from "../../lib/writingHtml";
import { ApiClientError } from "../../data/apiClientError";
import { recordLink } from "../../app/recordLinks";
import type { Lesson, Note, Student } from "../../domain/model";
import { useUnsavedWorkspaceChanges } from "../../hooks/useWorkspaceLocation";
import { formatStudioDateTime } from "../../domain/presentation";
import { useLessonNoteRecovery } from "./useLessonNoteRecovery";
import "./LessonNoteComposer.css";

export function LessonNoteComposer({
  student,
  lessons,
  timezone,
  note,
  currentScript,
  latestFeedback,
  attachments,
  initialLessonId,
  privateRecovery = false,
  onClose,
  onSave,
  onAttach,
}: {
  student: Student;
  lessons: Lesson[];
  timezone: string;
  note?: Note;
  currentScript?: string;
  latestFeedback?: string;
  attachments: Array<{ id: string; title: string }>;
  initialLessonId?: string;
  privateRecovery?: boolean;
  onClose: () => void;
  onSave: (note: Note, creating: boolean, actorId?: string) => Promise<Note>;
  onAttach: (note: Note) => void;
}) {
  const fieldId = useId();
  const [saved, setSaved] = useState(note);
  const [newId, setNewId] = useState<string>(() => crypto.randomUUID());
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
  const [editorInitial, setEditorInitial] = useState(body);
  const [editorReset, setEditorReset] = useState(0);
  const [openedRecoveryScope, setOpenedRecoveryScope] = useState("");
  const [restored, setRestored] = useState(false);
  const [discarding, setDiscarding] = useState(false);
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
  const recoveryScope = JSON.stringify([
    student.id,
    saved?.id ?? null,
    saved ? null : (initialLessonId ?? null),
  ]);
  const hydrated = recoveryScope === openedRecoveryScope;
  const recoveryContent = useMemo(
    () => ({
      workingNoteId: saved?.id ?? newId,
      baseVersion: saved?.version ?? 0,
      lessonId: lessonId || null,
      title,
      body: body.text,
      bodyHtml: body.html,
    }),
    [body.html, body.text, lessonId, newId, saved?.id, saved?.version, title],
  );
  const recovery = useLessonNoteRecovery({
    enabled: privateRecovery,
    studentId: student.id,
    noteId: saved?.id ?? null,
    openingLessonId: saved ? null : (initialLessonId ?? null),
    content: recoveryContent,
    hydrated,
    dirty,
    paused: busy || !!retry || discarding,
  });
  const { current: recoverySession, restored: persistedRecovery } = recovery;
  const canDiscard = useUnsavedWorkspaceChanges(
    (dirty && !recovery.matchesReceipt) || busy || !!retry || discarding,
  );
  const valid =
    (!!lesson || !!saved?.lessonId) && !!title.trim() && !!body.text.trim();
  const published = saved?.status === "published";
  const locked =
    busy || !!retry || discarding || (privateRecovery && !hydrated);
  const allowWriting = !locked && !review;
  const writeConflict = conflict || recovery.conflict || recovery.hasStaleBase;

  useEffect(() => {
    if (!privateRecovery || !recoverySession || hydrated) return;
    if (persistedRecovery) {
      const restoredBody = {
        text: persistedRecovery.body,
        html: cleanWritingHtml(persistedRecovery.bodyHtml, true),
      };
      setNewId(persistedRecovery.workingNoteId);
      setTitle(persistedRecovery.title);
      setLessonId(persistedRecovery.lessonId ?? "");
      setBody(restoredBody);
      setEditorInitial(restoredBody);
      setEditorReset((value) => value + 1);
      setRestored(true);
    }
    setOpenedRecoveryScope(recoveryScope);
  }, [
    hydrated,
    persistedRecovery,
    privateRecovery,
    recoverySession,
    recoveryScope,
  ]);

  useEffect(() => {
    const viewport = window.visualViewport;
    const form = workspace.current;
    const dialog = form?.closest<HTMLElement>(".lesson-note-composer");
    const canvas = form?.querySelector<HTMLElement>(".lesson-note-main");
    if (!viewport || !dialog || !canvas) return;

    const mobile = window.matchMedia(
      "(max-width: 680px), (pointer: coarse) and (max-width: 1024px)",
    );
    let fullHeight = Math.max(window.innerHeight, viewport.height);
    let frame = 0;
    const update = () => {
      const active = document.activeElement;
      const editing =
        active instanceof HTMLElement &&
        canvas.contains(active) &&
        (active.isContentEditable || active.matches("input, textarea"));
      const alreadyOpen = dialog.dataset.keyboard === "true";
      if (!editing && !alreadyOpen) fullHeight = viewport.height;
      if (viewport.height > fullHeight) fullHeight = viewport.height;
      const keyboard =
        mobile.matches &&
        Math.abs(viewport.scale - 1) < 0.02 &&
        (editing || alreadyOpen) &&
        Math.max(window.innerHeight, fullHeight) - viewport.height > 120;

      dialog.style.setProperty(
        "--writing-viewport-height",
        `${viewport.height}px`,
      );
      dialog.style.setProperty(
        "--writing-viewport-top",
        `${viewport.offsetTop}px`,
      );
      dialog.dataset.keyboard = String(keyboard);
      dialog.dataset.writingBody = String(
        keyboard && !active?.matches(".lesson-note-title input"),
      );

      if (
        !keyboard ||
        !(active instanceof HTMLElement) ||
        !active.isContentEditable
      )
        return;
      const selection = document.getSelection();
      if (!selection?.focusNode || !active.contains(selection.focusNode))
        return;
      const caret = document.createRange();
      caret.setStart(selection.focusNode, selection.focusOffset);
      caret.collapse(true);
      const position = caret.getBoundingClientRect();
      if (!position.height) return;
      const bounds = canvas.getBoundingClientRect();
      const toolbar = canvas
        .querySelector(".rich-toolbar")
        ?.getBoundingClientRect();
      const top = Math.max(bounds.top, toolbar?.bottom ?? bounds.top) + 8;
      if (position.bottom > bounds.bottom - 12)
        canvas.scrollTop += position.bottom - bounds.bottom + 12;
      else if (position.top < top) canvas.scrollTop -= top - position.top;
    };
    const schedule = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(update);
    };
    const rotate = () => {
      fullHeight = window.innerHeight;
      schedule();
    };
    update();
    viewport.addEventListener("resize", schedule);
    viewport.addEventListener("scroll", schedule);
    window.addEventListener("resize", schedule);
    window.screen.orientation?.addEventListener("change", rotate);
    dialog.addEventListener("focusin", schedule);
    dialog.addEventListener("focusout", schedule);
    document.addEventListener("selectionchange", schedule);
    return () => {
      window.cancelAnimationFrame(frame);
      viewport.removeEventListener("resize", schedule);
      viewport.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      window.screen.orientation?.removeEventListener("change", rotate);
      dialog.removeEventListener("focusin", schedule);
      dialog.removeEventListener("focusout", schedule);
      document.removeEventListener("selectionchange", schedule);
    };
  }, []);

  const persist = async (status: Note["status"]) => {
    if (
      inFlight.current ||
      (!retry && (!valid || (status === "published" && !lesson))) ||
      writeConflict ||
      (privateRecovery && !hydrated)
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
    let sentNoteAction = false;
    try {
      if (privateRecovery && dirty && !retry)
        await recovery.sync(recoveryContent);
      sentNoteAction = true;
      const result = await onSave(
        attempt.note,
        attempt.creating,
        recoverySession?.gateway.actorId,
      );
      try {
        await recovery.discard();
      } catch {
        setError(
          "The note was saved. The server did not confirm removing its recovery copy.",
        );
      }
      setSaved(result);
      setTitle(result.title);
      setSavedBody(body);
      setRestored(false);
      setRetry(null);
      setReview(false);
    } catch (reason) {
      if (!sentNoteAction) return;
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
    if (inFlight.current || discarding) return;
    if (review) {
      setReview(false);
      return;
    }
    if (canDiscard()) onClose();
  };
  const discardRecovery = async () => {
    if (
      inFlight.current ||
      discarding ||
      !window.confirm(
        "Discard these private edits and return to the last saved note?",
      )
    )
      return;
    setDiscarding(true);
    try {
      await recovery.discard();
      setRestored(false);
      setReview(false);
      setTitle(saved?.title || "Lesson note");
      setLessonId(saved?.lessonId || initialLessonId || lessons[0]?.id || "");
      setBody(savedBody);
      setEditorInitial(savedBody);
      setEditorReset((value) => value + 1);
      setError("");
    } catch {
      // The recovery service reports whether the discard was acknowledged.
    } finally {
      setDiscarding(false);
    }
  };

  return (
    <Dialog
      title={expanded ? "Expanded editor" : saved ? "Edit note" : "New note"}
      className="lesson-note-composer"
      description={expanded ? student.fullName : undefined}
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
          {(currentScript || latestFeedback) && (
            <dl className="lesson-note-continuity">
              {currentScript && (
                <div>
                  <dt>Current material</dt>
                  <dd>{currentScript}</dd>
                </div>
              )}
              {latestFeedback && (
                <div>
                  <dt>Latest published feedback</dt>
                  <dd>{latestFeedback}</dd>
                </div>
              )}
            </dl>
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
              key={editorReset}
              label="Note"
              professional
              preserveInlineStyles
              initialHtml={editorInitial.html}
              initialText={editorInitial.text}
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
                : recovery.loading
                  ? "Checking private recovery…"
                  : recovery.writing
                    ? "Saving recovery copy…"
                    : dirty && recovery.matchesReceipt
                      ? restored
                        ? "Private draft recovered"
                        : "Private recovery copy saved"
                      : dirty
                        ? "Unsaved changes"
                        : saved
                          ? published
                            ? "Published to student"
                            : "Private draft saved"
                          : "New private draft"}
            </span>
            {error && <p role="alert">{error}</p>}
            {recovery.readError && (
              <p role="alert">
                {recovery.readError}{" "}
                <button type="button" onClick={recovery.retryRead}>
                  Retry
                </button>
              </p>
            )}
            {recovery.writeError && !error && (
              <p role="alert">{recovery.writeError}</p>
            )}
            {recovery.hasStaleBase && (
              <p role="alert">
                A newer note version exists. Your private edits are available
                here for comparison.
              </p>
            )}
            {writeConflict && saved && (
              <a
                href={recordLink("coach", {
                  kind: "note",
                  id: saved.id,
                  studentId: student.id,
                })}
                target="_blank"
                rel="noopener noreferrer"
              >
                Open latest note
              </a>
            )}
            {privateRecovery &&
              recovery.writeError &&
              !writeConflict &&
              !retry && (
                <button
                  type="button"
                  disabled={locked}
                  onClick={() =>
                    void recovery.sync(recoveryContent).catch(() => undefined)
                  }
                >
                  Retry recovery save
                </button>
              )}
            {recovery.hasReceipt && dirty && (
              <button
                type="button"
                disabled={locked}
                onClick={() => void discardRecovery()}
              >
                Discard private edits
              </button>
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
                  disabled={locked || writeConflict || !valid || !lesson}
                  onClick={() => void persist("published")}
                >
                  {published ? "Publish changes" : "Publish note"}
                </button>
              </>
            ) : (
              <>
                {(!published || privateRecovery) && (
                  <button
                    type="button"
                    className="lesson-note-private-save"
                    disabled={
                      locked ||
                      writeConflict ||
                      (!published && !valid) ||
                      (!dirty && !!saved)
                    }
                    onClick={() => {
                      if (published)
                        void recovery
                          .sync(recoveryContent)
                          .catch(() => undefined);
                      else void persist("draft");
                    }}
                  >
                    Save draft
                  </button>
                )}
                <button
                  type="button"
                  className="primary lesson-note-review-action"
                  disabled={!valid || !lesson || locked || writeConflict}
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
