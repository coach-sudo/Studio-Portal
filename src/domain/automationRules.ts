import type { Lesson, OutboxMessage, PackageAccount } from "./model";
import { evaluateLessonReadiness, type ReadinessData } from "./lessonReadiness";
import { forecastPackages } from "./packageForecast";
import type { RecipientIntent } from "./notificationRecipients";

export const automationRuleKeys = [
  "booking_confirmation",
  "lesson_reminder",
  "payment_due",
  "payment_past_due",
  "payment_failed",
  "package_low",
  "package_shortfall",
  "package_expiration",
  "missing_financial_setup",
  "delivery_failure",
] as const;
export type AutomationRuleKey = (typeof automationRuleKeys)[number];
export type AutomationMode =
  "off" | "draft" | "automatic" | "automatic_with_escalation";
export interface AutomationRule {
  id: string;
  studioId: string;
  key: AutomationRuleKey;
  enabled: boolean;
  mode: AutomationMode;
  trigger: string;
  audience: RecipientIntent | "coach";
  timing: {
    hoursBefore?: number[];
    daysBefore?: number;
    lowThreshold?: number;
  };
  conditions: { scheduledOnly?: boolean };
  suppressions: string[];
  escalation: { hoursBefore?: number; coach?: boolean };
  template: { subject?: string; body?: string; ctaLabel?: string };
  priority: number;
  version: number;
  updatedAt: string;
}
export const automationRuleLabels: Record<AutomationRuleKey, string> = {
  booking_confirmation: "Booking confirmation",
  lesson_reminder: "Lesson reminder",
  payment_due: "Payment due",
  payment_past_due: "Past-due follow-up",
  payment_failed: "Payment failure",
  package_low: "Package low balance",
  package_shortfall: "Package coverage shortfall",
  package_expiration: "Package expiration",
  missing_financial_setup: "Missing financial setup",
  delivery_failure: "Delivery failure alert",
};
export interface AutomationEntity {
  lesson?: Lesson;
  package?: PackageAccount;
  message?: OutboxMessage;
}
export interface AutomationDecision {
  eligible: boolean;
  explanation: string;
  suppressedReason?: string;
  financialState?: string;
  stages: { key: string; sendAt: string; coachEscalation?: boolean }[];
}
const suppressed = (
  reason: string,
  explanation: string,
  financialState?: string,
): AutomationDecision => ({
  eligible: false,
  explanation,
  suppressedReason: reason,
  financialState,
  stages: [],
});

