import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useId, useRef, useState } from "react";
import { z } from "zod";
import { Dialog } from "../../components/Primitives";
import { studioCommand } from "../../data/bookingCommands";
import { ApiClientError } from "../../data/apiClientError";

const sharingSchema = z.object({
  packageId: z.uuid(),
  verifiedTerms: z.boolean(),
  selected: z.array(z.uuid()),
  students: z.array(
    z.object({ id: z.uuid(), name: z.string(), eligible: z.boolean() }),
  ),
});

export function ShareCreditPackage({
  studentId,
  packageId,
  identity,
}: {
  studentId: string;
  packageId: string;
  identity: string;
}) {
  const client = useQueryClient();
  const formId = useId();
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<string[]>();
  const [reason, setReason] = useState("");
  const [review, setReview] = useState<{
    before: string[];
    after: string[];
    reason: string;
  }>();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const request = useRef<string | null>(null);
  const options = useQuery({
    queryKey: ["credit-coverage", identity, studentId, "sharing", packageId],
    enabled: open,
    queryFn: async () => {
      const response = await studioCommand("credits", {
        command: "sharing_options",
        payload: { studentId, packageId },
        reason: "Review package eligibility",
        expectedVersion: 0,
      });
      const value = sharingSchema.parse(response.resource);
      if (value.packageId !== packageId)
        throw new Error("Package context changed.");
      return value;
    },
  });
  const chosen = selected ?? options.data?.selected ?? [];
  function edit(next: string[]) {
    setSelected([...next].sort());
    request.current = null;
  }
  async function confirm() {
    if (!review || busy) return;
    request.current ??= crypto.randomUUID();
    setBusy(true);
    setNotice("");
    try {
      await studioCommand("credits", {
        command: "set_sharing",
        expectedVersion: 0,
        idempotencyKey: request.current,
        reason: review.reason,
        payload: {
          studentId,
          packageId,
          studentIds: review.after,
          reviewedStudentIds: review.before,
          reason: review.reason,
        },
      });
      setOpen(false);
      setNotice("Shared package eligibility updated.");
      await client.invalidateQueries({ queryKey: ["credit-coverage"] });
    } catch (error) {
      if (
        error instanceof ApiClientError &&
        error.code === "VERSION_CONFLICT"
      ) {
        await options.refetch();
        setReview(undefined);
        setSelected(undefined);
      }
      setNotice(
        error instanceof Error
          ? error.message
          : "Could not save package eligibility.",
      );
    } finally {
      setBusy(false);
    }
  }
  const names = (ids: string[]) =>
    ids
      .map(
        (id) =>
          options.data?.students.find((student) => student.id === id)?.name ??
          "Unavailable member",
      )
      .join(", ") || "Package owner only";
  return (
    <div>
      <button
        type="button"
        onClick={() => {
          setSelected(undefined);
          setReview(undefined);
          setReason("");
          setNotice("");
          request.current = null;
          setOpen(true);
        }}
      >
        Manage shared eligibility
      </button>
      {!open && notice && <p role="status">{notice}</p>}
      {open && (
        <Dialog
          title="Shared package eligibility"
          onClose={() => {
            if (!busy) setOpen(false);
          }}
        >
          {options.isPending && <p role="status">Loading eligible students…</p>}
          {options.isError && (
            <p role="alert">
              Could not load eligibility.{" "}
              <button type="button" onClick={() => void options.refetch()}>
                Retry
              </button>
            </p>
          )}
          {options.data && !review && (
            <form
              className="workflow-form"
              onSubmit={(event) => {
                event.preventDefault();
                setReview({
                  before: options.data.selected,
                  after: chosen,
                  reason: reason.trim(),
                });
              }}
            >
              <div className="full">
                <p>
                  The package owner keeps access. All eligible students draw
                  from one balance.
                </p>
                {!options.data.verifiedTerms && (
                  <p>
                    Verify the issued package terms before sharing these
                    credits.
                  </p>
                )}
                {!options.data.students.length && (
                  <p>
                    No other students have the same designated household payer.
                  </p>
                )}
                {options.data.students.map((student) => (
                  <label key={student.id} htmlFor={formId + student.id}>
                    <input
                      type="checkbox"
                      id={formId + student.id}
                      checked={chosen.includes(student.id)}
                      disabled={
                        (!student.eligible || !options.data.verifiedTerms) &&
                        !chosen.includes(student.id)
                      }
                      onChange={(event) =>
                        edit(
                          event.target.checked
                            ? [...chosen, student.id]
                            : chosen.filter((id) => id !== student.id),
                        )
                      }
                    />
                    {student.name}
                    {!student.eligible && " · Payer authorization changed"}
                  </label>
                ))}
              </div>
              <label className="full" htmlFor={formId + "-reason"}>
                Reason
                <textarea
                  id={formId + "-reason"}
                  required
                  minLength={3}
                  maxLength={500}
                  value={reason}
                  onChange={(event) => {
                    setReason(event.target.value);
                    request.current = null;
                  }}
                />
              </label>
              <button
                type="submit"
                disabled={
                  reason.trim().length < 3 ||
                  JSON.stringify(chosen) ===
                    JSON.stringify(options.data.selected)
                }
              >
                Review change
              </button>
            </form>
          )}
          {review && (
            <>
              <p>Currently eligible: {names(review.before)}</p>
              <p>After this change: {names(review.after)}</p>
              <p>Existing reservations and usage stay with their lessons.</p>
              <p>Reason: {review.reason}</p>
              <button
                type="button"
                disabled={busy}
                onClick={() => setReview(undefined)}
              >
                Back
              </button>
              <button
                type="button"
                className="primary"
                disabled={busy}
                onClick={() => void confirm()}
              >
                {busy ? "Saving…" : "Confirm change"}
              </button>
            </>
          )}
          {notice && <p role="alert">{notice}</p>}
        </Dialog>
      )}
    </div>
  );
}
