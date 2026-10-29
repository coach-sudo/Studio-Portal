import { useEffect, useId, useRef, useState } from "react";
import { ApiClientError } from "../data/apiClientError";
import {
  clearLessonPaymentAttempt,
  loadLessonPayment,
  saveLessonPayment,
} from "../data/lessonPayments";
import {
  paymentReviewMessage,
  type LessonPaymentContext,
  type LessonPaymentReceipt as Receipt,
} from "../domain/lessonPayment";
import { formatMoney } from "../domain/finance";
export function LessonPaymentReceipt({
  lessonId,
  isDemo,
  onSaved,
}: {
  lessonId: string;
  isDemo: boolean;
  onSaved: () => Promise<void>;
}) {
  const fieldId = useId();
  const activeLesson = useRef(lessonId);
  activeLesson.current = lessonId;
  const [context, setContext] = useState<LessonPaymentContext>(),
    [amount, setAmount] = useState(""),
    [method, setMethod] = useState<"cash" | "bank">("cash"),
    [reason, setReason] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [unknown, setUnknown] = useState(false),
    [receipt, setReceipt] = useState<Receipt>(),
    [refreshFailed, setRefreshFailed] = useState(false),
    [reload, setReload] = useState(0);
  useEffect(() => {
    setReceipt(undefined);
    setUnknown(false);
    setRefreshFailed(false);
    setBusy(false);
    setAmount("");
    setMethod("cash");
    setReason("");
  }, [lessonId, isDemo]);
  useEffect(() => {
    let current = true;
    setContext(undefined);
    setError("");
    if (isDemo) return;
    void loadLessonPayment(lessonId)
      .then((value) => {
        if (!current) return;
        // An already committed request may now have a paid/ineligible fresh
        // context. Its retained original envelope must still recover a receipt.
        setContext(value.attempt?.context ?? value.context);
        setUnknown(!!value.attempt);
        if (value.attempt) {
          setAmount(String(value.attempt.request.amountMinor / 100));
          setMethod(value.attempt.request.method);
          setReason(value.attempt.request.reason);
        }
      })
      .catch((e: unknown) => {
        if (current)
          setError(
            e instanceof Error
              ? e.message
              : "Payment context could not be loaded.",
          );
      });
    return () => {
      current = false;
    };
  }, [lessonId, isDemo, reload]);
  const refresh = async () => {
    const target = lessonId;
    setBusy(true);
    try {
      await onSaved();
      if (activeLesson.current === target) setRefreshFailed(false);
    } catch {
      if (activeLesson.current === target) setRefreshFailed(true);
    } finally {
      if (activeLesson.current === target) setBusy(false);
    }
  };
  if (isDemo)
    return (
      <p>
        Recording a payment requires the live studio accounting command. Demo
        financial history is unchanged.
      </p>
    );
  if (receipt)
    return (
      <div role="status">
        <p>
          Payment recorded: {formatMoney(receipt.amountMinor, receipt.currency)}
          . Receipt {receipt.receiptId}.
        </p>
        {refreshFailed && (
          <>
            <p>The payment is saved, but these records could not refresh.</p>
            <button
              type="button"
              disabled={busy}
              onClick={() => void refresh()}
            >
              Refresh records
            </button>
          </>
        )}
      </div>
    );
  if (!context)
    return (
      <div>
        <p role={error ? "alert" : "status"}>
          {error || "Loading payment details…"}
        </p>
        {error && (
          <button type="button" onClick={() => setReload((n) => n + 1)}>
            Retry payment details
          </button>
        )}
      </div>
    );
  if (!context.eligible && !unknown)
    return <p role="status">{paymentReviewMessage(context.reasonCode)}</p>;
  return (
    <form
      className="workflow-form"
      aria-label="Record lesson payment"
      onSubmit={async (event) => {
        const target = lessonId;
        event.preventDefault();
        if (busy) return;
        const raw = Number(amount),
          minor = Math.round(raw * 100);
        if (
          !/^\d+(\.\d{1,2})?$/.test(amount) ||
          !Number.isSafeInteger(minor) ||
          minor <= 0 ||
          minor > context.remainingMinor ||
          reason.trim().length < 3
        ) {
          setError(
            "Enter the actual positive amount received within the remaining balance and a reason.",
          );
          return;
        }
        setBusy(true);
        setError("");
        try {
          const saved = await saveLessonPayment(context, {
            lessonId,
            version: context.version,
            reviewToken: context.reviewToken,
            amountMinor: minor,
            currency: context.currency!,
            method,
            reason: reason.trim(),
          });
          if (activeLesson.current !== target) return;
          setReceipt(saved);
          setUnknown(false);
          try {
            await onSaved();
          } catch {
            if (activeLesson.current === target) setRefreshFailed(true);
          }
        } catch (e) {
          if (activeLesson.current !== target) return;
          // A prior unknown outcome remains unknown after access is revoked or
          // context changes. VERSION_CONFLICT also represents key conflicts in
          // the shared HTTP contract, so it cannot authorize a fresh identity.
          const rejectedBeforeCommit =
            !unknown &&
            e instanceof ApiClientError &&
            ["VALIDATION_FAILED", "REVIEW_REQUIRED"].includes(e.code);
          if (rejectedBeforeCommit) {
            await clearLessonPaymentAttempt(lessonId);
            setUnknown(false);
            if (e.code !== "VALIDATION_FAILED") setReload((n) => n + 1);
          } else setUnknown(true);
          setError(
            e instanceof ApiClientError && e.code === "FORBIDDEN"
              ? "This payment request is retained. Restore the original coach account and its studio access before recovering the same receipt. Do not record the money again."
              : e instanceof ApiClientError &&
                  ["VERSION_CONFLICT", "IDEMPOTENCY_CONFLICT"].includes(e.code)
                ? "This payment key needs financial review. The original request is retained; recovery will reuse that key. Do not start another payment for this money."
                : e instanceof Error
                  ? e.message
                  : "The payment response is unknown. Retry this same request.",
          );
        } finally {
          if (activeLesson.current === target) setBusy(false);
        }
      }}
    >
      <p>
        Record money already received. Remaining:{" "}
        {formatMoney(context.remainingMinor, context.currency!)}. Price,
        attendance, credits and notifications stay unchanged.
      </p>
      <label htmlFor={`${fieldId}-amount`}>
        Amount received ({context.currency})
        <input
          id={`${fieldId}-amount`}
          aria-label={`Amount received (${context.currency})`}
          inputMode="decimal"
          value={amount}
          disabled={busy || unknown}
          onChange={(e) => setAmount(e.target.value)}
          required
        />
      </label>
      <label htmlFor={`${fieldId}-method`}>
        Payment method
        <select
          id={`${fieldId}-method`}
          aria-label="Payment method"
          value={method}
          disabled={busy || unknown}
          onChange={(e) => setMethod(e.target.value as typeof method)}
        >
          <option value="cash">Cash</option>
          <option value="bank">Bank transfer</option>
        </select>
      </label>
      <label htmlFor={`${fieldId}-reason`}>
        Payment reason
        <input
          id={`${fieldId}-reason`}
          aria-label="Payment reason"
          value={reason}
          disabled={busy || unknown}
          onChange={(e) => setReason(e.target.value)}
          minLength={3}
          maxLength={1000}
          required
        />
      </label>
      {error && <p role="alert">{error}</p>}
      {unknown && (
        <p role="status">
          The response is unknown. Retry recovers this exact payment request.
        </p>
      )}
      <button className="primary" type="submit" disabled={busy}>
        {busy
          ? "Recording…"
          : unknown
            ? "Recover payment receipt"
            : "Record payment"}
      </button>
    </form>
  );
}
