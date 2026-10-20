import { useUrlNumber } from "../../hooks/useWorkspaceLocation";
import { Link } from "react-router-dom";
import { useState } from "react";
import { usePaginatedStudioRows } from "../../hooks/usePaginatedStudioRows";
import { mapMaterialLibraryRow } from "../../data/studioMappers";
import { recordLink } from "../../app/recordLinks";
import { FileText } from "lucide-react";
import "../../components/IdentityActions.css";
import {
  EmptyState,
  ListControls,
  Section,
  Status,
} from "../../components/Primitives";
import { formatStudioDate } from "../../domain/presentation";

import { type Snapshot } from "./StudentPortal.shared";

import { Materials, Practice } from "./StudentPortalWorkContent";
import { PublishedFeedback } from "../../components/CoachingContinuity";
import { coachingContext } from "../../domain/coachingContext";

export function Work({ data, isDemo }: { data: Snapshot; isDemo: boolean }) {
  const [archivePage, setArchivePage] = useUrlNumber("archivePage", 1),
    [archiveSize, setArchiveSize] = useUrlNumber("archiveSize", 10, 100);
  const [showArchive, setShowArchive] = useState(archivePage > 1);
  const history = usePaginatedStudioRows(
    {
      domain: "work",
      table: "material_library_rows",
      page: archivePage,
      pageSize: archiveSize,
      filters: {
        link_student_id: data.students[0].id,
        link_role: "current_script",
        status: "archived",
      },
      sort: { column: "updated_at", ascending: false },
    },
    !isDemo && showArchive,
  );
  const work = coachingContext(data, data.students[0].id)!.scripts,
    localArchive = data.materials
      .filter(
        (item) =>
          item.studentId === data.students[0].id &&
          item.role === "current_script" &&
          item.status === "archived",
      )
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const archived = isDemo
    ? localArchive.slice(
        (archivePage - 1) * archiveSize,
        archivePage * archiveSize,
      )
    : (history.data?.items || []).map(mapMaterialLibraryRow);
  const total = isDemo ? localArchive.length : history.data?.total || 0;
  const viewerPreferences =
    data.role === "guardian"
      ? data.linkedContacts.find((c) => c.id === data.currentLinkedContactId)
          ?.portalPreferences
      : data.students[0]?.portalPreferences;
  const practice = data.assignments.filter(
      (a) => a.studentId === data.students[0]?.id,
    ),
    completed = practice.filter((a) => a.status === "completed").length;
  return (
    <div className="student-page">
      <header className="student-header">
        <h1>My Work</h1>
      </header>
      <Section title="Active script" marked>
        {(viewerPreferences?.showProgress ??
          data.settings.portalDefaults.showProgress) && (
          <div className="portal-practice-progress">
            <label>
              Practice progress{" "}
              <progress value={completed} max={Math.max(1, practice.length)} />
            </label>
            <p>
              {completed} of {practice.length} current practice assignments
              completed
            </p>
          </div>
        )}
        <div className="table-list">
          {work.map((item) => (
            <article key={item.id} className="current-script-card">
              <header>
                <FileText />
                <div>
                  <strong>{item.title}</strong>
                  <small>{item.category}</small>
                </div>
                <Status tone="good">current</Status>
              </header>
              <Link
                className="button-link"
                to={recordLink(data.role, {
                  kind: "resource",
                  id: item.resourceId || item.id,
                  studentId: item.studentId,
                })}
              >
                Open resource
              </Link>
            </article>
          ))}
          {!work.length && (
            <EmptyState
              title="No current script"
              detail="Your coach will place the active material here."
            />
          )}
        </div>
      </Section>
      <Practice data={data} isDemo={isDemo} compact />
      <Materials data={data} isDemo={isDemo} embedded />
      <PublishedFeedback
        data={data}
        isDemo={isDemo}
        studentId={data.students[0].id}
      />
      <details
        className="coaching-history"
        open={showArchive}
        onToggle={(event) => setShowArchive(event.currentTarget.open)}
      >
        <summary>Completed &amp; archived scripts</summary>
        <Section title="Script archive">
          <ListControls
            page={archivePage}
            pageCount={Math.max(1, Math.ceil(total / archiveSize))}
            pageSize={archiveSize}
            total={total}
            onPage={setArchivePage}
            onPageSize={setArchiveSize}
            label="archived scripts"
          />
          <div className="table-list">
            {archived.map((item) => (
              <article key={item.id}>
                <FileText />
                <div>
                  <strong>{item.title}</strong>
                  <small>
                    {item.category} · archived{" "}
                    {formatStudioDate(item.updatedAt, data.settings.timezone)}
                  </small>
                </div>
                <Link
                  to={recordLink(data.role, {
                    kind: "resource",
                    id: item.resourceId || item.id,
                    studentId: item.studentId,
                  })}
                >
                  Open resource
                </Link>
              </article>
            ))}
            {history.isError && !isDemo && (
              <p role="alert">
                Script history unavailable.{" "}
                <button onClick={() => void history.refetch()}>
                  Retry history
                </button>
              </p>
            )}
            {!archived.length && !history.isError && (
              <EmptyState
                title={
                  !isDemo && history.isPending
                    ? "Loading script history…"
                    : "No archived scripts"
                }
                detail="When a new current script is uploaded, the previous one moves here automatically."
              />
            )}
          </div>
        </Section>
      </details>
    </div>
  );
}
