import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { MetadataKind, ResourceOption } from "../../domain/library";
import type { StudioSnapshot } from "../../domain/model";
import { resourceCommand, useResourceOptions } from "../../data/library";
import { useStudioStore } from "../../state/StudioStore";

export function MetadataPicker({
  data,
  isDemo,
  kind,
  selected,
  onChange,
  canCreate = false,
  label = kind,
}: {
  data: StudioSnapshot;
  isDemo: boolean;
  kind: MetadataKind;
  selected: ResourceOption[];
  onChange: (options: ResourceOption[]) => void;
  canCreate?: boolean;
  label?: string;
}) {
  const [search, setSearch] = useState(""),
    [page, setPage] = useState(1),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false);
  const queryClient = useQueryClient(),
    store = useStudioStore();
  const remote = useResourceOptions(
    data.studioId,
    kind,
    search,
    page,
    false,
    !isDemo,
  );
  const demoChoices = [
    ...(data.materialOptions || []),
    ...data.materials.flatMap((m) => m.resourceOptions || []),
  ];
  const choices = isDemo
    ? [
        ...new Map(
          demoChoices
            .filter(
              (o) =>
                o.kind === kind &&
                !o.archived &&
                o.name.toLowerCase().includes(search.toLowerCase()),
            )
            .map((o) => [o.id, o]),
        ).values(),
      ].slice((page - 1) * 25, page * 25)
    : remote.data?.items || [];
  useEffect(() => setPage(1), [search]);
  const create = async () => {
    if (!search.trim() || busy) return;
    setBusy(true);
    setNotice("");
    try {
      let option: ResourceOption;
      if (isDemo) {
        const existing = demoChoices.find(
          (o) =>
            o.kind === kind &&
            o.name.toLowerCase().replace(/\W/g, "") ===
              search.toLowerCase().replace(/\W/g, ""),
        );
        option = existing || {
          id: crypto.randomUUID(),
          kind,
          name: search.trim(),
          archived: false,
        };
        store.transact((draft) => {
          draft.materialOptions = [
            ...(draft.materialOptions || []).filter((o) => o.id !== option.id),
            option,
          ];
        });
      } else {
        const result = await resourceCommand("option_create", {
          studioId: data.studioId,
          kind,
          name: search.trim(),
        });
        option = { id: result.id, kind, name: search.trim(), archived: false };
        await queryClient.invalidateQueries({ queryKey: ["material-options"] });
      }
      onChange([...selected.filter((o) => o.id !== option.id), option]);
      setSearch("");
    } catch (error) {
      setNotice(
        error instanceof Error
          ? error.message
          : "The option could not be created.",
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <details className="metadata-picker">
      <summary>
        {label}
        <span>
          {selected.length ? selected.map((o) => o.name).join(", ") : "Any"}
        </span>
      </summary>
      <div>
        <input
          type="search"
          aria-label={`Search ${label}`}
          placeholder={`Search ${label}`}
          value={search}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.preventDefault();
          }}
          onChange={(event) => setSearch(event.target.value)}
        />
        {selected.length > 0 && (
          <div className="metadata-selected">
            {selected.map((o) => (
              <button
                key={o.id}
                type="button"
                aria-label={`Remove ${o.name} from ${label}`}
                onClick={() => onChange(selected.filter((i) => i.id !== o.id))}
              >
                {o.name} ×
              </button>
            ))}
          </div>
        )}
        {!isDemo && remote.isFetching && (
          <small role="status">Searching…</small>
        )}
        {!isDemo && remote.isError && (
          <p role="alert">
            {remote.error.message}{" "}
            <button type="button" onClick={() => void remote.refetch()}>
              Retry
            </button>
          </p>
        )}
        <div className="metadata-choices">
          {choices.map((option) => (
            <label key={option.id}>
              <input
                type="checkbox"
                checked={selected.some((o) => o.id === option.id)}
                onChange={(event) =>
                  onChange(
                    event.target.checked
                      ? [...selected.filter((o) => o.id !== option.id), option]
                      : selected.filter((o) => o.id !== option.id),
                  )
                }
              />
              {option.name}
            </label>
          ))}
        </div>
        {!choices.length && !remote.isFetching && (
          <small>No matching options</small>
        )}
        <div className="metadata-paging">
          <button
            type="button"
            disabled={page === 1}
            onClick={() => setPage(page - 1)}
          >
            Previous options
          </button>
          <button
            type="button"
            disabled={isDemo ? choices.length < 25 : !remote.data?.hasMore}
            onClick={() => setPage(page + 1)}
          >
            More options
          </button>
        </div>
        {canCreate && (
          <button
            type="button"
            disabled={!search.trim() || busy}
            onClick={() => void create()}
          >
            {busy ? "Adding…" : "+ Add New"}
            {search.trim() ? ` “${search.trim()}”` : ""}
          </button>
        )}
        {notice && <p role="alert">{notice}</p>}
      </div>
    </details>
  );
}
