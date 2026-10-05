import type { SupabaseClient } from "@supabase/supabase-js";
import type { TablesInsert } from "../../../src/types/database.generated";
import {
  compatibleQueueStatus,
  compatibleRule,
  queuePresentedMessages,
} from "./outbox-queue";
import { resolveEventRecipients } from "./notification-recipients";
import { portalOrigin, portalActionUrl } from "./portal-url";
import { loadOperationalData } from "./operational-data";
import { mapAutomationRule } from "./automation-config";
import { evaluateAutomationRule } from "../../../src/domain/automationRules";
import { packageWarningKey } from "../../../src/domain/packageWarningKey";
import { creditBalance } from "../../../src/domain/finance";

export async function queuePackageWarning(
  client: SupabaseClient,
  input: {
    studioId: string;
    studentId: string;
    packageId: string;
    key: "package_low" | "package_expiration";
    subject: string;
    body: string;
    dedupe: string;
    studio: {
      name: string;
      settings: { coachName?: string; branding?: { logoUrl?: string } };
    };
    legacyEnabled: boolean;
  },
) {
  const rule = await compatibleRule(client, input.studioId, input.key),
    status = compatibleQueueStatus(rule, input.legacyEnabled);
  if (!status) return [];
  let dedupe = input.dedupe;
  const templateVariables: Record<string, string> = {};
  if (rule) {
    const data = await loadOperationalData(
      client,
      input.studioId,
      input.studentId,
    );
    const decision = evaluateAutomationRule(
      mapAutomationRule(rule),
      {
        package: data.packages.find((pkg) => pkg.id === input.packageId),
      },
      data,
      Date.now(),
    );
    if (!decision.eligible) return [];
    const pkg = data.packages.find((item) => item.id === input.packageId)!;
    dedupe = packageWarningKey(pkg, data.creditEntries, input.key, Date.now());
    Object.assign(templateVariables, {
      studentName: data.students[0].preferredName || data.students[0].fullName,
      packageName: pkg.name,
      credits: String(creditBalance(pkg.id, data.creditEntries)),
      days: pkg.expiresAt
        ? String(
            Math.max(
              1,
              Math.ceil((Date.parse(pkg.expiresAt) - Date.now()) / 86400000),
            ),
          )
        : "",
      expiresAt: pkg.expiresAt
        ? new Intl.DateTimeFormat("en-US", {
            timeZone: data.settings.timezone,
            dateStyle: "medium",
          }).format(new Date(pkg.expiresAt))
        : "",
    });
  }
  const resolution = await resolveEventRecipients(
      client,
      input.studentId,
      input.key,
    ),
    origin = portalOrigin();
  const messages: TablesInsert<"outbox_messages">[] = resolution.recipients.map(
    (recipient) => ({
      studio_id: input.studioId,
      student_id: input.studentId,
      recipient: recipient.email,
      channel: "email",
      subject: input.subject,
      body: input.body,
      status,
      send_at: new Date().toISOString(),
      event_key: `package.${input.key}.student`,
      dedupe_key: `${dedupe}:${recipient.email}`,
      priority: 65,
      automation_rule_id: rule?.id,
      recipient_intent: input.key,
      entity_snapshot: { entityId: input.packageId, coverageKey: dedupe },
    }),
  );
  return queuePresentedMessages(
    client,
    messages,
    input.studio,
    origin,
    {
      label: "View packages",
      url: portalActionUrl(origin, "packages"),
    },
    templateVariables,
  );
}
