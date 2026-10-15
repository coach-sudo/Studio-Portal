import { useQuery } from "@tanstack/react-query";
import { loadFinancialOverview } from "../data/studentWorkspace";
import { formatMoney } from "../domain/finance";
import { usePrivateIdentity } from "../hooks/usePrivateIdentity";
import { Section } from "./Primitives";
import "./StudentFinancialSummary.css";

export function StudentFinancialSummary({ studentId }: { studentId: string }) {
  const identity = usePrivateIdentity();
  const query = useQuery({
    queryKey: ["student-financial-summary", identity, studentId],
    enabled: !!identity,
    queryFn: ({ signal }) => loadFinancialOverview(studentId, signal),
    refetchInterval: 30000,
  });
  const summary = query.isError ? undefined : query.data;
  return (
    <Section title="Account summary">
      {summary ? (
        <>
          {summary.reviewRequired && (
            <p role="status">
              Review required — recorded obligations need verification. Known
              amounts are shown below.
            </p>
          )}
          <div className="account-metrics">
            {summary.balances.map((balance) => (
              <div key={balance.currency}>
                <small>Amount due · {balance.currency}</small>
                <strong>
                  {summary.reviewRequired
                    ? "Review required"
                    : formatMoney(balance.dueMinor, balance.currency)}
                </strong>
                {summary.reviewRequired && (
                  <small>
                    Known recorded amount:{" "}
                    {formatMoney(balance.dueMinor, balance.currency)}
                  </small>
                )}
              </div>
            ))}
            {!summary.balances.length && (
              <div>
                <small>Amount due</small>
                <strong>
                  {summary.reviewRequired
                    ? "Review required"
                    : "No recorded amount due"}
                </strong>
              </div>
            )}
            {summary.balances.map((balance) => (
              <div key={`credit:${balance.currency}`}>
                <small>Dollar account credit · {balance.currency}</small>
                <strong>
                  {balance.dollarCreditMinor < 0
                    ? "Review required"
                    : formatMoney(balance.dollarCreditMinor, balance.currency)}
                </strong>
              </div>
            ))}
            <div>
              <small>Unpaid invoices</small>
              <strong>{summary.unpaidInvoices}</strong>
            </div>
            <div>
              <small>Active packages</small>
              <strong>{summary.activePackages}</strong>
            </div>
          </div>
          {summary.pendingPayments > 0 && (
            <p>
              Payment processing is pending. Verify checkout before recording
              another payment.
            </p>
          )}
          {summary.renewalExceptions > 0 && (
            <p>
              {summary.renewalExceptions} package renewal(s) need payment or
              activation review.
            </p>
          )}
          {summary.expiringPackages > 0 && (
            <p>{summary.expiringPackages} package(s) expire within 30 days.</p>
          )}
        </>
      ) : (
        <p role={query.isError ? "alert" : "status"}>
          {query.isError
            ? "Review required — financial summary unavailable."
            : "Loading account summary…"}
        </p>
      )}
      {query.isError && (
        <button onClick={() => void query.refetch()}>
          Retry account summary
        </button>
      )}
    </Section>
  );
}
