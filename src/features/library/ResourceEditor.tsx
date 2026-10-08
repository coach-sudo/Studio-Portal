import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Drawer } from "../../components/Primitives";
import { WritingArea } from "../../components/WritingArea";
import {
  metadataKinds,
  type LibraryResource,
  type ResourceOption,
} from "../../domain/library";
import type { StudioSnapshot } from "../../domain/model";
import { getResourceDetail, resourceCommand } from "../../data/library";
import { uploadStudioFile } from "../../data/uploads";
import { useStudioStore } from "../../state/StudioStore";
import { MetadataPicker } from "./MetadataPicker";

export function ResourceEditor({
  data,
  isDemo,
  studentId,
  lessonId,
  noteId,
  resource,
  onSaved,
  onClose,
}: {
  data: StudioSnapshot;
  isDemo: boolean;
  studentId?: string;
  lessonId?: string;
  noteId?: string;
  resource?: LibraryResource;
  onSaved: () => void;
  onClose: () => void;
}) {
  const coach = data.role === "coach",
    store = useStudioStore(),
    queryClient = useQueryClient();
  const [title, setTitle] = useState(resource?.title || ""),
    [description, setDescription] = useState(resource?.description || ""),
    [source, setSource] = useState(resource?.source || ""),
    [keywords, setKeywords] = useState(""),
    [url, setUrl] = useState(""),
    [text, setText] = useState(""),
    [instructions, setInstructions] = useState(""),
    [coachNotes, setCoachNotes] = useState("");
  const [file, setFile] = useState<File>(),
    [type, setType] = useState("file"),
    [options, setOptions] = useState<ResourceOption[]>(resource?.options || []),
    [library, setLibrary] = useState(
      resource?.inLibrary ?? (coach && !studentId),
    ),
    [visibility, setVisibility] = useState(resource?.visibility || "assigned"),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState("");
  const detail = useQuery({
    queryKey: ["material-detail", resource?.id],
    queryFn: ({ signal }) => getResourceDetail(resource!.id, signal),
    enabled: !!resource && !isDemo,
  });
  const demoOriginal = resource
    ? data.materials.find((m) => (m.resourceId || m.id) === resource.id)
    : undefined;
  const initialized = useRef(false);
  useEffect(() => {
    const loaded = detail.data || (isDemo ? demoOriginal : undefined);
    if (!initialized.current && loaded) {
      setKeywords((loaded.keywords || []).join(", "));
      setText("text" in loaded ? loaded.text : loaded.textContent || "");
      initialized.current = true;
    }
  }, [detail.data, demoOriginal, isDemo]);
  const ready = !resource || isDemo || (detail.isSuccess && !!detail.data);
  const save = async () => {
    setBusy(true);
    setNotice("");
    try {
      const nextKeywords = keywords
        .split(",")
        .map((k) => k.trim())
        .filter(Boolean);
      const nextText = text;
      let selected = options;
      if (
        !resource &&
        file &&
        coach &&
        !selected.some((o) => o.kind === "medium")
      ) {
        const name =
          file.type === "application/pdf"
            ? "PDF"
            : file.type.startsWith("image/")
              ? "Image"
              : file.type.startsWith("audio/")
                ? "Audio"
                : file.type.startsWith("video/")
                  ? "Video"
                  : "Text";
        const result = isDemo
          ? { id: crypto.randomUUID() }
          : await resourceCommand("option_create", {
              studioId: data.studioId,
              kind: "medium",
              name,
            });
        const option: ResourceOption = {
          id: result.id,
          kind: "medium",
          name,
          archived: false,
        };
        selected = [...selected, option];
        if (isDemo)
          store.transact((draft) => {
            draft.materialOptions = [...(draft.materialOptions || []), option];
          });
      }
      if (isDemo) {
        store.transact((draft) => {
          if (resource)
            draft.materials
              .filter((m) => (m.resourceId || m.id) === resource.id)
              .forEach((m) => {
                m.title = title;
                m.caption = description;
                m.source = source;
                m.keywords = nextKeywords;
                m.textContent = nextText;
                m.resourceOptions = selected;
                m.inLibrary = library;
                m.catalogVisibility = visibility as "assigned" | "studio";
                m.version += 1;
              });
          else {
            const id = crypto.randomUUID();
            draft.materials.push({
              id,
              studentId: studentId || "",
              resourceId: id,
              lessonId,
              noteId,
              title,
              caption: description,
              source,
              category:
                selected.find((o) => o.kind === "category")?.name || "Other",
              keywords: nextKeywords,
              textContent: text,
              externalUrl: url || undefined,
              role: lessonId ? "lesson_material" : "library",
              status: "active",
              approvalStatus: "not_public",
              resourceOptions: selected,
              inLibrary: library,
              catalogVisibility: visibility as "assigned" | "studio",
              instructions,
              version: 1,
              updatedAt: new Date().toISOString(),
            });
          }
        });
      } else {
        const uploaded = file
          ? await uploadStudioFile({
              studioId: data.studioId,
              studentId: library ? undefined : studentId,
              entityType: "material",
              file,
              visibility: noteId ? "private" : "student",
            })
          : undefined;
        await resourceCommand(
          resource ? "resource_update" : "resource_create",
          {
            studioId: data.studioId,
            id: resource?.id,
            studentId,
            lessonId,
            noteId,
            title,
            description,
            source,
            keywords: nextKeywords,
            text: nextText,
            externalUrl: url || undefined,
            fileAssetId: uploaded?.id,
            inLibrary: library,
            visibility,
            optionIds: selected.map((o) => o.id),
            instructions,
            coachNotes,
          },
          resource?.version || 0,
        );
        await queryClient.invalidateQueries({
          queryKey: ["material-resources"],
        });
        await queryClient.invalidateQueries({ queryKey: ["material-options"] });
        await queryClient.invalidateQueries({ queryKey: ["material-detail"] });
      }
      onSaved();
    } catch (error) {
      setNotice(
        error instanceof Error
          ? error.message
          : "The resource could not be saved.",
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <Drawer
      title={resource ? "Edit resource" : "Add New Resource"}
      onClose={onClose}
    >
      <form
        className="workflow-form resource-form"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        {detail.isError && (
          <p className="full" role="alert">
            {detail.error.message}
            <button type="button" onClick={() => void detail.refetch()}>
              Retry
            </button>
          </p>
        )}
        <label className="full">
          Title
          <input
            required
            maxLength={200}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </label>
        <label className="full">
          Description
          <WritingArea
            writingSize="description"
            maxLength={10000}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </label>
        <div className="resource-classifications full">
          {metadataKinds.map((kind) => (
            <MetadataPicker
              key={kind}
              data={data}
              isDemo={isDemo}
              kind={kind}
              label={
                kind === "category"
                  ? "Categories"
                  : kind === "medium"
                    ? "Mediums"
                    : `${kind[0].toUpperCase()}${kind.slice(1)}s`
              }
              selected={options.filter((o) => o.kind === kind)}
              onChange={(value) =>
                setOptions([
                  ...options.filter((o) => o.kind !== kind),
                  ...value,
                ])
              }
              canCreate={coach}
            />
          ))}
        </div>
        <label>
          Source / author
          <input
            maxLength={200}
            value={source}
            onChange={(e) => setSource(e.target.value)}
          />
        </label>
        <label>
          Keywords
          <input
            value={keywords}
            placeholder={
              detail.data?.keywords?.join(", ") || "Comma-separated keywords"
            }
            onChange={(e) => setKeywords(e.target.value)}
          />
        </label>
        {!resource && (
          <>
            <label className="full">
              Resource type
              <select
                value={type}
                onChange={(e) => {
                  setType(e.target.value);
                  setFile(undefined);
                  setUrl("");
                  setText("");
                }}
              >
                <option value="file">Upload file</option>
                <option value="link">External link</option>
                <option value="text">Text resource</option>
              </select>
            </label>
            {type === "file" && (
              <label className="full">
                File
                <input
                  required
                  type="file"
                  accept="application/pdf,image/jpeg,image/png,image/webp,audio/mpeg,audio/mp4,video/mp4,text/plain"
                  onChange={(e) => {
                    const next = e.target.files?.[0];
                    setFile(next);
                    if (next && !title)
                      setTitle(next.name.replace(/\.[^.]+$/, ""));
                  }}
                />
              </label>
            )}
            {type === "link" && (
              <label className="full">
                External URL
                <input
                  required
                  type="url"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                />
              </label>
            )}
            {type === "text" && (
              <label className="full">
                Resource text
                <WritingArea
                  required
                  writingSize="long"
                  maxLength={100000}
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                />
              </label>
            )}
          </>
        )}
        {resource && (detail.data?.text || demoOriginal?.textContent) && (
          <label className="full">
            Resource text
            <WritingArea
              writingSize="long"
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
          </label>
        )}
        {coach && studentId && (
          <label className="check-row full">
            <input
              type="checkbox"
              checked={library}
              disabled={!!resource?.inLibrary && !resource.ownerStudentId}
              onChange={(e) => setLibrary(e.target.checked)}
            />
            Also add to Studio Library
          </label>
        )}
        {coach && library && (
          <label className="full">
            Library access
            <select
              value={visibility}
              onChange={(e) =>
                setVisibility(e.target.value as typeof visibility)
              }
            >
              <option value="assigned">
                Coach catalog; students by assignment
              </option>
              <option value="studio" disabled={!!noteId && !resource}>
                Shared student catalog
              </option>
            </select>
          </label>
        )}
        {studentId && !resource && (
          <>
            <label className="full">
              Student-facing instructions
              <WritingArea
                maxLength={10000}
                value={instructions}
                onChange={(e) => setInstructions(e.target.value)}
              />
            </label>
            {coach && (
              <label className="full">
                Private coach notes
                <WritingArea
                  maxLength={10000}
                  value={coachNotes}
                  onChange={(e) => setCoachNotes(e.target.value)}
                />
              </label>
            )}
          </>
        )}
        {noteId && (
          <p className="full">
            New attachments remain private while the note is a draft.
          </p>
        )}
        {notice && (
          <p className="full" role="alert">
            {notice}
          </p>
        )}
        <div className="form-actions full">
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="primary" disabled={busy || !ready}>
            {busy ? "Saving…" : resource ? "Save resource" : "Add resource"}
          </button>
        </div>
      </form>
    </Drawer>
  );
}
