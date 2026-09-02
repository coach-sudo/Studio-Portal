import { useCallback, useRef, useState } from "react";

export type StudioMutationStatus = "idle" | "saving" | "saved" | "error";

export interface StudioMutationState {
  pendingKey: string;
  status: StudioMutationStatus;
  error: string;
}

export interface StudioMutationOptions {
  optimistic?: () => void | (() => void);
  invalidate?: () => void | Promise<unknown>;
}

export function useStudioMutation() {
  const [pendingKey, setPendingKey] = useState("");
  const pendingRef = useRef("");
  const [status, setStatus] = useState<StudioMutationStatus>("idle");
  const [error, setError] = useState("");

  const run = useCallback(
    async <T,>(
      key: string,
      operation: () => Promise<T>,
      options: StudioMutationOptions = {},
    ) => {
      if (pendingRef.current) return undefined;
      pendingRef.current = key;
      setPendingKey(key);
      setStatus("saving");
      setError("");
      let rollback: void | (() => void) = undefined;
      try {
        rollback = options.optimistic?.();
        const result = await operation();
        await options.invalidate?.();
        setStatus("saved");
        return result;
      } catch (reason) {
        rollback?.();
        const message =
          reason instanceof Error ? reason.message : "The change could not be saved.";
        setStatus("error");
        setError(message);
        throw reason;
      } finally {
        pendingRef.current = "";
        setPendingKey("");
      }
    },
    [],
  );

  const reset = useCallback(() => {
    setStatus("idle");
    setError("");
  }, []);

  return {
    run,
    reset,
    pendingKey,
    status,
    error,
    isPending: (key?: string) => Boolean(pendingKey && (!key || pendingKey === key)),
  };
}
