import { useId, useRef, useState } from "react";
import {
  Dialog,
  EmptyState,
  Section,
  Status,
} from "../../components/Primitives";
import { formatMoney } from "../../domain/finance";
import { invoiceBilling } from "../../domain/invoiceBilling";
import {
  lessonInvoiceFor,
  verifiedInvoiceLesson,
  type Invoice,
  type InvoiceLine,
} from "../../domain/invoices";
import type { StudioSnapshot } from "../../domain/model";
import { lessonBillingStatus } from "../../domain/lessonPayment";
import { formatStudioDate, studioDateKey } from "../../domain/presentation";
import { InvoicePayerSetup } from "./InvoicePayerSetup";

export function LessonInvoiceComposer({
  data,
  isDemo,
  invoices,
  studentId,
  lessonId,
  initial,
  onClose,
  onOpen,
  onSave,
}: {
  data: StudioSnapshot;
  isDemo: boolean;
  invoices: Invoice[];
  studentId?: string;
  lessonId?: string;
  initial?: Invoice;
  onClose: () => void;
  onOpen: (invoice: Invoice) => void;
  onSave: (
    invoice: Invoice,
    status: "draft" | "open",
    key: string,
  ) => Promise<void>;
}) {
  const fields = useId();
  const [account, setAccount] = useState(
    initial?.student_id ?? studentId ?? "",
  );
  const [selection, setSelection] = useState(
    initial?.items.flatMap((line) => line.lessonIds) ??
      (lessonId ? [lessonId] : []),
  );
  const [review, setReview] = useState<InvoiceLine[]>();
  const [due, setDue] = useState(
    () =>
      initial?.due_date ??
      studioDateKey(
        new Date(Date.now() + 14 * 86400000),
        data.settings.timezone,
      ),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const attempt = useRef<{ signature: string; key: string } | null>(null);
  const student = data.students.find((entry) => entry.id === account);
  const billing = student && invoiceBilling(student, data.linkedContacts);
  const accountContacts = data.linkedContacts.filter(
    (contact) => contact.studentId === account,
  );
  const canChooseHouseholdPayer =
    accountContacts.some(
      (contact) => contact.portalEnabled && contact.canViewFinance,
    ) && !accountContacts.some((contact) => contact.isPrimaryPayer);
  const issue = studioDateKey(new Date(), data.settings.timezone);
  const currency = data.settings.currency;
  const otherInvoices = invoices.filter(
    (invoice) => invoice.id !== initial?.id,
  );
  const lessons = data.lessons
    .filter((lesson) => lesson.studentId === account)
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  const rows = lessons.map((lesson) => ({
    lesson,
    existing: lessonInvoiceFor(otherInvoices, lesson.id),
    eligible: verifiedInvoiceLesson(data, lesson, account),
  }));
  const available = rows.filter(
    ({ existing, eligible }) => eligible && !existing,
  );
  const picked = available.filter(({ lesson }) =>
    selection.includes(lesson.id),
  );
  const count = review?.length ?? picked.length;
  const total = review
    ? review.reduce((sum, line) => sum + line.unitMinor, 0)
    : picked.reduce((sum, { lesson }) => sum + (lesson.priceMinor ?? 0), 0);

  function reviewSelection() {
    setError("");
    setReview(
      picked.map(({ lesson }) => {
        const date = studioDateKey(lesson.startsAt, data.settings.timezone);
        return {
          id:
            initial?.items.find((line) => line.lessonIds.includes(lesson.id))
              ?.id ?? crypto.randomUUID(),
          kind: "service",
          referenceId: lesson.serviceId!,
          description:
            lesson.topic ||
            data.bookingServices.find(
              (service) => service.id === lesson.serviceId,
            )!.name,
          quantity: 1,
          unitMinor: lesson.priceMinor!,
          startsOn: date,
          endsOn: date,
          lessonIds: [lesson.id],
          lessonVersion: lesson.version,
          verifiedLesson: true,
          paidMinor: 0,
          creditMinor: 0,
        };
      }),
    );
  }

  async function save(status: "draft" | "open") {
    if (!review?.length || !billing || busy) return;
    setError("");
    if (!due || due < issue) {
      setError("Choose a due date on or after the issue date.");
      return;
    }
    setBusy(true);
    const document: Invoice = {
      id: initial?.id ?? "",
      studio_id: data.studioId,
      student_id: account,
      number: initial?.number ?? "DRAFT",
      status,
      currency,
      issue_date: issue,
      due_date: due,
      introduction: initial?.introduction ?? "",
      notes: initial?.notes ?? "",
      footer: initial?.footer ?? "",
      branding: initial?.branding ?? {
        studioName: data.settings.studioName,
        email: data.settings.contactEmail,
        logoStoragePath: data.settings.branding.logoStoragePath,
        logoUrl: data.settings.branding.logoUrl,
      },
      recipient: billing.recipient,
      items: review,
      total_minor: total,
      paid_minor: 0,
      credit_minor: 0,
      version: initial?.version ?? 0,
      created_at: initial?.created_at ?? new Date().toISOString(),
    };
    const signature = JSON.stringify([status, account, issue, due, review]);
    if (attempt.current?.signature !== signature)
      attempt.current = { signature, key: crypto.randomUUID() };
    try {
      await onSave(document, status, attempt.current.key);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Invoice could not be saved.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      className="lesson-invoice-dialog"
      title={
        review
          ? "Review invoice"
          : initial
            ? "Edit draft invoice"
            : "Create invoice"
      }
      description={
        review
          ? "Confirm the billed lessons and choose a due date."
          : "Select outstanding lessons for the same billing account."
      }
      onClose={() => !busy && onClose()}
    >
      <div className="lesson-invoice-grid">
        <Section title={review ? "Invoice items" : "Select lessons"}>
          {!studentId && !initial && !review && (
            <label
              className="lesson-invoice-field"
              htmlFor={`${fields}-invoice-account`}
            >
              Billing account
              <select
                id={`${fields}-invoice-account`}
                value={account}
                onChange={(event) => {
                  setAccount(event.target.value);
                  setSelection([]);
                }}
              >
                <option value="">Choose a student</option>
                {data.students
                  .filter((entry) => !entry.deletedAt)
                  .map((entry) => (
                    <option key={entry.id} value={entry.id}>
                      {entry.fullName}
                    </option>
                  ))}
              </select>
            </label>
          )}
          {review ? (
            <>
              <ul className="lesson-invoice-rows">
                {review.map((line) => (
                  <li key={line.id}>
                    <span>
                      <strong>{line.description}</strong>
                      <small>{line.startsOn}</small>
                    </span>
                    <strong>{formatMoney(line.unitMinor, currency)}</strong>
                  </li>
                ))}
              </ul>
              <label
                className="lesson-invoice-field"
                htmlFor={`${fields}-invoice-due`}
              >
                Due date
                <input
                  id={`${fields}-invoice-due`}
                  type="date"
                  value={due}
                  min={issue}
                  required
                  disabled={busy}
                  onChange={(event) => setDue(event.target.value)}
                />
              </label>
            </>
          ) : (
            <>
              {available.length > 1 && (
                <button
                  onClick={() =>
                    setSelection(
                      picked.length === available.length
                        ? []
                        : available.slice(0, 50).map(({ lesson }) => lesson.id),
                    )
                  }
                >
                  {picked.length === available.length
                    ? "Clear selection"
                    : available.length > 50
                      ? "Select first 50"
                      : "Select all eligible"}
                </button>
              )}
              {student && !rows.length && (
                <EmptyState
                  title="No eligible lessons"
                  detail="Verified lessons with an outstanding balance will appear here."
                />
              )}
              <ul className="lesson-invoice-rows">
                {rows.map(({ lesson, existing, eligible }) => {
                  const date = formatStudioDate(
                    lesson.startsAt,
                    data.settings.timezone,
                  );
                  return (
                    <li key={lesson.id}>
                      {existing ? (
                        <>
                          <span>
                            <strong>{lesson.topic}</strong>
                            <small>{date}</small>
                          </span>
                          <button onClick={() => onOpen(existing)}>
                            {existing.status === "draft"
                              ? "Open draft invoice"
                              : "View linked invoice"}
                          </button>
                        </>
                      ) : eligible ? (
                        <label htmlFor={`${fields}-${lesson.id}`}>
                          <span className="visually-hidden">
                            Invoice lesson
                          </span>
                          <input
                            id={`${fields}-${lesson.id}`}
                            type="checkbox"
                            checked={selection.includes(lesson.id)}
                            disabled={
                              picked.length >= 50 &&
                              !selection.includes(lesson.id)
                            }
                            onChange={(event) =>
                              setSelection(
                                event.target.checked
                                  ? [...selection, lesson.id]
                                  : selection.filter((id) => id !== lesson.id),
                              )
                            }
                          />
                          <span>
                            <strong>{lesson.topic}</strong>
                            <small>{date}</small>
                          </span>
                          <span className="lesson-invoice-amount">
                            <Status tone="warn">Payment needed</Status>
                            <strong>
                              {formatMoney(lesson.priceMinor!, currency)}
                            </strong>
                          </span>
                        </label>
                      ) : (
                        <>
                          <span>
                            <strong>{lesson.topic}</strong>
                            <small>{date}</small>
                          </span>
                          <Status>{lessonBillingStatus(lesson)}</Status>
                        </>
                      )}
                    </li>
                  );
                })}
              </ul>
              {selection.length !== picked.length && (
                <p role="status">
                  Some previously selected lessons are no longer eligible.
                </p>
              )}
            </>
          )}
        </Section>
        <div className="lesson-invoice-summary">
          <Section title={review ? "Billing and delivery" : "Invoice summary"}>
            {billing && (
              <div className="lesson-invoice-payer">
                <small>Bill to</small>
                <strong>{billing.recipient.name}</strong>
                {billing.recipient.email && (
                  <span>{billing.recipient.email}</span>
                )}
                {(billing.issueError || billing.deliveryError) && (
                  <>
                    <p>{billing.issueError ?? billing.deliveryError}</p>
                  </>
                )}
                {student &&
                  (billing.issueError ||
                    billing.deliveryError ||
                    canChooseHouseholdPayer) && (
                    <InvoicePayerSetup
                      key={student.id}
                      student={student}
                      contacts={accountContacts}
                      isDemo={isDemo}
                      label={
                        billing.issueError
                          ? "Set up payer"
                          : billing.deliveryError
                            ? "Review payer email"
                            : "Change designated payer"
                      }
                    />
                  )}
                {review && !billing.deliveryError && (
                  <p>Review and send email after issuance.</p>
                )}
              </div>
            )}
            <p>
              {count} {count === 1 ? "lesson" : "lessons"} selected
            </p>
            <strong className="lesson-invoice-total">
              {formatMoney(total, currency)}
            </strong>
            {error && (
              <p role="alert" className="inline-error">
                {error}
              </p>
            )}
            <div className="header-actions lesson-invoice-actions">
              {review ? (
                <>
                  <button
                    className="primary"
                    disabled={busy || !!billing?.issueError}
                    onClick={() => void save("open")}
                  >
                    {busy ? "Saving…" : "Issue invoice"}
                  </button>
                  <button disabled={busy} onClick={() => void save("draft")}>
                    Save draft
                  </button>
                  <button
                    disabled={busy}
                    onClick={() => {
                      setReview(undefined);
                      setError("");
                    }}
                  >
                    Back
                  </button>
                </>
              ) : (
                <>
                  <button
                    className="primary"
                    disabled={!picked.length}
                    onClick={reviewSelection}
                  >
                    Review invoice
                  </button>
                  <button onClick={onClose}>Cancel</button>
                </>
              )}
            </div>
          </Section>
        </div>
      </div>
    </Dialog>
  );
}
