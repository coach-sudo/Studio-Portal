import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Dialog, Section, Status } from "../../components/Primitives";
import { studioCommand } from "../../data/bookingCommands";
import {
  automationRuleKeys,
  automationRuleLabels,
  type AutomationRuleKey,
  type AutomationRule,
} from "../../domain/automationRules";
import type { StudioSnapshot } from "../../domain/model";
import type { Tables } from "../../types/database.generated";
import { supabase } from "../../lib/supabase";
import { invalidateStudioDomains } from "../../hooks/useStudio";
import "./operational-intelligence.css";

type Rule = Tables<"automation_rules">;
function demoRules(data: StudioSnapshot): Rule[] {
  return automationRuleKeys.map((key) => ({
    id: `demo-${key}`,
    studio_id: data.studioId,
    rule_key: key,
    enabled:
      [
        "booking_confirmation",
        "lesson_reminder",
        "payment_failed",
        "package_low",
        "package_expiration",
      ].includes(key) && data.settings.emailAutomations.enabled,
    mode:
      [
        "booking_confirmation",
        "lesson_reminder",
        "payment_failed",
        "package_low",
        "package_expiration",
      ].includes(key) && data.settings.emailAutomations.enabled
        ? "automatic"
        : "off",
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
export function AutomationSettings({
  data,
  isDemo,
}: {
  data: StudioSnapshot;
  isDemo: boolean;
}) {
  const queryClient = useQueryClient(),
    [local, setLocal] = useState(() => demoRules(data)),
    [edit, setEdit] = useState<Rule>(),
    [testing, setTesting] = useState<Rule>(),
    [entityId, setEntityId] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [preview, setPreview] = useState("");
  const rules = useQuery({
    queryKey: [
      "studio-page",
      "administration",
      "automation-rules",
      data.studioId,
    ],
    enabled: !isDemo && Boolean(supabase),
    staleTime: 30000,
    queryFn: async ({ signal }) => {
      const result = await supabase!
        .from("automation_rules")
        .select("*")
        .eq("studio_id", data.studioId)
        .order("priority", { ascending: false })
        .order("rule_key")
        .abortSignal(signal);
      if (result.error) throw result.error;
      return result.data;
    },
  });
  const runs = useQuery({
    queryKey: [
      "studio-page",
      "administration",
      "automation-runs",
      data.studioId,
    ],
    enabled: !isDemo && Boolean(supabase),
    staleTime: 30000,
    queryFn: async ({ signal }) => {
      const result = await supabase!
        .from("automation_runs")
        .select(
          "id,rule_id,result,explanation,suppressed_reason,evaluated_at,correlation_id",
        )
        .eq("studio_id", data.studioId)
        .order("evaluated_at", { ascending: false })
        .limit(25)
        .abortSignal(signal);
      if (result.error) throw result.error;
      return result.data;
    },
  });
  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!edit) return;
    setBusy(true);
    setNotice("");
    const form = new FormData(event.currentTarget),
      mode = String(form.get("mode")) as AutomationRule["mode"];
    const payload = {
      enabled: mode !== "off",
      mode,
      timing: {
        hoursBefore: String(form.get("hours") ?? "")
          .split(",")
          .map((item) => Number(item.trim()))
          .filter((value) => value > 0),
        daysBefore: Number(form.get("days")),
        lowThreshold: Number(form.get("threshold")),
      },
      escalation: {
        coach: form.get("coach") === "on",
        hoursBefore: Number(form.get("escalationHours")),
      },
      template: {
        subject: String(form.get("subject") ?? ""),
        body: String(form.get("body") ?? ""),
        ctaLabel: String(form.get("cta") ?? ""),
      },
    };
    try {
      if (isDemo)
        setLocal((items) =>
          items.map((item) =>
            item.id === edit.id
              ? { ...item, ...payload, version: item.version + 1 }
              : item,
          ),
        );
      else
        await studioCommand("automations", {
          command: "save_rule",
          entityId: edit.id,
          expectedVersion: edit.version,
          reason: "Coach updated structured automation rule",
          payload,
        });
      await invalidateStudioDomains(queryClient, [
        "administration",
        "messaging",
      ]);
      setEdit(undefined);
      setNotice(
        "Automation rule saved. Existing messages are checked against current state before delivery.",
      );
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : "Rule could not be saved.",
      );
    } finally {
      setBusy(false);
    }
  }
  const entityType = testing?.rule_key.startsWith("package_")
    ? "package"
    : testing?.rule_key === "delivery_failure"
      ? "outbox"
      : "lesson";
  const entities =
    entityType === "package"
      ? data.packages.map((item) => ({
          id: item.id,
          studentId: item.studentId,
          label: item.name,
        }))
      : entityType === "outbox"
        ? data.outbox
            .filter((item) => item.status === "failed" && item.studentId)
            .map((item) => ({
              id: item.id,
              studentId: item.studentId!,
              label: item.subject,
            }))
        : data.lessons
            .filter((item) => item.studentId && item.status === "scheduled")
            .map((item) => ({
              id: item.id,
              studentId: item.studentId,
              label: `${item.topic} · ${data.students.find((student) => student.id === item.studentId)?.fullName ?? "Student"}`,
            }));
  async function testRule(run: boolean) {
    if (!testing) return;
    setBusy(true);
    setPreview("");
    try {
      if (isDemo)
        throw new Error(
          "Demo preview does not evaluate live records or queue mail. Use the isolated coach fixture for rule testing.",
        );
      const entity = entities.find((item) => item.id === entityId);
      if (!entity) throw new Error("Choose an entity to evaluate.");
      const result = await studioCommand("automations", {
        command: run ? "run_rule" : "test_rule",
        entityId: testing.id,
        expectedVersion: testing.version,
        reason: run
          ? "Coach requested constrained rule evaluation"
          : "Coach requested non-sending rule preview",
        payload: { studentId: entity.studentId, entityId: entity.id },
      });
      setPreview(
        `${result.resource.decision.explanation} Result: ${result.resource.result}. ${result.resource.outboxIds.length} outbox item(s).${result.resource.recipients.unresolved.length ? " Recipient unresolved." : ""}`,
      );
      await invalidateStudioDomains(queryClient, [
        "administration",
        "messaging",
      ]);
    } catch (error) {
      setPreview(error instanceof Error ? error.message : "Evaluation failed.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Section title="Automation rules" marked>
      <p>
        Structured, explainable rules. Draft creates reviewable email only;
        automatic queues through the existing delivery worker. New billing and
        forecast rules start off.
      </p>
      <p role="status">{notice}</p>
      {rules.isError && (
        <p role="alert">
          Rules could not be loaded.{" "}
          <button type="button" onClick={() => void rules.refetch()}>
            Retry
          </button>
        </p>
      )}
      {runs.isError && (
        <p role="alert">Recent evaluations could not be loaded.</p>
      )}
      {!isDemo && rules.isPending ? (
        <p role="status">Loading rules…</p>
      ) : (
        <div className="automation-rule-grid">
          {(isDemo ? local : (rules.data ?? [])).map((rule) => {
            const timing = rule.timing as AutomationRule["timing"],
              last = runs.data?.find((run) => run.rule_id === rule.id);
            return (
              <article key={rule.id} className="communication-card">
                <div className="action-row">
                  <h3>
                    {automationRuleLabels[rule.rule_key as AutomationRuleKey]}
                  </h3>
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
                    The authoritative lesson, booking or package condition still
                    holds.
                  </dd>
                  <dt>Stop when</dt>
                  <dd>
                    Paid, covered by credits, waived, cancelled, rescheduled,
                    renewed, preferences disabled, permission removed, or a
                    duplicate exists.
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
                  <button type="button" onClick={() => setEdit(rule)}>
                    Edit{" "}
                    {automationRuleLabels[rule.rule_key as AutomationRuleKey]}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setTesting(rule);
                      setEntityId("");
                      setPreview("");
                    }}
                  >
                    Preview / test rule
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}
      {edit && (
        <Dialog
          title={`Edit ${automationRuleLabels[edit.rule_key as AutomationRuleKey]}`}
          onClose={() => setEdit(undefined)}
        >
          <form
            className="settings-form"
            onSubmit={(event) => void save(event)}
          >
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
                  (edit.escalation as AutomationRule["escalation"]).coach ??
                  false
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
                  (edit.escalation as AutomationRule["escalation"])
                    .hoursBefore ?? 1
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
              Recipients, canonical destination and mandatory suppressions
              cannot be bypassed by template edits. Meet links are not included.
            </p>
            <button disabled={busy} type="submit">
              {busy ? "Saving…" : "Save rule"}
            </button>
          </form>
        </Dialog>
      )}
      {testing && (
        <Dialog
          title={`Preview ${automationRuleLabels[testing.rule_key as AutomationRuleKey]}`}
          onClose={() => setTesting(undefined)}
        >
          <p>
            Preview records an evaluation, never queues or sends. Run queues
            according to the saved mode; it never sends Gmail directly.
          </p>
          <label>
            Evaluate {entityType}
            <select
              value={entityId}
              onChange={(event) => setEntityId(event.target.value)}
            >
              <option value="">Choose…</option>
              {entities.map((entity) => (
                <option value={entity.id} key={entity.id}>
                  {entity.label}
                </option>
              ))}
            </select>
          </label>
          <div className="action-row">
            <button
              type="button"
              disabled={busy || !entityId}
              onClick={() => void testRule(false)}
            >
              Test without queueing
            </button>
            <button
              type="button"
              disabled={busy || !entityId || testing.mode === "off"}
              onClick={() => void testRule(true)}
            >
              Run saved rule
            </button>
          </div>
          <p role="status">{preview}</p>
        </Dialog>
      )}
    </Section>
  );
}
