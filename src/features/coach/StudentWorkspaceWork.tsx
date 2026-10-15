import { useSearchParams } from "react-router-dom";
import { useEffect } from "react";
import { CheckSquare, FolderOpen, Plus, Trash2 } from "lucide-react";
import { EmptyState, Section, Status } from "../../components/Primitives";
import type { Material, Student } from "../../domain/model";
import { formatStudioDate } from "../../domain/presentation";

import { type Data } from "./StudentWorkspace.shared";
import {
  ResourceBrowser,
  ResourceDetailView,
} from "../library/ResourceBrowser";
import { useQuery } from "@tanstack/react-query";
import { loadWorkspaceResource } from "../../data/studentWorkspace";
import { usePrivateIdentity } from "../../hooks/usePrivateIdentity";
import { Dialog } from "../../components/Primitives";

export function Work({
  data,
  student,
  isDemo,
  onAddAssignment,
  onAddMaterial,
  onArchiveMaterial,
  onDeleteMaterial,
}: {
  data: Data;
  student: Student;
  isDemo: boolean;
  onAddAssignment: () => void;
  onAddMaterial: () => void;
  onArchiveMaterial: (material: Material) => void;
  onDeleteMaterial: (material: Material) => void;
}) {
  const [params, setParams] = useSearchParams();
  const identity = usePrivateIdentity();
  const resourceId = params.get("resource"),
    assignmentId = params.get("assignment");
  const exactResource = useQuery({
    queryKey: [
      "student-resource",
      identity,
      student.id,
      resourceId,
      assignmentId,
    ],
    enabled: !!identity && !isDemo && !!resourceId && !!assignmentId,
    queryFn: ({ signal }) =>
      loadWorkspaceResource(student.id, resourceId!, assignmentId!, signal),
  });
  useEffect(() => {
    const target = params.get("practice");
    if (target)
      document
        .getElementById(`practice-${target}`)
        ?.scrollIntoView({ block: "center" });
  }, [params]);
  const assignments = data.assignments.filter(
      (i) => i.studentId === student.id,
    ),
    materials = data.materials.filter(
      (i) => i.studentId === student.id && i.role !== "actor_material",
    );
  return (
    <div className="resource-workspace">
      {resourceId && assignmentId && !isDemo && (
        <Dialog
          title="Assigned resource"
          onClose={() =>
            setParams((current) => {
              const next = new URLSearchParams(current);
              next.delete("resource");
              next.delete("assignment");
              return next;
            })
          }
        >
          {exactResource.isError ? (
            <p role="alert">Resource unavailable in this student context.</p>
          ) : exactResource.data ? (
            <ResourceDetailView
              resource={exactResource.data}
              data={data}
              isDemo={false}
            />
          ) : (
            <p role="status">Loading resource…</p>
          )}
        </Dialog>
      )}
      <Section
        title="Practice"
        aside={
          <button onClick={onAddAssignment}>
            <Plus />
            Assign
          </button>
        }
      >
        <div className="table-list">
          {assignments.map((item) => (
            <article key={item.id} id={`practice-${item.id}`}>
              <CheckSquare />
              <div>
                <strong>{item.title}</strong>
                <small>
                  {item.details}
                  {item.dueAt
                    ? ` · due ${formatStudioDate(item.dueAt, data.settings.timezone)}`
                    : ""}
                </small>
              </div>
              <Status tone={item.status === "completed" ? "good" : "neutral"}>
                {item.status.replaceAll("_", " ")}
              </Status>
            </article>
          ))}
          {!assignments.length && (
            <EmptyState
              title="No practice assigned"
              detail="Add one focused next step."
            />
          )}
        </div>
      </Section>
      <ResourceBrowser
        data={data}
        isDemo={isDemo}
        studentId={student.id}
        catalog={false}
        title="Student materials"
      />
      <details className="disclosure-section">
        <summary>Current script tools</summary>
        <Section
          title="Scripts & lesson materials"
          aside={
            <button onClick={onAddMaterial}>
              <Plus />
              Add
            </button>
          }
        >
          <div className="table-list">
            {materials.map((item) => (
              <article key={item.id}>
                <FolderOpen />
                <div>
                  <strong>{item.title}</strong>
                  <small>
                    {item.category} · {item.role.replaceAll("_", " ")}
                  </small>
                </div>
                <Status tone={item.status === "active" ? "good" : "neutral"}>
                  {item.status}
                </Status>
                {item.externalUrl && (
                  <a href={item.externalUrl} target="_blank" rel="noreferrer">
                    Open
                  </a>
                )}
                <button type="button" onClick={() => onArchiveMaterial(item)}>
                  {item.status === "active" ? "Archive" : "Restore"}
                </button>
                <button
                  type="button"
                  className="danger-button"
                  onClick={() => onDeleteMaterial(item)}
                >
                  <Trash2 />
                  Delete
                </button>
              </article>
            ))}
            {!materials.length && (
              <EmptyState
                title="No materials yet"
                detail="Add a script, worksheet, or reference."
              />
            )}
          </div>
        </Section>
      </details>
    </div>
  );
}
