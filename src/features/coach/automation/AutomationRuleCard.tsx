import {
  automationRuleLabels,
  type AutomationRuleKey,
  type AutomationRule,
} from "../../../domain/automationRules";
import type { Tables } from "../../../types/database.generated";
import { Status } from "../../../components/Primitives";
import { ruleDescriptions } from "./ruleDescriptions";
export function AutomationRuleCard({
  rule,
  last,
  onEdit,
  onPreview,
}: {
  rule: Tables<"automation_rules">;
  last?: Pick<Tables<"automation_runs">, "result" | "explanation">;
  onEdit: () => void;
  onPreview: () => void;
}) {
  const timing = rule.timing as AutomationRule["timing"];
  const description = ruleDescriptions[rule.rule_key as AutomationRuleKey];
  return (
    <article className="communication-card">
      <div className="action-row">
        <h3>{automationRuleLabels[rule.rule_key as AutomationRuleKey]}</h3>
        <Status>{rule.mode.replaceAll("_", " ")}</Status>
      </div>
      <dl>
        <dt>When</dt>
        <dd>
          {description.when}
          {["lesson_reminder", "payment_due"].includes(rule.rule_key) &&
          timing.hoursBefore?.length
            ? ` · ${timing.hoursBefore.join(", ")} hours before lesson`
            : ""}
          {rule.rule_key === "package_expiration"
            ? ` · within ${timing.daysBefore ?? 30} days`
            : ""}
          {rule.rule_key === "package_low"
            ? ` · ${timing.lowThreshold ?? 1} credit(s) or fewer`
            : ""}
        </dd>
        <dt>Send to</dt>
        <dd>{description.audience}</dd>
        <dt>Only if</dt>
        <dd>{description.condition}</dd>
        <dt>Stop when</dt>
        <dd>{description.stop}</dd>
        <dt>Escalation</dt>
        <dd>
          {["lesson_reminder", "payment_due", "payment_past_due"].includes(
            rule.rule_key,
          ) &&
          rule.mode === "automatic_with_escalation" &&
          (rule.escalation as AutomationRule["escalation"]).coach
            ? rule.rule_key === "payment_past_due"
              ? "Coach alert with the past-due follow-up"
              : `Coach alert ${(rule.escalation as AutomationRule["escalation"]).hoursBefore ?? 1} hour(s) before lesson`
            : "None"}
        </dd>
        <dt>Recent run</dt>
        <dd>
          {last
            ? `${last.result}: ${last.explanation}`
            : "No recent evaluation"}
        </dd>
        <dt>Content</dt>
        <dd>
          {(rule.template as AutomationRule["template"]).subject ||
            "Current/default subject and message"}
          . Destination is fixed to the relevant portal action.
        </dd>
      </dl>
      <div className="action-row">
        <button type="button" onClick={onEdit}>
          Edit {automationRuleLabels[rule.rule_key as AutomationRuleKey]}
        </button>
        <button type="button" onClick={onPreview}>
          Preview / test rule
        </button>
      </div>
    </article>
  );
}