/** Only the constrained library is evaluated. This function never queues or sends. */
export function evaluateAutomationRule(
  rule: AutomationRule,
  entity: AutomationEntity,
  data: ReadinessData,
  now: number,
): AutomationDecision {
  if (!rule.enabled || rule.mode === "off")
    return suppressed("rule_off", "This rule is off.");
  if (!data.settings.emailAutomations.enabled)
    return suppressed(
      "automation_disabled",
      "The studio automated-email master switch is off.",
    );
  const lesson = entity.lesson;
  const readiness = lesson && evaluateLessonReadiness(lesson, data, now);
  if (lesson && !readiness?.active)
    return suppressed(
      "lesson_not_scheduled",
      "The lesson is no longer scheduled.",
    );
  let explanation = "The rule's condition is met.";
  let eligible = false;
  const stages: AutomationDecision["stages"] = [];
  switch (rule.key) {
    case "booking_confirmation":
      eligible = Boolean(
        lesson &&
        data.lessonParticipants.some(
          (item) =>
            item.lessonId === lesson.id &&
            item.bookingId &&
            data.bookings.some(
              (booking) =>
                booking.id === item.bookingId && booking.status === "confirmed",
            ),
        ),
      );
      explanation = "Booking is confirmed.";
      break;
    case "lesson_reminder":
      eligible = Boolean(lesson);
      explanation = "Lesson is scheduled.";
      break;
    case "payment_due":
      eligible = Boolean(
        readiness &&
        ["payment_due", "partially_paid", "past_due"].includes(
          readiness.financial.state,
        ) &&
        readiness.financial.amountDueMinor > 0,
      );
      explanation = "The recorded lesson balance still requires payment.";
      break;
    case "payment_past_due":
      eligible =
        readiness?.financial.state === "past_due" &&
        readiness.financial.amountDueMinor > 0;
      explanation = "The recorded balance is past due.";
      break;
    case "payment_failed":
      eligible =
        readiness?.financial.state === "review_required" &&
        data.bookings.some(
          (booking) =>
            booking.studentId === lesson?.studentId &&
            booking.startsAt === lesson?.startsAt &&
            booking.paymentStatus === "failed",
        );
      explanation = "Payment provider recorded a failure.";
      break;
    case "missing_financial_setup":
      eligible = Boolean(
        readiness?.issues.some((issue) =>
          [
            "FINANCIAL_REVIEW_REQUIRED",
            "PAYER_CONFIGURATION_REQUIRED",
          ].includes(issue.code),
        ),
      );
      explanation = "The lesson's financial setup or payer needs coach review.";
      break;
    case "delivery_failure":
      eligible =
        entity.message?.status === "failed" &&
        !entity.message.eventKey?.startsWith("automation.delivery_failure");
      explanation = "An outbox message failed to deliver.";
      break;
    case "package_low":
    case "package_shortfall":
    case "package_expiration": {
      const pkg = entity.package;
      const forecast =
        pkg &&
        forecastPackages(pkg.studentId, data, now).find(
          (item) => item.packageId === pkg.id,
        );
      if (!pkg || !forecast) break;
      const unexpired = !pkg.expiresAt || Date.parse(pkg.expiresAt) > now;
      const renewed = data.packages.some(
        (other) =>
          other.id !== pkg.id &&
          other.studentId === pkg.studentId &&
          other.definitionId === pkg.definitionId &&
          (!other.expiresAt || Date.parse(other.expiresAt) > now) &&
          forecastPackages(pkg.studentId, data, now).some(
            (item) => item.packageId === other.id && item.currentCredits > 0,
          ),
      );
      if (renewed)
        return suppressed(
          "package_renewed",
          "A replacement package has available credits.",
        );
      if (rule.key === "package_low") {
        eligible =
          unexpired &&
          forecast.currentCredits >= 0 &&
          forecast.currentCredits <= (rule.timing.lowThreshold ?? 1);
        explanation = `${forecast.currentCredits} session credit(s) remain.`;
      }
      if (rule.key === "package_shortfall") {
        eligible = forecast.uncoveredLessonIds.length > 0;
        explanation = `${forecast.uncoveredLessonIds.length} upcoming lesson(s) are not covered by the current package.`;
      }
      if (rule.key === "package_expiration") {
        eligible = Boolean(
          pkg.expiresAt &&
          forecast.currentCredits > 0 &&
          Date.parse(pkg.expiresAt) > now &&
          Date.parse(pkg.expiresAt) - now <=
            (rule.timing.daysBefore ?? 7) * 86_400_000,
        );
        explanation =
          "An active package with remaining credits is approaching expiration.";
      }
      break;
    }
  }
  if (!eligible)
    return suppressed(
      "condition_resolved",
      "The rule's condition is no longer true.",
      readiness?.financial.state,
    );
  // Arrears are a separate, once-per-lesson follow-up, not a missed pre-lesson reminder.
  // The stable stage/dedupe key prevents a five-minute worker from repeatedly billing.
  if (rule.key === "payment_past_due") {
    stages.push({ key: "past-due", sendAt: new Date(now).toISOString() });
    if (rule.mode === "automatic_with_escalation" && rule.escalation.coach)
      stages.push({
        key: "coach-escalation",
        sendAt: new Date(now).toISOString(),
        coachEscalation: true,
      });
    return {
      eligible: true,
      explanation,
      financialState: readiness?.financial.state,
      stages,
    };
  }
  if (
    lesson &&
    ["lesson_reminder", "payment_due", "payment_past_due"].includes(rule.key)
  ) {
    const thresholds = [...new Set(rule.timing.hoursBefore ?? [24, 2])]
      .filter((hours) => Number.isFinite(hours) && hours > 0)
      .sort((a, b) => b - a);
    const upcoming = thresholds.filter(
      (hours) => Date.parse(lesson.startsAt) - hours * 3_600_000 >= now,
    );
    // At evaluation time, allow only the latest elapsed stage; never replay every missed reminder.
    const elapsed = thresholds.filter(
      (hours) => Date.parse(lesson.startsAt) - hours * 3_600_000 < now,
    );
    if (Date.parse(lesson.startsAt) > now && elapsed.length)
      upcoming.push(Math.min(...elapsed));
    for (const hours of upcoming)
      stages.push({
        key: `hours-${hours}`,
        sendAt: new Date(
          Math.max(now, Date.parse(lesson.startsAt) - hours * 3_600_000),
        ).toISOString(),
      });
    if (
      rule.mode === "automatic_with_escalation" &&
      rule.escalation.coach &&
      rule.escalation.hoursBefore != null
    )
      stages.push({
        key: "coach-escalation",
        sendAt: new Date(
          Math.max(
            now,
            Date.parse(lesson.startsAt) -
              rule.escalation.hoursBefore * 3_600_000,
          ),
        ).toISOString(),
        coachEscalation: true,
      });
    if (!stages.length)
      return suppressed(
        "lesson_started",
        "The reminder window has ended.",
        readiness?.financial.state,
      );
  } else stages.push({ key: "initial", sendAt: new Date(now).toISOString() });
  return {
    eligible: true,
    explanation,
    financialState: readiness?.financial.state,
    stages,
  };
}
