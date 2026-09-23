import { Video } from "lucide-react";
import type { Lesson } from "../domain/model";
import {
  lessonDateLabel,
  selectLessonDelivery,
} from "../domain/lessonExperience";

export function JoinLessonBanner({
  lessons,
  label,
}: {
  lessons: Lesson[];
  label?: (lesson: Lesson) => string;
}) {
  const lesson = lessons.find(
    (item) => selectLessonDelivery(item).state === "available",
  );
  if (!lesson?.joinUrl) return null;
  const delivery = selectLessonDelivery(lesson);
  return (
    <aside className="join-lesson-banner" aria-label="Lesson ready to join">
      <Video />
      <span>
        <strong>{label?.(lesson) || lesson.topic}</strong>
        <small>
          {lessonDateLabel(lesson)} · available from 30 minutes before through
          30 minutes after
        </small>
      </span>
      <a href={lesson.joinUrl} target="_blank" rel="noreferrer">
        {delivery.actionLabel}
      </a>
    </aside>
  );
}
