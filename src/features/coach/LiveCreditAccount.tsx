import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useId, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Dialog, Section } from "../../components/Primitives";
import { loadCreditCoverage } from "../../data/creditCoverage";
import { studioCommand } from "../../data/bookingCommands";
import { creditApplicationResultSchema } from "../../domain/creditCoverage";
import {
  creditApplicationMessage,
  creditCoverageReasons,
} from "../../domain/creditCoveragePresentation";
import { formatStudioDateTime } from "../../domain/presentation";
import { usePrivateIdentity } from "../../hooks/usePrivateIdentity";
import { invalidateStudioDomains } from "../../hooks/useStudio";
import { ApiClientError } from "../../data/apiClientError";
import "../../components/StudentFinancialSummary.css";
import { StudentCreditHistory } from "../../components/StudentCreditHistory";
import { CreditPackageMetrics } from "../../components/CreditPackageMetrics";
import { PackageCreditReview } from "./PackageCreditReview";

export function LiveCreditAccount(props: {
  studentId: string;
  timezone: string;
  readOnly: boolean;
}) {
  const identity = usePrivateIdentity();
  return identity ? (
    <CreditControls
      key={`${identity}:${props.studentId}`}
      {...props}
      identity={identity}
    />
  ) : (
    <p role="status">Checking account access…</p>
  );
}

