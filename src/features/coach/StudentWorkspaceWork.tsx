import { CheckSquare, FolderOpen, Plus, Trash2 } from "lucide-react";
import { EmptyState, Section, Status } from "../../components/Primitives";
import type { Material, Student } from "../../domain/model";
import { formatStudioDate } from "../../domain/presentation";

import { type Data } from "./StudentWorkspace.shared";

export function Work({
  data,
  student,
  onAddAssignment,
  onAddMaterial,
  onArchiveMaterial,
  onDeleteMaterial,
}: {
  data: Data;
  student: Student;
  onAddAssignment: () => void;
  onAddMaterial: () => void;
  onArchiveMaterial: (material: Material) => void;
  onDeleteMaterial: (material: Material) => void;
}) {
  const assignments = data.assignments.filter(
      (i) => i.studentId === student.id,
    ),
    materials = data.materials.filter(
      (i) => i.studentId === student.id && i.role !== "actor_material",
    );
  return (
    <div className="two-section-grid">
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
            <article key={item.id}>
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
    </div>
  );
}
