import { Section } from "../../components/Primitives";
import { ScriptWorkspace } from "../../components/ScriptWorkspace";
import { WorkViews } from "../../components/WorkViews";
import { useWorkView } from "../../hooks/useWorkView";
import { StudentNotes } from "./StudentPortalLessonHub";
import { type Snapshot } from "./StudentPortal.shared";
import { Practice } from "./StudentPortalWorkContent";

export function Work({ data, isDemo }: { data: Snapshot; isDemo: boolean }) {
  const view = useWorkView();
  const student = data.students[0];
  if (!student) return null;
  const preferences =
    data.role === "guardian"
      ? data.linkedContacts.find(
          (contact) => contact.id === data.currentLinkedContactId,
        )?.portalPreferences
      : student.portalPreferences;
  const practice = data.assignments.filter(
    (item) => item.studentId === student.id,
  );
  const completed = practice.filter(
    (item) => item.status === "completed",
  ).length;
  return (
    <div className="student-page">
      <header className="student-header">
        <h1>{data.role === "guardian" ? "Student Work" : "My Work"}</h1>
      </header>
      <WorkViews />
      {view === "notes" && <StudentNotes data={data} isDemo={isDemo} />}
      {view === "scripts" && (
        <ScriptWorkspace data={data} studentId={student.id} isDemo={isDemo} />
      )}
      {view === "homework" && (
        <>
          {(preferences?.showProgress ??
            data.settings.portalDefaults.showProgress) &&
            practice.length > 0 && (
              <Section title="Practice progress">
                <div className="portal-practice-progress">
                  <progress
                    aria-label="Practice progress"
                    value={completed}
                    max={practice.length}
                  />
                  <p>
                    {completed} of {practice.length} assignments completed
                  </p>
                </div>
              </Section>
            )}
          <Practice data={data} isDemo={isDemo} compact />
        </>
      )}
    </div>
  );
}
