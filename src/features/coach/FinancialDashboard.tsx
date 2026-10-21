import { useQuery } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { loadFinancialDashboard } from "../../data/studioOperations";
import { usePrivateIdentity } from "../../hooks/usePrivateIdentity";
import { formatMoney } from "../../domain/finance";
import { Section, EmptyState, Status } from "../../components/Primitives";
import type { StudioSnapshot } from "../../domain/model";
import "./FinancialDashboard.css";

const names: Record<string, string> = {
  outstanding: "Outstanding invoices",
  receipts: "Collected payments",
  refunds: "Refunds",
  pending: "Pending checkout",
  dollarCredit: "Prepaid dollar credit",
  availableCredits: "Available lesson credits",
  reservedCredits: "Reserved lesson credits",
  remainingCredits: "Remaining lesson credits",
  packageExceptions: "Package & renewal exceptions",
};
const value = (n: number, unit: string, currency: string) =>
  unit === "money" ? formatMoney(n, currency) : String(n);
export function FinancialDashboard({
  data,
  isDemo,
}: {
  data: StudioSnapshot;
  isDemo: boolean;
}) {
  const [params, setParams] = useSearchParams(),
    identity = usePrivateIdentity();
  const defaultMonth = new Intl.DateTimeFormat("sv-SE", {
    timeZone: data.settings.timezone,
    year: "numeric",
    month: "2-digit",
  }).format(new Date());
  const month = /^\d{4}-\d{2}$/.test(params.get("month") || "")
    ? params.get("month")!
    : defaultMonth;
  const metric = params.get("metric") || undefined,
    currency = params.get("currency") || undefined,
    page = Math.max(1, Number(params.get("financePage")) || 1);
  const update = (patch: Record<string, string | undefined>) =>
    setParams((p) => {
      const next = new URLSearchParams(p);
      for (const [k, v] of Object.entries(patch)) {
        if (v) next.set(k, v);
        else next.delete(k);
      }
      return next;
    });
  const query = useQuery({
    queryKey: [
      "studio-financial-dashboard",
      identity,
      month,
      metric,
      currency,
      page,
    ],
    queryFn: ({ signal }) =>
      loadFinancialDashboard(month, metric, currency, page, signal),
    enabled: !isDemo && !!identity,
  });
  const totals = query.data?.totals || [];
  return (
    <Section
      title="Financial overview"
      marked
      aside={
        <label>
          Payment period
          <input
            type="month"
            value={month}
            onChange={(e) =>
              update({ month: e.target.value, financePage: undefined })
            }
          />
        </label>
      }
    >
      <p className="field-help">
        Payments and refunds: selected calendar month in{" "}
        {data.settings.timezone}. Invoices, checkout, credit balances and
        exceptions: current snapshot.
      </p>
      {!!query.data?.reviewCount && (
        <p role="status">
          <Status tone="warn">
            {query.data.reviewCount} accounts require financial review
          </Status>
        </p>
      )}
      {isDemo ? (
        <p>Connect a studio to view authoritative financial totals.</p>
      ) : query.isError ? (
        <p role="alert">
          Financial totals unavailable.{" "}
          <button onClick={() => void query.refetch()}>Retry</button>
        </p>
      ) : query.isPending ? (
        <p role="status">Loading financial overview…</p>
      ) : (
        <>
          <div className="finance-metrics">
            {Object.entries(names).map(([key, label]) => {
              const grouped = totals.filter((t) => t.metric === key);
              return (
                <article key={key}>
                  <h3>{label}</h3>
                  {grouped.length ? (
                    grouped.map((t) => (
                      <button
                        key={t.currency}
                        aria-pressed={metric === key && currency === t.currency}
                        onClick={() =>
                          update({
                            metric: key,
                            currency: t.currency,
                            financePage: undefined,
                          })
                        }
                      >
                        <strong>{value(t.amount, t.unit, t.currency)}</strong>
                        <small>
                          {t.unit === "money" ? t.currency : t.unit} · {t.count}{" "}
                          {t.unit === "credits" ? "accounts" : "records"}
                        </small>
                      </button>
                    ))
                  ) : (
                    <button
                      onClick={() =>
                        update({
                          metric: key,
                          currency: undefined,
                          financePage: undefined,
                        })
                      }
                    >
                      <strong>0</strong>
                      <small>No matching records</small>
                    </button>
                  )}
                </article>
              );
            })}
          </div>
          {metric && (
            <div className="finance-support">
              <header>
                <h3>{names[metric] || "Supporting records"}</h3>
                <button
                  onClick={() =>
                    update({
                      metric: undefined,
                      currency: undefined,
                      financePage: undefined,
                    })
                  }
                >
                  Close list
                </button>
              </header>
              <p>
                {query.data?.count} records · measured{" "}
                {new Date(query.data!.evaluatedAt).toLocaleTimeString()}
              </p>
              {!query.data?.items.length ? (
                <EmptyState
                  title="No matching records"
                  detail="No records contribute to this metric."
                />
              ) : (
                <div className="table-list">
                  {query.data.items.map((r) => (
                    <article key={r.metric + r.id + r.currency}>
                      <div>
                        <Link to={r.href}>{r.title || "Student account"}</Link>
                        <small>{r.state}</small>
                      </div>
                      <strong>{value(r.amount, r.unit, r.currency)}</strong>
                      {r.state === "Review required" && (
                        <Status tone="warn">Review required</Status>
                      )}
                    </article>
                  ))}
                </div>
              )}
              <footer>
                <button
                  disabled={page <= 1}
                  onClick={() => update({ financePage: String(page - 1) })}
                >
                  Previous
                </button>
                <span>Page {page}</span>
                <button
                  disabled={page * 25 >= (query.data?.count || 0)}
                  onClick={() => update({ financePage: String(page + 1) })}
                >
                  Next
                </button>
              </footer>
            </div>
          )}
        </>
      )}
    </Section>
  );
}
