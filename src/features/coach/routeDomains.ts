import type { StudioDomain } from "../../data/repository";
import { queryLayerV2Enabled } from "../../hooks/useStudio";
import type { Tab } from "./BookingCenter.shared";

export function coachSectionDomains(
  section: string,
  v2 = queryLayerV2Enabled,
): readonly StudioDomain[] {
  switch (section) {
    case "students":
      return v2
        ? ["identity"]
        : ["identity", "students", "lessons", "work", "households"];
    case "notes":
    case "materials":
      return v2
        ? ["identity", "students", "lessons"]
        : ["identity", "students", "work"];
    case "lessons":
      return [
        "identity",
        "students",
        "lessons",
        "booking",
        "work",
        "finance",
        "messaging",
      ];
    case "finance":
      return ["identity", "students", "finance", "booking", "lessons"];
    case "actor-pages":
      return ["identity", "students", "actorProfiles", "work"];
    case "settings":
      return ["identity", "students", "lessons", "work", "messaging"];
    default:
      return [
        "identity",
        "students",
        "lessons",
        "booking",
        "work",
        "administration",
        "actorProfiles",
        "finance",
        "messaging",
      ];
  }
}

export function bookingCenterDomains(tab: Tab): readonly StudioDomain[] {
  const shared: readonly StudioDomain[] = [
    "identity",
    "students",
    "booking",
    "lessons",
  ];
  return tab === "calendar"
    ? [...shared, "work", "finance", "messaging"]
    : shared;
}

export function studentWorkspaceDomains(
  pathname: string,
): readonly StudioDomain[] {
  const shared: readonly StudioDomain[] = [
    "identity",
    "students",
    "lessons",
    "work",
    "finance",
    "households",
  ];
  if (/^\/coach\/students\/[^/]+\/actor-page\/?$/.test(pathname))
    return [...shared, "actorProfiles"];
  if (
    /^\/coach\/students\/[^/]+\/(?:account|payments|contacts\/[^/]+)\/?$/.test(
      pathname,
    )
  )
    return [...shared, "booking", "messaging"];
  if (/^\/coach\/students\/[^/]+\/lessons(?:\/[^/]+)?\/?$/.test(pathname))
    return [...shared, "messaging"];
  return shared;
}
