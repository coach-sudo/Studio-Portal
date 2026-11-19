import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { EmptyState, Section } from "../../components/Primitives";
import { studioCommand } from "../../data/bookingCommands";
import { useInvoices } from "../../data/invoices";
import { useSearchIdentity } from "../../data/globalSearch";
import { formatMoney } from "../../domain/finance";
import { invoiceDue } from "../../domain/invoices";
import {
  formatCalendarDateKey,
  formatStudioDateTime,
} from "../../domain/presentation";
import type { Lesson, StudioSnapshot } from "../../domain/model";
import { portalContextLink } from "../../domain/coachingContext";
import {
  trainingArrangement,
  trainingObligations,
  type LessonObligation,
} from "../../domain/trainingArrangement";
import { invalidateStudioDomains } from "../../hooks/useStudio";
import "./LessonPaymentOptions.css";

interface Payers {
  ready: boolean;
  studentIds: string[];
  attempts: {
    id: string;
    studentId: string;
    status: "reserved" | "review";
    createdAt: string;
  }[];
}

interface CheckoutResult {
  id: string;
  status: "open" | "processing" | "settled" | "expired" | "failed" | "review";
  url?: string;
}

type VerifiedLessonQuote = {
  description: string;
  date: string;
  currency: string;
  version: number;
  amountMinor: number;
};

const lineKey = (item: LessonObligation) => `${item.invoiceId}:${item.lineId}`;

const paymentNotice: Record<
  Exclude<CheckoutResult["status"], "open">,
  string
> = {
  processing:
    "Your payment is processing. Check its status before paying again.",
  settled: "Payment confirmed. Your selected lessons have been paid.",
  expired:
    "This payment link has expired. Review the current balances to make a new payment.",
  failed: "The payment failed. You can select the lessons again and retry.",
  review: "The studio needs to review this payment.",
};

