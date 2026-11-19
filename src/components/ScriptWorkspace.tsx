import { useId, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { FileText } from "lucide-react";
import { recordLink } from "../app/recordLinks";
import {
  Drawer,
  EmptyState,
  ListControls,
  Section,
  Status,
} from "./Primitives";
import { coachingContext } from "../domain/coachingContext";
import type { Material, StudioSnapshot } from "../domain/model";
import { formatStudioDate } from "../domain/presentation";
import { safeResourceUrl } from "../domain/resourceViewer";
import { useStudioStore } from "../state/StudioStore";
import { invalidateStudioDomains } from "../hooks/useStudio";
import {
  useUrlNumber,
  useWorkspaceNavigation,
} from "../hooks/useWorkspaceLocation";
import { usePaginatedStudioRows } from "../hooks/usePaginatedStudioRows";
import { mapMaterialLibraryRow } from "../data/studioMappers";
import { studioCommand } from "../data/bookingCommands";
import { uploadStudioFile } from "../data/uploads";
import { studioFileAccept, studioFileType } from "../data/uploadFormats";

export function ScriptWorkspace({
  data,
  studentId,
  isDemo,
}: {
  data: StudioSnapshot;
  studentId: string;
  isDemo: boolean;
}) {
  const workspace = useWorkspaceNavigation();
  const [editing, setEditing] = useState(false);
  const [notice, setNotice] = useState("");
  const [page, setPage] = useUrlNumber("archivePage", 1);
  const [pageSize, setPageSize] = useUrlNumber("archiveSize", 10, 100);
  const [showArchive, setShowArchive] = useState(page > 1);
  const current = coachingContext(data, studentId)?.scripts || [];
  const canUpdate = data.role === "coach" || data.role === "student";
  const history = usePaginatedStudioRows(
    {
      domain: "work",
      table: "material_library_rows",
      page,
      pageSize,
      filters: {
        link_student_id: studentId,
        link_role: "current_script",
        status: "archived",
      },
      sort: { column: "updated_at", ascending: false },
    },
    !isDemo && showArchive,
  );
  const localArchive = data.materials
    .filter(
      (item) =>
        item.studentId === studentId &&
        item.role === "current_script" &&
        item.status === "archived",
    )
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const archived = isDemo
    ? localArchive.slice((page - 1) * pageSize, page * pageSize)
    : (history.data?.items || []).map((row) => ({
        ...mapMaterialLibraryRow(row),
        id: row.link_id || row.id || "",
        resourceId: row.id || undefined,
      }));
  const total = isDemo ? localArchive.length : history.data?.total || 0;
  const openScript = (item: Material) =>
    recordLink(data.role, {
      kind: "resource",
      id: item.resourceId || item.id,
      assignmentId: item.resourceId ? item.id : undefined,
      studentId,
    });
  return (
    <>
      {notice && (
        <p className="portal-notice" role="status">
          {notice}
        </p>
      )}
      <Section
        title="Current script"
        marked
        aside={
          canUpdate && (
            <button
              type="button"
              className="primary"
              onClick={() => setEditing(true)}
            >
              {current.length ? "Update script" : "Add script"}
            </button>
          )
        }
      >
        {current.length ? (
          <div className="table-list">
            {current.map((item) => (
              <article key={item.id}>
                <FileText aria-hidden="true" />
                <div>
                  <strong>{item.title}</strong>
                  <small>
                    Updated{" "}
                    {formatStudioDate(item.updatedAt, data.settings.timezone)}
                  </small>
                </div>
                <Status tone="good">Current</Status>
                <Link
                  className="button-link"
                  to={openScript(item)}
                  state={workspace.returnState()}
                >
                  Open script
                </Link>
              </article>
            ))}
          </div>
        ) : (
          <EmptyState
            title="No current script"
            detail={
              canUpdate
                ? "Upload a script or share a link to it."
                : "The current script will appear here."
            }
          />
        )}
      </Section>
      <details
        className="coaching-history"
        open={showArchive}
        onToggle={(event) => setShowArchive(event.currentTarget.open)}
      >
        <summary>Script history</summary>
        <Section title="Previous versions">
          {total > pageSize && (
            <ListControls
              page={page}
              pageCount={Math.max(1, Math.ceil(total / pageSize))}
              pageSize={pageSize}
              total={total}
              onPage={setPage}
              onPageSize={setPageSize}
              label="archived scripts"
            />
          )}
          <div className="table-list">
            {archived.map((item) => (
              <article key={item.id}>
                <FileText aria-hidden="true" />
                <div>
                  <strong>{item.title}</strong>
                  <small>
                    Archived{" "}
                    {formatStudioDate(item.updatedAt, data.settings.timezone)}
                  </small>
                </div>
                <Link to={openScript(item)} state={workspace.returnState()}>
                  Open version
                </Link>
              </article>
            ))}
          </div>
          {history.isError && !isDemo ? (
            <p role="alert">
              Script history is unavailable.{" "}
              <button onClick={() => void history.refetch()}>Retry</button>
            </p>
          ) : !isDemo && history.isPending ? (
            <p role="status">Loading script history…</p>
          ) : (
            !archived.length && (
              <EmptyState
                title="No previous scripts"
                detail="Replacing the current script saves it here."
              />
            )
          )}
        </Section>
      </details>
      {editing && (
        <ScriptEditor
          data={data}
          studentId={studentId}
          isDemo={isDemo}
          current={current[0]}
          onClose={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            setNotice(
              current.length
                ? "Script updated. The previous version is in Script history."
                : "Current script added.",
            );
          }}
        />
      )}
    </>
  );
}

