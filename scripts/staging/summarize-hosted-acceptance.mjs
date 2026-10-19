// Publish only an explicit, non-secret subset of the restricted local reports.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { privatePath } from "./protected-browser.mjs";
import process from "node:process";
import console from "node:console";
import { Buffer } from "node:buffer";
import { format, resolveConfig } from "prettier";

const directory = privatePath(process.argv[2]);
const read = (name) => JSON.parse(readFileSync(join(directory, name), "utf8"));
const collect = (suites, parents = []) =>
  suites.flatMap((suite) => [
    ...(suite.specs || []).flatMap((spec) =>
      spec.tests.map((test) => ({
        title: [...parents, suite.title, spec.title]
          .filter(Boolean)
          .join(" › "),
        project: test.projectName,
        status: test.status,
        results: test.results,
      })),
    ),
    ...collect(suite.suites || [], [...parents, suite.title]),
  ]);
const matrix = read("hosted-matrix-results.json");
const header = read("hosted-header-results.json");
const recheck = read("hosted-recheck-results.json");
const local = read("local-focus-results.json");
const unit = read("unit-release-results.json");
const pages = [];
for (const test of collect(matrix.suites)) {
  for (const result of test.results) {
    for (const attachment of result.attachments || []) {
      if (attachment.name !== "sanitized-layout-accessibility") continue;
      const data = JSON.parse(
        attachment.body
          ? Buffer.from(attachment.body, "base64").toString()
          : readFileSync(privatePath(attachment.path), "utf8"),
      );
      pages.push(
        ...data.map((page) => ({
          project: test.project,
          role:
            ["coach", "student", "guardian"].find((role) =>
              test.title.includes(` › ${role} › `),
            ) || "unknown",
          path: page.path,
          width: page.size.width,
          contentWidth: page.size.content,
          violations: page.violations.map((v) => ({
            id: v.id,
            impact: v.impact,
          })),
        })),
      );
    }
  }
}
const strip = (report) => ({
  startedAt: report.stats.startTime,
  passed: report.stats.expected,
  failed: report.stats.unexpected,
  skipped: report.stats.skipped,
  flaky: report.stats.flaky,
  durationMs: report.stats.duration,
  cases: collect(report.suites).map(({ title, project, status }) => ({
    title,
    project,
    status,
  })),
});
const output = {
  application: "0b18a5a2238daa49bec1290f5884d5792f4aefc9",
  origin: "https://6ad23d4f8b10c10447224155--coachd-staging.netlify.app",
  netlifySite: "d83ff6cb-f57b-4741-8c3c-3eaae7adab19",
  supabase: "lrxrivfqjpkvygozphoz",
  generatedAt: new Date().toISOString(),
  tooling: {
    node: process.version,
    playwright: "1.63.0",
    chromium: "153.0.8010.12",
    webkit: "26.6",
    operatingSystem: "Windows x64",
    chromiumWidths: [320, 390, 768, 1440],
    webkitWidths: [1440],
    zoomEquivalentWidth: 720,
  },
  hostedMatrix: strip(matrix),
  additionalHostedHeaderRegression: strip(header),
  hostedRecheck: strip(recheck),
  uniqueHostedChecks: {
    executed: 70,
    passed: 68,
    failed: 2,
    skipped: 0,
    interpretation:
      "69-check matrix plus the new 320px header regression; reruns are not added as unique checks",
  },
  localBrowserFixes: strip(local),
  unit: {
    total: unit.numTotalTests,
    passed: unit.numPassedTests,
    failed: unit.numFailedTests,
    pending: unit.numPendingTests,
    files: unit.testResults.length,
  },
  postgres: {
    version: "17.10",
    migrations: 57,
    pgTapAssertions: 204,
    pgTapFiles: 8,
    concurrencyPrograms: 3,
    passed: true,
    connection: "unique disposable loopback cluster",
    source: "fe63c57e928bca78c23e43877480b36a2d8e26c6",
    sourceInputsEqualDeployedCandidate: true,
  },
  accessibility: {
    auditedPages: pages.length,
    seriousOrCritical: pages.reduce(
      (sum, page) =>
        sum +
        page.violations.filter((v) =>
          ["serious", "critical"].includes(v.impact),
        ).length,
      0,
    ),
    pages,
  },
  blocked: [
    "Hosted business fixtures and all H01–H16 mutations",
    "Live guardian revocation and protected Auth claim redirect completion",
    "Provider health, Stripe, Google and outbound delivery",
    "Scheduled worker invocation/cadence",
    "Legacy query mode false hosted build",
    "Populated hosted history/lesson/bulk interface acceptance",
  ],
  limitations: [
    "Only existing empty synthetic records tested on host",
    "200% represented by 720px CSS reflow, not native browser zoom",
    "Axe is not screen-reader or full manual accessibility certification",
    "Auth session/rate-limit changes are allowed operational writes; business tables must remain unchanged",
  ],
};
const reportPath = "docs/wave-one-hosted-acceptance.json";
writeFileSync(
  reportPath,
  await format(JSON.stringify(output), {
    ...(await resolveConfig(reportPath)),
    parser: "json",
  }),
);
console.log(
  JSON.stringify({
    hosted: output.uniqueHostedChecks,
    unit: output.unit,
    axePages: pages.length,
    seriousOrCritical: output.accessibility.seriousOrCritical,
    localBrowser: {
      passed: local.stats.expected,
      failed: local.stats.unexpected,
    },
  }),
);