export function LessonPaymentOptions({
  data,
  isDemo,
  studentId,
  lesson,
  hasPackages,
}: {
  data: StudioSnapshot;
  isDemo: boolean;
  studentId: string;
  lesson?: Lesson;
  hasPackages: boolean;
}) {
  const [params, setParams] = useSearchParams();
  const queryClient = useQueryClient();
  const identity = useSearchIdentity();
  const selectedLesson = params.get("lesson");
  const attemptId = params.get("attempt");
  const {
    data: invoices,
    isLoading,
    error,
    refetch,
  } = useInvoices(isDemo, data.invoices, true);
  const studioInvoices = (invoices ?? []).filter(
    (invoice) => invoice.studio_id === data.studioId,
  );
  const studentIds = [
    ...new Set([
      studentId,
      ...studioInvoices.flatMap((invoice) =>
        ["open", "partially_paid"].includes(invoice.status)
          ? [invoice.student_id]
          : [],
      ),
    ]),
  ]
    .sort()
    .slice(0, 50);
  const payer = useQuery({
    queryKey: ["training-payment-payers", identity, studentId, studentIds],
    enabled: !isDemo && Boolean(invoices && identity),
    queryFn: async () =>
      (
        await studioCommand(
          "invoices",
          {
            command: "training_payers",
            expectedVersion: 0,
            payload: { studentIds },
            reason: "Determine permitted lesson payments",
          },
          identity ?? undefined,
        )
      ).resource as Payers,
  });
  const attempt = useQuery({
    queryKey: ["training-payment-attempt", identity, attemptId, studentId],
    enabled: !isDemo && Boolean(attemptId && identity),
    retry: false,
    queryFn: async () =>
      (
        await studioCommand(
          "invoices",
          {
            command: "training_status",
            entityId: attemptId ?? undefined,
            expectedVersion: 0,
            reason: "Check selected lesson payment status",
          },
          identity ?? undefined,
        )
      ).resource as CheckoutResult,
    refetchInterval: (query) =>
      query.state.data?.status === "processing" ? 4000 : false,
  });
  const canUseSelection = isDemo || Boolean(payer.data?.ready);
  const payableStudents = isDemo ? [studentId] : (payer.data?.studentIds ?? []);
  const studentInvoices = studioInvoices.filter(
    (invoice) => invoice.student_id === studentId,
  );
  const arrangement = trainingArrangement(data, studentId);
  const currentObligations = trainingObligations(
    studentInvoices,
    studentId,
    arrangement,
  ).filter((item) => !selectedLesson || item.lessonId === selectedLesson);
  const unbilled = useQuery({
    queryKey: ["training-verified-lesson", identity, studentId, selectedLesson],
    enabled: Boolean(
      identity &&
      selectedLesson &&
      !attemptId &&
      payer.data?.ready &&
      payableStudents.includes(studentId) &&
      !currentObligations.length &&
      data.settings.bookingDefaults.allowLearnerLessonInvoices,
    ),
    retry: false,
    queryFn: async () => {
      const { resource } = await studioCommand(
        "invoices",
        {
          command: "training_invoice_quote",
          expectedVersion: 0,
          payload: { studentId, lessonId: selectedLesson },
          reason: "Review an existing lesson price",
        },
        identity ?? undefined,
      );
      return resource?.version !== undefined
        ? (resource as VerifiedLessonQuote)
        : null;
    },
  });
  const householdObligations = selectedLesson
    ? []
    : payableStudents
        .filter((id) => id !== studentId)
        .flatMap((id) => trainingObligations(studioInvoices, id));
  const obligations = [...currentObligations, ...householdObligations];
  const eligible = obligations.filter(
    (item) => item.eligible && payableStudents.includes(item.studentId),
  );
  const [editedSelection, setEditedSelection] = useState<{
    scope: string;
    keys: string[];
  }>();
  const scope = `${identity}:${studentId}:${selectedLesson ?? ""}:${attemptId ?? ""}`;
  const keys =
    editedSelection?.scope === scope
      ? editedSelection.keys
      : selectedLesson
        ? eligible.map(lineKey)
        : [];
  const selected = eligible.filter((item) => keys.includes(lineKey(item)));
  const currencies = new Set(selected.map((item) => item.currency));
  const total = selected.reduce((sum, item) => sum + item.amountMinor, 0);
  const [checkoutBusy, setCheckoutBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const settlement = attempt.data?.status;
  useEffect(() => {
    if (!settlement || settlement === "open" || settlement === "processing")
      return;
    void queryClient.invalidateQueries({ queryKey: ["invoices"] });
    void queryClient.invalidateQueries({
      queryKey: ["training-payment-payers"],
    });
    void invalidateStudioDomains(queryClient, [
      "finance",
      "lessons",
      "booking",
    ]);
  }, [queryClient, settlement]);

  const readyLegacyInvoices = studentInvoices.filter(
    (invoice) =>
      !invoice.checkout_key?.startsWith("training:") &&
      invoiceDue(invoice) > 0 &&
      (!selectedLesson ||
        (invoice.items.filter((line) => !line.cancelled).length === 1 &&
          invoice.items.some(
            (line) =>
              !line.cancelled &&
              line.kind === "service" &&
              line.lessonIds.length === 1 &&
              line.lessonIds[0] === selectedLesson,
          ))),
  );
  const noAttempt = new URLSearchParams(params);
  noAttempt.delete("attempt");

  function select(next: string[]) {
    setEditedSelection({ scope, keys: next });
  }
  function showAttempt(id: string) {
    const next = new URLSearchParams(params);
    next.set("attempt", id);
    setParams(next, { replace: true });
  }
  async function startPayment() {
    if (!selected.length || currencies.size !== 1 || checkoutBusy) return;
    if (isDemo) {
      setNotice("Demo mode does not open a payment provider.");
      return;
    }
    const id = crypto.randomUUID();
    setNotice("");
    setCheckoutBusy(true);
    try {
      const { resource } = await studioCommand("invoices", {
        command: "training_start",
        expectedVersion: 0,
        idempotencyKey: id,
        payload: {
          studentId,
          items: selected.map(
            ({ invoiceId, invoiceVersion, lineId, lessonId, amountMinor }) => ({
              invoiceId,
              invoiceVersion,
              lineId,
              lessonId,
              amountMinor,
            }),
          ),
        },
        reason: "Payer confirmed selected lesson balances",
      });
      showAttempt(id);
      if (resource.url) window.location.assign(resource.url);
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : "Unable to start payment.",
      );
      // A provider session may have been created despite a lost response. The
      // available-attempt list will recover the same reservation.
      void queryClient.invalidateQueries({ queryKey: ["invoices"] });
      void queryClient.invalidateQueries({
        queryKey: ["training-payment-payers"],
      });
    } finally {
      setCheckoutBusy(false);
    }
  }
  async function cancelPayment() {
    if (!attemptId || checkoutBusy) return;
    setCheckoutBusy(true);
    setNotice("");
    try {
      await studioCommand("invoices", {
        command: "training_cancel",
        entityId: attemptId,
        expectedVersion: 0,
        reason: "Payer closed selected lesson checkout",
      });
      await attempt.refetch();
    } catch (error) {
      setNotice(
        error instanceof Error
          ? error.message
          : "Unable to close this payment.",
      );
    } finally {
      setCheckoutBusy(false);
    }
  }
  async function prepareInvoice(quote: VerifiedLessonQuote) {
    if (!selectedLesson || checkoutBusy) return;
    setCheckoutBusy(true);
    setNotice("");
    try {
      const { resource } = await studioCommand(
        "invoices",
        {
          command: "training_invoice_issue",
          expectedVersion: quote.version,
          payload: {
            studentId,
            lessonId: selectedLesson,
            version: quote.version,
            amountMinor: quote.amountMinor,
          },
          reason:
            "Payer approved creating the invoice at the verified lesson price",
        },
        identity ?? undefined,
      );
      if (!resource?.invoiceId)
        throw new Error(
          "The studio needs to review this lesson before you can pay.",
        );
      await refetch();
      void invalidateStudioDomains(queryClient, ["lessons", "finance"]);
    } catch (error) {
      setNotice(
        error instanceof Error
          ? error.message
          : "The invoice could not be prepared.",
      );
      await unbilled.refetch();
    } finally {
      setCheckoutBusy(false);
    }
  }
  const makeLink = (change: Record<string, string>) => {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(change)) next.set(key, value);
    return { search: next.toString() };
  };
  const invoicesAvailable =
    (!canUseSelection || isDemo) &&
    Boolean(readyLegacyInvoices.length) &&
    (isDemo || payableStudents.includes(studentId));
  const showEmpty =
    !isLoading &&
    !error &&
    !payer.isLoading &&
    !attemptId &&
    !obligations.length &&
    !invoicesAvailable &&
    !unbilled.isLoading &&
    !unbilled.data;
  const showSelection =
    canUseSelection && Boolean(obligations.length) && !attemptId;
  const canPickAll =
    eligible.length > 1 &&
    eligible.length <= 50 &&
    new Set(eligible.map((item) => item.currency)).size === 1;

  return (
    <Section title="Pay for my lesson" marked>
      {lesson && (
        <p>
          <strong>{lesson.topic}</strong> ·{" "}
          {formatStudioDateTime(lesson.startsAt, data.settings.timezone)}
        </p>
      )}
      {(isLoading || payer.isLoading || attempt.isLoading) && (
        <p role="status">Checking lesson payments…</p>
      )}
      {error && (
        <p role="alert">
          Invoices are unavailable.{" "}
          <button type="button" onClick={() => void refetch()}>
            Retry
          </button>
        </p>
      )}
      {payer.error && (
        <p role="alert">
          Payer access could not be verified.{" "}
          <button type="button" onClick={() => void payer.refetch()}>
            Retry
          </button>
        </p>
      )}
      {notice && (
        <p className="portal-notice" role="status">
          {notice}
        </p>
      )}
      {unbilled.isLoading && (
        <p role="status">Checking the saved lesson price…</p>
      )}
      {!obligations.length && unbilled.data && !attemptId && (
        <div className="training-payment-review">
          <p>
            <strong>{unbilled.data.description}</strong> ·{" "}
            {formatCalendarDateKey(unbilled.data.date)} ·{" "}
            {formatMoney(unbilled.data.amountMinor, unbilled.data.currency)}
          </p>
          <p>Prepare the invoice to review the full balance before payment.</p>
          <button
            type="button"
            className="primary"
            disabled={checkoutBusy}
            onClick={() => unbilled.data && void prepareInvoice(unbilled.data)}
          >
            Prepare invoice
          </button>
        </div>
      )}
      {!attemptId &&
        payer.data?.attempts.map((saved) => (
          <p key={saved.id}>
            <Link
              to={makeLink({ attempt: saved.id, student: saved.studentId })}
            >
              {saved.status === "review"
                ? "View payment under review"
                : "Resume open lesson payment"}
            </Link>
          </p>
        ))}
      {attemptId && (
        <div className="training-payment-outcome">
          {attempt.error && (
            <p role="alert">
              This payment attempt is unavailable. Return to lesson payments to
              check current balances.
            </p>
          )}
          {attempt.data?.status === "open" ? (
            <>
              <p>Your lesson payment is open.</p>
              <div className="page-actions">
                {attempt.data.url && (
                  <a className="button-link primary" href={attempt.data.url}>
                    Resume secure checkout
                  </a>
                )}
                <button
                  type="button"
                  disabled={checkoutBusy}
                  onClick={() => void cancelPayment()}
                >
                  Close checkout
                </button>
              </div>
            </>
          ) : (
            settlement &&
            settlement !== "open" && (
              <p role="status">{paymentNotice[settlement]}</p>
            )
          )}
          <Link to={{ search: noAttempt.toString() }}>
            Back to lesson payments
          </Link>
        </div>
      )}
      {showSelection && (
        <>
          <fieldset className="training-payment-picker">
            <legend>
              {selectedLesson ? "Lesson balance" : "Choose lessons to pay for"}
            </legend>
            {canPickAll && (
              <button
                type="button"
                onClick={() =>
                  select(
                    selected.length === eligible.length
                      ? []
                      : eligible.map(lineKey),
                  )
                }
              >
                {selected.length === eligible.length
                  ? "Clear selection"
                  : "Select all eligible lessons"}
              </button>
            )}
            {obligations.map((item) => (
              <label
                className="training-payment-line"
                key={lineKey(item)}
                htmlFor={`obligation-${lineKey(item)}`}
              >
                <input
                  id={`obligation-${lineKey(item)}`}
                  type="checkbox"
                  checked={selected.some(
                    (row) => lineKey(row) === lineKey(item),
                  )}
                  disabled={
                    checkoutBusy ||
                    !item.eligible ||
                    !payableStudents.includes(item.studentId)
                  }
                  onChange={(event) =>
                    select(
                      event.target.checked
                        ? [...keys, lineKey(item)]
                        : keys.filter((key) => key !== lineKey(item)),
                    )
                  }
                />
                <span>
                  <strong>{item.description}</strong>
                  <small>
                    {formatCalendarDateKey(item.date)} · {item.invoiceNumber}
                    {item.studentId !== studentId
                      ? ` · ${item.studentName ?? "Household lesson"}`
                      : ""}
                  </small>
                  <small>
                    {item.pending
                      ? "Payment processing"
                      : !item.eligible
                        ? "Payment under review"
                        : !payableStudents.includes(item.studentId)
                          ? "Your designated payer manages this payment"
                          : item.adjustmentsMinor > 0
                            ? `Adjusted by ${formatMoney(item.adjustmentsMinor, item.currency)}`
                            : ""}
                  </small>
                </span>
                <strong>{formatMoney(item.amountMinor, item.currency)}</strong>
              </label>
            ))}
          </fieldset>
          {selected.length > 0 && (
            <div className="training-payment-review">
              {currencies.size > 1 ? (
                <p role="alert">Choose one currency for each payment.</p>
              ) : (
                <p aria-live="polite">
                  <strong>
                    {selected.length}{" "}
                    {selected.length === 1 ? "lesson" : "lessons"} selected ·{" "}
                    {formatMoney(total, selected[0].currency)} total
                  </strong>
                </p>
              )}
              <button
                type="button"
                className="primary"
                disabled={
                  checkoutBusy || currencies.size !== 1 || selected.length > 50
                }
                onClick={() => void startPayment()}
              >
                {checkoutBusy
                  ? "Opening checkout…"
                  : "Continue to secure checkout"}
              </button>
            </div>
          )}
        </>
      )}
      {!attemptId && invoicesAvailable && (
        <div className="page-actions">
          {readyLegacyInvoices.map((invoice) => (
            <Link
              key={invoice.id}
              className="button-link"
              to={makeLink({ invoice: invoice.id })}
            >
              {invoice.checkout_key ? "Open payment status" : "Pay invoice"}
              {!selectedLesson && ` ${invoice.number}`}
            </Link>
          ))}
        </div>
      )}
      {showEmpty && (
        <EmptyState
          title={
            selectedLesson
              ? "No payable balance for this lesson"
              : "No eligible lesson balances"
          }
          detail={
            selectedLesson
              ? "Check with the studio if you expected a payment to be due."
              : "You can review past invoices and available packages in Payments."
          }
        />
      )}
      {!canUseSelection &&
        obligations.length > 0 &&
        !invoicesAvailable &&
        !attemptId && (
          <p>
            {payableStudents.includes(studentId)
              ? "Exact lesson checkout is currently unavailable. Ask the studio to review these balances."
              : "Your designated payer can manage the lesson balance."}
          </p>
        )}
      <div className="page-actions">
        {hasPackages && (
          <a href="#lesson-packages" className="button-link">
            Compare packages
          </a>
        )}
        {selectedLesson && showEmpty && (
          <Link to={portalContextLink("/portal/inbox", studentId)}>
            Message the studio
          </Link>
        )}
      </div>
    </Section>
  );
}