function ScriptEditor({
  data,
  studentId,
  isDemo,
  current,
  onClose,
  onSaved,
}: {
  data: StudioSnapshot;
  studentId: string;
  isDemo: boolean;
  current?: Material;
  onClose: () => void;
  onSaved: () => void;
}) {
  const store = useStudioStore();
  const queryClient = useQueryClient();
  const formId = useId();
  const [requestId] = useState(() => crypto.randomUUID());
  const [type, setType] = useState("file");
  const [title, setTitle] = useState(current?.title || "");
  const [file, setFile] = useState<File>();
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [params] = useSearchParams();
  const lessonId = params.get("fromLesson") || undefined;
  return (
    <Drawer
      title={current ? "Update script" : "Add script"}
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <form
        className="workflow-form"
        onSubmit={async (event) => {
          event.preventDefault();
          if (busy || !title.trim()) return;
          setError("");
          setBusy(true);
          try {
            const externalUrl =
              type === "link" ? safeResourceUrl(url) : undefined;
            if (type === "link" && !externalUrl)
              throw new Error("Enter a valid HTTP or HTTPS link.");
            const selectedFile = type === "file" ? file : undefined;
            if (type === "file" && !selectedFile)
              throw new Error("Choose a script file.");
            const mimeType = selectedFile
              ? studioFileType(selectedFile)
              : undefined;
            if (isDemo) {
              store.transact((draft) => {
                const updatedAt = new Date().toISOString();
                draft.materials
                  .filter(
                    (item) =>
                      item.studentId === studentId &&
                      item.role === "current_script" &&
                      item.status === "active",
                  )
                  .forEach((item) => {
                    item.status = "archived";
                    item.updatedAt = updatedAt;
                  });
                draft.materials.push({
                  id: requestId,
                  studentId,
                  lessonId,
                  title: title.trim(),
                  category: "Script",
                  role: "current_script",
                  status: "active",
                  approvalStatus: "not_public",
                  externalUrl: externalUrl || undefined,
                  mimeType,
                  version: 1,
                  updatedAt,
                });
              });
            } else {
              const asset =
                selectedFile &&
                (await uploadStudioFile({
                  studioId: data.studioId,
                  studentId,
                  entityType: "material",
                  file: selectedFile,
                  visibility: "student",
                }));
              await studioCommand("materials", {
                command: "create",
                expectedVersion: 0,
                payload: {
                  requestId,
                  studentId,
                  lessonId,
                  title: title.trim(),
                  category: "Script",
                  role: "current_script",
                  externalUrl: externalUrl || undefined,
                  storagePath: asset ? asset.storagePath : undefined,
                },
                reason: "Save current script version",
              });
              await invalidateStudioDomains(queryClient, ["work"]);
            }
            onSaved();
          } catch (reason) {
            setError(
              reason instanceof Error
                ? reason.message
                : "The script could not be saved.",
            );
          } finally {
            setBusy(false);
          }
        }}
      >
        {current && (
          <p className="full">
            The current script will move to Script history when the new version
            is saved.
          </p>
        )}
        <label className="full" htmlFor={formId + "-source"}>
          Source
          <select
            id={formId + "-source"}
            value={type}
            disabled={busy}
            onChange={(event) => {
              setType(event.target.value);
              setFile(undefined);
            }}
          >
            <option value="file">Upload file</option>
            <option value="link">Share link</option>
          </select>
        </label>
        {type === "file" ? (
          <label key="script-file" className="full" htmlFor={formId + "-file"}>
            Script file
            <input
              id={formId + "-file"}
              type="file"
              required
              accept={studioFileAccept}
              disabled={busy}
              onChange={(event) => {
                const selected = event.target.files?.[0];
                setFile(selected);
                if (selected && !title.trim())
                  setTitle(selected.name.replace(/\.[^.]+$/, "").slice(0, 200));
              }}
            />
            <small>
              PDF, Word, Final Draft, Fountain, and other supported files up to
              50 MB.
            </small>
          </label>
        ) : (
          <label key="script-link" className="full" htmlFor={formId + "-link"}>
            Script link
            <input
              id={formId + "-link"}
              type="url"
              required
              value={url}
              disabled={busy}
              onChange={(event) => setUrl(event.target.value)}
            />
          </label>
        )}
        <label className="full" htmlFor={formId + "-title"}>
          Title
          <input
            id={formId + "-title"}
            required
            maxLength={200}
            value={title}
            disabled={busy}
            onChange={(event) => setTitle(event.target.value)}
          />
        </label>
        {error && (
          <p className="full" role="alert">
            {error}
          </p>
        )}
        <div className="form-actions full">
          <button type="button" disabled={busy} onClick={onClose}>
            Cancel
          </button>
          <button className="primary" disabled={busy}>
            {busy ? "Saving…" : "Save current script"}
          </button>
        </div>
      </form>
    </Drawer>
  );
}
