import { useQuery } from "@tanstack/react-query";
import {
  Navigate,
  useLocation,
  useParams,
  useSearchParams,
} from "react-router-dom";
import {
  demoRecord,
  isRecordKind,
  resolvedRecordLink,
  type RecordTarget,
} from "../app/recordLinks";
import type { Role, StudioSnapshot } from "../domain/model";
import { loadRecordTarget, useSearchIdentity } from "../data/globalSearch";
import { useStudioRoute } from "../hooks/useStudio";
import { useWorkspaceNavigation } from "../hooks/useWorkspaceLocation";
import { PageSkeleton } from "./Primitives";
import { ResourceDetailView } from "../features/library/ResourceBrowser";
import { getResourceWorkspace } from "../data/library";

export function RecordUnavailable({
  fallback = "/coach/today",
}: {
  fallback?: string;
}) {
  const { back } = useWorkspaceNavigation(fallback);
  return (
    <section className="workspace-unavailable" role="status">
      <h1>Record unavailable</h1>
      <p>It may have changed, or you may not have access.</p>
      <button onClick={back}>Back</button>
    </section>
  );
}
export function RecordRoute({
  audience: role = "coach",
  portalData,
}: {
  audience?: Role;
  portalData?: StudioSnapshot;
}) {
  const { kind = "", recordId = "" } = useParams(),
    [params] = useSearchParams(),
    location = useLocation();
  const identity = useSearchIdentity(),
    { data, isDemo } = useStudioRoute(
      role,
      params.get("student") || undefined,
      ["identity"],
    );
  const result = useQuery({
    queryKey: [
      "workspace-record",
      identity,
      role,
      params.get("student"),
      kind === "resource" ? params.get("assignment") : null,
      kind,
      recordId,
    ],
    queryFn: async ({ signal }) => {
      if (kind === "resource") {
        const opened = await getResourceWorkspace(
          recordId,
          params.get("student") || undefined,
          params.get("assignment") || undefined,
          signal,
        );
        return opened
          ? {
              kind: "resource" as const,
              id: recordId,
              studentId: params.get("student") || opened.assignment?.studentId,
              assignmentId: opened.assignment?.id,
              lessonId: opened.assignment?.lessonId,
            }
          : null;
      }
      return loadRecordTarget(
        kind,
        recordId,
        params.get("student") || undefined,
        signal,
      );
    },
    enabled: !isDemo && !!identity && isRecordKind(kind),
    retry: false,
    staleTime: 0,
  });
  const demoData = portalData || data;
  const target =
    isDemo && demoData ? demoRecord(demoData, kind, recordId) : result.data;
  if (!isRecordKind(kind) || result.isError || target === null)
    return (
      <RecordUnavailable
        fallback={role === "coach" ? "/coach/today" : "/portal"}
      />
    );
  if (!target) return <PageSkeleton label="Opening record…" />;
  if (target.kind === "resource" && demoData)
    return <ResourceRecord target={target} data={demoData} isDemo={isDemo} />;
  return (
    <Navigate
      replace
      to={resolvedRecordLink(role, target)}
      state={location.state}
    />
  );
}

function ResourceRecord({
  target,
  data,
  isDemo,
}: {
  target: RecordTarget;
  data: StudioSnapshot;
  isDemo: boolean;
}) {
  const [params] = useSearchParams();
  const studentId = params.get("student") || target.studentId || undefined;
  const assignmentId =
    params.get("assignment") || target.assignmentId || undefined;
  const identity = useSearchIdentity(),
    workspace = useWorkspaceNavigation(
      data.role === "coach" ? "/coach/materials" : "/portal/work",
    );
  const full = useQuery({
    queryKey: [
      "workspace-resource",
      identity,
      data.role,
      studentId,
      target.id,
      assignmentId,
    ],
    queryFn: ({ signal }) =>
      getResourceWorkspace(target.id, studentId, assignmentId, signal),
    enabled: !isDemo && !!identity,
    retry: false,
    gcTime: 0,
  });
  const original = data.materials.find(
    (m) => (m.resourceId || m.id) === target.id,
  );
  const detail = isDemo
    ? original && {
        id: target.id,
        title: original.title,
        description: original.caption || "",
        source: original.source || "",
        version: original.version,
      }
    : full.data?.resource;
  if (full.isError || (!detail && !full.isPending))
    return (
      <RecordUnavailable
        fallback={data.role === "coach" ? "/coach/materials" : "/portal/work"}
      />
    );
  if (!detail) return <PageSkeleton label="Opening resource…" />;
  return (
    <section className="page">
      <button className="workspace-return" onClick={workspace.back}>
        Back
      </button>
      <h1>{detail.title}</h1>
      <ResourceDetailView
        data={data}
        isDemo={isDemo}
        resource={{
          ...detail,
          inLibrary: true,
          visibility: "assigned",
          resourceStatus: "active",
          createdAt: "",
          options: [],
          ownerStudentId: studentId,
          assignmentId,
          lessonId: target.lessonId || undefined,
        }}
      />
    </section>
  );
}
