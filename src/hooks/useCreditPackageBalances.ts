import { useQuery } from "@tanstack/react-query";
import { loadCreditCoverage } from "../data/creditCoverage";
import { usePrivateIdentity } from "./usePrivateIdentity";

export function useCreditPackageBalances(
  studentId: string | undefined,
  enabled: boolean,
) {
  const identity = usePrivateIdentity();
  return useQuery({
    queryKey: ["credit-coverage", identity, studentId, 1],
    enabled: enabled && !!identity && !!studentId,
    queryFn: ({ signal }) =>
      loadCreditCoverage(
        { studentId: studentId!, page: 1, pageSize: 5 },
        signal,
      ),
    select: (view) => view.packages,
  });
}
