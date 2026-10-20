import { Link } from "react-router-dom";
import { Section, EmptyState } from "./Primitives";
import { recordLink } from "../app/recordLinks";
import { useResourceSearch } from "../data/library";
import { mapNoteRow } from "../data/studioMappers";
import type { StudioSnapshot } from "../domain/model";
import { coachingContext, portalContextLink } from "../domain/coachingContext";
import { formatStudioDate } from "../domain/presentation";
import { usePaginatedStudioRows } from "../hooks/usePaginatedStudioRows";

export function PublishedFeedback({
  data,
  isDemo,
  studentId,
  lessonId,
}: {
  data: StudioSnapshot;
  isDemo: boolean;
  studentId: string;
  lessonId?: string;
}) {
  const remote = usePaginatedStudioRows(
    {
      domain: "work",
      table: "notes",
      page: 1,
      pageSize: 3,
      filters: {
        student_id: studentId,
        status: "published",
        ...(lessonId ? { lesson_id: lessonId } : {}),
      },
      sort: { column: "updated_at", ascending: false },
    },
    !isDemo && !!studentId,
  );
  const notes = (
    isDemo
      ? coachingContext(data, studentId)?.feedback || []
      : (remote.data?.items || []).map(mapNoteRow)
  )
    .filter(
      (note) =>
        note.studentId === studentId &&
        note.status === "published" &&
        (!lessonId || note.lessonId === lessonId),
    )
    .slice(0, 3);
  return (
    <Section title="Published feedback">
      <div className="table-list">
        {notes.map((note) => (
          <article key={note.id}>
            <div>
              <strong>{note.title}</strong>
              <small>
                {formatStudioDate(note.updatedAt, data.settings.timezone)}
              </small>
            </div>
            <Link
              className="button-link"
              to={recordLink(data.role, {
                kind: "note",
                id: note.id,
                studentId,
              })}
            >
              Read feedback
            </Link>
          </article>
        ))}
        {!notes.length && (
          <EmptyState
            title={
              remote.isError
                ? "Feedback unavailable"
                : remote.isPending && !isDemo
                  ? "Loading feedback…"
                  : "No published feedback yet"
            }
            detail={
              remote.isError
                ? "Try again to refresh this section."
                : "Shared coaching feedback appears here."
            }
          />
        )}
        {remote.isError && (
          <button onClick={() => void remote.refetch()}>Retry feedback</button>
        )}
      </div>
    </Section>
  );
}

export function AssignedWorkSummary({
  data,
  isDemo,
  studentId,
}: {
  data: StudioSnapshot;
  isDemo: boolean;
  studentId: string;
}) {
  const query = useResourceSearch(
    {
      studioId: data.studioId,
      studentId,
      catalog: false,
      search: "",
      filters: {},
      status: "active",
      pinned: false,
      sort: "date",
      excludeScripts: true,
    },
    data,
    isDemo,
  );
  const resources = query.data?.pages[0]?.items.slice(0, 3) || [];
  return (
    <Section title="Assigned resources">
      <div className="table-list">
        {resources.map((item) => (
          <article key={item.assignmentId || item.id}>
            <div>
              <strong>{item.title}</strong>
              <small>
                {item.instructions ||
                  (item.hasInstructions
                    ? "Includes coach instructions"
                    : "Ready to study")}
              </small>
            </div>
            <Link
              className="button-link"
              to={recordLink(data.role, {
                kind: "resource",
                id: item.id,
                studentId,
                assignmentId: item.assignmentId,
              })}
            >
              Open resource
            </Link>
          </article>
        ))}
        {!resources.length && (
          <EmptyState
            title={
              query.isError
                ? "Resources unavailable"
                : query.isPending
                  ? "Loading resources…"
                  : "No assigned resources"
            }
            detail={
              query.isError
                ? "Retry to load current assignments."
                : "Your assigned Library resources appear here."
            }
          />
        )}
        {query.isError && (
          <button onClick={() => void query.refetch()}>Retry resources</button>
        )}
        {(query.data?.pages[0]?.total || 0) > 3 && (
          <Link
            className="button-link"
            to={portalContextLink("/portal/work", studentId)}
          >
            All assigned resources
          </Link>
        )}
      </div>
    </Section>
  );
}
