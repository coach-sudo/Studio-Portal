import { useId, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { Section } from "../../components/Primitives";
import { studioCommand } from "../../data/bookingCommands";
import { useSearchIdentity } from "../../data/globalSearch";
import { formatMoney } from "../../domain/finance";
import {
  previewLessonAutopay,
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

const maximumSelectedLessons = 50;
const scopes: Record<AutopaySelection["scope"], string> = {
  existing: "Selected existing lessons",
  future: "Future lessons only",
  existing_and_future: "Selected existing and future lessons",
};

export function LessonAutopayPreview({
  studentId,
  initialLessonId,
  options,
  demoLessons,
}: {
  studentId: string;
  initialLessonId?: string;
  options: AutopayPreviewOptions;
  demoLessons?: readonly Lesson[];
}) {
  const actor = useSearchIdentity();
  const formId = useId();
  const { policy, currency, lessons } = options;
  const [scope, setScope] = useState<AutopaySelection["scope"]>(
    lessons.length ? "existing" : "future",
  );
  const [leadDays, setLeadDays] = useState(String(policy.minimumLeadDays));
  const [selected, setSelected] = useState(() =>
    initialLessonId && lessons.some(({ id }) => id === initialLessonId)
      ? [initialLessonId]
      : [],
  );
  const [preview, setPreview] = useState<AutopayProposal[]>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const existing = scope !== "future";
  const eligibleSelected = lessons.filter(({ id }) => selected.includes(id));

  async function review(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || (existing && eligibleSelected.length === 0)) return;
    const value = {
      studentId,
      scope,
      leadDays: Number(leadDays),
      existingLessonIds: existing ? eligibleSelected.map(({ id }) => id) : [],
      maximumLessonMinor: policy.maximumLessonMinor,
    };
    setBusy(true);
    setPreview(undefined);
    setError("");
    try {
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
            command: "training_autopay_preview",
            expectedVersion: 0,
            payload: value,
            reason: "Preview dates for automatic lesson payments",
          },
          actor ?? undefined,
        );
        setPreview(result.resource.preview);
      }
    } catch {
      setError(
        "The payment dates could not be previewed. Check the selection and try again.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section title="Automatic payments by lesson">
      <p>
        Preview only. A separate authorization is required to activate payments.
      </p>
      <p>
        This plan would pay each eligible lesson in full, up to{" "}
        {formatMoney(policy.maximumLessonMinor, currency)}. Use Pay now for a
        lesson added or moved inside the payment window.
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
                    setPreview(undefined);
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
                  setPreview(undefined);
                }}
              />
            </label>
          </div>
          <p>
            Enter 0 for the lesson day when the studio permits it. Dates use the
            studio time zone.
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
                      setPreview(undefined);
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
      {error && <p role="alert">{error}</p>}
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
                        <Link to={lessonPaymentPath(studentId, item.lessonId)}>
                          Pay now ·{" "}
                          {formatMoney(item.amountMinor, item.currency)}
                        </Link>
                      ) : (
                        <span>
                          {formatMoney(item.amountMinor, item.currency)} on{" "}
                          {formatStudioDateTime(item.payAt, policy.timeZone)}
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
    </Section>
  );
}
