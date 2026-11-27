import "../../components/MyWork.css";
import { useEffect, useId, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Drawer } from "../../components/Primitives";
import type { StudioSnapshot } from "../../domain/model";
import { resourceCommand } from "../../data/library";
import { studioFileAccept, studioFileType } from "../../data/uploadFormats";
import { uploadStudioFile } from "../../data/uploads";
import { invalidateStudioDomains } from "../../hooks/useStudio";
import { useStudioStore } from "../../state/StudioStore";

type QueuedFile = {
  id: string;
  file: File;
  status?: "saved" | "failed" | "cancelled";
  error?: string;
  assetId?: string;
};

export function LessonFiles({
  data,
  isDemo,
  studentId,
  lessonId,
  noteId,
  onClose,
}: {
  data: StudioSnapshot;
  isDemo: boolean;
  studentId: string;
  lessonId?: string;
  noteId?: string;
  onClose: () => void;
}) {
  const store = useStudioStore();
  const queryClient = useQueryClient();
  const pickerId = useId();
  const picker = useRef<HTMLInputElement>(null);
  const [queue, setQueue] = useState<QueuedFile[]>([]);
  const [busy, setBusy] = useState(false);
  const [active, setActive] = useState<{
    id: string;
    fileName: string;
    phase: "upload" | "attach";
    progress?: number;
  }>();
  const transfer = useRef<AbortController | null>(null);
  const inFlight = useRef(false);
  const [dragging, setDragging] = useState(false);
  const pending = queue.filter((item) => item.status !== "saved");
  const add = (files: FileList) => {
    if (busy) return;
    const entries = Array.from(files, (file) => ({
      id: crypto.randomUUID(),
      file,
    }));
    setQueue((previous) => [
      ...previous,
      ...entries.filter(
        ({ file }) =>
          !previous.some(
            (item) =>
              item.file.name === file.name &&
              item.file.size === file.size &&
              item.file.lastModified === file.lastModified,
          ),
      ),
    ]);
    if (picker.current) picker.current.value = "";
  };
  const save = async () => {
    if (inFlight.current || !pending.length) return;
    inFlight.current = true;
    setBusy(true);
    let saved = 0;
    try {
      for (const { id, file, assetId } of pending) {
        let retainedAsset = assetId;
        const controller = new AbortController();
        transfer.current = controller;
        setActive({
          id,
          fileName: file.name,
          phase: assetId ? "attach" : "upload",
        });
        try {
          const mimeType = studioFileType(file);
          const title = file.name.trim().slice(0, 200) || "Attachment";
          if (isDemo) {
            store.transact((draft) =>
              draft.materials.push({
                id,
                resourceId: id,
                studentId,
                lessonId,
                noteId,
                title,
                category: "Other",
                mimeType,
                fileSizeBytes: file.size,
                role: lessonId ? "lesson_material" : "library",
                status: "active",
                approvalStatus: "not_public",
                version: 1,
                updatedAt: new Date().toISOString(),
              }),
            );
          } else {
            const asset = retainedAsset
              ? null
              : await uploadStudioFile(
                  {
                    studioId: data.studioId,
                    studentId,
                    entityType: "material",
                    file,
                    visibility: noteId ? "private" : "student",
                  },
                  {
                    signal: controller.signal,
                    onProgress: (loaded, total) =>
                      setActive((current) =>
                        current?.id === id
                          ? {
                              ...current,
                              progress: Math.round((100 * loaded) / total),
                            }
                          : current,
                      ),
                  },
                );
            retainedAsset = retainedAsset || asset?.id;
            setActive({ id, fileName: file.name, phase: "attach" });
            transfer.current = null;
            await resourceCommand("resource_attach_file", {
              studioId: data.studioId,
              studentId,
              lessonId,
              noteId,
              title,
              fileAssetId: retainedAsset,
              inLibrary: false,
              visibility: "assigned",
            });
          }
          saved += 1;
          setQueue((previous) =>
            previous.map((item) =>
              item.id === id
                ? { ...item, status: "saved", error: undefined }
                : item,
            ),
          );
        } catch (error) {
          setQueue((previous) =>
            previous.map((item) =>
              item.id === id
                ? {
                    ...item,
                    status: controller.signal.aborted ? "cancelled" : "failed",
                    assetId: retainedAsset,
                    error: controller.signal.aborted
                      ? "Upload cancelled."
                      : retainedAsset
                        ? "File uploaded. Attachment could not be confirmed. Retry to finish attaching."
                        : error instanceof Error
                          ? error.message
                          : "File could not be uploaded.",
                  }
                : item,
            ),
          );
        }
      }
      if (saved && !isDemo)
        await invalidateStudioDomains(queryClient, ["work"]);
    } finally {
      setActive(undefined);
      transfer.current = null;
      inFlight.current = false;
      setBusy(false);
    }
  };
  return (
    <Drawer
      title={
        noteId
          ? "Attach files to note"
          : lessonId
            ? "Attach files to lesson"
            : "Upload materials"
      }
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <div className="lesson-upload workflow-content">
        <p>
          {noteId
            ? "Files follow the access of this note."
            : "Attached files are available to the assigned student and authorized household members."}
        </p>
        <div
          className={dragging ? "upload-drop dragging" : "upload-drop"}
          onDragOver={(event) => {
            event.preventDefault();
            if (!busy) setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragging(false);
            add(event.dataTransfer.files);
          }}
        >
          <label htmlFor={pickerId}>
            Choose files
            <input
              id={pickerId}
              ref={picker}
              type="file"
              multiple
              accept={studioFileAccept}
              disabled={busy}
              onChange={(event) => {
                if (event.target.files) add(event.target.files);
              }}
            />
          </label>
          <small>
            Or drop files here. Documents, images, audio, video, and ZIP files
            up to 50 MB each.
          </small>
        </div>
        {queue.length > 0 && (
          <ul className="upload-queue" aria-label="Selected files">
            {queue.map(({ id, file, status, error }) => (
              <li key={id}>
                <div>
                  <strong>{file.name}</strong>
                  <small role={status === "failed" ? "alert" : undefined}>
                    {status === "saved"
                      ? "Attached"
                      : error || "Ready to attach"}
                  </small>
                  <small>{Math.max(1, Math.round(file.size / 1024))} KB</small>
                  <FilePreview file={file} />
                  {active?.id === id && active.phase === "upload" && (
                    <>
                      <progress
                        aria-label={`Uploading ${file.name}`}
                        max={100}
                        value={active.progress}
                      />
                      <button
                        type="button"
                        onClick={() => transfer.current?.abort()}
                      >
                        Cancel upload
                      </button>
                    </>
                  )}
                </div>
                {status !== "saved" && (
                  <button
                    type="button"
                    disabled={busy}
                    aria-label={`Remove ${file.name}`}
                    onClick={() =>
                      setQueue((previous) =>
                        previous.filter((item) => item.id !== id),
                      )
                    }
                  >
                    Remove
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
        <p role="status">
          {active
            ? active.phase === "upload"
              ? `Uploading ${active.fileName}…`
              : `File uploaded. Attaching ${active.fileName}…`
            : queue.length
              ? `${queue.length - pending.length} of ${queue.length} files attached.`
              : ""}
        </p>
        <div className="form-actions">
          <button type="button" onClick={onClose} disabled={busy}>
            {queue.some((item) => item.status === "saved") ? "Done" : "Cancel"}
          </button>
          {pending.length > 0 && (
            <button
              type="button"
              className="primary"
              onClick={() => void save()}
              disabled={busy}
            >
              {queue.some(
                (item) =>
                  item.status === "failed" || item.status === "cancelled",
              )
                ? "Retry remaining files"
                : "Attach files"}
            </button>
          )}
        </div>
      </div>
    </Drawer>
  );
}

function FilePreview({ file }: { file: File }) {
  const [show, setShow] = useState(false);
  const [url, setUrl] = useState("");
  const image = [
    "image/jpeg",
    "image/png",
    "image/webp",
    "image/gif",
    "image/avif",
  ].includes(file.type);
  useEffect(() => {
    if (!show || !image) return;
    const preview = URL.createObjectURL(file);
    setUrl(preview);
    return () => URL.revokeObjectURL(preview);
  }, [file, image, show]);
  if (!image) return null;
  return (
    <>
      <button type="button" aria-expanded={show} onClick={() => setShow(!show)}>
        {show ? "Hide preview" : "Preview image"}
      </button>
      {show && url && <img width={160} alt={file.name} src={url} />}
    </>
  );
}
