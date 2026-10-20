import { supabase } from "../lib/supabase";
import { studioCommand } from "./bookingCommands";
import type { StudentSetupState } from "../domain/studentSetup";
export async function setupCommand(
  studentId: string,
  command: string,
  value: Record<string, unknown> = {},
  version = 0,
  key: string = crypto.randomUUID(),
): Promise<StudentSetupState> {
  const result = await studioCommand("setup", {
    command,
    entityId: studentId,
    expectedVersion: version,
    payload: value,
    idempotencyKey: key,
    reason: "Coach reviewed student setup",
  });
  return result.resource;
}
export interface SetupContext {
  contacts: Array<{
    id: string;
    student_id: string;
    full_name: string;
    email: string;
    relationship_type: string;
    portal_enabled: boolean;
  }>;
  lessons: Array<{
    id: string;
    topic: string;
    starts_at: string;
    status: string;
  }>;
  packages: Array<{ id: string; name: string; status: string }>;
  definitions: Array<{
    id: string;
    name: string;
    price_minor: number;
    currency: string;
    session_count: number;
  }>;
  hasStudentAccount: boolean;
}
export async function loadSetupContext(
  studentId: string,
  search: string,
): Promise<SetupContext> {
  if (!supabase) throw new Error("Database unavailable");
  const r = (await supabase.rpc(
    "student_setup_context" as never,
    { p_student: studentId, p_search: search } as never,
  )) as unknown as { data: SetupContext | null; error: Error | null };
  if (r.error) throw r.error;
  if (!r.data) throw new Error("Student unavailable");
  return r.data as unknown as SetupContext;
}
