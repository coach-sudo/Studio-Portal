import { Link, useSearchParams } from "react-router-dom";
import { CircleDollarSign } from "lucide-react";
import { EmptyState, Section } from "../../components/Primitives";
import { useInvoices } from "../../data/invoices";
import { formatMoney } from "../../domain/finance";
import { invoiceDue } from "../../domain/invoices";
import { formatStudioDateTime } from "../../domain/presentation";
import type { Lesson, StudioSnapshot } from "../../domain/model";
import { portalContextLink } from "../../domain/coachingContext";

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
  const [params] = useSearchParams();
  const selectedLesson = params.get("lesson");
  const {
    data: invoices,
    isLoading,
    error,
    refetch,
  } = useInvoices(isDemo, data.invoices, true);
  const studentInvoices = (invoices || []).filter(
    (invoice) =>
      invoice.student_id === studentId &&
      invoice.status !== "draft" &&
      invoice.status !== "void",
  );
  const available = selectedLesson
    ? studentInvoices.filter((invoice) =>
        invoice.items.some(
          (line) => !line.cancelled && line.lessonIds.includes(selectedLesson),
        ),
      )
    : studentInvoices.filter((invoice) => invoiceDue(invoice) > 0);
  const inactiveLesson =
    lesson && ["cancelled", "late_cancelled", "draft"].includes(lesson.status);
  const unavailable = Boolean(selectedLesson && !lesson && !available.length);
  return (
    <Section title="Pay for my lesson" marked>
      {lesson && (
        <p>
          <strong>{lesson.topic}</strong> ·{" "}
          {formatStudioDateTime(lesson.startsAt, data.settings.timezone)}
        </p>
      )}
      {isLoading ? (
        <p role="status">Checking lesson invoices…</p>
      ) : error ? (
        <p role="alert">
          Invoices are unavailable.{" "}
          <button type="button" onClick={() => void refetch()}>
            Retry
          </button>
        </p>
      ) : available.length ? (
        <div className="table-list">
          {available.map((invoice) => {
            const next = new URLSearchParams(params);
            next.set("invoice", invoice.id);
            const due = invoiceDue(invoice);
            return (
              <article key={invoice.id}>
                <CircleDollarSign aria-hidden="true" />
                <div>
                  <strong>{invoice.number}</strong>
                  <small>
                    {due
                      ? `${formatMoney(due, invoice.currency)} due`
                      : "No balance due"}
                  </small>
                </div>
                <Link
                  className={due ? "button-link primary" : "button-link"}
                  to={{ search: next.toString() }}
                >
                  {invoice.checkout_key
                    ? "Open payment status"
                    : due
                      ? "Pay invoice"
                      : "View invoice"}
                </Link>
              </article>
            );
          })}
        </div>
      ) : unavailable ? (
        <EmptyState
          title="Lesson payment unavailable"
          detail="Check that you are signed in to the account that received the payment link."
        />
      ) : inactiveLesson ? (
        <EmptyState
          title="No invoice for this lesson"
          detail="Message the studio if you have a question about the balance."
        />
      ) : lesson &&
        ["paid", "paid_by_credit", "waived"].includes(
          lesson.paymentStatus || "",
        ) ? (
        <EmptyState
          title="This lesson is covered"
          detail="There is no payment due for this lesson."
        />
      ) : (
        <EmptyState
          title={
            selectedLesson
              ? "No invoice ready for this lesson"
              : "You have no open invoices"
          }
          detail={
            selectedLesson
              ? "The studio can issue a lesson invoice or help apply any eligible credits."
              : "Choose a package or return to Payments to view past invoices."
          }
        />
      )}
      <div className="page-actions">
        {hasPackages && (
          <a
            href="#lesson-packages"
            className="button-link"
            onClick={(event) => {
              const packages = document.getElementById("lesson-packages");
              if (!packages) return;
              event.preventDefault();
              packages.focus({ preventScroll: true });
              packages.scrollIntoView({ block: "start" });
            }}
          >
            Compare packages
          </a>
        )}
        {selectedLesson && !available.length && (
          <Link to={portalContextLink("/portal/inbox", studentId)}>
            Message the studio
          </Link>
        )}
      </div>
    </Section>
  );
}
