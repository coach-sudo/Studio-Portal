import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
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
  const client = useQueryClient(),
    previous = useRef<string | null>(null);
  const query = useQuery({
    queryKey: ["portal-contexts", identity, studentId || null, page],
    queryFn: ({ signal }) => loadPortalContexts(studentId, page, signal),
    enabled: enabled && !!identity,
    staleTime: 0,
    gcTime: 60_000,
    retry: false,
    refetchOnMount: "always",
    refetchOnWindowFocus: "always",
    refetchInterval: 15_000,
  });
  const accessFingerprint = JSON.stringify(query.data?.selected || null);
  useEffect(() => {
    if (!query.isSuccess && !query.isError) return;
    // Writing the already-authorized default student into the URL is not an
    // access change. Evicting its newly mounted queries strands their observers.
    const selectedId = query.data?.selected?.id || studentId;
    const next = `${identity}:${selectedId}:${query.isError ? "denied" : accessFingerprint}`;
    if (previous.current && previous.current !== next && studentId) {
      const matches = (q: { queryKey: readonly unknown[] }) =>
        q.queryKey[0] !== "portal-contexts" && q.queryKey.includes(studentId);
      void client
        .cancelQueries({ predicate: matches })
        .then(() => client.resetQueries({ predicate: matches }));
    }
    previous.current = next;
  }, [
    identity,
    studentId,
    accessFingerprint,
    query.isSuccess,
    query.isError,
    query.data?.selected?.id,
    client,
  ]);
  return { ...query, identity };
}
