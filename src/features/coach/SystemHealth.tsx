import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  ArrowUpRight,
  CalendarDays,
  Copy,
  CreditCard,
  Mail,
  RefreshCw,
  Settings2,
  ShieldCheck,
} from "lucide-react";
import { useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Dialog, Section, Status } from "../../components/Primitives";
import {
  checkSystemHealth,
  retryHealthIssue,
  studioHealthKey,
  useSystemHealth,
} from "../../data/systemHealth";
import {
  currentObservation,
  dashboardSystemIssues,
  diagnosticText,
  freshHealthTime,
  healthLabels,
  healthServices,
  healthStates,
  issueContent,
  issueRecordLink,
  issueStatus,
  systemIssueLink,
  type HealthIssue,
  type HealthObservation,
  type HealthService,
  type HealthState,
  type StudioHealth,
} from "../../domain/systemHealth";
import "./SystemHealth.css";

const icons = {
  calendar: CalendarDays,
  stripe: CreditCard,
  email: Mail,
  jobs: Settings2,
  access: ShieldCheck,
};
const descriptions: Record<HealthService, string> = {
  calendar: "Lesson events, Calendar changes and Meet links.",
  stripe: "Payment event processing and reconciliation evidence.",
  email: "Transactional messages and provider acceptance.",
  jobs: "Scheduled booking maintenance and processing queues.",
  access: "Coach membership and household access workflows.",
};
const authorizationLabel = {
  verified: "Verified",
  needs_review: "Needs review",
  unknown: "Unverified",
  managed_externally: "Managed in Stripe",
} as const;
const timestamps = (value: string | null | undefined, timezone: string) => {
  if (!value || !Number.isFinite(Date.parse(value))) return "Unavailable";
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: timezone,
  }).format(new Date(value));
};
function HealthBadge({ state }: { state: HealthState }) {
  const tone =
    state === "healthy"
      ? "good"
      : state === "attention" || state === "degraded"
        ? "warn"
        : "neutral";
  return <Status tone={tone}>{healthStates[state]}</Status>;
}
function connectionState(observation?: HealthObservation) {
  if (observation?.configured === true) return "Configured";
  if (observation?.configured === false) return "Not configured";
  return "Configuration unavailable";
}
function observationFor(
  health: StudioHealth | undefined,
  service: HealthService,
) {
  const observation = health?.observations.find(
    (entry) => entry.service === service,
  );
  return observation && currentObservation(observation);
}
function issuePreview(issue: HealthIssue) {
  return issueContent[issue.category]?.title ?? "Operational issue";
}

export function DashboardSystemAlerts({
  studio,
  isDemo,
}: {
  studio: string;
  isDemo: boolean;
}) {
  const { data, isError } = useSystemHealth(studio, !isDemo);
  const alerts = data && !isError ? dashboardSystemIssues(data) : [];
  if (!alerts.length) return null;
  return (
    <Section title="System alerts" marked>
      <ul className="system-alerts">
        {alerts.map((issue) => (
          <li key={issue.id}>
            <Link to={systemIssueLink(issue.id)}>
              <Activity size={18} aria-hidden="true" />
              <span>
                <strong>{issuePreview(issue)}</strong>
                <small>{healthLabels[issue.service]}</small>
              </span>
              <ArrowUpRight size={16} aria-hidden="true" />
            </Link>
          </li>
        ))}
      </ul>
    </Section>
  );
}

