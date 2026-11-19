import { useQuery } from "@tanstack/react-query";
import { studioCommand } from "../../data/bookingCommands";
import { useSearchIdentity } from "../../data/globalSearch";
import type { AutopayPreviewOptions } from "../../domain/lessonAutopay";
import type { StudioSnapshot } from "../../domain/model";
import { studioDateKey } from "../../domain/presentation";
import {
  trainingArrangement,
  trainingObligations,
} from "../../domain/trainingArrangement";

export function useLessonAutopayOptions(
  data: StudioSnapshot,
  studentId: string,
  isDemo: boolean,
  enabled = true,
) {
  const actor = useSearchIdentity();
  const query = useQuery({
    queryKey: ["lesson-autopay-options", actor, studentId],
    enabled: enabled && !isDemo && Boolean(actor && studentId),
    retry: false,
    staleTime: 30_000,
    queryFn: async (): Promise<AutopayPreviewOptions | null> =>
      (
        await studioCommand(
          "invoices",
          {
            command: "training_autopay_options",
            expectedVersion: 0,
            payload: { studentId },
            reason: "Check available lesson payment timing",
          },
          actor ?? undefined,
        )
      ).resource,
  });
  if (!enabled || !studentId) return undefined;
  if (!isDemo) return query.data ?? undefined;

  const arrangement = trainingArrangement(data, studentId);
  const upcoming = new Map(
    arrangement.upcoming.map(({ lesson }) => [lesson.id, lesson.startsAt]),
  );
  const lessons = trainingObligations(
    data.invoices ?? [],
    studentId,
    arrangement,
  )
    .filter(({ eligible, lessonId }) => eligible && upcoming.has(lessonId))
    .map(({ lessonId, amountMinor }) => ({
      id: lessonId,
      date: studioDateKey(upcoming.get(lessonId)!, data.settings.timezone),
      amountMinor,
    }));
  if (lessons.length === 0) return undefined;
  return {
    currency: data.settings.currency,
    policy: {
      timeZone: data.settings.timezone,
      chargeAtLocal: "09:00",
      minimumLeadDays: 0,
      maximumLeadDays: 7,
      maximumLessonMinor: Math.max(
        ...lessons.map(({ amountMinor }) => amountMinor),
      ),
    },
    lessons,
    hasMore: false,
  } satisfies AutopayPreviewOptions;
}
