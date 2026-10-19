import { useUrlNumber } from "../../hooks/useWorkspaceLocation";
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
              {item.externalUrl && (
                <details className="material-preview">
                  <summary>Read or view here</summary>
                  {item.mediaKind === "image" ? (
                    <img src={item.externalUrl} alt={item.title} />
                  ) : item.mediaKind === "video" ? (
                    <video src={item.externalUrl} controls />
                  ) : item.mediaKind === "audio" ? (
                    <audio src={item.externalUrl} controls />
                  ) : (
                    <object data={item.externalUrl} title={item.title}>
                      <p>This file cannot be previewed in this browser.</p>
                    </object>
                  )}
                  <a
                    className="button-link"
                    href={item.externalUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Open full size
                  </a>
                </details>
              )}
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
                {item.externalUrl && (
                  <a href={item.externalUrl} target="_blank" rel="noreferrer">
                    Open
                  </a>
                )}
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
