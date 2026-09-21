import { useQueryClient } from "@tanstack/react-query";
import {
  BookOpen,
  Clapperboard,
  ExternalLink,
  FolderOpen,
  Images,
  LibraryBig,
  MoreHorizontal,
  Search,
  Trash2,
  UserRound,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  EmptyState,
  ListControls,
  Section,
  Status,
  usePagedList,
} from "../../components/Primitives";
import { studioCommand } from "../../data/bookingCommands";
import { coachPageSize, shouldShowPagination } from "../../data/pagination";
import { getSignedMaterialUrl } from "../../data/repository";
import { mapMaterialLibraryRow } from "../../data/studioMappers";
import type { StudioSnapshot } from "../../domain/model";
import { materialDisplayKind } from "../../domain/presentation";
import { usePaginatedStudioRows } from "../../hooks/usePaginatedStudioRows";
import {
  invalidateStudioDomains,
  queryLayerV2Enabled,
} from "../../hooks/useStudio";
import { useStudioStore } from "../../state/StudioStore";

import { studentName } from "./StudioOperations.shared";

function useMaterialRoleCount(role: string, enabled: boolean) {
  return usePaginatedStudioRows(
    {
      domain: "work",
      table: "material_library_rows",
      page: 1,
      pageSize: 1,
      filters: { link_role: role },
      sort: { column: "title", ascending: true },
    },
    enabled,
  );
}

