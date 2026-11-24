export const healthServices = [
  "calendar",
  "stripe",
  "email",
  "jobs",
  "access",
] as const;
export type HealthService = (typeof healthServices)[number];
export const healthLabels: Record<HealthService, string> = {
  calendar: "Google Calendar",
  stripe: "Stripe payments",
  email: "Gmail delivery",
  jobs: "Background jobs",
  access: "Studio access",
};
export const healthStates = {
  healthy: "Healthy",
  attention: "Needs attention",
  checking: "Checking",
  not_configured: "Not configured",
  unavailable: "Status unavailable",
  degraded: "Degraded",
} as const;
export type HealthState = keyof typeof healthStates;
export type AuthorizationState =
  "verified" | "needs_review" | "unknown" | "managed_externally";
export type HealthObservation = {
  service: HealthService;
  state: HealthState;
  checkedAt: string;
  lastSuccessAt: string | null;
  lastAttemptAt?: string | null;
  configured: boolean | null;
  authorization: AuthorizationState;
  detail: string;
  pending: number;
  destination?: string;
  probe?: {
    at: string;
    result:
      | "accessible"
      | "authorization"
      | "permission"
      | "missing"
      | "unavailable"
      | "throttled";
    destination?: string;
  };
};
export type HealthIssue = {
  id: string;
  service: HealthService;
  category: keyof typeof issueContent;
  severity: "high" | "review" | "info";
  phase: "open" | "queued" | "running";
  firstSeen: string;
  lastSeen: string;
  occurrences: number;
  resolution?: "confirmed" | "cleared";
  sourceReference?: string;
  sourceAt?: string;
  resolvedAt?: string;
  lastSuccessAt?: string;
  scope?: "lesson" | "recurring_occurrence" | "transactional" | "other";
  operation?: string;
  attempts?: number;
  errorCategory?: string;
  retryable?: boolean;
  lessonId?: string;
  studentId?: string;
  invoiceId?: string;
  bookingId?: string;
  deliveryId?: string;
  recovery: { at: string; correlationId: string; result: "queued" }[];
};
export type StudioHealth = {
  checkedAt: string | null;
  automaticAt: string | null;
  checking: boolean;
  observations: HealthObservation[];
  issues: HealthIssue[];
  release: { commit: string; context: string };
};
export type RepairResult =
  | "queued"
  | "already_resolved"
  | "not_eligible"
  | "recent_retry"
  | "worker_disabled"
  | "check_in_progress"
  | "retry_limit"
  | "connection_required";

