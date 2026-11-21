import { useQuery } from "@tanstack/react-query";
import { studioCommand } from "../../data/bookingCommands";
import { useSearchIdentity } from "../../data/globalSearch";

export type DirectLessonOption = {
  lessonId: string;
  studentId: string;
  studentName: string;
  description: string;
  date: string;
  terms: string;
  currency: string;
  remainingMinor: number;
  paidMinor: number;
};

export function useDirectLessonOptions(
  studentId: string,
  studentIds: readonly string[],
  enabled: boolean,
  lessonId?: string,
  upcomingOnly?: boolean,
) {
  const identity = useSearchIdentity();
  const scope = [...new Set([studentId, ...studentIds])].sort().slice(0, 50);
  return useQuery({
    queryKey: [
      "training-direct-options",
      identity,
      studentId,
      scope,
      lessonId,
      upcomingOnly,
    ],
    enabled: enabled && !!identity && !!studentId,
    retry: false,
    queryFn: async () => {
      const { resource } = await studioCommand(
        "invoices",
        {
          command: "training_direct_options",
          expectedVersion: 0,
          payload: { studentId, studentIds: scope, lessonId, upcomingOnly },
          reason: "Review verified lesson balances",
        },
        identity ?? undefined,
      );
      return resource as {
        enabled: boolean;
        items: DirectLessonOption[];
        hasMore?: boolean;
      };
    },
  });
}
