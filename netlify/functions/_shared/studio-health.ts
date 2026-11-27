import { activeCalendarRoles } from "./calendar-roles";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  freshHealthTime,
  healthServices,
  type HealthIssue,
  type HealthObservation,
  type HealthService,
  type StudioHealth,
} from "../../../src/domain/systemHealth";
import {
  googleAccessToken,
  GoogleAuthorizationError,
  GoogleAvailabilityError,
} from "./google";
import { gmailConnection } from "./gmail-oauth";
import { calendarOAuthConfig } from "./calendar-oauth";
import { releaseMetadata } from "./release";
import { workerEnabled } from "./worker-controls";

type Problem = Partial<Omit<HealthIssue, "category">> & {
  key: string;
  category: HealthIssue["category"] | "job_observed";
};
type Evidence = {
  lastSuccessAt: string | null;
  problems: Problem[];
  complete: boolean;
  pending: number;
};
type Observation = HealthObservation & {
  problems: Problem[];
  complete: boolean;
  preserve?: string[];
};
type Probe = NonNullable<HealthObservation["probe"]>;
type CheckRun = {
  state: "completed" | "recent_or_running";
  health: StudioHealth;
};

export async function healthRpc<T>(
  db: SupabaseClient,
  name: string,
  args: Record<string, unknown> = {},
  milliseconds = 1800,
): Promise<T> {
  const { data, error } = await db
    .rpc(name, args)
    .abortSignal(AbortSignal.timeout(milliseconds));
  if (error) {
    const code = /^[0-9A-Z]{5,10}$/.test(error.code)
      ? error.code
      : "UNAVAILABLE";
    console.error(
      JSON.stringify({
        event: "studio_health.source_failed",
        operation: name,
        code,
      }),
    );
    throw new Error("Studio health evidence is unavailable.");
  }
  return data as T;
}

export async function readStudioHealth(
  db: SupabaseClient,
  studio: string,
  issue?: string,
): Promise<StudioHealth> {
  const snapshot = await healthRpc<Omit<StudioHealth, "release">>(
    db,
    "studio_health_read",
    {
      p_studio: studio,
      p_issue: issue ?? null,
    },
  );
  return { ...snapshot, release: releaseMetadata() };
}

const get = (key: string) => globalThis.Netlify?.env.get(key);
const configured = (...keys: string[]) => keys.some((key) => Boolean(get(key)));
export const googleConfigured = () =>
  configured("GOOGLE_CLIENT_ID", "GOOGLE_OAUTH_CLIENT_ID") &&
  configured("GOOGLE_CLIENT_SECRET", "GOOGLE_OAUTH_CLIENT_SECRET") &&
  (configured("GOOGLE_REFRESH_TOKEN") || Boolean(calendarOAuthConfig()));

async function googleCalendarProbe(calendar: string): Promise<Probe> {
  const at = new Date().toISOString();
  const signal = AbortSignal.timeout(3500);
  try {
    const token = await googleAccessToken(signal);
    const response = await fetch(
      "https://www.googleapis.com/calendar/v3/users/me/calendarList/" +
        encodeURIComponent(calendar) +
        "?fields=summary,accessRole",
      {
        headers: { Authorization: "Bearer " + token },
        signal,
        redirect: "error",
      },
    );
    if (response.status === 401) return { at, result: "authorization" };
    if (response.status === 403) {
      const error = (await response.json().catch(() => null)) as {
        error?: { errors?: { reason?: string }[] };
      } | null;
      if (
        error?.error?.errors?.some(({ reason }) =>
          [
            "rateLimitExceeded",
            "userRateLimitExceeded",
            "quotaExceeded",
          ].includes(reason ?? ""),
        )
      )
        return { at, result: "throttled" };
      return { at, result: "permission" };
    }
    if (response.status === 404) return { at, result: "missing" };
    if (response.status === 429) return { at, result: "throttled" };
    if (!response.ok) return { at, result: "unavailable" };
    const body = (await response.json()) as {
      summary?: unknown;
      accessRole?: unknown;
    };
    if (typeof body.accessRole !== "string")
      return { at, result: "unavailable" };
    const destination =
      typeof body.summary === "string"
        ? body.summary.replace(/\p{Cc}/gu, " ").slice(0, 100)
        : undefined;
    return {
      at,
      result: ["owner", "writer"].includes(body.accessRole)
        ? "accessible"
        : "permission",
      destination,
    };
  } catch (error) {
    if (
      error instanceof GoogleAuthorizationError &&
      error.reason === "authorization"
    )
      return { at, result: "authorization" };
    if (error instanceof GoogleAvailabilityError && error.throttled)
      return { at, result: "throttled" };
    return { at, result: "unavailable" };
  }
}

const hour = 60 * 60_000;
const successWindows: Record<HealthService, number> = {
  calendar: 72 * hour,
  email: 72 * hour,
  stripe: 7 * 24 * hour,
  jobs: 20 * 60_000,
  access: 35 * 60_000,
};

