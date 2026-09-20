const knownProductionHosts = new Set([
  "portal.d-a-j.com",
  "www.portal.d-a-j.com",
]);

const runIdPattern = /^e2e-[a-z0-9](?:[a-z0-9-]{2,46}[a-z0-9])?$/;

export function assertNonProductionE2EUrl(value: string): URL {
  const url = new URL(value);
  const hostname = url.hostname.toLowerCase();
  if (
    knownProductionHosts.has(hostname) ||
    hostname.endsWith(".portal.d-a-j.com")
  ) {
    throw new Error("E2E operations must never target production.");
  }
  return url;
}

export function assertE2ERunId(value: string): string {
  const runId = value.trim().toLowerCase();
  if (!runIdPattern.test(runId)) {
    throw new Error("E2E run IDs must use the e2e- namespace.");
  }
  return runId;
}

export function assertE2ENamespacedValue(value: string): string {
  if (!value.toLowerCase().startsWith("e2e-")) {
    throw new Error("Cleanup refused a non-E2E target.");
  }
  return value;
}

export function isProductionDeployContext(value?: string): boolean {
  return value?.trim().toLowerCase() === "production";
}
