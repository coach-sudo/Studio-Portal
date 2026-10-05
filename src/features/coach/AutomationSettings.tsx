import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Dialog, Section } from "../../components/Primitives";
import { studioCommand } from "../../data/bookingCommands";
import {
  automationRuleLabels,
  type AutomationRuleKey,
  type AutomationRule,
} from "../../domain/automationRules";
import type { StudioSnapshot } from "../../domain/model";
import type { Tables } from "../../types/database.generated";
import { supabase } from "../../lib/supabase";
import { invalidateStudioDomains } from "../../hooks/useStudio";
import { demoRules } from "./automation/demoRules";
import { AutomationRuleCard } from "./automation/AutomationRuleCard";
import { AutomationRuleEditor } from "./automation/AutomationRuleEditor";
import "./operational-intelligence.css";

type Rule = Tables<"automation_rules">;
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
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: [
            "studio-page",
            "administration",
            "automation-rules",
            data.studioId,
          ],
        }),
        invalidateStudioDomains(queryClient, ["messaging"]),
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
  const packageChoices = useQuery({
    queryKey: [
      "studio-page",
      "finance",
      "automation-package-choices",
      data.studioId,
    ],
    enabled:
      !isDemo &&
      Boolean(supabase) &&
      entityType === "package" &&
      Boolean(testing),
    staleTime: 30000,
    queryFn: async ({ signal }) => {
      const result = await supabase!
        .from("packages")
        .select("id,student_id,name,students!inner(studio_id)")
        .eq("students.studio_id", data.studioId)
        .order("name")
        .limit(100)
        .abortSignal(signal);
      if (result.error) throw result.error;
      return result.data.map((item) => ({
        id: item.id,
        studentId: item.student_id,
        label: item.name,
      }));
    },
  });
  const entities =
    entityType === "package"
      ? isDemo
        ? data.packages.map((item) => ({
            id: item.id,
            studentId: item.studentId,
            label: item.name,
          }))
        : (packageChoices.data ?? [])
      : entityType === "outbox"
        ? data.outbox
            .filter((item) => item.status === "failed")
            .map((item) => ({
              id: item.id,
              studentId: item.studentId,
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
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: [
            "studio-page",
            "administration",
            "automation-runs",
            data.studioId,
          ],
        }),
        invalidateStudioDomains(queryClient, ["messaging"]),
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
          {(isDemo ? local : (rules.data ?? [])).map((rule) => (
            <AutomationRuleCard
              key={rule.id}
              rule={rule}
              last={runs.data?.find((run) => run.rule_id === rule.id)}
              onEdit={() => {
                setNotice("");
                setEdit(rule);
              }}
              onPreview={() => {
                setTesting(rule);
                setEntityId("");
                setPreview("");
              }}
            />
          ))}
        </div>
      )}
      {edit && (
        <AutomationRuleEditor
          edit={edit}
          busy={busy}
          notice={notice}
          onClose={() => setEdit(undefined)}
          onSave={(event) => void save(event)}
        />
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
