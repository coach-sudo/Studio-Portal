import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Drawer, EmptyState, Section } from "../../components/Primitives";
import { WritingArea } from "../../components/WritingArea";
import {
  metadataKinds,
  type LibraryResource,
  type ResourceDetail,
  type ResourceOption,
  type ResourceCollection,
} from "../../domain/library";
import type { StudioSnapshot } from "../../domain/model";
import {
  getResourceDetail,
  getAssignment,
  resourceCommand,
  useResourceSearch,
} from "../../data/library";
import { getSignedMaterialUrl } from "../../data/repository";
import { useStudioStore } from "../../state/StudioStore";
import { MetadataPicker } from "./MetadataPicker";
import { ResourceEditor } from "./ResourceEditor";
import { MetadataManager } from "./MetadataManager";
import { CollectionsManager } from "./CollectionsManager";
import { AssignmentEditor } from "./AssignmentEditor";
import "./Library.css";

export function ResourceDetailView({
  resource,
  data,
  isDemo,
}: {
  resource: LibraryResource;
  data: StudioSnapshot;
  isDemo: boolean;
}) {
  const [error, setError] = useState("");
  const assignment = useQuery({
    queryKey: ["material-assignment", resource.assignmentId],
    queryFn: ({ signal }) => getAssignment(resource.assignmentId!, signal),
    enabled: !isDemo && !!resource.assignmentId,
  });
  const full = useQuery({
    queryKey: ["material-detail", resource.id],
    queryFn: ({ signal }) => getResourceDetail(resource.id, signal),
    enabled: !isDemo,
  });
  const original = data.materials.find(
    (m) => (m.resourceId || m.id) === resource.id,
  );
  const detail: ResourceDetail | null | undefined = isDemo
    ? {
        id: resource.id,
        title: resource.title,
        description: resource.description,
        source: resource.source,
        text: original?.textContent || "",
        storagePath: original?.storagePath,
        externalUrl: original?.externalUrl,
        keywords: original?.keywords || [],
        version: resource.version,
      }
    : full.data;
  const open = async () => {
    const target = window.open("about:blank", "_blank");
    if (target) target.opener = null;
    try {
      const url = detail?.storagePath
        ? await getSignedMaterialUrl(detail.storagePath)
        : detail?.externalUrl;
      if (!url || !/^https?:\/\//i.test(url))
        throw new Error("The resource link is unavailable.");
      if (target) target.location.href = url;
      else throw new Error("Allow a new tab to open the resource.");
    } catch (reason) {
      target?.close();
      setError(
        reason instanceof Error ? reason.message : "Could not open resource.",
      );
    }
  };
  return (
    <div className="resource-detail">
      {!isDemo && full.isPending && <p role="status">Loading resource…</p>}
      {!isDemo && full.isError && (
        <p role="alert">
          {full.error.message}
          <button type="button" onClick={() => void full.refetch()}>
            Retry
          </button>
        </p>
      )}
      {full.isSuccess && !detail && (
        <p role="alert">This resource is no longer available.</p>
      )}
      {detail && (
        <>
          {(isDemo ? resource.instructions : assignment.data?.instructions) && (
            <div className="resource-instructions">
              <strong>Instructions</strong>
              <p>
                {isDemo ? resource.instructions : assignment.data?.instructions}
              </p>
            </div>
          )}
          {data.role === "coach" && assignment.data?.coachNotes && (
            <details>
              <summary>Private coach notes</summary>
              <p className="resource-instructions">
                {assignment.data.coachNotes}
              </p>
            </details>
          )}
          <p>{detail.description}</p>
          {detail.source && <small>Source: {detail.source}</small>}
          {detail.keywords.length > 0 && (
            <small>Keywords: {detail.keywords.join(", ")}</small>
          )}
          {detail.text && <div className="resource-text">{detail.text}</div>}
          {(detail.storagePath || detail.externalUrl) && (
            <button type="button" onClick={() => void open()}>
              {detail.storagePath ? "Open file" : "Visit source link"}
            </button>
          )}
        </>
      )}
      {error && <p role="alert">{error}</p>}
      {assignment.isError && (
        <p role="alert">
          Instructions could not be loaded.
          <button type="button" onClick={() => void assignment.refetch()}>
            Retry instructions
          </button>
        </p>
      )}
    </div>
  );
}

export function ResourceAssignmentForm({
  resource,
  data,
  isDemo,
  studentId,
  lessonId,
  noteId,
  collection = false,
  onSaved,
  onClose,
}: {
  resource: LibraryResource | ResourceCollection;
  collection?: boolean;
  data: StudioSnapshot;
  isDemo: boolean;
  studentId?: string;
  lessonId?: string;
  noteId?: string;
  onSaved: () => void;
  onClose: () => void;
}) {
  const store = useStudioStore(),
    queryClient = useQueryClient();
  const [students, setStudents] = useState(studentId ? [studentId] : []),
    [search, setSearch] = useState(""),
    [limit, setLimit] = useState(25),
    [instructions, setInstructions] = useState(""),
    [coachNotes, setCoachNotes] = useState(""),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState("");
  const roster = data.students.filter((s) =>
    s.fullName.toLowerCase().includes(search.toLowerCase()),
  );
  const assign = async () => {
    setBusy(true);
    setNotice("");
    try {
      if (isDemo)
        store.transact((draft) => {
          const resourceIds = collection
            ? (resource as ResourceCollection).resourceIds || []
            : [resource.id];
          for (const resourceId of resourceIds) {
            const original = draft.materials.find(
              (m) => (m.resourceId || m.id) === resourceId,
            );
            if (!original) throw new Error("Resource not found");
            for (const id of students)
              if (
                !draft.materials.some(
                  (m) =>
                    (m.resourceId || m.id) === resourceId &&
                    m.studentId === id &&
                    m.lessonId === lessonId &&
                    m.noteId === noteId,
                )
              )
                draft.materials.push({
                  ...original,
                  id: crypto.randomUUID(),
                  resourceId,
                  studentId: id,
                  lessonId,
                  noteId,
                  instructions,
                  pinned: false,
                  status: "active",
                  version: 1,
                  updatedAt: new Date().toISOString(),
                });
          }
        });
      else
        await resourceCommand(
          collection ? "collection_assign" : "resource_assign",
          {
            studioId: data.studioId,
            id: resource.id,
            studentIds: students,
            lessonId,
            noteId,
            instructions,
            coachNotes,
          },
          collection ? resource.version : 0,
        );
      await queryClient.invalidateQueries({ queryKey: ["material-resources"] });
      onSaved();
    } catch (reason) {
      setNotice(
        reason instanceof Error ? reason.message : "Assignment failed.",
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <form
      className="workflow-form resource-form"
      onSubmit={(event) => {
        event.preventDefault();
        void assign();
      }}
    >
      <strong className="full">{resource.title}</strong>
      {!studentId && (
        <fieldset className="full resource-students">
          <legend>Assign to students ({students.length} selected)</legend>
          <input
            type="search"
            aria-label="Find students to assign"
            value={search}
            onKeyDown={(event) => {
              if (event.key === "Enter") event.preventDefault();
            }}
            onChange={(e) => {
              setSearch(e.target.value);
              setLimit(25);
            }}
          />
          {roster.slice(0, limit).map((student) => (
            <label key={student.id}>
              <input
                type="checkbox"
                checked={students.includes(student.id)}
                onChange={(e) =>
                  setStudents(
                    e.target.checked
                      ? [...students, student.id]
                      : students.filter((id) => id !== student.id),
                  )
                }
              />
              {student.fullName}
            </label>
          ))}
          {roster.length > limit && (
            <button type="button" onClick={() => setLimit(limit + 25)}>
              More students
            </button>
          )}
        </fieldset>
      )}
      <label className="full">
        Student-facing instructions
        <WritingArea
          maxLength={10000}
          value={instructions}
          onChange={(e) => setInstructions(e.target.value)}
        />
      </label>
      {data.role === "coach" && (
        <label className="full">
          Private coach notes
          <WritingArea
            maxLength={10000}
            value={coachNotes}
            onChange={(e) => setCoachNotes(e.target.value)}
          />
        </label>
      )}
      {noteId && (
        <p className="full">
          The attachment appears with the published note. Existing shared
          resources keep their access.
        </p>
      )}
      <p className="full">
        Existing assignments keep their status and instructions. No file is
        copied.
      </p>
      {notice && (
        <p className="full" role="alert">
          {notice}
        </p>
      )}
      <div className="form-actions full">
        <button type="button" onClick={onClose}>
          Cancel
        </button>
        <button
          className="primary"
          disabled={busy || !students.length || students.length > 100}
        >
          {busy
            ? "Assigning…"
            : `Assign${students.length > 1 ? ` to ${students.length} students` : " resource"}`}
        </button>
      </div>
    </form>
  );
}

export function ResourceBrowser({
  data,
  isDemo,
  studentId,
  lessonId,
  noteId,
  catalog = true,
  onChoose,
  showActions = true,
  title,
}: {
  data: StudioSnapshot;
  isDemo: boolean;
  studentId?: string;
  lessonId?: string;
  noteId?: string;
  catalog?: boolean;
  onChoose?: (resource: LibraryResource) => void;
  showActions?: boolean;
  title?: string;
}) {
  const store = useStudioStore(),
    queryClient = useQueryClient(),
    coach = data.role === "coach";
  const source = isDemo ? { ...store.snapshot, role: data.role } : data;
  const canManage =
    coach ||
    data.role === "student" ||
    !!data.linkedContacts.find(
      (contact) => contact.id === data.currentLinkedContactId,
    )?.canManageProfile;
  const [search, setSearch] = useState(""),
    [visibility, setVisibility] = useState("all"),
    [filters, setFilters] = useState<ResourceOption[]>([]),
    [status, setStatus] = useState("active"),
    [pinned, setPinned] = useState(false),
    [sort, setSort] = useState("title"),
    [expanded, setExpanded] = useState<string>(),
    [editing, setEditing] = useState<LibraryResource>(),
    [editingAssignment, setEditingAssignment] = useState<LibraryResource>(),
    [assigning, setAssigning] = useState<LibraryResource>(),
    [adding, setAdding] = useState(false),
    [managing, setManaging] = useState(false),
    [collections, setCollections] = useState(false),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState("");
  const query = useResourceSearch(
    {
      studioId: data.studioId,
      studentId,
      catalog,
      search,
      visibility,
      filters: Object.fromEntries(
        metadataKinds.map((kind) => [
          kind,
          filters.filter((o) => o.kind === kind).map((o) => o.id),
        ]),
      ),
      status,
      pinned,
      sort,
      lessonId,
    },
    source,
    isDemo,
  );
  const resources = query.data?.pages.flatMap((page) => page.items) || [],
    total = query.data?.pages[0]?.total;
  const update = async (
    resource: LibraryResource,
    action: "status" | "pin" | "remove" | "archive",
  ) => {
    if (
      action === "remove" &&
      !window.confirm(
        `Remove “${resource.title}” from this student's materials? The Library resource and other assignments remain available.`,
      )
    )
      return;
    setBusy(resource.assignmentId || resource.id);
    setNotice("");
    try {
      if (isDemo)
        store.transact((draft) => {
          if (action === "archive")
            draft.materials
              .filter((m) => (m.resourceId || m.id) === resource.id)
              .forEach((m) => {
                m.status = m.status === "active" ? "archived" : "active";
                m.version += 1;
              });
          else {
            const item = draft.materials.find(
              (m) => m.id === resource.assignmentId,
            );
            if (!item) return;
            if (action === "status")
              item.status = item.status === "active" ? "vaulted" : "active";
            if (action === "pin") item.pinned = !item.pinned;
            if (action === "remove") {
              if (item.inLibrary && item.id === (item.resourceId || item.id)) {
                item.studentId = "";
                item.lessonId = undefined;
                item.noteId = undefined;
              } else
                draft.materials = draft.materials.filter(
                  (m) => m.id !== item.id,
                );
            } else item.version += 1;
          }
        });
      else
        await resourceCommand(
          action === "archive"
            ? "resource_archive"
            : action === "remove"
              ? "assignment_remove"
              : "assignment_update",
          {
            id: action === "archive" ? resource.id : resource.assignmentId,
            ...(action === "status"
              ? { status: resource.status === "active" ? "vaulted" : "active" }
              : action === "pin"
                ? { pinned: !resource.pinned }
                : {}),
          },
          action === "archive"
            ? resource.version
            : resource.assignmentVersion || 1,
        );
      await queryClient.invalidateQueries({ queryKey: ["material-resources"] });
      setNotice("Materials updated.");
    } catch (reason) {
      setNotice(reason instanceof Error ? reason.message : "Update failed.");
    } finally {
      setBusy("");
    }
  };
  return (
    <Section
      title={title || (catalog ? "Studio Library" : "My Materials")}
      aside={
        showActions &&
        canManage && (
          <div className="page-actions">
            <button type="button" onClick={() => setAdding(true)}>
              {catalog ? "New resource" : "Add material"}
            </button>
            {coach && catalog && (
              <button type="button" onClick={() => setCollections(true)}>
                Collections
              </button>
            )}
            {coach && catalog && (
              <button type="button" onClick={() => setManaging(true)}>
                Manage classifications
              </button>
            )}
          </div>
        )
      }
    >
      <div className="resource-search">
        <label>
          Search resources
          <input
            type="search"
            value={search}
            placeholder="Title, topic, level, or keyword"
            onKeyDown={(event) => {
              if (event.key === "Enter") event.preventDefault();
            }}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
        {coach && catalog && (
          <label>
            Access
            <select
              value={visibility}
              onChange={(e) => setVisibility(e.target.value)}
            >
              <option value="all">All access</option>
              <option value="assigned">Assigned students</option>
              <option value="studio">Shared student catalog</option>
            </select>
          </label>
        )}
        <label>
          Sort
          <select value={sort} onChange={(e) => setSort(e.target.value)}>
            <option value="title">Title</option>
            <option value="date">Date added</option>
            {!catalog && <option value="pinned">Pinned first</option>}
          </select>
        </label>
        <label>
          {catalog ? "Catalog state" : "Materials"}
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="active">{catalog ? "Active" : "Current"}</option>
            <option value="vaulted">Vaulted</option>
            <option value="archived">Archived</option>
            <option value="all">All</option>
          </select>
        </label>
        {!catalog && (
          <label className="check-row">
            <input
              type="checkbox"
              checked={pinned}
              onChange={(e) => setPinned(e.target.checked)}
            />
            Pinned only
          </label>
        )}
      </div>
      <div className="resource-filters">
        {metadataKinds.map((kind) => (
          <MetadataPicker
            key={kind}
            data={source}
            isDemo={isDemo}
            kind={kind}
            label={
              kind === "category"
                ? "Categories"
                : kind === "medium"
                  ? "Mediums"
                  : `${kind[0].toUpperCase()}${kind.slice(1)}s`
            }
            selected={filters.filter((o) => o.kind === kind)}
            onChange={(next) =>
              setFilters([...filters.filter((o) => o.kind !== kind), ...next])
            }
          />
        ))}
      </div>
      <div className="resource-result-status" aria-live="polite">
        {query.isFetching
          ? "Searching…"
          : total === undefined
            ? ""
            : `${total} resource${total === 1 ? "" : "s"}`}
        {(search ||
          filters.length ||
          pinned ||
          status !== "active" ||
          visibility !== "all") && (
          <button
            type="button"
            onClick={() => {
              setSearch("");
              setFilters([]);
              setStatus("active");
              setPinned(false);
              setVisibility("all");
            }}
          >
            Clear filters
          </button>
        )}
      </div>
      {notice && <p role="status">{notice}</p>}
      {query.isError && (
        <p role="alert">
          {query.error.message}
          <button type="button" onClick={() => void query.refetch()}>
            Retry search
          </button>
        </p>
      )}
      <div className="resource-results" aria-busy={query.isFetching}>
        {resources.map((resource) => (
          <article key={resource.assignmentId || resource.id}>
            <div>
              <strong>{resource.title}</strong>
              <small>
                {resource.mimeType || resource.mediaKind || "Resource"}
                {resource.pinned ? " · Pinned" : ""}
              </small>
              <div className="resource-tags">
                {resource.options.map((option) => (
                  <span key={option.id}>{option.name}</span>
                ))}
              </div>
              {resource.hasInstructions && (
                <small>Instructions available in Details</small>
              )}
            </div>
            <div className="resource-actions">
              <button
                type="button"
                aria-expanded={
                  expanded === (resource.assignmentId || resource.id)
                }
                onClick={() =>
                  setExpanded(
                    expanded === (resource.assignmentId || resource.id)
                      ? undefined
                      : resource.assignmentId || resource.id,
                  )
                }
              >
                Details
              </button>
              {onChoose ? (
                <button type="button" onClick={() => onChoose(resource)}>
                  Choose resource
                </button>
              ) : catalog ? (
                <>
                  {canManage && (coach || studentId) && (
                    <button
                      type="button"
                      disabled={resource.resourceStatus !== "active"}
                      onClick={() => setAssigning(resource)}
                    >
                      Assign
                    </button>
                  )}
                  {coach && (
                    <>
                      <button
                        type="button"
                        onClick={() => setEditing(resource)}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        disabled={!!busy}
                        onClick={() => void update(resource, "archive")}
                      >
                        {resource.resourceStatus === "active"
                          ? "Archive"
                          : "Restore"}
                      </button>
                    </>
                  )}
                </>
              ) : canManage ? (
                <>
                  <button
                    type="button"
                    disabled={!!busy}
                    onClick={() => void update(resource, "pin")}
                  >
                    {resource.pinned ? "Unpin" : "Pin"}
                  </button>
                  <button
                    type="button"
                    disabled={!!busy}
                    onClick={() => void update(resource, "status")}
                  >
                    {resource.status === "active" ? "Vault" : "Restore"}
                  </button>
                  <button
                    type="button"
                    disabled={!!busy}
                    onClick={() => void update(resource, "remove")}
                  >
                    Remove assignment
                  </button>
                  {coach && (
                    <button
                      type="button"
                      onClick={() => setEditingAssignment(resource)}
                    >
                      Edit assignment
                    </button>
                  )}
                  {coach && (
                    <button type="button" onClick={() => setEditing(resource)}>
                      Edit resource
                    </button>
                  )}
                </>
              ) : null}
            </div>
            {expanded === (resource.assignmentId || resource.id) && (
              <ResourceDetailView
                resource={resource}
                data={source}
                isDemo={isDemo}
              />
            )}
          </article>
        ))}
      </div>
      {query.isSuccess && !resources.length && (
        <EmptyState
          title="No resources found"
          detail={
            search || filters.length
              ? "Try another search or clear filters."
              : catalog
                ? "Add a reusable resource to the Studio Library."
                : "Your assigned resources will appear here."
          }
        />
      )}
      {query.hasNextPage && (
        <button
          type="button"
          disabled={query.isFetchingNextPage}
          onClick={() => void query.fetchNextPage()}
        >
          {query.isFetchingNextPage ? "Loading…" : "Load More"}
        </button>
      )}
      {adding &&
        (catalog && !studentId ? (
          <ResourceEditor
            data={data}
            isDemo={isDemo}
            onClose={() => setAdding(false)}
            onSaved={() => setAdding(false)}
          />
        ) : (
          <AddResourceFlow
            data={data}
            isDemo={isDemo}
            studentId={studentId}
            lessonId={lessonId}
            noteId={noteId}
            onClose={() => setAdding(false)}
          />
        ))}
      {editing && (
        <ResourceEditor
          data={data}
          isDemo={isDemo}
          resource={editing}
          studentId={editing.ownerStudentId || studentId}
          onClose={() => setEditing(undefined)}
          onSaved={() => setEditing(undefined)}
        />
      )}
      {editingAssignment && (
        <AssignmentEditor
          resource={editingAssignment}
          isDemo={isDemo}
          onClose={() => setEditingAssignment(undefined)}
        />
      )}
      {assigning && (
        <Drawer title="Assign resource" onClose={() => setAssigning(undefined)}>
          <ResourceAssignmentForm
            resource={assigning}
            data={data}
            isDemo={isDemo}
            studentId={studentId}
            lessonId={lessonId}
            noteId={noteId}
            onClose={() => setAssigning(undefined)}
            onSaved={() => setAssigning(undefined)}
          />
        </Drawer>
      )}
      {managing && (
        <MetadataManager
          data={source}
          isDemo={isDemo}
          onClose={() => setManaging(false)}
        />
      )}
      {collections && (
        <CollectionsManager
          data={source}
          isDemo={isDemo}
          onClose={() => setCollections(false)}
        />
      )}
    </Section>
  );
}

export function AddResourceFlow({
  data,
  isDemo,
  studentId,
  lessonId,
  noteId,
  onClose,
}: {
  data: StudioSnapshot;
  isDemo: boolean;
  studentId?: string;
  lessonId?: string;
  noteId?: string;
  onClose: () => void;
}) {
  const [mode, setMode] = useState("choose"),
    [chosen, setChosen] = useState<LibraryResource>();
  if (mode === "new")
    return (
      <ResourceEditor
        data={data}
        isDemo={isDemo}
        studentId={studentId}
        lessonId={lessonId}
        noteId={noteId}
        onClose={onClose}
        onSaved={onClose}
      />
    );
  return (
    <Drawer
      title={noteId ? "Attach Resource" : "Add material"}
      onClose={onClose}
    >
      <div className="page-actions resource-flow-choices">
        <button
          type="button"
          aria-pressed={mode === "choose"}
          onClick={() => {
            setMode("choose");
            setChosen(undefined);
          }}
        >
          Choose from Library
        </button>
        <button type="button" onClick={() => setMode("new")}>
          Add New Resource
        </button>
      </div>
      {chosen && (
        <ResourceAssignmentForm
          resource={chosen}
          data={data}
          isDemo={isDemo}
          studentId={studentId}
          lessonId={lessonId}
          noteId={noteId}
          onClose={() => setChosen(undefined)}
          onSaved={onClose}
        />
      )}
      <div hidden={!!chosen}>
        <ResourceBrowser
          data={data}
          isDemo={isDemo}
          studentId={studentId}
          catalog
          onChoose={setChosen}
          showActions={false}
        />
      </div>
    </Drawer>
  );
}
