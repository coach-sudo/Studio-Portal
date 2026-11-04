import { isSupabaseConfigured, supabase } from "../lib/supabase";
import { readApiClientError } from "./apiClientError";

export type BookingAdminResource =
  | "services"
  | "availability"
  | "exceptions"
  | "offerings"
  | "bookings"
  | "series"
  | "participants";

export async function bookingAdminCommand(
  resource: BookingAdminResource,
  body: Record<string, unknown>,
) {
  if (!isSupabaseConfigured || !supabase)
    throw new Error("Production database is not configured.");
  const { data: session } = await supabase.auth.getSession();
  if (!session.session)
    throw new Error("Sign in as the coach to make this change.");
  const response = await fetch(`/api/v2/admin/booking/${resource}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.session.access_token}`,
      "Idempotency-Key": crypto.randomUUID(),
    },
    body: JSON.stringify(body),
  });
  if (!response.ok)
    throw await readApiClientError(response, "The booking command failed.");
  const payload = await response.json();
  return payload.resource;
}

export interface SchedulingConflict {
  id: string;
  summary: string;
  start: string;
  end: string;
  source: "google" | "studio";
}
export async function checkSchedulingConflicts(
  startsAt: string,
  endsAt: string,
  lessonId?: string,
) {
  const result = await bookingAdminCommand("bookings", {
    command: "check_conflicts",
    payload: { starts_at: startsAt, ends_at: endsAt, lesson_id: lessonId },
  });
  return (result?.conflicts || []) as SchedulingConflict[];
}

export async function portalBookingCommand(
  bookingId: string,
  command: "cancel" | "reschedule",
  payload: Record<string, unknown> = {},
) {
  if (!isSupabaseConfigured || !supabase)
    throw new Error("Production database is not configured.");
  const { data: session } = await supabase.auth.getSession();
  if (!session.session) throw new Error("Sign in to manage this booking.");
  const response = await fetch(`/api/v2/portal/bookings/${command}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.session.access_token}`,
    },
    body: JSON.stringify({ bookingId, ...payload }),
  });
  if (!response.ok)
    throw await readApiClientError(response, "The booking change failed.");
  const result = await response.json();
  return result.booking;
}

export interface PlatformHealth {
  integrations?: Record<
    string,
    {
      state:
        | "working"
        | "configured_unverified"
        | "attention_required"
        | "unconfigured";
      configured: boolean;
      lastSuccessAt: string | null;
    }
  >;
  mode: "live" | "demo";
  supabase: boolean;
  stripe: boolean;
  googleCalendar: boolean;
  gmail: boolean;
  scheduledWorkers: boolean;
  issues?: string[];
}

export interface StorageHealth {
  databaseBytes: number;
  storageBytes: number;
  storageObjects: number;
  measuredAt: string;
  largestTables: Array<{ name: string; bytes: number; rows: number }>;
  cleanupCandidates: Record<string, number>;
}

export async function loadStorageHealth(): Promise<StorageHealth> {
  if (!isSupabaseConfigured || !supabase)
    throw new Error("Production database is not configured.");
  const { data } = await supabase.auth.getSession();
  if (!data.session) throw new Error("Sign in as the coach to view storage.");
  const response = await fetch("/api/v2/storage-health", {
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${data.session.access_token}`,
    },
  });
  if (!response.ok)
    throw await readApiClientError(
      response,
      "Storage information could not be loaded.",
    );
  const payload = await response.json();
  return payload as StorageHealth;
}

export async function loadPlatformHealth(): Promise<PlatformHealth> {
  try {
    if (!supabase) throw new Error();
    const { data } = await supabase.auth.getSession();
    if (!data.session) throw new Error();
    const response = await fetch("/api/v2/health", {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${data.session.access_token}`,
      },
    });
    if (!response.ok) throw new Error();
    return (await response.json()) as PlatformHealth;
  } catch {
    return {
      mode: "demo",
      supabase: false,
      stripe: false,
      googleCalendar: false,
      gmail: false,
      scheduledWorkers: false,
      issues: ["Integration health could not be loaded."],
    };
  }
}

export async function startProviderIntake() {
  if (!isSupabaseConfigured || !supabase)
    throw new Error("Production database is not configured.");
  const { data } = await supabase.auth.getSession();
  if (!data.session)
    throw new Error("Sign in as the coach to check providers.");
  const response = await fetch("/api/v2/admin/provider-intake", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${data.session.access_token}`,
      "Idempotency-Key": crypto.randomUUID(),
    },
  });
  if (!response.ok && response.status !== 202)
    throw await readApiClientError(
      response,
      "Calendar and Gmail check could not be started.",
    );
  return true;
}

const inFlightStudioCommands = new Map<string, Promise<any>>();

interface StudioCommandInput {
  command: string;
  idempotencyKey?: string;
  entityType?: string;
  entityId?: string;
  expectedVersion: number;
  nextStatus?: string;
  payload?: Record<string, unknown>;
  reason: string;
}

export async function studioCommand(
  domain: string,
  input: StudioCommandInput,
): Promise<any> {
  if (!isSupabaseConfigured || !supabase)
    throw new Error("Production database is not configured.");
  // Snapshot the wire envelope before awaiting auth: callers may edit the form
  // while a session lookup is pending. The key and sent body must describe the
  // same command, including its version, reason and explicit replay identity.
  const serializedInput = JSON.stringify(input);
  const { data, error } = await supabase.auth.getSession();
  const session = data.session;
  if (error || !session?.access_token)
    throw new Error("Sign in to make this change.");
  // This private, short-lived key is never logged or exposed. A new session
  // must not subscribe to a previous session's in-flight response.
  const key = JSON.stringify([
    session.user?.id ?? null,
    session.access_token,
    domain,
    serializedInput,
  ]);
  const existing = inFlightStudioCommands.get(key);
  if (existing) return existing;
  const request = executeStudioCommand(
    domain,
    serializedInput,
    session.access_token,
  ).finally(() => inFlightStudioCommands.delete(key));
  inFlightStudioCommands.set(key, request);
  return request;
}

async function executeStudioCommand(
  domain: string,
  serializedInput: string,
  accessToken: string,
) {
  const input: StudioCommandInput = JSON.parse(serializedInput);
  const response = await fetch(`/api/v2/${domain}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      ...input,
      idempotencyKey: input.idempotencyKey ?? crypto.randomUUID(),
    }),
  });
  if (!response.ok)
    throw await readApiClientError(response, "The studio command failed.");
  const result = await response.json();
  return result;
}
