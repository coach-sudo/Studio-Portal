import { useQuery } from "@tanstack/react-query";
import type { RepairResult, StudioHealth } from "../domain/systemHealth";
import { supabase } from "../lib/supabase";
import { readApiClientError } from "./apiClientError";

export const studioHealthKey = (studio: string) =>
  ["coach-system-health", studio] as const;

async function requestHealth<T>(
  studio: string,
  action: string,
  options?: { issue?: string; body?: object; signal?: AbortSignal },
): Promise<T> {
  const session = await supabase?.auth.getSession();
  const token = session?.data.session?.access_token;
  if (!token) throw new Error("Sign in as a coach to open System Health.");
  const params = new URLSearchParams({ studio });
  if (options?.issue) params.set("issue", options.issue);
  const response = await fetch(
    "/api/v2/studio-health/" + action + "?" + params,
    {
      method: action === "status" ? "GET" : "POST",
      headers: {
        Authorization: "Bearer " + token,
        ...(options?.body ? { "Content-Type": "application/json" } : {}),
      },
      body: options?.body ? JSON.stringify(options.body) : undefined,
      signal: options?.signal,
      cache: "no-store",
    },
  );
  if (!response.ok)
    throw await readApiClientError(response, "System Health is unavailable.");
  return response.json() as Promise<T>;
}

export function useSystemHealth(
  studio: string,
  enabled: boolean,
  issue?: string,
) {
  return useQuery({
    queryKey: [...studioHealthKey(studio), issue ?? "status"],
    queryFn: ({ signal }) =>
      requestHealth<StudioHealth>(studio, "status", { signal, issue }),
    enabled,
    retry: false,
    staleTime: 20_000,
    refetchInterval: ({ state }) => (state.data?.checking ? 3_000 : 60_000),
  });
}

export function checkSystemHealth(studio: string) {
  return requestHealth<{
    state: "completed" | "recent_or_running";
    health: StudioHealth;
  }>(studio, "check", {
    signal: AbortSignal.timeout(12_000),
  });
}

export function retryHealthIssue(
  studio: string,
  issue: string,
  service: "calendar" | "email",
) {
  return requestHealth<{ result: RepairResult; correlationId: string }>(
    studio,
    "retry",
    {
      body: { issue, service },
      signal: AbortSignal.timeout(8_000),
    },
  );
}