export function deriveObservation(
  service: HealthService,
  evidence: Evidence | undefined,
  options: {
    owner: boolean;
    google: boolean;
    gmail?: boolean;
    stripe: boolean;
    workers: {
      calendar: boolean;
      email: boolean;
      jobs: boolean;
      intake: boolean;
    };
    calendar: string;
    probe?: Probe;
    checkedAt: string;
  },
): Observation {
  const { owner, google, stripe, workers, calendar, probe, checkedAt } =
    options;
  const now = Date.parse(checkedAt);
  const lastSuccessAt = evidence?.lastSuccessAt ?? null;
  const observed = freshHealthTime(lastSuccessAt, successWindows[service], now);
  const lastGoogleCheck =
    probe && freshHealthTime(probe.at, 24 * hour, now) ? probe : undefined;
  const credentialed = owner
    ? service === "calendar"
      ? google
      : service === "email"
        ? (options.gmail ?? null)
        : service === "stripe"
          ? stripe
          : true
    : service === "access"
      ? true
      : null;
  const authorization =
    service === "calendar"
      ? lastGoogleCheck?.result === "authorization"
        ? "needs_review"
        : lastGoogleCheck?.result === "accessible"
          ? "verified"
          : "unknown"
      : service === "access" && observed
        ? "verified"
        : service === "stripe" && owner
          ? "managed_externally"
          : "unknown";

  let problems: Problem[] = (evidence?.problems ?? []).slice(0, 40);
  const maintenance = problems.find(({ key }) => key === "maintenance");
  const observation: Observation = {
    service,
    state: observed ? "healthy" : "unavailable",
    checkedAt,
    lastSuccessAt,
    ...(service === "calendar" && owner ? { probe } : {}),
    lastAttemptAt: maintenance?.sourceAt,
    configured: credentialed,
    authorization,
    pending: evidence?.pending ?? 0,
    detail: "Recent successful activity could not be verified.",
    complete: evidence?.complete ?? false,
    problems: [],
  };
  if (!evidence) {
    observation.detail =
      "This source did not respond. Existing issues are retained until evidence can be checked.";
  } else if (service === "calendar") {
    observation.detail = observed
      ? "Coach’D recently recorded a completed event synchronization."
      : "No recent successful event synchronization is recorded.";
    if (owner) {
      observation.destination =
        lastGoogleCheck?.destination ||
        (calendar === "primary"
          ? "Connected account’s primary calendar"
          : "Deployment-selected calendar");

      if (!google)
        problems.push({
          key: "google-config",
          category: "google_configuration",
          operation: "authorization",
        });
      const checkCategory = {
        authorization: "google_authorization",
        permission: "google_permission",
        missing: "google_missing",
        throttled: "google_throttled",
      } as const;
      if (lastGoogleCheck?.result && lastGoogleCheck.result in checkCategory) {
        const result = lastGoogleCheck.result as keyof typeof checkCategory;
        problems.push({
          key: "google-access",
          category: checkCategory[result],
          operation: "calendar_access",
          sourceAt: lastGoogleCheck.at,
        });
      } else if (lastGoogleCheck?.result !== "accessible") {
        observation.preserve = ["google-access"];
      }
      if (!workers.calendar) {
        observation.detail =
          "Event projection is intentionally disabled in this deployment.";
        observation.state = "unavailable";
      } else if (lastGoogleCheck?.result === "unavailable") {
        observation.detail =
          "Calendar access could not be checked. Saved synchronization evidence is shown separately.";
        observation.state = observed ? "degraded" : "unavailable";
      }
    }
    if (problems.some((item) => item.category === "calendar_authorization"))
      observation.authorization =
        lastGoogleCheck?.result === "accessible" ? "verified" : "needs_review";
  } else if (service === "email") {
    observation.detail = observed
      ? "Gmail recently accepted a message. Recipient delivery is not observable here."
      : "There is no recent Gmail acceptance on record.";
    if (owner && !workers.email) {
      observation.state = "unavailable";
      observation.detail =
        "The outbox worker is intentionally disabled in this deployment.";
    }
  } else if (service === "stripe") {
    observation.detail = observed
      ? "Coach’D recently processed a linked payment webhook."
      : "No recent linked payment webhook completed. Check Stripe for provider-side delivery or endpoint errors.";
    if (owner && !stripe)
      problems.push({
        key: "stripe-config",
        category: "stripe_configuration",
        operation: "payment_configuration",
      });
  } else if (service === "jobs") {
    problems = [];
    observation.detail = !owner
      ? "Job receipts are available to the studio that owns the scheduled deployment."
      : !workers.jobs
        ? "Booking maintenance is intentionally disabled."
        : observed
          ? "Booking maintenance completed within its expected interval."
          : "No recent booking maintenance completion could be verified.";
    if (owner) {
      observation.destination = workers.intake
        ? "Provider intake enabled"
        : "Provider intake intentionally disabled";
      if (!workers.jobs) observation.state = "unavailable";
      else if (maintenance && maintenance.category !== "job_observed") {
        problems.push(maintenance);
        observation.detail =
          maintenance.category === "job_failed"
            ? "The latest booking maintenance attempt failed."
            : "Booking maintenance has stopped reporting.";
      } else if (!observed && maintenance)
        problems.push({ ...maintenance, category: "job_stalled" });
      else if (!observed && !maintenance)
        observation.preserve = ["maintenance"];
    }
  } else if (service === "access") {
    observation.detail = observed
      ? "A coach role is assigned to this studio. Household permissions are managed from the relevant student record."
      : "Studio role data could not be verified.";
  }

  observation.problems = problems.map((problem) => {
    const critical =
      [
        "google_authorization",
        "google_permission",
        "google_missing",
        "stripe_processing",
        "job_failed",
        "job_stalled",
      ].includes(problem.category) ||
      (problem.scope === "transactional" && (problem.attempts ?? 0) >= 2);
    const severity = critical
      ? "high"
      : problem.scope === "other"
        ? "info"
        : "review";
    const retryable =
      problem.retryable === true &&
      problem.phase === "open" &&
      (service === "calendar"
        ? (!owner || (workers.calendar && google)) &&
          lastGoogleCheck?.result !== "authorization"
        : service === "email" &&
          problem.scope === "transactional" &&
          (!owner || (workers.email && options.gmail === true)));
    return { ...problem, severity, retryable };
  });
  if (evidence && credentialed === false) observation.state = "not_configured";
  else if (
    observation.problems.some(
      (item) => item.phase !== "queued" && item.phase !== "running",
    )
  ) {
    observation.state =
      observation.problems.some((item) => item.severity === "high") || !observed
        ? "attention"
        : "degraded";
  }
  if (evidence && !evidence.complete)
    observation.detail +=
      " The issue list is limited to the first 40 affected records.";
  return observation;
}

