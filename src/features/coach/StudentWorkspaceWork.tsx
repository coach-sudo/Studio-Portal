import { ScriptWorkspace } from "../../components/ScriptWorkspace";
import { WorkViews } from "../../components/WorkViews";
import { useWorkView } from "../../hooks/useWorkView";
import { Notes } from "./StudentWorkspaceNotes";
import { useSearchParams } from "react-router-dom";
import { useEffect } from "react";
import { CheckSquare, Plus } from "lucide-react";
import { EmptyState, Section, Status } from "../../components/Primitives";
import type { Note, Student } from "../../domain/model";
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
import { AssignmentAttachments } from "../../components/AssignmentAttachments";

export function Work({
  data,
  student,
  isDemo,
  onAddAssignment,
  onAddNote,
  onEditNote,
  onDeleteNote,
}: {
  data: Data;
  student: Student;
  isDemo: boolean;
  onAddAssignment: () => void;
  onAddNote: () => void;
  onEditNote: (note: Note) => void;
  onDeleteNote: (note: Note) => void;
}) {
  const [params, setParams] = useSearchParams();
  const view = useWorkView();
  useEffect(() => {
    const target = params.get("practice");
    if (target)
      document
        .getElementById(`practice-${target}`)
        ?.scrollIntoView({ block: "center" });
  }, [params]);
  const helpOnly = params.get("help") === "1";
  const assignments = data.assignments.filter(
    (i) =>
      i.studentId === student.id &&
      (!helpOnly || (i.helpRequested && i.status !== "completed")),
  );
  return (
    <div className="resource-workspace">
      <WorkViews />
      {view === "notes" && (
        <Notes
          data={data}
          student={student}
          onAdd={onAddNote}
          onEdit={onEditNote}
          onDelete={onDeleteNote}
        />
      )}
      {view === "scripts" && (
        <ScriptWorkspace data={data} studentId={student.id} isDemo={isDemo} />
      )}
      {view === "homework" && (
        <Section
          title={helpOnly ? "Practice help requests" : "Homework"}
          aside={
            <button onClick={onAddAssignment}>
              <Plus />
              Assign homework
            </button>
          }
        >
          {helpOnly && (
            <button
              onClick={() =>
                setParams((current) => {
                  const next = new URLSearchParams(current);
                  next.delete("help");
                  return next;
                })
              }
            >
              Show all practice
            </button>
          )}
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
                  {!isDemo && item.status === "completed" && (
                    <AssignmentAttachments
                      scope={{
                        assignmentId: item.id,
                        studentId: item.studentId,
                        studioId: data.studioId,
                      }}
                    />
                  )}
                </div>
                <Status tone={item.status === "completed" ? "good" : "neutral"}>
                  {item.status.replaceAll("_", " ")}
                </Status>
              </article>
            ))}
            {!assignments.length && (
              <EmptyState
                title={
                  helpOnly ? "No pending help requests" : "No practice assigned"
                }
                detail={
                  helpOnly
                    ? "Practice with a help request will appear here."
                    : "Add one focused next step."
                }
              />
            )}
          </div>
        </Section>
      )}
    </div>
  );
}

export function StudentMaterials({
  data,
  isDemo,
  student,
}: {
  data: Data;
  isDemo: boolean;
  student: Student;
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
      <ResourceBrowser
        data={data}
        isDemo={isDemo}
        studentId={student.id}
        catalog={false}
        excludeScripts
        title="Student materials"
      />
    </div>
  );
}
