import { automationRuleKeys } from "../../../domain/automationRules";
import type { StudioSnapshot } from "../../../domain/model";
import type { Tables } from "../../../types/database.generated";
type Rule = Tables<"automation_rules">;
export function demoRules(data: StudioSnapshot): Rule[] {
  const enabled = (key: string) =>
    data.settings.emailAutomations.enabled &&
    [
      "booking_confirmation",
      "lesson_reminder",
      "payment_failed",
      "package_low",
      "package_expiration",
    ].includes(key) &&
    (key !== "booking_confirmation" ||
      data.settings.emailAutomations.studentConfirmation) &&
    (key !== "lesson_reminder" || data.settings.emailAutomations.reminders);
  return automationRuleKeys.map((key) => ({
    id: `demo-${key}`,
    studio_id: data.studioId,
    rule_key: key,
    enabled: enabled(key),
    mode: enabled(key) ? "automatic" : "off",
    trigger: key.startsWith("package_") ? "package_state" : "lesson_state",
    audience: ["missing_financial_setup", "delivery_failure"].includes(key)
      ? "coach"
      : key === "booking_confirmation"
        ? "lesson_confirmation"
        : key,
    conditions: { scheduledOnly: true },
    timing: {
      hoursBefore: data.settings.reminderHours,
      daysBefore: 30,
      lowThreshold: 1,
    },
    suppressions: [
      "Payment resolved",
      "Lesson cancelled/rescheduled",
      "Preference disabled",
      "Permission removed",
      "Duplicate",
    ],
    escalation: { coach: false },
    template: {},
    priority: 60,
    version: 1,
    created_at: "",
    updated_at: "",
  }));
}
