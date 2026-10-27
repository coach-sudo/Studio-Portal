import { releaseMetadata } from "./release";

export const workerSettings = {
  "provider-intake": "WORKER_PROVIDER_INTAKE_ENABLED",
  calendar: "WORKER_CALENDAR_ENABLED",
  "booking-maintenance": "WORKER_BOOKING_MAINTENANCE_ENABLED",
  automations: "WORKER_AUTOMATIONS_ENABLED",
} as const;
export type ControlledWorker = keyof typeof workerSettings;

/** Server configuration only. Never accept request headers, URLs or client flags. */
export function workerEnabled(worker: ControlledWorker): boolean {
  const get = (key: string) => globalThis.Netlify?.env.get(key);
  const configured = get(workerSettings[worker]);
  // An explicitly configured value always wins; only exact `true` enables work.
  if (configured !== undefined) return configured === "true";
  const site = get("SITE_ID");
  const context = get("CONTEXT") || releaseMetadata().context;
  if (site === "d83ff6cb-f57b-4741-8c3c-3eaae7adab19") return false;
  if (context === "production")
    return site === "93829451-dbcf-4863-a07f-fa448cb17494";
  // Preserve unlinked local/dev execution. Every hosted non-production site
  // requires explicit opt-in, including previews of the production site.
  return !site && ["local", "dev", "deploy-preview"].includes(context);
}

export class WorkerDisabledError extends Error {
  readonly worker: ControlledWorker;
  constructor(worker: ControlledWorker) {
    super("Worker execution is disabled.");
    this.worker = worker;
    this.name = "WorkerDisabledError";
  }
}
export function assertWorkerEnabled(worker: ControlledWorker) {
  if (!workerEnabled(worker)) throw new WorkerDisabledError(worker);
}
export function disabledWorkerResult(worker: ControlledWorker) {
  // Background return bodies are discarded by Netlify; the log is the evidence.
  console.info(JSON.stringify({ event: "worker.disabled", worker }));
  return { ok: true, status: "disabled", worker } as const;
}
export function disabledWorkerResponse(worker: ControlledWorker) {
  return Response.json(disabledWorkerResult(worker));
}