export function SettingsOverview({
  studio,
  isDemo,
}: {
  studio: string;
  isDemo: boolean;
}) {
  const { data, isError, isPending } = useSystemHealth(studio, !isDemo);
  const active = !isError && data ? dashboardSystemIssues(data) : [];
  return (
    <section
      className="health-surface settings-overview"
      aria-labelledby="settings-workspace-title"
    >
      <div>
        <h3 id="settings-workspace-title">Studio at a glance</h3>
        <p>
          Review your connections or go straight to booking, finance and access
          settings.
        </p>
      </div>
      <div className="settings-shortcuts">
        <Link to="/coach/settings?panel=booking">
          Booking & finance <ArrowUpRight size={16} aria-hidden="true" />
        </Link>
        <Link to="/coach/settings?panel=access">
          Security & access <ArrowUpRight size={16} aria-hidden="true" />
        </Link>
        <Link to="/coach/settings?panel=health">
          System Health <ArrowUpRight size={16} aria-hidden="true" />
        </Link>
      </div>
      <ul className="settings-overview-connections">
        {healthServices.slice(0, 3).map((service) => (
          <li key={service}>
            <Link to={"/coach/settings?panel=integrations&service=" + service}>
              {healthLabels[service]}
            </Link>
            <HealthBadge
              state={
                isError
                  ? "unavailable"
                  : (observationFor(data, service)?.state ??
                    (!isDemo && isPending ? "checking" : "unavailable"))
              }
            />
          </li>
        ))}
      </ul>
      {active.length > 0 && (
        <ul className="settings-overview-issues">
          {active.map((issue) => (
            <li key={issue.id}>
              <Link to={systemIssueLink(issue.id)}>{issuePreview(issue)}</Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function ConnectionsPanel({
  studio,
  isDemo,
  timezone,
}: {
  studio: string;
  isDemo: boolean;
  timezone: string;
}) {
  const { data, isPending, isError } = useSystemHealth(studio, !isDemo);
  const [params, setParams] = useSearchParams();
  const selected = params.get("service");
  return (
    <div className="health-stack">
      <p className="health-intro">
        Review authorization separately from recent synchronization, payments
        and delivery.
      </p>
      {isDemo && (
        <p className="portal-notice">
          Live integration evidence is unavailable in the local preview.
        </p>
      )}
      {isError && (
        <p className="inline-error" role="status">
          Connection evidence could not be loaded. You can try again in System
          Health.
        </p>
      )}
      <div className="health-connection-grid">
        {healthServices.slice(0, 3).map((service) => {
          const Icon = icons[service];
          const observation = isError
            ? undefined
            : observationFor(data, service);
          return (
            <article key={service} className="health-surface health-connection">
              <div className="health-card-heading">
                <span className="health-icon">
                  <Icon size={21} aria-hidden="true" />
                </span>
                <HealthBadge
                  state={
                    observation?.state ??
                    (!isDemo && isPending ? "checking" : "unavailable")
                  }
                />
              </div>
              <h3>{healthLabels[service]}</h3>
              <p>{descriptions[service]}</p>
              <dl className="health-facts">
                <div>
                  <dt>Connection</dt>
                  <dd>{connectionState(observation)}</dd>
                </div>
                <div>
                  <dt>Authorization</dt>
                  <dd>
                    {
                      authorizationLabel[
                        observation?.authorization ?? "unknown"
                      ]
                    }
                  </dd>
                </div>
                {observation?.destination && (
                  <div>
                    <dt>Destination</dt>
                    <dd>{observation.destination}</dd>
                  </div>
                )}
                <div>
                  <dt>Last successful operation</dt>
                  <dd>{timestamps(observation?.lastSuccessAt, timezone)}</dd>
                </div>
                <div>
                  <dt>Last check</dt>
                  <dd>{timestamps(observation?.checkedAt, timezone)}</dd>
                </div>
              </dl>
              <button
                onClick={() =>
                  setParams((previous) => {
                    const next = new URLSearchParams(previous);
                    next.set("service", service);
                    return next;
                  })
                }
              >
                View connection
              </button>
            </article>
          );
        })}
      </div>
      {healthServices.slice(0, 3).map(
        (service) =>
          selected === service && (
            <Dialog
              key={service}
              className="health-drawer"
              presentation="drawer"
              title={healthLabels[service]}
              description={descriptions[service]}
              onClose={() =>
                setParams(
                  (previous) => {
                    const next = new URLSearchParams(previous);
                    next.delete("service");
                    return next;
                  },
                  { replace: true },
                )
              }
            >
              <ConnectionDetail
                service={service}
                health={isError ? undefined : data}
                timezone={timezone}
              />
            </Dialog>
          ),
      )}
    </div>
  );
}

function ConnectionDetail({
  service,
  health,
  timezone,
}: {
  service: HealthService;
  health?: StudioHealth;
  timezone: string;
}) {
  const observation = observationFor(health, service);
  const issues =
    health?.issues.filter(
      (issue) => issue.service === service && !issue.resolvedAt,
    ) ?? [];
  return (
    <div className="health-stack">
      <div>
        <HealthBadge state={observation?.state ?? "unavailable"} />
        <p>
          {observation?.detail ?? "No current source observation is available."}
        </p>
      </div>
      {service === "calendar" && (
        <>
          <p>
            {observation?.destination ?? "Selected calendar unavailable."}{" "}
            Calendar selection and authorization are managed by the deployment
            operator.
          </p>
          <a
            className="button-link"
            href="https://calendar.google.com/"
            target="_blank"
            rel="noreferrer"
          >
            Open Google Calendar <ArrowUpRight size={16} aria-hidden="true" />
          </a>
        </>
      )}
      {service === "stripe" && (
        <a
          className="button-link"
          href="https://dashboard.stripe.com/"
          target="_blank"
          rel="noreferrer"
        >
          Open Stripe Dashboard <ArrowUpRight size={16} aria-hidden="true" />
        </a>
      )}
      {service === "email" && (
        <Link
          className="button-link"
          to="/coach/inbox?delivery=recent#delivery-history"
        >
          Open communication history
        </Link>
      )}
      {issues.length > 0 && <IssueList issues={issues} timezone={timezone} />}
      <Link
        className="button-link"
        to={"/coach/settings?panel=health&service=" + service}
      >
        Check or troubleshoot
      </Link>
      <details className="health-advanced">
        <summary>Advanced diagnostics</summary>
        <dl className="health-facts">
          <div>
            <dt>Source observed</dt>
            <dd>{timestamps(observation?.checkedAt, timezone)}</dd>
          </div>
          <div>
            <dt>Latest successful operation</dt>
            <dd>{timestamps(observation?.lastSuccessAt, timezone)}</dd>
          </div>
          {service === "calendar" && (
            <div>
              <dt>Last Calendar access check</dt>
              <dd>{timestamps(observation?.probe?.at, timezone)}</dd>
            </div>
          )}
          {observation && (
            <div>
              <dt>
                {observation.pending >= 41
                  ? "Pending work (41 or more)"
                  : "Pending work"}
              </dt>
              <dd>{observation.pending}</dd>
            </div>
          )}
        </dl>
      </details>
    </div>
  );
}

function IssueList({
  issues,
  timezone,
}: {
  issues: HealthIssue[];
  timezone: string;
}) {
  return (
    <ul className="health-issue-list">
      {issues.map((issue) => (
        <li key={issue.id}>
          <Link to={systemIssueLink(issue.id)}>
            <span>
              <strong>{issuePreview(issue)}</strong>
              <small>
                {healthLabels[issue.service]} ·{" "}
                {timestamps(issue.lastSeen, timezone)}
              </small>
            </span>
            <Status
              tone={
                issue.severity === "high" &&
                !issue.resolvedAt &&
                issue.phase === "open"
                  ? "warn"
                  : "neutral"
              }
            >
              {issueStatus(issue)}
            </Status>
            <ArrowUpRight size={16} aria-hidden="true" />
          </Link>
        </li>
      ))}
    </ul>
  );
}

export function SystemHealthPanel({
  studio,
  isDemo,
  timezone,
}: {
  studio: string;
  isDemo: boolean;
  timezone: string;
}) {
  const { data, isError, isPending, refetch } = useSystemHealth(
    studio,
    !isDemo,
  );
  const [params, setParams] = useSearchParams();
  const issueId = params.get("issue");
  const service = params.get("service");
  const queryClient = useQueryClient();
  const [result, setResult] = useState("");
  const [manualCopy, setManualCopy] = useState("");
  const check = useMutation({
    mutationFn: () => checkSystemHealth(studio),
    onMutate: () => setResult(""),
    onSuccess: ({ state, health }) => {
      queryClient.setQueryData([...studioHealthKey(studio), "status"], health);
      void queryClient.invalidateQueries({ queryKey: studioHealthKey(studio) });
      setResult(
        state === "completed"
          ? "Check completed. Results are shown below."
          : health.checking
            ? "A check is already running. Results will update here."
            : "A recent check is already available. Wait briefly before checking again.",
      );
    },
    onError: () => {
      setResult(
        "The check could not be confirmed. Refresh to see the latest saved results.",
      );
      void refetch();
    },
  });
  const displayed = data?.issues.find(({ id }) => id === issueId);
  const detail = useSystemHealth(
    studio,
    !isDemo && !!issueId && !displayed,
    issueId ?? undefined,
  );
  const current = displayed ?? detail.data?.issues[0];
  const health = data ?? detail.data;
  const issues =
    data?.issues.filter((issue) => !service || issue.service === service) ?? [];
  const open = issues.filter((issue) => !issue.resolvedAt);
  const resolved = issues.filter((issue) => issue.resolvedAt);
  const checking = check.isPending || (!isError && data?.checking);
  const close = () => {
    setManualCopy("");
    setParams(
      (previous) => {
        const next = new URLSearchParams(previous);
        next.delete("issue");
        return next;
      },
      { replace: true },
    );
  };
  const states = healthServices.map(
    (key) => observationFor(data, key)?.state ?? "unavailable",
  );
  const overall: HealthState = checking
    ? "checking"
    : isError
      ? "unavailable"
      : states.includes("attention")
        ? "attention"
        : states.includes("degraded")
          ? "degraded"
          : states.every((state) => state === "healthy")
            ? "healthy"
            : "unavailable";
  return (
    <div className="health-stack">
      <section
        className="health-surface health-summary"
        aria-labelledby="health-summary-title"
      >
        <div>
          <div className="health-summary-title">
            <h3 id="health-summary-title">Operational status</h3>
            <HealthBadge state={overall} />
          </div>
          <p>
            Check Calendar, payments, delivery, background jobs and access. This
            check only reads evidence and Calendar access.
          </p>
          <p className="health-meta">
            Last check {timestamps(data?.checkedAt, timezone)}
          </p>
          <p className="health-meta">
            Automatic check {timestamps(data?.automaticAt, timezone)}
          </p>
        </div>
        <button
          className="primary"
          disabled={isDemo || checking}
          onClick={() => check.mutate()}
        >
          <RefreshCw size={17} aria-hidden="true" />
          {checking ? "Checking…" : "Check now"}
        </button>
      </section>
      {checking && (
        <p className="portal-notice" role="status">
          Checking Calendar, Stripe, Gmail, background jobs and access.
          Individual results will be available when the check completes.
        </p>
      )}
      {result && (
        <p className="portal-notice" role="status">
          {result}
        </p>
      )}
      {isDemo && (
        <p className="portal-notice">
          Open the live studio workspace to use diagnostics and recovery.
        </p>
      )}
      {isError && (
        <p className="inline-error" role="status">
          System Health could not load current evidence. Previously seen issues
          may have changed.{" "}
          <button onClick={() => void refetch()}>Refresh saved results</button>
        </p>
      )}
      {!isDemo &&
        !isPending &&
        !isError &&
        !checking &&
        !freshHealthTime(data?.automaticAt, 35 * 60_000) && (
          <p className="portal-notice" role="status">
            Recent automatic monitoring is unavailable. You can run Check now
            and share diagnostics if scheduled checks remain unavailable.
          </p>
        )}
      <section className="health-surface health-history">
        <div className="health-summary-title">
          <h3>
            {service && healthServices.includes(service as HealthService)
              ? healthLabels[service as HealthService] + " issues"
              : "Issues and history"}
          </h3>
          {service && (
            <Link to="/coach/settings?panel=health">Show all services</Link>
          )}
        </div>
        {open.length ? (
          <IssueList issues={open} timezone={timezone} />
        ) : (
          <p>
            {data && !isError
              ? "No active issues in the available evidence."
              : "Issue history is currently unavailable."}
          </p>
        )}
        {resolved.length > 0 && (
          <details className="health-advanced">
            <summary>Past issues ({resolved.length})</summary>
            <IssueList issues={resolved} timezone={timezone} />
          </details>
        )}
      </section>
      <div className="health-surface health-checks">
        {healthServices.map((key) => {
          const Icon = icons[key];
          const observation = isError ? undefined : observationFor(data, key);
          return (
            <article key={key}>
              <span className="health-icon">
                <Icon size={19} aria-hidden="true" />
              </span>
              <div>
                <h3>{healthLabels[key]}</h3>
                <p>
                  {observation?.detail ??
                    "No current observation is available."}
                </p>
                {observation?.destination && <p>{observation.destination}</p>}
                {observation?.lastAttemptAt && (
                  <p className="health-meta">
                    Last attempted{" "}
                    {timestamps(observation.lastAttemptAt, timezone)}
                  </p>
                )}
                <small>
                  Last verified{" "}
                  {timestamps(observation?.lastSuccessAt, timezone)}
                </small>
              </div>
              <HealthBadge
                state={
                  checking || (!isDemo && isPending)
                    ? "checking"
                    : (observation?.state ?? "unavailable")
                }
              />
            </article>
          );
        })}
      </div>
      {issueId && (
        <Dialog
          className="health-drawer"
          presentation="drawer"
          title={current ? issuePreview(current) : "System Health issue"}
          onClose={close}
        >
          {current && health ? (
            <IssueDetail
              key={current.id}
              issue={current}
              health={health}
              studio={studio}
              timezone={timezone}
              manualCopy={manualCopy}
              setManualCopy={setManualCopy}
              available={!isError}
            />
          ) : (
            <p role="status">
              {detail.isPending
                ? "Loading issue…"
                : "This issue is unavailable in the current studio."}
            </p>
          )}
        </Dialog>
      )}
    </div>
  );
}

function IssueDetail({
  issue,
  health,
  studio,
  timezone,
  manualCopy,
  setManualCopy,
  available,
}: {
  issue: HealthIssue;
  health: StudioHealth;
  studio: string;
  timezone: string;
  available: boolean;
  manualCopy: string;
  setManualCopy: (text: string) => void;
}) {
  const details = issueContent[issue.category];
  const queryClient = useQueryClient();
  const [confirm, setConfirm] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [copyStatus, setCopyStatus] = useState("");
  const related = issueRecordLink(issue);
  const service =
    issue.service === "calendar" || issue.service === "email"
      ? issue.service
      : undefined;
  const observation = observationFor(health, issue.service);
  const eligible =
    available &&
    service &&
    issue.retryable &&
    issue.phase === "open" &&
    !issue.resolvedAt &&
    observation &&
    observation.state !== "unavailable" &&
    !issue.recovery.some(({ at }) => freshHealthTime(at, 15 * 60_000));
  const retry = useMutation({
    mutationFn: (kind: "calendar" | "email") =>
      retryHealthIssue(studio, issue.id, kind),
    onSuccess: ({ result }) =>
      setFeedback(
        {
          queued:
            "Retry queued. System Health will update after the worker reports its outcome.",
          already_resolved:
            "The source already reports success. Check now to refresh the issue.",
          not_eligible:
            "The source changed or no longer qualifies for a safe retry.",
          recent_retry:
            "A recent retry exists. Check its outcome before trying again.",
          worker_disabled:
            "The relevant worker is intentionally disabled. No retry was queued.",
          check_in_progress:
            "A diagnostic check is running. Wait for its results before retrying.",
          retry_limit:
            "The studio has reached its recovery limit. Wait 15 minutes before queuing another retry.",
          connection_required:
            "Review the Google connection before queuing this recovery.",
        }[result],
      ),
    onError: () =>
      setFeedback(
        "The retry outcome could not be confirmed. Check the issue and its recovery history before trying again.",
      ),
    onSettled: () => {
      setConfirm(false);
      void queryClient.invalidateQueries({ queryKey: studioHealthKey(studio) });
    },
  });
  const copy = async () => {
    const text = diagnosticText(issue, health, timezone);
    try {
      await navigator.clipboard.writeText(text);
      setCopyStatus("Diagnostics copied.");
    } catch {
      setManualCopy(text);
      setCopyStatus("Select and copy the diagnostic summary below.");
    }
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (eligible && service && !retry.isPending) retry.mutate(service);
  };
  return (
    <div className="health-stack">
      <div>
        <Status
          tone={issue.resolvedAt || issue.phase !== "open" ? "neutral" : "warn"}
        >
          {issueStatus(issue)}
        </Status>
        <p>{details.impact}</p>
      </div>
      <dl className="health-facts">
        <div>
          <dt>Service</dt>
          <dd>{healthLabels[issue.service]}</dd>
        </div>
        {issue.scope && (
          <div>
            <dt>Scope</dt>
            <dd>
              {
                {
                  lesson: "One lesson",
                  recurring_occurrence: "One lesson in a recurring series",
                  transactional: "Transactional email",
                  other: "Other email",
                }[issue.scope]
              }
            </dd>
          </div>
        )}
        <div>
          <dt>First detected</dt>
          <dd>{timestamps(issue.firstSeen, timezone)}</dd>
        </div>
        <div>
          <dt>Most recent occurrence</dt>
          <dd>{timestamps(issue.lastSeen, timezone)}</dd>
        </div>
        <div>
          <dt>Occurrences observed</dt>
          <dd>{issue.occurrences}</dd>
        </div>
      </dl>
      <div>
        <h3>Next step</h3>
        <p>{details.next}</p>
      </div>
      <div className="health-actions">
        {related && (
          <Link className="button-link" to={related}>
            {issue.invoiceId
              ? "Open invoice"
              : issue.bookingId
                ? "Open booking"
                : issue.lessonId
                  ? "Open lesson"
                  : "Open student record"}
          </Link>
        )}
        {issue.service === "calendar" && (
          <Link
            className="button-link"
            to="/coach/settings?panel=integrations&service=calendar"
          >
            Review Google connection
          </Link>
        )}
        {issue.service === "stripe" && (
          <a
            className="button-link"
            href="https://dashboard.stripe.com/"
            target="_blank"
            rel="noreferrer"
          >
            Open Stripe
          </a>
        )}
        {issue.service === "email" && (
          <Link
            className="button-link"
            to={
              "/coach/inbox" +
              (issue.deliveryId
                ? "?delivery=" + encodeURIComponent(issue.deliveryId)
                : "") +
              "#delivery-history"
            }
          >
            Review communications
          </Link>
        )}
        {eligible && !confirm && (
          <button className="primary" onClick={() => setConfirm(true)}>
            {service === "calendar"
              ? "Retry synchronization"
              : "Retry delivery"}
          </button>
        )}
      </div>
      {confirm && (
        <form className="health-surface health-confirm" onSubmit={submit}>
          <h3>
            Confirm{" "}
            {service === "calendar" ? "Calendar retry" : "delivery retry"}
          </h3>
          <p>
            {service === "calendar"
              ? "This queues the existing lesson’s Calendar update using its original event identity. The lesson and any charges stay as they are. Google may send calendar invitations or updates."
              : "This queues the existing message. The delivery worker rechecks current recipient authorization and eligibility before contacting Gmail."}
          </p>
          <div className="health-actions">
            <button
              type="submit"
              className="primary"
              disabled={!eligible || retry.isPending}
            >
              {retry.isPending ? "Queuing…" : "Queue retry"}
            </button>
            <button
              type="button"
              onClick={() => setConfirm(false)}
              disabled={retry.isPending}
            >
              Cancel
            </button>
          </div>
        </form>
      )}
      {feedback && (
        <p className="portal-notice" role="status">
          {feedback}
        </p>
      )}
      <details className="health-advanced">
        <summary>Advanced diagnostics</summary>
        <dl className="health-facts">
          <div>
            <dt>Issue ID</dt>
            <dd>{issue.id}</dd>
          </div>
          {issue.operation && (
            <div>
              <dt>Operation</dt>
              <dd>{issue.operation.replaceAll("_", " ")}</dd>
            </div>
          )}
          <div>
            <dt>Error category</dt>
            <dd>{issue.category.replaceAll("_", " ")}</dd>
          </div>
          <div>
            <dt>Last verified operation</dt>
            <dd>
              {timestamps(
                issue.lastSuccessAt ?? observation?.lastSuccessAt,
                timezone,
              )}
            </dd>
          </div>
          {issue.recovery.map((attempt) => (
            <div key={attempt.correlationId}>
              <dt>Recovery queued</dt>
              <dd>
                {timestamps(attempt.at, timezone)} · {attempt.correlationId}
              </dd>
            </div>
          ))}
          {issue.resolvedAt && (
            <div>
              <dt>Cleared</dt>
              <dd>{timestamps(issue.resolvedAt, timezone)}</dd>
            </div>
          )}
        </dl>
      </details>
      <button className="health-copy" onClick={() => void copy()}>
        <Copy size={17} aria-hidden="true" />
        Copy diagnostics
      </button>
      {copyStatus && <p role="status">{copyStatus}</p>}
      {manualCopy && (
        <label
          className="health-copy-fallback"
          htmlFor="system-health-diagnostic-summary"
        >
          Diagnostic summary
          <textarea
            id="system-health-diagnostic-summary"
            readOnly
            value={manualCopy}
            rows={8}
            onFocus={(event) => event.target.select()}
          />
        </label>
      )}
    </div>
  );
}
