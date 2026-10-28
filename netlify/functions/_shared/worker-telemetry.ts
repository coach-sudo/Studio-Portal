export function safeWorkerError(error: unknown) {
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? String(error.code)
      : "";
  const name = error instanceof Error ? error.name : "";
  const message = error instanceof Error ? error.message : "";
  if (code === "GMAIL_READ_PERMISSION")
    return {
      category: "gmail_read_permission",
      message: "Gmail read permission is unavailable.",
      retryable: false,
    };
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
export type WorkerObservation = {
  event: "stage_started" | "stage_completed" | "stage_failed";
  stage: string;
  category?: string;
};
export function workerTelemetry(worker: string, executionId: string) {
  const started = Date.now();
  let stage = "initialization",
    stageStarted = started,
    stageFailed = false;
  const noObservation = (value: WorkerObservation) =>
    Promise.resolve(void value);
  let observer = noObservation;
  let pending = Promise.resolve();
  let observationError: unknown;
  const observe = (event: WorkerObservation["event"], category?: string) => {
    if (observer !== noObservation) {
      const persist = observer,
        observation = { event, stage, category };
      pending = pending
        .then(() => persist(observation))
        .catch((error) => {
          observationError = error;
        });
    }
  };
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
    persistWith(next: typeof observer) {
      observer = next;
    },
    async flush() {
      await pending;
      if (observationError) throw observationError;
    },
    stage(next: string) {
      if (!stageFailed) {
        log("stage_completed");
        observe("stage_completed");
      }
      stage = next;
      stageStarted = Date.now();
      stageFailed = false;
      log("stage_started");
      observe("stage_started");
    },
    success() {
      log("completed");
    },
    failure(error: unknown) {
      const safe = safeWorkerError(error);
      if (!stageFailed) observe("stage_failed", safe.category);
      stageFailed = true;
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
export type WorkerTelemetry = Pick<
  ReturnType<typeof workerTelemetry>,
  "stage" | "success" | "failure"
>;
