import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import process from "node:process";
import console from "node:console";

const report = JSON.parse(
  readFileSync(process.argv[2] || "test-results/calendar-repeat.json", "utf8"),
);
const tests = [];
function collect(suites) {
  for (const suite of suites) {
    for (const spec of suite.specs || []) tests.push(...spec.tests);
    collect(suite.suites || []);
  }
}
collect(report.suites || []);
assert.equal(
  report.stats.expected,
  20,
  "All 20 calendar repetitions must execute and pass",
);
for (const metric of ["skipped", "unexpected", "flaky"])
  assert.equal(
    report.stats[metric],
    0,
    `Calendar ${metric} results cannot satisfy this gate`,
  );
assert.equal(tests.length, 20);
for (const project of ["desktop-chromium", "mobile-chromium"]) {
  assert.equal(tests.filter((test) => test.projectName === project).length, 10);
}
for (const test of tests) {
  assert.equal(test.expectedStatus, "passed");
  assert.equal(test.results.length, 1, "Retries cannot satisfy this gate");
  assert.equal(test.results[0].status, "passed");
  assert.equal(test.results[0].retry, 0);
}
console.log(
  "PASS: 20 calendar repetitions executed once each; zero skips, failures, flakes or retries.",
);
