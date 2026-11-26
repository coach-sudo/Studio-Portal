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

export type CalendarConflictReview =
  | {
      state: "comparison";
      historical: boolean;
      canConfirm: boolean;
      timingMatches: boolean;
      lesson: { start: string; end: string };
      event: { start: string; end: string };
      eventUrl: string | null;
      version: number;
      etag: string;
    }
  | {
      state:
        | "reviewed"
        | "changed"
        | "unavailable"
        | "configuration"
        | "authorization"
        | "permission"
        | "throttled"
        | "event_missing"
        | "ambiguous"
        | "provider_unavailable";
    };

export function reviewCalendarConflict(
  studio: string,
  issue: string,
  confirm?: { version: number; etag: string },
) {
  return requestHealth<CalendarConflictReview>(studio, "calendar-review", {
    body: { issue, confirm },
    signal: AbortSignal.timeout(12_000),
  });
}

export async function beginCalendarAuthorization(studio: string) {
  const response = await requestHealth<{ authorize: string }>(
    studio,
    "calendar-oauth",
    {
      signal: AbortSignal.timeout(12000),
    },
  );
  const authorize = new URL(response.authorize);
  if (
    authorize.origin !== "https://accounts.google.com" ||
    authorize.pathname !== "/o/oauth2/v2/auth"
  )
    throw new Error("Calendar authorization is unavailable.");
  window.location.assign(authorize.href);
}

export type CalendarRoleSelection = {
  outgoing: string;
  availability: string[];
  incoming: string[];
};
export type CalendarRoleOptions = {
  roles: CalendarRoleSelection;
  calendars: { id: string; label: string; write: boolean; read: boolean }[];
};
export function manageCalendarRoleSelection(
  studio: string,
  selection?: CalendarRoleSelection,
) {
  return requestHealth<CalendarRoleOptions>(studio, "calendar-roles", {
    body: selection ?? {},
    signal: AbortSignal.timeout(12000),
  });
}

export function checkMissedCalendarChanges(studio: string, calendar: string) {
  return requestHealth<
    { state: "held" } | { state: "checked"; imported: number; review: number }
  >(studio, "calendar-catch-up", {
    body: { calendar },
    signal: AbortSignal.timeout(24000),
  });
}
