import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Drawer } from "../../components/Primitives";
import { WritingArea } from "../../components/WritingArea";
import { getAssignment, resourceCommand } from "../../data/library";
import type { LibraryResource } from "../../domain/library";
import { useStudioStore } from "../../state/StudioStore";

export function AssignmentEditor({
  resource,
  isDemo,
  onClose,
}: {
  resource: LibraryResource;
  isDemo: boolean;
  onClose: () => void;
}) {
  const store = useStudioStore(),
    client = useQueryClient();
  const [instructions, setInstructions] = useState<string>(),
    [coachNotes, setCoachNotes] = useState<string>(),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const detail = useQuery({
    queryKey: ["material-assignment", resource.assignmentId],
    queryFn: ({ signal }) => getAssignment(resource.assignmentId!, signal),
    enabled: !isDemo,
  });
  const loaded = isDemo
    ? {
        instructions:
          store.snapshot.materials.find((m) => m.id === resource.assignmentId)
            ?.instructions || "",
        coachNotes: "",
        version: resource.assignmentVersion || 1,
      }
    : detail.data;
  const save = async () => {
    if (!loaded || busy) return;
    setBusy(true);
    setError("");
    try {
      if (isDemo)
        store.transact((draft) => {
          const item = draft.materials.find(
            (m) => m.id === resource.assignmentId,
          );
          if (item) {
            item.instructions = instructions ?? loaded.instructions;
            item.version += 1;
          }
        });
      else
        await resourceCommand(
          "assignment_update",
          {
            id: resource.assignmentId,
            instructions: instructions ?? loaded.instructions,
            coachNotes: coachNotes ?? loaded.coachNotes ?? "",
          },
          loaded.version,
        );
      await client.invalidateQueries({ queryKey: ["material-resources"] });
      await client.invalidateQueries({ queryKey: ["material-assignment"] });
      onClose();
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Could not save assignment.",
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <Drawer title={`Assignment: ${resource.title}`} onClose={onClose}>
      {!isDemo && detail.isPending && <p role="status">Loading assignment…</p>}
      {!isDemo && detail.isError && (
        <p role="alert">
          {detail.error.message}
          <button type="button" onClick={() => void detail.refetch()}>
            Retry
          </button>
        </p>
      )}
      {loaded && (
        <form
          className="workflow-form"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <label className="full">
            Student-facing instructions
            <WritingArea
              maxLength={10000}
              value={instructions ?? loaded.instructions}
              onChange={(e) => setInstructions(e.target.value)}
            />
          </label>
          <label className="full">
            Private coach notes
            <WritingArea
              maxLength={10000}
              value={coachNotes ?? loaded.coachNotes ?? ""}
              onChange={(e) => setCoachNotes(e.target.value)}
            />
          </label>
          <div className="form-actions full">
            <button type="button" onClick={onClose}>
              Cancel
            </button>
            <button className="primary" disabled={busy}>
              {busy ? "Saving…" : "Save assignment"}
            </button>
          </div>
        </form>
      )}
      {!isDemo && detail.isSuccess && !loaded && (
        <p role="alert">The assignment is no longer available.</p>
      )}
      {error && <p role="alert">{error}</p>}
    </Drawer>
  );
}