const issue = (title: string, impact: string, next: string) => ({
  title,
  impact,
  next,
});
export const issueContent = {
  google_authorization: issue(
    "Google authorization needs renewal",
    "Calendar updates and Gmail delivery can stop when the studio’s Google authorization expires.",
    "Have the deployment administrator renew offline Google consent using the same studio account and OAuth client. Replace GOOGLE_REFRESH_TOKEN in Netlify production Functions, publish through the normal release process, then test Calendar access in Connections.",
  ),
  google_configuration: issue(
    "Google is not configured",
    "Calendar and Gmail operations that use this account cannot start.",
    "Ask the deployment operator to review the studio’s Google account configuration.",
  ),
  google_permission: issue(
    "Google Calendar permissions need review",
    "Coach’D could not verify access to the selected calendar for event updates.",
    "In Google Calendar, verify the connected account has permission to make changes. Run Check now after updating access. Ask the deployment operator to review OAuth scopes if access still fails.",
  ),
  google_missing: issue(
    "Selected calendar needs review",
    "The configured calendar could not be located on the Google account’s calendar list.",
    "In Google Calendar, check Settings and sharing for the configured calendar and restore access for the connected studio account. If the calendar was replaced, have the deployment administrator verify existing event mappings before changing GOOGLE_CALENDAR_ID in Netlify production Functions.",
  ),
  google_throttled: issue(
    "Google is limiting Calendar checks",
    "Calendar access could not be verified in this check.",
    "Wait for Google’s rate limit to clear before running Check now again.",
  ),
  calendar_authorization: issue(
    "Google rejected synchronization authorization",
    "The lesson is saved in Coach’D. Its Google event update has not been confirmed.",
    "Verify the Google connection. Ask the deployment operator to renew the studio authorization if it has expired.",
  ),
  calendar_permission: issue(
    "Google rejected a Calendar operation",
    "The lesson is saved in Coach’D. Its Google event update has not been confirmed.",
    "Check Calendar sharing permissions and the selected destination in Connections.",
  ),
  calendar_sync: issue(
    "Lesson synchronization needs attention",
    "The lesson is saved in Coach’D. Its Calendar event may be out of date.",
    "Review the affected lesson and verify Calendar access. The Calendar worker retries transient failures automatically.",
  ),
  calendar_timeout: issue(
    "Calendar synchronization timed out",
    "Coach’D could not confirm the Calendar update for this lesson.",
    "Review the lesson. An eligible retry uses the same event identity.",
  ),
  calendar_throttled: issue(
    "Google limited an event update",
    "The lesson is saved in Coach’D. Its Calendar update is delayed.",
    "Allow time for Google’s rate limit and the Calendar worker’s backoff.",
  ),
  calendar_review: issue(
    "Calendar change requires review",
    "An existing event, recurring change or conflict needs review before synchronization can continue.",
    "Open the affected lesson and compare it with Google Calendar. Share the diagnostic reference if the projection remains held.",
  ),
  calendar_stalled: issue(
    "Calendar processing is delayed",
    "A lesson update has been waiting longer than expected.",
    "Review the affected lesson and the Calendar worker status. Share diagnostics if waiting work does not clear.",
  ),
  email_preflight: issue(
    "An email stopped before submission",
    "Gmail submission was not started for this message.",
    "Review the authorized record and recipient. If eligible, queue this same message after correcting the problem.",
  ),
  email_ambiguous: issue(
    "Gmail acceptance could not be confirmed",
    "Gmail may already have accepted the message. Automatic resubmission of this record is held.",
    "Check Sent mail or provider delivery logs using the diagnostic reference before deciding whether a new communication is appropriate.",
  ),
  email_failed: issue(
    "Email processing needs attention",
    "Coach’D has no confirmed provider acceptance for this message.",
    "Review delivery history and the related record. An older failure or a stalled message needs review before sending again.",
  ),
  email_recipient: issue(
    "Email was withheld for recipient review",
    "The current recipient authorization or invoice details did not match the queued communication.",
    "Open the related record to review the current authorized recipient and use its established communication workflow.",
  ),
  stripe_processing: issue(
    "Stripe processing needs review",
    "A linked payment event did not finish processing. The associated payment or invoice may need reconciliation.",
    "Open the related record and compare its status with Stripe. Share diagnostics with the deployment operator if they disagree.",
  ),
  stripe_payment_failed: issue(
    "A scheduled payment did not complete",
    "Coach’D recorded a failed authorized payment attempt for this lesson.",
    "Review the lesson or invoice in Finance and verify its payment state. Share diagnostics if the provider and portal disagree.",
  ),
  stripe_configuration: issue(
    "Stripe configuration needs review",
    "The deployment is missing payment or webhook configuration.",
    "Ask the deployment operator to verify the Stripe account, signing configuration and endpoint.",
  ),
  job_failed: issue(
    "Booking maintenance failed",
    "Expired holds, recurring booking maintenance or downstream reconciliation may be delayed.",
    "Review the latest execution reference and share diagnostics with the deployment operator. The scheduler owns retries.",
  ),
  job_stalled: issue(
    "Booking maintenance has stopped reporting",
    "Time-sensitive booking maintenance may be delayed.",
    "Ask the deployment operator to check the scheduled function, its last execution and the worker receipt.",
  ),
} as const;

