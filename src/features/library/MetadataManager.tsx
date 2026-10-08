import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Drawer } from "../../components/Primitives";
import {
  metadataKinds,
  type MetadataKind,
  type ResourceOption,
} from "../../domain/library";
import type { StudioSnapshot } from "../../domain/model";
import { resourceCommand, useResourceOptions } from "../../data/library";
import { useStudioStore } from "../../state/StudioStore";
import { MetadataPicker } from "./MetadataPicker";
export function MetadataManager({
  data,
  isDemo,
  onClose,
}: {
  data: StudioSnapshot;
  isDemo: boolean;
  onClose: () => void;
}) {
  const [kind, setKind] = useState<MetadataKind>("topic"),
    [search, setSearch] = useState(""),
    [page, setPage] = useState(1),
    [selected, setSelected] = useState<ResourceOption>(),
    [name, setName] = useState(""),
    [target, setTarget] = useState<ResourceOption[]>([]),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false);
  const store = useStudioStore(),
    queryClient = useQueryClient(),
    remote = useResourceOptions(
      data.studioId,
      kind,
      search,
      page,
      true,
      !isDemo,
    );
  const demo = [
    ...new Map(
      [
        ...(data.materialOptions || []),
        ...data.materials.flatMap((m) => m.resourceOptions || []),
      ].map((o) => [o.id, o]),
    ).values(),
  ].filter(
    (o) =>
      o.kind === kind && o.name.toLowerCase().includes(search.toLowerCase()),
  );
  const rows = isDemo
    ? demo.slice((page - 1) * 25, page * 25)
    : remote.data?.items || [];
  useEffect(() => {
    setPage(1);
    setSelected(undefined);
    setTarget([]);
  }, [kind, search]);
  const act = async (command: string, payload: Record<string, unknown>) => {
    setBusy(true);
    setNotice("");
    try {
      if (isDemo) {
        store.transact((draft) => {
          const choices = [
            ...new Map(
              [
                ...(draft.materialOptions || []),
                ...draft.materials.flatMap((m) => m.resourceOptions || []),
              ].map((o) => [o.id, o]),
            ).values(),
          ];
          const option = choices.find((o) => o.id === payload.id);
          if (!option) throw new Error("Option not found");
          if (command === "option_rename") option.name = String(payload.name);
          if (command === "option_archive")
            option.archived = !!payload.archived;
          if (command === "option_merge") option.archived = true;
          draft.materialOptions = choices;
          draft.materials.forEach((m) => {
            m.resourceOptions = (m.resourceOptions || []).flatMap((o) =>
              o.id === option.id
                ? command === "option_merge"
                  ? target
                  : [option]
                : [o],
            );
            m.resourceOptions = [
              ...new Map(m.resourceOptions.map((o) => [o.id, o])).values(),
            ];
          });
        });
      } else
        await resourceCommand(command, { studioId: data.studioId, ...payload });
      await queryClient.invalidateQueries({ queryKey: ["material-options"] });
      await queryClient.invalidateQueries({ queryKey: ["material-resources"] });
      setSelected(undefined);
      setTarget([]);
      setNotice("Classifications updated.");
    } catch (reason) {
      setNotice(reason instanceof Error ? reason.message : "Update failed.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Drawer title="Manage classifications" onClose={onClose}>
      <div className="resource-search">
        <label>
          Kind
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value as MetadataKind)}
          >
            {metadataKinds.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
        </label>
        <label>
          Search options
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
      </div>
      <MetadataPicker
        data={data}
        isDemo={isDemo}
        kind={kind}
        label={`Add ${kind}`}
        selected={[]}
        onChange={() => {}}
        canCreate
      />
      <p>
        Archived options stay on existing resources. Merging moves
        classifications to the selected option.
      </p>
      {!isDemo && remote.isFetching && <p role="status">Loading options…</p>}
      {remote.isError && (
        <p role="alert">
          {remote.error.message}
          <button type="button" onClick={() => void remote.refetch()}>
            Retry
          </button>
        </p>
      )}
      <div className="resource-results">
        {rows.map((option) => (
          <article key={option.id}>
            <div>
              <strong>{option.name}</strong>
              <small>
                {option.archived ? "Archived" : "Active"} ·{" "}
                {isDemo
                  ? data.materials.filter((m) =>
                      m.resourceOptions?.some((o) => o.id === option.id),
                    ).length
                  : option.uses || 0}{" "}
                resources
              </small>
            </div>
            <div className="resource-actions">
              <button
                type="button"
                onClick={() => {
                  setSelected(option);
                  setName(option.name);
                  setTarget([]);
                }}
              >
                Rename / merge
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  void act("option_archive", {
                    id: option.id,
                    archived: !option.archived,
                  })
                }
              >
                {option.archived ? "Restore" : "Archive"}
              </button>
            </div>
          </article>
        ))}
      </div>
      <div className="page-actions">
        <button
          type="button"
          disabled={page === 1}
          onClick={() => setPage(page - 1)}
        >
          Previous options
        </button>
        <button
          type="button"
          disabled={isDemo ? page * 25 >= demo.length : !remote.data?.hasMore}
          onClick={() => setPage(page + 1)}
        >
          More options
        </button>
      </div>
      {selected && (
        <form
          className="workflow-form"
          onSubmit={(e) => {
            e.preventDefault();
            void act("option_rename", { id: selected.id, name });
          }}
        >
          <label className="full">
            Name
            <input
              required
              maxLength={100}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <button disabled={busy}>Save name</button>
          <div className="full">
            <MetadataPicker
              data={data}
              isDemo={isDemo}
              kind={kind}
              label={`Merge ${selected.name} into`}
              selected={target}
              onChange={(next) =>
                setTarget(next.filter((o) => o.id !== selected.id).slice(-1))
              }
            />
            <button
              type="button"
              disabled={busy || !target.length}
              onClick={() =>
                void act("option_merge", {
                  id: selected.id,
                  targetId: target[0].id,
                })
              }
            >
              Merge classifications
            </button>
          </div>
        </form>
      )}
      {notice && <p role="status">{notice}</p>}
    </Drawer>
  );
}