export async function runStudioHealth(
  db: SupabaseClient,
  studio: string,
  automatic: boolean,
  existing?: StudioHealth,
): Promise<CheckRun> {
  const lease = await healthRpc<string | null>(db, "studio_health_claim", {
    p_studio: studio,
    p_automatic: automatic,
  });
  if (!lease)
    return {
      state: "recent_or_running",
      health: await readStudioHealth(db, studio),
    };
  const configuredStudio = get("STUDIO_ID");
  const [previous, slug] = await Promise.all([
    existing ? Promise.resolve(existing) : readStudioHealth(db, studio),
    configuredStudio
      ? Promise.resolve(null)
      : healthRpc<string | null>(db, "studio_health_studio_slug", {
          p_studio: studio,
        }),
  ]);
  const owner = configuredStudio
    ? studio === configuredStudio
    : slug === (get("STUDIO_SLUG") || "stage-story");
  const calendar = owner ? (await activeCalendarRoles()).outgoing : "";
  const google = owner && googleConfigured();
  const oldProbe = previous.observations.find(
    (entry) => entry.service === "calendar",
  )?.probe;
  const readProvider =
    !automatic &&
    google &&
    get("E2E_EPHEMERAL") !== "true" &&
    !(
      oldProbe?.result === "throttled" &&
      freshHealthTime(oldProbe.at, 5 * 60_000)
    );
  const [probe, evidence, gmail] = await Promise.all([
    readProvider
      ? googleCalendarProbe(calendar)
      : Promise.resolve(google ? oldProbe : undefined),
    Promise.all(
      healthServices.map((service) =>
        healthRpc<Evidence>(
          db,
          "studio_health_evidence",
          { p_studio: studio, p_service: service, p_owner: owner },
          2650,
        ).catch(() => undefined),
      ),
    ),
    owner
      ? gmailConnection(db, studio, "")
          .then(({ authorization }) => authorization !== "configuration")
          .catch(() => undefined)
      : Promise.resolve(false),
  ]);
  const workers = {
    calendar: workerEnabled("calendar"),
    email: workerEnabled("automations"),
    jobs: workerEnabled("booking-maintenance"),
    intake: workerEnabled("provider-intake"),
  };
  const checkedAt = new Date().toISOString();
  const results = healthServices.map((service, index) =>
    deriveObservation(service, evidence[index], {
      owner,
      google,
      gmail,
      calendar,
      probe,
      workers,
      checkedAt,
      stripe:
        owner &&
        configured("STRIPE_SECRET_KEY") &&
        configured("STRIPE_WEBHOOK_SECRET"),
    }),
  );
  const saved = await healthRpc<boolean>(db, "studio_health_finish", {
    p_studio: studio,
    p_lease: lease,
    p_automatic: automatic,
    p_results: results,
  });
  if (!saved) throw new Error("Studio health check did not finish.");
  return { state: "completed", health: await readStudioHealth(db, studio) };
}
