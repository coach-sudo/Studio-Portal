import { useId, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { householdCreditCommand } from "../../data/householdCredits";
import { formatStudioDateTime } from "../../domain/presentation";
import { usePrivateIdentity } from "../../hooks/usePrivateIdentity";

const entries = z.array(
  z.object({
    id: z.string(),
    student: z.string(),
    topic: z.string(),
    startsAt: z.string(),
  }),
);
const previewSchema = z.object({
  entryId: z.string(),
  lessonId: z.string(),
  studentId: z.string(),
  householdId: z.string(),
  packageId: z.string(),
  expiresAt: z.string().nullable(),
  before: z.number(),
  after: z.number(),
});

export function SharedCreditRestoration({
  studentId,
  packageId,
  timezone,
}: {
  studentId: string;
  packageId: string;
  timezone: string;
}) {
  const form = useId();
  const identity = usePrivateIdentity();
  const client = useQueryClient();
  const [open, setOpen] = useState(false);
  const [entryId, setEntryId] = useState("");
  const [reason, setReason] = useState("");
  const [visible, setVisible] = useState(true);
  const [review, setReview] = useState<{
    preview: z.infer<typeof previewSchema>;
    key: string;
  }>();
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const list = useQuery({
    queryKey: ["shared-restorations", identity, studentId, packageId],
    enabled: open && !!identity,
    queryFn: async ({ signal }) =>
      entries.parse(
        await householdCreditCommand(
          studentId,
          "restore_list",
          { packageId },
          signal,
        ),
      ),
  });
  async function submit() {
    if (busy || !entryId || reason.trim().length < 3) return;
    setBusy(true);
    setNotice("");
    try {
      if (!review) {
        const preview = previewSchema.parse(
          await householdCreditCommand(studentId, "restore_preview", {
            packageId,
            entryId,
          }),
        );
        setReview({ preview, key: crypto.randomUUID() });
      } else {
        const response = z
          .object({ status: z.enum(["completed", "stale"]) })
          .parse(
            await householdCreditCommand(studentId, "restore_apply", {
              packageId,
              entryId,
              reason: reason.trim(),
              portalVisible: visible,
              ...review,
            }),
          );
        setReview(undefined);
        setNotice(
          response.status === "completed"
            ? "Shared credit restored."
            : "The balance changed. Preview the restoration again.",
        );
        if (response.status === "completed") {
          setEntryId("");
          await Promise.all(
            [
              "shared-restorations",
              "coach-credit-households",
              "shared-credit-pools",
              "credit-coverage",
              "credit-attention",
              "student-credit-history",
            ].map((key) => client.invalidateQueries({ queryKey: [key] })),
          );
        }
      }
    } catch (error) {
      setNotice(
        error instanceof Error
          ? error.message
          : "Unable to verify the restoration.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <details
      className="disclosure-section"
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>Restore a used shared credit</summary>
      {list.isError && <p role="alert">Credit uses could not be loaded.</p>}
      {list.data?.length === 0 && (
        <p>No credit uses are available to restore.</p>
      )}
      {!!list.data?.length && (
        <form
          className="workflow-form"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <label htmlFor={form + "-entry"}>
            Credit use
            <select
              id={form + "-entry"}
              required
              value={entryId}
              disabled={busy || !!review}
              onChange={(event) => setEntryId(event.target.value)}
            >
              <option value="">Choose a lesson</option>
              {list.data.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.student} · {entry.topic} ·{" "}
                  {formatStudioDateTime(entry.startsAt, timezone)}
                </option>
              ))}
            </select>
          </label>
          <label htmlFor={form + "-reason"}>
            Reason
            <textarea
              id={form + "-reason"}
              required
              minLength={3}
              maxLength={500}
              value={reason}
              disabled={busy || !!review}
              onChange={(event) => setReason(event.target.value)}
            />
          </label>
          <label htmlFor={form + "-visible"}>
            <input
              id={form + "-visible"}
              type="checkbox"
              checked={visible}
              disabled={busy || !!review}
              onChange={(event) => setVisible(event.target.checked)}
            />{" "}
            Show restoration in portal history
          </label>
          {review && (
            <>
              <p>
                Available shared credits · {review.preview.before} →{" "}
                {review.preview.after}
              </p>
              {review.preview.before === review.preview.after && (
                <p>
                  The pool has expired. The restored credit keeps the pool’s
                  expiration.
                </p>
              )}
              <button
                type="button"
                disabled={busy}
                onClick={() => setReview(undefined)}
              >
                Back to edit
              </button>
            </>
          )}
          <button disabled={busy}>
            {review ? "Confirm restoration" : "Preview restoration"}
          </button>
        </form>
      )}
      {notice && <p role="status">{notice}</p>}
    </details>
  );
}
