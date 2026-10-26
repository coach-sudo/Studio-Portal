export function safeWorkerError(error: unknown) {
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? String(error.code)
      : "";
  const name = error instanceof Error ? error.name : "";
  const message = error instanceof Error ? error.message : "";
  if (name === "AbortError" || name === "TimeoutError" || code === "57014")
    return {
      category: "timeout",
      message: "Worker operation timed out.",
      retryable: true,
    };
  if (/^[0-9A-Z]{5}$/.test(code) || code.startsWith("PGRST"))
    return {
      category: "database",
      message: "Database operation failed.",
      retryable: /^(08|40|53|57|PGRST00)/.test(code),
    };
  if (message.startsWith("PROVIDER_UNAVAILABLE"))
    return {
      category: "provider",
      message: "Provider operation failed.",
      retryable: true,
    };
  if (/not configured|Worker configuration/.test(message))
    return {
      category: "configuration",
      message: "Worker configuration is unavailable.",
      retryable: false,
    };
  return {
    category: "internal",
    message: "Worker operation failed.",
    retryable: true,
  };
}

/** Only fixed stage names and safe categories enter logs; never payloads/errors. */
export function workerTelemetry(worker: string, executionId: string) {
  const started = Date.now();
  let stage = "initialization",
    stageStarted = started;
  const log = (event: string, fields: Record<string, unknown> = {}) =>
    console.info(
      JSON.stringify({
        worker,
        executionId,
        stage,
        event,
        elapsedMs: Date.now() - started,
        stageElapsedMs: Date.now() - stageStarted,
        ...fields,
      }),
    );
  return {
    stage(next: string) {
      log("stage_completed");
      stage = next;
      stageStarted = Date.now();
      log("stage_started");
    },
    success() {
      log("completed");
    },
    failure(error: unknown) {
      const safe = safeWorkerError(error);
      console.error(
        JSON.stringify({
          worker,
          executionId,
          stage,
          event: "failed",
          elapsedMs: Date.now() - started,
          stageElapsedMs: Date.now() - stageStarted,
          ...safe,
        }),
      );
      return safe;
    },
  };
}
export type WorkerTelemetry = ReturnType<typeof workerTelemetry>;
