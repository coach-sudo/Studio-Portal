import { useSearchParams } from "react-router-dom";
import { CreditExpiration } from "./CreditExpiration";
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
  terms: z
    .object({
      originalStudentId: id,
      originalDefinitionId: id.nullable(),
      originalName: z.string(),
      originalExpiresAt: z.string().nullable(),
      issuanceEntryId: id.nullable(),
    })
    .nullable()
    .optional(),
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
const caseSchema = z.object({
  id,
  finding: z.string(),
  status: z.enum([
    "needs_review",
    "under_review",
    "resolved",
    "dismissed",
    "reopened",
  ]),
  version: z.number().int(),
  reason: z.string().nullable(),
  evidence: z
    .object({
      checkoutDuplicates: z.array(
        z.object({ entryId: id, relatedEntryId: id }),
      ),
    })
    .optional(),
  history: z.array(
    z.object({
      at: z.string(),
      reason: z.string(),
      status: z.string().nullable(),
    }),
  ),
});
const caseStatus = {
  needs_review: "Needs review",
  under_review: "Under review",
  resolved: "Resolved",
  dismissed: "Dismissed",
  reopened: "Reopened",
};
type CaseDecision = "under_review" | "resolved" | "dismissed" | "reopened";

const reviewSchema = z.object({
  cases: z.array(caseSchema).optional(),
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
  confirmed_checkout_duplicate:
    "Two active credit grants reference the same Stripe payment.",
  legacy_terms_unverified:
    "Purchase-time terms are unavailable. Current rules are shown for reference.",
  purchase_source_unverified:
    "A purchase entry has no recorded source reference.",
  repeated_purchase_description:
    "Multiple purchase entries share a reason and quantity. Compare their source references before correcting.",
  lesson_package_mismatch:
    "A lesson names a different package than its credit debit.",
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
  const [params] = useSearchParams();
  const requestedPackage =
    z.string().uuid().safeParse(params.get("creditPackage")).data ?? "";
  const [open, setOpen] = useState(!!requestedPackage);
  const [packageId, setPackageId] = useState(requestedPackage);
  const [page, setPage] = useState(1);
  const [finding, setFinding] = useState<string>();
  const [caseReasons, setCaseReasons] = useState<Record<string, string>>({});
  const [decisionKey, setDecisionKey] = useState<{
    intent: string;
    key: string;
  }>();
  const [linkedCorrection, setLinkedCorrection] = useState<string>();
  const [draft, setDraft] = useState<{ action: Operation; entry?: Entry }>();
  const [quantity, setQuantity] = useState("");
  const [reason, setReason] = useState("");
  const [portalVisible, setPortalVisible] = useState(true);
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
    setPortalVisible(true);
    setQuantity(action === "set" ? String(selected?.unused ?? "") : "");
    setIntent(undefined);
    setNotice("");
  }
  async function confirm() {
    if (!intent || busy) return;
    setBusy(true);
    setNotice("");
    try {
      const response = await studioCommand("credits", {
        command: "package_correct",
        expectedVersion: intent.version,
        idempotencyKey: intent.key,
        payload: intent.payload,
        reason: intent.reason,
      });
      setLinkedCorrection(id.safeParse(response.resource?.entryId).data);
      setNotice("Package credit correction recorded.");
      setDraft(undefined);
      setIntent(undefined);
      await Promise.all([
        client.invalidateQueries({ queryKey: ["credit-coverage"] }),
        client.invalidateQueries({ queryKey: ["student-workspace-summary"] }),
        client.invalidateQueries({ queryKey: ["invoices"] }),
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
  async function decide(
    item: z.infer<typeof caseSchema>,
    status: CaseDecision,
  ) {
    const caseReason = caseReasons[item.id]?.trim() ?? "";
    if (busy || caseReason.length < 3) return;
    const payload = {
      studentId,
      caseId: item.id,
      status,
      reason: caseReason.trim(),
      ...(status === "resolved" && linkedCorrection
        ? { correctionId: linkedCorrection }
        : {}),
    };
    const signature = JSON.stringify([payload, item.version]);
    const key =
      decisionKey?.intent === signature ? decisionKey.key : crypto.randomUUID();
    setDecisionKey({ intent: signature, key });
    setBusy(true);
    setNotice("");
    try {
      await studioCommand("credits", {
        command: "case_decide",
        expectedVersion: item.version,
        idempotencyKey: key,
        payload,
        reason: payload.reason,
      });
      await review.refetch();
      setCaseReasons((current) => ({ ...current, [item.id]: "" }));
      setDecisionKey(undefined);
      setNotice("Review decision recorded.");
    } catch (error) {
      if (error instanceof ApiClientError && error.code === "VERSION_CONFLICT")
        await review.refetch();
      setNotice(
        error instanceof Error
          ? error.message
          : "Review decision could not be saved.",
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
                setFinding(undefined);
                setLinkedCorrection(undefined);
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
              {selected.terms?.originalExpiresAt &&
                selected.terms.originalExpiresAt !== selected.expiresAt && (
                  <p>
                    Original expiration{" "}
                    {formatStudioDateTime(
                      selected.terms.originalExpiresAt,
                      timezone,
                    )}
                  </p>
                )}
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
              {!!review.data.cases?.length && (
                <section aria-label="Reconciliation cases">
                  <h4>Reconciliation cases</h4>
                  {review.data.cases.map((item) => {
                    const closed =
                      item.status === "resolved" || item.status === "dismissed";
                    const options: CaseDecision[] = closed
                      ? ["reopened"]
                      : item.status === "under_review"
                        ? ["resolved", "dismissed"]
                        : ["under_review", "resolved", "dismissed"];
                    return (
                      <details
                        key={item.id}
                        name={formId + "-case"}
                        className="disclosure-section"
                      >
                        <summary>
                          {caseStatus[item.status]} ·{" "}
                          {findings[item.finding] ?? item.finding}
                        </summary>
                        <p>
                          Review the package history and affected reservations
                          below before deciding.
                        </p>
                        {!!item.evidence?.checkoutDuplicates.length && (
                          <details>
                            <summary>Confirmed source entries</summary>
                            <ul>
                              {item.evidence.checkoutDuplicates.map(
                                (duplicate) => (
                                  <li
                                    key={
                                      duplicate.entryId +
                                      duplicate.relatedEntryId
                                    }
                                  >
                                    {duplicate.entryId} and{" "}
                                    {duplicate.relatedEntryId}
                                  </li>
                                ),
                              )}
                            </ul>
                          </details>
                        )}
                        {item.history.length > 0 && (
                          <ul>
                            {item.history.map((entry, index) => (
                              <li key={index}>
                                {formatStudioDateTime(entry.at, timezone)} ·{" "}
                                {entry.reason}
                              </li>
                            ))}
                          </ul>
                        )}
                        <label htmlFor={item.id + "-decision"}>
                          Review reason
                          <textarea
                            id={item.id + "-decision"}
                            maxLength={500}
                            value={caseReasons[item.id] ?? ""}
                            onChange={(event) => {
                              const value = event.target.value;
                              setCaseReasons((current) => ({
                                ...current,
                                [item.id]: value,
                              }));
                            }}
                          />
                        </label>
                        <div className="header-actions">
                          {options.map((status) => (
                            <button
                              key={status}
                              disabled={
                                busy ||
                                (caseReasons[item.id]?.trim().length ?? 0) < 3
                              }
                              onClick={() => void decide(item, status)}
                            >
                              {
                                {
                                  under_review: "Start review",
                                  resolved: "Resolve",
                                  dismissed: "Dismiss",
                                  reopened: "Reopen",
                                }[status]
                              }
                            </button>
                          ))}
                        </div>
                      </details>
                    );
                  })}
                </section>
              )}
              {selected.issues.length > 0 && (
                <ul aria-label="Reconciliation findings">
                  {selected.issues.map((issue) => (
                    <li key={issue}>
                      <button
                        aria-expanded={finding === issue}
                        onClick={() =>
                          setFinding(finding === issue ? undefined : issue)
                        }
                      >
                        {findings[issue] ?? issue}
                      </button>
                      {finding === issue && (
                        <p>
                          {issue === "repeated_purchase_description" ||
                          issue === "purchase_source_unverified"
                            ? "Compare purchase references with the original grants in Package history. Reverse a grant only when its source confirms it was issued in error."
                            : issue.includes("reservation") ||
                                issue.includes("lesson") ||
                                issue === "orphaned_debit"
                              ? "Review the affected reservations and lesson entries below. Restore a credit only when the recorded completed-lesson debit was incorrect."
                              : "Review this package’s source entries before proposing a balance correction."}
                        </p>
                      )}
                    </li>
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
              <CreditExpiration
                key={selected.id}
                studentId={studentId}
                packageId={selected.id}
                expiresAt={selected.expiresAt}
                timezone={timezone}
              />
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
                    portalVisible,
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
                <label className="full" htmlFor={formId + "-portal-visible"}>
                  <input
                    id={formId + "-portal-visible"}
                    type="checkbox"
                    checked={portalVisible}
                    onChange={(event) => setPortalVisible(event.target.checked)}
                  />
                  Show adjustment in portal history
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
