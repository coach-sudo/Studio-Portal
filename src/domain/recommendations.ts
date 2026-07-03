import type { Recommendation, StudioSnapshot } from "./model";
import { creditBalance, studentBalanceMinor } from "./finance";

const id = (reason: string, entity: string) => `${reason}:${entity}`;
export function buildRecommendations(snapshot: StudioSnapshot, now = new Date()): Recommendation[] {
  const results: Recommendation[] = [];
  for (const lesson of snapshot.lessons) {
    const student = snapshot.students.find((row) => row.id === lesson.studentId);
    if (lesson.status === "completed" && !snapshot.notes.some((note) => note.lessonId === lesson.id && note.status !== "archived")) {
      results.push({ id: id("lesson_note_missing", lesson.id), studioId: snapshot.studioId, studentId: lesson.studentId, entityType: "lesson", entityId: lesson.id, reasonCode: "lesson_note_missing", title: `Write ${student?.fullName ?? "student"}’s lesson note`, explanation: "The lesson is complete and no follow-up note exists.", evidence: [`Completed ${new Date(lesson.startsAt).toLocaleDateString()}`, "No active note"], urgency: 4, dueAt: new Date(new Date(lesson.endsAt).getTime() + 48 * 3600000).toISOString(), suggestedAction: "open_note_editor", requiresConfirmation: false });
    }
  }
  for (const pkg of snapshot.packages) {
    const student = snapshot.students.find((row) => row.id === pkg.studentId);
    const remaining = creditBalance(pkg.id, snapshot.creditEntries);
    if (remaining <= 1) results.push({ id: id("package_low", pkg.id), studioId: snapshot.studioId, studentId: pkg.studentId, entityType: "package", entityId: pkg.id, reasonCode: "package_low", title: `Review ${student?.fullName ?? "student"}’s package`, explanation: `${remaining} session credit${remaining === 1 ? " remains" : "s remain"}.`, evidence: [`${remaining} available credit${remaining === 1 ? "" : "s"}`, pkg.expiresAt ? `Expires ${new Date(pkg.expiresAt).toLocaleDateString()}` : "No expiration"], urgency: remaining <= 0 ? 5 : 4, suggestedAction: "open_finance", requiresConfirmation: true });
  }
  for (const student of snapshot.students) {
    const balance = studentBalanceMinor(student.id, snapshot.payments);
    if (balance > 0) results.push({ id: id("balance_due", student.id), studioId: snapshot.studioId, studentId: student.id, entityType: "student", entityId: student.id, reasonCode: "balance_due", title: `Review ${student.fullName}’s balance`, explanation: "The immutable payment ledger has an outstanding amount.", evidence: [`${balance} minor units outstanding`], urgency: 4, suggestedAction: "open_finance", requiresConfirmation: true });
    if (!student.email && !student.guardianEmail) results.push({ id: id("contact_missing", student.id), studioId: snapshot.studioId, studentId: student.id, entityType: "student", entityId: student.id, reasonCode: "contact_missing", title: `Complete ${student.fullName}’s contact details`, explanation: "Neither a student nor guardian email is available for portal access or messages.", evidence: ["Student email missing", "Guardian email missing"], urgency: 3, suggestedAction: "edit_student", requiresConfirmation: false });
  }
  return results.sort((a, b) => b.urgency - a.urgency || String(a.dueAt ?? "").localeCompare(String(b.dueAt ?? "")));
}
