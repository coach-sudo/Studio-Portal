import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import type {
  MetadataKind,
  ResourceDetail,
  ResourceOption,
  ResourcePage,
  ResourceSearch,
} from "../domain/library";
import type { Material, StudioSnapshot } from "../domain/model";
import { studioCommand } from "./bookingCommands";

export async function loadMaterialActivity(
  studioId: string,
  studentId?: string,
  signal?: AbortSignal,
): Promise<Material[]> {
  if (!supabase) throw new Error("Database configuration is unavailable.");
  let request = supabase
    .from("material_links")
    .select(
      "id,student_id,lesson_id,role,status,version,updated_at,materials!inner(id,title,category,owner_student_id,in_library,approval_status,version,updated_at,studio_id)",
    )
    .eq("materials.studio_id", studioId)
    .in("role", ["library", "lesson_material"])
    .gte("updated_at", new Date(Date.now() - 30 * 86400000).toISOString())
    .order("updated_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(25);
  if (studentId) request = request.eq("student_id", studentId);
  const { data, error } = await (signal
    ? request.abortSignal(signal)
    : request);
  if (error) throw new Error(error.message);
  return (data || []).map((row) => ({
    id:
      row.materials.owner_student_id && !row.materials.in_library
        ? row.materials.id
        : row.id,
    studentId: row.student_id || row.materials.owner_student_id || "",
    lessonId: row.lesson_id || undefined,
    role: row.role as Material["role"],
    title: row.materials.title,
    category: row.materials.category,
    status: row.status,
    approvalStatus: row.materials.approval_status,
    version: row.version + row.materials.version - 1,
    updatedAt: new Date(
      Math.max(
        Date.parse(row.updated_at),
        Date.parse(row.materials.updated_at),
      ),
    ).toISOString(),
  }));
}

export function useMaterialActivity(
  studioId: string,
  studentId: string | undefined,
  enabled: boolean,
) {
  return useQuery({
    queryKey: ["material-resources", "activity", studioId, studentId || null],
    queryFn: ({ signal }) => loadMaterialActivity(studioId, studentId, signal),
    enabled: enabled && !!supabase && !!studioId,
    staleTime: 30000,
  });
}

export function useDebouncedValue<T>(value: T, delay = 300) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}
async function rpc<T>(
  name: string,
  args: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<T> {
  if (!supabase) throw new Error("Database configuration is unavailable.");
  const request = supabase.rpc(name as never, args as never);
  const { data, error } = await (signal
    ? request.abortSignal(signal)
    : request);
  if (error) throw new Error(error.message);
  return data as T;
}
export function loadResourcePage(
  request: ResourceSearch,
  page: number,
  signal?: AbortSignal,
) {
  return rpc<ResourcePage>(
    "search_material_resources",
    {
      p_studio_id: request.studioId,
      p_student_id: request.studentId || null,
      p_catalog: request.catalog,
      p_search: request.search,
      p_filters: {
        ...request.filters,
        visibility:
          request.visibility && request.visibility !== "all"
            ? [request.visibility]
            : [],
      },
      p_status: request.status,
      p_pinned: request.pinned,
      p_sort: request.sort,
      p_page: page,
      p_limit: 25,
      p_lesson_id: request.lessonId || null,
    },
    signal,
  );
}
export function demoResourcePage(
  data: StudioSnapshot,
  request: ResourceSearch,
  page: number,
): ResourcePage {
  const seen = new Set<string>();
  const items = data.materials
    .filter((m) => m.role !== "actor_material")
    .filter((m) =>
      request.catalog ? m.inLibrary : m.studentId === request.studentId,
    )
    .filter(
      (m) =>
        !request.catalog ||
        data.role === "coach" ||
        m.catalogVisibility === "studio",
    )
    .filter((m) => !request.lessonId || m.lessonId === request.lessonId)
    .filter(
      (m) =>
        !request.visibility ||
        request.visibility === "all" ||
        (m.catalogVisibility || "assigned") === request.visibility,
    )
    .filter(
      (m) =>
        !m.noteId ||
        data.role === "coach" ||
        data.notes.some((n) => n.id === m.noteId && n.status === "published"),
    )
    .filter((m) => request.status === "all" || m.status === request.status)
    .filter((m) => !request.pinned || m.pinned)
    .filter((m) =>
      [
        m.title,
        m.caption,
        m.category,
        ...(m.keywords || []),
        ...(m.resourceOptions || []).map((o) => o.name),
      ]
        .join(" ")
        .toLowerCase()
        .includes(request.search.toLowerCase()),
    )
    .filter((m) =>
      Object.entries(request.filters).every(
        ([kind, ids]) =>
          !ids?.length ||
          m.resourceOptions?.some((o) => o.kind === kind && ids.includes(o.id)),
      ),
    )
    .flatMap((m) => {
      const id = m.resourceId || m.id;
      if (request.catalog && seen.has(id)) return [];
      seen.add(id);
      return [
        {
          id,
          title: m.title,
          description: m.caption || "",
          source: m.source || "",
          inLibrary: !!m.inLibrary,
          visibility: m.catalogVisibility || ("assigned" as const),
          ownerStudentId: m.studentId,
          version: m.version,
          resourceStatus: m.status,
          createdAt: m.updatedAt,
          options: m.resourceOptions || [],
          mediaKind: m.mediaKind,
          assignmentId: request.catalog ? undefined : m.id,
          assignmentVersion: m.version,
          status: m.status,
          pinned: m.pinned,
          instructions: m.instructions,
          hasInstructions: !!m.instructions,
          lessonId: m.lessonId,
          noteId: m.noteId,
          assignedAt: m.updatedAt,
        },
      ];
    })
    .sort((a, b) =>
      request.sort === "date"
        ? b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id)
        : request.sort === "pinned" && !!a.pinned !== !!b.pinned
          ? Number(!!b.pinned) - Number(!!a.pinned)
          : a.title.localeCompare(b.title) || a.id.localeCompare(b.id),
    );
  return {
    items: items.slice((page - 1) * 25, page * 25),
    total: items.length,
    page,
    pageSize: 25,
  };
}
export function useResourceSearch(
  request: ResourceSearch,
  data: StudioSnapshot,
  isDemo: boolean,
) {
  const search = useDebouncedValue(request.search);
  const current = { ...request, search };
  return useInfiniteQuery({
    queryKey: ["material-resources", current, isDemo ? data.materials : null],
    initialPageParam: 1,
    queryFn: ({ pageParam, signal }) =>
      isDemo
        ? Promise.resolve(demoResourcePage(data, current, pageParam))
        : loadResourcePage(current, pageParam, signal),
    getNextPageParam: (last) =>
      last.page * last.pageSize < last.total ? last.page + 1 : undefined,
    staleTime: 30_000,
  });
}
export function useResourceOptions(
  studioId: string,
  kind: MetadataKind,
  search: string,
  page = 1,
  includeArchived = false,
  enabled = true,
) {
  const query = useDebouncedValue(search);
  return useQuery({
    queryKey: [
      "material-options",
      studioId,
      kind,
      query,
      page,
      includeArchived,
    ],
    queryFn: ({ signal }) =>
      rpc<{ items: ResourceOption[]; hasMore: boolean }>(
        "search_material_options",
        {
          p_studio_id: studioId,
          p_kind: kind,
          p_search: query,
          p_page: page,
          p_include_archived: includeArchived,
        },
        signal,
      ),
    enabled: !!supabase && enabled,
    staleTime: 30_000,
  });
}
export function getResourceDetail(id: string, signal?: AbortSignal) {
  return rpc<ResourceDetail | null>(
    "get_material_resource",
    { p_id: id },
    signal,
  );
}
export async function resourceCommand(
  command: string,
  payload: Record<string, unknown>,
  expectedVersion = 0,
) {
  const result = await studioCommand("materials", {
    command,
    payload,
    expectedVersion,
    reason: "Manage library resources",
  });
  return result.resource as { id: string; assignments?: unknown };
}
export function getAssignment(id: string, signal?: AbortSignal) {
  return rpc<{
    id: string;
    instructions: string;
    coachNotes: string | null;
    version: number;
  } | null>("get_material_assignment", { p_id: id }, signal);
}
export function loadCollections(
  studioId: string,
  search: string,
  page: number,
  signal?: AbortSignal,
) {
  return rpc<{
    items: import("../domain/library").ResourceCollection[];
    total: number;
    page: number;
    pageSize: number;
  }>(
    "search_material_collections",
    {
      p_studio_id: studioId,
      p_search: search,
      p_page: page,
      p_include_archived: true,
    },
    signal,
  );
}
export function getCollection(id: string, signal?: AbortSignal) {
  return rpc<{
    id: string;
    title: string;
    description: string;
    version: number;
    resources: { id: string; title: string }[];
  }>("get_material_collection", { p_id: id }, signal);
}
