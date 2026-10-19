import { useEffect, useId, useMemo, useState, useRef } from "react";
import { Search } from "lucide-react";
import type { NavigationItem } from "../app/navigation";
import type { Role, StudioSnapshot } from "../domain/model";
import { recordLink, type RecordKind } from "../app/recordLinks";
import { demoSearch, useGlobalSearch } from "../data/globalSearch";
import { useDebouncedValue } from "../data/library";
import { useWorkspaceNavigation } from "../hooks/useWorkspaceLocation";
import { Dialog } from "./Primitives";
import "./Workspace.css";

const groupLabels: Record<RecordKind, string> = {
  student: "Students",
  lesson: "Lessons",
  booking: "Bookings",
  resource: "Resources",
  note: "Notes",
};
export function WorkspaceSearch({
  audience: role,
  destinations,
  onClose,
  studentId,
  demoData,
}: {
  audience: Role;
  destinations: NavigationItem[];
  onClose: () => void;
  studentId?: string;
  demoData?: StudioSnapshot;
}) {
  const [query, setQuery] = useState(""),
    [group, setGroup] = useState<RecordKind>(),
    [page, setPage] = useState(1),
    [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    inputRef.current?.focus();
  }, []);
  const debounced = useDebouncedValue(query.trim(), 250),
    id = useId(),
    workspace = useWorkspaceNavigation();
  const remote = useGlobalSearch(debounced, studentId, group, page, !demoData);
  const result = demoData
    ? demoSearch(demoData, debounced, group, page)
    : remote.data;
  const links = useMemo(
    () =>
      destinations
        .filter((d) => d.label.toLowerCase().includes(query.toLowerCase()))
        .slice(0, query.trim().length >= 2 ? 5 : destinations.length)
        .map((d) => ({ key: d.to, label: d.label, to: d.to })),
    [destinations, query],
  );
  const rows: { key: string; label: string; to: string; snippet?: string }[] = [
    ...links,
    ...(debounced === query.trim() ? result?.items || [] : []).map((r) => ({
      key: r.kind + r.id,
      label: `${groupLabels[r.kind]}: ${r.title}`,
      to: recordLink(role, r, studentId),
      snippet: r.snippet,
    })),
  ];
  useEffect(() => {
    setActive(0);
  }, [query, group, page]);
  const open = (to: string) => {
    if (workspace.open(to)) onClose();
  };
  return (
    <Dialog title="Search" onClose={onClose}>
      <div className="workspace-search">
        <label htmlFor={`${id}-input`}>
          <Search aria-hidden="true" />
          <span className="visually-hidden">
            Search records and destinations
          </span>
          <input
            ref={inputRef}
            id={`${id}-input`}
            role="combobox"
            aria-expanded={rows.length > 0}
            aria-controls={id}
            aria-activedescendant={rows[active] ? `${id}-${active}` : undefined}
            aria-autocomplete="list"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setPage(1);
              setGroup(undefined);
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setActive((a) =>
                  rows.length ? Math.min(a + 1, rows.length - 1) : 0,
                );
              }
              if (e.key === "ArrowUp") {
                e.preventDefault();
                setActive((a) => Math.max(0, a - 1));
              }
              if (e.key === "Enter" && rows[active]) {
                e.preventDefault();
                open(rows[active].to);
              }
            }}
          />
        </label>
        {query.trim().length === 1 && (
          <p role="status">Type two characters to search records.</p>
        )}
        {!demoData && remote.isFetching && <p role="status">Searching…</p>}
        {!demoData && remote.isError && (
          <p role="alert">
            Search unavailable.{" "}
            <button onClick={() => void remote.refetch()}>Retry</button>
          </p>
        )}
        <ul id={id} role="listbox" aria-label="Search results">
          {rows.map((r, i) => (
            <li key={r.key} role="presentation">
              <button
                type="button"
                role="option"
                id={`${id}-${i}`}
                aria-selected={i === active}
                tabIndex={-1}
                onMouseMove={() => setActive(i)}
                onClick={() => open(r.to)}
              >
                <strong>{r.label}</strong>
                {r.snippet && <small>{r.snippet}</small>}
              </button>
            </li>
          ))}
        </ul>
        {debounced.length >= 2 &&
          !remote.isFetching &&
          !remote.isError &&
          !rows.length && (
            <p role="status">No matching records or destinations.</p>
          )}
        {(result?.moreGroups || []).map((kind) => (
          <button
            key={kind}
            onClick={() => {
              setGroup(kind);
              setPage(1);
            }}
          >
            More {groupLabels[kind].toLowerCase()}
          </button>
        ))}
        {group && (
          <nav aria-label="Search pages">
            <button disabled={page === 1} onClick={() => setPage((p) => p - 1)}>
              Previous
            </button>
            <span>Page {page}</span>
            <button
              disabled={!result?.moreGroups.includes(group)}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
            </button>
            <button
              onClick={() => {
                setGroup(undefined);
                setPage(1);
              }}
            >
              All groups
            </button>
          </nav>
        )}
      </div>
    </Dialog>
  );
}
