import { isSupabaseConfigured, supabase } from "../lib/supabase";

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
  const payload = await response.json();
  if (!response.ok)
    throw new Error(payload.message || "The booking command failed.");
  return payload.resource;
}

export interface SchedulingConflict { id: string; summary: string; start: string; end: string; source: "google" | "studio" }
export async function checkSchedulingConflicts(startsAt: string, endsAt: string, lessonId?: string) {
  const result = await bookingAdminCommand("bookings", { command: "check_conflicts", payload: { starts_at: startsAt, ends_at: endsAt, lesson_id: lessonId } });
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
  const result = await response.json();
  if (!response.ok)
    throw new Error(result.message || "The booking change failed.");
  return result.booking;
}

export interface PlatformHealth {
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
  const payload = await response.json();
  if (!response.ok)
    throw new Error(payload.message || "Storage information could not be loaded.");
  return payload as StorageHealth;
}

export async function loadPlatformHealth(): Promise<PlatformHealth> {
  try {
    const response = await fetch("/api/v2/health", {
      headers: { Accept: "application/json" },
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
  if (!isSupabaseConfigured || !supabase) throw new Error("Production database is not configured.");
  const { data } = await supabase.auth.getSession();
  if (!data.session) throw new Error("Sign in as the coach to check providers.");
  const response = await fetch("/api/v2/admin/provider-intake", { method: "POST", headers: { Authorization: `Bearer ${data.session.access_token}`, "Idempotency-Key": crypto.randomUUID() } });
  if (!response.ok && response.status !== 202) { const payload = await response.json().catch(()=>({})); throw new Error(payload.message || "Calendar and Gmail check could not be started."); }
  return true;
}

const inFlightStudioCommands = new Map<string, Promise<any>>();

export function studioCommand(
  domain: string,
  input: {
    command: string;
    entityType?: string;
    entityId?: string;
    expectedVersion: number;
    nextStatus?: string;
    payload?: Record<string, unknown>;
    reason: string;
  },
): Promise<any> {
  const key = `${domain}:${input.command}:${input.entityId || "new"}:${JSON.stringify(input.payload || {})}`;
  const existing = inFlightStudioCommands.get(key);
  if (existing) return existing;
  const request = executeStudioCommand(domain, input).finally(() => inFlightStudioCommands.delete(key));
  inFlightStudioCommands.set(key, request);
  return request;
}

async function executeStudioCommand(
  domain: string,
  input: {
    command: string;
    entityType?: string;
    entityId?: string;
    expectedVersion: number;
    nextStatus?: string;
    payload?: Record<string, unknown>;
    reason: string;
  },
) {
  if (!isSupabaseConfigured || !supabase)
    throw new Error("Production database is not configured.");
  const { data: session } = await supabase.auth.getSession();
  if (!session.session) throw new Error("Sign in to make this change.");
  const response = await fetch(`/api/v2/${domain}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.session.access_token}`,
    },
    body: JSON.stringify({ ...input, idempotencyKey: crypto.randomUUID() }),
  });
  const result = await response.json();
  if (!response.ok)
    throw new Error(result.message || "The studio command failed.");
  return result;
}
