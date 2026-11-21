import { useId, useRef, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { Dialog, Section } from "../../components/Primitives";
import { studioCommand } from "../../data/bookingCommands";
import { useSearchIdentity } from "../../data/globalSearch";
import { formatMoney } from "../../domain/finance";
import {
  lessonAutopayConsentVersion,
  previewLessonAutopay,
  type LessonAutopayPlan,
  type AutopayPreviewOptions,
  type AutopayProposal,
  type AutopaySelection,
} from "../../domain/lessonAutopay";
import { lessonPaymentPath } from "../../domain/lessonPaymentLink";
import type { Lesson } from "../../domain/model";
import {
  formatCalendarDateKey,
  formatStudioDateTime,
} from "../../domain/presentation";
import "./LessonPaymentOptions.css";
import { useLessonAutopayAccount } from "./useLessonAutopayOptions";

const maximumSelectedLessons = 50;
const scopes: Record<AutopaySelection["scope"], string> = {
  existing: "Selected existing lessons",
  future: "Future lessons only",
  existing_and_future: "Selected existing and future lessons",
};
const managementCopy = {
  pause: {
    title: "Pause automatic payments",
    detail:
      "New automatic charges stop while this arrangement is paused. A payment already processing may still finish.",
  },
  resume: {
    title: "Resume automatic payments",
    detail:
      "Eligible future lessons can be charged under the existing authorization. A past or ineligible lesson still needs a separate payment.",
  },
  cancel: {
    title: "End automatic payments",
    detail:
      "New automatic charges under this arrangement stop. A payment already processing may still finish.",
  },
} as const;

export function LessonAutopayPreview({
  studentId,
  studentName,
  initialLessonId,
  bookedLessonIds,
  initialLeadDays,
  options,
  demoLessons,
}: {
  studentId: string;
  studentName: string;
  initialLessonId?: string;
  bookedLessonIds?: readonly string[];
  initialLeadDays?: number;
  options: AutopayPreviewOptions;
  demoLessons?: readonly Lesson[];
}) {
  const actor = useSearchIdentity();
  const formId = useId();
  const { policy, currency, lessons } = options;
  const [scope, setScope] = useState<AutopaySelection["scope"]>(
    lessons.length ? "existing" : "future",
  );
  const [leadDays, setLeadDays] = useState(() =>
    String(
      initialLeadDays !== undefined &&
        Number.isInteger(initialLeadDays) &&
        initialLeadDays >= policy.minimumLeadDays &&
        initialLeadDays <= policy.maximumLeadDays
        ? initialLeadDays
        : policy.minimumLeadDays,
    ),
  );
  const [selected, setSelected] = useState(() =>
    lessons
      .filter(
        ({ id }) => id === initialLessonId || bookedLessonIds?.includes(id),
      )
      .map(({ id }) => id),
  );
  const [preview, setPreview] = useState<AutopayProposal[]>();
  const [approval, setApproval] = useState<{
    digest: string;
    key: string;
    previous?: LessonAutopayPlan;
  }>();
  const [consented, setConsented] = useState(false);
  const [changing, setChanging] = useState(false);
  const [management, setManagement] = useState<{
    action: keyof typeof managementCopy;
    plan: LessonAutopayPlan;
  }>();
  const [busy, setBusy] = useState(false);
  const locked = useRef(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const existing = scope !== "future";
  const eligibleSelected = lessons.filter(({ id }) => selected.includes(id));
  const account = useLessonAutopayAccount(studentId, !demoLessons);
  const arrangement = account.data?.arrangement;
  const pending = account.data?.pending;
  const canSetUp = Boolean(account.data?.canSetUp);
  const value = {
    studentId,
    scope,
    leadDays: Number(leadDays),
    existingLessonIds: existing ? eligibleSelected.map(({ id }) => id) : [],
    maximumLessonMinor: policy.maximumLessonMinor,
  };

  function clearReview() {
    setPreview(undefined);
    setApproval(undefined);
    setConsented(false);
  }
  async function action(run: () => Promise<void>) {
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await run();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "The payment arrangement could not be updated.",
      );
    } finally {
      setBusy(false);
      locked.current = false;
    }
  }
  async function review(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (existing && eligibleSelected.length === 0) return;
    clearReview();
    await action(async () => {
      if (demoLessons) {
        const now = new Date();
        const effectiveAt = now.toISOString();
        const demoStartsAt = new Map(
          demoLessons.map(({ id, startsAt }) => [id, startsAt]),
        );
        setPreview(
          previewLessonAutopay(
            policy,
            { ...value, currency, effectiveAt },
            eligibleSelected
              .filter(({ id }) => demoStartsAt.has(id))
              .map(({ id, amountMinor }) => ({
                id,
                startsAt: demoStartsAt.get(id)!,
                createdAt: new Date(0).toISOString(),
                status: "scheduled",
                payment: "unpaid",
                obligation: {
                  amountMinor,
                  currency,
                  eligible: true,
                },
              })),
            now,
          ),
        );
      } else {
        const result = await studioCommand(
          "invoices",
          {
            command: canSetUp
              ? "training_autopay_review"
              : "training_autopay_preview",
            expectedVersion: 0,
            payload: value,
            reason: "Preview dates for automatic lesson payments",
          },
          actor ?? undefined,
        );
        setPreview(result.resource.preview);
        if (result.resource.reviewDigest)
          setApproval({
            digest: result.resource.reviewDigest,
            key: crypto.randomUUID(),
            previous: arrangement ?? undefined,
          });
      }
    });
  }
  async function authorizeSetup() {
    if (!approval || !consented || pending || !canSetUp) return;
    await action(async () => {
      try {
        const { resource } = await studioCommand(
          "invoices",
          {
            command: "training_autopay_authorize",
            idempotencyKey: approval.key,
            expectedVersion: approval.previous?.version ?? 0,
            payload: {
              ...value,
              consented: true,
              consentVersion: lessonAutopayConsentVersion,
              reviewDigest: approval.digest,
              replacesId: approval.previous?.id,
            },
            reason: "Authorize automatic payment for reviewed lesson terms",
          },
          actor ?? undefined,
        );
        if (resource.url) window.location.assign(resource.url);
        else setNotice("Stripe is verifying your payment method.");
      } finally {
        await account.refetch();
      }
    });
  }
  async function manage(
    command: "pause" | "resume" | "cancel" | "continue",
    plan: LessonAutopayPlan,
  ) {
    await action(async () => {
      const { resource } = await studioCommand(
        "invoices",
        {
          command: `training_autopay_${command}`,
          entityId: plan.id,
          expectedVersion: plan.version,
          payload: { studentId },
          reason: "Manage automatic lesson payments",
        },
        actor ?? undefined,
      );
      if (command === "continue") {
        if (resource.url) window.location.assign(resource.url);
        else setNotice("Stripe is verifying your payment method.");
      } else {
        setManagement(undefined);
        clearReview();
        setChanging(false);
        setNotice(
          command === "pause"
            ? "Automatic payments are paused."
            : command === "resume"
              ? "Automatic payments have resumed for eligible future dates."
              : "This payment arrangement has ended.",
        );
      }
      await account.refetch();
    });
  }

  return (
    <Section title="Automatic payments by lesson">
      {account.isError && (
        <p role="alert">The current payment arrangement could not be loaded.</p>
      )}
      {notice && <p role="status">{notice}</p>}
      {pending && (
        <div className="portal-notice">
          <p role="status">
            Payment method setup is pending. Payments under these terms start
            after Stripe confirms the setup.
          </p>
          <div className="identity-actions">
            {canSetUp && (
              <button
                type="button"
                disabled={busy}
                onClick={() => void manage("continue", pending)}
              >
                Continue payment setup
              </button>
            )}
            <button
              type="button"
              disabled={busy}
              onClick={() => void manage("cancel", pending)}
            >
              Cancel setup
            </button>
          </div>
        </div>
      )}
      {arrangement && (
        <div className="training-payment-review">
          <h3>
            {arrangement.needsReauthorization
              ? "Payment terms need review"
              : arrangement.status === "paused"
                ? "Automatic payments paused"
                : "Automatic payments authorized"}
          </h3>
          <p>
            {studentName} · {scopes[arrangement.scope]} ·{" "}
            {arrangement.methodLabel}
          </p>
          <p>
            {arrangement.leadDays === 0
              ? "On the lesson date"
              : `${arrangement.leadDays} day${arrangement.leadDays === 1 ? "" : "s"} before each eligible lesson`}{" "}
            · Up to{" "}
            {formatMoney(arrangement.maximumLessonMinor, arrangement.currency)}{" "}
            per lesson
          </p>
          <div className="identity-actions">
            <button
              type="button"
              disabled={
                busy ||
                (arrangement.status === "paused" &&
                  arrangement.needsReauthorization)
              }
              onClick={() => {
                setError("");
                setManagement({
                  action: arrangement.status === "paused" ? "resume" : "pause",
                  plan: arrangement,
                });
              }}
            >
              {arrangement.status === "paused" ? "Resume" : "Pause"}
            </button>
            {canSetUp && !pending && (
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  clearReview();
                  setChanging(!changing);
                }}
              >
                {changing ? "Close changes" : "Change terms or payment method"}
              </button>
            )}
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setError("");
                setManagement({ action: "cancel", plan: arrangement });
              }}
            >
              End automatic payments
            </button>
          </div>
          {arrangement.lessons.length > 0 && (
            <details
              open={
                arrangement.lessons.some(({ status }) => status === "failed") ||
                undefined
              }
            >
              <summary>Lesson payment dates and status</summary>
              <ul>
                {arrangement.lessons.map((item) => (
                  <li key={item.lessonId}>
                    {formatCalendarDateKey(item.date)} ·{" "}
                    {formatMoney(item.amountMinor, arrangement.currency)} ·{" "}
                    {item.status === "planned"
                      ? arrangement.needsReauthorization
                        ? "Needs review"
                        : arrangement.status === "paused"
                          ? "Paused"
                          : formatStudioDateTime(
                              item.payAt,
                              arrangement.timeZone,
                            )
                      : item.status === "in_flight"
                        ? "Processing"
                        : item.status === "succeeded"
                          ? "Paid"
                          : item.reason}
                    {(item.status === "failed" ||
                      item.status === "pay_now") && (
                      <>
                        {" "}
                        <Link to={lessonPaymentPath(studentId, item.lessonId)}>
                          Pay now
                        </Link>
                      </>
                    )}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
      {management && (
        <Dialog
          title={managementCopy[management.action].title}
          description={managementCopy[management.action].detail}
          onClose={() => {
            if (!busy) setManagement(undefined);
          }}
        >
          <p>Past payments stay on your account.</p>
          {error && <p role="alert">{error}</p>}
          <div className="form-actions">
            <button
              type="button"
              disabled={busy}
              onClick={() => setManagement(undefined)}
            >
              Keep current setting
            </button>
            <button
              type="button"
              className="primary"
              disabled={busy}
              onClick={() => void manage(management.action, management.plan)}
            >
              {busy ? "Saving…" : managementCopy[management.action].title}
            </button>
          </div>
        </Dialog>
      )}
      {(!arrangement || changing) && !pending && (
        <div>
          {!canSetUp && (
            <p>
              Preview only. A separate authorization is required to activate
              payments.
            </p>
          )}
          <p>
            This plan would pay each eligible lesson in full, up to{" "}
            {formatMoney(policy.maximumLessonMinor, currency)}. Use Pay now for
            a lesson added or moved inside the payment window.
          </p>
          <form onSubmit={review}>
            <fieldset className="training-payment-picker" disabled={busy}>
              <legend>Payment timing and scope</legend>
              <fieldset className="training-autopay-scope">
                <legend>Which lessons to include</legend>
                {Object.entries(scopes).map(([value, label]) => (
                  <label
                    className="training-payment-line"
                    key={value}
                    htmlFor={`${formId}-${value}`}
                  >
                    <input
                      type="radio"
                      id={`${formId}-${value}`}
                      name={`${formId}-scope`}
                      checked={scope === value}
                      disabled={value !== "future" && !lessons.length}
                      onChange={() => {
                        setScope(value as AutopaySelection["scope"]);
                        clearReview();
                      }}
                    />
                    {label}
                  </label>
                ))}
              </fieldset>
              <div className="form-grid">
                <label htmlFor={`${formId}-lead-days`}>
                  Days before each lesson
                  <input
                    id={`${formId}-lead-days`}
                    type="number"
                    inputMode="numeric"
                    required
                    value={leadDays}
                    min={policy.minimumLeadDays}
                    max={policy.maximumLeadDays}
                    step={1}
                    onChange={(event) => {
                      setLeadDays(event.target.value);
                      clearReview();
                    }}
                  />
                </label>
              </div>
              <p>
                Enter 0 for the lesson day when the studio permits it. Dates use
                the studio time zone.
              </p>
              {existing && (
                <fieldset className="training-payment-picker">
                  <legend>Lessons to include</legend>
                  {options.hasMore && (
                    <p>The first 100 upcoming lessons are in this preview.</p>
                  )}
                  {lessons.length > maximumSelectedLessons && (
                    <p>Choose up to {maximumSelectedLessons} lessons.</p>
                  )}
                  {lessons.map(({ id, date, amountMinor }) => (
                    <label
                      className="training-payment-line"
                      htmlFor={`${formId}-${id}`}
                      key={id}
                    >
                      <input
                        id={`${formId}-${id}`}
                        type="checkbox"
                        checked={selected.includes(id)}
                        disabled={
                          !selected.includes(id) &&
                          eligibleSelected.length >= maximumSelectedLessons
                        }
                        onChange={(event) => {
                          setSelected(
                            event.target.checked
                              ? [...eligibleSelected.map((item) => item.id), id]
                              : selected.filter((item) => item !== id),
                          );
                          clearReview();
                        }}
                      />
                      <span>{formatCalendarDateKey(date)}</span>
                      <strong>{formatMoney(amountMinor, currency)}</strong>
                    </label>
                  ))}
                </fieldset>
              )}
            </fieldset>
            <div className="training-payment-review">
              <button
                type="submit"
                disabled={busy || (existing && !eligibleSelected.length)}
              >
                {busy ? "Checking dates…" : "Preview payment dates"}
              </button>
            </div>
          </form>
          <div aria-live="polite">
            {preview && (
              <>
                <h3>Proposed payment dates</h3>
                {!preview.length && (
                  <p>
                    {existing
                      ? "There are no eligible dates in this selection."
                      : "New lessons can be evaluated as they are scheduled after enrollment."}
                  </p>
                )}
                {preview.length > 0 && (
                  <ul>
                    {preview.map((item) => {
                      return (
                        <li key={item.lessonId}>
                          <strong>{formatCalendarDateKey(item.date)} · </strong>
                          {item.state === "review" ? (
                            item.reason
                          ) : item.state === "pay_now" ? (
                            <Link
                              to={lessonPaymentPath(studentId, item.lessonId)}
                            >
                              Pay now ·{" "}
                              {formatMoney(item.amountMinor, item.currency)}
                            </Link>
                          ) : (
                            <span>
                              {formatMoney(item.amountMinor, item.currency)} on{" "}
                              {formatStudioDateTime(
                                item.payAt,
                                policy.timeZone,
                              )}
                            </span>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </>
            )}
          </div>
          {approval && !pending && (
            <fieldset className="training-payment-picker" disabled={busy}>
              <legend>Authorize automatic payments</legend>
              <p>
                {studentName} · Payer{" "}
                {account.data?.payerEmail || "your signed-in account"}
              </p>
              <p>
                Stripe will ask for the payment method to use. Coach’D will
                charge the full balance of each eligible lesson in this
                selection, up to{" "}
                {formatMoney(policy.maximumLessonMinor, currency)} per lesson,
                on the dates above or {leadDays} calendar days before eligible
                new lessons in your scope.
              </p>
              <p>
                You can pause or end future automatic payments here. Payments
                already processing may finish. Bookings stay on your schedule.
              </p>
              <p>
                If a lesson moves, its payment date follows the lead time. A
                move inside that window requires Pay now. If an automatic
                payment fails, the arrangement pauses and you can pay that
                lesson separately.
              </p>
              <label
                className="training-payment-line"
                htmlFor={`${formId}-consent`}
              >
                <input
                  id={`${formId}-consent`}
                  type="checkbox"
                  checked={consented}
                  onChange={(event) => setConsented(event.target.checked)}
                />
                I authorize these automatic lesson payments using the payment
                method I save with Stripe.
              </label>
              <button
                className="primary"
                type="button"
                disabled={!consented || busy}
                onClick={() => void authorizeSetup()}
              >
                Continue to Stripe payment setup
              </button>
            </fieldset>
          )}
        </div>
      )}
      {error && !management && <p role="alert">{error}</p>}
    </Section>
  );
}
