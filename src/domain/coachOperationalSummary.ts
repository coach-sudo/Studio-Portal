import type { ReadinessData } from "./lessonReadiness";
import { evaluateLessonReadiness } from "./lessonReadiness";
import { bookingForLesson } from "./packageForecast";
import { studioDateKey } from "./presentation";

export function coachOperationalSummary(data: ReadinessData, now: number) {
  const today = data.lessons.filter(
    (lesson) =>
      lesson.status === "scheduled" &&
      studioDateKey(lesson.startsAt, data.settings.timezone) ===
        studioDateKey(new Date(now), data.settings.timezone),
  );
  const states = today.map((lesson) =>
    evaluateLessonReadiness(lesson, data, now),
  );
  const seen = new Set<string>();
  let moneyAtRisk = 0;
  today.forEach((lesson, index) => {
    const key = bookingForLesson(lesson, data)?.id ?? lesson.id;
    if (!seen.has(key)) {
      moneyAtRisk += states[index].financial.amountDueMinor;
      seen.add(key);
    }
  });
  return {
    readyCount: states.filter((item) => item.state === "ready").length,
    needsAttention: states.filter((item) => item.state !== "ready").length,
    financialAttention: states.filter(
      (item) =>
        !["covered_paid", "covered_package", "covered_waived"].includes(
          item.financial.state,
        ),
    ).length,
    moneyAtRisk,
    upcomingCommunication: data.outbox.filter(
      (message) =>
        message.status === "queued" &&
        message.sendAt &&
        Date.parse(message.sendAt) >= now,
    ).length,
  };
}
