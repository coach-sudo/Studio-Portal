import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useId, useState } from "react";
import { z } from "zod";
import { Dialog } from "../../components/Primitives";
import { ApiClientError } from "../../data/apiClientError";
import { studioCommand } from "../../data/bookingCommands";
import { formatStudioDateTime } from "../../domain/presentation";
import { invalidateStudioDomains } from "../../hooks/useStudio";

const id = z.string().uuid();
const lot = z.object({
  id,
  studentId: id,
  name: z.string(),
  durationMinutes: z.number().nullable(),
  serviceIds: z.array(id),
  services: z.array(z.string()),
  expiresAt: z.string().nullable(),
  issued: z.number(),
  purchased: z.number(),
  consumed: z.number(),
  held: z.number(),
  reserved: z.number(),
  unused: z.number(),
  available: z.number(),
  ledgerBalance: z.number(),
  issues: z.array(z.string()),
  purchaseReferences: z.array(z.string()),
});
const reviewSchema = z.object({
  studentId: id,
  version: z.number(),
  lots: z.array(lot),
  selected: lot.nullable(),
  page: z.number(),
  total: z.number(),
  entries: z.array(
    z.object({
      id,
      kind: z.string(),
      quantity: z.number(),
      reason: z.string(),
      createdAt: z.string(),
      topic: z.string().nullable(),
      sourceKey: z.string().nullable(),
      correctedBy: id.nullable(),
      corrects: id.nullable(),
      action: z.enum(["reverse", "restore"]).nullable(),
    }),
  ),
  reservations: z.array(
    z.object({
      id,
      topic: z.string(),
      startsAt: z.string(),
      quantity: z.number(),
    }),
  ),
});
const findings: Record<string, string> = {
  eligibility_unverified: "Package service or duration needs verification.",
  negative_ledger: "The ledger has a negative balance.",
  missing_issuance: "Source issuance is missing.",
  orphaned_debit: "A debit has no matching lesson participant.",
  cancelled_lesson_debit: "A cancelled lesson still has a debit.",
  duplicate_lesson_debit: "A lesson has more than one net debit.",
  expired_reservation: "A scheduled lesson falls outside package validity.",
  unverified_reservation_eligibility:
    "A reservation has incompatible or unverified service or duration.",
  conflicting_package_allocations: "A lesson draws from more than one package.",
};
const labels = {
  add: "Add package credits",
  remove: "Remove package credits",
  set: "Set package balance",
  reverse: "Reverse entry",
  restore: "Restore consumed credit",
};
type Operation = keyof typeof labels;
type Entry = z.infer<typeof reviewSchema>["entries"][number];

