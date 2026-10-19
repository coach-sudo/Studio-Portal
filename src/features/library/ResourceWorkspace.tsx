import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type {
  ResourceDetail,
  StudyAnchor,
  StudyRecord,
} from "../../domain/library";
import { anchorLabel } from "../../domain/resourceViewer";
import {
  loadStudy,
  removeStudyAnnotation,
  saveStudy,
} from "../../data/materialStudy";
import { WritingArea } from "../../components/WritingArea";
import { useUnsavedWorkspaceChanges } from "../../hooks/useWorkspaceLocation";

const ResourceViewer = lazy(() => import("./ResourceViewer"));

export function ResourceWorkspace({
  resource,
  studentId,
  assignmentId,
  identity,
  allowStudy,
  isDemo,
}: {
  resource: ResourceDetail;
  studentId?: string;
  assignmentId?: string;
  identity: string | null;
  allowStudy: boolean;
  isDemo: boolean;
}) {
  const [reload, setReload] = useState(0);
  const enabled =
    allowStudy &&
    !!identity &&
    !!studentId &&
    !!resource.contentIdentity &&
    !isDemo;
  const study = useQuery({
    queryKey: [
      "material-study",
      identity,
      studentId,
      resource.id,
      resource.contentIdentity,
    ],
    queryFn: ({ signal }) =>
      loadStudy(
        identity!,
        studentId!,
        resource.id,
        resource.contentIdentity!,
        signal,
      ),
    enabled,
    gcTime: 0,
    staleTime: 0,
    retry: false,
  });
  if (enabled && study.isPending)
    return <p role="status">Loading your workspace…</p>;
  return (
    <>
      {enabled && study.isError && (
        <p role="alert">
          Private study tools are unavailable.{" "}
          <button onClick={() => void study.refetch()}>
            Retry study tools
          </button>
        </p>
      )}
      <WorkspaceContent
        key={`${identity}:${studentId}:${resource.id}:${resource.contentIdentity}:${study.isSuccess}:${reload}`}
        resource={resource}
        studentId={studentId}
        assignmentId={assignmentId}
        identity={identity}
        isDemo={isDemo}
        studyEnabled={enabled && study.isSuccess}
        initial={study.data}
        onReload={() => {
          void study.refetch().then(() => setReload((n) => n + 1));
        }}
      />
    </>
  );
}
function WorkspaceContent({
  resource,
  studentId,
  assignmentId,
  identity,
  isDemo,
  studyEnabled,
  initial,
  onReload,
}: {
  resource: ResourceDetail;
  studentId?: string;
  assignmentId?: string;
  identity: string | null;
  isDemo: boolean;
  studyEnabled: boolean;
  initial?: { position: StudyRecord | null; annotations: StudyRecord[] };
  onReload: () => void;
}) {
  const [anchor, setAnchor] = useState<StudyAnchor>(
      initial?.position?.anchor || {},
    ),
    [annotations, setAnnotations] = useState(initial?.annotations || []),
    [body, setBody] = useState(""),
    [editing, setEditing] = useState<StudyRecord>(),
    [status, setStatus] = useState(""),
    [positionStatus, setPositionStatus] = useState(""),
    [accessLost, setAccessLost] = useState(false),
    [busy, setBusy] = useState(false);
  const nextId = useRef({
      note: crypto.randomUUID(),
      bookmark: crypto.randomUUID(),
    }),
    anchorRef = useRef(anchor),
    version = useRef(initial?.position?.version || 0),
    lastSaved = useRef(JSON.stringify(anchor)),
    timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined),
    queue = useRef(Promise.resolve()),
    alive = useRef(true);
  anchorRef.current = anchor;
  const dirty = body !== (editing?.body || "");
  const confirmDiscard = useUnsavedWorkspaceChanges(dirty);
  const move = (next: StudyAnchor) =>
    setAnchor((previous) =>
      JSON.stringify(previous) === JSON.stringify(next) ? previous : next,
    );
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      clearTimeout(timer.current);
    };
  }, []);
  useEffect(() => {
    if (
      accessLost ||
      !studyEnabled ||
      timer.current ||
      JSON.stringify(anchorRef.current) === lastSaved.current
    )
      return;
    timer.current = setTimeout(() => {
      timer.current = undefined;
      const next = anchorRef.current;
      queue.current = queue.current.then(async () => {
        if (!alive.current || JSON.stringify(next) === lastSaved.current)
          return;
        setPositionStatus("Saving position…");
        try {
          const saved = await saveStudy(
            resource.id,
            studentId!,
            resource.contentIdentity!,
            "position",
            null,
            next,
            "",
            version.current,
          );
          if (alive.current) {
            version.current = saved.version;
            lastSaved.current = JSON.stringify(next);
            setPositionStatus("Position saved");
          }
        } catch (error) {
          if (alive.current)
            setPositionStatus(
              error instanceof Error
                ? error.message
                : "Position could not be saved.",
            );
        }
      });
    }, 1200);
  }, [
    anchor,
    studyEnabled,
    resource.id,
    resource.contentIdentity,
    studentId,
    accessLost,
  ]);
  useEffect(() => {
    if (accessLost) clearTimeout(timer.current);
  }, [accessLost]);
  const save = async (kind: "bookmark" | "note") => {
    if (busy || !studyEnabled || accessLost) return;
    if (
      kind === "bookmark" &&
      annotations.some(
        (n) =>
          n.kind === "bookmark" &&
          JSON.stringify(n.anchor) === JSON.stringify(anchor),
      )
    ) {
      setStatus("Already bookmarked");
      return;
    }
    setBusy(true);
    setStatus("Saving…");
    try {
      const id =
        kind === "note" && editing?.id ? editing.id : nextId.current[kind];
      const saved = await saveStudy(
        resource.id,
        studentId!,
        resource.contentIdentity!,
        kind,
        id,
        kind === "note" && editing ? editing.anchor : anchor,
        kind === "note" ? body : anchorLabel(anchor),
        kind === "note" && editing ? editing.version : 0,
      );
      if (!alive.current) return;
      setAnnotations((items) => [
        saved,
        ...items.filter((n) => n.id !== saved.id),
      ]);
      nextId.current[kind] = crypto.randomUUID();
      if (kind === "note") {
        setEditing(undefined);
        setBody("");
      }
      setStatus(kind === "note" ? "Note saved" : "Bookmark saved");
    } catch (error) {
      if (alive.current)
        setStatus(error instanceof Error ? error.message : "Save failed.");
    } finally {
      if (alive.current) setBusy(false);
    }
  };
  const remove = async (note: StudyRecord) => {
    if (!note.id || busy || !window.confirm(`Remove this ${note.kind}?`))
      return;
    setBusy(true);
    try {
      await removeStudyAnnotation(note.id, identity!, note.version);
      if (alive.current) {
        setAnnotations((items) => items.filter((n) => n.id !== note.id));
        setStatus("Removed");
        if (editing?.id === note.id) {
          setEditing(undefined);
          setBody("");
        }
      }
    } catch (error) {
      if (alive.current)
        setStatus(error instanceof Error ? error.message : "Remove failed.");
    } finally {
      if (alive.current) setBusy(false);
    }
  };
  if (accessLost)
    return (
      <div role="alert">
        <p>Resource changed or access was removed. Reopen it to continue.</p>
      </div>
    );
  return (
    <div
      className={`resource-study-layout${studyEnabled ? " with-study" : ""}`}
    >
      <Suspense fallback={<p role="status">Opening viewer…</p>}>
        <ResourceViewer
          resource={resource}
          studentId={studentId}
          assignmentId={assignmentId}
          anchor={anchor}
          onPosition={move}
          isDemo={isDemo}
          onAccessLost={() => setAccessLost(true)}
        />
      </Suspense>
      {studyEnabled && (
        <aside className="private-study" aria-label="My private study tools">
          <h2>My study notes</h2>
          <p className="muted">Only you can see these notes and bookmarks.</p>
          <div className="viewer-toolbar">
            <span>{anchorLabel(anchor)}</span>
            <button
              onClick={() => void save("bookmark")}
              disabled={busy || annotations.length >= 200}
            >
              Bookmark
            </button>
          </div>
          <p role="status">{positionStatus}</p>
          <button
            disabled={busy}
            onClick={() => {
              if (confirmDiscard()) onReload();
            }}
          >
            Reload study tools
          </button>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void save("note");
            }}
          >
            <label>
              {editing ? "Edit private note" : "Private note"}
              <WritingArea
                value={body}
                maxLength={10000}
                onChange={(e) => setBody(e.target.value)}
              />
            </label>
            <div className="form-actions">
              <button
                className="primary"
                disabled={
                  busy ||
                  !body.trim() ||
                  (!editing && annotations.length >= 200)
                }
              >
                Save note
              </button>
              {editing && (
                <button
                  type="button"
                  onClick={() => {
                    if (confirmDiscard()) {
                      setEditing(undefined);
                      setBody("");
                    }
                  }}
                >
                  Cancel edit
                </button>
              )}
            </div>
          </form>
          <p role="status">{status}</p>
          {annotations.length >= 200 && (
            <p>200 saved items. Remove an item before adding another.</p>
          )}
          <details open>
            <summary>
              Bookmarks (
              {annotations.filter((n) => n.kind === "bookmark").length})
            </summary>
            {annotations
              .filter((n) => n.kind === "bookmark")
              .map((n) => (
                <article key={n.id}>
                  <button onClick={() => move(n.anchor)}>
                    {anchorLabel(n.anchor)}
                  </button>
                  <button
                    disabled={busy}
                    onClick={() => void remove(n)}
                    aria-label={`Remove bookmark at ${anchorLabel(n.anchor)}`}
                  >
                    Remove
                  </button>
                </article>
              ))}
          </details>
          <details open>
            <summary>
              Saved notes ({annotations.filter((n) => n.kind === "note").length}
              )
            </summary>
            {annotations
              .filter((n) => n.kind === "note")
              .map((n) => (
                <article key={n.id}>
                  <button onClick={() => move(n.anchor)}>
                    {anchorLabel(n.anchor)}
                  </button>
                  <p className="resource-text">{n.body}</p>
                  <div className="viewer-toolbar">
                    <button
                      disabled={busy}
                      onClick={() => {
                        if (confirmDiscard()) {
                          setEditing(n);
                          setBody(n.body || "");
                        }
                      }}
                    >
                      Edit note
                    </button>
                    <button disabled={busy} onClick={() => void remove(n)}>
                      Remove note
                    </button>
                  </div>
                </article>
              ))}
          </details>
        </aside>
      )}
    </div>
  );
}
