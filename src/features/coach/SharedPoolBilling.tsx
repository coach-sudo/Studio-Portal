import { useState, useId } from "react";
import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { householdCreditCommand } from "../../data/householdCredits";
import { usePrivateIdentity } from "../../hooks/usePrivateIdentity";
import { formatStudioDateTime } from "../../domain/presentation";

const read = z.object({
  contactId: z.string().nullable(),
  options: z.array(z.object({ id: z.string(), name: z.string() })),
  history: z.array(z.object({ reason: z.string(), createdAt: z.string() })),
});
const previewSchema = z.object({
  packageId: z.string(),
  before: z.string().nullable(),
  after: z.string().nullable(),
  routes: z.array(
    z.object({ student: z.string(), recipient: z.string().nullable() }),
  ),
});
export function SharedPoolBilling({
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
  const [open, setOpen] = useState(false);
  const [selection, setSelection] = useState<string>();
  const [reason, setReason] = useState("");
  const [review, setReview] = useState<{
    preview: z.infer<typeof previewSchema>;
    key: string;
  }>();
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const settings = useQuery({
    queryKey: ["pool-billing", identity, studentId, packageId],
    enabled: open && !!identity,
    queryFn: async ({ signal }) =>
      read.parse(
        await householdCreditCommand(
          studentId,
          "billing_read",
          { packageId },
          signal,
        ),
      ),
    retry: false,
  });
  const value = selection ?? settings.data?.contactId ?? "";
  async function save() {
    if (busy) return;
    setBusy(true);
    setNotice("");
    try {
      if (!review) {
        const preview = previewSchema.parse(
          await householdCreditCommand(studentId, "billing_preview", {
            packageId,
            contactId: value || null,
          }),
        );
        setReview({ preview, key: crypto.randomUUID() });
      } else {
        const reply = z
          .object({ status: z.enum(["completed", "stale"]) })
          .parse(
            await householdCreditCommand(studentId, "billing_apply", {
              packageId,
              contactId: review.preview.after,
              reason: reason.trim(),
              ...review,
            }),
          );
        setReview(undefined);
        setNotice(
          reply.status === "completed"
            ? "Billing contact saved."
            : "Routing changed. Review the updated routing before confirming.",
        );
        if (reply.status === "completed") {
          setSelection(undefined);
          setReason("");
        }
        await settings.refetch();
      }
    } catch (error) {
      setNotice(
        error instanceof Error
          ? error.message
          : "Billing settings could not be saved.",
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
      <summary>Pool billing contact</summary>
      {settings.isError && (
        <p role="alert">Billing settings are unavailable.</p>
      )}
      {open && settings.isPending && (
        <p role="status">Loading billing settings…</p>
      )}
      {settings.data && (
        <>
          <form
            className="workflow-form"
            onSubmit={(event) => {
              event.preventDefault();
              void save();
            }}
          >
            <label htmlFor={form + "-contact"}>
              Primary billing contact
              <select
                id={form + "-contact"}
                value={value}
                disabled={busy || !!review}
                onChange={(event) => setSelection(event.target.value)}
              >
                <option value="">
                  Use each student’s designated billing contact
                </option>
                {settings.data.contactId &&
                  !settings.data.options.some(
                    (c) => c.id === settings.data.contactId,
                  ) && (
                    <option value={settings.data.contactId} disabled>
                      Current designation needs review
                    </option>
                  )}
                {settings.data.options.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
            <label htmlFor={form + "-reason"}>
              Reason
              <textarea
                id={form + "-reason"}
                value={reason}
                minLength={3}
                maxLength={500}
                required
                disabled={busy || !!review}
                onChange={(event) => setReason(event.target.value)}
              />
            </label>
            {review && (
              <>
                <ul>
                  {review.preview.routes.map((route, index) => (
                    <li key={index}>
                      {route.student} ·{" "}
                      {route.recipient ?? "No authorized recipient"}
                    </li>
                  ))}
                </ul>
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
              {review ? "Confirm routing" : "Preview routing"}
            </button>
          </form>
          {settings.data.history.length > 0 && (
            <details>
              <summary>Billing contact history</summary>
              <ul>
                {settings.data.history.map((entry, index) => (
                  <li key={index}>
                    {formatStudioDateTime(entry.createdAt, timezone)} ·{" "}
                    {entry.reason}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </>
      )}
      {notice && <p role="status">{notice}</p>}
    </details>
  );
}