function CreditControls({
  studentId,
  timezone,
  readOnly,
  identity,
}: {
  studentId: string;
  timezone: string;
  readOnly: boolean;
  identity: string;
}) {
  const client = useQueryClient();
  const formId = useId();
  const [page, setPage] = useState(1);
  const [automatic, setAutomatic] = useState<boolean>();
  const [adjusting, setAdjusting] = useState(false);
  const [reconciling, setReconciling] = useState(false);
  const [adjustment, setAdjustment] = useState("set");
  const [quantity, setQuantity] = useState("");
  const [reviewed, setReviewed] = useState<{
    total: number;
    version: number;
    balance: { remaining: number; available: number; reserved: number };
  }>();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  // Preserve the key across an unknown transport result; changed intent gets a new key.
  const intent = useRef<{
    signature: string;
    key: string;
    version: number;
  } | null>(null);
  const coverage = useQuery({
    queryKey: ["credit-coverage", identity, studentId, page],
    queryFn: ({ signal }) =>
      loadCreditCoverage({ studentId, page, pageSize: 5 }, signal),
    refetchInterval: (query) =>
      query.state.data?.maintenance?.pending ? 5000 : 30000,
  });
  const preview = useQuery({
    queryKey: ["credit-coverage", identity, studentId, "preview"],
    enabled: automatic === true,
    queryFn: ({ signal }) =>
      loadCreditCoverage(
        { studentId, pageSize: 5, previewEnable: true },
        signal,
      ),
    staleTime: 0,
  });
  const current = coverage.isError ? undefined : coverage.data;
  const balance = current?.summary;
  const amount = quantity === "" ? NaN : Number(quantity);
  const total =
    adjustment === "set"
      ? amount
      : (balance?.remaining ?? 0) +
        (adjustment === "remove" ? -amount : amount);
  const canReview =
    !!balance &&
    !balance.needsReview &&
    Number.isInteger(amount) &&
    amount >= (adjustment === "set" ? 0 : 1) &&
    total >= balance.reserved &&
    total <= 100000 &&
    total !== balance.remaining &&
    reason.trim().length >= 3;

  async function save(
    command: "set_auto" | "apply_upcoming" | "set_total" | "reconcile",
  ) {
    if (busy || !current || readOnly || (command === "set_total" && !reviewed))
      return;
    const payload = {
      studentId,
      ...(command === "set_auto"
        ? { enabled: automatic }
        : command === "set_total"
          ? {
              total: reviewed?.total,
              reason: reason.trim(),
              reviewedBalance: reviewed?.balance,
            }
          : {}),
    };
    const signature = JSON.stringify([command, payload, reviewed?.version]);
    if (intent.current?.signature !== signature)
      intent.current = {
        signature,
        key: crypto.randomUUID(),
        version:
          command === "set_total" && reviewed
            ? reviewed.version
            : current.summary.version,
      };
    setBusy(true);
    setNotice("");
    try {
      const response = await studioCommand("credits", {
        command,
        expectedVersion: intent.current.version,
        payload,
        idempotencyKey: intent.current.key,
        reason:
          command === "set_total"
            ? reason.trim()
            : "Coach reviewed lesson credit coverage",
      });
      // Mutation is committed even if its response contract is unexpectedly incomplete.
      const parsed = creditApplicationResultSchema.safeParse(response.resource);
      setNotice(
        command === "reconcile"
          ? "Legacy reservation matching completed. Refresh coverage to verify the resulting account."
          : `${command === "set_auto" ? "Setting saved." : command === "set_total" ? "Credit balance saved." : "Coverage check completed."} ${parsed.success ? creditApplicationMessage(parsed.data) : "Coverage result unavailable; refresh to verify."}`,
      );
      intent.current = null;
      setAutomatic(undefined);
      setAdjusting(false);
      setReconciling(false);
      await Promise.all([
        client.invalidateQueries({ queryKey: ["credit-coverage"] }),
        client.invalidateQueries({ queryKey: ["student-workspace-summary"] }),
        client.invalidateQueries({ queryKey: ["invoices"] }),
        invalidateStudioDomains(client, [
          "finance",
          "lessons",
          "booking",
          "messaging",
        ]),
      ]);
    } catch (error) {
      if (
        error instanceof ApiClientError &&
        error.code === "VERSION_CONFLICT"
      ) {
        intent.current = null;
        setReviewed(undefined);
      }
      setNotice(
        `${error instanceof Error ? error.message : "Credit command failed."} Refresh coverage before starting a different change; retrying this same request is safe.`,
      );
      void coverage.refetch();
    } finally {
      setBusy(false);
    }
  }
  const rows = (source: NonNullable<typeof current>) => (
    <div className="table-list">
      {source.items.map((item) => (
        <article key={item.lessonId}>
          <div>
            <strong>
              {readOnly ? (
                <Link
                  to={`/portal/lessons/${item.lessonId}?student=${studentId}`}
                >
                  {item.topic}
                </Link>
              ) : (
                <Link
                  to={`/coach/students/${studentId}/lessons/${item.lessonId}`}
                >
                  {item.topic}
                </Link>
              )}
            </strong>
            <small>{formatStudioDateTime(item.startsAt, timezone)}</small>
          </div>
          <span>{creditCoverageReasons[item.reasonCode]}</span>
        </article>
      ))}
    </div>
  );
  return (
    <Section
      title="Lesson credits"
      aside={
        <button
          disabled={coverage.isFetching}
          onClick={() => void coverage.refetch()}
        >
          Refresh coverage
        </button>
      }
    >
      {current ? (
        <>
          {current.packages?.length ? (
            <div className="table-list">
              {current.packages.map((balance) => (
                <article key={balance.id}>
                  <div>
                    <strong>{balance.name}</strong>
                    <CreditPackageMetrics balance={balance} />
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <div className="account-metrics">
              {[
                ["Unused Credits", current.summary.remaining],
                ["Available to Book", current.summary.available],
                ["Reserved for Upcoming Lessons", current.summary.reserved],
              ].map(([label, value]) => (
                <div key={label}>
                  <small>{label}</small>
                  <strong>{value}</strong>
                </div>
              ))}
            </div>
          )}
          <div className="header-actions">
            <strong>
              Use credits automatically:{" "}
              {current.summary.autoApply === null
                ? "Needs review"
                : current.summary.autoApply
                  ? "On"
                  : "Off"}
            </strong>
            {!readOnly && (
              <button
                disabled={
                  busy ||
                  (current.summary.needsReview &&
                    current.summary.autoApply !== true)
                }
                onClick={() => setAutomatic(!current.summary.autoApply)}
              >
                {current.summary.autoApply ? "Turn off" : "Review and enable"}
              </button>
            )}
          </div>
          <p>
            One credit covers one eligible lesson. Existing reservations stay
            attached when automatic use is off.
          </p>
          {readOnly && <p>Your coach manages this setting.</p>}
          {current.summary.needsReview && (
            <p role="status">
              Credit history needs coach review before automatic use or balance
              changes.
            </p>
          )}
          {current.summary.autoApply === null && (
            <p>
              Package preferences differ. Review and choose a single automatic
              setting.
            </p>
          )}
          {current.summary.expired > 0 && (
            <p>
              {current.summary.expired} expired credits excluded from available.
            </p>
          )}
          {current.maintenance?.pending && (
            <p role="status">
              Coverage processing
              {current.maintenance.lastError
                ? " — a previous check failed; recovery is queued"
                : ""}
              . Totals reflect committed reservations.
            </p>
          )}
          {!readOnly && (
            <div className="header-actions">
              <button
                disabled={busy || current.summary.needsReview}
                onClick={() => void save("apply_upcoming")}
              >
                {busy ? "Processing…" : "Apply eligible credits now"}
              </button>
              <button
                disabled={
                  busy ||
                  current.summary.needsReview ||
                  (current.packages?.filter(
                    (lot) =>
                      !lot.expiresAt || Date.parse(lot.expiresAt) > Date.now(),
                  ).length ?? 0) > 1
                }
                onClick={() => {
                  setAdjustment("set");
                  setQuantity(String(current.summary.remaining));
                  setReason("");
                  setReviewed(undefined);
                  setNotice("");
                  setAdjusting(true);
                }}
              >
                Manage credits
              </button>
            </div>
          )}
          {current.lessonsVisible && (
            <details className="disclosure-section" open>
              <summary>
                Upcoming coverage · {current.counts?.covered} covered ·{" "}
                {current.counts?.eligible} eligible ·{" "}
                {current.counts?.uncovered} uncovered
              </summary>
              {rows(current)}
              {!current.total && <p>No upcoming lessons.</p>}
              <div className="header-actions">
                <button
                  disabled={page === 1 || coverage.isFetching}
                  onClick={() => setPage(page - 1)}
                >
                  Previous coverage
                </button>
                <span>Page {page}</span>
                <button
                  disabled={!current.hasMore || coverage.isFetching}
                  onClick={() => setPage(page + 1)}
                >
                  Next coverage
                </button>
              </div>
            </details>
          )}
        </>
      ) : (
        <p role={coverage.isError ? "alert" : "status"}>
          {coverage.isError
            ? "Credit coverage unavailable. Retry before making financial decisions."
            : "Loading authoritative credit coverage…"}
        </p>
      )}
      {notice && (
        <p className="portal-notice" role="status">
          {notice}
        </p>
      )}
      <StudentCreditHistory studentId={studentId} timezone={timezone} />
      {!readOnly && (
        <PackageCreditReview
          studentId={studentId}
          timezone={timezone}
          identity={identity}
        />
      )}
      {!readOnly && (
        <details className="disclosure-section">
          <summary>Legacy reconciliation</summary>
          <p>
            Review older series reservations only when their lesson associations
            are known. Ambiguous records are refused.
          </p>
          <button
            disabled={busy || !current}
            onClick={() => setReconciling(true)}
          >
            Review legacy reservations
          </button>
        </details>
      )}
      {reconciling && (
        <Dialog
          title="Review legacy reservations"
          onClose={() => !busy && setReconciling(false)}
        >
          <p>
            Match existing series reservations to their original lessons without
            changing the available balance. The server refuses ambiguous
            booking, lesson-count or ledger evidence.
          </p>
          <div className="form-actions">
            <button disabled={busy} onClick={() => setReconciling(false)}>
              Keep existing records
            </button>
            <button disabled={busy} onClick={() => void save("reconcile")}>
              Confirm matching reservations
            </button>
          </div>
          {notice && <p role="alert">{notice}</p>}
        </Dialog>
      )}
      {automatic !== undefined && (
        <Dialog
          title={
            automatic
              ? "Enable automatic credit use"
              : "Disable automatic credit use"
          }
          onClose={() => !busy && setAutomatic(undefined)}
        >
          {automatic ? (
            preview.isError ? (
              <p role="alert">Preview unavailable. Retry before confirming.</p>
            ) : preview.data ? (
              <>
                <p>
                  {preview.data.counts?.eligible} lessons could receive new
                  coverage; {preview.data.counts?.covered} already covered. This
                  preview does not save the setting.
                </p>
                {rows(preview.data)}
                {preview.data.hasMore && (
                  <p>
                    Showing the first 5 lessons; counts include the complete
                    upcoming set.
                  </p>
                )}
              </>
            ) : (
              <p role="status">Checking upcoming lessons…</p>
            )
          ) : (
            <p>
              Existing reservations remain. You can still apply eligible credits
              manually.
            </p>
          )}
          <div className="form-actions">
            <button disabled={busy} onClick={() => setAutomatic(undefined)}>
              Keep current setting
            </button>
            <button
              className="primary"
              disabled={
                busy ||
                (automatic &&
                  (!preview.data || preview.isError || preview.isFetching))
              }
              onClick={() => void save("set_auto")}
            >
              Confirm setting
            </button>
          </div>
          {notice && <p role="alert">{notice}</p>}
        </Dialog>
      )}
      {adjusting && balance && (
        <Dialog
          title="Manage lesson credits"
          onClose={() => !busy && setAdjusting(false)}
        >
          <form
            className="workflow-form"
            onSubmit={(event) => {
              event.preventDefault();
              if (reviewed) {
                void save("set_total");
              } else if (canReview) {
                setNotice("");
                setReviewed({
                  total,
                  version: balance.version,
                  balance: {
                    remaining: balance.remaining,
                    reserved: balance.reserved,
                    available: balance.available,
                  },
                });
              }
            }}
          >
            {reviewed ? (
              <div className="full">
                <p>
                  Unused Credits change from {reviewed.balance.remaining} to{" "}
                  {reviewed.total}.
                </p>
                <p>
                  Available to Book changes from {reviewed.balance.available} to{" "}
                  {reviewed.total - reviewed.balance.reserved} before automatic
                  reservations.
                </p>
                <p>
                  Reserved for Upcoming Lessons: {reviewed.balance.reserved}
                </p>
                <p>Reason: {reason.trim()}</p>
              </div>
            ) : (
              <>
                <label className="full" htmlFor={formId + "-action"}>
                  Adjustment
                  <select
                    id={formId + "-action"}
                    value={adjustment}
                    onChange={(event) => {
                      setAdjustment(event.target.value);
                      setQuantity(
                        event.target.value === "set"
                          ? String(balance.remaining)
                          : "",
                      );
                    }}
                  >
                    <option value="add">Add Credits</option>
                    <option value="remove">Remove Credits</option>
                    <option value="set">Set Correct Balance</option>
                  </select>
                </label>
                <label className="full" htmlFor={formId + "-quantity"}>
                  {adjustment === "set"
                    ? "New unused total"
                    : "Number of credits"}
                  <input
                    id={formId + "-quantity"}
                    type="number"
                    required
                    min={adjustment === "set" ? 0 : 1}
                    max={100000}
                    step={1}
                    value={quantity}
                    onChange={(event) => setQuantity(event.target.value)}
                  />
                  <small>
                    {balance.remaining} unused, including {balance.reserved}{" "}
                    reserved. Up to {Math.max(0, balance.available)} credits can
                    be removed.
                  </small>
                </label>
                {total < balance.reserved && (
                  <p className="full" role="alert">
                    This would remove reserved credits. Review upcoming coverage
                    before changing the balance.
                  </p>
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
              </>
            )}
            <div className="form-actions full">
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  if (reviewed) setReviewed(undefined);
                  else setAdjusting(false);
                }}
              >
                {reviewed ? "Back to edit" : "Cancel"}
              </button>
              <button
                className="primary"
                disabled={busy || (!reviewed && !canReview)}
              >
                {reviewed ? "Confirm credit adjustment" : "Review adjustment"}
              </button>
            </div>
            {notice && (
              <p className="full" role="alert">
                {notice}
              </p>
            )}
          </form>
        </Dialog>
      )}
    </Section>
  );
}
