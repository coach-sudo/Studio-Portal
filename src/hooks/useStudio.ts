import { useQuery } from "@tanstack/react-query";
import type { Role } from "../domain/model";
import { loadStudioSnapshot } from "../data/repository";
import { isDemoMode, isSupabaseConfigured } from "../lib/supabase";
import { scopeStudioSnapshot, useStudioStore } from "../state/StudioStore";

export const useStudio = (role: Role = "coach", studentId?: string) => {
  const store = useStudioStore();
  const query = useQuery({ queryKey: ["studio", role, studentId], queryFn: () => loadStudioSnapshot(role, studentId), enabled: isSupabaseConfigured });
  if (!isSupabaseConfigured && isDemoMode) return { ...query, data: scopeStudioSnapshot(store.snapshot, role, studentId), isLoading: false, isDemo: true };
  if (!isSupabaseConfigured) return { ...query, data: undefined, isLoading: false, isDemo: false, error: new Error("Production database configuration is unavailable.") };
  return { ...query, isDemo: false };
};
