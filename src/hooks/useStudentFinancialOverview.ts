import { useQuery } from "@tanstack/react-query";
import { loadFinancialOverview } from "../data/studentWorkspace";
import { usePrivateIdentity } from "./usePrivateIdentity";

export function useStudentFinancialOverview(studentId: string, enabled = true) {
  const identity = usePrivateIdentity();
  return useQuery({
    queryKey: ["student-financial-summary", identity, studentId],
    enabled: enabled && !!identity,
    queryFn: ({ signal }) => loadFinancialOverview(studentId, signal),
    refetchInterval: 30000,
  });
}
