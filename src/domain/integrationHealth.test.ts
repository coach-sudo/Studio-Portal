import { describe, expect, it } from "vitest";
import {
  intakeDispatchNotice,
  workerHealth,
  type WorkerReceipt,
} from "./integrationHealth";
const receipt: WorkerReceipt = {
  jobId: "synthetic-job",
  state: "pending",
  attempts: 0,
  requestedAt: "2026-10-28T00:00:00Z",
  acceptedAt: null,
  startedAt: null,
  finishedAt: null,
  lastSuccessAt: null,
  errorCategory: null,
  leaseExpired: false,
  stages: [],
  history: [],
};
describe("worker outcomes", () => {
  it("keeps disabled, queued, accepted, running and completed distinct", () => {
    expect(workerHealth(false, { ...receipt, state: "succeeded" }).status).toBe(
      "disabled",
    );
    expect(workerHealth(true, receipt).status).toBe("queued");
    expect(
      workerHealth(true, { ...receipt, acceptedAt: receipt.requestedAt })
        .status,
    ).toBe("accepted");
    expect(workerHealth(true, { ...receipt, state: "running" }).status).toBe(
      "running",
    );
    expect(workerHealth(true, { ...receipt, state: "succeeded" }).status).toBe(
      "completed",
    );
  });
  it("retains partial success, scope guidance and expired lease recovery", () => {
    const result = workerHealth(true, {
      ...receipt,
      state: "failed",
      stages: [
        {
          stage: "calendar_processing",
          state: "stage_completed",
          errorCategory: null,
          at: receipt.requestedAt,
        },
        {
          stage: "gmail_processing",
          state: "stage_failed",
          errorCategory: "gmail_read_permission",
          at: receipt.requestedAt,
        },
      ],
    });
    expect(result.status).toBe("partial");
    expect(result.recovery).toMatch(/sending permission alone/);
    expect(
      workerHealth(true, { ...receipt, state: "running", leaseExpired: true })
        .status,
    ).toBe("failed");
    expect(workerHealth(true, null, true).status).toBe("unknown");
    expect(intakeDispatchNotice({ status: "disabled" })).toMatch(
      /No Calendar or Gmail scan/,
    );
    expect(intakeDispatchNotice({ status: "accepted" })).toMatch(
      /not yet been verified/,
    );
  });
});