export function PackageCreditReview({
  studentId,
  identity,
  timezone,
}: {
  studentId: string;
  identity: string;
  timezone: string;
}) {
  const client = useQueryClient();
  const formId = useId();
  const [open, setOpen] = useState(false);
  const [packageId, setPackageId] = useState("");
  const [page, setPage] = useState(1);
  const [draft, setDraft] = useState<{ action: Operation; entry?: Entry }>();
  const [quantity, setQuantity] = useState("");
  const [reason, setReason] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [intent, setIntent] = useState<{
    payload: Record<string, unknown>;
    key: string;
    version: number;
    delta: number;
    unused: number;
    available: number;
    reason: string;
  }>();
  const review = useQuery({
    queryKey: [
      "credit-coverage",
      identity,
      studentId,
      "packages",
      packageId,
      page,
    ],
    enabled: open,
    queryFn: async () => {
      const response = await studioCommand("credits", {
        command: "package_review",
        expectedVersion: 0,
        payload: { studentId, ...(packageId ? { packageId, page } : {}) },
        reason: "Review package credit ledger",
      });
      const value = reviewSchema.parse(response.resource);
      if (
        value.studentId !== studentId ||
        (packageId && value.selected?.id !== packageId)
      )
        throw new Error("Package review context changed.");
      return value;
    },
  });
  const selected = review.data?.selected;
  function begin(action: Operation, entry?: Entry) {
    setDraft({ action, entry });
    setReason("");
    setQuantity(action === "set" ? String(selected?.unused ?? "") : "");
    setIntent(undefined);
    setNotice("");
  }
  async function confirm() {
    if (!intent || busy) return;
    setBusy(true);
    setNotice("");
    try {
      await studioCommand("credits", {
        command: "package_correct",
        expectedVersion: intent.version,
        idempotencyKey: intent.key,
        payload: intent.payload,
        reason: intent.reason,
      });
      setNotice("Package credit correction recorded.");
      setDraft(undefined);
      setIntent(undefined);
      await Promise.all([
        client.invalidateQueries({ queryKey: ["credit-coverage"] }),
        client.invalidateQueries({ queryKey: ["student-workspace-summary"] }),
        invalidateStudioDomains(client, ["finance", "lessons", "booking"]),
      ]);
    } catch (error) {
      if (
        error instanceof ApiClientError &&
        error.code === "VERSION_CONFLICT"
      ) {
        setIntent(undefined);
        void review.refetch();
      }
      setNotice(
        error instanceof Error ? error.message : "Credit correction failed.",
      );
    } finally {
      setBusy(false);
    }
  }
  const amount = quantity.trim() ? Number(quantity) : NaN;
  const delta = draft?.entry
    ? -draft.entry.quantity
    : draft?.action === "set"
      ? amount - (selected?.unused ?? 0)
      : draft?.action === "remove"
        ? -amount
        : amount;
  const blocked = !!selected && delta < 0 && selected.available + delta < 0;
  const canReview =
    !!draft &&
    !!selected &&
    !!review.data &&
    !review.isFetching &&
    (draft.entry ||
      (Number.isInteger(amount) &&
        amount >= (draft.action === "set" ? 0 : 1) &&
        amount <= 100000)) &&
    delta !== 0 &&
    !blocked &&
    reason.trim().length >= 3;

  return (
    <details
      className="disclosure-section"
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>Packages and reconciliation</summary>
      {review.isError && (
        <p role="alert">
          Package ledger unavailable.{" "}
          <button onClick={() => void review.refetch()}>Retry</button>
        </p>
      )}
      {review.isPending && open && <p role="status">Loading package ledger…</p>}
      {review.data && (
        <>
          <label htmlFor={formId + "-package"}>
            Student package{" "}
            <select
              id={formId + "-package"}
              value={packageId}
              onChange={(event) => {
                setPackageId(event.target.value);
                setPage(1);
                setNotice("");
              }}
            >
              <option value="">Select a package</option>
              {review.data.lots.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name} ·{" "}
                  {item.durationMinutes
                    ? item.durationMinutes + " min"
                    : "duration unverified"}{" "}
                  · {item.available} available
                </option>
              ))}
            </select>
          </label>
          {review.data.lots.length === 0 && <p>No issued packages.</p>}
          {selected && (
            <>
              <h3>{selected.name}</h3>
              <p>
                {selected.services.length
                  ? selected.services.join(", ")
                  : "Service eligibility unverified"}
              </p>
              <p>
                {selected.durationMinutes
                  ? selected.durationMinutes + " minutes"
                  : "Duration unverified"}{" "}
                ·{" "}
                {selected.expiresAt
                  ? "Expires " +
                    formatStudioDateTime(selected.expiresAt, timezone)
                  : "No expiration recorded"}
              </p>
              <p>
                {selected.issued} issued · {selected.consumed} consumed ·{" "}
                {selected.unused} unused · {selected.reserved} reserved ·{" "}
                {selected.available} available
              </p>
              <p>{selected.purchased} credits from purchases</p>
              {selected.purchaseReferences.length > 0 && (
                <details>
                  <summary>Purchase references</summary>
                  <ul>
                    {selected.purchaseReferences.map((ref) => (
                      <li key={ref}>{ref}</li>
                    ))}
                  </ul>
                </details>
              )}
              {selected.issues.length > 0 && (
                <ul aria-label="Reconciliation findings">
                  {selected.issues.map((issue) => (
                    <li key={issue}>{findings[issue] ?? issue}</li>
                  ))}
                </ul>
              )}
              {review.data.reservations.length > 0 && (
                <details className="disclosure-section">
                  <summary>Reservations</summary>
                  <ul>
                    {review.data.reservations.map((hold) => (
                      <li key={hold.id}>
                        {hold.topic} ·{" "}
                        {formatStudioDateTime(hold.startsAt, timezone)} ·{" "}
                        {hold.quantity}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
              {(!selected.expiresAt ||
                Date.parse(selected.expiresAt) > Date.now()) && (
                <div className="header-actions">
                  {(["add", "remove", "set"] as const).map((operation) => (
                    <button key={operation} onClick={() => begin(operation)}>
                      {labels[operation]}
                    </button>
                  ))}
                </div>
              )}
              <h4>Package history</h4>
              <div className="table-list">
                {review.data.entries.map((entry) => (
                  <article key={entry.id}>
                    <div>
                      <strong>
                        {entry.quantity > 0 ? "+" : ""}
                        {entry.quantity} · {entry.kind}
                      </strong>
                      <small>
                        {entry.topic ? entry.topic + " · " : ""}
                        {formatStudioDateTime(entry.createdAt, timezone)}
                      </small>
                      <small>{entry.reason}</small>
                      {entry.sourceKey && <small>{entry.sourceKey}</small>}
                      {entry.correctedBy && (
                        <small>Linked correction recorded</small>
                      )}
                      {entry.corrects && <small>Compensating entry</small>}
                    </div>
                    {entry.action && (
                      <button
                        onClick={() =>
                          entry.action && begin(entry.action, entry)
                        }
                      >
                        {labels[entry.action]}
                      </button>
                    )}
                  </article>
                ))}
                {review.data.entries.length === 0 && <p>No ledger entries.</p>}
              </div>
              <div className="header-actions">
                <button disabled={page <= 1} onClick={() => setPage(page - 1)}>
                  Previous entries
                </button>
                <span>Page {page}</span>
                <button
                  disabled={page * 25 >= review.data.total}
                  onClick={() => setPage(page + 1)}
                >
                  Next entries
                </button>
              </div>
            </>
          )}
        </>
      )}
      {notice && !draft && <p role="status">{notice}</p>}
      {draft && selected && (
        <Dialog
          title={labels[draft.action]}
          onClose={() => !busy && setDraft(undefined)}
        >
          <form
            className="workflow-form"
            onSubmit={(event) => {
              event.preventDefault();
              if (intent) {
                void confirm();
              } else if (canReview && review.data) {
                setIntent({
                  key: crypto.randomUUID(),
                  version: review.data.version,
                  delta,
                  unused: selected.unused,
                  available: selected.available,
                  reason: reason.trim(),
                  payload: {
                    studentId,
                    packageId: selected.id,
                    operation: draft.action,
                    reviewedLot: selected,
                    reason: reason.trim(),
                    ...(draft.entry
                      ? { sourceEntryId: draft.entry.id }
                      : { quantity: amount }),
                  },
                });
              }
            }}
          >
            <p className="full">
              {selected.name}
              {draft.entry?.topic ? " · " + draft.entry.topic : ""}
            </p>
            {intent ? (
              <div className="full">
                <p>
                  Unused credits: {intent.unused} to{" "}
                  {intent.unused + intent.delta}
                </p>
                <p>
                  Available credits: {intent.available} to{" "}
                  {intent.available + intent.delta}
                </p>
              </div>
            ) : (
              <>
                {!draft.entry && (
                  <label className="full" htmlFor={formId + "-quantity"}>
                    {draft.action === "set"
                      ? "New unused total"
                      : "Number of credits"}
                    <input
                      id={formId + "-quantity"}
                      type="number"
                      min={draft.action === "set" ? 0 : 1}
                      max={100000}
                      step={1}
                      required
                      value={quantity}
                      onChange={(event) => setQuantity(event.target.value)}
                    />
                  </label>
                )}
                <label className="full" htmlFor={formId + "-reason"}>
                  Reason
                  <textarea
                    id={formId + "-reason"}
                    required
                    minLength={3}
                    maxLength={500}
                    value={reason}
                    onChange={(event) => setReason(event.target.value)}
                  />
                </label>
                {blocked && (
                  <div className="full" role="alert">
                    <p>
                      This change exceeds the package’s available credits.
                      Review its reservations before continuing.
                    </p>
                    <ul>
                      {review.data?.reservations.map((hold) => (
                        <li key={hold.id}>
                          {hold.topic} ·{" "}
                          {formatStudioDateTime(hold.startsAt, timezone)}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </>
            )}
            {notice && (
              <p className="full" role="alert">
                {notice}
              </p>
            )}
            <div className="form-actions full">
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  intent ? setIntent(undefined) : setDraft(undefined)
                }
              >
                {intent ? "Back to edit" : "Cancel"}
              </button>
              <button
                className="primary"
                disabled={busy || (!intent && !canReview)}
              >
                {intent ? "Confirm correction" : "Review correction"}
              </button>
            </div>
          </form>
        </Dialog>
      )}
    </details>
  );
}
