import { useQuery } from "@tanstack/react-query";
import { studioCommand } from "../../data/bookingCommands";
import { useSearchIdentity } from "../../data/globalSearch";

interface Payers {
  ready: boolean;
  studentIds: string[];
  attempts: {
    id: string;
    studentId: string;
    status: "reserved" | "review";
    createdAt: string;
  }[];
}

export function useTrainingPayers(
  studentId: string,
  studentIds: string[],
  canLoad: boolean,
) {
  const identity = useSearchIdentity();
  return useQuery({
    queryKey: ["training-payment-payers", identity, studentId, studentIds],
    enabled: canLoad && Boolean(identity),
    queryFn: async () =>
      (
        await studioCommand(
          "invoices",
          {
            command: "training_payers",
            expectedVersion: 0,
            payload: { studentIds },
            reason: "Determine permitted lesson payments",
          },
          identity ?? undefined,
        )
      ).resource as Payers,
  });
}
