import { useState } from "react";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { Drawer } from "../../components/Primitives";
import { WritingArea } from "../../components/WritingArea";
import {
  getCollection,
  loadCollections,
  resourceCommand,
  useDebouncedValue,
} from "../../data/library";
import type { ResourceCollection } from "../../domain/library";
import type { StudioSnapshot } from "../../domain/model";
import { useStudioStore } from "../../state/StudioStore";
import { ResourceAssignmentForm, ResourceBrowser } from "./ResourceBrowser";

export function CollectionsManager({
  data,
  isDemo,
  onClose,
}: {
  data: StudioSnapshot;
  isDemo: boolean;
  onClose: () => void;
}) {
  const store = useStudioStore(),
    queryClient = useQueryClient();
  const [search, setSearch] = useState(""),
    [mode, setMode] = useState("list"),
    [editing, setEditing] = useState<ResourceCollection>(),
    [title, setTitle] = useState(""),
    [description, setDescription] = useState(""),
    [members, setMembers] = useState<{ id: string; title: string }[]>([]),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState("");
  const debounced = useDebouncedValue(search);
  const list = useInfiniteQuery({
    queryKey: [
      "material-collections",
      data.studioId,
      debounced,
      isDemo ? store.snapshot.materialCollections : null,
    ],
    initialPageParam: 1,
    queryFn: ({ pageParam, signal }) =>
      isDemo
        ? Promise.resolve({
            items: (store.snapshot.materialCollections || [])
              .filter((c) =>
                `${c.title} ${c.description}`
                  .toLowerCase()
                  .includes(debounced.toLowerCase()),
              )
              .slice((pageParam - 1) * 25, pageParam * 25),
            total: (store.snapshot.materialCollections || []).filter((c) =>
              `${c.title} ${c.description}`
                .toLowerCase()
                .includes(debounced.toLowerCase()),
            ).length,
            page: pageParam,
            pageSize: 25,
          })
        : loadCollections(data.studioId, debounced, pageParam, signal),
    getNextPageParam: (last) =>
      last.page * 25 < last.total ? last.page + 1 : undefined,
  });
  const open = async (collection: ResourceCollection, nextMode: string) => {
    setBusy(true);
    setNotice("");
    try {
      const detail = isDemo
        ? {
            ...collection,
            resources: (collection.resourceIds || []).map((id) => ({
              id,
              title:
                store.snapshot.materials.find(
                  (m) => (m.resourceId || m.id) === id,
                )?.title || "Resource",
            })),
          }
        : await getCollection(collection.id);
      setEditing({
        ...collection,
        version: detail.version,
        resourceIds: detail.resources.map((r) => r.id),
      });
      setTitle(detail.title);
      setDescription(detail.description);
      setMembers(detail.resources);
      setMode(nextMode);
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : "Collection unavailable.",
      );
    } finally {
      setBusy(false);
    }
  };
  const save = async () => {
    setBusy(true);
    setNotice("");
    try {
      if (isDemo)
        store.transact((draft) => {
          const next: ResourceCollection = {
            id: editing?.id || crypto.randomUUID(),
            title,
            description,
            resourceIds: members.map((m) => m.id),
            version: (editing?.version || 0) + 1,
            archived: editing?.archived || false,
          };
          draft.materialCollections = [
            ...(draft.materialCollections || []).filter(
              (c) => c.id !== next.id,
            ),
            next,
          ];
        });
      else
        await resourceCommand(
          editing ? "collection_update" : "collection_create",
          {
            studioId: data.studioId,
            id: editing?.id,
            title,
            description,
            resourceIds: members.map((m) => m.id),
          },
          editing?.version || 0,
        );
      await queryClient.invalidateQueries({
        queryKey: ["material-collections"],
      });
      setMode("list");
      setEditing(undefined);
    } catch (error) {
      setNotice(
        error instanceof Error
          ? error.message
          : "Collection could not be saved.",
      );
    } finally {
      setBusy(false);
    }
  };
  const archive = async (collection: ResourceCollection) => {
    setBusy(true);
    try {
      if (isDemo)
        store.transact((draft) => {
          const current = draft.materialCollections?.find(
            (c) => c.id === collection.id,
          );
          if (current) {
            current.archived = !current.archived;
            current.version += 1;
          }
        });
      else
        await resourceCommand(
          "collection_archive",
          { studioId: data.studioId, id: collection.id },
          collection.version,
        );
      await queryClient.invalidateQueries({
        queryKey: ["material-collections"],
      });
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Update failed.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Drawer title="Resource collections" onClose={onClose}>
      <p>
        Assignments are snapshots. Editing a collection does not change
        students' existing materials.
      </p>
      {mode === "list" && (
        <>
          <div className="resource-search">
            <label>
              Search collections
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </label>
            <button
              type="button"
              onClick={() => {
                setEditing(undefined);
                setTitle("");
                setDescription("");
                setMembers([]);
                setMode("edit");
              }}
            >
              New collection
            </button>
          </div>
          {list.isFetching && <p role="status">Searching…</p>}
          {list.isError && (
            <p role="alert">
              {list.error.message}
              <button type="button" onClick={() => void list.refetch()}>
                Retry
              </button>
            </p>
          )}
          <div className="resource-results">
            {list.data?.pages
              .flatMap((p) => p.items)
              .map((collection) => (
                <article key={collection.id}>
                  <div>
                    <strong>{collection.title}</strong>
                    <small>
                      {collection.resourceCount ??
                        collection.resourceIds?.length ??
                        0}{" "}
                      resources · {collection.archived ? "Archived" : "Active"}
                    </small>
                  </div>
                  <div className="resource-actions">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void open(collection, "edit")}
                    >
                      Edit collection
                    </button>
                    <button
                      type="button"
                      disabled={busy || collection.archived}
                      onClick={() => void open(collection, "assign")}
                    >
                      Assign collection
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void archive(collection)}
                    >
                      {collection.archived ? "Restore" : "Archive"}
                    </button>
                  </div>
                </article>
              ))}
          </div>
          {list.isSuccess && !list.data.pages[0].total && (
            <p>No collections found.</p>
          )}
          {list.hasNextPage && (
            <button
              type="button"
              disabled={list.isFetchingNextPage}
              onClick={() => void list.fetchNextPage()}
            >
              Load More collections
            </button>
          )}
        </>
      )}
      {mode === "edit" && (
        <form
          className="workflow-form"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <label className="full">
            Collection name
            <input
              required
              maxLength={200}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </label>
          <label className="full">
            Collection description
            <WritingArea
              writingSize="description"
              maxLength={10000}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </label>
          <div className="metadata-selected full">
            {members.map((member) => (
              <button
                type="button"
                key={member.id}
                aria-label={`Remove ${member.title} from collection`}
                onClick={() =>
                  setMembers(members.filter((m) => m.id !== member.id))
                }
              >
                {member.title} ×
              </button>
            ))}
          </div>
          <div className="full">
            <ResourceBrowser
              data={data}
              isDemo={isDemo}
              showActions={false}
              title="Choose collection resources"
              onChoose={(resource) =>
                setMembers([
                  ...members.filter((m) => m.id !== resource.id),
                  { id: resource.id, title: resource.title },
                ])
              }
            />
          </div>
          <div className="form-actions full">
            <button type="button" onClick={() => setMode("list")}>
              Cancel
            </button>
            <button className="primary" disabled={busy || members.length > 100}>
              {busy ? "Saving…" : "Save collection"}
            </button>
          </div>
        </form>
      )}
      {mode === "assign" && editing && (
        <ResourceAssignmentForm
          collection
          resource={editing}
          data={data}
          isDemo={isDemo}
          onClose={() => setMode("list")}
          onSaved={() => setMode("list")}
        />
      )}
      {notice && <p role="alert">{notice}</p>}
    </Drawer>
  );
}
