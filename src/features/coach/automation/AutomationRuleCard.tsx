import {
  automationRuleLabels,
  type AutomationRuleKey,
  type AutomationRule,
} from "../../../domain/automationRules";
import type { Tables } from "../../../types/database.generated";
import { Status } from "../../../components/Primitives";
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
  return (
    <article className="communication-card">
      <div className="action-row">
        <h3>{automationRuleLabels[rule.rule_key as AutomationRuleKey]}</h3>
        <Status>{rule.mode.replaceAll("_", " ")}</Status>
      </div>
      <dl>
        <dt>When</dt>
        <dd>
          {rule.trigger.replaceAll("_", " ")}
          {timing.hoursBefore?.length
            ? ` · ${timing.hoursBefore.join(", ")} hours before lesson`
            : ""}
          {rule.rule_key === "package_expiration"
            ? ` · within ${timing.daysBefore ?? 30} days`
            : ""}
        </dd>
        <dt>Send to</dt>
        <dd>
          {rule.audience === "coach"
            ? "Coach"
            : "Eligible recipients only: scheduling contacts for lesson updates; primary payer for finance. Minors never receive billing reminders."}
        </dd>
        <dt>Only if</dt>
        <dd>
          The authoritative lesson, booking or package condition still holds.
        </dd>
        <dt>Stop when</dt>
        <dd>
          Paid, covered by credits, waived, cancelled, rescheduled, renewed,
          preferences disabled, permission removed, or a duplicate exists.
        </dd>
        <dt>Escalation</dt>
        <dd>
          {(rule.escalation as AutomationRule["escalation"]).coach
            ? "Coach alert at configured threshold"
            : "None"}
        </dd>
        <dt>Recent run</dt>
        <dd>
          {last
            ? `${last.result}: ${last.explanation}`
            : "No recent evaluation"}
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
