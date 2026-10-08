import {
  automationRuleLabels,
  type AutomationRuleKey,
  type AutomationRule,
} from "../../../domain/automationRules";
import type { Tables } from "../../../types/database.generated";
import type { FormEvent } from "react";
import { Drawer } from "../../../components/Primitives";
import { paymentReminderNeedsApproval } from "../../../domain/paymentReminder";
export function AutomationRuleEditor({
  edit,
  busy,
  notice,
  onClose,
  onSave,
}: {
  edit: Tables<"automation_rules">;
  busy: boolean;
  notice: string;
  onClose: () => void;
  onSave: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const timed = ["lesson_reminder", "payment_due"].includes(edit.rule_key);
  const escalation = timed || edit.rule_key === "payment_past_due";
  return (
    <Drawer
      title={`Edit ${automationRuleLabels[edit.rule_key as AutomationRuleKey]}`}
      onClose={onClose}
    >
      <form className="settings-form" onSubmit={onSave}>
        {paymentReminderNeedsApproval(edit.rule_key) && (
          <p className="full">
            Payer reminders always wait for coach approval. Automatic mode
            evaluates and prepares drafts; coach escalation follows the rule
            settings.
          </p>
        )}
        {notice && (
          <p className="full" role="alert">
            {notice}
          </p>
        )}
        <label>
          Mode
          <select
            name="mode"
            defaultValue={edit.mode}
            aria-describedby="automation-mode-help"
          >
            <option value="off">Off</option>
            <option value="draft">Draft</option>
            <option value="automatic">Automatic</option>
            <option value="automatic_with_escalation">
              Automatic with coach escalation
            </option>
          </select>
        </label>
        <small id="automation-mode-help" className="full">
          {paymentReminderNeedsApproval(edit.rule_key)
            ? "Automatic mode prepares payer drafts for coach approval."
            : "Draft creates email for review; automatic queues delivery."}
        </small>
        <label hidden={!timed}>
          Hours before lesson (comma-separated)
          <input
            name="hours"
            defaultValue={
              (edit.timing as AutomationRule["timing"]).hoursBefore?.join(
                ", ",
              ) ?? "24, 2"
            }
          />
        </label>
        <label hidden={edit.rule_key !== "package_expiration"}>
          Expiration warning days
          <input
            name="days"
            type="number"
            min="1"
            max="365"
            defaultValue={
              (edit.timing as AutomationRule["timing"]).daysBefore ?? 30
            }
          />
        </label>
        <label hidden={edit.rule_key !== "package_low"}>
          Low credit threshold
          <input
            name="threshold"
            type="number"
            min="0"
            max="100"
            defaultValue={
              (edit.timing as AutomationRule["timing"]).lowThreshold ?? 1
            }
          />
        </label>
        <label hidden={!escalation}>
          Coach escalation
          <input
            name="coach"
            type="checkbox"
            defaultChecked={
              (edit.escalation as AutomationRule["escalation"]).coach ?? false
            }
          />
        </label>
        <label hidden={!timed}>
          Escalate hours before lesson
          <input
            name="escalationHours"
            type="number"
            min="0.1"
            step="0.1"
            max="8760"
            defaultValue={
              (edit.escalation as AutomationRule["escalation"]).hoursBefore ?? 1
            }
          />
        </label>
        {edit.rule_key === "payment_past_due" && (
          <p className="full">
            One follow-up per lesson while the balance remains past due. Coach
            escalation, when enabled, accompanies that follow-up.
          </p>
        )}
        <label>
          Subject (blank uses existing/default content)
          <input
            name="subject"
            maxLength={200}
            defaultValue={
              (edit.template as AutomationRule["template"]).subject ?? ""
            }
          />
        </label>
        <label className="full">
          Message
          <textarea
            name="body"
            maxLength={6000}
            rows={5}
            defaultValue={
              (edit.template as AutomationRule["template"]).body ?? ""
            }
          />
        </label>
        <label>
          Primary button label
          <input
            name="cta"
            maxLength={60}
            defaultValue={
              (edit.template as AutomationRule["template"]).ctaLabel ?? ""
            }
          />
        </label>
        <p className="full">
          Recipients, canonical destination and mandatory suppressions cannot be
          bypassed by template edits. Meet links are not included.
        </p>
        <p className="full">
          Template fields:{" "}
          {"{{studioName}}, {{studentName}}, {{manageUrl}}, {{renewUrl}}"}.
          Lesson rules also support {"{{serviceName}}, {{startsAt}},"}
          {
            " {{recipientName}}, {{hours}}, {{amountDue}}, {{timezone}} and {{location}}"
          }{" "}
          . Leave blank to retain the current/default message.
        </p>
        <button disabled={busy} type="submit">
          {busy ? "Saving…" : "Save rule"}
        </button>
      </form>
    </Drawer>
  );
}
