import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { loadCollections, useDebouncedValue } from "../../data/library";
import type { StudioSnapshot } from "../../domain/model";
import { useSearchIdentity } from "../../data/globalSearch";

export function CollectionFilter({
  data,
  isDemo,
  value,
  onChange,
}: {
  data: StudioSnapshot;
  isDemo: boolean;
  value: string;
  onChange: (id: string) => void;
}) {
  const [open, setOpen] = useState(false),
    [search, setSearch] = useState(""),
    [page, setPage] = useState(1);
  const identity = useSearchIdentity(),
    query = useDebouncedValue(search);
  const remote = useQuery({
    queryKey: [
      "material-collections-filter",
      identity,
      data.studioId,
      query,
      page,
    ],
    queryFn: ({ signal }) =>
      loadCollections(data.studioId, query, page, signal),
    enabled: !isDemo && !!identity && open,
  });
  const items = isDemo
    ? (data.materialCollections || [])
        .filter((c) => c.title.toLowerCase().includes(search.toLowerCase()))
        .slice((page - 1) * 25, page * 25)
    : remote.data?.items || [];
  return (
    <details
      className="metadata-picker"
      onToggle={(e) => setOpen(e.currentTarget.open)}
    >
      <summary>Collection{value ? " (selected)" : ""}</summary>
      <div>
        <input
          aria-label="Find collection"
          type="search"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
        />
        <button onClick={() => onChange("")} aria-pressed={!value}>
          All collections
        </button>
        {items.map((c) => (
          <button
            key={c.id}
            onClick={() => onChange(c.id)}
            aria-pressed={c.id === value}
          >
            {c.title}
          </button>
        ))}
        {remote.isError && (
          <p role="alert">
            Collections unavailable.{" "}
            <button onClick={() => void remote.refetch()}>Retry</button>
          </p>
        )}
        <div className="metadata-paging">
          <button disabled={page === 1} onClick={() => setPage((n) => n - 1)}>
            Previous collections
          </button>
          <button
            disabled={
              isDemo
                ? items.length < 25
                : !remote.data ||
                  page * remote.data.pageSize >= remote.data.total
            }
            onClick={() => setPage((n) => n + 1)}
          >
            More collections
          </button>
        </div>
      </div>
    </details>
  );
}
