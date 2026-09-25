import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

type Result = {
  status?: string;
  annotations?: { type?: string; description?: string }[];
};
type TestCase = {
  title?: string;
  projectName?: string;
  results?: Result[];
  annotations?: Result["annotations"];
};
type Spec = { title?: string; tests?: TestCase[] };
type Suite = { title?: string; specs?: Spec[]; suites?: Suite[] };
type Report = { suites?: Suite[] };

interface Evidence {
  title: string;
  project: string;
  status: "PASSED" | "FAILED" | "BLOCKED" | "NOT RUN";
  reason?: string;
}

function collect(suites: Suite[], output: Evidence[]) {
  for (const suite of suites) {
    for (const spec of suite.specs || []) {
      for (const test of spec.tests || []) {
        const latest = test.results?.at(-1);
        const annotations = [
          ...(test.annotations || []),
          ...(latest?.annotations || []),
        ];
        const reason = annotations
          .map((item) => item.description || "")
          .find((item) => item.startsWith("BLOCKED:"));
        const status =
          latest?.status === "passed"
            ? "PASSED"
            : latest?.status === "failed" || latest?.status === "timedOut"
              ? "FAILED"
              : reason
                ? "BLOCKED"
                : "NOT RUN";
        output.push({
          title: spec.title || test.title || "Untitled test",
          project: test.projectName || "unknown",
          status,
          ...(reason ? { reason: reason.replace(/^BLOCKED:\s*/, "") } : {}),
        });
      }
    }
    collect(suite.suites || [], output);
  }
}

const reportPath = path.resolve("test-results/results.json");
let report: Report = {};
let reportUnavailableReason: string | undefined;
try {
  report = JSON.parse(await readFile(reportPath, "utf8")) as Report;
} catch (error) {
  if (
    error instanceof Error &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === "ENOENT"
  ) {
    reportUnavailableReason =
      "The deployed test command did not produce a results file.";
  } else {
    throw error;
  }
}
const evidence: Evidence[] = [];
collect(report.suites || [], evidence);

const journeys = Array.from({ length: 13 }, (_, index) => {
  const number = index + 1;
  const matching = evidence.filter((item) =>
    new RegExp(`Journey 0?${number}(?:\\D|$)`).test(item.title),
  );
  const failed = matching.find((item) => item.status === "FAILED");
  const blocked = matching.find((item) => item.status === "BLOCKED");
  const passed = matching.some((item) => item.status === "PASSED");
  return {
    journey: number,
    status: failed
      ? "FAILED"
      : blocked
        ? "BLOCKED"
        : passed
          ? "PASSED"
          : "NOT RUN",
    reason:
      failed?.reason ||
      blocked?.reason ||
      (!matching.length
        ? reportUnavailableReason || "No matching deployed test result."
        : undefined),
    tests: matching,
  };
});

const summary = {
  generatedAt: new Date().toISOString(),
  counts: evidence.reduce<Record<string, number>>((counts, item) => {
    counts[item.status] = (counts[item.status] || 0) + 1;
    return counts;
  }, {}),
  journeys,
  tests: evidence,
};
await mkdir(path.resolve("test-results"), { recursive: true });
await writeFile(
  path.resolve("test-results/pr3-status.json"),
  `${JSON.stringify(summary, null, 2)}\n`,
);

const markdown = [
  "## PR3 deployed browser status",
  "",
  "| Journey | Status | Reason |",
  "| --- | --- | --- |",
  ...journeys.map(
    (item) =>
      `| ${String(item.journey).padStart(2, "0")} | ${item.status} | ${item.reason || "—"} |`,
  ),
  "",
  `Test counts: ${
    Object.entries(summary.counts)
      .map(([key, value]) => `${key} ${value}`)
      .join(", ") || "none"
  }.`,
  "",
].join("\n");
process.stdout.write(markdown);
for (const item of evidence.filter((entry) => entry.status === "BLOCKED")) {
  process.stdout.write(
    `::warning title=Infrastructure-blocked E2E::${item.title}: ${item.reason}\n`,
  );
}
if (process.env.GITHUB_STEP_SUMMARY) {
  await appendFile(process.env.GITHUB_STEP_SUMMARY, markdown);
}

const fixtureInfrastructureBlocked = evidence.some(
  (entry) =>
    entry.status === "BLOCKED" &&
    (entry.reason?.startsWith("fixture setup failed:") ||
      entry.reason?.includes("STAGING_E2E_FIXTURE_TOKEN")),
);
if (fixtureInfrastructureBlocked) {
  process.stderr.write(
    "Fixture infrastructure is unavailable; the deployed suite cannot be treated as successful.\n",
  );
  process.exitCode = 1;
}
if (reportUnavailableReason) {
  process.stderr.write(`${reportUnavailableReason}\n`);
  process.exitCode = 1;
}
