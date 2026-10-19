// New bounded acceptance identity. Historical UI run/source/ceilings stay intact.
import { createHash } from "node:crypto";
import {
  plan as historical,
  plannedUiId as oldId,
} from "./prepare-ui-mutation-plan.mjs";
export const runId = "e2e-waves12-ui-20261019-b";
export function plannedUiId(name) {
  const h = createHash("sha256")
    .update(`${runId}:${name}`)
    .digest("hex")
    .slice(0, 32)
    .split("");
  h[12] = "4";
  h[16] = "a";
  return [
    h.slice(0, 8),
    h.slice(8, 12),
    h.slice(12, 16),
    h.slice(16, 20),
    h.slice(20),
  ]
    .map((x) => x.join(""))
    .join("-");
}
const names = [
  ...Object.keys(historical.records),
  ...Object.keys(historical.accounts).map((k) => "auth-" + k),
  ...["coach", "student", "guardian"].map((k) => "membership-" + k),
];
const map = new Map(names.map((n) => [oldId(n), plannedUiId(n)]));
const clone = (value) =>
  typeof value === "string"
    ? map.get(value) || value.replaceAll(historical.runId, runId)
    : Array.isArray(value)
      ? value.map(clone)
      : value && typeof value === "object"
        ? Object.fromEntries(
            Object.entries(value).map(([k, v]) => [k, clone(v)]),
          )
        : value;
export const plan = clone(historical);
plan.status = "AUTHORIZED_SCOPE_PENDING_FRESH_RECEIPT";
plan.target.deployment = "6ad59afc32390ffd00c5d20e";
plan.target.candidate = "36f446392dd940ad25b0ba7449b7dad8d938c636";
for (const n of [
  "other-contact",
  "note-published",
  "note-draft",
  "material-private",
  "material-link",
  "unavailable",
])
  plan.records[n] = plannedUiId(n);
Object.assign(plan.budgets, {
  contacts: 2,
  relationships: 2,
  services: 0,
  packageLots: 0,
  creditsGranted: 0,
  seededLessons: 2,
  lessonsTotal: 2,
  reviewedBatchMaximum: 0,
  bulkReviews: 0,
  uiCreatedLessons: 0,
  readRequests: 900,
  browserReadCeiling: 800,
  httpMutationRequests: 12,
  businessMutationRequests: 6,
  sessionRequests: 6,
  canonicalSqlRequests: 30,
  cleanupTransactions: 20,
  notes: 2,
  materials: 1,
  materialLinks: 1,
});
plan.fixtureContent.lessons.find((l) => l.name === "lesson-edit").startsAt =
  "2026-10-19T18:00:00Z";
plan.fixtureContent.lessons.find((l) => l.name === "lesson-edit").endsAt =
  "2026-10-19T19:00:00Z";
plan.fixtureContent.lessons = plan.fixtureContent.lessons.filter((l) =>
  ["lesson-edit", "lesson-credit"].includes(l.name),
);
delete plan.fixtureContent.package;
delete plan.fixtureContent.uiCreate;
plan.cases = ["WEBKIT", "UI08"];
plan.commands = { "/api/v2/students": ["save_linked_contact"] };
plan.budgetRationale = {
  readRequests:
    "900 total hard attempts. WebKit journeys only; Chromium is used solely for UI08. Stop browser reads at 800, preserving at least 99 cleanup reads after a charged denial. All prior closed-run budgets remain unchanged.",
  httpMutationRequests:
    "12 total: at most six business submissions and six session operations. Only the exact owned contact revocation is permitted. No automatic retries.",
  canonicalSqlRequests:
    "30 includes setup and exact canonical cleanup; no bulk processors or global workers.",
  cleanupTransactions:
    "20 ceiling; expected nine exact-ID transactions; authored/audit history is retained. Zero credit grants, packages or cash.",
};
