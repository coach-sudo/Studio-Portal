import { useQueryClient } from "@tanstack/react-query";
import DOMPurify from "dompurify";
import { CalendarDays, Search, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Dialog,
  EmptyState,
  ListControls,
  Section,
  Status,
  usePagedList,
} from "../../components/Primitives";
import { studioCommand } from "../../data/bookingCommands";
import { coachPageSize, shouldShowPagination } from "../../data/pagination";
import { mapNoteRow } from "../../data/studioMappers";
import type { StudioSnapshot } from "../../domain/model";
import { formatStudioDateTime } from "../../domain/presentation";
import { usePaginatedStudioRows } from "../../hooks/usePaginatedStudioRows";
import {
  invalidateStudioDomains,
  queryLayerV2Enabled,
} from "../../hooks/useStudio";
import { useStudioStore } from "../../state/StudioStore";

import { studentName } from "./StudioOperations.shared";

export function NotesView({
  data,
  isDemo = false,
}: {
  data: StudioSnapshot;
  isDemo?: boolean;
}) {
  const navigate = useNavigate(),
    store = useStudioStore(),
    queryClient = useQueryClient();
  const [query, setQuery] = useState(""),
    [status, setStatus] = useState("all"),
    [notice, setNotice] = useState(""),
    [deleting, setDeleting] = useState(""),
    [selected, setSelected] = useState<StudioSnapshot["notes"][number]>();
  const [serverPage, setServerPage] = useState(1);
  const [serverPageSize, setServerPageSize] = useState(coachPageSize);
  const serverPaging = queryLayerV2Enabled && !isDemo;
  const remoteNotes = usePaginatedStudioRows(
    {
      domain: "work",
      table: "notes",
      page: serverPage,
      pageSize: serverPageSize,
      search: query.trim() ? { column: "title", value: query } : undefined,
      filters: { status: status === "all" ? undefined : status },
      sort: { column: "updated_at", ascending: false },
    },
    serverPaging,
  );
  useEffect(() => setServerPage(1), [query, status]);
  const filtered = [...data.notes]
    .filter(
      (note) =>
        (status === "all" || note.status === status) &&
        [
          note.title,
          note.body,
          studentName(data, note.studentId),
          ...(note.tags || []),
        ]
          .join(" ")
          .toLowerCase()
          .includes(query.toLowerCase()),
    )
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const localNotePage = usePagedList(filtered, coachPageSize);
  const notePage = serverPaging
    ? {
        visible: (remoteNotes.data?.items ?? []).map(mapNoteRow),
        page: serverPage,
        setPage: setServerPage,
        pageSize: serverPageSize,
        setPageSize: setServerPageSize,
        pageCount: Math.max(
          1,
          Math.ceil((remoteNotes.data?.total ?? 0) / serverPageSize),
        ),
        total: remoteNotes.data?.total ?? 0,
      }
    : localNotePage;
  const remove = async (note: StudioSnapshot["notes"][number]) => {
    if (
      deleting ||
      !window.confirm(`Delete “${note.title}”? This cannot be undone.`)
    )
      return;
    setDeleting(note.id);
    try {
      if (isDemo)
        store.transact((draft) => {
          draft.notes = draft.notes.filter((item) => item.id !== note.id);
        });
      else {
        await studioCommand("notes", {
          command: "delete",
          entityId: note.id,
          expectedVersion: note.version,
          reason: "Coach deleted note",
        });
        await invalidateStudioDomains(queryClient, ["work"]);
      }
      setNotice("Note deleted.");
    } catch (reason) {
      setNotice(
        reason instanceof Error ? reason.message : "Note could not be deleted.",
      );
    } finally {
      setDeleting("");
    }
  };
  return (
    <Section title="Notes across the studio" marked>
      {notice && <p className="portal-notice">{notice}</p>}
      <div className="library-toolbar">
        <label>
          <Search />
          <input
            aria-label="Search notes"
            placeholder="Search note titles…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <select
          aria-label="Note status"
          value={status}
          onChange={(event) => setStatus(event.target.value)}
        >
          <option value="all">All statuses</option>
          <option value="draft">Drafts</option>
          <option value="published">Published</option>
        </select>
      </div>
      {shouldShowPagination(notePage.total, notePage.pageSize) && (
        <ListControls
          page={notePage.page}
          pageCount={notePage.pageCount}
          pageSize={notePage.pageSize}
          total={notePage.total}
          onPage={notePage.setPage}
          onPageSize={notePage.setPageSize}
          label="notes"
        />
      )}
      <div className="lesson-note-index">
        {notePage.visible.map((note) => (
          <button type="button" key={note.id} onClick={() => setSelected(note)}>
            <CalendarDays />
            <span>
              <strong>
                {note.lessonId
                  ? formatStudioDateTime(
                      data.lessons.find((item) => item.id === note.lessonId)
                        ?.startsAt || note.updatedAt,
                      data.settings.timezone,
                    )
                  : "General note"}
              </strong>
              <small>
                {studentName(data, note.studentId)} ·{" "}
                {data.lessons.find((item) => item.id === note.lessonId)
                  ?.topic || note.title}{" "}
                · {note.title}
              </small>
            </span>
            <Status tone={note.status === "published" ? "good" : "neutral"}>
              {note.status}
            </Status>
          </button>
        ))}
        {!notePage.total && (
          <EmptyState
            title="No notes yet"
            detail="Open a student record to save a private draft or publish follow-up."
          />
        )}
      </div>
      {selected && (
        <Dialog
          title={selected.title}
          description={`${studentName(data, selected.studentId)} · ${selected.lessonId ? formatStudioDateTime(data.lessons.find((item) => item.id === selected.lessonId)?.startsAt || selected.updatedAt, data.settings.timezone) : "General note"}`}
          onClose={() => setSelected(undefined)}
        >
          {selected.bodyHtml ? (
            <div
              className="rich-note-body"
              dangerouslySetInnerHTML={{
                __html: DOMPurify.sanitize(selected.bodyHtml),
              }}
            />
          ) : (
            <p>{selected.body}</p>
          )}
          <div className="form-actions">
            <button
              type="button"
              onClick={() => {
                setSelected(undefined);
                navigate(`/coach/students/${selected.studentId}/notes`);
              }}
            >
              Open student notes
            </button>
            <button
              type="button"
              className="danger-button"
              disabled={deleting === selected.id}
              onClick={() => {
                void remove(selected);
                setSelected(undefined);
              }}
            >
              <Trash2 />
              Delete note
            </button>
          </div>
        </Dialog>
      )}
    </Section>
  );
}
