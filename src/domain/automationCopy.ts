import type { AutomationRuleKey } from "./automationRules";

/** Presentation only: timing and financial eligibility remain owned by the evaluator. */
export function automationInstruction(
  key: AutomationRuleKey,
  stage: string,
  coach: boolean,
): string {
  if (coach)
    return "Please review the unresolved condition in the coach workspace.";
  const hours = stage.startsWith("hours-") ? Number(stage.slice(6)) : NaN;
  if (key === "payment_due" && Number.isFinite(hours) && hours <= 2)
    return "Your lesson is approaching. Please settle the recorded balance or contact your coach to agree an arrangement.";
  return "Please open the portal for the details.";
}
