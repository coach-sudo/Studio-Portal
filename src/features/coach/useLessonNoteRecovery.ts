import { useCallback, useEffect, useRef, useState } from "react";
import {
  NoteRecoveryConflict,
  openLessonNoteRecovery,
  type LessonNoteRecovery,
  type LessonNoteRecoveryContent,
} from "../../data/lessonNoteRecovery";

const matches = (
  row: LessonNoteRecovery | null,
  content: LessonNoteRecoveryContent,
) =>
  !!row &&
  row.workingNoteId === content.workingNoteId &&
  row.baseVersion === content.baseVersion &&
  row.lessonId === content.lessonId &&
  row.title === content.title &&
  row.body === content.body &&
  row.bodyHtml === content.bodyHtml;

type RecoveryGateway = Awaited<ReturnType<typeof openLessonNoteRecovery>>;
type RecoverySession = {
  key: string;
  gateway: RecoveryGateway;
  initial: LessonNoteRecovery | null;
};

export function useLessonNoteRecovery({
  enabled,
  studentId,
  noteId,
  openingLessonId,
  content,
  hydrated,
  dirty,
  paused,
}: {
  enabled: boolean;
  studentId: string;
  noteId: string | null;
  openingLessonId: string | null;
  content: LessonNoteRecoveryContent;
  hydrated: boolean;
  dirty: boolean;
  paused: boolean;
}) {
  const key = JSON.stringify([studentId, noteId, openingLessonId]);
  const [session, setSession] = useState<RecoverySession>();
  const [readError, setReadError] = useState("");
  const [writeError, setWriteError] = useState("");
  const [conflict, setConflict] = useState(false);
  const [writing, setWriting] = useState(false);
  const [receipt, setReceipt] = useState<LessonNoteRecovery | null>(null);
  const [reload, setReload] = useState(0);
  const checkpoint = useRef<LessonNoteRecovery | null>(null);
  const active = useRef<Promise<void> | null>(null);
  const pending = useRef<{
    value: LessonNoteRecoveryContent;
    previous: LessonNoteRecovery | null;
    writeId: string;
  } | null>(null);
  const current = session?.key === key ? session : undefined;

  useEffect(() => {
    if (!enabled) return;
    let open = true;
    setSession(undefined);
    setReadError("");
    setWriteError("");
    setConflict(false);
    setReceipt(null);
    checkpoint.current = null;
    pending.current = null;
    const load = async () => {
      try {
        const gateway = await openLessonNoteRecovery(
          studentId,
          noteId,
          openingLessonId,
        );
        let initial = await gateway.read();
        if (initial?.committed) {
          await gateway.discard(initial);
          initial = null;
        }
        if (!open) return;
        checkpoint.current = initial;
        setReceipt(initial);
        setSession({ key, gateway, initial });
      } catch {
        if (open) setReadError("Private recovery could not be checked.");
      }
    };
    void load();
    return () => {
      open = false;
    };
  }, [enabled, key, noteId, openingLessonId, reload, studentId]);

  const sync = useCallback(
    async (value: LessonNoteRecoveryContent) => {
      if (!enabled) return;
      if (!current || conflict) throw new NoteRecoveryConflict();
      if (active.current) await active.current;
      if (!pending.current && matches(checkpoint.current, value)) return;
      const write = async () => {
        setWriting(true);
        setWriteError("");
        try {
          if (pending.current) {
            const prior = pending.current;
            const row = await current.gateway.save(
              prior.value,
              prior.previous,
              prior.writeId,
            );
            pending.current = null;
            checkpoint.current = row;
            setReceipt(row);
          }
          if (matches(checkpoint.current, value)) return;
          const previous = checkpoint.current;
          const writeId = crypto.randomUUID();
          pending.current = { value, previous, writeId };
          const row = await current.gateway.save(value, previous, writeId);
          pending.current = null;
          checkpoint.current = row;
          setReceipt(row);
        } catch (error) {
          setConflict(error instanceof NoteRecoveryConflict);
          setWriteError(
            error instanceof NoteRecoveryConflict
              ? "This recovery draft changed in another window."
              : error instanceof Error
                ? error.message
                : "Private recovery could not be confirmed.",
          );
          throw error;
        } finally {
          setWriting(false);
        }
      };
      const promise = write();
      active.current = promise;
      try {
        await promise;
      } finally {
        if (active.current === promise) active.current = null;
      }
    },
    [conflict, current, enabled],
  );

  const discard = useCallback(async () => {
    if (!current) return;
    if (active.current) await active.current;
    if (pending.current && !conflict) await sync(pending.current.value);
    if (!checkpoint.current) return;
    const previous = checkpoint.current;
    try {
      await current.gateway.discard(previous);
      pending.current = null;
      checkpoint.current = null;
      setReceipt(null);
      setWriteError("");
      setConflict(false);
    } catch (error) {
      setConflict(error instanceof NoteRecoveryConflict);
      setWriteError(
        "The server did not confirm discarding this recovery copy.",
      );
      throw error;
    }
  }, [conflict, current, sync]);

  const matchesReceipt = matches(receipt, content);
  const hasStaleBase = !!receipt && receipt.baseVersion !== content.baseVersion;

  useEffect(() => {
    if (
      !current ||
      !hydrated ||
      paused ||
      conflict ||
      hasStaleBase ||
      writeError ||
      writing ||
      (dirty ? matchesReceipt : !receipt)
    )
      return;
    const timer = window.setTimeout(() => {
      void (dirty ? sync(content) : discard()).catch(() => undefined);
    }, 1200);
    return () => window.clearTimeout(timer);
  }, [
    conflict,
    content,
    current,
    dirty,
    discard,
    hasStaleBase,
    hydrated,
    matchesReceipt,
    paused,
    receipt,
    sync,
    writeError,
    writing,
  ]);

  useEffect(() => {
    if (!enabled) return;
    const retryConnected = () => {
      if (!current && readError) setReload((attempt) => attempt + 1);
      else if (current && !conflict) setWriteError("");
    };
    window.addEventListener("online", retryConnected);
    return () => window.removeEventListener("online", retryConnected);
  }, [conflict, current, enabled, readError]);

  return {
    current,
    readError,
    writeError,
    conflict,
    writing,
    restored: current?.initial ?? null,
    matchesReceipt,
    hasReceipt: !!receipt,
    hasStaleBase,
    loading: enabled && !current && !readError,
    retryRead: () => setReload((attempt) => attempt + 1),
    sync,
    discard,
  };
}
