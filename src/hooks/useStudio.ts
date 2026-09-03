import { useQuery } from "@tanstack/react-query";
import type { Role } from "../domain/model";
import { loadStudioSnapshot } from "../data/repository";
import { isDemoMode, isSupabaseConfigured } from "../lib/supabase";
import { scopeStudioSnapshot, useStudioStore } from "../state/StudioStore";

export const useStudio = (role: Role = "coach", studentId?: string) => {
  const store = useStudioStore();
  const query = useQuery({
    queryKey: ["studio", role, studentId],
    queryFn: () => loadStudioSnapshot(role, studentId),
    enabled: isSupabaseConfigured,
    staleTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: "always",
    refetchOnReconnect: "always",
    refetchInterval: isSupabaseConfigured ? (role === "coach" ? 10_000 : 15_000) : false,
    refetchIntervalInBackground: false,
  });
  if (!isSupabaseConfigured && isDemoMode) return { ...query, data: scopeStudioSnapshot(store.snapshot, role, studentId), isLoading: false, isDemo: true };
  if (!isSupabaseConfigured) return { ...query, data: undefined, isLoading: false, isDemo: false, error: new Error("Production database configuration is unavailable.") };
  return { ...query, isDemo: false };
};
