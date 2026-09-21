import type { StudioDomain } from "../../data/repository";
import type { StudioSnapshot } from "../../domain/model";
import { queryLayerV2Enabled } from "../../hooks/useStudio";

export function portalDomains(pathname: string): readonly StudioDomain[] {
  if (pathname.includes("/inbox")) return ["identity", "students", "messaging"];
  if (pathname.includes("/payments"))
    return ["identity", "students", "finance"];
  if (pathname.includes("/settings"))
    return ["identity", "students", "households"];
  if (pathname.includes("/actor"))
    return ["identity", "students", "actorProfiles", "work"];
  if (pathname.includes("/referrals"))
    return ["identity", "students", "referrals"];
  if (pathname.includes("/notes"))
    return queryLayerV2Enabled
      ? ["identity", "students", "lessons"]
      : ["identity", "students", "work"];
  if (pathname.includes("/work")) return ["identity", "students", "work"];
  if (pathname.includes("/schedule") || pathname.includes("/lesson"))
    return ["identity", "students", "lessons", "booking", "work"];
  if (pathname.includes("/classes/"))
    return ["identity", "students", "lessons", "work", "messaging"];
  return ["identity", "students", "lessons", "work"];
}

export const portalNotificationLabels = {
  lessonReminders: "Lesson reminders",
  scheduleChanges: "Reschedules and cancellations",
  lessonContent: "Notes and lesson materials",
  assignments: "Assignments and practice",
  packageBalance: "Package balance and expiration",
  payments: "Payments and receipts",
  accountAccess: "Account access",
} as const;

export type Snapshot = StudioSnapshot;
export type ActorPortfolioDraft = NonNullable<
  Snapshot["actorProfiles"][number]["draftContent"]
>;
