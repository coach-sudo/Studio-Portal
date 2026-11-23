import { useId, useState, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import {
  ArrowDownToLine,
  ArrowRight,
  Bell,
  ChartNoAxesCombined,
  Layers,
  WalletCards,
} from "lucide-react";
import {
  Drawer,
  EmptyState,
  Section,
  Status,
} from "../../components/Primitives";
import { InvoiceWorkspace } from "../finance/InvoiceWorkspace";
import {
  attentionKey,
  changeAttention,
  fetchReport,
  financePeriod,
  financeView,
  issueLabels,
  reports,
  useFinanceAttention,
  useFinanceReport,
  validFinanceRange,
  type DateRange,
  type FinanceIssue,
  type FinanceReport,
  type ReportFilters,
  type ReportName,
} from "../../data/financeCenter";
import type { StudioSnapshot } from "../../domain/model";
import { formatMoney } from "../../domain/finance";
import {
  formatStudioDateTime,
  formatCalendarDateKey,
} from "../../domain/presentation";
import "./FinanceCenter.css";

type Props = { data: StudioSnapshot; isDemo: boolean };
const views = [
  { id: "overview", title: "Overview", icon: ChartNoAxesCombined },
  { id: "payments", title: "Payments", icon: WalletCards },
  { id: "packages", title: "Packages & Credits", icon: Layers },
  { id: "attention", title: "Attention", icon: Bell },
] as const;
const metrics: { key: string; label: string; report: ReportName }[] = [
  { key: "gross", label: "Gross collections", report: "gross" },
  { key: "refunds", label: "Refunds", report: "refunds" },
  { key: "net", label: "Net collections", report: "collections" },
  { key: "outstanding", label: "Outstanding balances", report: "receivables" },
  { key: "overdue", label: "Overdue balances", report: "overdue" },
  {
    key: "scheduled",
    label: "Scheduled authorized collections",
    report: "scheduled",
  },
];
const kinds: Record<string, string> = {
  purchase: "Issued by purchase",
  adjustment: "Adjustment / restoration",
  consumption: "Consumed",
  reservation: "Reserved",
  release: "Released",
  expiration: "Expired",
  package_purchase: "Package purchase",
};
const label = (value: string) => kinds[value] || value.replaceAll("_", " ");
const money = (minor: number, currency: string) =>
  currency === "CREDITS" ? minor + " credits" : formatMoney(minor, currency);
const asReport = (key: string | null): ReportName | undefined =>
  key && Object.hasOwn(reports, key) ? (key as ReportName) : undefined;

function useFinanceLocation(zone: string) {
  const [params, setParams] = useSearchParams();
  const update = (patch: Record<string, string | undefined>, replace = false) =>
    setParams(
      (previous) => {
        const next = new URLSearchParams(previous);
        for (const [key, val] of Object.entries(patch)) {
          if (val) next.set(key, val);
          else next.delete(key);
        }
        return next;
      },
      { replace },
    );
  const period = params.get("period") || "this-month";
  const defaults = financePeriod(period, zone);
  const range =
    period === "custom"
      ? {
          start: params.get("from") ?? defaults.start,
          end: params.get("to") ?? defaults.end,
        }
      : defaults;
  const href = (
    view: string,
    report?: ReportName,
    currency?: string,
    issue?: string,
  ) => {
    const next = new URLSearchParams({ view });
    for (const key of ["period", "from", "to"]) {
      const value = params.get(key);
      if (value) next.set(key, value);
    }
    if (report) next.set("report", report);
    if (currency) next.set("currency", currency);
    if (issue) next.set("issue", issue);
    return "/coach/finance?" + next.toString();
  };
  return { params, update, period, range, href };
}
type Location = ReturnType<typeof useFinanceLocation>;

function RangePicker({ location }: { location: Location }) {
  const fieldId = useId();
  const { period, range, update } = location;
  return (
    <div className="finance-controls">
      <label htmlFor={fieldId + "-period"}>
        Period
        <select
          id={fieldId + "-period"}
          value={period}
          onChange={(e) => update({ period: e.target.value, page: undefined })}
        >
          <option value="this-month">This month</option>
          <option value="last-month">Last month</option>
          <option value="last-30">Last 30 days</option>
          <option value="last-90">Last 90 days</option>
          <option value="custom">Custom dates</option>
        </select>
      </label>
      {period === "custom" && (
        <>
          <label htmlFor={fieldId + "-from"}>
            From
            <input
              id={fieldId + "-from"}
              type="date"
              value={range.start}
              onChange={(e) =>
                update({ from: e.target.value, page: undefined })
              }
            />
          </label>
          <label htmlFor={fieldId + "-to"}>
            To
            <input
              id={fieldId + "-to"}
              type="date"
              value={range.end}
              onChange={(e) => update({ to: e.target.value, page: undefined })}
            />
          </label>
        </>
      )}
    </div>
  );
}

function QueryState({
  demo,
  error,
  retry,
}: {
  demo?: boolean;
  error?: boolean;
  retry: () => void;
}) {
  if (demo)
    return (
      <EmptyState
        title="Studio connection required"
        detail="Live reports are available for authorized studio coaches."
      />
    );
  if (error)
    return (
      <p role="alert">
        Finance data is unavailable. <button onClick={retry}>Retry</button>
      </p>
    );
  return (
    <p role="status" className="finance-loading">
      Loading finance data…
    </p>
  );
}

export function FinanceCenter({
  data,
  isDemo,
  packages,
}: Props & { packages: ReactNode }) {
  const location = useFinanceLocation(data.settings.timezone);
  const view = financeView(location.params);
  return (
    <div className="finance-center">
      <nav className="finance-nav" aria-label="Finance views">
        {views.map(({ id, title, icon: Icon }) => (
          <Link
            key={id}
            aria-current={view === id ? "page" : undefined}
            to={location.href(id)}
          >
            <Icon aria-hidden="true" size={18} />
            <span>{title}</span>
          </Link>
        ))}
      </nav>
      {view === "overview" && (
        <Overview data={data} isDemo={isDemo} location={location} />
      )}
      {view === "payments" && (
        <>
          <InvoiceWorkspace data={data} isDemo={isDemo} />
          <ReportPanel
            data={data}
            isDemo={isDemo}
            location={location}
            defaultReport="collections"
            scope="payments"
          />
        </>
      )}
      {view === "packages" && (
        <>
          {packages}
          <ReportPanel
            data={data}
            isDemo={isDemo}
            location={location}
            defaultReport="credits"
            scope="packages"
          />
        </>
      )}
      {view === "attention" && (
        <Attention data={data} isDemo={isDemo} location={location} />
      )}
    </div>
  );
}

function Overview({ data, isDemo, location }: Props & { location: Location }) {
  const valid = validFinanceRange(location.range);
  const query = useFinanceReport(
    data.studioId,
    location.range,
    { group: "overview" },
    isDemo,
    valid,
  );
  const attention = useFinanceAttention(
    data.studioId,
    { preview: true },
    isDemo,
  );
  const report = asReport(location.params.get("report"));
  return (
    <>
      <Section
        title="Financial summary"
        aside={<RangePicker location={location} />}
      >
        <p className="field-help">
          Collections follow the selected dates. Balances and scheduled
          collections reflect the current position.
        </p>
        {!valid ? (
          <p role="alert">Choose a valid date range of up to 366 days.</p>
        ) : !query.data ? (
          <QueryState
            demo={isDemo}
            error={query.isError}
            retry={() => void query.refetch()}
          />
        ) : (
          <div className="finance-summary">
            {metrics.map((metric) => {
              const totals = query.data.totals.filter(
                (item) => item.metric === metric.key,
              );
              return (
                <article key={metric.key}>
                  <h3>{metric.label}</h3>
                  {totals.length ? (
                    totals.map((item) => (
                      <Link
                        key={item.currency}
                        to={location.href(
                          "overview",
                          metric.report,
                          item.currency,
                        )}
                      >
                        <strong>{money(item.amount, item.currency)}</strong>
                        <ArrowRight aria-hidden="true" size={15} />
                      </Link>
                    ))
                  ) : (
                    <Link to={location.href("overview", metric.report)}>
                      <strong>0</strong>
                      <ArrowRight aria-hidden="true" size={15} />
                      <span className="finance-sr"> records</span>
                    </Link>
                  )}
                </article>
              );
            })}
          </div>
        )}
      </Section>
      {query.data && valid && (
        <CollectionsTrend
          trend={query.data.trend}
          range={location.range}
          selected={location.params.get("chartCurrency")}
          setCurrency={(value) => location.update({ chartCurrency: value })}
        />
      )}
      <Section
        title="Needs attention"
        aside={<Link to={location.href("attention")}>Open Attention</Link>}
      >
        {!attention.data ? (
          <QueryState
            demo={isDemo}
            error={attention.isError}
            retry={() => void attention.refetch()}
          />
        ) : !attention.data.items.length ? (
          <EmptyState
            title="All clear"
            detail="No open financial issues need review."
          />
        ) : (
          <ul className="finance-preview">
            {attention.data.items.map((item) => (
              <li key={item.id}>
                <Link
                  to={location.href("attention", undefined, undefined, item.id)}
                >
                  <strong>{issueLabels[item.kind]}</strong>
                  <span>
                    {item.student} · {item.title}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Section>
      <Section title="Reports">
        <div className="finance-report-links">
          {(["collections", "receivables", "packages", "credits"] as const).map(
            (item) => (
              <Link key={item} to={location.href("overview", item)}>
                {reports[item]} <ArrowRight aria-hidden="true" size={14} />
              </Link>
            ),
          )}
        </div>
      </Section>
      {report && (
        <Drawer
          title={reports[report]}
          onClose={() =>
            location.update({
              report: undefined,
              currency: undefined,
              search: undefined,
              status: undefined,
              kind: undefined,
              student: undefined,
              service: undefined,
              page: undefined,
              sort: undefined,
              filterDates: undefined,
            })
          }
        >
          <ReportPanel
            data={data}
            isDemo={isDemo}
            location={location}
            defaultReport={report}
            scope="context"
          />
        </Drawer>
      )}
    </>
  );
}

function CollectionsTrend({
  trend,
  range,
  selected,
  setCurrency,
}: {
  trend: FinanceReport["trend"];
  range: DateRange;
  selected: string | null;
  setCurrency: (currency: string) => void;
}) {
  const fieldId = useId();
  const currencies = [...new Set(trend.map((row) => row.currency))];
  const currency =
    currencies.find((item) => item === selected) ?? currencies[0];
  const days = trend.filter((point) => point.currency === currency);
  const duration =
    (Date.parse(range.end) - Date.parse(range.start)) / 86_400_000;
  const interval = duration > 90 ? "month" : duration > 30 ? "week" : "day";
  const buckets = new Map<string, { gross: number; refunds: number }>();
  const bucket = (date: Date) => {
    if (interval === "week")
      date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
    if (interval === "month") date.setUTCDate(1);
    return date.toISOString().slice(0, 10);
  };
  const cursor = new Date(range.start + "T12:00:00Z");
  const end = new Date(range.end + "T12:00:00Z");
  while (cursor <= end) {
    buckets.set(bucket(new Date(cursor)), { gross: 0, refunds: 0 });
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  for (const point of days) {
    const id = bucket(new Date(point.date_on + "T12:00:00Z"));
    const row = buckets.get(id) || { gross: 0, refunds: 0 };
    buckets.set(id, {
      gross: row.gross + point.gross,
      refunds: row.refunds + point.refunds,
    });
  }
  const values = [...buckets.entries()];
  const max = Math.max(
    1,
    ...values.map(([, row]) => Math.abs(row.gross - row.refunds)),
  );
  return (
    <Section
      title="Collections trend"
      aside={
        currencies.length > 1 && (
          <label htmlFor={fieldId + "-trend-currency"}>
            Currency{" "}
            <select
              id={fieldId + "-trend-currency"}
              value={currency}
              onChange={(event) => setCurrency(event.target.value)}
            >
              {currencies.map((item) => (
                <option key={item}>{item}</option>
              ))}
            </select>
          </label>
        )
      }
    >
      {!currency ? (
        <EmptyState
          title="No settled collections for this period"
          detail="Payments and monetary refunds appear here when recorded."
        />
      ) : (
        <>
          <p className="field-help">
            Net collections by {interval} · {currency}. Refunds appear when
            recorded.
          </p>
          <div className="finance-chart" aria-hidden="true">
            {values.map(([date, row]) => {
              const net = row.gross - row.refunds;
              return (
                <div
                  key={date}
                  className={net < 0 ? "finance-chart-negative" : ""}
                  title={
                    formatCalendarDateKey(date) + " · " + money(net, currency)
                  }
                >
                  <i
                    style={{
                      height: (Math.abs(net) / max) * 48 + "%",
                    }}
                  />
                </div>
              );
            })}
          </div>
          <div aria-hidden="true" className="finance-chart-axis">
            <span>{formatCalendarDateKey(values[0][0])}</span>
            <span>{formatCalendarDateKey(values.at(-1)![0])}</span>
          </div>
          <details>
            <summary>Chart data</summary>
            <ul className="finance-chart-data">
              {values.map(([date, row]) => (
                <li key={date}>
                  {formatCalendarDateKey(date)} · Gross{" "}
                  {money(row.gross, currency)} · Refunds{" "}
                  {money(row.refunds, currency)} · Net{" "}
                  {money(row.gross - row.refunds, currency)}
                </li>
              ))}
            </ul>
          </details>
        </>
      )}
    </Section>
  );
}

function Pagination({
  page,
  count,
  update,
}: {
  page: number;
  count: number;
  update: (page: number) => void;
}) {
  const last = Math.max(1, Math.ceil(count / 25));
  return count > 25 || page > 1 ? (
    <div className="finance-pagination">
      <button disabled={page <= 1} onClick={() => update(page - 1)}>
        Previous
      </button>
      <span>
        Page {page} of {last}
      </span>
      <button disabled={page >= last} onClick={() => update(page + 1)}>
        Next
      </button>
    </div>
  ) : null;
}

const payments: ReportName[] = [
  "collections",
  "receivables",
  "overdue",
  "scheduled",
];
const creditReports: ReportName[] = ["packages", "credits"];
const transactionKinds = ["payment", "refund", "package_purchase"];
const creditKinds = [
  "purchase",
  "adjustment",
  "reservation",
  "consumption",
  "release",
  "expiration",
];

function ReportPanel({
  data,
  isDemo,
  location,
  defaultReport,
  scope,
}: Props & {
  location: Location;
  defaultReport: ReportName;
  scope: "payments" | "packages" | "context";
}) {
  const fieldId = useId();
  const { params, range, update } = location;
  const selected = asReport(params.get("report"));
  const choices =
    scope === "packages"
      ? creditReports
      : scope === "payments"
        ? payments
        : undefined;
  const group =
    selected && (!choices || choices.includes(selected))
      ? selected
      : defaultReport;
  const snapshot = ["receivables", "overdue", "scheduled"].includes(group);
  const page = Math.max(1, Math.min(100000, Number(params.get("page")) || 1));
  const filters: ReportFilters = {
    group,
    page,
    currency: params.get("currency") ?? undefined,
    search: params.get("search") ?? undefined,
    status: params.get("status") ?? undefined,
    kind: params.get("kind") ?? undefined,
    student: params.get("student") ?? undefined,
    service: params.get("service") ?? undefined,
    sort: params.get("sort") ?? undefined,
    filterDates: snapshot && params.get("filterDates") === "1",
  };
  const [exporting, setExporting] = useState(false);
  const [notice, setNotice] = useState("");
  const valid = validFinanceRange(range);
  const read = useFinanceReport(data.studioId, range, filters, isDemo, valid);
  const filter = (key: string, value: string) =>
    update({ [key]: value, page: undefined }, key === "search");
  const exportRows = async () => {
    setExporting(true);
    setNotice("");
    try {
      const result = await fetchReport(
        data.studioId,
        range,
        filters,
        undefined,
        true,
      );
      if (result.csv === null) {
        setNotice(
          "More than 5,000 records match. Narrow the dates or filters and export again.",
        );
        return;
      }
      const url = URL.createObjectURL(
        new Blob([result.csv], { type: "text/csv;charset=utf-8" }),
      );
      const download = document.createElement("a");
      download.href = url;
      download.download =
        "finance-" + group + "-" + range.start + "-to-" + range.end + ".csv";
      download.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setNotice("CSV exported.");
    } catch {
      setNotice("The export could not be generated. Try again.");
    } finally {
      setExporting(false);
    }
  };
  const currencies = [
    ...new Set(
      [
        data.settings.currency,
        filters.currency,
        ...(read.data?.currencies ?? []),
      ].filter(Boolean),
    ),
  ];
  const types =
    group === "credits"
      ? creditKinds
      : group === "collections"
        ? transactionKinds
        : [];
  return (
    <Section
      title={
        scope === "context"
          ? "Report details"
          : scope === "packages"
            ? "Package and credit history"
            : "Financial history"
      }
      aside={
        <button
          disabled={!read.data || read.data.count === 0 || exporting}
          onClick={() => void exportRows()}
        >
          <ArrowDownToLine aria-hidden="true" size={16} />
          {exporting ? "Exporting…" : "Export CSV"}
        </button>
      }
    >
      <RangePicker location={location} />
      <div className="finance-controls">
        {choices && (
          <label htmlFor={fieldId + "-report"}>
            Report
            <select
              id={fieldId + "-report"}
              value={group}
              onChange={(event) =>
                update({
                  report: event.target.value,
                  page: undefined,
                  status: undefined,
                  kind: undefined,
                  currency: undefined,
                  filterDates: undefined,
                })
              }
            >
              {choices.map((choice) => (
                <option key={choice} value={choice}>
                  {reports[choice]}
                </option>
              ))}
            </select>
          </label>
        )}
        <label htmlFor={fieldId + "-search"}>
          Search
          <input
            id={fieldId + "-search"}
            type="search"
            maxLength={120}
            value={filters.search || ""}
            onChange={(e) => filter("search", e.target.value)}
            placeholder="Student, payer, or record"
          />
        </label>
        <label htmlFor={fieldId + "-student"}>
          Student
          <select
            id={fieldId + "-student"}
            value={filters.student || ""}
            onChange={(e) => filter("student", e.target.value)}
          >
            <option value="">All students</option>
            {data.students.map((student) => (
              <option key={student.id} value={student.id}>
                {student.fullName}
              </option>
            ))}
          </select>
        </label>
        <label htmlFor={fieldId + "-service"}>
          Service
          <select
            id={fieldId + "-service"}
            value={filters.service || ""}
            onChange={(e) => filter("service", e.target.value)}
          >
            <option value="">All services</option>
            {data.bookingServices.map((service) => (
              <option key={service.id} value={service.id}>
                {service.name}
              </option>
            ))}
          </select>
        </label>
        {group !== "credits" && (
          <label htmlFor={fieldId + "-currency"}>
            Currency
            <select
              id={fieldId + "-currency"}
              value={filters.currency || ""}
              onChange={(e) => filter("currency", e.target.value)}
            >
              <option value="">All currencies</option>
              {currencies.map((currency) => (
                <option key={currency} value={currency}>
                  {currency}
                </option>
              ))}
            </select>
          </label>
        )}
        {types.length > 0 && (
          <label htmlFor={fieldId + "-kind"}>
            Type
            <select
              id={fieldId + "-kind"}
              value={filters.kind || ""}
              onChange={(e) => filter("kind", e.target.value)}
            >
              <option value="">All types</option>
              {types.map((type) => (
                <option value={type} key={type}>
                  {label(type)}
                </option>
              ))}
            </select>
          </label>
        )}
        {group === "receivables" && (
          <label htmlFor={fieldId + "-status"}>
            Status
            <select
              id={fieldId + "-status"}
              value={filters.status || ""}
              onChange={(e) => filter("status", e.target.value)}
            >
              <option value="">All statuses</option>
              {[
                "due",
                "open",
                "overdue",
                "partially_paid",
                "checkout_pending",
              ].map((status) => (
                <option key={status} value={status}>
                  {label(status)}
                </option>
              ))}
            </select>
          </label>
        )}
        <label htmlFor={fieldId + "-sort"}>
          Sort
          <select
            id={fieldId + "-sort"}
            value={filters.sort || "newest"}
            onChange={(e) => filter("sort", e.target.value)}
          >
            <option value="newest">Newest first</option>
            <option value="oldest">Oldest first</option>
          </select>
        </label>
      </div>
      {snapshot && (
        <label className="finance-check" htmlFor={fieldId + "-date-filter"}>
          <input
            id={fieldId + "-date-filter"}
            type="checkbox"
            checked={filters.filterDates}
            onChange={(e) => filter("filterDates", e.target.checked ? "1" : "")}
          />
          {group === "scheduled"
            ? "Filter by collection date"
            : "Filter by applicable due date"}
        </label>
      )}
      {snapshot && (
        <p className="field-help">
          {group === "scheduled"
            ? "Current future authorized collections. Amounts remain outstanding until settled."
            : "Current verified balances. Obligations without a verified amount are excluded. Lessons without an explicit due date aren’t classified as overdue."}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      {!valid ? (
        <p role="alert">Choose a valid date range of up to 366 days.</p>
      ) : !read.data ? (
        <QueryState
          demo={isDemo}
          error={read.isError}
          retry={() => void read.refetch()}
        />
      ) : (
        <>
          <p role="status">{read.data.count} matching records</p>
          <div className="finance-report-totals">
            {read.data.reportTotals.map((total) => (
              <span key={total.kind + total.currency}>
                {label(total.kind)}{" "}
                <strong>{money(total.amount, total.currency)}</strong>
              </span>
            ))}
          </div>
          {read.data.services.length > 0 && (
            <details>
              <summary>Collections by service</summary>
              <ul className="finance-chart-data">
                {read.data.services.map((row) => (
                  <li key={row.service + row.currency}>
                    <strong>{row.service}</strong> · Gross{" "}
                    {money(row.gross, row.currency)} · Refunds{" "}
                    {money(row.refunds, row.currency)} · Net{" "}
                    {money(row.gross - row.refunds, row.currency)}
                  </li>
                ))}
              </ul>
            </details>
          )}
          {read.data.rows.length ? (
            <ul className="finance-records">
              {read.data.rows.map((row) => (
                <li key={row.kind + row.id}>
                  <div>
                    <Link to={row.href}>{row.title}</Link>
                    <small>
                      {row.student}
                      {row.payer && row.payer !== row.student
                        ? " · " + row.payer
                        : ""}
                      {row.service ? " · " + row.service : ""}
                    </small>
                    <small>
                      {row.date_on
                        ? formatCalendarDateKey(row.date_on) + " · "
                        : ""}
                      {label(row.kind)}
                      {row.method ? " · " + label(row.method) : ""}
                    </small>
                  </div>
                  <div>
                    <strong>{money(row.amount, row.currency)}</strong>
                    <Status
                      tone={row.status === "overdue" ? "warn" : "neutral"}
                    >
                      {label(row.status)}
                    </Status>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState
              title="No matching records"
              detail="Change the report dates or clear a filter to see other records."
            />
          )}
          <Pagination
            page={page}
            count={read.data.count}
            update={(value) => update({ page: String(value) })}
          />
          {scope === "context" && (
            <Link
              to={location.href(
                creditReports.includes(group) ? "packages" : "payments",
                group === "gross" || group === "refunds"
                  ? "collections"
                  : group,
                filters.currency,
              )}
            >
              Open{" "}
              {creditReports.includes(group)
                ? "Packages & Credits"
                : "Payments"}
            </Link>
          )}
        </>
      )}
    </Section>
  );
}

const nextSteps: Record<FinanceIssue["kind"], string> = {
  overdue_invoice:
    "Review the invoice balance and follow up with the authorized payer.",
  failed_payment:
    "Open the lesson and review its remaining balance and payment options.",
  invoice_delivery:
    "Open the invoice to verify the recipient and review delivery options.",
  payer_review: "Review payer permissions in the student account.",
  credit_reconciliation: "Open the package to review the reconciliation case.",
  package_expiring:
    "Review the remaining credits and expiration in the package.",
};
const severityNames: Record<number, string> = {
  3: "High",
  2: "Review",
  1: "Informational",
};

function Attention({ data, isDemo, location }: Props & { location: Location }) {
  const fieldId = useId();
  const { params, update } = location;
  const queue = params.get("queue") || "open";
  const page = Math.min(10000, Math.max(1, Number(params.get("page")) || 1));
  const issueId = params.get("issue") || "";
  const result = useFinanceAttention(
    data.studioId,
    {
      ...(issueId
        ? { id: issueId }
        : {
            queue,
            kind: params.get("kind") ?? undefined,
            severity: params.get("severity") ?? undefined,
            student: params.get("student") ?? undefined,
            page,
          }),
    },
    isDemo,
  );
  const setFilter = (key: string, value: string) =>
    update({ [key]: value, page: undefined });
  return (
    <Section title="Financial attention">
      <div className="finance-controls">
        <label htmlFor={fieldId + "-queue"}>
          Queue
          <select
            id={fieldId + "-queue"}
            value={queue}
            onChange={(e) => setFilter("queue", e.target.value)}
          >
            <option value="open">Open issues</option>
            <option value="snoozed">Snoozed</option>
            <option value="history">Resolved and dismissed</option>
          </select>
        </label>
        <label htmlFor={fieldId + "-issue-type"}>
          Issue type
          <select
            id={fieldId + "-issue-type"}
            value={params.get("kind") || ""}
            onChange={(e) => setFilter("kind", e.target.value)}
          >
            <option value="">All issues</option>
            {Object.entries(issueLabels).map(([value, title]) => (
              <option value={value} key={value}>
                {title}
              </option>
            ))}
          </select>
        </label>
        <label htmlFor={fieldId + "-severity"}>
          Severity
          <select
            id={fieldId + "-severity"}
            value={params.get("severity") || ""}
            onChange={(e) => setFilter("severity", e.target.value)}
          >
            <option value="">All severity levels</option>
            {[3, 2, 1].map((value) => (
              <option value={value} key={value}>
                {severityNames[value]}
              </option>
            ))}
          </select>
        </label>
        <label htmlFor={fieldId + "-student"}>
          Student
          <select
            id={fieldId + "-student"}
            value={params.get("student") || ""}
            onChange={(e) => setFilter("student", e.target.value)}
          >
            <option value="">All students</option>
            {data.students.map((student) => (
              <option value={student.id} key={student.id}>
                {student.fullName}
              </option>
            ))}
          </select>
        </label>
      </div>
      {!result.data ? (
        <QueryState
          demo={isDemo}
          error={result.isError}
          retry={() => void result.refetch()}
        />
      ) : (
        <>
          {issueId && (
            <button onClick={() => update({ issue: undefined })}>
              Back to queue
            </button>
          )}
          {!result.data.items.length ? (
            <EmptyState
              title="No issues in this view"
              detail="Choose another queue or clear the filters."
            />
          ) : (
            <ul className="finance-issues">
              {result.data.items.map((item) => (
                <li key={item.id}>
                  <IssueCard item={item} data={data} />
                </li>
              ))}
            </ul>
          )}
          {!issueId && (
            <Pagination
              page={page}
              count={result.data.count}
              update={(value) => update({ page: String(value) })}
            />
          )}
        </>
      )}
    </Section>
  );
}

function IssueCard({
  item,
  data,
}: {
  item: FinanceIssue;
  data: StudioSnapshot;
}) {
  const fieldId = useId();
  const queryClient = useQueryClient();
  const [panel, setPanel] = useState<"snooze" | "dismiss">();
  const [days, setDays] = useState(1);
  const [reason, setReason] = useState("");
  const [feedback, setFeedback] = useState("");
  const [pending, setPending] = useState(false);
  const act = async (action: "acknowledge" | "snooze" | "dismiss") => {
    setPending(true);
    try {
      const stale = await changeAttention(data.studioId, {
        id: item.id,
        version: item.version,
        action,
        ...(action === "snooze"
          ? { until: new Date(Date.now() + days * 86_400_000).toISOString() }
          : {}),
        ...(action === "dismiss" ? { reason } : {}),
      });
      setFeedback(
        stale
          ? "This issue changed. Review the current state."
          : "Issue updated.",
      );
      setPanel(undefined);
      await queryClient.invalidateQueries({ queryKey: [attentionKey] });
    } catch {
      setFeedback("The issue could not be updated. Try again.");
    } finally {
      setPending(false);
    }
  };
  const active =
    item.state === "open" ||
    item.state === "acknowledged" ||
    item.state === "snoozed";
  const evidence = item.evidence;
  const zone = data.settings.timezone;
  return (
    <article>
      <header>
        <div>
          <h3>{issueLabels[item.kind]}</h3>
          <small>
            {item.student} · {item.title}
          </small>
        </div>
        <Status tone={item.severity === 3 && active ? "warn" : "neutral"}>
          {severityNames[item.severity]} · {label(item.state)}
        </Status>
      </header>
      <p>{nextSteps[item.kind]}</p>
      <p className="field-help">
        {evidence.amount !== undefined && evidence.currency && (
          <span>{money(evidence.amount, evidence.currency)} remaining · </span>
        )}
        {evidence.dueDate && (
          <span>Due {formatCalendarDateKey(evidence.dueDate)} · </span>
        )}
        {evidence.expiresAt && (
          <span>
            {evidence.quantity} credits expire{" "}
            {formatStudioDateTime(evidence.expiresAt, zone)} ·{" "}
          </span>
        )}
        {item.snoozed_until && (
          <span>
            Snoozed until {formatStudioDateTime(item.snoozed_until, zone)}{" "}
            ·{" "}
          </span>
        )}
        {item.state === "resolved" ? "Resolved " : "First detected "}
        {formatStudioDateTime(
          item.state === "resolved" ? item.changed_at : item.first_seen,
          zone,
        )}
      </p>
      <div className="finance-issue-actions">
        <Link to={item.href}>Open related record</Link>
        {item.state === "open" && (
          <button disabled={pending} onClick={() => void act("acknowledge")}>
            Acknowledge
          </button>
        )}
        {active && (
          <button disabled={pending} onClick={() => setPanel("snooze")}>
            Snooze
          </button>
        )}
        {active && item.kind === "package_expiring" && (
          <button disabled={pending} onClick={() => setPanel("dismiss")}>
            Dismiss
          </button>
        )}
      </div>
      {panel && (
        <form
          className="finance-controls"
          onSubmit={(e) => {
            e.preventDefault();
            void act(panel);
          }}
        >
          {panel === "snooze" ? (
            <label htmlFor={fieldId + "-snooze"}>
              Snooze for
              <select
                id={fieldId + "-snooze"}
                value={days}
                onChange={(e) => setDays(Number(e.target.value))}
              >
                <option value={1}>1 day</option>
                <option value={3}>3 days</option>
                <option value={7}>1 week</option>
              </select>
            </label>
          ) : (
            <label htmlFor={fieldId + "-reason"}>
              Reason
              <input
                id={fieldId + "-reason"}
                required
                minLength={3}
                maxLength={300}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </label>
          )}
          <button disabled={pending}>Save {panel}</button>
          <button type="button" onClick={() => setPanel(undefined)}>
            Cancel
          </button>
        </form>
      )}
      {feedback && <p role="status">{feedback}</p>}
      <details>
        <summary>Issue history</summary>
        <ul className="finance-chart-data">
          {item.history.map((event) => (
            <li key={event.id}>
              {label(event.action)} · {formatStudioDateTime(event.at, zone)}
              {event.reason ? " · " + event.reason : ""}
            </li>
          ))}
        </ul>
      </details>
    </article>
  );
}

export function CoachFinanceSnapshot({ data, isDemo }: Props) {
  const range = financePeriod("this-month", data.settings.timezone);
  const read = useFinanceReport(
    data.studioId,
    range,
    { group: "overview" },
    isDemo,
  );
  const issues = useFinanceAttention(
    data.studioId,
    { preview: true, severity: "3" },
    isDemo,
  );
  const summary = (metric: string) =>
    read.data?.totals
      .filter((item) => item.metric === metric)
      .map((item) => money(item.amount, item.currency))
      .join(" · ");
  return (
    <div className="coach-finance-snapshot">
      <Link to="/coach/finance">
        <strong>Finance</strong>
        <ArrowRight aria-hidden="true" size={16} />
      </Link>
      {read.data && (
        <>
          <small>
            {summary("outstanding") || "0"} outstanding ·{" "}
            {summary("scheduled") || "0"} scheduled
          </small>
          {issues.data && issues.data.count > 0 && (
            <Link to="/coach/finance?view=attention&severity=3">
              {issues.data.count} failed or overdue{" "}
              {issues.data.count === 1 ? "issue" : "issues"}
            </Link>
          )}
        </>
      )}
    </div>
  );
}
