import { readRuntime } from "./support/runtime";

export default async function globalTeardown() {
  const token = process.env.STAGING_E2E_FIXTURE_TOKEN || "";
  if (!token) return;
  let runtime;
  try {
    runtime = await readRuntime();
  } catch {
    return;
  }
  if (!runtime.fixtureReady) return;
  const response = await fetch(`${runtime.baseURL}/api/e2e/fixtures`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-e2e-fixture-token": token,
    },
    body: JSON.stringify({
      action: "cleanup",
      runId: runtime.runId,
      ruleSnapshots: runtime.ruleSnapshots,
    }),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    const code = /^E2E_FIXTURE_[A-Z_]+:[A-Z0-9_]+$/.test(body.message ?? "")
      ? body.message
      : "UNKNOWN";
    throw new Error(
      `Fixture cleanup failed with HTTP ${response.status}: ${code}.`,
    );
  }
}
