import type { Lesson } from "./model";

export interface SchedulingConflict {
  id: string;
  summary: string;
  start: string;
  end: string;
  source?: "google" | "studio";
  policy?: "private_overlap" | "studio_advisory" | "google_busy";
  blocksChange?: boolean;
}

type OverlapLesson = { status: string; offeringId?: string | null };
// Match lessons_private_overlap exactly. Other command/financial constraints
// still apply at execution; an advisory is not permission to bypass them.
export function studioOverlapPolicy(
  target: OverlapLesson | undefined,
  other: OverlapLesson,
): "private_overlap" | "studio_advisory" {
  return (target?.status ?? "scheduled") === "scheduled" &&
    !target?.offeringId &&
    other.status === "scheduled" &&
    !other.offeringId
    ? "private_overlap"
    : "studio_advisory";
}

export function conflictDisposition(item: SchedulingConflict) {
  if (
    item.source === "studio" &&
    item.policy === "private_overlap" &&
    item.blocksChange === true
  )
    return "blocked";
  if (
    item.source === "studio" &&
    item.policy === "studio_advisory" &&
    item.blocksChange === false
  )
    return "advisory";
  if (
    item.source === "google" &&
    item.policy === "google_busy" &&
    item.blocksChange === false
  )
    return "google_override";
  return "unclassified";
}

export function localSchedulingConflicts(
  lessons: Lesson[],
  target: Lesson | undefined,
  startsAt: string,
  endsAt: string,
): SchedulingConflict[] {
  return lessons
    .filter(
      (item) =>
        item.id !== target?.id &&
        ["draft", "scheduled"].includes(item.status) &&
        Date.parse(item.startsAt) < Date.parse(endsAt) &&
        Date.parse(item.endsAt) > Date.parse(startsAt),
    )
    .map((item) => {
      const policy = studioOverlapPolicy(target, item);
      return {
        id: item.id,
        summary: item.topic,
        start: item.startsAt,
        end: item.endsAt,
        source: "studio",
        policy,
        blocksChange: policy === "private_overlap",
      };
    });
}
