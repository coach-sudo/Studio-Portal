import { useEffect, useId, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  attachAssignmentFile,
  downloadAssignmentFile,
  loadAssignmentAttachments,
  removeAssignmentFile,
  uploadAssignmentAttachment,
  type AssignmentAttachment,
} from "../data/assignmentAttachments";
import {
  studioDownloadName,
  studioFileAccept,
  studioFileType,
} from "../data/uploadFormats";
import { usePrivateIdentity } from "../hooks/usePrivateIdentity";

export type AssignmentFileScope = {
  assignmentId: string;
  studentId: string;
  studioId: string;
};

type Props = {
  scope: AssignmentFileScope;
  canEdit?: boolean;
  disabled?: boolean;
  onPendingChange?: (pending: boolean) => void;
};

export function AssignmentAttachments(props: Props) {
  const identity = usePrivateIdentity();
  if (!identity) return null;
  return (
    <Files
      key={`${identity}:${props.scope.assignmentId}`}
      {...props}
      identity={identity}
    />
  );
}

function Files({
  scope,
  identity,
  canEdit,
  disabled,
  onPendingChange,
}: Props & { identity: string }) {
  const field = useId();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File>();
  const [hash, setHash] = useState<string>();
  const [progress, setProgress] = useState<number>();
  const [action, setAction] = useState<
    "upload" | "attach" | "remove" | "download"
  >();
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const active = useRef<AbortController | null>(null);
  const queryKey = ["assignment-attachments", identity, scope.assignmentId];
  const attached = useQuery({
    queryKey,
    queryFn: ({ signal }) =>
      loadAssignmentAttachments(scope.assignmentId, signal),
    enabled: open,
  });

  useEffect(
    () => () => {
      active.current?.abort();
      onPendingChange?.(false);
    },
    [onPendingChange],
  );

  const clearFile = () => {
    setFile(undefined);
    setHash(undefined);
    setProgress(undefined);
    setError("");
    onPendingChange?.(false);
  };

  const choose = (next?: File) => {
    clearFile();
    setStatus("");
    if (!next) return;
    try {
      studioFileType(next);
      setFile(next);
      onPendingChange?.(true);
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Choose a supported file.",
      );
    }
  };

  const attach = async () => {
    if (!canEdit || !file || active.current || disabled) return;
    const controller = new AbortController();
    active.current = controller;
    setError("");
    setStatus("");
    let transferredHash = hash;
    try {
      if (!transferredHash) {
        setAction("upload");
        transferredHash = await uploadAssignmentAttachment(
          { ...scope, identity },
          file,
          {
            signal: controller.signal,
            onProgress: (loaded, total) =>
              setProgress(Math.round((loaded / total) * 100)),
          },
        );
        setHash(transferredHash);
      }
      controller.signal.throwIfAborted();
      setAction("attach");
      await attachAssignmentFile(
        scope.assignmentId,
        transferredHash,
        file.name,
        identity,
      );
      await queryClient.invalidateQueries({ queryKey });
      clearFile();
      setStatus("File attached.");
    } catch (reason) {
      if (!controller.signal.aborted) {
        setError(
          transferredHash
            ? `${reason instanceof Error ? reason.message : "The attachment could not be confirmed."} The upload was retained for retry.`
            : "The upload could not be confirmed. Your file is still selected.",
        );
      } else {
        setStatus("Upload canceled. Your file is still selected.");
      }
    } finally {
      active.current = null;
      setAction(undefined);
      setProgress(undefined);
    }
  };

  const manage = async (attachment: AssignmentAttachment, remove: boolean) => {
    if (active.current || disabled) return;
    const controller = new AbortController();
    active.current = controller;
    setError("");
    setStatus("");
    setAction(remove ? "remove" : "download");
    if (remove) onPendingChange?.(true);
    try {
      if (remove) {
        await removeAssignmentFile(scope.assignmentId, attachment.id);
        await queryClient.invalidateQueries({ queryKey });
        setStatus("Attachment removed.");
      } else {
        const blob = await downloadAssignmentFile(
          attachment.storage_path,
          controller.signal,
        );
        controller.signal.throwIfAborted();
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = studioDownloadName(
          attachment.original_name,
          attachment.mime_type,
        );
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 30_000);
      }
    } catch (reason) {
      if (!controller.signal.aborted)
        setError(
          reason instanceof Error
            ? reason.message
            : "The file action could not be confirmed.",
        );
    } finally {
      active.current = null;
      setAction(undefined);
      if (remove) onPendingChange?.(Boolean(file));
    }
  };

  return (
    <div>
      <button
        type="button"
        aria-expanded={open}
        disabled={!!action || !!file}
        onClick={() => setOpen((value) => !value)}
      >
        {open
          ? "Hide assignment files"
          : canEdit
            ? "Assignment files"
            : "View assignment files"}
      </button>
      {open && (
        <div
          className="lesson-upload"
          role="region"
          aria-label="Assignment files"
        >
          {attached.isPending && <p role="status">Loading assignment files…</p>}
          {attached.isError && (
            <p role="alert">
              Assignment files could not be loaded.{" "}
              <button type="button" onClick={() => void attached.refetch()}>
                Retry
              </button>
            </p>
          )}
          {attached.data?.length === 0 && <p>No files attached.</p>}
          {!!attached.data?.length && (
            <ul className="upload-queue">
              {attached.data.map((item) => (
                <li key={item.id}>
                  <span>
                    {item.original_name}{" "}
                    <small>{Math.ceil(item.file_size_bytes / 1024)} KB</small>
                  </span>
                  <span>
                    <button
                      type="button"
                      disabled={!!action || disabled}
                      onClick={() => void manage(item, false)}
                    >
                      Download
                    </button>
                    {canEdit && !item.submitted_at && (
                      <button
                        type="button"
                        aria-label={`Remove ${item.original_name}`}
                        disabled={!!action || disabled}
                        onClick={() => void manage(item, true)}
                      >
                        Remove
                      </button>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {canEdit && (
            <>
              <p>
                Attach up to 12 files, 50 MB each. Completing the assignment
                submits them to your coach and authorized household members.
              </p>
              <label htmlFor={field}>
                Choose an assignment file
                <input
                  id={field}
                  type="file"
                  accept={studioFileAccept}
                  disabled={!!action || disabled}
                  onChange={(event) => {
                    choose(event.currentTarget.files?.[0]);
                    event.currentTarget.value = "";
                  }}
                />
              </label>
              {file && (
                <div className="form-actions">
                  <span>{file.name}</span>
                  <button
                    type="button"
                    className="primary"
                    disabled={!!action || disabled}
                    onClick={() => void attach()}
                  >
                    {hash ? "Retry attachment" : "Attach file"}
                  </button>
                  <button
                    type="button"
                    disabled={action === "attach" || disabled}
                    onClick={() =>
                      action === "upload"
                        ? active.current?.abort()
                        : clearFile()
                    }
                  >
                    {action === "upload" ? "Cancel upload" : "Clear selection"}
                  </button>
                </div>
              )}
              {action === "upload" && (
                <progress
                  value={progress}
                  max={100}
                  aria-label="Uploading file"
                />
              )}
            </>
          )}
          {action && (
            <p role="status">
              {
                {
                  upload: "Uploading file…",
                  attach: "Upload complete. Attaching file…",
                  remove: "Removing attachment…",
                  download: "Downloading file…",
                }[action]
              }
            </p>
          )}
          {error && <p role="alert">{error}</p>}
          {status && <p role="status">{status}</p>}
        </div>
      )}
    </div>
  );
}
