import type { StudioSnapshot } from "../domain/model";
import { buildRecommendations } from "../domain/recommendations";

const now = new Date();
const at = (days: number, hour: number) => { const date = new Date(now); date.setDate(date.getDate() + days); date.setHours(hour, 0, 0, 0); return date.toISOString(); };

const base: StudioSnapshot = {
  studioId: "studio-stage-story",
  role: "coach",
  displayName: "Darius",
  students: [
    { id: "student-liam", version: 3, updatedAt: at(-1, 12), studioId: "studio-stage-story", fullName: "Liam Foster", email: "liam@example.com", status: "active", focusArea: "Scene study", isMinor: false, portalEnabled: true, actorPageEligible: true },
    { id: "student-maya", version: 5, updatedAt: at(-1, 10), studioId: "studio-stage-story", fullName: "Maya Kim", email: "maya@example.com", status: "active", focusArea: "Audition prep", isMinor: false, portalEnabled: true, actorPageEligible: true },
    { id: "student-sarah", version: 1, updatedAt: at(-2, 15), studioId: "studio-stage-story", fullName: "Sarah Patterson", status: "lead", isMinor: true, guardianName: "Dana Patterson", guardianEmail: "dana@example.com", portalEnabled: false, actorPageEligible: false },
  ],
  lessons: [
    { id: "lesson-liam-next", version: 2, updatedAt: at(-1, 9), studioId: "studio-stage-story", studentId: "student-liam", topic: "Scene Study", startsAt: at(0, 10), endsAt: at(0, 11), status: "scheduled", locationType: "in_person", locationLabel: "Studio A", packageId: "package-liam" },
    { id: "lesson-maya-last", version: 4, updatedAt: at(-1, 13), studioId: "studio-stage-story", studentId: "student-maya", topic: "The Seagull — Nina", startsAt: at(-1, 14), endsAt: at(-1, 15), status: "completed", locationType: "virtual", locationLabel: "Online", joinUrl: "https://example.com/studio" },
    { id: "lesson-maya-next", version: 1, updatedAt: at(-1, 9), studioId: "studio-stage-story", studentId: "student-maya", topic: "Scene Study", startsAt: at(2, 10), endsAt: at(2, 11), status: "scheduled", locationType: "in_person", locationLabel: "Studio A" },
  ],
  notes: [],
  assignments: [{ id: "assignment-maya", version: 1, updatedAt: at(-1, 16), lessonId: "lesson-maya-last", studentId: "student-maya", title: "Monologue work", details: "Record and upload your two takes.", dueAt: at(3, 18), status: "assigned", helpRequested: false }],
  materials: [{ id: "material-seagull", version: 2, updatedAt: at(-2, 11), studentId: "student-maya", title: "The Seagull — Nina", category: "Script", role: "current_script", status: "active", approvalStatus: "not_public", externalUrl: "https://example.com/script" }, { id: "material-questions", version: 1, updatedAt: at(-3, 11), studentId: "student-maya", title: "Character exploration questions", category: "Worksheet", role: "library", status: "active", approvalStatus: "not_public" }],
  packages: [{ id: "package-liam", version: 2, updatedAt: at(-4, 10), studentId: "student-liam", name: "10-Session Bundle", priceMinor: 50000, currency: "USD", expiresAt: at(12, 23) }, { id: "package-maya", version: 1, updatedAt: at(-5, 10), studentId: "student-maya", name: "Silver Package", priceMinor: 35000, currency: "USD" }],
  creditEntries: [{ id: "credit-liam-buy", packageId: "package-liam", kind: "purchase", quantity: 10, reason: "Initial purchase", createdAt: at(-30, 9) }, { id: "credit-liam-used", packageId: "package-liam", kind: "consumption", quantity: -9, reason: "Completed lessons", createdAt: at(-3, 9) }, { id: "credit-maya-buy", packageId: "package-maya", kind: "purchase", quantity: 5, reason: "Initial purchase", createdAt: at(-20, 9) }, { id: "credit-maya-used", packageId: "package-maya", kind: "consumption", quantity: -3, reason: "Completed lessons", createdAt: at(-1, 15) }],
  payments: [{ id: "payment-liam-due", studentId: "student-liam", packageId: "package-liam", kind: "adjustment", amountMinor: 5000, currency: "USD", reason: "Outstanding package balance", createdAt: at(-30, 9) }],
  actorProfiles: [{ id: "actor-maya", version: 2, updatedAt: at(-3, 12), studentId: "student-maya", slug: "maya-kim", displayName: "Maya Kim", bio: "Actor and storyteller.", status: "draft" }],
  readerRequests: [], outbox: [], recommendations: [],
};
base.recommendations = buildRecommendations(base, now);
export const demoSnapshot = base;
