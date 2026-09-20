import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { Role } from "../domain/model";
import {
  loadStudioSnapshot,
  studioDomains,
  type StudioDomain,
} from "../data/repository";
import { isDemoMode, isSupabaseConfigured } from "../lib/supabase";
import { scopeStudioSnapshot, useStudioStore } from "../state/StudioStore";

export const queryLayerV2Enabled =
  import.meta.env.VITE_QUERY_LAYER_V2 === "true";

export const studioQueryKey = (
  role: Role,
  studentId: string | undefined,
  domains: readonly StudioDomain[],
) => ["studio", role, studentId ?? null, [...domains].sort()] as const;

export const useStudio = (
  role: Role = "coach",
  studentId?: string,
  requestedDomains: readonly StudioDomain[] = studioDomains,
) => {
  const store = useStudioStore();
  const domains = queryLayerV2Enabled ? requestedDomains : studioDomains;
  const query = useQuery({
    queryKey: studioQueryKey(role, studentId, domains),
    queryFn: ({ signal }) =>
      loadStudioSnapshot(role, studentId, domains, signal),
    enabled: isSupabaseConfigured,
    staleTime: queryLayerV2Enabled ? 5 * 60_000 : 0,
    gcTime: queryLayerV2Enabled ? 30 * 60_000 : 5 * 60_000,
    placeholderData: queryLayerV2Enabled ? keepPreviousData : undefined,
    refetchOnMount: queryLayerV2Enabled ? true : "always",
    refetchOnWindowFocus: queryLayerV2Enabled ? true : "always",
    refetchOnReconnect: queryLayerV2Enabled ? true : "always",
    refetchInterval: queryLayerV2Enabled
      ? false
      : isSupabaseConfigured
        ? role === "coach"
          ? 10_000
          : 15_000
        : false,
    refetchIntervalInBackground: false,
  });
  if (!isSupabaseConfigured && isDemoMode)
    return {
      ...query,
      data: scopeStudioSnapshot(store.snapshot, role, studentId),
      isLoading: false,
      isDemo: true,
    };
  if (!isSupabaseConfigured)
    return {
      ...query,
      data: undefined,
      isLoading: false,
      isDemo: false,
      error: new Error("Production database configuration is unavailable."),
    };
  return { ...query, isDemo: false };
};
