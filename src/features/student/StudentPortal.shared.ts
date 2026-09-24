import type { StudioDomain } from "../../data/repository";
import type { StudioSnapshot } from "../../domain/model";
import { queryLayerV2Enabled } from "../../hooks/useStudio";

export function portalDomains(pathname: string): readonly StudioDomain[] {
  const route = pathname.replace(/\/+$/, "") || "/";
  if (route === "/portal/inbox") return ["identity", "students", "messaging"];
  if (route === "/portal/payments")
    return ["identity", "students", "finance", "lessons"];
  if (route === "/portal/settings")
    return ["identity", "students", "households"];
  if (route === "/portal/actor-page")
    return ["identity", "students", "actorProfiles", "work"];
  if (route === "/portal/referrals")
    return ["identity", "students", "referrals"];
  if (route === "/portal/notes")
    return queryLayerV2Enabled
      ? ["identity", "students", "lessons"]
      : ["identity", "students", "work"];
  if (route === "/portal/work")
    return ["identity", "students", "work", "lessons"];
  if (route === "/portal/bookings")
    return ["identity", "students", "lessons", "booking"];
  if (/^\/portal\/lessons\/[^/]+$/.test(route))
    return ["identity", "students", "lessons", "booking", "work"];
  if (/^\/portal\/classes\/[^/]+$/.test(route))
    return ["identity", "students", "lessons", "work", "messaging"];
  return route === "/portal"
    ? ["identity", "students", "lessons", "work", "finance"]
    : ["identity", "students"];
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
