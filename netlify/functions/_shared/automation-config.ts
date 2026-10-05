import { z } from "zod";
import {
  automationRuleKeys,
  type AutomationRule,
} from "../../../src/domain/automationRules";
import type { Tables } from "../../../src/types/database.generated";

export const automationConfigSchema = z
  .object({
    enabled: z.boolean(),
    mode: z.enum(["off", "draft", "automatic", "automatic_with_escalation"]),
    timing: z
      .object({
        hoursBefore: z.array(z.number().positive().max(8760)).max(6).optional(),
        daysBefore: z.number().int().positive().max(365).optional(),
        lowThreshold: z.number().int().min(0).max(100).optional(),
      })
      .strict(),
    escalation: z
      .object({
        hoursBefore: z.number().positive().max(8760).optional(),
        coach: z.boolean().optional(),
      })
      .strict(),
    template: z
      .object({
        subject: z.string().trim().max(200).optional(),
        body: z.string().trim().max(6000).optional(),
        ctaLabel: z.string().trim().max(60).optional(),
      })
      .strict(),
  })
  .strict();
export function mapAutomationRule(
  row: Tables<"automation_rules">,
): AutomationRule {
  const config = automationConfigSchema.parse({
    enabled: row.enabled,
    mode: row.mode,
    timing: row.timing,
    escalation: row.escalation,
    template: row.template,
  });
  return {
    ...config,
    id: row.id,
    studioId: row.studio_id,
    key: z.enum(automationRuleKeys).parse(row.rule_key),
    trigger: row.trigger,
    audience: row.audience as AutomationRule["audience"],
    conditions: z
      .object({ scheduledOnly: z.boolean().optional() })
      .strict()
      .parse(row.conditions),
    suppressions: z.array(z.string()).parse(row.suppressions),
    priority: row.priority,
    version: row.version,
    updatedAt: row.updated_at,
  };
}
