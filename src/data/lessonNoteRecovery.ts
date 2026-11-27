import { z } from "zod";
import { supabase } from "../lib/supabase";
import type { Database } from "../types/database.generated";

export interface LessonNoteRecoveryContent {
  workingNoteId: string;
  baseVersion: number;
  lessonId: string | null;
  title: string;
  body: string;
  bodyHtml: string;
}

const recoverySchema = z.object({
  id: z.uuid(),
  workingNoteId: z.uuid(),
  baseVersion: z.number().int().nonnegative(),
  version: z.number().int().positive(),
  lessonId: z.uuid().nullable(),
  title: z.string(),
  body: z.string(),
  bodyHtml: z.string(),
  committed: z.boolean(),
});

export type LessonNoteRecovery = z.infer<typeof recoverySchema>;
export class NoteRecoveryConflict extends Error {}

export async function openLessonNoteRecovery(
  studentId: string,
  noteId: string | null,
  openingLessonId: string | null,
) {
  const client = supabase;
  if (!client) throw Error("Private recovery is unavailable.");
  const { data, error } = await client.auth.getSession();
  const actorId = data.session?.user.id;
  if (error || !actorId) throw Error("Sign in to recover private writing.");

  const command = async (
    action: "read" | "save" | "discard",
    payload: Record<string, string | number | null>,
  ) => {
    const { data, error } = await client.auth.getSession();
    const session = data.session;
    if (error || !session || session.user.id !== actorId)
      throw Error("Return to the original coach account to recover this note.");

    // The generated signature marks nullable SQL function arguments as strings.
    const args = {
      p_action: action,
      p_student_id: studentId,
      p_note_id: noteId,
      p_launch_lesson_id: noteId ? null : openingLessonId,
      p_payload: payload,
    } as Database["public"]["Functions"]["manage_lesson_note_recovery"]["Args"];
    const { data: result, error: failure } = await client
      .rpc("manage_lesson_note_recovery", args)
      .setHeader("Authorization", `Bearer ${session.access_token}`);
    if (failure?.code === "40001") throw new NoteRecoveryConflict();
    if (failure?.code === "22023")
      throw Error("This note exceeds the private recovery limit.");
    if (failure) throw Error("The server did not confirm private recovery.");
    return recoverySchema.nullable().parse(result);
  };

  return {
    actorId,
    read: () => command("read", {}),
    save: async (
      content: LessonNoteRecoveryContent,
      previous: LessonNoteRecovery | null,
      writeId: string,
    ) => {
      const row = await command("save", {
        ...content,
        recoveryId: previous?.id ?? null,
        expectedVersion: previous?.version ?? 0,
        writeId,
      });
      if (!row) throw Error("The server did not confirm private recovery.");
      return row;
    },
    discard: (row: LessonNoteRecovery) =>
      command("discard", { recoveryId: row.id, expectedVersion: row.version }),
  };
}