export function MaterialsView({
  data,
  isDemo,
}: {
  data: StudioSnapshot;
  isDemo: boolean;
}) {
  const navigate = useNavigate(),
    store = useStudioStore(),
    queryClient = useQueryClient(),
    [notice, setNotice] = useState(""),
    [deleting, setDeleting] = useState(""),
    [query, setQuery] = useState(""),
    [role, setRole] = useState<
      | "all"
      | "current_script"
      | "lesson_material"
      | "library"
      | "actor_material"
    >("all"),
    [status, setStatus] = useState<
      "all" | "active" | "archived" | "vaulted" | "pending_review"
    >("all");
  const [serverPage, setServerPage] = useState(1);
  const [serverPageSize, setServerPageSize] = useState(coachPageSize);
  const serverPaging = queryLayerV2Enabled && !isDemo;
  const remoteMaterials = usePaginatedStudioRows(
    {
      domain: "work",
      table: "material_library_rows",
      page: serverPage,
      pageSize: serverPageSize,
      search: query.trim()
        ? {
            columns: [
              "title",
              "category",
              "caption",
              "student_name",
              "lesson_topic",
            ],
            value: query,
          }
        : undefined,
      filters: {
        link_role: role === "all" ? undefined : role,
        status:
          status === "all" || status === "pending_review" ? undefined : status,
        approval_status:
          status === "pending_review" ? "pending_review" : undefined,
      },
      sort: { column: "title", ascending: true },
    },
    serverPaging,
  );
  const currentScriptCount = useMaterialRoleCount(
    "current_script",
    serverPaging,
  );
  const lessonMaterialCount = useMaterialRoleCount(
    "lesson_material",
    serverPaging,
  );
  const libraryCount = useMaterialRoleCount("library", serverPaging);
  const actorMaterialCount = useMaterialRoleCount(
    "actor_material",
    serverPaging,
  );
  const remoteRoleCounts = {
    current_script: currentScriptCount.data?.total ?? 0,
    lesson_material: lessonMaterialCount.data?.total ?? 0,
    library: libraryCount.data?.total ?? 0,
    actor_material: actorMaterialCount.data?.total ?? 0,
  };
  useEffect(() => setServerPage(1), [query, role, status]);
  const roleOptions = [
    {
      value: "current_script" as const,
      label: "Current scripts",
      detail: "The scripts students are actively preparing",
      icon: Clapperboard,
    },
    {
      value: "lesson_material" as const,
      label: "Lesson resources",
      detail: "Files attached to a specific lesson",
      icon: BookOpen,
    },
    {
      value: "library" as const,
      label: "Shared library",
      detail: "Reusable resources that are not lesson-specific",
      icon: LibraryBig,
    },
    {
      value: "actor_material" as const,
      label: "Actor-page media",
      detail: "Headshots, reels, resumes, and profile files",
      icon: Images,
    },
  ];
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const remoteMaterialRows = (remoteMaterials.data?.items ?? []).map((row) =>
    mapMaterialLibraryRow(row),
  );
  const materials = serverPaging ? remoteMaterialRows : data.materials;
  const filtered = materials
    .filter((item) => role === "all" || item.role === role)
    .filter((item) => {
      if (status === "all") return true;
      if (status === "pending_review")
        return item.approvalStatus === "pending_review";
      return item.status === status;
    })
    .filter((item) => {
      if (!normalizedQuery) return true;
      const student = studentName(data, item.studentId);
      const lesson = item.lessonId
        ? data.lessons.find((row) => row.id === item.lessonId)
        : undefined;
      return [
        item.title,
        item.category,
        item.caption,
        student,
        lesson?.topic,
      ].some((value) => value?.toLocaleLowerCase().includes(normalizedQuery));
    })
    .sort((a, b) => {
      const reviewOrder =
        Number(b.approvalStatus === "pending_review") -
        Number(a.approvalStatus === "pending_review");
      if (reviewOrder) return reviewOrder;
      const activeOrder =
        Number(b.status === "active") - Number(a.status === "active");
      return activeOrder || a.title.localeCompare(b.title);
    });
  const localMaterialPage = usePagedList(filtered, coachPageSize);
  const paged = serverPaging
    ? {
        visible: remoteMaterialRows,
        page: serverPage,
        setPage: setServerPage,
        pageSize: serverPageSize,
        setPageSize: setServerPageSize,
        pageCount: Math.max(
          1,
          Math.ceil((remoteMaterials.data?.total ?? 0) / serverPageSize),
        ),
        total: remoteMaterials.data?.total ?? 0,
      }
    : localMaterialPage;
  const archive = async (id: string) => {
    const current = materials.find((item) => item.id === id)!;
    try {
      if (isDemo)
        store.transact((draft) => {
          const item = draft.materials.find((i) => i.id === id)!;
          item.status = item.status === "active" ? "archived" : "active";
          item.version += 1;
        });
      else {
        await studioCommand("materials", {
          command: "update_status",
          entityId: id,
          expectedVersion: current.version,
          payload: {
            status: current.status === "active" ? "archived" : "active",
          },
          reason: "Coach updated material status",
        });
        await invalidateStudioDomains(queryClient, ["work"]);
      }
      setNotice("Material status updated.");
    } catch (reason) {
      setNotice(
        reason instanceof Error
          ? reason.message
          : "Material could not be updated.",
      );
    }
  };
  const review = async (
    id: string,
    status: "approved" | "changes_requested",
  ) => {
    const current = materials.find((item) => item.id === id)!;
    try {
      if (isDemo)
        store.transact((draft) => {
          const item = draft.materials.find((row) => row.id === id)!;
          item.approvalStatus = status;
          item.publicEmbed = status === "approved";
          item.version += 1;
        });
      else {
        await studioCommand("materials", {
          command: "approve",
          entityId: id,
          expectedVersion: current.version,
          payload: { status, publicEmbed: status === "approved" },
          reason: `Coach ${status} actor material`,
        });
        await invalidateStudioDomains(queryClient, ["work"]);
      }
      setNotice(`Material ${status.replaceAll("_", " ")}.`);
    } catch (reason) {
      setNotice(
        reason instanceof Error ? reason.message : "Material review failed.",
      );
    }
  };
  const remove = async (id: string) => {
    const current = materials.find((item) => item.id === id);
    if (
      !current ||
      deleting ||
      !window.confirm(
        `Permanently delete “${current.title}”? The uploaded file will also be removed and this cannot be undone.`,
      )
    )
      return;
    setDeleting(id);
    try {
      if (isDemo)
        store.transact((draft) => {
          draft.materials = draft.materials.filter((item) => item.id !== id);
        });
      else {
        await studioCommand("materials", {
          command: "delete",
          entityId: id,
          expectedVersion: current.version,
          reason: "Coach permanently deleted material",
        });
        await invalidateStudioDomains(queryClient, ["work"]);
      }
      setNotice("Material and uploaded file deleted.");
    } catch (reason) {
      setNotice(
        reason instanceof Error
          ? reason.message
          : "Material could not be deleted.",
      );
    } finally {
      setDeleting("");
    }
  };
  const resetFilters = () => {
    setQuery("");
    setRole("all");
    setStatus("all");
  };
  return (
    <Section
      title="Material library"
      marked
      aside={
        <button type="button" onClick={() => navigate("/coach/students")}>
          <UserRound />
          Choose a student to add material
        </button>
      }
    >
      <p className="section-intro material-library-intro">
        Find active scripts, lesson attachments, reusable resources, and
        actor-page media without mixing their different jobs together.
      </p>
      {notice && (
        <p className="portal-notice" role="status">
          {notice}
        </p>
      )}
      <div className="material-bucket-grid" aria-label="Material categories">
        {roleOptions.map((option) => {
          const Icon = option.icon;
          const count = serverPaging
            ? remoteRoleCounts[option.value]
            : data.materials.filter((item) => item.role === option.value)
                .length;
          return (
            <button
              type="button"
              key={option.value}
              className={role === option.value ? "selected" : ""}
              aria-pressed={role === option.value}
              onClick={() =>
                setRole(role === option.value ? "all" : option.value)
              }
            >
              <Icon />
              <span>
                <strong>{option.label}</strong>
                <small>{option.detail}</small>
              </span>
              <b>{count}</b>
            </button>
          );
        })}
      </div>
      <div className="library-toolbar material-library-toolbar">
        <label>
          <Search />
          <input
            type="search"
            aria-label="Search materials"
            value={query}
            placeholder="Search title, student, lesson, or category"
            onChange={(event) => {
              setQuery(event.target.value);
              paged.setPage(1);
            }}
          />
        </label>
        <select
          aria-label="Material category"
          value={role}
          onChange={(event) => {
            setRole(event.target.value as typeof role);
            paged.setPage(1);
          }}
        >
          <option value="all">All material types</option>
          {roleOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <select
          aria-label="Material status"
          value={status}
          onChange={(event) => {
            setStatus(event.target.value as typeof status);
            paged.setPage(1);
          }}
        >
          <option value="all">Any status</option>
          <option value="active">Active</option>
          <option value="pending_review">Needs review</option>
          <option value="archived">Archived</option>
          <option value="vaulted">Vaulted</option>
        </select>
      </div>
      {shouldShowPagination(paged.total, paged.pageSize) && (
        <ListControls
          page={paged.page}
          pageCount={paged.pageCount}
          pageSize={paged.pageSize}
          total={paged.total}
          onPage={paged.setPage}
          onPageSize={paged.setPageSize}
          label="materials"
        />
      )}
      <div className="material-library-list">
        {paged.visible.map((item) => {
          const lesson = item.lessonId
            ? data.lessons.find((row) => row.id === item.lessonId)
            : undefined;
          const roleOption = roleOptions.find(
            (option) => option.value === item.role,
          );
          const displayLabel = materialDisplayKind(item);
          const Icon = roleOption?.icon || FolderOpen;
          return (
            <article key={item.id}>
              <span className="material-kind-icon" aria-hidden="true">
                <Icon />
              </span>
              <div className="material-library-copy">
                <strong>{item.title}</strong>
                <small>
                  {studentName(data, item.studentId)} · {displayLabel}
                  {item.role !== "actor_material" && item.category
                    ? ` · ${item.category}`
                    : ""}
                  {lesson ? ` · ${lesson.topic}` : ""}
                </small>
                {item.caption && <p>{item.caption}</p>}
              </div>
              <div className="material-library-state">
                {item.approvalStatus === "pending_review" && (
                  <Status tone="warn">Needs review</Status>
                )}
                <Status tone={item.status === "active" ? "good" : "neutral"}>
                  {item.status}
                </Status>
              </div>
              <div className="material-primary-actions">
                {item.externalUrl && (
                  <a
                    className="button-link"
                    href={item.externalUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <ExternalLink />
                    Open
                  </a>
                )}
                {!item.externalUrl && item.storagePath && (
                  <button
                    type="button"
                    className="button-link"
                    onClick={() => {
                      void getSignedMaterialUrl(item.storagePath!).then(
                        (url) =>
                          window.open(url, "_blank", "noopener,noreferrer"),
                        (reason) =>
                          setNotice(
                            reason instanceof Error
                              ? reason.message
                              : "The material could not be opened.",
                          ),
                      );
                    }}
                  >
                    <ExternalLink />
                    Open
                  </button>
                )}
                {item.approvalStatus === "pending_review" && (
                  <button
                    type="button"
                    className="material-approve"
                    onClick={() => void review(item.id, "approved")}
                  >
                    Approve
                  </button>
                )}
                <details className="material-action-menu">
                  <summary aria-label={`More actions for ${item.title}`}>
                    <MoreHorizontal />
                    <span>Actions</span>
                  </summary>
                  <div>
                    <button
                      type="button"
                      onClick={() =>
                        navigate(
                          `/coach/students/${item.studentId}/${item.role === "actor_material" ? "actor-page" : "work"}`,
                        )
                      }
                    >
                      Open student workspace
                    </button>
                    {item.approvalStatus === "pending_review" && (
                      <button
                        type="button"
                        onClick={() =>
                          void review(item.id, "changes_requested")
                        }
                      >
                        Request changes
                      </button>
                    )}
                    <button type="button" onClick={() => void archive(item.id)}>
                      {item.status === "active" ? "Archive" : "Restore"}
                    </button>
                    <button
                      type="button"
                      className="danger-button"
                      disabled={deleting === item.id}
                      onClick={() => void remove(item.id)}
                    >
                      <Trash2 />
                      {deleting === item.id
                        ? "Deleting…"
                        : "Delete permanently"}
                    </button>
                  </div>
                </details>
              </div>
            </article>
          );
        })}
        {!paged.total && (
          <EmptyState
            title={
              materials.length
                ? "No materials match these filters"
                : "No materials yet"
            }
            detail={
              materials.length
                ? "Clear the filters or choose another material category."
                : "Choose a student above, then add a script, lesson resource, library file, or actor-page asset."
            }
          />
        )}
        {!paged.total && materials.length > 0 && (
          <button
            type="button"
            className="text-button material-filter-reset"
            onClick={resetFilters}
          >
            Clear all filters
          </button>
        )}
      </div>
    </Section>
  );
}
