import { useQuery } from "@tanstack/react-query";
import { useStudentFinancialOverview } from "../../hooks/useStudentFinancialOverview";
import { loadCreditCoverage } from "../../data/creditCoverage";
import { useInvoices } from "../../data/invoices";
import { creditTotals } from "../../domain/credits";
import { formatMoney } from "../../domain/finance";
import {
  invoiceDue,
  lessonInvoiceFor,
  verifiedInvoiceLesson,
} from "../../domain/invoices";
import type { StudioSnapshot } from "../../domain/model";
import { studioDateKey } from "../../domain/presentation";
import { usePrivateIdentity } from "../../hooks/usePrivateIdentity";
import "./InvoiceWorkspace.css";

export function CoachBillingSummary({
  data,
  studentId,
  isDemo,
}: {
  data: StudioSnapshot;
  studentId: string;
  isDemo: boolean;
}) {
  const identity = usePrivateIdentity();
  const overview = useStudentFinancialOverview(studentId, !isDemo);
  const invoices = useInvoices(isDemo, data.invoices);
  const coverage = useQuery({
    queryKey: ["credit-coverage", identity, studentId, 1],
    enabled: !isDemo && !!identity,
    queryFn: ({ signal }) =>
      loadCreditCoverage({ studentId, page: 1, pageSize: 5 }, signal),
  });
  const knownInvoices = (invoices.data ?? []).filter(
    (invoice) => invoice.student_id === studentId,
  );
  const currency = data.settings.currency;
  const today = studioDateKey(new Date(), data.settings.timezone);
  const overdue = knownInvoices.filter(
    (invoice) => invoice.due_date < today && invoiceDue(invoice) > 0,
  );
  const available = isDemo
    ? creditTotals(
        data.packages,
        data.creditEntries,
        data.lessons,
        studentId,
        Date.now(),
        data.lessonParticipants,
      ).available
    : coverage.isError
      ? undefined
      : coverage.data?.summary.available;
  const verifiedLessons = isDemo
    ? data.lessons.filter(
        (lesson) =>
          verifiedInvoiceLesson(data, lesson, studentId) &&
          !lessonInvoiceFor(
            knownInvoices.filter((invoice) => invoice.status !== "draft"),
            lesson.id,
          ),
      )
    : [];
  const demoTotal =
    verifiedLessons.reduce((sum, lesson) => sum + lesson.priceMinor!, 0) +
    knownInvoices.reduce((sum, invoice) => sum + invoiceDue(invoice), 0);
  const balances = isDemo
    ? [{ currency, dueMinor: demoTotal }]
    : overview.data?.balances;
  const overdueTotals = new Map<string, number>();
  for (const invoice of overdue) {
    overdueTotals.set(
      invoice.currency,
      (overdueTotals.get(invoice.currency) ?? 0) + invoiceDue(invoice),
    );
  }

  return (
    <div className="coach-billing-metrics" aria-label="Billing summary">
      <div>
        <small>Outstanding</small>
        <strong>
          {overview.isError
            ? "Unavailable"
            : balances
              ? balances
                  .map((balance) =>
                    formatMoney(balance.dueMinor, balance.currency),
                  )
                  .join(" · ") || formatMoney(0, currency)
              : "Loading…"}
        </strong>
        {overview.data?.reviewRequired && (
          <small>Known balance · Needs studio review</small>
        )}
        {!!overview.data?.pendingPayments && (
          <small>A payment is processing.</small>
        )}
      </div>
      <div>
        <small>Overdue</small>
        <strong>
          {invoices.error
            ? "Unavailable"
            : invoices.isLoading
              ? "Loading…"
              : [...overdueTotals]
                  .map(([code, amount]) => formatMoney(amount, code))
                  .join(" · ") || formatMoney(0, currency)}
        </strong>
        {!invoices.error && !invoices.isLoading && (
          <small>
            {overdue.length} past-due{" "}
            {overdue.length === 1 ? "invoice" : "invoices"}
          </small>
        )}
      </div>
      <div>
        <small>Available credits</small>
        <strong>
          {coverage.isError ? "Unavailable" : (available ?? "Loading…")}
        </strong>
        <small>For eligible lessons</small>
      </div>
    </div>
  );
}
