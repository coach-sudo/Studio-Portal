import { useUrlNumber } from "../../hooks/useWorkspaceLocation";
import { Link } from "react-router-dom";
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

export function Work({ data, isDemo }: { data: Snapshot; isDemo: boolean }) {
  const [archivePage, setArchivePage] = useUrlNumber("archivePage", 1),
    [archiveSize, setArchiveSize] = useUrlNumber("archiveSize", 10, 100);
  const work = data.materials.filter(
      (item) => item.role === "current_script" && item.status === "active",
    ),
    archived = data.materials
      .filter(
        (item) => item.role === "current_script" && item.status === "archived",
      )
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return (
    <div className="student-page">
      <header className="student-header">
        <h1>My Work</h1>
      </header>
      <Section title="Active script" marked>
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
      <Section title="Script archive">
        <ListControls
          page={archivePage}
          pageCount={Math.max(1, Math.ceil(archived.length / archiveSize))}
          pageSize={archiveSize}
          total={archived.length}
          onPage={setArchivePage}
          onPageSize={setArchiveSize}
          label="archived scripts"
        />
        <div className="table-list">
          {archived
            .slice((archivePage - 1) * archiveSize, archivePage * archiveSize)
            .map((item) => (
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
          {!archived.length && (
            <EmptyState
              title="No archived scripts"
              detail="When a new current script is uploaded, the previous one moves here automatically."
            />
          )}
        </div>
      </Section>
    </div>
  );
}
