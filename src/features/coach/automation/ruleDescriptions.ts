import type { AutomationRuleKey } from "../../../domain/automationRules";

// Describe the constrained evaluator, not a generic workflow that can bypass it.
export const ruleDescriptions: Record<
  AutomationRuleKey,
  { when: string; audience: string; condition: string; stop: string }
> = {
  booking_confirmation: {
    when: "When a booking is confirmed",
    audience: "Student and permitted scheduling contact",
    condition: "The booking is confirmed and lesson remains scheduled.",
    stop: "Lesson cancelled or rescheduled, schedule access removed, preference disabled, or confirmation already exists.",
  },
  lesson_reminder: {
    when: "Before a scheduled lesson",
    audience: "Student and permitted scheduling contact",
    condition: "The lesson is scheduled and its reminder window has not ended.",
    stop: "Lesson cancelled or rescheduled, schedule access removed, reminder preference disabled, or equivalent reminder already exists.",
  },
  payment_due: {
    when: "Before an unpaid lesson",
    audience: "Primary payer, or permitted adult self-payer; never a minor",
    condition: "The recorded lesson balance is still due or partially paid.",
    stop: "Paid, covered by credits, waived, cancelled, rescheduled, finance access removed, preference disabled, or equivalent stage already exists.",
  },
  payment_past_due: {
    when: "Once per lesson when a recorded balance is past due",
    audience:
      "Primary payer and permitted financial-escalation contacts; never a minor",
    condition: "A recorded past-due balance remains outstanding.",
    stop: "Paid, covered by credits, waived, cancelled, finance access removed, preference disabled, or past-due follow-up already exists.",
  },
  payment_failed: {
    when: "When a payment failure is recorded",
    audience: "Primary payer, or permitted adult self-payer; never a minor",
    condition: "The matched booking payment still has failed status.",
    stop: "Payment resolved, lesson cancelled, finance access removed, or equivalent failure notice already exists.",
  },
  package_low: {
    when: "When available credits reach the configured threshold",
    audience: "Primary payer, or permitted adult self-payer; never a minor",
    condition:
      "An unexpired package has credits at or below the configured threshold.",
    stop: "Replacement package has credits, balance rises above threshold, package expires, finance access removed, preference disabled, or warning already exists.",
  },
  package_shortfall: {
    when: "When scheduled lessons exceed applicable credits",
    audience: "Primary payer, or permitted adult self-payer; never a minor",
    condition: "The package forecast contains an uncovered upcoming lesson.",
    stop: "Coverage restored, package renewed, schedule changes resolve the shortfall, finance access removed, preference disabled, or equivalent warning exists.",
  },
  package_expiration: {
    when: "Before a package expires",
    audience: "Primary payer, or permitted adult self-payer; never a minor",
    condition:
      "An active package has unused credits and is within its expiration warning window.",
    stop: "Package renewed, expired or exhausted, finance access removed, preference disabled, or expiration warning already exists.",
  },
  missing_financial_setup: {
    when: "When upcoming lesson financial setup needs review",
    audience: "Established coach account only",
    condition:
      "Financial information or payer responsibility requires coach review.",
    stop: "Setup resolved, lesson cancelled, or equivalent coach alert exists.",
  },
  delivery_failure: {
    when: "When an existing outbox message fails",
    audience: "Established coach account only",
    condition:
      "Delivery still has failed status; failure alerts do not trigger themselves.",
    stop: "Delivery succeeds, message is cancelled, or an alert for the same failure already exists.",
  },
};
