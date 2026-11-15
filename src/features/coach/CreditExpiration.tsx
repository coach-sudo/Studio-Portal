import { useId, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { Dialog } from "../../components/Primitives";
import { householdCreditCommand } from "../../data/householdCredits";
import { formatStudioDateTime } from "../../domain/presentation";
import type { Json } from "../../types/database.generated";
import { usePrivateIdentity } from "../../hooks/usePrivateIdentity";

const previewSchema = z.object({
  packageId: z.string(),
  oldExpiry: z.string(),
  newExpiry: z.string().nullable(),
  balance: z.number(),
  reservations: z.array(
    z.object({
      lessonId: z.string(),
      topic: z.string(),
      startsAt: z.string(),
      coveredBefore: z.boolean(),
      coveredAfter: z.boolean(),
    }),
  ),
});
const historySchema = z.array(
  z.object({
    id: z.string(),
    reason: z.string(),
    oldExpiry: z.string(),
    newExpiry: z.string().nullable(),
    createdAt: z.string(),
  }),
);
export function CreditExpiration({
  studentId,
  packageId,
  expiresAt,
  timezone,
}: {
  studentId: string;
  packageId: string;
  expiresAt: string | null;
  timezone: string;
}) {
  const id = useId();
  const identity = usePrivateIdentity();
  const client = useQueryClient();
  const [open, setOpen] = useState(false);
  const [operation, setOperation] = useState("extend");
  const [date, setDate] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [review, setReview] = useState<{
    preview: z.infer<typeof previewSchema>;
    values: Record<string, Json>;
  }>();
  const history = useQuery({
    queryKey: ["credit-expiration-history", identity, studentId, packageId],
    enabled: open && !!identity,
    queryFn: async ({ signal }) =>
      historySchema.parse(
        await householdCreditCommand(
          studentId,
          "expiration_history",
          { packageId },
          signal,
        ),
      ),
  });
  const expiry = (value: string | null) =>
    value ? formatStudioDateTime(value, timezone) : "No expiration";
  async function submit() {
    setBusy(true);
    setNotice("");
    try {
      if (!review) {
        const values = {
          packageId,
          operation,
          reason: reason.trim(),
          expiresAt:
            operation === "extend" ? new Date(date).toISOString() : null,
        };
        const preview = previewSchema.parse(
          await householdCreditCommand(studentId, "expiration_preview", values),
        );
        setReview({
          preview,
          values: { ...values, key: crypto.randomUUID(), preview },
        });
      } else {
        const result = z
          .object({ status: z.enum(["completed", "stale"]) })
          .parse(
            await householdCreditCommand(
              studentId,
              "expiration_apply",
              review.values,
            ),
          );
        setReview(undefined);
        setNotice(
          result.status === "completed"
            ? "Expiration change saved."
            : "Coverage changed. Review the new preview before confirming.",
        );
        if (result.status === "completed") {
          await Promise.all(
            [
              "credit-expiration-history",
              "credit-coverage",
              "credit-attention",
              "coach-credit-households",
              "shared-credit-pools",
              "package-credit-review",
            ].map((key) => client.invalidateQueries({ queryKey: [key] })),
          );
        }
      }
    } catch (error) {
      setNotice(
        error instanceof Error
          ? error.message
          : "Unable to verify the expiration change.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Manage expiration
      </button>
      {open && (
        <Dialog
          title="Manage credit expiration"
          onClose={() => {
            if (!busy) {
              setOpen(false);
              setReview(undefined);
              setNotice("");
            }
          }}
        >
          <form
            className="workflow-form"
            onSubmit={(event) => {
              event.preventDefault();
              void submit();
            }}
          >
            <p>Current expiration · {expiry(expiresAt)}</p>
            {review ? (
              <>
                <p>
                  {expiry(review.preview.oldExpiry)} →{" "}
                  {expiry(review.preview.newExpiry)}
                </p>
                {review.preview.reservations.length ? (
                  <ul>
                    {review.preview.reservations.map((lesson) => (
                      <li key={lesson.lessonId}>
                        {lesson.topic} · {expiry(lesson.startsAt)} ·{" "}
                        {lesson.coveredBefore ? "Valid" : "Outside expiry"} →{" "}
                        {lesson.coveredAfter ? "Valid" : "Outside expiry"}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p>No scheduled reservations on this pool.</p>
                )}
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setReview(undefined)}
                >
                  Back to edit
                </button>
                <button disabled={busy}>Confirm expiration change</button>
              </>
            ) : (
              expiresAt && (
                <>
                  <label htmlFor={id + "-operation"}>
                    Action
                    <select
                      id={id + "-operation"}
                      value={operation}
                      onChange={(event) => setOperation(event.target.value)}
                    >
                      <option value="extend">Extend expiration</option>
                      <option value="waive">Waive expiration</option>
                    </select>
                  </label>
                  {operation === "extend" && (
                    <label htmlFor={id + "-date"}>
                      New expiration in your local time
                      <input
                        id={id + "-date"}
                        type="datetime-local"
                        required
                        value={date}
                        onChange={(event) => setDate(event.target.value)}
                      />
                    </label>
                  )}
                  <label htmlFor={id + "-reason"}>
                    Reason
                    <textarea
                      id={id + "-reason"}
                      required
                      minLength={3}
                      maxLength={500}
                      value={reason}
                      onChange={(event) => setReason(event.target.value)}
                    />
                  </label>
                  <button disabled={busy}>Preview expiration change</button>
                </>
              )
            )}
            {notice && <p role="status">{notice}</p>}
            <details>
              <summary>Expiration history</summary>
              {history.isError ? (
                <p>History could not be loaded.</p>
              ) : history.isPending ? (
                <p>Loading history…</p>
              ) : history.data.length ? (
                <ul>
                  {history.data.map((item) => (
                    <li key={item.id}>
                      {expiry(item.createdAt)} · {expiry(item.oldExpiry)} →{" "}
                      {expiry(item.newExpiry)} · {item.reason}
                    </li>
                  ))}
                </ul>
              ) : (
                <p>No exceptions recorded.</p>
              )}
            </details>
          </form>
        </Dialog>
      )}
    </>
  );
}
