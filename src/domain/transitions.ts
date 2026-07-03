import type { ActorProfileStatus, AssignmentStatus, LessonStatus, MaterialStatus, NoteStatus, ReaderRequestStatus, StudentStatus } from "./model";

const transitions = {
  student: { lead: ["active", "inactive"], active: ["paused", "alumni", "inactive"], paused: ["active", "alumni", "inactive"], alumni: ["active"], inactive: ["lead", "active"] },
  lesson: { draft: ["scheduled", "cancelled"], scheduled: ["completed", "cancelled", "late_cancelled", "no_show"], completed: [], cancelled: ["scheduled"], late_cancelled: ["scheduled"], no_show: ["scheduled"] },
  note: { draft: ["published", "archived"], published: ["draft", "archived"], archived: ["draft"] },
  assignment: { assigned: ["in_progress", "completed"], in_progress: ["completed", "reopened"], completed: ["reopened"], reopened: ["in_progress", "completed"] },
  material: { active: ["vaulted", "archived"], vaulted: ["active", "archived"], archived: [] },
  actorProfile: { draft: ["review_requested", "archived"], review_requested: ["changes_requested", "approved", "draft"], changes_requested: ["review_requested", "draft"], approved: ["published", "draft"], published: ["draft", "archived"], archived: ["draft"] },
  readerRequest: { submitted: ["coach_review", "cancelled"], coach_review: ["approved", "cancelled"], approved: ["queued", "cancelled"], queued: ["sent", "cancelled"], sent: ["fulfilled", "cancelled"], fulfilled: [], cancelled: [] },
} as const;

type StateByMachine = { student: StudentStatus; lesson: LessonStatus; note: NoteStatus; assignment: AssignmentStatus; material: MaterialStatus; actorProfile: ActorProfileStatus; readerRequest: ReaderRequestStatus };

export function canTransition<K extends keyof StateByMachine>(machine: K, from: StateByMachine[K], to: StateByMachine[K]) {
  const machineTransitions = transitions[machine] as Record<string, readonly string[]>;
  return machineTransitions[from]?.includes(to) ?? false;
}

export function assertTransition<K extends keyof StateByMachine>(machine: K, from: StateByMachine[K], to: StateByMachine[K]) {
  if (!canTransition(machine, from, to)) throw new Error(`Invalid ${machine} transition: ${from} → ${to}`);
}
