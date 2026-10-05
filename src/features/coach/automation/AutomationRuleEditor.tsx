import {
  automationRuleLabels,
  type AutomationRuleKey,
  type AutomationRule,
} from "../../../domain/automationRules";
import type { Tables } from "../../../types/database.generated";
import type { FormEvent } from "react";
import { Dialog } from "../../../components/Primitives";
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
  return (
    <Dialog
      title={`Edit ${automationRuleLabels[edit.rule_key as AutomationRuleKey]}`}
      onClose={onClose}
    >
      <form className="settings-form" onSubmit={onSave}>
        {notice && (
          <p className="full" role="alert">
            {notice}
          </p>
        )}
        <label>
          Mode
          <select name="mode" defaultValue={edit.mode}>
            <option value="off">Off</option>
            <option value="draft">Draft</option>
            <option value="automatic">Automatic</option>
            <option value="automatic_with_escalation">
              Automatic with coach escalation
            </option>
          </select>
        </label>
        <label>
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
        <label>
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
        <label>
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
        <label>
          Coach escalation
          <input
            name="coach"
            type="checkbox"
            defaultChecked={
              (edit.escalation as AutomationRule["escalation"]).coach ?? false
            }
          />
        </label>
        <label>
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
        <button disabled={busy} type="submit">
          {busy ? "Saving…" : "Save rule"}
        </button>
      </form>
    </Dialog>
  );
}
