import type { Lesson } from "../../domain/model";
import { useStudioRoute } from "../../hooks/useStudio";

export const uid = (prefix: string) => `${prefix}-${crypto.randomUUID()}`;
export const now = () => new Date().toISOString();
export const portalInvitationDelivery = (
  data: Data,
  studentId: string,
  recipient: string,
) =>
  data.outbox
    .filter(
      (item) =>
        item.studentId === studentId &&
        item.recipient.toLowerCase() === recipient.toLowerCase() &&
        item.subject.toLowerCase().includes("portal login"),
    )
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
export const belongsToStudent = (
  data: Data,
  lesson: Lesson,
  studentId: string,
) =>
  lesson.studentId === studentId ||
  data.lessonParticipants.some(
    (participant) =>
      participant.lessonId === lesson.id && participant.studentId === studentId,
  );

export type Data = NonNullable<ReturnType<typeof useStudioRoute>["data"]>;
