import { useId, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { Dialog } from "../../components/Primitives";
import { studioCommand } from "../../data/bookingCommands";
import type { StudioSnapshot } from "../../domain/model";
import { invalidateStudioDomains } from "../../hooks/useStudio";

const previewSchema = z.object({
  status: z.enum(["preview", "completed", "stale", "unapplied"]),
  canApply: z.boolean().optional(),
  rows: z.array(
    z.looseObject({
      studentId: z.string(),
      packageId: z.string(),
      delta: z.number(),
      before: z.looseObject({
        name: z.string(),
        services: z.array(z.string()),
        durationMinutes: z.number().nullable(),
        unused: z.number(),
        reserved: z.number(),
        available: z.number(),
      }),
      afterUnused: z.number(),
      conflict: z.string().nullable(),
      reservations: z.array(
        z.looseObject({ id: z.string(), topic: z.string() }),
      ),
    }),
  ),
});
const conflicts: Record<string, string> = {
  expired: "This package has expired.",
  reserved_or_unavailable:
    "This change would touch reserved or unavailable credits.",
  reconciliation_required: "Review the package ledger before adjusting it.",
};
type Request = {
  studentId: string;
  rows: { studentId: string; packageId: string; delta: number }[];
  reason: string;
  portalVisible: boolean;
};

export function BulkCreditAdjustments({ data }: { data: StudioSnapshot }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [reason, setReason] = useState("");
  const [visible, setVisible] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [review, setReview] = useState<{
    request: Request;
    preview: z.infer<typeof previewSchema>;
    key: string;
  }>();
  const client = useQueryClient();
  const form = useId();
  const students = new Map(
    data.students.map((student) => [student.id, student.fullName]),
  );
  const selected = data.packages.filter(
    (item) => item.id in draft && students.has(item.studentId),
  );
  const rows = selected.map((item) => ({
    studentId: item.studentId,
    packageId: item.id,
    delta: Number(draft[item.id]),
  }));
  const valid =
    rows.length > 0 &&
    rows.length <= 25 &&
    rows.every(
      (item) =>
        Number.isInteger(item.delta) &&
        item.delta !== 0 &&
        Math.abs(item.delta) <= 100000,
    ) &&
    reason.trim().length >= 3;

  async function submit() {
    if (busy || (!review && !valid)) return;
    const request = review?.request ?? {
      studentId: rows[0].studentId,
      rows,
      reason: reason.trim(),
      portalVisible: visible,
    };
    setBusy(true);
    setNotice("");
    try {
      const result = await studioCommand("credits", {
        command: review ? "bulk_package_apply" : "bulk_package_preview",
        expectedVersion: 0,
        idempotencyKey: review?.key,
        payload: review
          ? { ...request, preview: review.preview.rows }
          : request,
        reason: request.reason,
      });
      const preview = previewSchema.parse(result.resource);
      if (preview.status === "completed") {
        setOpen(false);
        setReview(undefined);
        setDraft({});
        setReason("");
        setNotice("All selected package adjustments were recorded.");
        await Promise.all([
          client.invalidateQueries({ queryKey: ["credit-coverage"] }),
          client.invalidateQueries({ queryKey: ["student-workspace-summary"] }),
          client.invalidateQueries({ queryKey: ["invoices"] }),
          invalidateStudioDomains(client, ["finance", "lessons", "booking"]),
        ]);
      } else {
        setReview({ request, preview, key: crypto.randomUUID() });
        if (preview.status === "stale")
          setNotice(
            "Balances changed. Review the updated preview. The batch is still unapplied.",
          );
        if (preview.status === "unapplied")
          setNotice(
            "The batch is unapplied. Resolve the listed conflicts first.",
          );
      }
    } catch (error) {
      setNotice(
        (error instanceof Error ? error.message : "The request failed.") +
          (review ? " Retry this same confirmation to check its result." : ""),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        onClick={() => {
          setOpen(true);
          setNotice("");
        }}
      >
        Bulk credit adjustments
      </button>
      {notice && !open && <p role="status">{notice}</p>}
      {open && (
        <Dialog
          title="Bulk credit adjustments"
          onClose={() => !busy && setOpen(false)}
        >
          <form
            className="workflow-form"
            onSubmit={(event) => {
              event.preventDefault();
              void submit();
            }}
          >
            {review ? (
              <div className="full table-list">
                {review.preview.rows.map((item) => (
                  <article key={item.packageId}>
                    <div>
                      <strong>
                        {students.get(item.studentId)} · {item.before.name}
                      </strong>
                      <small>
                        {item.before.services.join(", ") ||
                          "Service unverified"}{" "}
                        · {item.before.durationMinutes ?? "?"} min
                      </small>
                      <small>
                        {item.before.unused} unused · {item.before.reserved}{" "}
                        reserved · {item.before.available} available
                      </small>
                      <small>
                        {item.delta > 0 ? "+" : ""}
                        {item.delta} credits · {item.afterUnused} unused after
                        adjustment
                      </small>
                      {item.conflict && (
                        <>
                          <small>
                            {conflicts[item.conflict] ??
                              "Review this package before applying."}
                          </small>
                          {item.reservations.map((hold) => (
                            <small key={hold.id}>{hold.topic}</small>
                          ))}
                        </>
                      )}
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <>
                <label className="full" htmlFor={form + "-package"}>
                  Add a package
                  <select
                    id={form + "-package"}
                    value=""
                    onChange={(event) => {
                      const id = event.target.value;
                      if (id) setDraft({ ...draft, [id]: "" });
                    }}
                  >
                    <option value="">Choose a package</option>
                    {data.packages
                      .filter(
                        (item) =>
                          students.has(item.studentId) && !(item.id in draft),
                      )
                      .map((item) => (
                        <option key={item.id} value={item.id}>
                          {students.get(item.studentId)} · {item.name}
                        </option>
                      ))}
                  </select>
                </label>
                {selected.map((item) => (
                  <fieldset className="full" key={item.id}>
                    <legend>
                      {students.get(item.studentId)} · {item.name}
                    </legend>
                    <label htmlFor={form + item.id}>
                      Credits to add or remove
                      <input
                        id={form + item.id}
                        type="number"
                        required
                        step="1"
                        value={draft[item.id]}
                        onChange={(event) =>
                          setDraft({ ...draft, [item.id]: event.target.value })
                        }
                      />
                    </label>
                    <button
                      type="button"
                      onClick={() =>
                        setDraft((value) => {
                          const next = { ...value };
                          delete next[item.id];
                          return next;
                        })
                      }
                    >
                      Remove from batch
                    </button>
                  </fieldset>
                ))}
                <label className="full" htmlFor={form + "-reason"}>
                  Reason
                  <textarea
                    id={form + "-reason"}
                    value={reason}
                    minLength={3}
                    maxLength={500}
                    onChange={(event) => setReason(event.target.value)}
                    required
                  />
                </label>
                <label className="full" htmlFor={form + "-visible"}>
                  <input
                    id={form + "-visible"}
                    type="checkbox"
                    checked={visible}
                    onChange={(event) => setVisible(event.target.checked)}
                  />
                  Show adjustments in portal history
                </label>
              </>
            )}
            {notice && (
              <p className="full" role="status">
                {notice}
              </p>
            )}
            <div className="form-actions full">
              <button
                type="button"
                disabled={busy}
                onClick={() => (review ? setReview(undefined) : setOpen(false))}
              >
                {review ? "Back to edit" : "Cancel"}
              </button>
              <button
                className="primary"
                disabled={busy || (review ? !review.preview.canApply : !valid)}
              >
                {review ? "Confirm all adjustments" : "Review adjustments"}
              </button>
            </div>
          </form>
        </Dialog>
      )}
    </>
  );
}
