import { useQuery } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { supabase } from "../lib/supabase";
import { useSearchIdentity } from "./globalSearch";

export const portalContextSchema = z.object({
  id: z.string().uuid(),
  fullName: z.string(),
  preferredName: z.string().nullish(),
  isMinor: z.boolean(),
  canViewSchedule: z.boolean(),
  canViewWork: z.boolean(),
  canViewFinance: z.boolean(),
  canManageProfile: z.boolean(),
  canManageLessons: z.boolean(),
});
export type PortalContext = z.infer<typeof portalContextSchema>;
export async function loadPortalContexts(
  studentId?: string,
  page = 1,
  signal?: AbortSignal,
) {
  if (!supabase) throw new Error("Portal unavailable.");
  if (studentId) z.string().uuid().parse(studentId);
  const q = (supabase as SupabaseClient).rpc("portal_student_contexts", {
    p_student: studentId || null,
    p_page: page,
  });
  const r = await (signal ? q.abortSignal(signal) : q);
  if (r.error) throw new Error("Portal unavailable.");
  return z
    .object({
      items: z.array(portalContextSchema).max(50),
      selected: portalContextSchema.nullable(),
      hasMore: z.boolean(),
    })
    .parse(r.data);
}
export function usePortalContexts(
  studentId: string | undefined,
  page: number,
  enabled: boolean,
) {
  const identity = useSearchIdentity();
  const query = useQuery({
    queryKey: ["portal-contexts", identity, studentId || null, page],
    queryFn: ({ signal }) => loadPortalContexts(studentId, page, signal),
    enabled: enabled && !!identity,
    staleTime: 0,
    gcTime: 60_000,
    retry: false,
    refetchOnMount: "always",
  });
  return { ...query, identity };
}