export function freshHealthTime(
  value: string | null | undefined,
  ageMs: number,
  now = Date.now(),
) {
  if (!value) return false;
  const time = Date.parse(value);
  return time <= now && now - time <= ageMs;
}
export function currentObservation(
  observation: HealthObservation,
  now = Date.now(),
): HealthObservation {
  if (freshHealthTime(observation.checkedAt, 35 * 60_000, now))
    return observation;
  return {
    ...observation,
    authorization: "unknown",
    state: "unavailable",
    detail:
      "The last completed check is too old. Run Check now for fresh evidence.",
  };
}
export function dashboardSystemIssues(health: StudioHealth) {
  const seen = new Set<HealthService>();
  return health.issues
    .filter((issue) => {
      if (
        issue.resolvedAt ||
        issue.phase !== "open" ||
        issue.severity !== "high" ||
        seen.has(issue.service)
      )
        return false;
      const observation = health.observations.find(
        (check) => check.service === issue.service,
      );
      if (!observation || !freshHealthTime(observation.checkedAt, 35 * 60_000))
        return false;
      seen.add(issue.service);
      return true;
    })
    .slice(0, 3);
}
export function systemIssueLink(id: string) {
  return "/coach/settings?panel=health&issue=" + encodeURIComponent(id);
}
export function issueRecordLink(issue: HealthIssue) {
  if (issue.invoiceId)
    return (
      "/coach/finance?view=payments&invoice=" +
      encodeURIComponent(issue.invoiceId)
    );
  if (issue.bookingId)
    return "/coach/bookings?booking=" + encodeURIComponent(issue.bookingId);
  if (issue.lessonId)
    return issue.studentId
      ? "/coach/students/" +
          encodeURIComponent(issue.studentId) +
          "/lessons/" +
          encodeURIComponent(issue.lessonId)
      : "/coach/bookings?lesson=" + encodeURIComponent(issue.lessonId);
  if (issue.studentId)
    return "/coach/students/" + encodeURIComponent(issue.studentId);
  return null;
}
export function issueStatus(issue: HealthIssue) {
  if (issue.resolvedAt)
    return issue.resolution === "confirmed"
      ? "Recovery confirmed"
      : "Cleared from active monitoring";
  if (issue.phase === "queued") return "Retry queued";
  if (issue.phase === "running") return "Processing";
  if (issue.category === "email_ambiguous") return "Unable to verify";
  return "Needs review";
}
const safeCategory = (value?: string) =>
  value && /^[a-z_]{1,60}$/.test(value) ? value : "unknown";
const safeId = (value?: string) =>
  value && /^[a-z0-9-]{1,64}$/i.test(value) ? value : "unavailable";
const safeTime = (value?: string | null) =>
  value && Number.isFinite(Date.parse(value))
    ? new Date(value).toISOString()
    : "unavailable";

export function diagnosticText(
  issue: HealthIssue,
  health: StudioHealth,
  timezone: string,
) {
  const details = issueContent[issue.category];
  const observation = health.observations.find(
    (check) => check.service === issue.service,
  );
  return [
    details.title,
    "Issue ID: " + safeId(issue.id),
    "Service: " + healthLabels[issue.service],
    ...(issue.sourceReference
      ? [
          "Source reference: " +
            (/^evt_[a-z0-9]{1,50}$/i.test(issue.sourceReference)
              ? issue.sourceReference
              : safeId(issue.sourceReference)),
        ]
      : []),
    "Operation: " + safeCategory(issue.operation),
    "Category: " + safeCategory(issue.category),
    ...(issue.errorCategory
      ? ["Worker error category: " + safeCategory(issue.errorCategory)]
      : []),
    "Status: " + issueStatus(issue),
    "Studio timezone: " +
      (/^[a-z0-9_+/-]{1,80}$/i.test(timezone) ? timezone : "unavailable") +
      " (timestamps in UTC)",
    "First detected: " + safeTime(issue.firstSeen),
    "Most recent occurrence: " + safeTime(issue.lastSeen),
    "Source timestamp: " + safeTime(issue.sourceAt),
    "Last verified operation: " +
      safeTime(issue.lastSuccessAt ?? observation?.lastSuccessAt),
    "Last check: " + safeTime(observation?.checkedAt),
    "Build: " +
      safeId(health.release.commit) +
      " (" +
      safeId(health.release.context) +
      ")",
    ...issue.recovery.map(
      (attempt) =>
        "Recovery queued at " +
        safeTime(attempt.at) +
        " (reference " +
        safeId(attempt.correlationId) +
        ")",
    ),
    "Next step: " + details.next,
  ].join("\n");
}
